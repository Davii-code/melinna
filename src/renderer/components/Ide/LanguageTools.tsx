import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FileRoot } from '../../../shared/ipc-contract';
import { fileUri, uriPath } from '../../../shared/ide-paths';
import { useApi, unwrap } from '../../api';
import { useDrafts, type EditorSession } from '../Editor/editor-session';
import {
  editorContext,
  setCompletionProvider,
  setHoverProvider,
  setIdeDiagnostics,
  type EditorContext,
  type IdeDiagnostic,
} from './editor-tools';
import { prepareWorkspaceEdit, type Position } from './workspace-edits';
import { ToolLaunch, toolError, withinRoot, type ToolSession } from './ToolLaunch';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  const v = record(value);
  return typeof v.value === 'string' ? v.value : '';
}
function language(path: string): string {
  const ext = path.split('.').at(-1);
  return (
    (
      {
        ts: 'typescript',
        tsx: 'typescriptreact',
        js: 'javascript',
        jsx: 'javascriptreact',
        java: 'java',
        json: 'json',
        css: 'css',
        html: 'html',
      } as Record<string, string>
    )[ext ?? ''] ?? 'plaintext'
  );
}
function completionEdit(item: Record<string, unknown>, context: EditorContext): unknown {
  if (item.insertTextFormat === 2)
    throw new Error('Esta sugestão exige snippets não negociados pelo cliente.');
  const edit = record(item.textEdit);
  const insert = typeof item.insertText === 'string' ? item.insertText : String(item.label ?? '');
  const prefix = context.text.slice(0, context.offset).match(/[\w$]*$/)?.[0] ?? '';
  const replacement = Object.keys(edit).length
    ? { range: edit.range ?? edit.replace ?? edit.insert, newText: edit.newText }
    : {
        range: {
          start: { line: context.position.line, character: context.position.character - prefix.length },
          end: context.position,
        },
        newText: insert,
      };
  return { changes: { [fileUri(context.path)]: [replacement, ...list(item.additionalTextEdits)] } };
}
type Prepared = Awaited<ReturnType<typeof prepareWorkspaceEdit>>;

export function LanguageTools({
  roots,
  editor,
  onOpen,
}: {
  roots: readonly FileRoot[];
  editor: EditorSession;
  onOpen(path: string, position?: Position): void;
}) {
  const api = useApi();
  const drafts = useDrafts(editor);
  const [session, setSession] = useState<ToolSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    kind: string;
    value: unknown;
    context: EditorContext | null;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, IdeDiagnostic[]>>({});
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Prepared | null>(null);
  const docs = useRef(new Map<string, { text: string; version: number; dirty: boolean }>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const current = useRef(session);
  current.current = session;
  const sync = useCallback((): Promise<void> => {
    const selected = session;
    const work = chain.current
      .catch(() => undefined)
      .then(async () => {
        if (!selected || current.current?.id !== selected.id) return;
        const now = editor.drafts.snapshot();
        const seen = new Set<string>();
        for (const [path, draft] of Object.entries(now)) {
          if (!withinRoot(path, selected.root)) continue;
          const uri = fileUri(path);
          seen.add(uri);
          const previous = docs.current.get(uri);
          if (previous?.text === draft.text) {
            if (previous.dirty && !draft.dirty)
              await unwrap(
                api.ide.notify({
                  sessionId: selected.id,
                  method: 'textDocument/didSave',
                  params: { textDocument: { uri } },
                }),
              );
            docs.current.set(uri, { ...previous, dirty: draft.dirty });
            continue;
          }
          const version = (previous?.version ?? 0) + 1;
          const method = previous ? 'textDocument/didChange' : 'textDocument/didOpen';
          const params = previous
            ? { textDocument: { uri, version }, contentChanges: [{ text: draft.text }] }
            : { textDocument: { uri, version, languageId: language(path), text: draft.text } };
          docs.current.set(uri, { text: draft.text, version, dirty: draft.dirty });
          try {
            await unwrap(api.ide.notify({ sessionId: selected.id, method, params }));
          } catch (error) {
            if (current.current?.id === selected.id) {
              if (previous) docs.current.set(uri, previous);
              else docs.current.delete(uri);
            }
            throw error;
          }
          if (current.current?.id !== selected.id) return;
        }
        for (const uri of docs.current.keys())
          if (!seen.has(uri)) {
            await api.ide.notify({
              sessionId: selected.id,
              method: 'textDocument/didClose',
              params: { textDocument: { uri } },
            });
            docs.current.delete(uri);
          }
      });
    chain.current = work;
    return work;
  }, [api, editor, session]);
  useEffect(() => {
    docs.current.clear();
    setResult(null);
    setPreview(null);
    setDiagnostics((old) => {
      for (const path of Object.keys(old)) setIdeDiagnostics(path, []);
      return {};
    });
  }, [session?.id]);
  useEffect(() => {
    if (session) void sync().catch((error: unknown) => setError(toolError(error)));
  }, [drafts, session, sync]);
  useEffect(
    () =>
      api.ide.onEvent((event) => {
        if (event.sessionId !== session?.id || event.message.method !== 'textDocument/publishDiagnostics')
          return;
        const params = record(event.message.params);
        if (typeof params.uri !== 'string' || !Array.isArray(params.diagnostics)) return;
        const doc = docs.current.get(params.uri);
        if (!doc || (typeof params.version === 'number' && params.version !== doc.version)) return;
        try {
          const path = uriPath(params.uri);
          const values = params.diagnostics.filter((d): d is IdeDiagnostic =>
            Boolean(
              d &&
              typeof d === 'object' &&
              typeof (d as IdeDiagnostic).message === 'string' &&
              (d as IdeDiagnostic).range,
            ),
          );
          setIdeDiagnostics(path, values);
          setDiagnostics((old) => ({ ...old, [path]: values }));
        } catch {
          setError('O servidor enviou diagnósticos inválidos.');
        }
      }),
    [api, session],
  );
  const request = useCallback(
    async (method: string, params: Record<string, unknown>) => {
      if (!session) throw new Error('Configure e inicie um servidor de linguagem.');
      const uri = record(params.textDocument).uri;
      const path = typeof uri === 'string' ? uriPath(uri) : null;
      const text = path ? editor.drafts.snapshot()[path]?.text : null;
      await sync();
      if (path && editor.drafts.snapshot()[path]?.text !== text)
        throw new Error('O documento mudou. Repita a operação.');
      const response = await unwrap(api.ide.call({ sessionId: session.id, method, params }));
      if (current.current?.id !== session.id) throw new Error('A sessão de linguagem mudou.');
      if (path && editor.drafts.snapshot()[path]?.text !== text)
        throw new Error('O documento mudou enquanto o servidor respondia.');
      return response;
    },
    [api, session, sync, editor],
  );
  useEffect(
    () =>
      setHoverProvider(async (path, position) => {
        if (!session || !withinRoot(path, session.root) || !session.capabilities.hoverProvider) return null;
        const result = record(
          await request('textDocument/hover', { textDocument: { uri: fileUri(path) }, position }),
        );
        return textOf(result.contents);
      }),
    [session, request],
  );
  const prepare = useCallback(
    async (edit: unknown) => {
      const prepared = await prepareWorkspaceEdit(
        edit,
        editor.drafts,
        (path) => unwrap(api.files.read(path)),
        new Map([...docs.current].map(([uri, doc]) => [uri, doc.version])),
      );
      setPreview(prepared);
    },
    [api, editor],
  );
  useEffect(() => {
    if (!session) return;
    return setCompletionProvider(async (context) => {
      if (!withinRoot(context.path, session.root)) return [];
      const response = await request('textDocument/completion', {
        textDocument: { uri: fileUri(context.path) },
        position: context.position,
      });
      return list(Array.isArray(response) ? response : record(response).items)
        .slice(0, 100)
        .map((item) => ({
          label: String(item.label ?? 'Sugestão'),
          async apply() {
            try {
              const resolved =
                item.data && record(session.capabilities.completionProvider).resolveProvider
                  ? record(await request('completionItem/resolve', item))
                  : item;
              if (editor.drafts.snapshot()[context.path]?.text !== context.text)
                throw new Error('O documento mudou. Solicite sugestões novamente.');
              const prepared = await prepareWorkspaceEdit(
                completionEdit(resolved, context),
                editor.drafts,
                (path) => unwrap(api.files.read(path)),
                new Map([...docs.current].map(([uri, doc]) => [uri, doc.version])),
              );
              if (list(resolved.additionalTextEdits).length || prepared.files.length > 1) {
                setPreview(prepared);
                window.dispatchEvent(new Event('melinna-ide-show-language'));
              } else await prepared.apply();
            } catch (error) {
              setError(toolError(error));
              window.dispatchEvent(new Event('melinna-ide-show-language'));
            }
          },
        }));
    });
  }, [session, request, editor, api]);
  const run = useCallback(
    async (kind: string) => {
      if (busy) return;
      setBusy(true);
      setError('');
      setPreview(null);
      try {
        const context = editorContext();
        if (kind !== 'workspaceSymbol' && (!context || !session || !withinRoot(context.path, session.root)))
          throw new Error('Foque um arquivo da pasta conectada ao servidor.');
        const document = context
          ? { textDocument: { uri: fileUri(context.path) }, position: context.position }
          : {};
        const params: Record<string, unknown> =
          kind === 'workspaceSymbol'
            ? { query }
            : kind === 'references'
              ? { ...document, context: { includeDeclaration: true } }
              : kind === 'rename'
                ? { ...document, newName }
                : kind === 'codeAction'
                  ? {
                      textDocument: document.textDocument,
                      range: { start: context!.position, end: context!.position },
                      context: { diagnostics: diagnostics[context!.path] ?? [] },
                    }
                  : document;
        if (kind === 'rename' && !newName.trim()) throw new Error('Informe o novo nome do símbolo.');
        const value = await request(
          kind === 'workspaceSymbol' ? 'workspace/symbol' : `textDocument/${kind}`,
          params,
        );
        if (kind === 'rename') await prepare(value);
        else setResult({ kind, value, context });
      } catch (error) {
        setError(toolError(error));
      } finally {
        setBusy(false);
      }
    },
    [busy, session, query, newName, diagnostics, request, prepare],
  );
  const action = useRef(run);
  action.current = run;
  useEffect(() => {
    const listener = (event: Event) => {
      void action.current(String((event as CustomEvent).detail));
    };
    window.addEventListener('melinna-ide-action', listener);
    return () => window.removeEventListener('melinna-ide-action', listener);
  }, []);
  const values =
    result?.kind === 'completion'
      ? list(Array.isArray(result.value) ? result.value : record(result.value).items)
      : list(result?.value);
  const applyCompletion = async (item: Record<string, unknown>) => {
    try {
      const resolved =
        item.data && record(session?.capabilities.completionProvider).resolveProvider
          ? record(await request('completionItem/resolve', item))
          : item;
      const context = result?.context;
      if (!context || editor.drafts.snapshot()[context.path]?.text !== context.text)
        throw new Error('O documento mudou. Solicite sugestões novamente.');
      await prepare(completionEdit(resolved, context));
    } catch (error) {
      setError(toolError(error));
    }
  };
  const renderLocation = (item: Record<string, unknown>, index: number): ReactNode => {
    const location = record(item.location);
    const uri =
      item.uri ?? item.targetUri ?? location.uri ?? (result?.context ? fileUri(result.context.path) : null);
    const range = record(item.range ?? item.targetSelectionRange ?? location.range);
    const start = record(range.start);
    return (
      <li key={index}>
        <button
          className="ide-result-button"
          type="button"
          onClick={() => {
            try {
              if (typeof uri === 'string')
                onOpen(uriPath(uri), {
                  line: Number(start.line ?? 0),
                  character: Number(start.character ?? 0),
                });
            } catch (error) {
              setError(toolError(error));
            }
          }}
        >
          {String(item.name ?? item.containerName ?? uri ?? 'Localização')}:{Number(start.line ?? 0) + 1}
        </button>
        {Array.isArray(item.children) && <ul>{list(item.children).map(renderLocation)}</ul>}
      </li>
    );
  };
  return (
    <div>
      <ToolLaunch protocol="lsp" roots={roots} onSession={setSession} onError={setError} />
      <div className="ide-row">
        {[
          ['completion', 'Sugestões'],
          ['hover', 'Documentação'],
          ['definition', 'Definição'],
          ['references', 'Referências'],
          ['documentSymbol', 'Símbolos do arquivo'],
          ['codeAction', 'Ações de código'],
        ].map(([kind, label]) => (
          <button key={kind} disabled={!session || busy} onClick={() => void run(kind!)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ide-row">
        <label>
          Novo nome
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={256} />
        </label>
        <button disabled={!session || busy} onClick={() => void run('rename')}>
          Renomear símbolo
        </button>
        <label>
          Buscar símbolo
          <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={512} />
        </label>
        <button disabled={!session || busy} onClick={() => void run('workspaceSymbol')}>
          Buscar símbolos
        </button>
      </div>
      {error && (
        <p className="ide-error" role="alert">
          {error}
        </p>
      )}
      {!session && (
        <p className="ide-empty">
          Conecte um servidor LSP para a pasta. TypeScript/JavaScript e Java usam servidores instalados por
          você; Ctrl+Espaço solicita sugestões e F12 abre a definição.
        </p>
      )}
      <section aria-label="Problemas" className="ide-diagnostics">
        <h3>Problemas</h3>
        {Object.values(diagnostics).every((d) => !d.length) && (
          <p className="ide-status">Nenhum diagnóstico recebido.</p>
        )}
        <ul>
          {Object.entries(diagnostics).flatMap(([path, values]) =>
            values.map((d, index) => (
              <li key={`${path}:${index}`}>
                <button className="ide-result-button" onClick={() => onOpen(path, d.range.start)}>
                  {path}:{d.range.start.line + 1} — {d.message}
                </button>
              </li>
            )),
          )}
        </ul>
      </section>
      {result?.kind === 'hover' && (
        <pre className="ide-preview">
          {textOf(record(result.value).contents) || 'Nenhuma documentação disponível.'}
        </pre>
      )}
      {result?.kind === 'completion' && (
        <ul>
          {values.slice(0, 200).map((item, index) => (
            <li key={index}>
              <button className="ide-result-button" onClick={() => void applyCompletion(item)}>
                {String(item.label ?? 'Sugestão')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result?.kind === 'codeAction' && (
        <ul>
          {values.map((item, index) => (
            <li key={index}>
              <button
                disabled={!item.edit && !item.data}
                title={
                  !item.edit && !item.data
                    ? 'Ações que executam comandos do servidor não são permitidas.'
                    : undefined
                }
                onClick={() =>
                  void (async () => {
                    try {
                      const action = item.edit ? item : record(await request('codeAction/resolve', item));
                      if (!action.edit)
                        throw new Error(
                          'Esta ação não possui alterações de texto e requer comando não permitido.',
                        );
                      await prepare(action.edit);
                    } catch (error) {
                      setError(toolError(error));
                    }
                  })()
                }
              >
                {String(item.title ?? 'Ação')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && ['definition', 'references', 'documentSymbol', 'workspaceSymbol'].includes(result.kind) && (
        <ul>{(Array.isArray(result.value) ? values : [record(result.value)]).map(renderLocation)}</ul>
      )}
      {preview && (
        <section aria-label="Prévia da alteração">
          <h3>Alteração em {preview.files.length} arquivo(s)</h3>
          {preview.files.map((file) => (
            <details key={file.path}>
              <summary>{file.path}</summary>
              <p>Antes</p>
              <pre className="ide-preview">{file.before}</pre>
              <p>Depois</p>
              <pre className="ide-preview">{file.after}</pre>
            </details>
          ))}
          <div className="ide-row">
            <button
              onClick={() =>
                void preview
                  .apply()
                  .then(() => {
                    for (const file of preview.files) onOpen(file.path);
                    setPreview(null);
                  })
                  .catch((error: unknown) => setError(toolError(error)))
              }
            >
              Aplicar aos rascunhos
            </button>
            <button onClick={() => setPreview(null)}>Cancelar alteração</button>
          </div>
          <p className="ide-status">Os arquivos só serão gravados quando você salvar no editor.</p>
        </section>
      )}
    </div>
  );
}
