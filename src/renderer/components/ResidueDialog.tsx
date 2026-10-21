import { useState } from 'react';
import { errorMessage, unwrap, useApi } from '../api';

export interface ResidueDialogProps {
  residuePath: string;
  /** Mensagem do erro WORKTREE_RESIDUE que levou ao diálogo. */
  message: string;
  onDone: () => void;
  onCancel: () => void;
}

/** Oferece a limpeza de um resíduo de worktree, mostrando o caminho antes de apagar. */
export function ResidueDialog({ residuePath, message, onDone, onCancel }: ResidueDialogProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.workspace.cleanResidue(residuePath));
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="residue-title">
        <h2 id="residue-title">Resíduo de worktree</h2>
        <div className="confirm">
          <p>{message}</p>
          <p>O conteúdo desta pasta será apagado e o registro no git, removido:</p>
          <code>{residuePath}</code>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => void clean()}>
              Limpar resíduo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
