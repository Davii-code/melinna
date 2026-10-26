import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GitProgress, Group } from '../../shared/ipc-contract';
import { useOptionalApi } from '../api';
import { gitFolders } from '../components/Tree/TreeGroup';
import { addPaths, mergeSelection, pruneAdded, type RepoView, type Selection } from './git-store';

export type NetKind = 'fetch' | 'pull' | 'push';

/** Operação de rede em curso num repositório. */
export interface RepoOp {
  opId: string;
  kind: NetKind;
  phase: string;
  percent: number | null;
}

export interface GitWorkspace {
  workspace: Group | null;
  repos: RepoView[];
  /** Arquivos marcados por repositório. */
  selection: Selection;
  setSelection: (next: Selection) => void;
  /** Não rastreados que o usuário mandou para "Changes" (só na interface; o commit é que os adiciona ao git). */
  added: Selection;
  /** "Adicionar ao git": leva os arquivos para "Changes" e os marca. */
  addToVcs: (files: readonly { root: string; path: string }[]) => void;
  /** Operações de rede em curso, por raiz de repositório. */
  ops: ReadonlyMap<string, RepoOp>;
  /** Total de arquivos alterados em todos os repositórios (selo da barra vertical). */
  changeCount: number;
  /** Uma sequência (commit, push, fetch/pull de todos) está rodando. */
  busy: boolean;
  /** A primeira leitura do workspace ativo terminou. */
  loaded: boolean;
  /** Mensagem do último erro de leitura (não de pasta sem git). */
  error: string | null;
  refresh: () => Promise<void>;
  /** Acompanha uma operação de rede já iniciada; resolve no evento final. */
  waitOp: (opId: string, ctx: { root: string; kind: NetKind }) => Promise<GitProgress>;
  /** Roda `fn` marcando o workspace como ocupado. */
  runExclusive: <T>(fn: () => Promise<T>) => Promise<T>;
}

const GitWorkspaceContext = createContext<GitWorkspace | null>(null);

export function useGitWorkspace(): GitWorkspace {
  const ctx = useContext(GitWorkspaceContext);
  if (!ctx) throw new Error('GitWorkspaceProvider ausente');
  return ctx;
}

/** Como `useGitWorkspace`, mas `null` sem provedor. */
export function useOptionalGitWorkspace(): GitWorkspace | null {
  return useContext(GitWorkspaceContext);
}

export interface GitWorkspaceProviderProps {
  workspace: Group | null;
  availability: Readonly<Record<string, boolean>>;
  children: ReactNode;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

const IGNORED = new Set(['REPO_INVALID', 'FILE_OUTSIDE_ROOT']);
const EARLY_PER_OP = 50;
const EARLY_OPS = 20;

/** Uma única leitura do git do workspace ativo, compartilhada pelo painel Commit, pelo menu da branch e pelo selo. */
export function GitWorkspaceProvider({ workspace, availability, children }: GitWorkspaceProviderProps) {
  const api = useOptionalApi();
  const [repos, setRepos] = useState<RepoView[]>([]);
  const [selection, setSelection] = useState<Selection>(new Map());
  const [added, setAdded] = useState<Selection>(new Map());
  const [ops, setOps] = useState<ReadonlyMap<string, RepoOp>>(new Map());
  const [busyCount, setBusyCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reposRef = useRef<RepoView[]>([]);
  const opsRef = useRef(new Map<string, RepoOp & { root: string }>());
  const waiters = useRef(new Map<string, (e: GitProgress) => void>());
  const early = useRef(new Map<string, GitProgress[]>());
  const generation = useRef(0);

  const folders = useMemo(
    () => (workspace ? gitFolders(workspace, availability) : []),
    [workspace, availability],
  );
  const foldersKey = `${workspace?.id ?? ''}|${folders.map((f) => `${f.id}=${f.path}`).join('|')}`;

  const refresh = useCallback(async () => {
    if (!api) return;
    const mine = ++generation.current;
    const answers = await Promise.all(folders.map(async (f) => [f, await api.git.status(f.path)] as const));
    if (mine !== generation.current) return;
    const previous = new Map(reposRef.current.map((r) => [r.root, r]));
    const next: RepoView[] = [];
    let failure: string | null = null;
    for (const [folder, result] of answers) {
      if (result.ok) {
        next.push({ folderId: folder.id, root: result.value.root, name: folderName(folder.path), status: result.value });
      } else if (!IGNORED.has(result.error.code)) {
        failure = result.error.message;
      }
    }
    reposRef.current = next;
    setRepos(next);
    setAdded((prev) => pruneAdded(prev, next));
    setError(failure);
    setLoaded(true);
    setSelection((prev) => {
      const merged = new Map<string, ReadonlySet<string>>();
      for (const r of next) merged.set(r.root, mergeSelection(prev.get(r.root), previous.get(r.root)?.status, r.status));
      return merged;
    });
  }, [api, folders]);

  // Troca de workspace (ou de pastas): descarta o estado anterior e lê de novo.
  useEffect(() => {
    generation.current++;
    reposRef.current = [];
    setRepos([]);
    setSelection(new Map());
    setAdded(new Map());
    setError(null);
    setLoaded(folders.length === 0);
    if (folders.length === 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersKey]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const applyEvent = useCallback(
    (e: GitProgress) => {
      const op = opsRef.current.get(e.opId);
      if (!op) return;
      if (!e.done) {
        opsRef.current.set(e.opId, { ...op, phase: e.phase, percent: e.percent ?? op.percent });
      } else {
        opsRef.current.delete(e.opId);
      }
      const view = new Map<string, RepoOp>();
      for (const o of opsRef.current.values()) view.set(o.root, { opId: o.opId, kind: o.kind, phase: o.phase, percent: o.percent });
      setOps(view);
      if (e.done) {
        waiters.current.get(e.opId)?.(e);
        waiters.current.delete(e.opId);
        void refresh();
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!api) return;
    return api.git.onProgress((e) => {
      if (opsRef.current.has(e.opId)) {
        applyEvent(e);
        return;
      }
      // O evento pode chegar antes de a chamada devolver o opId: guarda e reaplica ao adotar a operação.
      const list = early.current.get(e.opId) ?? [];
      early.current.set(e.opId, [...list, e].slice(-EARLY_PER_OP));
      if (early.current.size > EARLY_OPS) early.current.delete(early.current.keys().next().value as string);
    });
  }, [api, applyEvent]);

  const waitOp = useCallback(
    (opId: string, ctx: { root: string; kind: NetKind }) =>
      new Promise<GitProgress>((resolve) => {
        waiters.current.set(opId, resolve);
        opsRef.current.set(opId, { opId, root: ctx.root, kind: ctx.kind, phase: 'Iniciando', percent: null });
        setOps((prev) => new Map(prev).set(ctx.root, { opId, kind: ctx.kind, phase: 'Iniciando', percent: null }));
        const buffered = early.current.get(opId) ?? [];
        early.current.delete(opId);
        for (const e of buffered) applyEvent(e);
      }),
    [applyEvent],
  );

  const runExclusive = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusyCount((n) => n + 1);
    try {
      return await fn();
    } finally {
      setBusyCount((n) => n - 1);
    }
  }, []);

  const addToVcs = useCallback((files: readonly { root: string; path: string }[]) => {
    if (files.length === 0) return;
    setAdded((prev) => addPaths(prev, files));
    setSelection((prev) => addPaths(prev, files));
  }, []);

  const changeCount = useMemo(() => repos.reduce((n, r) => n + r.status.changes.length, 0), [repos]);

  const value = useMemo<GitWorkspace>(
    () => ({
      workspace,
      repos,
      selection,
      setSelection,
      added,
      addToVcs,
      ops,
      changeCount,
      busy: busyCount > 0,
      loaded,
      error,
      refresh,
      waitOp,
      runExclusive,
    }),
    [workspace, repos, selection, added, addToVcs, ops, changeCount, busyCount, loaded, error, refresh, waitOp, runExclusive],
  );

  return <GitWorkspaceContext.Provider value={value}>{children}</GitWorkspaceContext.Provider>;
}
