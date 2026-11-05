import { springDebugArgs } from '../../shared/java-debug';
import { createHash } from 'node:crypto';
import type { FileSystem } from '../ports/file-system';
import type { Platform } from '../ports/platform';
import { normalizeRepoPath, pathModule } from '../paths';
import { RUN_LIMITS } from './limits';
import { checkProgram } from './resolve-program';
import type { RunCatalog, RunCommand, RunSource, RunTool, RunWarning } from './types';

export interface DetectDeps {
  fs: FileSystem;
  platform: Platform;
}

export interface DetectTarget {
  groupId: string;
  folder: string;
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/** Configuração ainda sem a disponibilidade, que depende de procurar o programa. */
interface Draft {
  source: RunSource;
  tool: RunTool;
  /** Identifica a configuração dentro da pasta e da origem (entra no id). */
  key: string;
  label: string;
  program: string;
  args: string[];
}

type FileRead = { kind: 'missing' } | { kind: 'big' } | { kind: 'ok'; text: string };

async function readProjectFile(fs: FileSystem, path: string): Promise<FileRead> {
  let size: number;
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile) return { kind: 'missing' };
    size = stat.size;
  } catch {
    return { kind: 'missing' };
  }
  if (size > RUN_LIMITS.projectFileBytes) return { kind: 'big' };
  try {
    return { kind: 'ok', text: new TextDecoder().decode(await fs.readFile(path)) };
  } catch {
    return { kind: 'missing' };
  }
}

async function isFile(fs: FileSystem, path: string): Promise<boolean> {
  return fs
    .stat(path)
    .then((s) => s.isFile)
    .catch(() => false);
}

function commandId(groupId: string, folder: string, draft: Draft, os: Platform['os']): string {
  return createHash('sha256')
    .update([groupId, normalizeRepoPath(folder, os), draft.source, draft.key].join('|'))
    .digest('hex')
    .slice(0, 16);
}

class Collector {
  readonly drafts: Draft[] = [];
  readonly warnings: RunWarning[] = [];

  constructor(
    private readonly groupId: string,
    private readonly folder: string,
  ) {}

  warn(message: string): void {
    this.warnings.push({ groupId: this.groupId, folder: this.folder, message });
  }

  add(draft: Draft): void {
    this.drafts.push(draft);
  }
}

async function detectPackageJson(deps: DetectDeps, folder: string, out: Collector): Promise<void> {
  const p = pathModule(deps.platform.os);
  const file = await readProjectFile(deps.fs, p.join(folder, 'package.json'));
  if (file.kind === 'missing') return;
  if (file.kind === 'big') {
    out.warn('package.json maior que 1 MB; ignorado.');
    return;
  }
  let scripts: unknown;
  try {
    const json = JSON.parse(file.text) as unknown;
    scripts = typeof json === 'object' && json !== null ? (json as { scripts?: unknown }).scripts : undefined;
  } catch {
    out.warn('package.json inválido; ignorado.');
    return;
  }
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return;
  const names = Object.entries(scripts)
    .filter(([, body]) => typeof body === 'string')
    .map(([name]) => name);
  if (names.length === 0) return;
  const tool: RunTool = (await isFile(deps.fs, p.join(folder, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await isFile(deps.fs, p.join(folder, 'yarn.lock')))
      ? 'yarn'
      : 'npm';
  for (const name of names) {
    out.add({ source: 'npm', tool, key: name, label: name, program: tool, args: ['run', name] });
  }
}

/**
 * Programa de Maven/Gradle: o wrapper do projeto (`mvnw`/`gradlew`) quando existe; no Windows os lotes
 * `.cmd`/`.bat` não são executados: wrappers com JAR usam Java diretamente; os demais usam a ferramenta do sistema.
 */
async function buildToolProgram(
  deps: DetectDeps,
  folder: string,
  wrapper: 'mvnw' | 'gradlew',
  system: 'mvn' | 'gradle',
  out: Collector,
): Promise<string> {
  const p = pathModule(deps.platform.os);
  if (deps.platform.os === 'win32') {
    const batch = wrapper === 'mvnw' ? 'mvnw.cmd' : 'gradlew.bat';
    if (await isFile(deps.fs, p.join(folder, batch))) {
      const jar =
        wrapper === 'mvnw'
          ? p.join(folder, '.mvn', 'wrapper', 'maven-wrapper.jar')
          : p.join(folder, 'gradle', 'wrapper', 'gradle-wrapper.jar');
      if (await isFile(deps.fs, jar)) return p.join(folder, batch);
      out.warn(`Wrapper do projeto (${batch}) ignorado no Windows; usando ${system} do sistema.`);
    }
    return system;
  }
  const path = p.join(folder, wrapper);
  return (await isFile(deps.fs, path)) ? path : system;
}

async function detectMaven(deps: DetectDeps, folder: string, out: Collector): Promise<void> {
  const p = pathModule(deps.platform.os);
  const pom = await readProjectFile(deps.fs, p.join(folder, 'pom.xml'));
  if (pom.kind === 'missing') return;
  if (pom.kind === 'big') {
    out.warn('pom.xml maior que 1 MB; ignorado.');
    return;
  }
  const program = await buildToolProgram(deps, folder, 'mvnw', 'mvn', out);
  const goals = ['compile', 'test', 'package'];
  if (/spring-boot-(?:starter-parent|maven-plugin|starter)/.test(pom.text.replace(/<!--[\s\S]*?-->/g, '')))
    goals.push('spring-boot:run');
  for (const goal of goals) {
    out.add({
      source: 'maven',
      tool: 'maven',
      key: goal,
      label: `Maven: ${goal}`,
      program,
      args: [goal],
    });
  }
  if (goals.includes('spring-boot:run')) {
    out.add({
      source: 'maven',
      tool: 'maven',
      key: 'spring-boot:debug',
      label: 'Maven: Spring Boot Debug (5005)',
      program,
      args: ['spring-boot:run', ...springDebugArgs([])],
    });
  }
}

const GRADLE_APPLICATION =
  /\bid\s*\(?\s*["']application["']|apply\s+plugin\s*:\s*["']application["']|^\s*application\s*$/m;
const GRADLE_SPRING_BOOT = /org\.springframework\.boot/;

async function detectGradle(deps: DetectDeps, folder: string, out: Collector): Promise<void> {
  const p = pathModule(deps.platform.os);
  let script: FileRead = { kind: 'missing' };
  let name = 'build.gradle';
  for (const candidate of ['build.gradle.kts', 'build.gradle']) {
    script = await readProjectFile(deps.fs, p.join(folder, candidate));
    if (script.kind !== 'missing') {
      name = candidate;
      break;
    }
  }
  if (script.kind === 'missing') return;
  if (script.kind === 'big') {
    out.warn(`${name} maior que 1 MB; ignorado.`);
    return;
  }
  const program = await buildToolProgram(deps, folder, 'gradlew', 'gradle', out);
  const tasks = ['build', 'test'];
  if (GRADLE_APPLICATION.test(script.text)) tasks.push('run');
  if (GRADLE_SPRING_BOOT.test(script.text)) tasks.push('bootRun');
  for (const task of tasks) {
    out.add({
      source: 'gradle',
      tool: 'gradle',
      key: task,
      label: `Gradle: ${task}`,
      program,
      args: [task],
    });
  }
}

async function detectCompose(deps: DetectDeps, folder: string, out: Collector): Promise<void> {
  const p = pathModule(deps.platform.os);
  let found = false;
  for (const name of COMPOSE_FILES) {
    if (await isFile(deps.fs, p.join(folder, name))) {
      found = true;
      break;
    }
  }
  if (!found) return;
  const modern = await checkProgram('docker', deps.platform, deps.fs);
  const legacy = modern.available ? null : await checkProgram('docker-compose', deps.platform, deps.fs);
  const useLegacy = legacy?.available === true;
  for (const [key, label] of [
    ['up', 'subir'],
    ['down', 'derrubar'],
  ] as const) {
    out.add({
      source: 'compose',
      tool: 'compose',
      key,
      label: `Compose: ${label}`,
      program: useLegacy ? 'docker-compose' : 'docker',
      args: useLegacy ? [key] : ['compose', key],
    });
  }
}

/** Configurações e avisos de uma pasta: lê só os arquivos de projeto conhecidos, até 1 MB cada. */
export async function detectFolder(deps: DetectDeps, groupId: string, folder: string): Promise<RunCatalog> {
  const out = new Collector(groupId, folder);
  await detectPackageJson(deps, folder, out);
  await detectMaven(deps, folder, out);
  await detectGradle(deps, folder, out);
  await detectCompose(deps, folder, out);
  const programs = [...new Set(out.drafts.map((d) => d.program))];
  const checks = new Map(
    await Promise.all(
      programs.map(
        async (program) => [program, await checkProgram(program, deps.platform, deps.fs)] as const,
      ),
    ),
  );
  const commands: RunCommand[] = out.drafts.map((d) => {
    const check = checks.get(d.program) ?? { available: false, searched: d.program };
    return {
      id: commandId(groupId, folder, d, deps.platform.os),
      groupId,
      source: d.source,
      tool: d.tool,
      label: d.label,
      program: d.program,
      args: d.args,
      folder,
      available: check.available,
      unavailableReason: check.available ? null : 'not-found',
      searched: check.searched,
    };
  });
  return { commands, warnings: out.warnings };
}

/** Detecta várias pastas em paralelo; a ordem do resultado segue a de `targets`. */
export async function detectFolders(deps: DetectDeps, targets: readonly DetectTarget[]): Promise<RunCatalog> {
  const results = await Promise.all(targets.map((t) => detectFolder(deps, t.groupId, t.folder)));
  return {
    commands: results.flatMap((r) => r.commands),
    warnings: results.flatMap((r) => r.warnings),
  };
}
