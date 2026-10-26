import { useEffect, useState } from 'react';
import type { FileDiff } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { FileSection } from '../DiffView/DiffView';

export interface DiffPaneProps {
  /** Raiz do repositório. */
  root: string;
  /** Caminho do arquivo, relativo à raiz. */
  path: string;
  onClose: () => void;
}

/** Diff do arquivo escolhido no painel Commit, na área principal sobre a grade. */
export function DiffPane({ root, path, onClose }: DiffPaneProps) {
  const api = useApi();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDiff(null);
    setError(null);
    unwrap(api.git.diffFile(root, path)).then(
      (d) => alive && setDiff(d),
      (err: unknown) => alive && setError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, root, path]);

  return (
    <section className="diff-pane" aria-label="Diff do arquivo">
      <header className="diff-toolbar">
        <h2 className="diff-pane-title" title={`${root}/${path}`}>
          {path}
        </h2>
        <span className="spacer" />
        <button type="button" onClick={onClose}>
          Fechar diff
        </button>
      </header>
      <div className="diff-pane-body">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!error && diff === null && <p className="meta">Calculando o diff…</p>}
        {diff && <FileSection file={diff} mode="unified" />}
      </div>
    </section>
  );
}
