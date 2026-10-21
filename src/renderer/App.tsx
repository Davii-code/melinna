import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentDefinition,
  CloseChoice,
  CatalogIssue,
  DetectResult,
  Execution,
  LaunchResult,
  MelinnaApi,
  Result,
  ResultError,
  WorkspaceSnapshot,
} from '../shared/ipc-contract';
import { ApiContext } from './api';
import { Grid } from './components/Grid/Grid';
import { CatalogView } from './components/CatalogView';
import { CloseDialog } from './components/CloseDialog';
import { DiffView } from './components/DiffView/DiffView';
import { FileExplorer } from './components/Files/FileExplorer';
import { Home } from './components/Home/Home';
import { NewTaskDialog } from './components/NewTaskDialog';
import { Panel } from './components/Panel/Panel';
import { ScrollbackBanner } from './components/Panel/ScrollbackBanner';
import { RemoveExecutionDialog } from './components/RemoveExecutionDialog';
import { ResidueDialog } from './components/ResidueDialog';
import { Tree, type TreeActions } from './components/Tree/Tree';
import { LayoutSwitcher } from './components/LayoutSwitcher';
import { ModelSelect } from './components/ModelSelect';
import { PermissionSelect } from './components/PermissionSelect';
import { TerminalDepsContext, type TerminalDeps, type TerminalHandle } from './components/TerminalView';
import { TopBar } from './components/TopBar';
import { useLayout, type LayoutStore } from './store/layout-store';
import { useWorkspace, type WorkspaceStore } from './store/workspace-store';

export const DEFAULT_TERM_SIZE = { cols: 100, rows: 30 };

export interface AppProps {
  api: MelinnaApi;
  terminal: TerminalDeps;
  workspaceStore: WorkspaceStore;
  layoutStore: LayoutStore;
}

export interface CatalogState {
  agents: AgentDefinition[];
  invalid: CatalogIssue[];
  detect: Record<string, DetectResult>;
}

export function useCatalog(api: MelinnaApi): [CatalogState, () => Promise<void>] {
  const [state, setState] = useState<CatalogState>({ agents: [], invalid: [], detect: {} });
  const reload = useCallback(async () => {
    const [list, detect] = await Promise.all([api.catalog.list(), api.catalog.detectAll()]);
    setState({
      agents: list.ok ? list.value.agents : [],
      invalid: list.ok ? list.value.invalid : [],
      detect: detect.ok ? detect.value : {},
    });
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return [state, reload];
}

function FailureBanner({ execution }: { execution: Execution }) {
  if (!execution.failure || (execution.status !== 'failed_to_start' && execution.status !== 'lost'))
    return null;
  return (
    <div className="panel-banner error" role="status">
      {execution.failure.message}
    </div>
  );
}

const DIVERGENCE_REFRESH_MS = 60_000;

/** Commits que a base avançou, por execução; atualiza ao mudar a lista e a cada minuto. */
export function useDivergence(api: MelinnaApi, execIds: readonly string[]): ReadonlyMap<string, number> {
  const [map, setMap] = useState<ReadonlyMap<string, number>>(new Map());
  const key = execIds.join(',');
  useEffect(() => {
    let alive = true;
    const ids = key ? key.split(',') : [];
    const refresh = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          const r = await api.executions.divergence(id);
          return [id, r.ok ? r.value.baseAdvancedBy : 0] as const;
        }),
      );
      if (alive) setMap(new Map(entries));
    };
    void refresh();
    const timer = setInterval(() => void refresh(), DIVERGENCE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, key]);
  return map;
}

export function App({ api, terminal, workspaceStore, layoutStore }: AppProps) {
  const snapshot = useWorkspace(workspaceStore);
  const layout = useLayout(layoutStore);
  const [catalog, reloadCatalog] = useCatalog(api);
  const [showNewTask, setShowNewTask] = useState(false);
  const [closeAsk, setCloseAsk] = useState<{ liveCount: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [residue, setResidue] = useState<{ path: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showHome, setShowHome] = useState(false);
  const [sidebarView, setSidebarView] = useState<'workspaces' | 'files'>('workspaces');

  useEffect(() => api.app.onCloseRequested((info) => setCloseAsk(info)), [api]);
  const answerClose = useCallback(
    (choice: CloseChoice) => {
      setCloseAsk(null);
      void layoutStore.flush().then(() => api.app.answerClose(choice));
    },
    [api, layoutStore],
  );

  useEffect(() => {
    void workspaceStore.start();
    void layoutStore.load();
    return () => workspaceStore.stop();
  }, [workspaceStore, layoutStore]);

  useEffect(() => {
    if (snapshot) layoutStore.prune(new Set(snapshot.executions.map((e) => e.id)));
  }, [snapshot, layoutStore]);

  const agentsById = useMemo(() => new Map(catalog.agents.map((a) => [a.id, a])), [catalog.agents]);
  const execById = useMemo(() => new Map((snapshot?.executions ?? []).map((e) => [e.id, e])), [snapshot]);
  const openIds = layout.openExecutionIds.filter((id) => execById.has(id));
  const preparedIds = useMemo(
    () => (snapshot?.executions ?? []).filter((e) => e.branch !== '').map((e) => e.id),
    [snapshot],
  );
  const divergence = useDivergence(api, preparedIds);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const terminalHandles = useRef(new Map<string, TerminalHandle>());
  const refitVisible = useCallback((visible: string[]) => {
    for (const id of visible) terminalHandles.current.get(id)?.refit();
  }, []);
  const cycleFocus = useCallback((step: 1 | -1) => layoutStore.cycleFocus(step), [layoutStore]);

  const showError = useCallback((err: ResultError) => {
    const residuePath = err.details?.residuePath;
    if (err.code === 'WORKTREE_RESIDUE' && typeof residuePath === 'string') {
      setResidue({ path: residuePath, message: err.message });
    } else {
      setNotice(err.message);
    }
  }, []);

  const onLaunched = (_taskId: string, results: LaunchResult[]) => {
    setShowNewTask(false);
    setShowHome(false);
    for (const r of results) if (r.execId) layoutStore.open(r.execId);
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) showError(failed.error);
  };

  const run = useCallback(
    async (p: Promise<Result<unknown>>) => {
      const r = await p;
      if (!r.ok) showError(r.error);
      return r.ok;
    },
    [showError],
  );

  const treeActions: TreeActions = {
    onOpen: (id) => {
      setShowHome(false);
      layoutStore.open(id);
    },
    onStop: (id) => void run(api.executions.stop(id)),
    onRelaunch: (id) => {
      layoutStore.open(id);
      void run(api.executions.relaunch(id, DEFAULT_TERM_SIZE));
    },
    onRemove: (id) => setRemoving(id),
    onRenameGroup: (id, name) => void run(api.workspace.renameGroup(id, name)),
    onRenameTask: (id, title) => void run(api.workspace.renameTask(id, title)),
  };
  const removingExec = removing ? execById.get(removing) : undefined;
  const diffExec = diffFor ? execById.get(diffFor) : undefined;

  const openWorkspaceFromSidebar = async () => {
    const picked = await api.workspace.pickRepository();
    if (!picked.ok) return showError(picked.error);
    if (picked.value) await run(api.workspace.openWorkspace(picked.value));
  };

  const renderPanel = (id: string) => {
    const exec = execById.get(id);
    if (!exec) return null;
    return (
      <Panel
        execution={exec}
        agent={agentsById.get(exec.agentId)}
        onTerminalReady={(h) => {
          if (h) terminalHandles.current.set(id, h);
          else terminalHandles.current.delete(id);
        }}
        onHeaderDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
        }}
        visible
        focused={layout.focusedExecutionId === id}
        onClose={() => layoutStore.close(id)}
        onFocus={() => layoutStore.focus(id)}
        baseAdvancedBy={divergence.get(id) ?? 0}
        headerExtras={
          <>
            <ModelSelect execution={exec} agent={agentsById.get(exec.agentId)} />
            <PermissionSelect execution={exec} agent={agentsById.get(exec.agentId)} />
          </>
        }
        actions={
          exec.branch !== '' && (
            <button
              type="button"
              className="icon-button"
              title="Ver o que este agente mudou"
              aria-label="Ver diff"
              onClick={() => setDiffFor(id)}
            >
              ±
            </button>
          )
        }
        banner={
          <>
            <FailureBanner execution={exec} />
            <ScrollbackBanner
              reason={snapshot?.scrollbackPaused.find((p) => p.execId === id)?.reason ?? null}
            />
          </>
        }
      />
    );
  };

  return (
    <ApiContext.Provider value={api}>
      <TerminalDepsContext.Provider value={terminal}>
        <div className="app">
          <TopBar
            freeSlots={snapshot ? snapshot.maxLive - snapshot.liveCount : 0}
            onNewTask={() => {
              void reloadCatalog();
              setShowNewTask(true);
            }}
          >
            <button
              type="button"
              aria-pressed={showHome || openIds.length === 0}
              onClick={() => setShowHome((v) => !v)}
              disabled={openIds.length === 0}
            >
              Início
            </button>
            <LayoutSwitcher
              mode={layout.mode}
              onChange={(m) => layoutStore.setMode(m)}
              onCycleFocus={cycleFocus}
            />
            <button
              type="button"
              onClick={() => {
                void reloadCatalog();
                setShowCatalog(true);
              }}
            >
              Catálogo
            </button>
          </TopBar>
          {notice && (
            <div className="panel-banner error app-notice" role="alert">
              <span>{notice}</span>
              <button type="button" className="icon-button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
          <div className="body">
            {snapshot && (
              <aside className="sidebar">
                <div className="sidebar-header">
                  <div className="sidebar-views" role="tablist" aria-label="Visão da barra lateral">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={sidebarView === 'workspaces'}
                      onClick={() => setSidebarView('workspaces')}
                    >
                      Workspaces
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={sidebarView === 'files'}
                      onClick={() => setSidebarView('files')}
                    >
                      Arquivos
                    </button>
                  </div>
                  <span className="spacer" />
                  {sidebarView === 'workspaces' ? (
                    <button
                      type="button"
                      className="icon-button"
                      title="Abrir uma pasta como workspace"
                      aria-label="Abrir workspace"
                      onClick={() => void openWorkspaceFromSidebar()}
                    >
                      ＋
                    </button>
                  ) : null}
                </div>
                {sidebarView === 'files' ? (
                  <FileExplorer onShowWorkspaces={() => setSidebarView('workspaces')} />
                ) : (
                  <Tree
                    groups={snapshot.groups}
                    tasks={snapshot.tasks}
                    executions={snapshot.executions}
                    agents={agentsById}
                    openIds={openIds}
                    divergence={divergence}
                    {...treeActions}
                  />
                )}
              </aside>
            )}
            <main className="workspace">
              {snapshot && (openIds.length === 0 || showHome) ? (
                <Home
                  snapshot={snapshot as WorkspaceSnapshot}
                  agents={catalog.agents}
                  detect={catalog.detect}
                  size={DEFAULT_TERM_SIZE}
                  onLaunched={onLaunched}
                />
              ) : snapshot ? (
                <Grid
                  ids={openIds}
                  renderPanel={renderPanel}
                  observeResize={terminal.observeResize}
                  mode={layout.mode}
                  focusedId={layout.focusedExecutionId}
                  custom={layout.custom}
                  onRelayout={refitVisible}
                  onCustomChange={(g) => layoutStore.setCustom(g)}
                  onReorder={(from, to) => layoutStore.reorder(from, to)}
                />
              ) : (
                <div className="loading">Carregando…</div>
              )}
            </main>
          </div>
          {closeAsk && <CloseDialog liveCount={closeAsk.liveCount} onAnswer={answerClose} />}
          {removingExec && (
            <RemoveExecutionDialog
              execution={removingExec}
              agentName={agentsById.get(removingExec.agentId)?.displayName ?? removingExec.agentId}
              onDone={() => setRemoving(null)}
              onCancel={() => setRemoving(null)}
            />
          )}
          {diffExec && (
            <DiffView
              execId={diffExec.id}
              title={agentsById.get(diffExec.agentId)?.displayName ?? diffExec.agentId}
              onClose={() => setDiffFor(null)}
            />
          )}
          {showCatalog && (
            <CatalogView
              agents={catalog.agents}
              detect={catalog.detect}
              invalid={catalog.invalid}
              onReload={() => void reloadCatalog()}
              onClose={() => setShowCatalog(false)}
            />
          )}
          {residue && (
            <ResidueDialog
              residuePath={residue.path}
              message={residue.message}
              onDone={() => setResidue(null)}
              onCancel={() => setResidue(null)}
            />
          )}
          {showNewTask && snapshot && (
            <NewTaskDialog
              snapshot={snapshot as WorkspaceSnapshot}
              agents={catalog.agents}
              detect={catalog.detect}
              size={DEFAULT_TERM_SIZE}
              onClose={() => setShowNewTask(false)}
              onLaunched={onLaunched}
            />
          )}
        </div>
      </TerminalDepsContext.Provider>
    </ApiContext.Provider>
  );
}
