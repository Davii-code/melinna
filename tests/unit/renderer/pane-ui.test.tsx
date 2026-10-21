import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ExecutionTabs } from '../../../src/renderer/components/Panel/ExecutionTabs';
import { QuickOpen } from '../../../src/renderer/components/QuickOpen/QuickOpen';
import type { FileRoot } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { agentDef, execution } from '../../support/renderer-fixtures';

const EXECS = [execution('e1', { agentId: 'claude' }), execution('e2', { agentId: 'codex' })];
const agentOf = (id: string) => agentDef(id, { displayName: id === 'claude' ? 'Claude' : 'Codex' });

describe('ExecutionTabs', () => {
  it('shows one tab per execution and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <ExecutionTabs
        execs={EXECS}
        activeIndex={0}
        agentOf={agentOf}
        onSelect={onSelect}
        onCloseTab={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /Claude/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Codex/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('closes the tab it belongs to', () => {
    const onCloseTab = vi.fn();
    render(
      <ExecutionTabs
        execs={EXECS}
        activeIndex={1}
        agentOf={agentOf}
        onSelect={vi.fn()}
        onCloseTab={onCloseTab}
      />,
    );
    fireEvent.click(screen.getByLabelText('Fechar aba Claude'));
    expect(onCloseTab).toHaveBeenCalledWith(0);
  });
});

const ROOT: FileRoot = { path: '/ws', label: 'site', kind: 'workspace' };

function setup(roots: FileRoot[] = [ROOT], onPick = vi.fn()) {
  const api = fakeApi();
  api.files.list.mockImplementation((path: string) =>
    okR({
      path,
      truncated: false,
      entries:
        path === '/ws'
          ? [
              { name: 'src', path: '/ws/src', kind: 'directory' as const, size: 0 },
              { name: 'README.md', path: '/ws/README.md', kind: 'file' as const, size: 10 },
            ]
          : path === '/ws/src'
            ? [{ name: 'main.ts', path: '/ws/src/main.ts', kind: 'file' as const, size: 20 }]
            : [],
    }),
  );
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <QuickOpen roots={roots} onPick={onPick} onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onPick, onClose };
}

describe('QuickOpen', () => {
  it('indexes the workspace root and filters by typing', async () => {
    const { onPick } = setup();
    expect(await screen.findByText(/de 2 arquivos/)).toBeTruthy();
    const input = screen.getByLabelText('Filtrar arquivos');
    fireEvent.change(input, { target: { value: 'main' } });
    expect(screen.getByRole('option', { name: /main\.ts/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /main\.ts/ }));
    expect(onPick).toHaveBeenCalledWith('/ws/src/main.ts');
  });

  it('opens the first match with Enter and closes with Escape', async () => {
    const { onPick, onClose } = setup();
    await screen.findByText(/de 2 arquivos/);
    const input = screen.getByLabelText('Filtrar arquivos');
    fireEvent.change(input, { target: { value: 'README' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('/ws/README.md');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('says when no folder is open', async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText(/Nenhuma pasta aberta/)).toBeTruthy());
  });
});
