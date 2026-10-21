import { useEffect, useState } from 'react';
import type { Execution, RemovalCheck } from '../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../api';

export interface RemoveExecutionDialogProps {
  execution: Execution;
  agentName: string;
  onDone: () => void;
  onCancel: () => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Confirma a remoção de uma execução encerrada. Mostra o que seria perdido e só força a remoção
 * com confirmação explícita. Manter a branch é o padrão (preserva os commits do agente).
 */
export function RemoveExecutionDialog({ execution, agentName, onDone, onCancel }: RemoveExecutionDialogProps) {
  const api = useApi();
  const [check, setCheck] = useState<RemovalCheck | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    unwrap(api.executions.removalCheck(execution.id)).then(
      (c) => alive && setCheck(c),
      (err: unknown) => alive && setError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, execution.id]);

  const losesCommits = deleteBranch && (check?.unmergedCommits ?? 0) > 0;
  const losesFiles = (check?.uncommittedFiles ?? 0) > 0;
  const loses = losesFiles || losesCommits;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.executions.remove(execution.id, { deleteBranch, force: loses }));
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-title">
        <h2 id="remove-title">Remover execução de {agentName}</h2>
        <div className="confirm">
          <p>
            O worktree <code>{execution.worktreePath}</code> e o histórico do terminal serão apagados.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => {
                setDeleteBranch(e.target.checked);
                setAcceptLoss(false);
              }}
            />
            Apagar a branch {execution.branch || '(sem branch)'}
          </label>
          {check === null && !error && <p className="meta">Verificando o worktree…</p>}
          {check && !loses && (
            <p>
              Nenhum trabalho será perdido.
              {check.unmergedCommits > 0 &&
                ` ${plural(check.unmergedCommits, 'commit fica', 'commits ficam')} na branch.`}
            </p>
          )}
          {check && loses && (
            <div className="panel-banner warning" role="alert">
              <p className="warning">Esta remoção descarta trabalho do agente:</p>
              <ul>
                {losesFiles && (
                  <li>{plural(check.uncommittedFiles, 'arquivo não commitado', 'arquivos não commitados')}</li>
                )}
                {losesCommits && (
                  <li>{plural(check.unmergedCommits, 'commit fora da base', 'commits fora da base')}</li>
                )}
              </ul>
              <label className="check">
                <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} />
                Entendo que esse trabalho será perdido
              </label>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || check === null || (loses && !acceptLoss)}
              onClick={() => void confirm()}
            >
              {loses ? 'Remover e descartar' : 'Remover'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
