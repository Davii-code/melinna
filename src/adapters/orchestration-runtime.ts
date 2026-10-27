import { spawn } from 'node:child_process';
import { mkdir, realpath, stat, writeFile, unlink } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { OrchestrationRuntime, TurnRequest, TurnOutput } from '../core/orchestration/ports';
import type { Access, Provider, Usage } from '../core/orchestration/types';
import type { CatalogService } from '../core/catalog/catalog-service';
import { resolveLauncher } from '../core/catalog/detect';
import type { FileSystem } from '../core/ports/file-system';
import type { Platform } from '../core/ports/platform';
import { MelinnaError } from '../core/errors';

interface RuntimeDeps {
  catalog: CatalogService;
  fs: FileSystem;
  platform: Platform;
  root: string;
  env: Record<string, string>;
}
function fail(message: string): never {
  throw new MelinnaError('INPUT_INVALID', { userMessage: message });
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Structured processes use pipes; the existing PTY host is intentionally unchanged. */
export class CliOrchestrationRuntime implements OrchestrationRuntime {
  constructor(private readonly deps: RuntimeDeps) {}
  private async launcher(provider: Provider) {
    return resolveLauncher(await this.deps.catalog.agent(provider), this.deps.platform, this.deps.fs);
  }
  private process(
    file: string,
    args: string[],
    cwd: string,
    options: {
      input?: string;
      env?: Record<string, string>;
      signal?: AbortSignal;
      timeoutMs?: number;
      line?: (line: string) => void;
    } = {},
  ): Promise<string> {
    return new Promise((resolveResult, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('Execução interrompida.'));
        return;
      }
      const childEnv = Object.fromEntries(
        Object.entries(this.deps.env).filter(
          ([key]) => !key.startsWith('GIT_') && key !== 'MELINNA_ORCHESTRATION_TOKEN' && key !== 'CLAUDECODE',
        ),
      );
      Object.assign(childEnv, options.env);
      const child = spawn(file, args, {
        cwd,
        env: childEnv,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        stderr = '',
        pending = '',
        failure: Error | undefined;
      let finished = false;
      const terminate = () => {
        if (finished || !child.pid) return;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            shell: false,
            stdio: 'ignore',
          });
          killer.on('error', () => {
            child.kill();
          });
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
      };
      const abort = () => {
        failure = new Error('Execução interrompida.');
        terminate();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        failure = new Error('Tempo limite da sessão atingido.');
        terminate();
      }, options.timeoutMs ?? 30000);
      const cleanup = () => {
        finished = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (output.length + chunk.length > 16 * 1024 * 1024) {
          failure = new Error('A saída da sessão excedeu o limite de 16 MB.');
          terminate();
          return;
        }
        output += chunk;
        if (options.line) {
          pending += chunk;
          let index: number;
          while ((index = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, index).replace(/\r$/, '');
            pending = pending.slice(index + 1);
            try {
              options.line(line);
            } catch (err) {
              failure = err instanceof Error ? err : new Error('Evento inválido.');
              terminate();
            }
          }
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-12000);
      });
      child.on('error', (err) => {
        cleanup();
        reject(err);
      });
      child.on('close', (code) => {
        cleanup();
        if (options.line && pending.trim() && !failure) {
          try {
            options.line(pending);
          } catch (err) {
            failure = err instanceof Error ? err : new Error('Evento inválido.');
          }
        }
        if (failure) reject(failure);
        else if (code !== 0)
          reject(new Error(stderr.trim() || 'O processo terminou com código ' + code + '.'));
        else resolveResult(output);
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input ?? '');
    });
  }
  async preflight(provider: Provider): Promise<{ version: string }> {
    const launcher = await this.launcher(provider);
    const version = await this.process(launcher.file, [...launcher.prefixArgs, '--version'], this.deps.root, {
      timeoutMs: 15000,
    });
    return { version: version.trim().slice(0, 200) };
  }
  async turn(request: TurnRequest): Promise<TurnOutput> {
    const { role, cwd, bridge } = request;
    const launcher = await this.launcher(role.provider);
    const args: string[] = [];
    const env: Record<string, string> = { MELINNA_ORCHESTRATION: '1' };
    if (bridge) env.MELINNA_ORCHESTRATION_TOKEN = bridge.token;
    if (role.provider === 'claude') {
      const tools = ['Read', 'Grep', 'Glob'];
      if (role.access === 'workspace-write') tools.push('Edit', 'Write');
      const allowed = [...tools];
      if (bridge)
        allowed.push(
          ...['delegate_task', 'get_task', 'collect_results', 'wait_tasks', 'cancel_task'].map(
            (name) => 'mcp__melinna__' + name,
          ),
        );
      args.push(
        '-p',
        '--verbose',
        '--output-format',
        'stream-json',
        '--permission-mode',
        'dontAsk',
        '--tools',
        tools.join(','),
        '--allowedTools',
        allowed.join(','),
        '--strict-mcp-config',
      );
      const config = {
        mcpServers: bridge
          ? {
              melinna: {
                type: 'http',
                url: bridge.url,
                headers: {
                  Authorization: 'Bearer ' + String.fromCharCode(36) + '{MELINNA_ORCHESTRATION_TOKEN}',
                },
              },
            }
          : {},
      };
      // Config is passed by environment expansion, not a token in process arguments.
      args.push('--mcp-config', JSON.stringify(config));
      if (role.model) args.push('--model', role.model);
      if (request.sessionId) args.push('--resume', request.sessionId);
    } else {
      args.push(
        'exec',
        '--skip-git-repo-check',
        '--json',
        '--color',
        'never',
        '--ignore-user-config',
        '--sandbox',
        role.access,
        '-c',
        'approval_policy="never"',
      );
      if (role.model) args.push('--model', role.model);
      if (bridge) {
        args.push(
          '-c',
          'mcp_servers.melinna.url=' + JSON.stringify(bridge.url),
          '-c',
          'mcp_servers.melinna.bearer_token_env_var="MELINNA_ORCHESTRATION_TOKEN"',
          '-c',
          'mcp_servers.melinna.required=true',
        );
        // Only these run-scoped Melinna tools are authorized when the user starts a team.
        // Keep the CLI sandbox and global approval policy unchanged.
        const managedTools = ['delegate_task', 'get_task', 'collect_results', 'wait_tasks', 'cancel_task'];
        args.push('-c', 'mcp_servers.melinna.enabled_tools=' + JSON.stringify(managedTools));
        for (const name of managedTools)
          args.push('-c', 'mcp_servers.melinna.tools.' + name + '.approval_mode="approve"');
      }
      if (request.sessionId) args.push('resume', request.sessionId);
      args.push('-');
    }
    let finalText = '',
      sessionId: string | undefined,
      usage: Usage | undefined;
    let completed = false,
      providerFailure: string | undefined;
    const chunks: string[] = [];
    const safe = (value: string) => (bridge ? value.replaceAll(bridge.token, '[redacted]') : value);
    await this.process(launcher.file, [...launcher.prefixArgs, ...args], cwd, {
      input: request.prompt,
      env,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      line: (line) => {
        if (!line.trim()) return;
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          throw new Error('O agente produziu saída fora do protocolo JSON.');
        }
        const event = record(raw);
        if (role.provider === 'claude') {
          if (typeof event.session_id === 'string' && sessionId !== event.session_id) {
            sessionId = event.session_id;
            request.onSession?.(sessionId);
          }
          if (event.type === 'assistant') {
            const content = record(event.message).content;
            if (Array.isArray(content))
              for (const rawBlock of content) {
                const block = record(rawBlock);
                if (block.type === 'text' && typeof block.text === 'string') {
                  chunks.push(block.text);
                  request.onEvent('text', safe(block.text));
                }
                if (block.type === 'tool_use')
                  request.onEvent('tool', safe(String(block.name ?? 'Ferramenta')));
              }
          }
          if (event.type === 'result') {
            completed = true;
            if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success'))
              providerFailure =
                typeof event.result === 'string' ? event.result : 'O agente encerrou o turno com erro.';
            if (typeof event.result === 'string') finalText = event.result;
            const u = record(event.usage);
            usage = {
              inputTokens:
                number(u.input_tokens) +
                number(u.cache_creation_input_tokens) +
                number(u.cache_read_input_tokens),
              outputTokens: number(u.output_tokens),
              cachedInputTokens: number(u.cache_read_input_tokens),
              ...(typeof event.total_cost_usd === 'number' ? { costUsd: event.total_cost_usd } : {}),
            };
            if (Array.isArray(event.permission_denials) && event.permission_denials.length)
              providerFailure =
                'Uma ou mais ferramentas foram negadas pela política de execução. Revise o papel e as permissões antes de repetir.';
          }
        } else {
          if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
            sessionId = event.thread_id;
            request.onSession?.(sessionId);
          }
          if (event.type === 'item.completed') {
            const item = record(event.item);
            if (item.type === 'mcp_tool_call' && item.error) {
              const error = String(record(item.error).message ?? item.error);
              request.onEvent('error', safe(error));
              if (/approv|permiss|reject/i.test(error))
                providerFailure = 'A chamada MCP foi recusada: ' + error;
            }
            if (item.type === 'agent_message' && typeof item.text === 'string') {
              finalText = item.text;
              request.onEvent('text', safe(item.text));
            } else if (item.type)
              request.onEvent(
                'tool',
                safe(
                  String(item.type) +
                    (typeof item.command === 'string' ? ': ' + item.command.slice(0, 1000) : ''),
                ),
              );
          }
          if (event.type === 'turn.completed') {
            completed = true;
            const u = record(event.usage);
            usage = {
              inputTokens: number(u.input_tokens),
              outputTokens: number(u.output_tokens),
              cachedInputTokens: number(u.cached_input_tokens),
            };
          }
          if (event.type === 'turn.failed' || event.type === 'error')
            providerFailure = String(record(event.error).message ?? event.message ?? 'Falha no turno Codex.');
        }
      },
    }).catch((err) => {
      throw new Error(safe(err instanceof Error ? err.message : 'Falha na sessão.'));
    });
    if (providerFailure) throw new Error(safe(providerFailure));
    if (!completed) throw new Error('A sessão terminou sem evento final válido.');
    finalText ||= chunks.join('\n');
    if (!finalText.trim()) throw new Error('O agente não devolveu uma resposta final.');
    return {
      text: safe(finalText.slice(0, 200000)),
      ...(sessionId ? { sessionId } : {}),
      ...(usage ? { usage } : {}),
    };
  }
  private git(cwd: string, args: string[], options: { input?: string; env?: Record<string, string> } = {}) {
    return this.process(
      'git',
      ['-c', 'core.hooksPath=' + join(this.deps.root, 'disabled-hooks'), ...args],
      cwd,
      { ...options, timeoutMs: 60000 },
    );
  }
  async baseline(cwd: string): Promise<string | undefined> {
    if (!(await stat(cwd)).isDirectory()) fail('A pasta do workspace não está disponível.');
    let top: string;
    try {
      top = (await this.git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    } catch {
      return undefined;
    }
    const root = await realpath(top),
      folder = await realpath(cwd);
    const same = process.platform === 'win32' ? root.toLowerCase() === folder.toLowerCase() : root === folder;
    if (!same) fail('Para orquestrar este repositório, abra sua pasta raiz como workspace.');
    return (await this.git(cwd, ['rev-parse', 'HEAD'])).trim();
  }
  async prepare(
    runId: string,
    jobId: string,
    cwd: string,
    access: Access,
    baseCommit?: string,
  ): Promise<{ cwd: string; baseCommit?: string; branch?: string }> {
    const base = baseCommit;
    if (!base) {
      if (access === 'workspace-write')
        fail('Trabalhadores de escrita exigem um repositório Git com commit base.');
      if (!(await stat(cwd)).isDirectory()) fail('A pasta do workspace não está disponível.');
      return { cwd };
    }
    if (!/^[a-f0-9]{40,64}$/.test(base)) fail('Commit base inválido.');
    const destination = join(this.deps.root, 'worktrees', runId, jobId);
    await mkdir(join(this.deps.root, 'worktrees', runId), { recursive: true });
    const branch = 'melinna-team/' + runId + '/' + jobId;
    await this.git(cwd, ['worktree', 'add', '-b', branch, destination, base]);
    return { cwd: destination, branch, baseCommit: base };
  }
  private assertOwned(path: string): void {
    const rel = relative(resolve(this.deps.root, 'worktrees'), resolve(path));
    if (
      !rel ||
      rel === '..' ||
      rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
      isAbsolute(rel)
    )
      fail('Worktree fora da área gerenciada.');
  }
  async patch(jobCwd: string, baseCommit: string): Promise<string> {
    this.assertOwned(jobCwd);
    if (!/^[a-f0-9]{40,64}$/.test(baseCommit)) fail('Commit base inválido.');
    const index = join(this.deps.root, 'patch-index-' + randomUUID());
    const env = { GIT_INDEX_FILE: index };
    try {
      await this.git(jobCwd, ['read-tree', baseCommit], { env });
      await this.git(jobCwd, ['add', '-A', '--', '.'], { env });
      const raw = await this.git(jobCwd, ['diff', '--cached', '--raw', '--no-renames', baseCommit], { env });
      if (raw.split('\n').some((line) => /^:\d+ 120000 /.test(line)))
        fail('Patches que criam links simbólicos não podem ser integrados automaticamente.');
      return await this.git(
        jobCwd,
        ['diff', '--cached', '--binary', '--no-ext-diff', '--no-renames', baseCommit, '--'],
        { env },
      );
    } finally {
      await unlink(index).catch(() => undefined);
      await unlink(index + '.lock').catch(() => undefined);
    }
  }
  private async fingerprint(cwd: string): Promise<string> {
    const index = join(this.deps.root, 'fingerprint-' + randomUUID());
    const env = { GIT_INDEX_FILE: index };
    try {
      const status = await this.git(cwd, ['status', '--porcelain=v1', '-z']);
      await this.git(cwd, ['read-tree', 'HEAD'], { env });
      await this.git(cwd, ['add', '-A', '--', '.'], { env });
      const diff = await this.git(cwd, ['diff', '--cached', '--binary', '--no-ext-diff', 'HEAD', '--'], {
        env,
      });
      return createHash('sha256').update(status).update(diff).digest('hex');
    } finally {
      await unlink(index).catch(() => undefined);
      await unlink(index + '.lock').catch(() => undefined);
    }
  }
  async apply(cwd: string, patch: string, expectedFingerprint?: string): Promise<string> {
    if (patch.length > 8 * 1024 * 1024) fail('O patch excede o limite de 8 MB.');
    const dirty = (await this.git(cwd, ['status', '--porcelain'])).trim().length > 0;
    if (dirty && (!expectedFingerprint || expectedFingerprint !== (await this.fingerprint(cwd))))
      fail(
        'O workspace tem alterações locais fora dos patches desta equipe. Faça commit ou stash antes de integrar.',
      );
    if (
      /^\+(?:\+\+ )?[^\n]*[\u0000\u001b]/m.test(patch) ||
      /^(?:new file mode|new mode) 120000$/m.test(patch)
    )
      fail('Patch não suportado.');
    const file = join(this.deps.root, 'apply-' + randomUUID() + '.patch');
    try {
      await writeFile(file, patch, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await this.git(cwd, ['apply', '--check', '--whitespace=nowarn', file]);
      await this.git(cwd, ['apply', '--whitespace=nowarn', file]);
      return await this.fingerprint(cwd);
    } finally {
      await unlink(file).catch(() => undefined);
    }
  }
}
