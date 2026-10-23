import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import type { TerminalDeps } from '../../../src/renderer/components/TerminalView';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import { createWorkspaceStore } from '../../../src/renderer/store/workspace-store';
import type { PortReceiver } from '../../../src/renderer/terminal/port-receiver';
import type { TerminalLike } from '../../../src/renderer/terminal/xterm-types';
import type { Task } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, prompt, snapshot } from '../../support/fake-api';
import { agentDef, execution } from '../../support/renderer-fixtures';

class FakeTerm implements TerminalLike {
  cols = 80;
  rows = 24;
  open() {}
  write() {}
  onData() {
    return { dispose: () => undefined };
  }
  onBinary() {
    return { dispose: () => undefined };
  }
  focus() {}
  dispose() {}
  proposeSize() {
    return { cols: 100, rows: 30 };
  }
  fit() {}
  attachCustomKeyEventHandler() {}
  onRendererFallback() {}
  search() {
    return false;
  }
  clearSearch() {}
}

const terminal: TerminalDeps = {
  factory: () => new FakeTerm(),
  receiver: {
    expect: () => ({ take: () => new Promise<MessagePort>(() => undefined), cancel: () => undefined }),
    dispose: () => undefined,
  } as PortReceiver,
  observeResize: () => () => undefined,
};

const task: Task = {
  id: 't1',
  groupId: 'w1',
  title: 'Sessão 1',
  prompt: '',
  repoPath: '/repos/site',
  repoId: 'r',
  baseRef: 'HEAD',
  baseCommit: '',
  slug: 's',
  createdAt: '2026-10-21T09:00:00.000Z',
  isolation: 'direct',
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

async function setup(withSession: boolean) {
  const api = fakeApi();
  api.catalog.list.mockImplementation(() => okR({ agents: [agentDef('claude')], invalid: [] }));
  api.catalog.detectAll.mockImplementation(() => okR({ claude: { installed: true, searched: 'claude' } }));
  api.prompts.list.mockImplementation(() => okR([prompt({ id: 'p1', name: 'Revisar', body: 'Revise {{arquivo}}' })]));
  api.workspace.snapshot.mockImplementation(() =>
    okR(
      snapshot({
        groups: [{ id: 'w1', name: 'site', order: 0, repoPath: '/repos/site', colorIndex: 0 }],
        tasks: withSession ? [task] : [],
        executions: withSession ? [execution('e1', { taskId: 't1', worktreePath: '/repos/site' })] : [],
      }),
    ),
  );
  const workspaceStore = createWorkspaceStore(api);
  const layoutStore = createLayoutStore(api);
  render(<App api={api} terminal={terminal} workspaceStore={workspaceStore} layoutStore={layoutStore} />);
  await screen.findByRole('button', { name: 'Catálogo' });
  if (withSession) {
    act(() => layoutStore.open('e1'));
    await waitFor(() => expect(document.querySelector('.terminal-host')).not.toBeNull());
  }
  return { api, layoutStore };
}

const ctrlShiftP = (target: EventTarget = window, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: 'P',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('prompt library entry points', () => {
  it('opens the library from the top bar button', async () => {
    const { api } = await setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));
    expect(await screen.findByRole('dialog', { name: 'Biblioteca de prompts' })).toBeTruthy();
    expect(api.prompts.list).toHaveBeenCalled();
  });

  it('opens the library with Ctrl+Shift+P and not the file quick open', async () => {
    await setup(false);
    const event = ctrlShiftP();
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Biblioteca de prompts' })).toBeTruthy();
    expect(screen.queryByLabelText('Filtrar arquivos')).toBeNull();
  });

  it('keeps Ctrl+P for the file quick open', async () => {
    await setup(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(await screen.findByLabelText('Filtrar arquivos')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Biblioteca de prompts' })).toBeNull();
  });

  it('works with the terminal in focus and the key never reaches it', async () => {
    await setup(true);
    const textarea = document.createElement('textarea');
    document.querySelector('.terminal-host')?.appendChild(textarea);
    let reachedTerminal = false;
    textarea.addEventListener('keydown', () => {
      reachedTerminal = true;
    });
    textarea.focus();
    const event = ctrlShiftP(textarea);
    expect(reachedTerminal).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: 'Biblioteca de prompts' })).toBeTruthy();
  });

  it('lists the prompts of the workspace of the session in focus', async () => {
    const { api } = await setup(true);
    ctrlShiftP();
    await screen.findByRole('dialog', { name: 'Biblioteca de prompts' });
    expect(api.prompts.list).toHaveBeenCalledWith('w1');
  });

  it('uses a prompt on the session in focus and confirms with a notice', async () => {
    const { api } = await setup(true);
    ctrlShiftP();
    await screen.findByText('Revisar');
    fireEvent.click(screen.getByRole('button', { name: 'Usar' }));
    expect(await screen.findByRole('dialog', { name: 'Usar prompt Revisar' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Biblioteca de prompts' })).toBeNull();
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a.ts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(api.prompts.send).toHaveBeenCalledWith({
        body: 'Revise {{arquivo}}',
        values: { arquivo: 'a.ts' },
        allowEmpty: [],
        execIds: ['e1'],
      }),
    );
    expect((await screen.findByText('Prompt enviado.')).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Usar prompt Revisar' })).toBeNull();
  });
});
