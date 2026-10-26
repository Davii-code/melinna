import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import type { TerminalDeps } from '../../../src/renderer/components/TerminalView';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import { createWorkspaceStore } from '../../../src/renderer/store/workspace-store';
import type { PortReceiver } from '../../../src/renderer/terminal/port-receiver';
import type { TerminalLike } from '../../../src/renderer/terminal/xterm-types';
import type { Task } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
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
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

async function setup(withSession = false) {
  const api = fakeApi();
  api.catalog.list.mockImplementation(() => okR({ agents: [agentDef('claude')], invalid: [] }));
  api.catalog.detectAll.mockImplementation(() => okR({ claude: { installed: true, searched: 'claude' } }));
  api.workspace.snapshot.mockImplementation(() =>
    okR(
      snapshot({
        groups: [{ id: 'w1', name: 'site', order: 0, repoPath: '/repos/site', colorIndex: 0 }],
        tasks: withSession ? [task] : [],
        executions: withSession ? [execution('e1', { taskId: 't1', worktreePath: '/repos/site' })] : [],
      }),
    ),
  );
  const layoutStore = createLayoutStore(api);
  render(
    <App api={api} terminal={terminal} workspaceStore={createWorkspaceStore(api)} layoutStore={layoutStore} />,
  );
  await screen.findByRole('button', { name: 'Catálogo de agentes' });
  if (withSession) {
    act(() => layoutStore.open('e1'));
    await waitFor(() => expect(document.querySelector('.terminal-host')).not.toBeNull());
  }
  return { api };
}

const alt = (digit: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { code: `Digit${digit}`, key: digit, altKey: true, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

const title = () => document.querySelector('.sidebar-title')?.textContent;

describe('sidebar panel shortcuts and persistence', () => {
  it('starts with Workspaces by default', async () => {
    await setup();
    await waitFor(() => expect(title()).toBe('Workspaces'));
  });

  it('Alt+0, Alt+1 and Alt+2 switch the panel with the focus outside the terminal', async () => {
    await setup();
    const event = alt('0');
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(title()).toBe('Commit'));
    alt('2');
    await waitFor(() => expect(title()).toBe('Arquivos'));
    alt('1');
    await waitFor(() => expect(title()).toBe('Workspaces'));
    expect(localStorage.getItem('melinna.sidebarPanel')).toBe('workspaces');
  });

  it('with the terminal in focus the key goes to the terminal and the panel does not change', async () => {
    await setup(true);
    const textarea = document.createElement('textarea');
    document.querySelector('.terminal-host')?.appendChild(textarea);
    let reached = false;
    textarea.addEventListener('keydown', () => {
      reached = true;
    });
    textarea.focus();
    const event = alt('0', textarea);
    expect(reached).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(title()).toBe('Workspaces');
  });

  it('ignores Alt+digit combined with other modifiers', async () => {
    await setup();
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Digit0', altKey: true, ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(title()).toBe('Workspaces');
  });

  it('clicking the active icon collapses the sidebar and clicking again brings it back', async () => {
    await setup();
    const workspaces = screen.getByRole('button', { name: 'Workspaces (Alt+1)' });
    fireEvent.click(workspaces);
    expect(document.querySelector('.sidebar')).toBeNull();
    expect(localStorage.getItem('melinna.sidebarCollapsed')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Commit (Alt+0)' }));
    await waitFor(() => expect(title()).toBe('Commit'));
    expect(localStorage.getItem('melinna.sidebarCollapsed')).toBe('0');
  });

  it('restores the stored panel and the collapsed state on mount', async () => {
    localStorage.setItem('melinna.sidebarPanel', 'commit');
    await setup();
    await waitFor(() => expect(title()).toBe('Commit'));
  });

  it('starts collapsed when it was left collapsed', async () => {
    localStorage.setItem('melinna.sidebarCollapsed', '1');
    await setup();
    expect(document.querySelector('.sidebar')).toBeNull();
  });

  it('falls back to Workspaces when the stored panel is invalid', async () => {
    localStorage.setItem('melinna.sidebarPanel', 'lixo');
    await setup();
    await waitFor(() => expect(title()).toBe('Workspaces'));
  });
});
