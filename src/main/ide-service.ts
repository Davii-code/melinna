import { realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LanguageService } from '../core/ide/language-service';
import { DebugService } from '../core/ide/debug-service';
import { ProtocolClient } from '../core/ide/protocol-client';
import { isInsideRoot } from '../core/files/tree';
import type { FilesService } from '../core/files/files-service';
import type { Clock } from '../core/ports/clock';
import type { ProtocolProcessFactory } from '../core/ports/protocol-process';
import { MelinnaError } from '../core/errors';
import {
  DAP_METHODS,
  IDE_LIMITS,
  LSP_METHODS,
  object,
  toolString,
  ideInvalid,
  parseToolCall,
  parseToolStart,
  type IdeEvent,
  type ToolCall,
  type ToolStart,
} from '../shared/ide-types';

interface Session {
  root: string;
  input: ToolStart;
  language?: LanguageService;
  debug?: DebugService;
  client: ProtocolClient;
}
export interface IdeServiceDeps {
  files: Pick<FilesService, 'roots'>;
  factory: ProtocolProcessFactory;
  clock: Clock;
  emit(event: IdeEvent): void;
}
const os = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
function integer(value: unknown, max = 1_000_000): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) return ideInvalid();
  return value as number;
}
function localUri(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:' || url.search || url.hash) return ideInvalid();
    return fileURLToPath(url);
  } catch {
    return ideInvalid('URI de arquivo inválida.');
  }
}
export class IdeService {
  private readonly sessions = new Map<string, Session>();
  private starting = 0;
  private disposed = false;
  constructor(private readonly deps: IdeServiceDeps) {}
  async canonical(raw: string, root?: string): Promise<string> {
    if (raw.split(/[\\/]/).some((part) => part.toLowerCase() === '.git'))
      throw new MelinnaError('FILE_OUTSIDE_ROOT');
    let path: string;
    try {
      path = await realpath(raw);
    } catch {
      throw new MelinnaError('FILE_UNREADABLE');
    }
    if (path.split(/[\\/]/).some((part) => part.toLowerCase() === '.git'))
      throw new MelinnaError('FILE_OUTSIDE_ROOT');
    const allowed = await Promise.all(
      this.deps.files
        .roots()
        .filter((r) => r.available !== false)
        .map(async (r) => {
          try {
            return await realpath(r.path);
          } catch {
            return null;
          }
        }),
    );
    if (!allowed.some((r) => r && isInsideRoot(r, path, os)) || (root && !isInsideRoot(root, path, os)))
      throw new MelinnaError('FILE_OUTSIDE_ROOT');
    return path;
  }
  async start(raw: ToolStart): Promise<{ sessionId: string; capabilities: Record<string, unknown> }> {
    const input = parseToolStart(raw);
    if (this.disposed) return ideInvalid('As ferramentas estão sendo encerradas.');
    if (this.sessions.size + this.starting >= IDE_LIMITS.sessions) throw new MelinnaError('LIMIT_REACHED');
    this.starting++;
    let id: string | null = null;
    try {
      const root = await this.canonical(input.root);
      if (!(await stat(root)).isDirectory()) return ideInvalid('Escolha uma pasta para a ferramenta.');
      const child = await this.deps.factory.start({ ...input, root });
      if (this.disposed) {
        child.close();
        return ideInvalid('As ferramentas foram encerradas.');
      }
      id = randomUUID();
      const sessionId = id;
      const client = new ProtocolClient(
        input.protocol,
        child,
        this.deps.clock,
        (message) => {
          const entry = this.sessions.get(sessionId);
          if (entry?.debug)
            void entry.debug.event(message).catch(() => {
              this.deps.emit({
                sessionId,
                protocol: 'dap',
                message: { kind: 'error', message: 'Falha ao configurar a depuração.' },
              });
              this.stop(sessionId);
            });
          if (message.kind === 'closed') this.sessions.delete(sessionId);
          void this.validateResponse(message, root)
            .then(() => this.deps.emit({ sessionId, protocol: input.protocol, message }))
            .catch(() => undefined);
        },
        (method, params) => {
          if (method === 'workspace/workspaceFolders')
            return [{ uri: pathToFileURL(root).href, name: 'Workspace' }];
          if (method === 'workspace/configuration') {
            const items = object(params).items;
            if (Array.isArray(items) && items.length <= 100) return items.map(() => null);
          }
          if (method === 'workspace/applyEdit')
            return { applied: false, failureReason: 'Use a prévia de alterações do Melinna.' };
          return ideInvalid();
        },
      );
      const session: Session = {
        root,
        input,
        client,
        ...(input.protocol === 'lsp'
          ? { language: new LanguageService(client) }
          : { debug: new DebugService(client) }),
      };
      this.sessions.set(id, session);
      const capabilities = session.language
        ? await session.language.initialize(pathToFileURL(root).href)
        : await session.debug!.initialize();
      return { sessionId: id, capabilities };
    } catch (error) {
      if (id) this.stop(id);
      throw error;
    } finally {
      this.starting--;
    }
  }
  async call(raw: ToolCall, notify = false): Promise<unknown> {
    const call = parseToolCall(raw, notify);
    const session = this.sessions.get(call.sessionId);
    if (!session) return ideInvalid('Sessão da ferramenta não encontrada.');
    await this.canonical(session.root);
    const p = call.params;
    if (session.language) {
      if (!notify && !LSP_METHODS.has(call.method)) return ideInvalid();
      if (p.textDocument) {
        const document = object(p.textDocument);
        const uri = toolString(document.uri);
        await this.canonical(localUri(uri), session.root);
        if (document.version !== undefined) integer(document.version);
        if (call.method.endsWith('didOpen')) {
          toolString(document.languageId, 64);
          if (typeof document.text !== 'string' || document.text.length > IDE_LIMITS.text)
            return ideInvalid();
        }
      } else if (
        call.method !== 'workspace/symbol' &&
        call.method !== 'codeAction/resolve' &&
        call.method !== 'completionItem/resolve'
      )
        return ideInvalid();
      if (p.position) {
        const position = object(p.position);
        integer(position.line);
        integer(position.character);
      }
      if (call.method.endsWith('/rename')) toolString(p.newName, 256);
      if (call.method === 'workspace/symbol' && (typeof p.query !== 'string' || p.query.length > 512))
        return ideInvalid();
      if (call.method.endsWith('/references') && typeof object(p.context).includeDeclaration !== 'boolean')
        return ideInvalid();
      if (p.range) {
        const range = object(p.range);
        for (const point of [object(range.start), object(range.end)]) {
          integer(point.line);
          integer(point.character);
        }
      }
      if (notify) {
        session.language.notify(call.method, p);
        return undefined;
      }
      const result = await session.language.request(call.method, p);
      await this.validateResponse(result, session.root);
      return result;
    }
    if (notify || !DAP_METHODS.has(call.method)) return ideInvalid();
    if (call.method === 'setBreakpoints') {
      const source = object(p.source);
      await this.canonical(toolString(source.path), session.root);
      if (!Array.isArray(p.breakpoints) || p.breakpoints.length > 1000) return ideInvalid();
      for (const breakpoint of p.breakpoints) if (integer(object(breakpoint).line) < 1) return ideInvalid();
    }
    const keys: Record<string, string> = {
      stackTrace: 'threadId',
      scopes: 'frameId',
      variables: 'variablesReference',
      continue: 'threadId',
      pause: 'threadId',
      next: 'threadId',
      stepIn: 'threadId',
      stepOut: 'threadId',
    };
    if (keys[call.method]) integer(p[keys[call.method]!]);
    if (p.start !== undefined) integer(p.start);
    if (p.count !== undefined) integer(p.count, 500);
    if (p.levels !== undefined) integer(p.levels, 100);
    if (p.startFrame !== undefined) integer(p.startFrame);
    if ((call.method === 'launch' || call.method === 'attach') && JSON.stringify(p).length > 65536)
      return ideInvalid();
    if ((call.method === 'launch' || call.method === 'attach') && p.cwd !== undefined)
      await this.canonical(toolString(p.cwd), session.root);
    const result = await session.debug!.request(call.method, p);
    await this.validateResponse(result, session.root);
    return result;
  }
  private async validateResponse(value: unknown, root: string, depth = 0): Promise<void> {
    if (depth > 24) return ideInvalid('Resposta da ferramenta muito profunda.');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (value.length > 10000) return ideInvalid();
      for (const item of value) await this.validateResponse(item, root, depth + 1);
      return;
    }
    const v = value as Record<string, unknown>;
    for (const key of ['uri', 'targetUri'])
      if (typeof v[key] === 'string') {
        await this.canonical(localUri(v[key]), root);
      }
    if (
      v.source &&
      typeof v.source === 'object' &&
      typeof (v.source as Record<string, unknown>).path === 'string'
    ) {
      const source = v.source as Record<string, unknown>;
      try {
        await this.canonical(source.path as string, root);
      } catch {
        delete source.path;
        source.presentationHint = 'deemphasize';
      }
    }
    for (const [key, item] of Object.entries(v)) {
      if (key === 'changes' && item && typeof item === 'object')
        for (const uri of Object.keys(item)) await this.canonical(localUri(uri), root);
      await this.validateResponse(item, root, depth + 1);
    }
  }
  stop(id: string): void {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    session?.client.close();
  }
  close(): void {
    this.disposed = true;
    for (const id of this.sessions.keys()) this.stop(id);
  }
}
