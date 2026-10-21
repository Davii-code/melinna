import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentDefinition,
  CloseChoice,
  CatalogIssue,
  DetectResult,
  Execution,
  FileRoot,
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
import { EditorPane } from './components/Editor/EditorPane';
import { FileExplorer } from './components/Files/FileExplorer';
import { Home } from './components/Home/Home';
import { NewTaskDialog } from './components/NewTaskDialog';
import { ExecutionTabs } from './components/Panel/ExecutionTabs';
import { Panel } from './components/Panel/Panel';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { ScrollbackBanner } from './components/Panel/ScrollbackBanner';
import { RemoveExecutionDialog } from './components/RemoveExecutionDialog';
import { RemoveFromListDialog, type RemoveTarget } from './components/RemoveFromListDialog';
import { ResidueDialog } from './components/ResidueDialog';
import { Tree, type TreeActions } from './components/Tree/Tree';
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
  const [removingFromList, setRemovingFromList] = useState<RemoveTarget | null>(null);
  const [residue, setResidue] = useState<{ path: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showHome, setShowHome] = useState(false);
  const [sidebarView, setSidebarView] = useState<'workspaces' | 'files'>('workspaces');
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [fileRoots, setFileRoots] = useState<FileRoot[]>([]);

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

  // Raízes do explorador e do "ir para arquivo": mudam quando abre workspace ou execução.
  useEffect(() => {
    let alive = true;
    void api.files.roots().then((r) => {
      if (alive && r.ok) setFileRoots(r.value);
    });
    return () => {
      alive = false;
    };
  }, [api, snapshot]);

  // Ctrl+P abre o "ir para arquivo"; Ctrl+W fecha a aba do painel em foco.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        setShowQuickOpen(true);
        return;
      }
      if (key === 'w') {
        const pane = layout.panes.find((p) => p.id === layout.focusedPaneId);
        if (!pane) return;
        e.preventDefault();
        layoutStore.closeTab(pane.id, pane.activeIndex);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, layoutStore]);

  const agentsById = useMemo(() => new Map(catalog.agents.map((a) => [a.id, a])), [catalog.agents]);
  const execById = useMemo(() => new Map((snapshot?.executions ?? []).map((e) => [e.id, e])), [snapshot]);
  const paneIds = useMemo(() => layout.panes.map((pane) => pane.id), [layout.panes]);
  const openExecIds = useMemo(
    () => layout.panes.flatMap((pane) => (pane.kind === 'executions' ? pane.execIds : [])),
    [layout.panes],
  );
  /** Arquivo em foco, usado para escolher a raiz padrão do "ir para arquivo". */
  const focusedDocPath = useMemo(() => {
    const pane = layout.panes.find((p) => p.id === layout.focusedPaneId);
    if (pane?.kind !== 'editor') return null;
    return pane.docs[pane.activeIndex] ?? null;
  }, [layout.panes, layout.focusedPaneId]);
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
    onRemoveTask: (id) => {
      const task = snapshot?.tasks.find((t) => t.id === id);
      if (task) setRemovingFromList({ kind: 'task', task });
    },
    onRemoveGroup: (id) => {
      const group = snapshot?.groups.find((g) => g.id === id);
      if (group) setRemovingFromList({ kind: 'workspace', group });
    },
  };
  const removingExec = removing ? execById.get(removing) : undefined;
  const diffExec = diffFor ? execById.get(diffFor) : undefined;

  const openWorkspaceFromSidebar = async () => {
    const picked = await api.workspace.pickRepository();
    if (!picked.ok) return showError(picked.error);
    if (picked.value) await run(api.workspace.openWorkspace(picked.value));
  };

  const renderPanel = (paneId: string) => {
    const pane = layout.panes.find((p) => p.id === paneId);
    if (!pane) return null;
    if (pane.kind === 'editor') {
      return (
        <EditorPane
          pane={pane}
          focused={layout.focusedPaneId === pane.id}
          onFocus={() => layoutStore.focus(pane.id)}
          onSelect={(index) => layoutStore.setActive(pane.id, index)}
          onCloseTab={(path) => {
            const index = pane.docs.indexOf(path);
            if (index >= 0) layoutStore.closeTab(pane.id, index);
          }}
        />
      );
    }
    const execs = pane.execIds.map((id) => execById.get(id)).filter((e): e is Execution => e !== undefined);
    const index = Math.min(pane.activeIndex, execs.length - 1);
    const exec = execs[index];
    if (!exec) return null;
    return (
      <div className="pane-stack">
        {execs.length > 1 ? (
          <ExecutionTabs
            execs={execs}
            activeIndex={index}
            agentOf={(agentId) => agentsById.get(agentId)}
            onSelect={(i) => layoutStore.setActive(pane.id, i)}
            onCloseTab={(i) => layoutStore.closeTab(pane.id, i)}
          />
        ) : null}
        <Panel
          execution={exec}
          agent={agentsById.get(exec.agentId)}
          onTerminalReady={(h) => {
            if (h) terminalHandles.current.set(exec.id, h);
            else terminalHandles.current.delete(exec.id);
          }}
          onHeaderDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
          }}
          visible
          focused={layout.focusedPaneId === pane.id}
          onClose={() => layoutStore.close(pane.id)}
          onFocus={() => layoutStore.focus(pane.id)}
          baseAdvancedBy={divergence.get(exec.id) ?? 0}
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
                onClick={() => setDiffFor(exec.id)}
              >
                ±
              </button>
            )
          }
          banner={
            <>
              <FailureBanner execution={exec} />
              <ScrollbackBanner
                reason={snapshot?.scrollbackPaused.find((p) => p.execId === exec.id)?.reason ?? null}
              />
            </>
          }
        />
      </div>
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
              aria-pressed={showHome || paneIds.length === 0}
              onClick={() => setShowHome((v) => !v)}
              disabled={paneIds.length === 0}
            >
              Início
            </button>
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
              <button
                type="button"
                className="icon-button"
                aria-label="Fechar aviso"
                onClick={() => setNotice(null)}
              >
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
                  <FileExplorer
                    onShowWorkspaces={() => setSidebarView('workspaces')}
                    onOpenFile={(path) => {
                      setShowHome(false);
                      layoutStore.openDoc(path);
                    }}
                  />
                ) : (
                  <Tree
                    groups={snapshot.groups}
                    tasks={snapshot.tasks}
                    executions={snapshot.executions}
                    agents={agentsById}
                    openIds={openExecIds}
                    divergence={divergence}
                    {...treeActions}
                  />
                )}
              </aside>
            )}
            <main className="workspace">
              {snapshot && (paneIds.length === 0 || showHome) ? (
                <Home
                  snapshot={snapshot as WorkspaceSnapshot}
                  agents={catalog.agents}
                  detect={catalog.detect}
                  size={DEFAULT_TERM_SIZE}
                  onLaunched={onLaunched}
                  onRemoveWorkspace={(group) => setRemovingFromList({ kind: 'workspace', group })}
                />
              ) : snapshot ? (
                <Grid
                  ids={paneIds}
                  renderPanel={renderPanel}
                  observeResize={terminal.observeResize}
                  mode={layout.mode}
                  focusedId={layout.focusedPaneId}
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
              direct={snapshot?.tasks.find((t) => t.id === removingExec.taskId)?.isolation === 'direct'}
              onDone={() => setRemoving(null)}
              onCancel={() => setRemoving(null)}
            />
          )}
          {removingFromList && snapshot && (
            <RemoveFromListDialog
              target={removingFromList}
              tasks={snapshot.tasks}
              executions={snapshot.executions}
              onDone={() => setRemovingFromList(null)}
              onCancel={() => setRemovingFromList(null)}
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
          {showQuickOpen && (
            <QuickOpen
              roots={fileRoots}
              preferredRoot={focusedDocPath}
              onPick={(path) => {
                setShowHome(false);
                layoutStore.openDoc(path);
              }}
              onClose={() => setShowQuickOpen(false)}
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
