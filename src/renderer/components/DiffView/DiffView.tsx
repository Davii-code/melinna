import { useEffect, useState } from 'react';
import type { DiffResult, FileDiff } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { FileList, fileAnchor, fileTitle, CHANGE_LABEL } from './FileList';
import { SideBySideView } from './SideBySideView';
import { UnifiedView } from './UnifiedView';

/** Arquivos com mais linhas que isso vêm recolhidos. */
export const COLLAPSE_LINES = 5000;

export type DiffMode = 'unified' | 'split';

export function formatSize(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (n < 1024 * 1024) return `${fmt(n / 1024)} KB`;
  return `${fmt(n / (1024 * 1024))} MB`;
}

function FileSection({ file, mode }: { file: FileDiff; mode: DiffMode }) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = file.lineCount > COLLAPSE_LINES && !expanded;
  return (
    <section className="diff-file" id={fileAnchor(file.path)} data-testid={`diff-file-${file.path}`}>
      <header className="diff-file-header">
        <span className="diff-path">{fileTitle(file)}</span>
        <span className={`diff-change diff-change-${file.change}`}>{CHANGE_LABEL[file.change]}</span>
      </header>
      {file.binary ? (
        <p className="meta">
          Binário alterado: {formatSize(file.binary.oldSize)} → {formatSize(file.binary.newSize)}
        </p>
      ) : file.hunks.length === 0 ? (
        <p className="meta">Sem alteração de conteúdo.</p>
      ) : collapsed ? (
        <button type="button" onClick={() => setExpanded(true)}>
          Mostrar {file.lineCount.toLocaleString('pt-BR')} linhas
        </button>
      ) : mode === 'unified' ? (
        <UnifiedView file={file} />
      ) : (
        <SideBySideView file={file} />
      )}
    </section>
  );
}

export interface DiffViewProps {
  execId: string;
  title: string;
  onClose: () => void;
}

/** Diff da execução contra o ponto de partida, em modo unificado ou lado a lado (calculado uma vez). */
export function DiffView({ execId, title, onClose }: DiffViewProps) {
  const api = useApi();
  const [result, setResult] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DiffMode>('unified');

  useEffect(() => {
    let alive = true;
    unwrap(api.executions.diff(execId)).then(
      (r) => alive && setResult(r),
      (err: unknown) => alive && setError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, execId]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal diff-modal" role="dialog" aria-modal="true" aria-labelledby="diff-title">
        <header className="diff-toolbar">
          <h2 id="diff-title">Diff: {title}</h2>
          <span className="spacer" />
          <button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>
            Unificado
          </button>
          <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>
            Lado a lado
          </button>
          <button type="button" className="icon-button" aria-label="Fechar diff" onClick={onClose}>
            ×
          </button>
        </header>
        {error && <p className="error">{error}</p>}
        {!error && result === null && <p className="meta">Calculando o diff…</p>}
        {result && result.files.length === 0 && <p>Nenhuma alteração em relação ao ponto de partida.</p>}
        {result && result.files.length > 0 && (
          <div className="diff-body">
            <FileList files={result.files} />
            <div className="diff-files">
              {result.files.map((f) => (
                <FileSection key={f.path} file={f} mode={mode} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
