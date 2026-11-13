import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileRoot, RunConfigView } from '../../../shared/ipc-contract';
import { useApi, unwrap } from '../../api';
import { editorContext, setIdeBreakpoints } from './editor-tools';
import {
  debugEvent,
  EMPTY_DEBUG_STATE,
  readBreakpoints,
  writeBreakpoints,
  type DebugState,
} from './debug-state';
import { ToolLaunch, toolError, withinRoot, type ToolSession } from './ToolLaunch';
import type { Position } from './workspace-edits';

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const records = (value: unknown) => (Array.isArray(value) ? value.map(rec) : []);
export function DebugTools({
  roots,
  onOpen,
  onRun,
}: {
  roots: readonly FileRoot[];
  onOpen(path: string, position?: Position): void;
  onRun(groupId: string, configId: string): void;
}) {
  const api = useApi();
  const [session, setSession] = useState<ToolSession | null>(null);
  const [state, setState] = useState<DebugState>({ ...EMPTY_DEBUG_STATE });
  const [config, setConfig] = useState('{}');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<Record<string, unknown>[]>([]);
  const [points, setPoints] = useState<Record<string, number[]>>({});
  const [runs, setRuns] = useState<RunConfigView[]>([]);
  const root = session?.root ?? roots.find((r) => r.available !== false)?.path ?? '';
  const current = useRef(session);
  current.current = session;
  const epoch = useRef(0);
  const call = useCallback(
    async (method: string, params: Record<string, unknown>) => {
      if (!session) throw new Error('Inicie um adaptador de depuração.');
      return unwrap(api.ide.call({ sessionId: session.id, method, params }));
    },
    [api, session],
  );
  useEffect(() => {
    setPoints(readBreakpoints(localStorage, root));
    setState({ ...EMPTY_DEBUG_STATE });
    setThreads([]);
  }, [root, session?.id]);
  useEffect(() => {
    for (const [path, lines] of Object.entries(points)) setIdeBreakpoints(path, lines);
    return () => {
      for (const path of Object.keys(points)) setIdeBreakpoints(path, []);
    };
  }, [points]);
  useEffect(() => {
    if (session)
      for (const [path, lines] of Object.entries(points))
        void call('setBreakpoints', { source: { path }, breakpoints: lines.map((line) => ({ line })) }).catch(
          (error: unknown) => setError(toolError(error)),
        );
  }, [points, session, call]);
  const stack = useCallback(
    async (threadId: number) => {
      const version = epoch.current;
      const response = rec(await call('stackTrace', { threadId, startFrame: 0, levels: 100 }));
      setState((old) =>
        old.stopped && epoch.current === version
          ? { ...old, threadId, frames: records(response.stackFrames), scopes: [], variables: [] }
          : old,
      );
    },
    [call],
  );
  useEffect(
    () =>
      api.ide.onEvent((event) => {
        if (event.sessionId !== session?.id) return;
        if (
          ['stopped', 'continued', 'terminated', 'exited'].includes(String(event.message.event)) ||
          event.message.kind === 'closed'
        )
          epoch.current++;
        setState((old) => {
          const next = debugEvent(old, event.message);
          return event.message.event === 'continued'
            ? {
                ...next,
                threadId:
                  typeof rec(event.message.body).threadId === 'number'
                    ? (rec(event.message.body).threadId as number)
                    : old.threadId,
              }
            : next;
        });
        if (event.message.kind === 'error') setError(String(event.message.message));
        if (event.message.event === 'stopped')
          void (async () => {
            const version = epoch.current;
            const response = rec(await call('threads', {}));
            if (current.current?.id !== event.sessionId || epoch.current !== version) return;
            const values = records(response.threads);
            setThreads(values);
            const threadId = rec(event.message.body).threadId ?? values[0]?.id;
            if (typeof threadId === 'number') await stack(threadId);
          })().catch((error: unknown) => setError(toolError(error)));
      }),
    [api, session, call, stack],
  );
  const toggle = useCallback(
    (path: string, line: number) => {
      if (!root || !withinRoot(path, root)) {
        setError('Escolha um arquivo da pasta de depuração.');
        return;
      }
      setPoints((old) => {
        const lines = old[path] ?? [];
        const next = {
          ...old,
          [path]: lines.includes(line)
            ? lines.filter((value) => value !== line)
            : [...lines, line].sort((a, b) => a - b),
        };
        writeBreakpoints(localStorage, root, next);
        if (session && next[path]?.length === 0)
          void call('setBreakpoints', { source: { path }, breakpoints: [] }).catch((error: unknown) =>
            setError(toolError(error)),
          );
        return next;
      });
    },
    [root, session, call],
  );
  const inspect = async (method: 'scopes' | 'variables', params: Record<string, unknown>) => {
    const version = epoch.current;
    const response = rec(await call(method, params));
    setState((old) =>
      old.stopped && version === epoch.current
        ? { ...old, [method]: records(response[method]), ...(method === 'scopes' ? { variables: [] } : {}) }
        : old,
    );
  };
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; line: number }>).detail;
      toggle(detail.path, detail.line);
    };
    window.addEventListener('melinna-ide-breakpoint', listener);
    return () => window.removeEventListener('melinna-ide-breakpoint', listener);
  }, [toggle]);
  const execute = async (method: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (method === 'launch' || method === 'attach') {
        const parsed: unknown = JSON.parse(config);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          throw new Error('Configuração DAP deve ser um objeto JSON.');
        await call(method, { cwd: root, ...(parsed as Record<string, unknown>) });
        const response = rec(await call('threads', {}));
        const values = records(response.threads);
        setThreads(values);
        setState((old) => ({
          ...old,
          threadId: old.threadId ?? (typeof values[0]?.id === 'number' ? values[0].id : null),
        }));
      } else if (method === 'disconnect') {
        try {
          await call(method, { terminateDebuggee: true });
        } finally {
          epoch.current++;
          if (session) await api.ide.stop(session.id);
          setState({ ...EMPTY_DEBUG_STATE });
        }
      } else {
        if (state.threadId === null) throw new Error('Selecione uma thread.');
        await call(method, { threadId: state.threadId });
        if (method !== 'pause') setState({ ...EMPTY_DEBUG_STATE, threadId: state.threadId });
      }
    } catch (error) {
      setError(toolError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <ToolLaunch protocol="dap" roots={roots} onSession={setSession} onError={setError} />
      <label>
        Configuração launch/attach JSON
        <textarea rows={4} value={config} onChange={(e) => setConfig(e.target.value)} maxLength={65536} />
      </label>
      <div className="ide-row">
        {[
          ['launch', 'Iniciar depuração'],
          ['attach', 'Anexar depuração'],
          ['continue', 'Continuar'],
          ['pause', 'Pausar'],
          ['next', 'Próxima linha'],
          ['stepIn', 'Entrar'],
          ['stepOut', 'Sair'],
          ['disconnect', 'Parar depuração'],
        ].map(([method, label]) => (
          <button
            key={method}
            disabled={
              !session ||
              busy ||
              (['continue', 'next', 'stepIn', 'stepOut'].includes(method!) && !state.stopped)
            }
            onClick={() => void execute(method!)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="ide-error" role="alert">
          {error}
        </p>
      )}
      <p className="ide-status">
        {state.stopped ? 'Execução suspensa' : 'Aguardando pausa ou breakpoint'}. Configure um adaptador DAP
        instalado por você. O payload launch/attach depende desse adaptador e não é persistido.
      </p>
      <section aria-label="Breakpoints">
        <h3>Breakpoints</h3>
        <button
          onClick={() => {
            const context = editorContext();
            if (context) toggle(context.path, context.position.line + 1);
            else setError('Foque um arquivo no editor.');
          }}
        >
          Alternar breakpoint na linha do cursor
        </button>
        <ul>
          {Object.entries(points).flatMap(([path, lines]) =>
            lines.map((line) => (
              <li key={`${path}:${line}`}>
                <button onClick={() => onOpen(path, { line: line - 1, character: 0 })}>
                  {path}:{line}
                </button>
                <button aria-label={`Remover breakpoint ${path}:${line}`} onClick={() => toggle(path, line)}>
                  Remover
                </button>
              </li>
            )),
          )}
        </ul>
      </section>
      <section aria-label="Threads e pilha">
        <h3>Threads e pilha</h3>
        <div className="ide-row">
          {threads.map((thread) => (
            <button
              key={String(thread.id)}
              disabled={!state.stopped}
              onClick={() =>
                void stack(Number(thread.id)).catch((error: unknown) => setError(toolError(error)))
              }
            >
              {String(thread.name ?? thread.id)}
            </button>
          ))}
        </div>
        <ul>
          {state.frames.map((frame) => (
            <li key={String(frame.id)}>
              <button
                className="ide-result-button"
                onClick={() => {
                  const source = rec(frame.source);
                  if (typeof source.path === 'string')
                    onOpen(source.path, {
                      line: Math.max(0, Number(frame.line) - 1),
                      character: Math.max(0, Number(frame.column) - 1),
                    });
                  void inspect('scopes', { frameId: frame.id }).catch((error: unknown) =>
                    setError(toolError(error)),
                  );
                }}
              >
                {String(frame.name)} — {String(frame.line)}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Escopos e variáveis">
        <h3>Escopos e variáveis</h3>
        <div className="ide-row">
          {state.scopes.map((scope) => (
            <button
              key={String(scope.variablesReference)}
              onClick={() =>
                void inspect('variables', {
                  variablesReference: scope.variablesReference,
                  start: 0,
                  count: 500,
                }).catch((error: unknown) => setError(toolError(error)))
              }
            >
              {String(scope.name)}
            </button>
          ))}
        </div>
        <ul>
          {state.variables.map((variable, i) => (
            <li key={i}>
              <span>
                {String(variable.name)} = {String(variable.value)}
              </span>
              {Number(variable.variablesReference) > 0 && (
                <button
                  onClick={() =>
                    void inspect('variables', {
                      variablesReference: variable.variablesReference,
                      start: 0,
                      count: 500,
                    }).catch((error: unknown) => setError(toolError(error)))
                  }
                >
                  Expandir {String(variable.name)}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <details>
        <summary>Configurações de execução do Melinna</summary>
        <p className="ide-status">
          Use uma configuração existente para iniciar o projeto com sua porta de debug; depois use Anexar com
          o adaptador correspondente.
        </p>
        <button
          onClick={() =>
            void unwrap(api.run.list())
              .then((listing) => setRuns(listing.configs.filter((config) => withinRoot(config.folder, root))))
              .catch((error: unknown) => setError(toolError(error)))
          }
        >
          Carregar configurações de execução
        </button>
        <ul>
          {runs.map((config) => (
            <li key={config.id}>
              <button disabled={!config.available} onClick={() => onRun(config.groupId, config.id)}>
                Executar {config.name}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
