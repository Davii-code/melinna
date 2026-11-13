import { LSP_METHODS, LSP_NOTIFICATIONS, object, ideInvalid } from '../../shared/ide-types';
import { MelinnaError } from '../errors';
import type { ProtocolClient } from './protocol-client';

interface Document {
  text: string;
  version: number;
}
const PROVIDERS: Record<string, string> = {
  'textDocument/completion': 'completionProvider',
  'textDocument/hover': 'hoverProvider',
  'textDocument/definition': 'definitionProvider',
  'textDocument/references': 'referencesProvider',
  'textDocument/documentSymbol': 'documentSymbolProvider',
  'workspace/symbol': 'workspaceSymbolProvider',
  'textDocument/rename': 'renameProvider',
  'textDocument/codeAction': 'codeActionProvider',
  'codeAction/resolve': 'codeActionProvider',
  'completionItem/resolve': 'completionProvider',
};
export class LanguageService {
  private capabilities: Record<string, unknown> = {};
  private readonly documents = new Map<string, Document>();
  constructor(private readonly client: Pick<ProtocolClient, 'request' | 'notify' | 'close'>) {}
  async initialize(rootUri: string): Promise<Record<string, unknown>> {
    const result = object(
      await this.client.request('initialize', {
        processId: null,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'Workspace' }],
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          textDocument: {
            synchronization: { dynamicRegistration: false },
            completion: { completionItem: { snippetSupport: false } },
            publishDiagnostics: { versionSupport: true },
          },
          workspace: { applyEdit: false, workspaceEdit: { documentChanges: true } },
        },
      }),
    );
    this.capabilities = object(result.capabilities);
    if (this.capabilities.positionEncoding && this.capabilities.positionEncoding !== 'utf-16')
      throw new MelinnaError('IO_ERROR', { userMessage: 'O servidor não negociou posições UTF-16.' });
    this.client.notify('initialized', {});
    return this.capabilities;
  }
  notify(method: string, params: Record<string, unknown>): void {
    if (!LSP_NOTIFICATIONS.has(method)) return ideInvalid();
    const doc = object(params.textDocument);
    const uri = String(doc.uri);
    const previous = this.documents.get(uri);
    const sync = this.capabilities.textDocumentSync;
    const syncOptions = typeof sync === 'object' && sync !== null ? (sync as Record<string, unknown>) : null;
    const mode = typeof sync === 'number' ? sync : syncOptions?.change;
    if (method.endsWith('didOpen')) {
      if (previous || typeof doc.text !== 'string' || !Number.isInteger(doc.version)) return ideInvalid();
      this.documents.set(uri, { text: doc.text, version: doc.version as number });
      if (mode || syncOptions?.openClose) this.client.notify(method, params);
    } else if (method.endsWith('didChange')) {
      const changes = params.contentChanges;
      if (
        !previous ||
        !Number.isInteger(doc.version) ||
        (doc.version as number) <= previous.version ||
        !Array.isArray(changes) ||
        changes.length !== 1
      )
        return ideInvalid();
      const text = object(changes[0]).text;
      if (typeof text !== 'string') return ideInvalid();
      this.documents.set(uri, { text, version: doc.version as number });
      const lines = previous.text.split('\n');
      const contentChanges =
        mode === 2
          ? [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: lines.length - 1, character: lines.at(-1)!.length },
                },
                text,
              },
            ]
          : [{ text }];
      if (mode === 1 || mode === 2) this.client.notify(method, { textDocument: doc, contentChanges });
    } else if (method.endsWith('didClose')) {
      this.documents.delete(uri);
      if (mode || syncOptions?.openClose) this.client.notify(method, params);
    } else {
      if (!previous) return ideInvalid();
      if (syncOptions?.save)
        this.client.notify(method, {
          textDocument: { uri },
          ...(typeof syncOptions.save === 'object' &&
          (syncOptions.save as Record<string, unknown>).includeText
            ? { text: previous.text }
            : {}),
        });
    }
  }
  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!LSP_METHODS.has(method) || !this.capabilities[PROVIDERS[method]!])
      return ideInvalid('O servidor não oferece este recurso.');
    if (method === 'codeAction/resolve' && !object(this.capabilities.codeActionProvider).resolveProvider)
      return ideInvalid('O servidor não resolve ações de código.');
    if (method === 'completionItem/resolve' && !object(this.capabilities.completionProvider).resolveProvider)
      return ideInvalid('O servidor não resolve sugestões de código.');
    const uri = params.textDocument ? String(object(params.textDocument).uri) : null;
    const before = uri ? this.documents.get(uri) : null;
    if (uri && !before) return ideInvalid('Abra o documento no serviço de linguagem.');
    if (before) {
      const validate = (raw: unknown) => {
        const position = object(raw);
        const lines = before.text.split('\n');
        if (
          !Number.isInteger(position.line) ||
          !Number.isInteger(position.character) ||
          (position.line as number) < 0 ||
          (position.line as number) >= lines.length ||
          (position.character as number) < 0 ||
          (position.character as number) > lines[position.line as number]!.replace(/\r$/, '').length
        )
          return ideInvalid('Posição fora do documento.');
      };
      if (
        [
          'textDocument/completion',
          'textDocument/hover',
          'textDocument/definition',
          'textDocument/references',
          'textDocument/rename',
        ].includes(method)
      )
        validate(params.position);
      if (method === 'textDocument/codeAction') {
        const range = object(params.range);
        validate(range.start);
        validate(range.end);
        const a = object(range.start),
          b = object(range.end);
        if (
          (a.line as number) > (b.line as number) ||
          (a.line === b.line && (a.character as number) > (b.character as number))
        )
          return ideInvalid();
      }
    }
    const result = await this.client.request(method, params);
    if (uri && this.documents.get(uri) !== before)
      throw new MelinnaError('FILE_CONFLICT', {
        userMessage: 'O documento mudou enquanto o servidor respondia. Repita a operação.',
      });
    return result;
  }
  close(): void {
    this.documents.clear();
    this.client.close();
  }
}
