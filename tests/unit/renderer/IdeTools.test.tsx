import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { HttpTools } from '../../../src/renderer/components/Ide/HttpTools';
import { DatabaseTools } from '../../../src/renderer/components/Ide/DatabaseTools';
import { ToolLaunch } from '../../../src/renderer/components/Ide/ToolLaunch';
import { fakeApi, okR } from '../../support/fake-api';

describe('IDE tools', () => {
  it('only sends HTTP after an explicit action and renders its response as text', async () => {
    const api = fakeApi();
    api.ide.httpSend.mockResolvedValue(
      okR({
        status: 200,
        headers: {},
        body: '<script>danger()</script>',
        durationMs: 1,
        truncated: false,
        binary: false,
      }),
    );
    render(
      <ApiContext.Provider value={api}>
        <HttpTools />
      </ApiContext.Provider>,
    );
    expect(api.ide.httpSend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar requisição' }));
    expect(await screen.findByText('<script>danger()</script>')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });
  it('opens SQLite explicitly and allows only query interactions', async () => {
    const api = fakeApi();
    api.ide.dbQuery.mockResolvedValue(okR({ columns: ['name'], rows: [['items']], truncated: false }));
    render(
      <ApiContext.Provider value={api}>
        <DatabaseTools />
      </ApiContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText('Arquivo SQLite'), { target: { value: '/repo/data.sqlite' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir somente leitura' }));
    await waitFor(() => expect(api.ide.dbOpen).toHaveBeenCalledWith('/repo/data.sqlite'));
    expect(await screen.findByText('items')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar conexão' }));
    await waitFor(() => expect(api.ide.dbClose).toHaveBeenCalledWith('db-1'));
  });
  it('never starts a language server from mounting a configuration form', async () => {
    const api = fakeApi();
    const onSession = vi.fn(),
      onError = vi.fn();
    render(
      <ApiContext.Provider value={api}>
        <ToolLaunch
          protocol="lsp"
          roots={[{ path: '/repo', kind: 'workspace', label: 'Repo' }]}
          onSession={onSession}
          onError={onError}
        />
      </ApiContext.Provider>,
    );
    expect(api.ide.start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Executável do servidor LSP'), {
      target: { value: '/usr/bin/node' },
    });
    fireEvent.change(screen.getByLabelText('Argumentos JSON'), {
      target: { value: '["/tools/server.js","--stdio"]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar servidor LSP' }));
    await waitFor(() =>
      expect(api.ide.start).toHaveBeenCalledWith({
        protocol: 'lsp',
        root: '/repo',
        executable: '/usr/bin/node',
        args: ['/tools/server.js', '--stdio'],
      }),
    );
    await waitFor(() => expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'ide-1' })));
    act(() => api.emitIdeEvent({ sessionId: 'ide-1', protocol: 'lsp', message: { kind: 'closed' } }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('encerrada'));
  });
});
