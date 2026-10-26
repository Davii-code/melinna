import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { registerEditorSaver, saveEditor } from '../../../src/renderer/keymap/editor-save';
import { ACTIONS, EDITOR_ONLY_ACTIONS, KEYMAPS, parseChord, type AppAction } from '../../../src/renderer/keymap/keymaps';
import {
  runShortcutHandlers,
  useShortcuts,
  type ShortcutHandlers,
} from '../../../src/renderer/keymap/use-shortcuts';
import { KEYMAP_IDS, type KeymapId } from '../../../src/shared/ipc-contract';

/** Com o terminal em foco estas teclas seguem para o PTY. */
const TERMINAL_KEEPS: readonly AppAction[] = [
  ...EDITOR_ONLY_ACTIONS,
  'findInProject',
  'reopenClosedTab',
  'splitRight',
];

function Harness({ keymap, handlers }: { keymap: KeymapId; handlers: ShortcutHandlers }) {
  useShortcuts(keymap, handlers);
  return (
    <div>
      <div className="xterm">
        <textarea aria-label="terminal" className="xterm-helper-textarea" />
      </div>
      <div className="cm-editor">
        <div className="cm-content" contentEditable suppressContentEditableWarning tabIndex={0} />
      </div>
    </div>
  );
}

function handlersFor(): Record<AppAction, ReturnType<typeof vi.fn>> {
  return Object.fromEntries(ACTIONS.map((a) => [a, vi.fn()])) as Record<AppAction, ReturnType<typeof vi.fn>>;
}

/** Evento de teclado que o navegador geraria para a combinação (letra maiúscula com Shift). */
function eventFor(chord: string, over: KeyboardEventInit = {}): KeyboardEvent {
  const c = parseChord(chord);
  const key = c.key.length === 1 ? (c.shift ? c.key.toUpperCase() : c.key.toLowerCase()) : c.key;
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: c.mod,
    shiftKey: c.shift,
    altKey: c.alt,
    bubbles: true,
    cancelable: true,
    ...over,
  });
}

function press(target: Element | Window, event: KeyboardEvent): KeyboardEvent {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const terminal = () => document.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement;
const editor = () => document.querySelector('.cm-content') as HTMLElement;

describe.each([...KEYMAP_IDS])('shortcuts — mapa %s', (id) => {
  for (const [where, target] of [
    ['terminal', terminal],
    ['editor', editor],
  ] as const) {
    it(`fires every action with the focus in the ${where}`, () => {
      const handlers = handlersFor();
      render(<Harness keymap={id} handlers={handlers} />);
      for (const action of ACTIONS) {
        const chord = KEYMAPS[id][action];
        if (chord === null) continue;
        if (where === 'terminal' && TERMINAL_KEEPS.includes(action)) continue;
        const reachedTarget = vi.fn();
        target().addEventListener('keydown', reachedTarget, { once: true });
        const event = press(target(), eventFor(chord));
        expect(handlers[action], `${id}/${action}`).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented, `${id}/${action}`).toBe(true);
        expect(reachedTarget, `${id}/${action} chegou ao alvo`).not.toHaveBeenCalled();
      }
    });
  }

  it('leaves the editor actions to the terminal when it has the focus', () => {
    const handlers = handlersFor();
    render(<Harness keymap={id} handlers={handlers} />);
    for (const action of TERMINAL_KEEPS) {
      const chord = KEYMAPS[id][action];
      if (chord === null) continue;
      const reachedTarget = vi.fn();
      terminal().addEventListener('keydown', reachedTarget, { once: true });
      const event = press(terminal(), eventFor(chord));
      expect(handlers[action], `${id}/${action}`).not.toHaveBeenCalled();
      expect(event.defaultPrevented, `${id}/${action}`).toBe(false);
      expect(reachedTarget, `${id}/${action} chegou ao PTY`).toHaveBeenCalledTimes(1);
    }
  });

  it('does not fire the editor-only actions outside an editor', () => {
    const handlers = handlersFor();
    render(
      <>
        <Harness keymap={id} handlers={handlers} />
        <button type="button">fora</button>
      </>,
    );
    const outside = document.querySelector('button') as HTMLButtonElement;
    for (const action of EDITOR_ONLY_ACTIONS) {
      const chord = KEYMAPS[id][action];
      if (chord === null) continue;
      expect(press(outside, eventFor(chord)).defaultPrevented, `${id}/${action}`).toBe(false);
      expect(handlers[action], `${id}/${action}`).not.toHaveBeenCalled();
    }
  });

  it('does not fire an action that has no key in the map', () => {
    const handlers = handlersFor();
    render(<Harness keymap={id} handlers={handlers} />);
    const missing = ACTIONS.filter((a) => KEYMAPS[id][a] === null);
    for (const action of missing) expect(handlers[action]).not.toHaveBeenCalled();
  });
});

describe('shortcuts — isolamento entre mapas', () => {
  it('ignores a key from another map and leaves the event untouched', () => {
    const handlers = handlersFor();
    render(<Harness keymap="windows" handlers={handlers} />);
    const reached = vi.fn();
    terminal().addEventListener('keydown', reached);
    const event = press(terminal(), eventFor(KEYMAPS.intellij.goToFile as string));
    expect(event.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledTimes(1);
    for (const action of ACTIONS) expect(handlers[action]).not.toHaveBeenCalled();
  });

  it('leaves terminal keys alone', () => {
    const handlers = handlersFor();
    render(<Harness keymap="windows" handlers={handlers} />);
    for (const init of [
      { key: 'c', ctrlKey: true },
      { key: 'd', ctrlKey: true },
      { key: 'z', ctrlKey: true },
      { key: 'b', ctrlKey: true },
      { key: 'ArrowUp' },
      { key: 'a', ctrlKey: true },
    ]) {
      const event = press(
        terminal(),
        new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }),
      );
      expect(event.defaultPrevented, init.key).toBe(false);
    }
  });

  it('switches maps immediately when the keymap prop changes', () => {
    const handlers = handlersFor();
    const { rerender } = render(<Harness keymap="windows" handlers={handlers} />);
    press(terminal(), eventFor('Mod+P'));
    expect(handlers.goToFile).toHaveBeenCalledTimes(1);
    rerender(<Harness keymap="intellij" handlers={handlers} />);
    const old = press(terminal(), eventFor('Mod+P'));
    expect(old.defaultPrevented).toBe(false);
    expect(handlers.goToFile).toHaveBeenCalledTimes(1);
    press(terminal(), eventFor('Mod+Shift+N'));
    expect(handlers.goToFile).toHaveBeenCalledTimes(2);
  });

  it('uses the latest handlers without re-registering', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness keymap="windows" handlers={{ goToFile: first }} />);
    rerender(<Harness keymap="windows" handlers={{ goToFile: second }} />);
    press(terminal(), eventFor('Mod+P'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening when unmounted', () => {
    const handlers = handlersFor();
    const { unmount } = render(<Harness keymap="windows" handlers={handlers} />);
    unmount();
    press(window, eventFor('Mod+P'));
    expect(handlers.goToFile).not.toHaveBeenCalled();
  });
});

describe('shortcuts — quando a ação não se aplica', () => {
  it('lets the key through when the handler answers false', () => {
    const handler = vi.fn(() => false);
    render(<Harness keymap="windows" handlers={{ save: handler }} />);
    const reached = vi.fn();
    terminal().addEventListener('keydown', reached);
    const event = press(terminal(), eventFor('Mod+S'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('does not touch a key whose action has no handler', () => {
    render(<Harness keymap="windows" handlers={{}} />);
    expect(press(terminal(), eventFor('Mod+P')).defaultPrevented).toBe(false);
  });

  it('swallows key repeat without repeating the action', () => {
    const handler = vi.fn();
    render(<Harness keymap="windows" handlers={{ runActive: handler }} />);
    press(terminal(), eventFor('Mod+F5'));
    const repeated = press(terminal(), eventFor('Mod+F5', { repeat: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(repeated.defaultPrevented).toBe(true);
  });

  it('Shift+F10 of the IntelliJ map does not open the context menu', () => {
    render(<Harness keymap="intellij" handlers={{ runActive: vi.fn() }} />);
    expect(press(editor(), eventFor('Shift+F10')).defaultPrevented).toBe(true);
  });
});

describe('Rodar e Parar', () => {
  it('call the run store', () => {
    const store = { run: vi.fn(() => Promise.resolve()), stop: vi.fn(() => Promise.resolve()) };
    render(<Harness keymap="vscode" handlers={runShortcutHandlers(store)} />);
    press(terminal(), eventFor(KEYMAPS.vscode.runActive as string));
    expect(store.run).toHaveBeenCalledTimes(1);
    press(editor(), eventFor(KEYMAPS.vscode.stop as string));
    expect(store.stop).toHaveBeenCalledTimes(1);
  });
});

describe('editor-save', () => {
  it('saves the registered pane and reports false for others', () => {
    const save = vi.fn();
    const off = registerEditorSaver('editor-1', save);
    expect(saveEditor('editor-1')).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saveEditor('pane-9')).toBe(false);
    expect(saveEditor(null)).toBe(false);
    off();
    expect(saveEditor('editor-1')).toBe(false);
  });
});
