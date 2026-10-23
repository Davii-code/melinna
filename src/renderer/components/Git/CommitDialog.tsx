import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Change, Confirm, FileDiff, NeedsConfirm, RepoStatus, Result } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { FileSection } from '../DiffView/DiffView';
import { ConfirmGitDialog } from './ConfirmGitDialog';
import { KIND_LABEL, baseName, groupByFolder, isNeedsConfirm } from './git-ui';

export interface CommitDialogProps {
  repo: string;
  title: string;
  /** Sessões de agente vivas neste workspace; podem estar escrevendo nos arquivos. */
  liveAgents: number;
  onClose: () => void;
  /** O push de "Commit e push" começou; quem acompanha o progresso adota a operação. */
  onPushStarted?: (opId: string) => void;
  /** Chamado depois de um commit feito, para a barra reler o status. */
  onCommitted?: () => void;
}

type Pending =
  | { kind: 'commit'; request: NeedsConfirm; confirm: Confirm[]; thenPush: boolean }
  | { kind: 'discard'; request: NeedsConfirm; paths: string[] }
  | { kind: 'push'; request: NeedsConfirm; confirm: Confirm[] };

function agentWarning(n: number): string {
  return n === 1
    ? 'Há 1 agente rodando neste workspace; ele pode estar escrevendo nos arquivos agora.'
    : `Há ${n} agentes rodando neste workspace; eles podem estar escrevendo nos arquivos agora.`;
}

function FolderRow(props: {
  label: string;
  changes: Change[];
  selected: ReadonlySet<string>;
  locked: boolean;
  onToggleFolder: (changes: Change[], on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const count = props.changes.filter((c) => props.selected.has(c.path)).length;
  const all = count === props.changes.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <label className="git-folder">
      <input
        ref={ref}
        type="checkbox"
        aria-label={`Selecionar pasta ${props.label}`}
        checked={all}
        disabled={props.locked}
        onChange={() => props.onToggleFolder(props.changes, !all)}
      />
      <span>{props.label}</span>
      <span className="meta">
        {count}/{props.changes.length}
      </span>
    </label>
  );
}

/** Janela de commit: escolhe os arquivos, vê o diff, escreve a mensagem e commita (com amend, descarte e push). */
export function CommitDialog({ repo, title, liveAgents, onClose, onPushStarted, onCommitted }: CommitDialogProps) {
  const api = useApi();
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const editedMessage = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await unwrap(api.git.status(repo));
      setStatus(next);
      setSelected(new Set(next.changes.map((c) => c.path)));
      if (next.state === 'merging' && next.mergeMessage && !editedMessage.current) setMessage(next.mergeMessage);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (diffPath === null) return;
    let alive = true;
    setDiff(null);
    setDiffError(null);
    unwrap(api.git.diffFile(repo, diffPath)).then(
      (d) => alive && setDiff(d),
      (err: unknown) => alive && setDiffError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, repo, diffPath]);

  const merging = status?.state === 'merging';
  const changes = status?.changes ?? [];
  const groups = useMemo(() => groupByFolder(changes), [changes]);
  const chosen = changes.filter((c) => selected.has(c.path)).map((c) => c.path);
  const canCommit = !busy && message.trim().length > 0 && (chosen.length > 0 || (amend && !merging));

  const toggleFile = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const toggleFolder = (list: Change[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const c of list) {
        if (on) next.add(c.path);
        else next.delete(c.path);
      }
      return next;
    });

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (!on || message.trim().length > 0) return;
    const r = await api.git.log(repo, 0);
    const last = r.ok ? r.value[0] : undefined;
    if (last) setMessage(last.body ? `${last.subject}\n\n${last.body}` : last.subject);
  };

  const report = (r: Result<unknown>): boolean => {
    if (r.ok) return true;
    setError(r.error.message);
    return false;
  };

  const startPush = async (confirm: Confirm[]) => {
    const r = await (confirm.length > 0 ? api.git.push(repo, confirm) : api.git.push(repo));
    if (!report(r) || !r.ok) return false;
    if (isNeedsConfirm(r.value)) {
      setPending({ kind: 'push', request: r.value, confirm });
      return false;
    }
    onPushStarted?.(r.value.opId);
    return true;
  };

  const runCommit = async (confirm: Confirm[], thenPush: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const input = { paths: chosen, message, amend };
      const r = await api.git.commit(repo, confirm.length > 0 ? { ...input, confirm } : input);
      if (!report(r) || !r.ok) return;
      if (isNeedsConfirm(r.value)) {
        setPending({ kind: 'commit', request: r.value, confirm, thenPush });
        return;
      }
      onCommitted?.();
      if (thenPush && !(await startPush([]))) {
        await load();
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const runDiscard = async (paths: string[], confirm: Confirm[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await (confirm.length > 0 ? api.git.discard(repo, paths, confirm) : api.git.discard(repo, paths));
      if (!report(r) || !r.ok) return;
      if (isNeedsConfirm(r.value)) {
        setPending({ kind: 'discard', request: r.value, paths });
        return;
      }
      if (diffPath !== null && paths.includes(diffPath)) setDiffPath(null);
      onCommitted?.();
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    const current = pending;
    if (!current) return;
    setPending(null);
    const confirm = [...(current.kind === 'discard' ? [] : current.confirm), current.request.needsConfirm];
    if (current.kind === 'commit') await runCommit(confirm, current.thenPush);
    else if (current.kind === 'discard') await runDiscard(current.paths, ['discard']);
    else {
      setBusy(true);
      try {
        if (await startPush(confirm)) onClose();
        else await load();
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal git-modal" role="dialog" aria-modal="true" aria-labelledby="commit-title">
        <header className="diff-toolbar">
          <h2 id="commit-title">Commit: {title}</h2>
          <span className="spacer" />
          <button type="button" className="icon-button" aria-label="Fechar janela de commit" onClick={onClose}>
            ×
          </button>
        </header>
        {liveAgents > 0 && (
          <p role="status" className="git-agent-warning">
            {agentWarning(liveAgents)}
          </p>
        )}
        {error && (
          <p role="alert" className="error git-error">
            {error}
          </p>
        )}
        {status === null && !error && <p className="meta">Lendo as alterações…</p>}
        {status && changes.length === 0 && !amend && <p>Nenhuma alteração para commitar.</p>}
        {status && (changes.length > 0 || amend) && (
          <div className="git-body">
            <section className="git-files" aria-label="Arquivos alterados">
              <p className="meta">
                {chosen.length} de {changes.length} arquivos
              </p>
              {merging && (
                <p className="meta">Durante um merge, todos os arquivos entram no commit.</p>
              )}
              {groups.map((g) => (
                <div key={g.dir} className="git-group">
                  <FolderRow
                    label={g.label}
                    changes={g.changes}
                    selected={selected}
                    locked={merging}
                    onToggleFolder={toggleFolder}
                  />
                  <ul>
                    {g.changes.map((c) => (
                      <li key={c.path} className={diffPath === c.path ? 'git-file active' : 'git-file'}>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${c.path}`}
                          checked={selected.has(c.path)}
                          disabled={merging}
                          onChange={() => toggleFile(c.path)}
                        />
                        <button
                          type="button"
                          className="git-file-name"
                          aria-label={`Ver diff de ${c.path}`}
                          title={c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
                          onClick={() => setDiffPath(c.path)}
                        >
                          {baseName(c.path)}
                        </button>
                        <span className={`git-kind git-kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                        {c.kind !== 'conflict' && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Descartar ${c.path}`}
                            title="Descartar as alterações deste arquivo"
                            disabled={busy}
                            onClick={() => void runDiscard([c.path], [])}
                          >
                            ↶
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
            <section className="git-diff" aria-label="Diff do arquivo">
              {diffPath === null && <p className="meta">Escolha um arquivo para ver o que mudou.</p>}
              {diffError && <p className="error">{diffError}</p>}
              {diffPath !== null && !diffError && diff === null && <p className="meta">Calculando o diff…</p>}
              {diff && <FileSection file={diff} mode="unified" />}
            </section>
          </div>
        )}
        <div className="git-message">
          <label>
            Mensagem do commit
            <textarea
              rows={4}
              value={message}
              onChange={(e) => {
                editedMessage.current = true;
                setMessage(e.target.value);
              }}
            />
          </label>
          {!merging && (
            <label className="git-amend">
              <input type="checkbox" checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} />
              <span>Alterar o último commit (amend)</span>
            </label>
          )}
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" disabled={!canCommit} onClick={() => void runCommit([], false)}>
            Commit
          </button>
          <button type="button" className="primary" disabled={!canCommit} onClick={() => void runCommit([], true)}>
            Commit e push
          </button>
        </div>
      </div>
      {pending && (
        <ConfirmGitDialog
          request={pending.request}
          busy={busy}
          onConfirm={() => void confirmPending()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
