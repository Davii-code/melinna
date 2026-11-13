import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import {
  normalizeAddress,
  storeBrowserAddress,
  storedBrowserAddress,
} from '../../../src/renderer/components/Browser/address';
import { BrowserPanel } from '../../../src/renderer/components/Browser/BrowserPanel';
import type { BrowserState } from '../../../src/shared/ipc-contract';
import { fakeApi } from '../../support/fake-api';

const OPEN: BrowserState = {
  open: true,
  url: 'https://example.com/',
  title: 'Exemplo',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
};

function setup() {
  localStorage.clear();
  const api = fakeApi();
  const onClose = vi.fn();
  const view = render(
    <ApiContext.Provider value={api}>
      <BrowserPanel onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onClose, ...view };
}

const address = () => screen.getByLabelText('Endereço') as HTMLInputElement;

function type(text: string) {
  fireEvent.change(address(), { target: { value: text } });
  fireEvent.submit(address());
}

describe('normalizeAddress', () => {
  it('adds http to local servers and https to everything else', () => {
    expect(normalizeAddress('localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeAddress('127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app');
    expect(normalizeAddress('example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeAddress('  https://example.com  ')).toBe('https://example.com/');
    expect(normalizeAddress('http://example.com')).toBe('http://example.com/');
  });

  it('refuses other schemes, empty text and text with spaces', () => {
    for (const bad of ['', '   ', 'file:///etc/passwd', 'javascript:alert(1)', 'app://melinna/', 'duas palavras']) {
      expect(normalizeAddress(bad)).toBeNull();
    }
  });
});

describe('browser address storage', () => {
  it('remembers the last address and survives an unavailable storage', () => {
    localStorage.clear();
    expect(storedBrowserAddress()).toBe('');
    storeBrowserAddress('http://localhost:3000/');
    expect(storedBrowserAddress()).toBe('http://localhost:3000/');
    const broken = {
      getItem: () => {
        throw new Error('negado');
      },
      setItem: () => {
        throw new Error('negado');
      },
    };
    expect(storedBrowserAddress(broken)).toBe('');
    expect(() => storeBrowserAddress('x', broken)).not.toThrow();
  });
});

describe('BrowserPanel', () => {
  it('opens nothing until an address is entered', () => {
    const { api } = setup();
    expect(api.browser.open).not.toHaveBeenCalled();
    expect(screen.getByText(/Digite um endereço/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Recarregar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the normalized address in the reserved area and remembers it', async () => {
    const { api } = setup();
    type('localhost:3000');
    await waitFor(() => expect(api.browser.open).toHaveBeenCalledTimes(1));
    expect(api.browser.open.mock.calls[0]?.[0]).toBe('http://localhost:3000/');
    expect(api.browser.open.mock.calls[0]?.[1]).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(storedBrowserAddress()).toBe('http://localhost:3000/');
  });

  it('navigates in the open page on the next address', async () => {
    const { api } = setup();
    type('example.com');
    await waitFor(() => expect(api.browser.open).toHaveBeenCalledTimes(1));
    type('example.com/docs');
    await waitFor(() => expect(api.browser.navigate).toHaveBeenCalledWith('https://example.com/docs'));
    expect(api.browser.open).toHaveBeenCalledTimes(1);
  });

  it('refuses an address that is not http or https without calling the main process', () => {
    const { api } = setup();
    type('file:///etc/passwd');
    expect(screen.getByRole('alert').textContent).toMatch(/Endereço inválido/);
    expect(api.browser.open).not.toHaveBeenCalled();
  });

  it('follows the state of the page: address, history buttons, loading and title', () => {
    const { api } = setup();
    act(() => api.emitBrowserState({ ...OPEN, canGoBack: true, loading: true }));
    fireEvent.blur(address());
    act(() => api.emitBrowserState({ ...OPEN, url: 'https://example.com/docs', canGoBack: true }));
    expect(address().value).toBe('https://example.com/docs');
    expect(screen.getByText('Exemplo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(api.browser.back).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Avançar' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => api.emitBrowserState({ ...OPEN, loading: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    expect(api.browser.stop).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite the address while it is being typed', () => {
    const { api } = setup();
    fireEvent.focus(address());
    fireEvent.change(address(), { target: { value: 'exam' } });
    act(() => api.emitBrowserState(OPEN));
    expect(address().value).toBe('exam');
  });

  it('shows a failed load and the refusal of the main process', async () => {
    const { api } = setup();
    act(() => api.emitBrowserState({ ...OPEN, error: 'ERR_CONNECTION_REFUSED' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'Não foi possível carregar a página: ERR_CONNECTION_REFUSED',
    );
    api.browser.open.mockImplementation(
      () => Promise.resolve({ ok: false, error: { code: 'INPUT_INVALID', message: 'Link inválido.' } }) as never,
    );
    type('example.com');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Link inválido.'));
  });

  it('opens the current page in the system browser', () => {
    const { api } = setup();
    act(() => api.emitBrowserState(OPEN));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir fora' }));
    expect(api.app.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('closes the page when the panel closes, by the button or by Escape', () => {
    const { api, onClose, unmount } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar navegador' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(api.browser.close).not.toHaveBeenCalled();
    unmount();
    expect(api.browser.close).toHaveBeenCalledTimes(1);
  });
});
