import { useCallback, useEffect, useRef, useState } from 'react';
import type { Confirm, GitProgress, NeedsConfirm, RepoStatus } from '../../../shared/ipc-contract';
import { useOptionalApi } from '../../api';
import { BranchPicker } from './BranchPicker';
import { CommitDialog } from './CommitDialog';
import { ConfirmGitDialog } from './ConfirmGitDialog';
import { ConflictList } from './ConflictList';
import { HistoryView } from './HistoryView';
import { isNeedsConfirm, relativeTime } from './git-ui';

export interface GitBarProps {
  /** Raiz da pasta do workspace. */
  repo: string;
  /** Nome do workspace. */
  title: string;
  /** Nome da pasta, quando o workspace tem mais de uma. */
  folderLabel?: string;
  /** Sessões de agente vivas neste workspace. */
  liveAgents: number;
  /** Abre um arquivo (caminho absoluto) no editor do app. */
  onOpenFile: (path: string) => void;
}

type NetKind = 'fetch' | 'pull' | 'push';

interface Running {
  opId: string;
  kind: NetKind;
  phase: string;
  percent: number | null;
}

const KIND_LABEL: Record<NetKind, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push' };
const OUTSIDE_NOTE = 'conclua fora do app';
const NO_REMOTE = 'Esta pasta está sem remoto configurado.';

function stateNote(status: RepoStatus): string | null {
  switch (status.state) {
    case 'merging':
      return 'Merge em andamento';
    case 'rebasing':
      return `Rebase em andamento — ${OUTSIDE_NOTE} (git rebase --continue ou --abort)`;
    case 'cherry-picking':
      return `Cherry-pick em andamento — ${OUTSIDE_NOTE} (git cherry-pick --continue ou --abort)`;
    case 'detached':
      return `HEAD solto em ${status.head.slice(0, 7)}`;
    default:
      return null;
  }
}

type Overlay = 'commit' | 'history' | 'branches' | 'conflicts' | null;

/** Barra de git de uma pasta do workspace: branch, ↑/↓, fetch/pull/push com progresso, commit, branches e histórico. */
export function GitBar({ repo, title, folderLabel, liveAgents, onOpenFile }: GitBarProps) {
  const api = useOptionalApi();
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: 'pull' | 'push'; request: NeedsConfirm; confirm: Confirm[] } | null>(
    null,
  );
  const [overlay, setOverlay] = useState<Overlay>(null);
  const runningRef = useRef<Running | null>(null);
  const early = useRef(new Map<string, GitProgress[]>());
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!api) return;
    const r = await api.git.status(repo);
    if (!alive.current) return;
    if (r.ok) {
      setStatus(r.value);
      setHidden(false);
    } else if (r.error.code === 'REPO_INVALID' || r.error.code === 'FILE_OUTSIDE_ROOT') {
      setHidden(true);
    } else {
      setError(r.error.message);
    }
  }, [api, repo]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const apply = useCallback(
    (e: GitProgress) => {
      const current = runningRef.current;
      if (!current || current.opId !== e.opId) return;
      if (!e.done) {
        const next = { ...current, phase: e.phase, percent: e.percent ?? current.percent };
        runningRef.current = next;
        setRunning(next);
        return;
      }
      runningRef.current = null;
      setRunning(null);
      if (e.error) setError(e.error.message);
      else if (e.result?.conflicts && e.result.conflicts.length > 0) {
        setNotice(
          `${KIND_LABEL[current.kind]} terminou com conflitos em ${e.result.conflicts.length} arquivo(s). Resolva-os para concluir o merge.`,
        );
      }
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (!api) return;
    return api.git.onProgress((e) => {
      if (runningRef.current?.opId === e.opId) {
        apply(e);
        return;
      }
      // O evento pode chegar antes de a chamada devolver o opId: guarda e reaplica ao adotar a operação.
      const list = early.current.get(e.opId) ?? [];
      early.current.set(e.opId, [...list, e].slice(-50));
      if (early.current.size > 20) early.current.delete(early.current.keys().next().value as string);
    });
  }, [api, apply]);

  const adopt = useCallback(
    (opId: string, kind: NetKind) => {
      const next: Running = { opId, kind, phase: 'Iniciando', percent: null };
      runningRef.current = next;
      setRunning(next);
      const buffered = early.current.get(opId) ?? [];
      early.current.delete(opId);
      for (const e of buffered) apply(e);
    },
    [apply],
  );

  const startNet = useCallback(
    async (kind: NetKind, confirm: Confirm[]) => {
      if (!api) return;
      setError(null);
      setNotice(null);
      if (kind === 'fetch') {
        const r = await api.git.fetch(repo);
        if (!r.ok) setError(r.error.message);
        else adopt(r.value.opId, 'fetch');
        return;
      }
      const call = api.git[kind];
      const r = await (confirm.length > 0 ? call(repo, confirm) : call(repo));
      if (!r.ok) setError(r.error.message);
      else if (isNeedsConfirm(r.value)) setPending({ kind, request: r.value, confirm });
      else adopt(r.value.opId, kind);
    },
    [api, repo, adopt],
  );

  if (!api || hidden) return null;

  const group = folderLabel ? `Git de ${title} · ${folderLabel}` : `Git de ${title}`;
  if (status === null) {
    return error ? (
      <div className="git-bar" role="group" aria-label={group}>
        <span role="alert" className="git-error">
          {error}
        </span>
      </div>
    ) : null;
  }

  const busy = running !== null;
  const noRemote = !status.hasRemote;
  const net = (reason: string | null) => ({ disabled: busy || reason !== null, title: reason ?? undefined });
  const fetchState = net(noRemote ? NO_REMOTE : null);
  const syncState = net(noRemote ? NO_REMOTE : status.branch === null ? 'O HEAD está solto: troque para uma branch.' : null);
  const note = stateNote(status);
  const branchLabel = status.branch ?? '(HEAD solto)';

  return (
    <div className="git-bar" role="group" aria-label={group}>
      <button
        type="button"
        className="git-branch"
        aria-label={`Branch ${branchLabel}`}
        title="Trocar, criar ou mesclar branches"
        onClick={() => setOverlay('branches')}
      >
        ⎇ {branchLabel}
      </button>
      {status.upstream !== null && status.ahead !== null && status.behind !== null && (
        <span className="git-counts">
          <span title="Commits para enviar">↑{status.ahead}</span> <span title="Commits para receber">↓{status.behind}</span>
        </span>
      )}
      <span className="meta">fetch {relativeTime(status.lastFetchAt)}</span>
      {note && <span className="git-state">{note}</span>}
      {noRemote && <span className="meta">Sem remoto configurado</span>}
      <span className="tree-actions">
        <button type="button" aria-label="Fetch" {...fetchState} onClick={() => void startNet('fetch', [])}>
          Fetch
        </button>
        <button type="button" aria-label="Pull" {...syncState} onClick={() => void startNet('pull', [])}>
          Pull
        </button>
        <button type="button" aria-label="Push" {...syncState} onClick={() => void startNet('push', [])}>
          Push
        </button>
        <button type="button" aria-label="Commit" disabled={busy} onClick={() => setOverlay('commit')}>
          Commit
        </button>
        <button type="button" aria-label="Histórico" onClick={() => setOverlay('history')}>
          Histórico
        </button>
        {status.state === 'merging' && (
          <button type="button" aria-label="Resolver conflitos" onClick={() => setOverlay('conflicts')}>
            Resolver conflitos
          </button>
        )}
      </span>
      {running && (
        <span className="git-progress">
          <span>
            {KIND_LABEL[running.kind]}: {running.phase}
          </span>{' '}
          {running.percent !== null && <progress max={100} value={running.percent} />}{' '}
          <button
            type="button"
            onClick={() => {
              void api.git.cancel(running.opId);
            }}
          >
            Cancelar
          </button>
        </span>
      )}
      {notice && <span className="git-notice">{notice}</span>}
      {error && (
        <span role="alert" className="git-error">
          {error}
        </span>
      )}
      {pending && (
        <ConfirmGitDialog
          request={pending.request}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const p = pending;
            setPending(null);
            void startNet(p.kind, [...p.confirm, p.request.needsConfirm]);
          }}
        />
      )}
      {overlay === 'commit' && (
        <CommitDialog
          repo={repo}
          title={title}
          liveAgents={liveAgents}
          onClose={() => {
            setOverlay(null);
            void refresh();
          }}
          onPushStarted={(opId) => adopt(opId, 'push')}
          onCommitted={() => void refresh()}
        />
      )}
      {overlay === 'history' && <HistoryView repo={repo} title={title} onClose={() => setOverlay(null)} />}
      {overlay === 'branches' && (
        <BranchPicker
          repo={repo}
          onClose={() => {
            setOverlay(null);
            void refresh();
          }}
          onConflicts={() => {
            setOverlay('conflicts');
            void refresh();
          }}
        />
      )}
      {overlay === 'conflicts' && (
        <ConflictList
          repo={repo}
          onOpenFile={onOpenFile}
          onClose={() => {
            setOverlay(null);
            void refresh();
          }}
          onConclude={() => setOverlay('commit')}
        />
      )}
    </div>
  );
}
