import { OrchestrationWorkspace } from './components/Orchestration/OrchestrationWorkspace';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type {
  AgentDefinition,
  CloseChoice,
  CatalogIssue,
  DetectResult,
  Execution,
  FileRoot,
  ImageCheck,
  LaunchResult,
  MelinnaApi,
  Prompt,
  Result,
  ResultError,
  WorkspaceSnapshot,
} from '../shared/ipc-contract';
import { ApiContext } from './api';
import { Grid } from './components/Grid/Grid';
import { CatalogView } from './components/CatalogView';
import { CloseDialog } from './components/CloseDialog';
import { DiffView } from './components/DiffView/DiffView';
import { GotoLinePopup } from './components/Editor/GotoLinePopup';
import { StructurePopup } from './components/Editor/StructurePopup';
import { EditorPane } from './components/Editor/EditorPane';
import { getEditorController } from './components/Editor/editor-controller';
import { requestReveal } from './components/Editor/editor-reveal';
import { createEditorSession, EditorSessionProvider } from './components/Editor/editor-session';
import { ProjectSearch } from './components/Search/ProjectSearch';
import { FileExplorer } from './components/Files/FileExplorer';
import { defaultPick, Home } from './components/Home/Home';
import { NewTaskDialog } from './components/NewTaskDialog';
import { BranchMenu } from './components/Git/BranchMenu';
import { CommitPanel } from './components/Git/CommitPanel';
import { DiffPane } from './components/Git/DiffPane';
import type { ActiveFile } from './components/Git/ChangeTree';
import { ToolStrip } from './components/Layout/ToolStrip';
import { ExecutionTabs } from './components/Panel/ExecutionTabs';
import { ImagePreview } from './components/Panel/ImagePreview';
import { Panel } from './components/Panel/Panel';
import { PromptLibrary } from './components/Prompts/PromptLibrary';
import { UsePromptDialog } from './components/Prompts/UsePromptDialog';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { RunBar } from './components/Run/RunBar';
import { KeymapDialog } from './components/Settings/KeymapDialog';
import { ScrollbackBanner } from './components/Panel/ScrollbackBanner';
import { RemoveExecutionDialog } from './components/RemoveExecutionDialog';
import {
  SidebarResizer,
  storedSidebarCollapsed,
  storedSidebarWidth,
  storeSidebarCollapsed,
  storeSidebarWidth,
} from './components/SidebarResizer';
import { RemoveFromListDialog, type RemoveTarget } from './components/RemoveFromListDialog';
import { WorkspaceDialog } from './components/WorkspaceDialog';
import { ResidueDialog } from './components/ResidueDialog';
import { Tree, type TreeActions } from './components/Tree/Tree';
import { TerminalDepsContext, type TerminalDeps, type TerminalHandle } from './components/TerminalView';
import { TopBar } from './components/TopBar';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { GitWorkspaceProvider, useGitWorkspace } from './git/git-workspace';
import { closeEditorTab, saveEditor } from './keymap/editor-save';
import { usePanelShortcuts } from './keymap/panel-shortcuts';
import { storedActiveWorkspace, storedSidebarPanel, storeSidebarPanel, type SidebarPanel } from './prefs';
import { KeymapContext, createKeymapStore, useKeymap, withShortcut } from './keymap/keymap-store';
import { shortcutLabel } from './keymap/keymaps';
import { runShortcutHandlers, useShortcuts } from './keymap/use-shortcuts';
import { isLiveStatus } from './labels';
import { usePromptQueues } from './prompts/use-queues';
import { useLayout, type LayoutStore } from './store/layout-store';
import { createRunStore } from './store/run-store';
import { useWorkspace, type WorkspaceStore } from './store/workspace-store';

export const DEFAULT_TERM_SIZE = { cols: 100, rows: 30 };

const PANEL_TITLE: Record<SidebarPanel, string> = {
  workspaces: 'Workspaces',
  files: 'Arquivos',
  commit: 'Commit',
};

const NO_AVAILABILITY: Record<string, boolean> = {};

/** Barra vertical com o selo de alterações do workspace ativo (lido do provedor de git). */
function ConnectedToolStrip(props: Omit<ComponentProps<typeof ToolStrip>, 'changes'>) {
  const { changeCount } = useGitWorkspace();
  return <ToolStrip {...props} changes={changeCount} />;
}

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
  const [stopping, setStopping] = useState<string[]>([]);
  const [removingFromList, setRemovingFromList] = useState<RemoveTarget | null>(null);
  /** Prévia de imagens escolhidas pelo clipe da árvore (colar e soltar têm a prévia no próprio painel). */
  const [treeAttach, setTreeAttach] = useState<{ execId: string; check: ImageCheck } | null>(null);
  /** Diálogo de workspace: criar, ou editar o workspace de id `groupId`. */
  const [workspaceDialog, setWorkspaceDialog] = useState<{ groupId: string | null } | null>(null);
  const [residue, setResidue] = useState<{ path: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Mensagem de sucesso (prompt enviado, por exemplo). */
  const [info, setInfo] = useState<string | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  /** Prompt em uso (`null` = texto avulso); o diálogo de uso substitui a biblioteca. */
  const [usingPrompt, setUsingPrompt] = useState<{ prompt: Prompt | null } | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showHome, setShowHome] = useState(false);
  const [editorFocus, setEditorFocus] = useState(false);
  const focusBeforeEditor = useRef<string | null>(null);
  const editorIds = layout.panes.filter((p) => p.kind === 'editor').map((p) => p.id);
  const toggleEditorFocus = () => {
    if (editorIds.length === 0) return false;
    setShowHome(false);
    if (!editorFocus) {
      focusBeforeEditor.current = layout.focusedPaneId;
      const id = editorIds.includes(layout.focusedPaneId ?? '') ? layout.focusedPaneId : editorIds[0];
      if (id) {
        layoutStore.focus(id);
        setTimeout(() => getEditorController(id)?.focus(), 0);
      }
    } else {
      const id = focusBeforeEditor.current;
      const pane = layout.panes.find((p) => p.id === id);
      if (pane) {
        layoutStore.focus(pane.id);
        setTimeout(() => {
          if (pane.kind === 'editor') getEditorController(pane.id)?.focus();
          else {
            const execId = pane.execIds[pane.activeIndex];
            if (execId) terminalHandles.current.get(execId)?.term.focus();
          }
        }, 100);
      }
    }
    setEditorFocus(!editorFocus);
  };
  useEffect(() => {
    if (
      editorIds.length === 0 ||
      layout.panes.some((p) => p.id === layout.focusedPaneId && p.kind === 'executions')
    )
      setEditorFocus(false);
  }, [editorIds.length, layout.focusedPaneId, layout.panes]);
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>(() => storedSidebarPanel());
  /** Arquivo com o diff aberto sobre a grade (não é persistido). */
  const [diffFile, setDiffFile] = useState<ActiveFile | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => storedActiveWorkspace());
  const [sidebarWidth, setSidebarWidth] = useState(() => storedSidebarWidth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storedSidebarCollapsed());
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      storeSidebarCollapsed(!v);
      return !v;
    });
  }, []);
  /** Mostra o painel lateral (abrindo a barra, se estiver recolhida). */
  const showPanel = useCallback(
    (panel: SidebarPanel) => {
      setSidebarPanel(panel);
      storeSidebarPanel(panel);
      if (sidebarCollapsed) toggleSidebar();
    },
    [sidebarCollapsed, toggleSidebar],
  );
  /** Ícone ou atalho do painel: o painel aberto recolhe a barra, qualquer outro passa a ser mostrado. */
  const selectPanel = useCallback(
    (panel: SidebarPanel) => {
      if (panel === sidebarPanel && !sidebarCollapsed) toggleSidebar();
      else showPanel(panel);
    },
    [sidebarPanel, sidebarCollapsed, toggleSidebar, showPanel],
  );
  usePanelShortcuts(selectPanel);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  /** Popup do editor aberto: ir para linha, estrutura do arquivo ou busca no projeto. */
  const [editorPopup, setEditorPopup] = useState<
    { kind: 'goto' | 'structure'; paneId: string } | { kind: 'search'; initialText: string } | null
  >(null);
  /** Rascunhos por arquivo (compartilhados entre painéis) e a pilha de abas fechadas. */
  const editorSession = useMemo(() => createEditorSession(), []);
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

  const agentsById = useMemo(() => new Map(catalog.agents.map((a) => [a.id, a])), [catalog.agents]);
  const launchable = useMemo(
    () => catalog.agents.filter((a) => catalog.detect[a.id]?.installed),
    [catalog.agents, catalog.detect],
  );
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
  /** Execução do painel em foco: destino padrão dos prompts. */
  const focusedExecId = useMemo(() => {
    const pane = layout.panes.find((p) => p.id === layout.focusedPaneId);
    if (pane?.kind !== 'executions') return null;
    return pane.execIds[Math.min(pane.activeIndex, pane.execIds.length - 1)] ?? null;
  }, [layout.panes, layout.focusedPaneId]);
  const focusedGroupId = useMemo(() => {
    const exec = focusedExecId ? execById.get(focusedExecId) : undefined;
    return (exec && snapshot?.tasks.find((t) => t.id === exec.taskId)?.groupId) ?? null;
  }, [focusedExecId, execById, snapshot]);
  const preparedIds = useMemo(
    () => (snapshot?.executions ?? []).filter((e) => e.branch !== '').map((e) => e.id),
    [snapshot],
  );
  const divergence = useDivergence(api, preparedIds);
  const liveExecIds = useMemo(
    () => (snapshot?.executions ?? []).filter((e) => isLiveStatus(e.status)).map((e) => e.id),
    [snapshot],
  );
  const promptQueues = usePromptQueues(api, liveExecIds, setNotice);
  const activeGroup = useMemo(
    () => snapshot?.groups.find((g) => g.id === activeWorkspaceId) ?? snapshot?.groups[0] ?? null,
    [snapshot, activeWorkspaceId],
  );
  const activeLiveAgents = useMemo(() => {
    if (!snapshot || !activeGroup) return 0;
    const taskIds = new Set(snapshot.tasks.filter((t) => t.groupId === activeGroup.id).map((t) => t.id));
    return snapshot.executions.filter((e) => taskIds.has(e.taskId) && isLiveStatus(e.status)).length;
  }, [snapshot, activeGroup]);
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

  const runStore = useMemo(
    () =>
      createRunStore({
        api,
        layout: layoutStore,
        workspace: workspaceStore,
        size: DEFAULT_TERM_SIZE,
        onError: showError,
      }),
    [api, layoutStore, workspaceStore, showError],
  );
  useEffect(() => {
    void runStore.load();
  }, [runStore]);
  // As configurações vêm dos arquivos dos workspaces: lê de novo quando eles ou as configurações salvas mudam.
  const groupsKey = JSON.stringify(
    (snapshot?.groups ?? []).map((g) => [g.id, g.folders?.map((f) => f.path), g.runConfigs?.length]),
  );
  useEffect(() => {
    void runStore.refresh();
  }, [runStore, groupsKey]);

  const keymapStore = useMemo(() => createKeymapStore(api, showError), [api, showError]);
  const keymap = useKeymap(keymapStore);
  useEffect(() => {
    void keymapStore.load();
  }, [keymapStore]);
  const [showKeymap, setShowKeymap] = useState(false);

  // Atalhos do mapa escolhido: um ouvinte único em fase de captura (funciona com o terminal ou o editor em
  // foco). Ctrl+B sozinho fica com o terminal: o Claude Code usa para mandar tarefas para o segundo plano.
  /** Painel de editor em foco, se o foco está num. */
  const focusedEditorId =
    layout.panes.find((p) => p.id === layout.focusedPaneId && p.kind === 'editor')?.id ?? null;
  const focusedEditor = () => getEditorController(focusedEditorId);
  const searchRoots = useMemo(() => {
    if (!activeGroup) return [];
    const folders = (activeGroup.folders ?? []).map((f) => f.path);
    return folders.length > 0 ? folders : activeGroup.repoPath ? [activeGroup.repoPath] : [];
  }, [activeGroup]);
  /** Fecha o popup do editor e devolve o foco ao editor que o abriu. */
  const closeEditorPopup = (paneId: string | null) => {
    setEditorPopup(null);
    if (paneId !== null) setTimeout(() => getEditorController(paneId)?.focus(), 0);
  };
  const reopenClosedTab = () => {
    const tab = editorSession.closed.pop();
    if (tab === undefined) return false;
    layoutStore.openDocAt(tab.paneId, tab.path, tab.index);
  };
  useShortcuts(keymap, {
    toggleEditorFocus,
    goToFile: () => {
      setShowQuickOpen(true);
    },
    goToLine: () => {
      if (focusedEditorId === null || !focusedEditor()) return false;
      setEditorPopup({ kind: 'goto', paneId: focusedEditorId });
    },
    goToSymbol: () => {
      if (focusedEditorId === null || !focusedEditor()) return false;
      setEditorPopup({ kind: 'structure', paneId: focusedEditorId });
    },
    selectNextOccurrence: () => focusedEditor()?.selectNextOccurrence() ?? false,
    unselectLastOccurrence: () => focusedEditor()?.unselectLastOccurrence() ?? false,
    findInProject: () => {
      if (searchRoots.length === 0) return false;
      setEditorPopup({ kind: 'search', initialText: focusedEditor()?.selectedText() ?? '' });
    },
    replaceInFile: () => {
      const editor = focusedEditor();
      if (!editor) return false;
      editor.openReplace();
    },
    toggleComment: () => focusedEditor()?.toggleComment() ?? false,
    reindent: () => focusedEditor()?.reindent() ?? false,
    reopenClosedTab,
    splitRight: () => {
      const pane = layout.panes.find((p) => p.id === focusedEditorId);
      if (!pane || pane.kind !== 'editor') return false;
      const path = pane.docs[Math.min(pane.activeIndex, pane.docs.length - 1)];
      if (path === undefined) return false;
      layoutStore.splitDoc(pane.id, path, 'right');
    },
    save: () => saveEditor(layout.focusedPaneId),
    closeTab: () => {
      const pane = layout.panes.find((p) => p.id === layout.focusedPaneId);
      if (!pane) return false;
      if (pane.kind === 'editor') closeEditorTab(pane.id);
      else layoutStore.closeTab(pane.id, pane.activeIndex);
    },
    toggleSidebar: () => {
      toggleSidebar();
    },
    promptLibrary: () => {
      setShowPrompts(true);
    },
    ...runShortcutHandlers(runStore),
  });

  const onLaunched = (_taskId: string, results: LaunchResult[]) => {
    setShowNewTask(false);
    setShowHome(false);
    setEditorFocus(false);
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
      setEditorFocus(false);
      setShowHome(false);
      layoutStore.open(id);
    },
    // A parada pode levar alguns segundos (Ctrl+C e, sem resposta, encerramento forçado): a árvore mostra "parando…".
    onStop: (id) => {
      setStopping((s) => (s.includes(id) ? s : [...s, id]));
      void run(api.executions.stop(id)).finally(() => setStopping((s) => s.filter((x) => x !== id)));
    },
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
    onEditGroup: (id) => setWorkspaceDialog({ groupId: id }),
    onAttachImage: (id) => {
      void api.attachments.pickImages(id).then((r) => {
        if (!r.ok) return showError(r.error);
        if (r.value.accepted.length + r.value.rejected.length > 0)
          setTreeAttach({ execId: id, check: r.value });
      });
    },
    onRemoveGroup: (id) => {
      const group = snapshot?.groups.find((g) => g.id === id);
      if (group) setRemovingFromList({ kind: 'workspace', group });
    },
  };
  /** Fecha o painel (ou a aba) da execução; o processo continua. */
  const closePanelOf = (execId: string) => {
    for (const pane of layout.panes) {
      if (pane.kind !== 'executions') continue;
      const index = pane.execIds.indexOf(execId);
      if (index < 0) continue;
      if (pane.execIds.length === 1) layoutStore.close(pane.id);
      else layoutStore.closeTab(pane.id, index);
      return;
    }
  };
  const execTools = (exec: Execution) => (
    <>
      {exec.branch !== '' && (
        <button
          type="button"
          className="icon-button"
          title="Ver o que este agente mudou"
          aria-label="Ver diff"
          onClick={() => setDiffFor(exec.id)}
        >
          ±
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        title="Fechar painel (o processo continua)"
        aria-label="Fechar painel"
        onClick={() => closePanelOf(exec.id)}
      >
        ×
      </button>
    </>
  );
  /** "+" da sessão: mais um terminal nela, com a IA escolhida e os padrões do catálogo. */
  const addTerminal = async (taskId: string, agentId: string) => {
    const agent = agentsById.get(agentId);
    if (!agent) return;
    const r = await api.tasks.addExecution(taskId, defaultPick(agent), DEFAULT_TERM_SIZE);
    if (!r.ok) return showError(r.error);
    onLaunched(taskId, r.value);
  };
  /** "+" do workspace: nova sessão na pasta dele, com a IA escolhida. */
  const newSession = async (groupId: string, agentId: string) => {
    const agent = agentsById.get(agentId);
    const group = snapshot?.groups.find((g) => g.id === groupId);
    if (!agent || !group?.repoPath) return;
    const r = await api.tasks.createAndLaunch({
      groupId,
      repoPath: group.repoPath,
      baseRef: 'HEAD',
      prompt: '',
      picks: [defaultPick(agent)],
      size: DEFAULT_TERM_SIZE,
    });
    if (!r.ok) return showError(r.error);
    onLaunched(r.value.taskId, r.value.results);
  };
  const editingGroup = workspaceDialog?.groupId
    ? snapshot?.groups.find((g) => g.id === workspaceDialog.groupId)
    : undefined;
  const editingGroupLive =
    editingGroup !== undefined &&
    (snapshot?.executions ?? []).some(
      (e) =>
        isLiveStatus(e.status) &&
        snapshot?.tasks.some((t) => t.id === e.taskId && t.groupId === editingGroup.id),
    );
  const removingExec = removing ? execById.get(removing) : undefined;
  const diffExec = diffFor ? execById.get(diffFor) : undefined;

  const openWorkspaceFromSidebar = async () => {
    const picked = await api.workspace.pickRepository();
    if (!picked.ok) return showError(picked.error);
    if (picked.value) await run(api.workspace.openWorkspace(picked.value));
  };

  const renderPanel = (paneId: string, visible: boolean) => {
    const pane = layout.panes.find((p) => p.id === paneId);
    if (!pane) return null;
    if (pane.kind === 'editor') {
      return (
        <EditorPane
          pane={pane}
          roots={fileRoots}
          editorFocus={editorFocus}
          onToggleFocus={toggleEditorFocus}
          focused={layout.focusedPaneId === pane.id}
          onFocus={() => layoutStore.focus(pane.id)}
          onSelect={(index) => layoutStore.setActive(pane.id, index)}
          onCloseTab={(path) => layoutStore.closeDoc(pane.id, path)}
          onReopenTab={(tab) => layoutStore.openDocAt(tab.paneId, tab.path, tab.index)}
          onSplit={(path, direction) => layoutStore.splitDoc(pane.id, path, direction)}
        />
      );
    }
    const execs = pane.execIds.map((id) => execById.get(id)).filter((e): e is Execution => e !== undefined);
    const index = Math.min(pane.activeIndex, execs.length - 1);
    const exec = execs[index];
    if (!exec) return null;
    return (
      <div className="pane-stack">
        <ExecutionTabs
          execs={execs}
          activeIndex={index}
          agentOf={(agentId) => agentsById.get(agentId)}
          onSelect={(i) => layoutStore.setActive(pane.id, i)}
          onCloseTab={(i) => layoutStore.closeTab(pane.id, i)}
        />
        {execs.map((execution, i) => (
          <div
            key={execution.id}
            className={'execution-surface' + (i === index ? '' : ' execution-hidden')}
            inert={i !== index || !visible || undefined}
            aria-hidden={i !== index || !visible || undefined}
          >
            <Panel
              execution={execution}
              agent={agentsById.get(execution.agentId)}
              onTerminalReady={(h) => {
                if (h) terminalHandles.current.set(execution.id, h);
                else terminalHandles.current.delete(execution.id);
              }}
              visible={visible && i === index}
              focused={layout.focusedPaneId === pane.id}
              onFocus={() => layoutStore.focus(pane.id)}
              banner={
                <>
                  <FailureBanner execution={execution} />
                  <ScrollbackBanner
                    reason={snapshot?.scrollbackPaused.find((p) => p.execId === execution.id)?.reason ?? null}
                  />
                </>
              }
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <ApiContext.Provider value={api}>
      <TerminalDepsContext.Provider value={terminal}>
        <KeymapContext.Provider value={keymap}>
          <EditorSessionProvider session={editorSession}>
            <GitWorkspaceProvider
              workspace={activeGroup}
              availability={snapshot?.folderAvailability ?? NO_AVAILABILITY}
            >
              <div className="app">
                <TopBar
                  leading={
                    snapshot && (
                      <>
                        <WorkspaceSwitcher
                          groups={snapshot.groups.filter(
                            (g) => g.repoPath !== undefined || (g.folders?.length ?? 0) > 0,
                          )}
                          activeId={activeGroup?.id ?? null}
                          onSelect={(id) => {
                            setActiveWorkspaceId(id);
                            setDiffFile(null);
                          }}
                        />
                        <BranchMenu onConflicts={() => showPanel('commit')} />
                      </>
                    )
                  }
                  freeSlots={snapshot ? snapshot.maxLive - snapshot.liveCount : 0}
                  onNewTask={() => {
                    void reloadCatalog();
                    setShowNewTask(true);
                  }}
                  onShortcuts={() => setShowKeymap(true)}
                >
                  {api.orchestration && (
                    <button type="button" aria-pressed={showTeams} onClick={() => setShowTeams(true)}>
                      Equipes
                    </button>
                  )}
                  <label className="layout-control">
                    <span className="sr-only">Modo de layout</span>
                    <select
                      aria-label="Modo de layout"
                      value={layout.mode}
                      onChange={(e) => {
                        setEditorFocus(false);
                        setShowHome(false);
                        layoutStore.setMode(e.target.value as typeof layout.mode);
                      }}
                    >
                      <option value="auto">Automático</option>
                      <option value="terminals">Terminais</option>
                      <option value="development" disabled={editorIds.length === 0}>
                        Desenvolvimento
                      </option>
                      <option value="spotlight">Destaque</option>
                      <option value="sidebar">Lateral</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="focus-editor-button"
                    disabled={editorIds.length === 0}
                    aria-pressed={editorFocus}
                    title={withShortcut('Editor em Foco', shortcutLabel(keymap, 'toggleEditorFocus'))}
                    onClick={toggleEditorFocus}
                  >
                    {editorFocus ? 'Restaurar layout' : 'Focar editor'}
                  </button>
                  <RunBar store={runStore} snapshot={snapshot} activeGroupId={activeGroup?.id ?? null} />
                  <button
                    type="button"
                    aria-pressed={showHome || paneIds.length === 0}
                    onClick={() => setShowHome((v) => !v)}
                    disabled={paneIds.length === 0}
                  >
                    Início
                  </button>
                </TopBar>
                {api.orchestration && (
                  <OrchestrationWorkspace
                    api={api.orchestration}
                    open={showTeams}
                    onClose={() => setShowTeams(false)}
                    groups={snapshot?.groups ?? []}
                    activeGroupId={activeGroup?.id ?? null}
                    agents={catalog.agents}
                  />
                )}
                {layoutStore.getSaveError() && (
                  <div className="panel-banner error" role="alert">
                    Layout não salvo: {layoutStore.getSaveError()}
                  </div>
                )}
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
                {info && (
                  <div className="panel-banner app-notice" role="status">
                    <span>{info}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Fechar aviso"
                      onClick={() => setInfo(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="body">
                  <ConnectedToolStrip
                    panel={sidebarPanel}
                    collapsed={sidebarCollapsed}
                    onSelect={selectPanel}
                    onPrompts={() => setShowPrompts(true)}
                    promptsTitle={withShortcut(
                      'Biblioteca de prompts',
                      shortcutLabel(keymap, 'promptLibrary'),
                    )}
                    onCatalog={() => {
                      void reloadCatalog();
                      setShowCatalog(true);
                    }}
                  />
                  {snapshot && !sidebarCollapsed && (
                    <aside className="sidebar" style={{ width: sidebarWidth }}>
                      <div className="sidebar-header">
                        <h2 className="sidebar-title">{PANEL_TITLE[sidebarPanel]}</h2>
                        <span className="spacer" />
                        {sidebarPanel === 'workspaces' ? (
                          <>
                            <button
                              type="button"
                              className="icon-button"
                              title="Novo workspace com várias pastas"
                              aria-label="Novo workspace"
                              onClick={() => setWorkspaceDialog({ groupId: null })}
                            >
                              ▤
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              title="Abrir uma pasta como workspace"
                              aria-label="Abrir workspace"
                              onClick={() => void openWorkspaceFromSidebar()}
                            >
                              ＋
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="icon-button"
                          title={withShortcut(
                            'Esconder barra lateral',
                            shortcutLabel(keymap, 'toggleSidebar'),
                          )}
                          aria-label="Esconder barra lateral"
                          onClick={toggleSidebar}
                        >
                          «
                        </button>
                      </div>
                      {sidebarPanel === 'commit' ? (
                        <CommitPanel
                          liveAgents={activeLiveAgents}
                          activeFile={diffFile}
                          onShowDiff={(root, path) => setDiffFile({ root, path })}
                          onOpenFile={(path) => {
                            setShowHome(false);
                            layoutStore.openDoc(path);
                          }}
                        />
                      ) : sidebarPanel === 'files' ? (
                        <FileExplorer
                          onShowWorkspaces={() => selectPanel('workspaces')}
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
                          queues={promptQueues.queues}
                          discarded={promptQueues.discarded}
                          onRemoveQueueItem={(execId, itemId) => void promptQueues.removeItem(execId, itemId)}
                          onClearQueue={(execId) => void promptQueues.clear(execId)}
                          onDismissDiscarded={promptQueues.dismissDiscarded}
                          execTools={execTools}
                          stoppingIds={stopping}
                          launchable={launchable}
                          folderAvailability={snapshot.folderAvailability}
                          onOpenFile={(path) => {
                            setShowHome(false);
                            layoutStore.openDoc(path);
                          }}
                          onAddTerminal={(taskId, agentId) => void addTerminal(taskId, agentId)}
                          onNewSession={(groupId, agentId) => void newSession(groupId, agentId)}
                          {...treeActions}
                        />
                      )}
                    </aside>
                  )}
                  {snapshot && !sidebarCollapsed && (
                    <SidebarResizer
                      width={sidebarWidth}
                      onChange={setSidebarWidth}
                      onCommit={(w) => {
                        setSidebarWidth(w);
                        storeSidebarWidth(w);
                      }}
                    />
                  )}
                  <main className="workspace">
                    {diffFile && (
                      <div className="diff-pane-overlay">
                        <DiffPane
                          root={diffFile.root}
                          path={diffFile.path}
                          onClose={() => setDiffFile(null)}
                        />
                      </div>
                    )}
                    {snapshot && (
                      <>
                        {(paneIds.length === 0 || showHome) && (
                          <Home
                            snapshot={snapshot as WorkspaceSnapshot}
                            agents={catalog.agents}
                            detect={catalog.detect}
                            size={DEFAULT_TERM_SIZE}
                            onLaunched={onLaunched}
                            onRemoveWorkspace={(group) => setRemovingFromList({ kind: 'workspace', group })}
                          />
                        )}
                        <Grid
                          ids={paneIds}
                          renderPanel={renderPanel}
                          observeResize={terminal.observeResize}
                          mode={layout.mode}
                          focusedId={layout.focusedPaneId}
                          custom={layout.custom}
                          editorIds={editorIds}
                          regions={layout.regions}
                          editorFocus={editorFocus}
                          hidden={paneIds.length === 0 || showHome}
                          onRegionsChange={(regions) => layoutStore.setRegions(regions)}
                          onRelayout={refitVisible}
                          onCustomChange={(g) => layoutStore.setCustom(g)}
                          onReorder={(from, to) => layoutStore.reorder(from, to)}
                        />
                      </>
                    )}
                    {!snapshot && <div className="loading">Carregando…</div>}
                  </main>
                </div>
                {closeAsk && <CloseDialog liveCount={closeAsk.liveCount} onAnswer={answerClose} />}
                {removingExec && (
                  <RemoveExecutionDialog
                    execution={removingExec}
                    agentName={
                      removingExec.command?.label ??
                      agentsById.get(removingExec.agentId)?.displayName ??
                      removingExec.agentId
                    }
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
                {treeAttach && execById.get(treeAttach.execId) && (
                  <ImagePreview
                    execution={execById.get(treeAttach.execId) as Execution}
                    check={treeAttach.check}
                    onClose={(message) => {
                      setTreeAttach(null);
                      if (message) setNotice(message);
                    }}
                  />
                )}
                {workspaceDialog && snapshot && (
                  <WorkspaceDialog
                    {...(editingGroup ? { group: editingGroup } : {})}
                    availability={snapshot.folderAvailability}
                    hasLiveSession={editingGroupLive}
                    onDone={() => setWorkspaceDialog(null)}
                    onClose={() => setWorkspaceDialog(null)}
                  />
                )}
                {diffExec && (
                  <DiffView
                    execId={diffExec.id}
                    title={agentsById.get(diffExec.agentId)?.displayName ?? diffExec.agentId}
                    onClose={() => setDiffFor(null)}
                  />
                )}
                {showKeymap && <KeymapDialog store={keymapStore} onClose={() => setShowKeymap(false)} />}
                {showCatalog && (
                  <CatalogView
                    agents={catalog.agents}
                    detect={catalog.detect}
                    invalid={catalog.invalid}
                    onReload={() => void reloadCatalog()}
                    onClose={() => setShowCatalog(false)}
                  />
                )}
                {showPrompts && snapshot && !usingPrompt && (
                  <PromptLibrary
                    groupId={focusedGroupId}
                    groups={snapshot.groups}
                    onUse={(prompt) => {
                      setUsingPrompt({ prompt });
                      setShowPrompts(false);
                    }}
                    onClose={() => setShowPrompts(false)}
                  />
                )}
                {usingPrompt && snapshot && (
                  <UsePromptDialog
                    prompt={usingPrompt.prompt}
                    targetExecId={focusedExecId}
                    executions={snapshot.executions.filter((e) => !e.command)}
                    tasks={snapshot.tasks}
                    agents={agentsById}
                    onClose={(message) => {
                      setUsingPrompt(null);
                      if (message) setInfo(message);
                    }}
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
                {editorPopup?.kind === 'goto' && getEditorController(editorPopup.paneId) && (
                  <GotoLinePopup
                    lineCount={getEditorController(editorPopup.paneId)?.lineCount() ?? 1}
                    onGo={(spec) => getEditorController(editorPopup.paneId)?.goToLine(spec)}
                    onClose={() => closeEditorPopup(editorPopup.paneId)}
                  />
                )}
                {editorPopup?.kind === 'structure' && getEditorController(editorPopup.paneId) && (
                  <StructurePopup
                    symbols={getEditorController(editorPopup.paneId)?.symbols() ?? []}
                    onPick={(symbol) => getEditorController(editorPopup.paneId)?.goToPosition(symbol.from)}
                    onClose={() => closeEditorPopup(editorPopup.paneId)}
                  />
                )}
                {editorPopup?.kind === 'search' && (
                  <ProjectSearch
                    roots={searchRoots}
                    initialText={editorPopup.initialText}
                    onOpen={(hit) => {
                      setShowHome(false);
                      requestReveal({
                        path: hit.path,
                        line: hit.line,
                        column: hit.column,
                        length: hit.matchEnd - hit.matchStart,
                      });
                      layoutStore.openDoc(hit.path);
                    }}
                    onClose={() => closeEditorPopup(null)}
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
            </GitWorkspaceProvider>
          </EditorSessionProvider>
        </KeymapContext.Provider>
      </TerminalDepsContext.Provider>
    </ApiContext.Provider>
  );
}
