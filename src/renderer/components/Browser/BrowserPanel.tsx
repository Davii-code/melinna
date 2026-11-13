import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BROWSER_CLOSED, type BrowserBounds, type BrowserState } from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import { normalizeAddress, storeBrowserAddress, storedBrowserAddress } from './address';

const INVALID_ADDRESS = 'Endereço inválido: use um endereço http ou https.';

export interface BrowserPanelProps {
  onClose: () => void;
}

/**
 * Navegador embutido: barra de endereço e histórico na interface; a página em si é uma vista do processo
 * principal, posicionada sobre a área reservada aqui. Fechar o painel fecha a página.
 */
export function BrowserPanel({ onClose }: BrowserPanelProps) {
  const api = useApi();
  const [state, setState] = useState<BrowserState>(BROWSER_CLOSED);
  const [address, setAddress] = useState(() => storedBrowserAddress());
  const [error, setError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const editing = useRef(false);

  const measure = useCallback((): BrowserBounds | null => {
    const el = viewport.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const px = (n: number) => Math.max(0, Math.round(n));
    return { x: px(r.left), y: px(r.top), width: px(r.width), height: px(r.height) };
  }, []);

  useEffect(
    () =>
      api.browser.onState((next) => {
        setState(next);
        if (next.open && next.url && !editing.current) setAddress(next.url);
      }),
    [api],
  );

  useEffect(() => {
    const sync = () => {
      const bounds = measure();
      if (bounds && opened.current) void api.browser.setBounds(bounds);
    };
    window.addEventListener('resize', sync);
    const el = viewport.current;
    const observer = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    if (el) observer?.observe(el);
    return () => {
      window.removeEventListener('resize', sync);
      observer?.disconnect();
      opened.current = false;
      void api.browser.close();
    };
  }, [api, measure]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = async (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeAddress(address);
    if (!url) return setError(INVALID_ADDRESS);
    setError(null);
    setAddress(url);
    storeBrowserAddress(url);
    if (opened.current) {
      const r = await api.browser.navigate(url);
      if (!r.ok) setError(r.error.message);
      return;
    }
    const bounds = measure();
    if (!bounds) return;
    const r = await api.browser.open(url, bounds);
    if (r.ok) opened.current = true;
    else setError(r.error.message);
  };

  const shown = error ?? (state.error ? `Não foi possível carregar a página: ${state.error}` : null);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal browser-modal" role="dialog" aria-modal="true" aria-label="Navegador">
        <form className="browser-toolbar" onSubmit={(e) => void go(e)}>
          <button
            type="button"
            className="icon-button"
            aria-label="Voltar"
            disabled={!state.canGoBack}
            onClick={() => void api.browser.back()}
          >
            ←
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Avançar"
            disabled={!state.canGoForward}
            onClick={() => void api.browser.forward()}
          >
            →
          </button>
          {state.loading ? (
            <button type="button" className="icon-button" aria-label="Parar" onClick={() => void api.browser.stop()}>
              ■
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              aria-label="Recarregar"
              disabled={!state.open}
              onClick={() => void api.browser.reload()}
            >
              ↻
            </button>
          )}
          <input
            className="browser-address"
            aria-label="Endereço"
            placeholder="localhost:3000 ou https://…"
            value={address}
            spellCheck={false}
            autoFocus
            onFocus={() => {
              editing.current = true;
            }}
            onBlur={() => {
              editing.current = false;
            }}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit">Ir</button>
          <button
            type="button"
            disabled={!state.open || state.url === ''}
            title="Abrir esta página no navegador padrão do sistema"
            onClick={() => void api.app.openExternal(state.url)}
          >
            Abrir fora
          </button>
          <button type="button" className="icon-button" aria-label="Fechar navegador" onClick={onClose}>
            ×
          </button>
        </form>
        {shown && (
          <p role="alert" className="error browser-error">
            {shown}
          </p>
        )}
        <div className="browser-viewport" ref={viewport} data-testid="browser-viewport">
          {!state.open && (
            <p className="meta">
              Digite um endereço e pressione Enter. A página abre isolada do app: só http e https, sem downloads
              e sem acesso a câmera, microfone ou localização.
            </p>
          )}
        </div>
        {state.open && state.title && <p className="meta browser-title">{state.title}</p>}
      </div>
    </div>
  );
}
