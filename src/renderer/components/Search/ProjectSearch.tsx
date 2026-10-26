import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSearchResult, SearchHit } from '../../../shared/ipc-contract';
import { useApi } from '../../api';

export interface ProjectSearchProps {
  /** Pastas do workspace ativo onde buscar. */
  roots: readonly string[];
  /** Texto já preenchido (a seleção do editor); busca na hora quando vem. */
  initialText?: string;
  /** Abre o arquivo na linha e destaca a ocorrência; o popup fecha em seguida. */
  onOpen: (hit: SearchHit) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'searching' | 'done' | 'error';

const DEBOUNCE_MS = 300;
const PREVIEW_CONTEXT = 3;
const TOO_MANY = 'Resultados demais, refine a busca.';

function relativeTo(path: string, roots: readonly string[]): string {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const target = norm(path);
  for (const root of roots) {
    const base = norm(root).replace(/\/+$/, '');
    if (target.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return target.slice(base.length + 1);
  }
  return target;
}

function Highlighted({ hit }: { hit: SearchHit }) {
  return (
    <>
      {hit.preview.slice(0, hit.matchStart)}
      <mark>{hit.preview.slice(hit.matchStart, hit.matchEnd)}</mark>
      {hit.preview.slice(hit.matchEnd)}
    </>
  );
}

/**
 * Popup "Buscar no projeto": campo, opções, lista de resultados agrupados por arquivo e prévia do trecho.
 * A busca roda no principal; começar outra (ou apagar o texto) cancela a anterior.
 */
export function ProjectSearch({ roots, initialText = '', onOpen, onClose }: ProjectSearchProps) {
  const api = useApi();
  const [text, setText] = useState(initialText);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [include, setInclude] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ProjectSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<string[] | null>(null);
  /** A consulta (texto e opções) a que os resultados mostrados respondem. */
  const [answered, setAnswered] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const searching = useRef(false);

  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => result?.hits ?? [], [result]);
  const groups = useMemo(() => {
    const byFile = new Map<string, { hit: SearchHit; index: number }[]>();
    hits.forEach((hit, index) => {
      byFile.set(hit.path, [...(byFile.get(hit.path) ?? []), { hit, index }]);
    });
    return [...byFile.entries()];
  }, [hits]);

  /** Cancela o que está rodando no principal: texto vazio só cancela. */
  const cancelRunning = useCallback(() => {
    if (!searching.current) return;
    searching.current = false;
    sequence.current++;
    void api.files.searchProject({
      roots: [...roots],
      text: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  }, [api, roots]);

  const run = useCallback(
    async (query: string) => {
      const mine = ++sequence.current;
      if (query === '') {
        cancelRunning();
        setPhase('idle');
        setResult(null);
        setError(null);
        return;
      }
      const key = JSON.stringify([query, caseSensitive, wholeWord, regex, include]);
      searching.current = true;
      setPhase('searching');
      setError(null);
      const r = await api.files.searchProject({
        roots: [...roots],
        text: query,
        caseSensitive,
        wholeWord,
        regex,
        ...(include.trim() === '' ? {} : { include: include.trim() }),
      });
      if (mine !== sequence.current) return;
      searching.current = false;
      if (!r.ok) {
        setResult(null);
        setError(r.error.code === 'SEARCH_CANCELLED' ? null : r.error.message);
        setPhase(r.error.code === 'SEARCH_CANCELLED' ? 'idle' : 'error');
        return;
      }
      setResult(r.value);
      setAnswered(key);
      setActive(0);
      setPhase('done');
    },
    [api, roots, caseSensitive, wholeWord, regex, include, cancelRunning],
  );

  // Busca ao digitar (com um respiro) e ao mudar uma opção; o texto inicial busca na hora.
  const first = useRef(true);
  useEffect(() => {
    const delay = first.current && initialText !== '' ? 0 : DEBOUNCE_MS;
    first.current = false;
    const t = setTimeout(() => void run(text), delay);
    return () => clearTimeout(t);
    // `run` já depende das opções; `text` entra aqui por ser o que o usuário digita.
  }, [text, run, initialText]);

  const current = hits[active];
  const fresh = answered === JSON.stringify([text, caseSensitive, wholeWord, regex, include]);

  // Prévia: as linhas em volta da ocorrência ativa, lidas do arquivo.
  useEffect(() => {
    if (!current) {
      setLines(null);
      return;
    }
    let alive = true;
    void api.files.read(current.path).then((r) => {
      if (!alive) return;
      setLines(r.ok && !r.value.binary ? r.value.content.split(/\r\n|\n|\r/) : null);
    });
    return () => {
      alive = false;
    };
  }, [api, current]);

  const close = () => {
    cancelRunning();
    onClose();
  };
  const open = (hit: SearchHit) => {
    onOpen(hit);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
  };

  return (
    <div className="modal-backdrop editor-popup-backdrop" role="presentation" onMouseDown={close}>
      <div
        className="modal editor-popup project-search"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar no projeto"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <form
          className="project-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (phase === 'done' && fresh && current) open(current);
            else void run(text);
          }}
        >
          <input
            ref={input}
            type="text"
            aria-label="Texto da busca"
            placeholder="Buscar no projeto"
            value={text}
            aria-invalid={phase === 'error'}
            aria-describedby={error !== null ? 'project-search-error' : undefined}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="project-search-options">
            <label className="check">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              Maiúsculas
            </label>
            <label className="check">
              <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
              Palavra inteira
            </label>
            <label className="check">
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
              Expressão regular
            </label>
            <label>
              Arquivos
              <input
                type="text"
                value={include}
                placeholder="*.ts, src/**"
                spellCheck={false}
                onChange={(e) => setInclude(e.target.value)}
              />
            </label>
          </div>
          {error !== null && (
            <p id="project-search-error" role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>

        {phase === 'searching' && (
          <div className="project-search-status" role="status">
            <span>Buscando…</span>
            <button
              type="button"
              onClick={() => {
                cancelRunning();
                setPhase('idle');
              }}
            >
              Cancelar
            </button>
          </div>
        )}

        {phase === 'done' && result !== null && (
          <>
            <div className="project-search-body">
              {hits.length === 0 ? (
                <p className="run-empty">Nenhum resultado</p>
              ) : (
                <ul role="listbox" aria-label="Resultados" className="project-search-results">
                  {groups.map(([path, entries]) => (
                    <li key={path} role="presentation" className="project-search-file">
                      <div className="project-search-path" title={path}>
                        {relativeTo(path, roots)} <span className="count">{entries.length}</span>
                      </div>
                      <ul role="presentation">
                        {entries.map(({ hit, index }) => (
                          <li
                            key={`${hit.line}:${hit.column}`}
                            role="option"
                            aria-selected={index === active}
                            className={`project-search-hit${index === active ? ' active' : ''}`}
                            onMouseEnter={() => setActive(index)}
                            onClick={() => open(hit)}
                          >
                            <span className="project-search-line">{hit.line}</span>
                            <span className="project-search-snippet">
                              <Highlighted hit={hit} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              {current && lines !== null && (
                <pre className="project-search-preview" aria-label="Prévia">
                  {lines
                    .map((line, i) => ({ line, n: i + 1 }))
                    .slice(Math.max(0, current.line - 1 - PREVIEW_CONTEXT), current.line + PREVIEW_CONTEXT)
                    .map(({ line, n }) => (
                      <div key={n} className={n === current.line ? 'preview-line current' : 'preview-line'}>
                        <span className="preview-n">{n}</span>
                        {line}
                      </div>
                    ))}
                </pre>
              )}
            </div>
            <div className="project-search-footer">
              {result.truncated && <p className="hint">{TOO_MANY}</p>}
              {result.skipped > 0 && (
                <p className="hint">{`${result.skipped} arquivo(s) sem permissão de leitura foram pulados.`}</p>
              )}
              <p className="hint">
                {hits.length} resultado(s) em {result.scannedFiles} arquivo(s) lido(s)
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
