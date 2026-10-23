import { useCallback, useEffect, useState } from 'react';
import type { Change, NeedsConfirm, RepoStatus } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { ConfirmGitDialog } from './ConfirmGitDialog';
import { absolutePath, isNeedsConfirm } from './git-ui';

export interface ConflictListProps {
  repo: string;
  /** Abre o arquivo (caminho absoluto) no editor do app. */
  onOpenFile: (path: string) => void;
  onClose: () => void;
  /** Todos os conflitos foram resolvidos: quem abriu mostra a janela de commit do merge. */
  onConclude: () => void;
}

/** Arquivos em conflito de um merge: abrir no editor, marcar como resolvido, concluir ou abortar. */
export function ConflictList({ repo, onOpenFile, onClose, onConclude }: ConflictListProps) {
  const api = useApi();
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<NeedsConfirm | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await unwrap(api.git.status(repo)));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  const conflicts: Change[] = (status?.changes ?? []).filter((c) => c.kind === 'conflict');

  const resolve = async (path: string) => {
    setBusy(true);
    try {
      const r = await api.git.markResolved(repo, [path]);
      if (!r.ok) setError(r.error.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const abort = async (confirmed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await (confirmed ? api.git.abortMerge(repo, ['abort-merge']) : api.git.abortMerge(repo));
      if (!r.ok) return setError(r.error.message);
      if (isNeedsConfirm(r.value)) return setConfirm(r.value);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="conflicts-title">
        <header className="diff-toolbar">
          <h2 id="conflicts-title">Conflitos do merge</h2>
          <span className="spacer" />
          <button type="button" className="icon-button" aria-label="Fechar conflitos" onClick={onClose}>
            ×
          </button>
        </header>
        {error && (
          <p role="alert" className="error git-error">
            {error}
          </p>
        )}
        {status === null && !error && <p className="meta">Lendo os conflitos…</p>}
        {status && conflicts.length === 0 && (
          <p>Nenhum arquivo em conflito. Conclua o merge com um commit.</p>
        )}
        {conflicts.length > 0 && (
          <ul className="git-conflicts">
            {conflicts.map((c) => (
              <li key={c.path}>
                <code>{c.path}</code>
                <span className="spacer" />
                <button
                  type="button"
                  aria-label={`Abrir ${c.path} no editor`}
                  onClick={() => onOpenFile(absolutePath(repo, c.path))}
                >
                  Abrir no editor
                </button>
                <button
                  type="button"
                  aria-label={`Marcar ${c.path} como resolvido`}
                  disabled={busy}
                  onClick={() => void resolve(c.path)}
                >
                  Marcar como resolvido
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" className="danger" disabled={busy} onClick={() => void abort(false)}>
            Abortar merge
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || status === null || conflicts.length > 0}
            onClick={onConclude}
          >
            Concluir merge
          </button>
        </div>
      </div>
      {confirm && (
        <ConfirmGitDialog
          request={confirm}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void abort(true);
          }}
        />
      )}
    </div>
  );
}
