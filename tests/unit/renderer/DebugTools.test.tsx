import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { DebugTools } from '../../../src/renderer/components/Ide/DebugTools';
import { fakeApi, okR } from '../../support/fake-api';

describe('debug tools', () => {
  it('inspects a stopped thread and invalidates variables when continuing', async () => {
    const api = fakeApi();
    api.ide.call.mockImplementation(async (input) => ({
      ok: true as const,
      value:
        input.method === 'threads'
          ? { threads: [{ id: 1, name: 'Main thread' }] }
          : input.method === 'stackTrace'
            ? { stackFrames: [{ id: 2, name: 'main', line: 10, column: 1 }] }
            : input.method === 'scopes'
              ? { scopes: [{ name: 'Locals', variablesReference: 3 }] }
              : input.method === 'variables'
                ? { variables: [{ name: 'answer', value: '42', variablesReference: 0 }] }
                : {},
    }));
    api.ide.start.mockResolvedValue(okR({ sessionId: 'ide-1', capabilities: {} }));
    render(
      <ApiContext.Provider value={api}>
        <DebugTools
          roots={[{ path: '/repo', label: 'Repo', kind: 'workspace' }]}
          onOpen={vi.fn()}
          onRun={vi.fn()}
        />
      </ApiContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText('Executável do adaptador DAP'), { target: { value: 'adapter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar adaptador DAP' }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Iniciar depuração' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar depuração' }));
    await waitFor(() =>
      expect(api.ide.call).toHaveBeenCalledWith(expect.objectContaining({ method: 'launch' })),
    );
    act(() =>
      api.emitIdeEvent({
        sessionId: 'ide-1',
        protocol: 'dap',
        message: { type: 'event', event: 'stopped', body: { threadId: 1 } },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /main — 10/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Locals' }));
    expect(await screen.findByText('answer = 42')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(screen.queryByText('answer = 42')).toBeNull());
  });
});
