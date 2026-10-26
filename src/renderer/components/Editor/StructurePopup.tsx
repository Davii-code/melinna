import { useEffect, useMemo, useRef, useState } from 'react';
import { filterSymbols, NO_SYMBOLS, symbolLabel, type FileSymbol } from './extensions/structure';

export interface StructurePopupProps {
  symbols: readonly FileSymbol[];
  onPick: (symbol: FileSymbol) => void;
  /** Fecha o popup; quem abriu devolve o foco ao editor. */
  onClose: () => void;
}

const KIND_LABEL: Record<FileSymbol['kind'], string> = {
  function: 'fn',
  class: 'cls',
  method: 'met',
  interface: 'itf',
  type: 'tipo',
  enum: 'enum',
  key: 'chave',
  selector: 'css',
  element: 'html',
  heading: 'tít',
};

/** Popup "Estrutura do arquivo": lista filtrável dos símbolos; setas escolhem, Enter vai, Esc fecha. */
export function StructurePopup({ symbols, onPick, onClose }: StructurePopupProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const shown = useMemo(() => filterSymbols(symbols, query), [symbols, query]);
  const current = Math.min(active, Math.max(0, shown.length - 1));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(current + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const symbol = shown[current];
      if (symbol) {
        onPick(symbol);
        onClose();
      }
    }
  };

  return (
    <div className="modal-backdrop editor-popup-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal editor-popup structure-popup"
        role="dialog"
        aria-modal="true"
        aria-label="Estrutura do arquivo"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <input
          ref={input}
          type="text"
          aria-label="Filtrar símbolos"
          placeholder="Digite para filtrar"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        {symbols.length === 0 ? (
          <p className="run-empty">{NO_SYMBOLS}</p>
        ) : shown.length === 0 ? (
          <p className="run-empty">Nenhum resultado</p>
        ) : (
          <ul role="listbox" aria-label="Símbolos" className="structure-list">
            {shown.map((symbol, i) => (
              <li
                key={`${symbol.from}-${symbol.name}`}
                role="option"
                aria-selected={i === current}
                className={`structure-item${i === current ? ' active' : ''}`}
                style={{ paddingLeft: 10 + symbol.depth * 14 }}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(symbol);
                  onClose();
                }}
              >
                <span className="structure-kind" aria-hidden="true">
                  {KIND_LABEL[symbol.kind]}
                </span>
                <span className="structure-name">{symbolLabel(symbol)}</span>
                <span className="structure-line">{symbol.line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
