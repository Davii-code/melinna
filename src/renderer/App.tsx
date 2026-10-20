import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AgentDefinition,
  CatalogIssue,
  DetectResult,
  Execution,
  LaunchResult,
  MelinnaApi,
  WorkspaceSnapshot,
} from '../shared/ipc-contract';
import { ApiContext } from './api';
import { Grid } from './components/Grid/Grid';
import { NewTaskDialog } from './components/NewTaskDialog';
import { Panel } from './components/Panel/Panel';
import { TerminalDepsContext, type TerminalDeps } from './components/TerminalView';
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

export function App({ api, terminal, workspaceStore, layoutStore }: AppProps) {
  const snapshot = useWorkspace(workspaceStore);
  const layout = useLayout(layoutStore);
  const [catalog, reloadCatalog] = useCatalog(api);
  const [showNewTask, setShowNewTask] = useState(false);

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

  const onLaunched = (_taskId: string, results: LaunchResult[]) => {
    setShowNewTask(false);
    for (const r of results) if (r.execId) layoutStore.open(r.execId);
  };

  const renderPanel = (id: string) => {
    const exec = execById.get(id);
    if (!exec) return null;
    return (
      <Panel
        execution={exec}
        agent={agentsById.get(exec.agentId)}
        visible
        focused={layout.focusedExecutionId === id}
        onClose={() => layoutStore.close(id)}
        onFocus={() => layoutStore.focus(id)}
        banner={<FailureBanner execution={exec} />}
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
          />
          <main className="workspace">
            {snapshot ? (
              <Grid ids={openIds} renderPanel={renderPanel} observeResize={terminal.observeResize} />
            ) : (
              <div className="loading">Carregando…</div>
            )}
          </main>
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
