import { useEffect, useRef } from 'react';
import type { CloseChoice } from '../../shared/ipc-contract';

export interface CloseDialogProps {
  liveCount: number;
  onAnswer: (choice: CloseChoice) => void;
}

/** Fechar com execuções vivas: "Manter rodando" é o padrão (foco e Enter); Esc cancela. */
export function CloseDialog({ liveCount, onAnswer }: CloseDialogProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnswer('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);
  return (
    <div className="modal-backdrop close-dialog-backdrop" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="close-title">
        <h2 id="close-title">Fechar o Melinna</h2>
        <p>
          {liveCount === 1 ? 'Há 1 execução viva.' : `Há ${liveCount} execuções vivas.`} Os agentes podem
          continuar rodando em segundo plano e os painéis voltam com o histórico quando você reabrir o app.
        </p>
        <div className="actions">
          <button type="button" onClick={() => onAnswer('cancel')}>
            Cancelar
          </button>
          <button type="button" className="danger" onClick={() => onAnswer('stop-all')}>
            Encerrar todos
          </button>
          <button type="button" className="primary" ref={keepRef} onClick={() => onAnswer('keep-running')}>
            Manter rodando em segundo plano
          </button>
        </div>
      </div>
    </div>
  );
}
