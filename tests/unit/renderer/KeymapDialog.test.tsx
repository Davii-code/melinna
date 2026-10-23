import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { EditorPane } from '../../../src/renderer/components/Editor/EditorPane';
import { RunBar } from '../../../src/renderer/components/Run/RunBar';
import { KeymapDialog } from '../../../src/renderer/components/Settings/KeymapDialog';
import { SidebarRail } from '../../../src/renderer/components/SidebarResizer';
import { TopBar } from '../../../src/renderer/components/TopBar';
import { ACTIONS, ACTION_LABEL, KEYMAPS, formatChord } from '../../../src/renderer/keymap/keymaps';
import {
  KeymapContext,
  createKeymapStore,
  type KeymapStore,
} from '../../../src/renderer/keymap/keymap-store';
import { createRunStore } from '../../../src/renderer/store/run-store';
import type { KeymapId, Pane } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { execution, runCommand } from '../../support/renderer-fixtures';

async function dialogSetup(initial: KeymapId = 'windows') {
  const api = fakeApi();
  api.prefs.get.mockImplementation(() => okR({ keymap: initial, activeRun: null, readOnly: false }));
  const onError = vi.fn();
  const store: KeymapStore = createKeymapStore(api, onError);
  await store.load();
  const onClose = vi.fn();
  render(<KeymapDialog store={store} onClose={onClose} />);
  return { api, store, onError, onClose };
}

const dialog = () => screen.getByRole('dialog', { name: 'Mapa de atalhos' });

describe('KeymapDialog', () => {
  it('lists the four maps with the current one selected', async () => {
    await dialogSetup('intellij');
    const radios = within(dialog()).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      'windows',
      'intellij',
      'eclipse',
      'vscode',
    ]);
    expect(within(dialog()).getByRole('radio', { name: /IntelliJ IDEA/ })).toHaveProperty('checked', true);
    expect(within(dialog()).getByRole('radio', { name: /Windows/ })).toHaveProperty('checked', false);
  });

  it('shows the table of each map with all seven actions', async () => {
    await dialogSetup();
    const tables = within(dialog()).getAllByRole('table');
    expect(tables).toHaveLength(4);
    const intellij = tables[1] as HTMLElement;
    const rows = within(intellij).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(ACTIONS.length);
    for (const action of ACTIONS) {
      const chord = KEYMAPS.intellij[action];
      const row = within(intellij).getByText(ACTION_LABEL[action]).closest('tr') as HTMLElement;
      expect(row.textContent).toContain(chord === null ? '—' : formatChord(chord, false));
    }
  });

  it('marks an action without a key in the map', async () => {
    await dialogSetup();
    const eclipse = within(dialog()).getAllByRole('table')[2] as HTMLElement;
    const row = within(eclipse).getByText(ACTION_LABEL.toggleSidebar).closest('tr') as HTMLElement;
    expect(row.textContent).toContain('—');
  });

  it('choosing a map saves it through prefs.setKeymap and applies right away', async () => {
    const { api, store } = await dialogSetup();
    fireEvent.click(within(dialog()).getByRole('radio', { name: /VS Code/ }));
    await waitFor(() => expect(api.prefs.setKeymap).toHaveBeenCalledWith('vscode'));
    expect(store.get()).toBe('vscode');
    expect(within(dialog()).getByRole('radio', { name: /VS Code/ })).toHaveProperty('checked', true);
  });

  it('goes back to the previous map and reports the error when saving fails', async () => {
    const { api, store, onError } = await dialogSetup('eclipse');
    api.prefs.setKeymap.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'IO_ERROR' as const, message: 'Falha ao gravar no disco.' },
      }),
    );
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Windows/ }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(store.get()).toBe('eclipse');
  });

  it('closes with the button and with Escape', async () => {
    const { onClose } = await dialogSetup();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Fechar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('dicas com a tecla do mapa atual', () => {
  const PANE: Extract<Pane, { kind: 'editor' }> = {
    id: 'editor-1',
    kind: 'editor',
    docs: ['/ws/a.ts'],
    activeIndex: 0,
  };

  it('the editor save button shows the key of the map', () => {
    const api = fakeApi();
    const view = (keymap: KeymapId) => (
      <ApiContext.Provider value={api}>
        <KeymapContext.Provider value={keymap}>
          <EditorPane
            pane={PANE}
            focused
            onFocus={() => undefined}
            onSelect={() => undefined}
            onCloseTab={() => undefined}
            renderEditor={() => null}
          />
        </KeymapContext.Provider>
      </ApiContext.Provider>
    );
    const { rerender } = render(view('windows'));
    expect(screen.getByRole('button', { name: 'Salvar' }).getAttribute('title')).toBe('Salvar (Ctrl+S)');
    rerender(view('intellij'));
    expect(screen.getByRole('button', { name: 'Salvar' }).getAttribute('title')).toBe('Salvar (Ctrl+S)');
  });

  it('the top bar button names the current map', () => {
    const view = (keymap: KeymapId) => (
      <KeymapContext.Provider value={keymap}>
        <TopBar onNewTask={() => undefined} freeSlots={3} onShortcuts={() => undefined} />
      </KeymapContext.Provider>
    );
    const { rerender } = render(view('windows'));
    expect(screen.getByRole('button', { name: 'Atalhos' }).getAttribute('title')).toBe(
      'Mapa de atalhos: Windows',
    );
    rerender(view('eclipse'));
    expect(screen.getByRole('button', { name: 'Atalhos' }).getAttribute('title')).toBe(
      'Mapa de atalhos: Eclipse',
    );
  });

  it('the sidebar rail hint follows the map and drops the key when the map has none', () => {
    const view = (keymap: KeymapId) => (
      <KeymapContext.Provider value={keymap}>
        <SidebarRail onExpand={() => undefined} />
      </KeymapContext.Provider>
    );
    const { rerender } = render(view('windows'));
    expect(screen.getByRole('button', { name: 'Mostrar barra lateral' }).getAttribute('title')).toBe(
      'Mostrar barra lateral (Ctrl+Shift+B)',
    );
    rerender(view('intellij'));
    expect(screen.getByRole('button', { name: 'Mostrar barra lateral' }).getAttribute('title')).toBe(
      'Mostrar barra lateral (Ctrl+Shift+F12)',
    );
    rerender(view('eclipse'));
    expect(screen.getByRole('button', { name: 'Mostrar barra lateral' }).getAttribute('title')).toBe(
      'Mostrar barra lateral',
    );
  });

  it('the run bar play button and stop item show the keys of the map', async () => {
    const api = fakeApi();
    const group = {
      id: 'g1',
      name: 'App',
      order: 0,
      folders: [{ id: 'f1', path: '/repo' }],
      primaryFolderId: 'f1',
    };
    const task = {
      id: 't-cmd',
      groupId: 'g1',
      title: 'dev',
      prompt: '',
      repoPath: '/repo',
      repoId: 'r',
      baseRef: '',
      baseCommit: '',
      slug: 'dev',
      createdAt: '2026-10-23T10:00:00.000Z',
      isolation: 'direct' as const,
      kind: 'command' as const,
    };
    const snap = snapshot({
      groups: [group],
      tasks: [task],
      executions: [
        execution('e1', {
          taskId: 't-cmd',
          agentId: 'command',
          model: null,
          permissionMode: null,
          status: 'running',
          command: { commandId: 'c1', label: 'dev', file: '/bin/npm', args: [] },
        }),
      ],
    });
    api.run.list.mockImplementation(() => okR({ commands: [runCommand()], warnings: [] }));
    api.prefs.get.mockImplementation(() =>
      okR({ keymap: 'intellij' as const, activeRun: { groupId: 'g1', commandId: 'c1' }, readOnly: false }),
    );
    const store = createRunStore({
      api,
      layout: { open: vi.fn() },
      workspace: { get: () => snap },
      size: { cols: 100, rows: 30 },
      onError: vi.fn(),
    });
    await store.load();
    render(
      <ApiContext.Provider value={api}>
        <KeymapContext.Provider value="intellij">
          <RunBar store={store} snapshot={snap} />
        </KeymapContext.Provider>
      </ApiContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Rodar' }).getAttribute('title')).toBe('Rodar dev (Shift+F10)');
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de execução' }));
    expect(screen.getByRole('menuitem', { name: /^Parar/ }).getAttribute('title')).toBe('Parar (Ctrl+F2)');
  });
});
