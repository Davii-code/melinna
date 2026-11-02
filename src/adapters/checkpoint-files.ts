import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CheckpointFiles } from '../core/workflow/ports';
import type { ReviewChange, SnapshotFile, SnapshotFolder, SnapshotManifest } from '../core/workflow/types';
import type { FileDiff } from '../core/api-types';
import { parseUnifiedDiff } from '../core/git/diff-parse';
import { workflowError } from '../core/workflow/validation';

const MAX_FILES = 20000,
  MAX_BYTES = 100 * 1024 * 1024,
  MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXCLUDED = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  'dist',
  'build',
  'out',
  '.idea',
  '.vscode',
]);
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function git(cwd: string, args: string[]): Promise<{ text: string; code: number }> {
  return new Promise((resolveResult, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k, v]) => !k.startsWith('GIT_') && typeof v === 'string'),
    );
    execFile(
      'git',
      args,
      { cwd, env, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        const code = error ? Number((error as NodeJS.ErrnoException & { code?: string | number }).code) : 0;
        if (error && !Number.isFinite(code)) reject(error);
        else resolveResult({ text: String(stdout), code });
      },
    );
  });
}
export class ContentCheckpointFiles implements CheckpointFiles {
  constructor(private readonly dataRoot: string) {}
  private key(root: string): string {
    const value = resolve(root);
    return process.platform === 'win32' ? value.toLowerCase() : value;
  }
  overlaps(a: string, b: string): boolean {
    const x = this.key(a),
      y = this.key(b);
    return x === y || x.startsWith(y + sep) || y.startsWith(x + sep);
  }
  private path(root: string, path: string): string {
    if (
      !path ||
      path.includes('\\') ||
      path.includes('\0') ||
      isAbsolute(path) ||
      path.split('/').some((x) => x === '..' || x === '.git' || x === '')
    )
      workflowError('Caminho inseguro no checkpoint.');
    const target = resolve(root, path),
      rel = relative(resolve(root), target);
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
      workflowError('Arquivo fora da pasta do checkpoint.');
    return target;
  }
  private async safePath(root: string, path: string): Promise<string> {
    const absolute = this.path(root, path);
    let current = root;
    const pieces = path.split('/');
    for (const part of pieces) {
      current = join(current, part);
      const st = await lstat(current).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      });
      if (st?.isSymbolicLink())
        workflowError('Links simbólicos não podem ser capturados ou restaurados: ' + path);
    }
    return absolute;
  }
  private blob(hashValue: string): string {
    if (!/^[a-f0-9]{64}$/.test(hashValue)) workflowError('Hash de checkpoint inválido.');
    return join(this.dataRoot, 'blobs', hashValue.slice(0, 2), hashValue);
  }
  private async names(root: string): Promise<string[]> {
    let result: { text: string; code: number } | null = null;
    try {
      result = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    } catch {
      /* Folders without Git still support checkpoints. */
    }
    // Untracked nested repositories come back as "dir/"; they are separate projects, not files to capture.
    if (result?.code === 0)
      return [...new Set(result.text.split('\0').filter((name) => name && !name.endsWith('/')))].sort();
    const names: string[] = [];
    const walk = async (folder: string, prefix: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (EXCLUDED.has(entry.name)) continue;
        const path = prefix ? prefix + '/' + entry.name : entry.name;
        const entryStat = await lstat(join(folder, entry.name));
        if (entryStat.isSymbolicLink())
          workflowError('Checkpoint não inclui links simbólicos. Remova o link do escopo: ' + path);
        if (entry.isDirectory()) await walk(join(folder, entry.name), path);
        else if (entry.isFile()) names.push(path);
        if (names.length > MAX_FILES)
          workflowError('Checkpoint excede 20 mil arquivos. Use uma pasta de projeto menor.');
      }
    };
    await walk(root, '');
    return names.sort();
  }
  private async scan(roots: string[], store: boolean): Promise<SnapshotManifest> {
    await mkdir(this.dataRoot, { recursive: true });
    const privateRoot = await realpath(this.dataRoot);
    const folders: SnapshotFolder[] = [];
    let total = 0,
      count = 0;
    const unique: string[] = [];
    let unavailable = 0;
    for (const [index, requested] of roots.entries()) {
      let root: string;
      try {
        root = await realpath(requested);
      } catch (err) {
        if (index > 0 && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          unavailable++;
          continue;
        }
        throw err;
      }
      if (this.overlaps(root, privateRoot))
        workflowError('A pasta de dados do Melinna não pode integrar um checkpoint.');
      if (
        !unique.some(
          (existing) =>
            this.key(root) === this.key(existing) || this.key(root).startsWith(this.key(existing) + sep),
        )
      ) {
        for (let i = unique.length - 1; i >= 0; i--) {
          const existing = unique[i];
          if (existing && this.key(existing).startsWith(this.key(root) + sep)) unique.splice(i, 1);
        }
        unique.push(root);
      }
    }
    for (const root of unique) {
      const files: SnapshotFile[] = [];
      for (const path of await this.names(root)) {
        const absolute = await this.safePath(root, path);
        const st = await lstat(absolute).catch((err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        });
        if (!st) continue;
        if (!st.isFile()) workflowError('Checkpoint não suporta submódulos ou arquivos especiais: ' + path);
        total += st.size;
        count++;
        if (count > MAX_FILES || total > MAX_BYTES || st.size > MAX_FILE_BYTES)
          workflowError(
            'Checkpoint excede os limites: 20 mil arquivos, 100 MB totais e 25 MB por arquivo. Escolha uma pasta menor ou desative o checkpoint automático nesta tarefa.',
          );
        const bytes = await readFile(absolute);
        const after = await lstat(absolute);
        if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.isSymbolicLink())
          workflowError('Arquivos mudaram durante o checkpoint. Tente novamente após interromper a escrita.');
        const digest = hash(bytes);
        if (store) {
          const blob = this.blob(digest);
          await mkdir(dirname(blob), { recursive: true });
          await writeFile(blob, bytes, { flag: 'wx', mode: 0o600 }).catch((err) => {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
          });
        }
        files.push({ path, hash: digest, bytes: bytes.length, mode: st.mode & 0o777 });
      }
      folders.push({ root, files });
    }
    return {
      folders,
      fingerprint: hash(JSON.stringify(folders.map((f) => ({ root: this.key(f.root), files: f.files })))),
      scope:
        'Git: arquivos versionados e não ignorados. Sem Git: arquivos regulares, exceto pastas de dependências/build e configurações do editor. Repositórios Git aninhados não rastreados ficam de fora. Inclui as pastas extras disponíveis da tarefa; arquivos ignorados não são restaurados.' +
        (unavailable
          ? ' Revisão parcial: ' + unavailable + ' pasta(s) extra(s) indisponível(is) foram omitidas.'
          : ''),
    };
  }
  async capture(roots: string[]): Promise<SnapshotManifest> {
    const captured = await this.scan(roots, true);
    const confirmed = await this.scan(roots, false);
    if (captured.fingerprint !== confirmed.fingerprint)
      workflowError('Os arquivos mudaram durante a captura. Interrompa a escrita e tente novamente.');
    return captured;
  }
  inspect(roots: string[]): Promise<SnapshotManifest> {
    return this.scan(roots, false);
  }
  compare(before: SnapshotManifest, after: SnapshotManifest): ReviewChange[] {
    const changes: ReviewChange[] = [];
    for (const oldFolder of before.folders) {
      const current = after.folders.find((f) => this.key(f.root) === this.key(oldFolder.root));
      if (!current) workflowError('Uma pasta do checkpoint não está mais disponível.');
      const oldFiles = new Map(oldFolder.files.map((f) => [f.path, f]));
      const newFiles = new Map(current.files.map((f) => [f.path, f]));
      for (const path of [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()) {
        const a = oldFiles.get(path),
          b = newFiles.get(path);
        if (a?.hash === b?.hash && a?.mode === b?.mode) continue;
        changes.push({
          root: oldFolder.root,
          path,
          change: !a ? 'added' : !b ? 'deleted' : 'modified',
          beforeHash: a?.hash ?? null,
          afterHash: b?.hash ?? null,
          beforeBytes: a?.bytes ?? 0,
          afterBytes: b?.bytes ?? 0,
        });
      }
    }
    return changes;
  }
  async diff(change: ReviewChange): Promise<FileDiff> {
    const old = change.beforeHash ? await readFile(this.blob(change.beforeHash)) : Buffer.alloc(0);
    const currentPath = await this.safePath(change.root, change.path);
    const current = change.afterHash ? await readFile(currentPath) : Buffer.alloc(0);
    if (change.afterHash && hash(current) !== change.afterHash)
      workflowError('O arquivo mudou. Atualize a revisão.');
    const base: FileDiff = { path: change.path, change: change.change, hunks: [], lineCount: 0 };
    if (old.includes(0) || current.includes(0))
      return { ...base, binary: { oldSize: change.beforeBytes, newSize: change.afterBytes } };
    if (old.length + current.length > 512 * 1024) return { ...base, tooLarge: true };
    const beforeFile = join(this.dataRoot, 'diff-' + randomUUID() + '-before');
    const afterFile = join(this.dataRoot, 'diff-' + randomUUID() + '-after');
    try {
      await mkdir(this.dataRoot, { recursive: true });
      await writeFile(beforeFile, old, { mode: 0o600 });
      await writeFile(afterFile, current, { mode: 0o600 });
      const result = await git(this.dataRoot, [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-color',
        '--unified=3',
        '--',
        beforeFile,
        afterFile,
      ]);
      if (result.code > 1) workflowError('Não foi possível calcular o diff.');
      const file = parseUnifiedDiff(result.text)[0];
      return file ? { ...file, path: change.path, change: change.change } : base;
    } finally {
      await unlink(beforeFile).catch(() => undefined);
      await unlink(afterFile).catch(() => undefined);
    }
  }
  private async bytes(entry: SnapshotFile): Promise<Buffer> {
    const bytes = await readFile(this.blob(entry.hash));
    if (hash(bytes) !== entry.hash)
      workflowError('Conteúdo do checkpoint está corrompido. Nenhum arquivo foi restaurado.');
    return bytes;
  }
  private async write(root: string, path: string, entry: SnapshotFile | undefined): Promise<void> {
    const target = await this.safePath(root, path);
    if (!entry) {
      await unlink(target).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      });
      return;
    }
    const bytes = await this.bytes(entry);
    await mkdir(dirname(target), { recursive: true });
    await this.safePath(root, path);
    const temp = join(dirname(target), '.melinna-restore-' + randomUUID());
    try {
      await writeFile(temp, bytes, { flag: 'wx', mode: entry.mode });
      await rename(temp, target);
      if (process.platform !== 'win32') await chmod(target, entry.mode);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
  async restore(target: SnapshotManifest, expected: SnapshotManifest): Promise<void> {
    const actual = await this.inspect(expected.folders.map((f) => f.root));
    if (actual.fingerprint !== expected.fingerprint)
      workflowError('Os arquivos mudaram desde a prévia. Gere uma nova prévia.');
    const changes = this.compare(target, actual);
    // Verify every blob and path before the first write.
    for (const folder of target.folders)
      for (const entry of folder.files) {
        await this.safePath(folder.root, entry.path);
        await this.bytes(entry);
      }
    const applied: {
      root: string;
      path: string;
      previous: SnapshotFile | undefined;
      next: SnapshotFile | undefined;
    }[] = [];
    try {
      for (const change of changes) {
        const folder = target.folders.find((f) => this.key(f.root) === this.key(change.root));
        const prior = expected.folders.find((f) => this.key(f.root) === this.key(change.root));
        const previous = prior?.files.find((f) => f.path === change.path),
          next = folder?.files.find((f) => f.path === change.path);
        const current = await readFile(await this.safePath(change.root, change.path)).catch((err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw err;
        });
        if ((current ? hash(current) : null) !== (previous?.hash ?? null))
          workflowError('Arquivo alterado por outro processo: ' + change.path);
        await this.write(change.root, change.path, next);
        applied.push({ root: change.root, path: change.path, previous, next });
      }
    } catch (error) {
      for (const item of applied.reverse()) {
        const current = await readFile(await this.safePath(item.root, item.path)).catch(() => null);
        if ((current ? hash(current) : null) === (item.next?.hash ?? null))
          await this.write(item.root, item.path, item.previous).catch(() => undefined);
      }
      throw error;
    }
  }
}
