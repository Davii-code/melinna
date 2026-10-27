import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { TerminalDepsContext, type TerminalDeps } from '../../../src/renderer/components/TerminalView';
import { Panel } from '../../../src/renderer/components/Panel/Panel';
import type { PortReceiver } from '../../../src/renderer/terminal/port-receiver';
import type { TerminalLike } from '../../../src/renderer/terminal/xterm-types';
import type { AgentDefinition, Execution, ImageCheck } from '../../../src/shared/ipc-contract';
import { fakeApi, imageRef, okR } from '../../support/fake-api';
import { agentDef, execution, shellDef } from '../../support/renderer-fixtures';

class FakeTerm implements TerminalLike {
  cols = 80;
  rows = 24;
  focused = 0;
  keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  open() {}
  write() {}
  onData() {
    return { dispose: () => undefined };
  }
  onBinary() {
    return { dispose: () => undefined };
  }
  focus() {
    this.focused++;
  }
  dispose() {}
  proposeSize() {
    return { cols: 100, rows: 30 };
  }
  fit() {}
  attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) {
    this.keyHandler = fn;
  }
  onRendererFallback() {}
  search() {
    return false;
  }
  clearSearch() {}
}

const tick = (ms = 0) => act(() => new Promise((r) => setTimeout(r, ms)));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

const WITH_IMAGES: AgentDefinition = agentDef('claude', {
  images: { template: '{path}', quote: 'when-needed' },
});
const WITHOUT_IMAGES: AgentDefinition = shellDef('bash', 'Bash');

function setup(
  agent: AgentDefinition | null = WITH_IMAGES,
  exec: Execution = execution('e1', { status: 'running' }),
) {
  const api = fakeApi();
  const term = new FakeTerm();
  const port = { postMessage: vi.fn(), start() {}, close() {}, onmessage: null };
  const receiver: PortReceiver = {
    expect: () => ({ take: () => Promise.resolve(port as unknown as MessagePort), cancel: () => undefined }),
    dispose: () => undefined,
  };
  const deps: TerminalDeps = { factory: () => term, receiver, observeResize: () => () => undefined };
  const view = render(
    <ApiContext.Provider value={api}>
      <TerminalDepsContext.Provider value={deps}>
        <Panel execution={exec} agent={agent ?? undefined} visible focused onFocus={() => undefined} />
      </TerminalDepsContext.Provider>
    </ApiContext.Provider>,
  );
  const panel = () => screen.getByTestId(`panel-${exec.id}`);
  const drop = (files: { name: string }[], types: string[] = ['Files']) =>
    fireEvent.drop(panel(), { dataTransfer: { types, files } });
  const pressCtrlV = () => term.keyHandler?.(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
  return { api, term, port, view, panel, drop, pressCtrlV };
}

const OK_CHECK: ImageCheck = {
  accepted: [imageRef({ path: '/soltos/foto.png', source: 'file' })],
  rejected: [{ path: '/soltos/doc.pdf', reason: 'Formato não aceito: use PNG, JPEG, GIF ou WebP.' }],
};

describe('Panel — arquivos soltos', () => {
  it('inserts image and ordinary file paths directly without a preview or Enter', async () => {
    const { api, drop, port } = setup();
    await tick();
    drop([{ name: 'foto.png' }, { name: 'doc.pdf' }]);
    expect(api.files.pathOf).toHaveBeenCalledTimes(2);
    expect(api.attachments.checkFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'input',
      bytes: new TextEncoder().encode('/soltos/foto.png /soltos/doc.pdf '),
    });
  });

  it('quotes paths containing spaces and refuses control characters', async () => {
    const { api, drop, port } = setup();
    await tick();
    api.files.pathOf.mockReturnValueOnce('C:/My Files/a.txt');
    drop([{ name: 'a.txt' }]);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'input',
      bytes: new TextEncoder().encode('"C:/My Files/a.txt" '),
    });
    port.postMessage.mockClear();
    api.files.pathOf.mockReturnValueOnce('bad\npath');
    drop([{ name: 'bad' }]);
    expect(port.postMessage).not.toHaveBeenCalled();
    expect((await screen.findByRole('status')).textContent).toContain('caracteres');
  });

  it('ignores a drop that carries no files (dragged text)', async () => {
    const { api, drop } = setup();
    drop([], ['text/plain']);
    await tick(5);
    expect(api.attachments.checkFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('accepts the drag-over of files, so the drop is delivered', () => {
    const { panel } = setup();
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
    panel().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('refuses more than 20 files with a notice and checks nothing', async () => {
    const { api, drop } = setup();
    drop(Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.png` })));
    expect((await screen.findByRole('status')).textContent).toMatch(/Envie até 20 arquivos por vez\./);
    expect(api.attachments.checkFiles).not.toHaveBeenCalled();
  });

  it('refuses dropped files after the execution ends', async () => {
    const { drop, port } = setup(WITH_IMAGES, execution('e1', { status: 'exited' }));
    await tick();
    port.postMessage.mockClear();
    drop([{ name: 'foto.png' }]);
    expect((await screen.findByRole('status')).textContent).toContain('não está rodando');
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});

describe('Panel — botão Anexar imagem', () => {
  it('opens the native image dialog through pickImages and shows the preview', async () => {
    const { api } = setup();
    api.attachments.pickImages.mockImplementation(() => okR(OK_CHECK));
    fireEvent.click(screen.getByRole('button', { name: 'Anexar imagem' }));
    await screen.findByRole('dialog', { name: 'Anexar imagem' });
    expect(api.attachments.pickImages).toHaveBeenCalledWith('e1');
  });

  it('shows nothing when the dialog is cancelled', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Anexar imagem' }));
    await waitFor(() => expect(api.attachments.pickImages).toHaveBeenCalled());
    await tick(5);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is disabled while the execution is not running or idle', () => {
    setup(WITH_IMAGES, execution('e1', { status: 'exited' }));
    expect((screen.getByRole('button', { name: 'Anexar imagem' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is enabled for an idle execution', () => {
    setup(WITH_IMAGES, execution('e1', { status: 'idle' }));
    expect((screen.getByRole('button', { name: 'Anexar imagem' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Panel — Ctrl+V', () => {
  it('inserts the clipboard image directly without confirmation', async () => {
    const { api, pressCtrlV, term } = setup();
    api.attachments.clipboardHasImage.mockImplementation(() => okR(true));
    await tick();
    pressCtrlV();
    await waitFor(() => expect(api.attachments.send).toHaveBeenCalledWith('e1', ['/data/attachments/e1/1-1.png']));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(term.focused).toBeGreaterThan(0);
  });

  it('does not open anything when the clipboard has text', async () => {
    const { api, pressCtrlV } = setup();
    await tick();
    pressCtrlV();
    await tick(5);
    expect(api.attachments.pasteImage).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a send failure without opening a modal', async () => {
    const { api, pressCtrlV } = setup();
    api.attachments.clipboardHasImage.mockImplementation(() => okR(true));
    api.attachments.send.mockResolvedValueOnce({
      ok: false,
      error: { code: 'EXECUTION_NOT_RUNNING', message: 'A execução terminou.' },
    });
    await tick();
    pressCtrlV();
    expect((await screen.findByRole('status')).textContent).toContain('A execução terminou.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Panel — agente sem suporte a imagens', () => {
  it('warns instead of pasting, and never reads the clipboard image', async () => {
    const { api, pressCtrlV } = setup(WITHOUT_IMAGES);
    api.attachments.clipboardHasImage.mockImplementation(() => okR(true));
    await tick();
    pressCtrlV();
    expect((await screen.findByRole('status')).textContent).toMatch(/Este agente não recebe imagens\./);
    expect(api.attachments.pasteImage).not.toHaveBeenCalled();
    expect(api.attachments.send).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('inserts dropped paths even for agents without image attachment support', async () => {
    const { drop, port } = setup(WITHOUT_IMAGES);
    await tick();
    drop([{ name: 'planilha.xlsx' }]);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'input',
      bytes: new TextEncoder().encode('/soltos/planilha.xlsx '),
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no attach button', () => {
    setup(WITHOUT_IMAGES);
    expect(screen.queryByRole('button', { name: 'Anexar imagem' })).toBeNull();
  });
});
