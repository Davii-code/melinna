import { useEffect, useMemo, useState } from 'react';
import type { FileRoot } from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import { buildFileIndex, filterIndex, type FileIndex } from '../../files/index';

export interface QuickOpenProps {
  roots: readonly FileRoot[];
  /** Raiz preferida (a do arquivo em foco); sem ela, a primeira raiz de workspace. */
  preferredRoot?: string | null;
  onPick(path: string): void;
  onClose(): void;
}

function resolveRoot(roots: readonly FileRoot[], preferred?: string | null): FileRoot | null {
  if (preferred) {
    const hit = roots.find((root) => preferred.startsWith(root.path));
    if (hit) return hit;
  }
  return roots.find((root) => root.kind === 'workspace') ?? roots[0] ?? null;
}

/** "Ir para arquivo" (Ctrl+P): índice da raiz ativa e filtro por nome/caminho. */
export function QuickOpen({ roots, preferredRoot, onPick, onClose }: QuickOpenProps) {
  const api = useApi();
  const root = resolveRoot(roots, preferredRoot);
  const [index, setIndex] = useState<FileIndex | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (root === null) return;
    let alive = true;
    void buildFileIndex((path) => api.files.list(path), root.path).then((built) => {
      if (alive) setIndex(built);
    });
    return () => {
      alive = false;
    };
  }, [api, root]);

  const matches = useMemo(
    () => (index === null ? [] : filterIndex(index.files, query)),
    [index, query],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const pick = (path: string) => {
    onPick(path);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Ir para arquivo"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="quick-open-input"
          placeholder="Ir para arquivo…"
          aria-label="Filtrar arquivos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.max(0, matches.length - 1)));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const path = matches[cursor];
              if (path !== undefined) pick(path);
            }
          }}
        />
        <div className="quick-open-meta">
          {root === null
            ? 'Nenhuma pasta aberta.'
            : index === null
              ? `Indexando ${root.label}…`
              : `${matches.length} de ${index.files.length} arquivos${index.truncated ? ' (índice incompleto)' : ''}`}
        </div>
        <ul className="quick-open-list" role="listbox" aria-label="Arquivos">
          {matches.map((path, i) => (
            <li key={path}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`quick-open-item${i === cursor ? ' active' : ''}`}
                onClick={() => pick(path)}
                onMouseEnter={() => setCursor(i)}
                title={path}
              >
                <span className="quick-open-name">{path.split(/[\\/]/).pop()}</span>
                <span className="quick-open-path">{path}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
