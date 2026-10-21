import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TerminalLike } from '../../terminal/xterm-types';

/** Ctrl+Shift+F, sem Alt nem Meta. */
export function isSearchShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'f';
}

export interface TerminalSearchProps {
  terminal: Pick<TerminalLike, 'search' | 'clearSearch' | 'focus'>;
  onClose: () => void;
}

/** Caixa de busca no histórico do terminal: Enter/Shift+Enter navegam, Esc fecha e devolve o foco. */
export function TerminalSearch({ terminal, onClose }: TerminalSearchProps) {
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const find = (direction: 'next' | 'previous') => {
    if (query.length === 0) return;
    setNotFound(!terminal.search(query, direction));
  };

  const close = () => {
    terminal.clearSearch();
    terminal.focus();
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      find(e.shiftKey ? 'previous' : 'next');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="terminal-search" role="search">
      <input
        ref={input}
        type="search"
        aria-label="Buscar no terminal"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="icon-button" aria-label="Resultado anterior" onClick={() => find('previous')}>
        ↑
      </button>
      <button type="button" className="icon-button" aria-label="Próximo resultado" onClick={() => find('next')}>
        ↓
      </button>
      {notFound && <span className="meta">sem resultados</span>}
      <button type="button" className="icon-button" aria-label="Fechar busca" onClick={close}>
        ×
      </button>
    </div>
  );
}
