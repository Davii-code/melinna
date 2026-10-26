import type { ReactNode } from 'react';
import { useApi } from '../../api';
import type { RepoView } from '../../git/git-store';
import { useGitWorkspace, type NetKind } from '../../git/git-workspace';
import { fetchAll, pullAll, pushAll, type StepResult } from '../../git/sequence';
import { useConfirm } from '../../git/use-confirm';

export const NET_LABEL: Record<NetKind, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push' };

const NO_REMOTE = 'Esta pasta está sem remoto configurado.';
const DETACHED = 'O HEAD está solto: troque para uma branch.';
const OUTSIDE = 'Conclua o rebase ou o cherry-pick fora do app antes.';

export interface NetworkOptions {
  /** Um merge (pull) terminou com conflitos neste repositório. */
  onConflicts: (root: string) => void;
  /** Linhas de resultado por repositório (operações em todos). */
  onReport: (lines: string[]) => void;
  onError: (message: string | null) => void;
}

export interface Network {
  runOne: (kind: NetKind, repo: RepoView) => Promise<void>;
  runAll: (kind: 'fetch' | 'pull', repos: readonly RepoView[]) => Promise<void>;
  dialog: ReactNode;
}

function resultLine(r: StepResult): string {
  if (r.outcome === 'ok') return `${r.name}: concluído`;
  if (r.outcome === 'skipped') return `${r.name}: pulado`;
  return `${r.name}: falhou: ${r.message ?? 'erro desconhecido'}`;
}

/** Fetch, pull e push de um repositório ou de todos; as confirmações e o progresso vêm do provedor. Fica montado fora do menu. */
export function useNetworkActions({ onConflicts, onReport, onError }: NetworkOptions): Network {
  const api = useApi();
  const gw = useGitWorkspace();
  const { ask, dialog } = useConfirm();

  const run = (kind: NetKind, repos: readonly RepoView[]): Promise<StepResult[]> => {
    if (kind === 'fetch') return fetchAll(api.git, repos, gw.waitOp);
    if (kind === 'pull') return pullAll(api.git, repos, ask, gw.waitOp);
    return pushAll(api.git, repos, ask, gw.waitOp);
  };

  const runOne = async (kind: NetKind, repo: RepoView) => {
    onError(null);
    onReport([]);
    const [result] = await run(kind, [repo]);
    if (!result) return;
    if (result.outcome === 'error') onError(result.message ?? 'Erro desconhecido.');
    if (result.conflicts && result.conflicts.length > 0) onConflicts(repo.root);
  };

  const runAll = (kind: 'fetch' | 'pull', repos: readonly RepoView[]) =>
    gw.runExclusive(async () => {
      onError(null);
      onReport([]);
      const results = await run(kind, repos);
      onReport(results.map(resultLine));
      const conflicted = results.find((r) => r.conflicts && r.conflicts.length > 0);
      if (conflicted) onConflicts(conflicted.root);
    });

  return { runOne, runAll, dialog };
}

/** Motivo pelo qual a operação não pode rodar agora; `null` = pode. */
export function netBlock(kind: NetKind, repo: RepoView, busy: boolean): string | null {
  const { status } = repo;
  if (busy) return 'Há uma operação em andamento neste repositório.';
  if (!status.hasRemote) return NO_REMOTE;
  if (kind === 'fetch') return null;
  if (status.branch === null) return DETACHED;
  if (kind === 'pull' && (status.state === 'rebasing' || status.state === 'cherry-picking')) return OUTSIDE;
  return null;
}

export interface RepoNetworkItemsProps {
  repo: RepoView;
  net: Network;
  /** Chamado ao escolher uma ação (o menu se fecha). */
  onPick: () => void;
}

/** Itens de menu Fetch, Pull e Push… de um repositório. */
export function RepoNetworkItems({ repo, net, onPick }: RepoNetworkItemsProps) {
  const gw = useGitWorkspace();
  const busy = gw.busy || gw.ops.has(repo.root);
  const item = (kind: NetKind, label: string) => {
    const block = netBlock(kind, repo, busy);
    return (
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        disabled={block !== null}
        title={block ?? undefined}
        onClick={() => {
          onPick();
          void net.runOne(kind, repo);
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <>
      {item('fetch', 'Fetch')}
      {item('pull', 'Pull')}
      {item('push', 'Push…')}
    </>
  );
}

export interface AllNetworkItemsProps {
  repos: readonly RepoView[];
  net: Network;
  onPick: () => void;
}

/** "Fetch todos" e "Pull todos": um repositório de cada vez, nunca em paralelo. */
export function AllNetworkItems({ repos, net, onPick }: AllNetworkItemsProps) {
  const gw = useGitWorkspace();
  const busy = gw.busy || gw.ops.size > 0;
  const eligible = (kind: 'fetch' | 'pull') => repos.filter((r) => netBlock(kind, r, false) === null);
  const item = (kind: 'fetch' | 'pull', label: string) => {
    const list = eligible(kind);
    return (
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        disabled={busy || list.length === 0}
        title={list.length === 0 ? NO_REMOTE : undefined}
        onClick={() => {
          onPick();
          void net.runAll(kind, list);
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <>
      {item('fetch', 'Fetch todos')}
      {item('pull', 'Pull todos')}
    </>
  );
}

/** Progresso e "Cancelar" das operações de rede em curso, ao lado do botão da branch. */
export function NetworkProgress({ repos }: { repos: readonly RepoView[] }) {
  const api = useApi();
  const { ops } = useGitWorkspace();
  if (ops.size === 0) return null;
  const nameOf = new Map(repos.map((r) => [r.root, r.name]));
  return (
    <span className="git-progress">
      {[...ops.entries()].map(([root, op]) => (
        <span key={op.opId} className="git-progress-op">
          <span>
            {NET_LABEL[op.kind]}: {op.phase}
          </span>
          {repos.length > 1 && <span className="meta"> ({nameOf.get(root) ?? root})</span>}{' '}
          {op.percent !== null && <progress max={100} value={op.percent} />}{' '}
          <button type="button" onClick={() => void api.git.cancel(op.opId)}>
            Cancelar
          </button>
        </span>
      ))}
    </span>
  );
}
