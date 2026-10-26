import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react';

/** Texto de um arquivo aberto no editor, com o hash lido do disco e se há alteração não salva. */
export interface Draft {
  text: string;
  baseHash: string;
  dirty: boolean;
}

/**
 * Rascunhos por caminho, compartilhados por todos os painéis de editor: o mesmo arquivo em dois painéis
 * (editor dividido) é um só texto, uma só marca de "não salvo" e um só salvar.
 */
export interface DraftStore {
  snapshot(): Readonly<Record<string, Draft>>;
  subscribe(fn: () => void): () => void;
  set(path: string, draft: Draft): void;
  patch(path: string, fn: (draft: Draft) => Draft): void;
  /** Esquece o rascunho (aba descartada ou fechada): a próxima abertura lê do disco de novo. */
  remove(path: string): void;
}

export function createDraftStore(): DraftStore {
  let drafts: Record<string, Draft> = {};
  const listeners = new Set<() => void>();
  const emit = (next: Record<string, Draft>) => {
    drafts = next;
    for (const fn of listeners) fn();
  };
  return {
    snapshot: () => drafts,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (path, draft) => emit({ ...drafts, [path]: draft }),
    remove(path) {
      if (drafts[path] === undefined) return;
      const rest = { ...drafts };
      delete rest[path];
      emit(rest);
    },
    patch(path, fn) {
      const current = drafts[path];
      if (current === undefined) return;
      const next = fn(current);
      if (next !== current) emit({ ...drafts, [path]: next });
    },
  };
}

/** Uma aba fechada, para "Reabrir aba fechada": o painel e a posição em que estava. */
export interface ClosedTab {
  paneId: string;
  path: string;
  index: number;
}

export const MAX_CLOSED_TABS = 20;

/** Pilha das últimas abas fechadas (só em memória, até {@link MAX_CLOSED_TABS}). */
export interface ClosedTabs {
  push(tab: ClosedTab): void;
  pop(): ClosedTab | undefined;
  size(): number;
  subscribe(fn: () => void): () => void;
}

export function createClosedTabs(): ClosedTabs {
  let stack: ClosedTab[] = [];
  const listeners = new Set<() => void>();
  const emit = (next: ClosedTab[]) => {
    stack = next;
    for (const fn of listeners) fn();
  };
  return {
    push: (tab) => emit([...stack, tab].slice(-MAX_CLOSED_TABS)),
    pop() {
      const last = stack[stack.length - 1];
      if (last === undefined) return undefined;
      emit(stack.slice(0, -1));
      return last;
    },
    size: () => stack.length,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Quais arquivos cada painel de editor mostra, para saber se fechar uma aba perde o texto de outro painel. */
export interface PaneDocs {
  register(paneId: string, docs: readonly string[]): void;
  unregister(paneId: string): void;
  /** Algum painel, fora `exceptPaneId`, mostra o arquivo? */
  holds(path: string, exceptPaneId: string): boolean;
}

export function createPaneDocs(): PaneDocs {
  const byPane = new Map<string, readonly string[]>();
  return {
    register: (paneId, docs) => void byPane.set(paneId, docs),
    unregister: (paneId) => void byPane.delete(paneId),
    holds: (path, exceptPaneId) =>
      [...byPane.entries()].some(([id, docs]) => id !== exceptPaneId && docs.includes(path)),
  };
}

export interface EditorSession {
  drafts: DraftStore;
  closed: ClosedTabs;
  panes: PaneDocs;
}

export function createEditorSession(): EditorSession {
  return { drafts: createDraftStore(), closed: createClosedTabs(), panes: createPaneDocs() };
}

const EditorSessionContext = createContext<EditorSession | null>(null);

export function EditorSessionProvider({
  session,
  children,
}: {
  session: EditorSession;
  children: ReactNode;
}) {
  return <EditorSessionContext.Provider value={session}>{children}</EditorSessionContext.Provider>;
}

/** A sessão do app; sem provedor (testes de um painel só), cada painel tem a sua. */
export function useEditorSession(): EditorSession {
  const provided = useContext(EditorSessionContext);
  const local = useRef<EditorSession | null>(null);
  if (provided !== null) return provided;
  local.current ??= createEditorSession();
  return local.current;
}

export function useDrafts(session: EditorSession): Readonly<Record<string, Draft>> {
  return useSyncExternalStore(session.drafts.subscribe, session.drafts.snapshot);
}

export function useClosedCount(session: EditorSession): number {
  return useSyncExternalStore(session.closed.subscribe, session.closed.size);
}
