import { useEffect, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação genérica; Esc cancela. */
export function ConfirmDialog({ title, children, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="confirm">
          {children}
          <div className="actions">
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
