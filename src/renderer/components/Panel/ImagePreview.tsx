import { useEffect, useState } from 'react';
import type { Execution, ImageCheck } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';

export interface ImagePreviewProps {
  execution: Execution;
  check: ImageCheck;
  /** Fecha a prévia; `notice` é um aviso para o painel (execução que terminou, por exemplo). */
  onClose: (notice?: string) => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A execução ainda recebe digitação? Só então a referência pode ser escrita no terminal. */
function acceptsInput(execution: Execution): boolean {
  return execution.status === 'running' || execution.status === 'idle';
}

/**
 * Prévia das imagens antes de ir para o prompt do agente: miniatura e nome de cada uma, as recusadas com o
 * motivo, "Enviar" e "Cancelar". Enviar escreve só a referência, sem Enter; nada é enviado sem o clique.
 */
export function ImagePreview({ execution, check, onClose }: ImagePreviewProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = acceptsInput(execution);

  useEffect(() => {
    if (!live) onClose('A execução terminou: as imagens não foram enviadas.');
  }, [live, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        api.attachments.send(
          execution.id,
          check.accepted.map((image) => image.path),
        ),
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const count = check.accepted.length;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal image-preview" role="dialog" aria-modal="true" aria-labelledby="image-preview-title">
        <h2 id="image-preview-title">{count === 1 ? 'Anexar imagem' : 'Anexar imagens'}</h2>
        {count > 0 && (
          <ul className="image-preview-list">
            {check.accepted.map((image) => (
              <li key={image.path} title={image.path}>
                {image.thumbnail ? (
                  <img src={image.thumbnail} alt={baseName(image.path)} />
                ) : (
                  <span className="image-preview-placeholder" aria-hidden="true">
                    {image.type.toUpperCase()}
                  </span>
                )}
                <span className="image-preview-name">{baseName(image.path)}</span>
                <span className="meta">{formatSize(image.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
        {check.rejected.length > 0 && (
          <div className="image-preview-rejected">
            <p className="warning">
              {check.rejected.length === 1 ? 'Não anexada:' : 'Não anexadas:'}
            </p>
            <ul>
              {check.rejected.map((r) => (
                <li key={r.path}>
                  <span className="image-preview-name">{baseName(r.path)}</span>
                  <span className="meta">{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {count > 0 && <p className="meta">A referência vai para o prompt; você aperta Enter para mandar.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={() => onClose()} disabled={busy}>
            {count > 0 ? 'Cancelar' : 'Fechar'}
          </button>
          {count > 0 && (
            <button type="button" className="primary" onClick={() => void send()} disabled={busy}>
              Enviar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
