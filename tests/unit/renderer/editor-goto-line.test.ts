import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GotoLinePopup } from '../../../src/renderer/components/Editor/GotoLinePopup';
import {
  GOTO_LINE_HELP,
  gotoLine,
  gotoLineTransaction,
  parseLineSpec,
} from '../../../src/renderer/components/Editor/extensions/goto-line';

const doc = Array.from({ length: 200 }, (_, i) => `linha ${i + 1} com texto`).join('\n');

function view(): EditorView {
  return new EditorView({ state: EditorState.create({ doc }), parent: document.body });
}

describe('parseLineSpec', () => {
  it('reads "120" and "120:5"', () => {
    expect(parseLineSpec('120')).toEqual({ line: 120, column: null });
    expect(parseLineSpec('120:5')).toEqual({ line: 120, column: 5 });
    expect(parseLineSpec('  12 : 3 ')).toEqual({ line: 12, column: 3 });
  });

  it('treats zero as the first line/column', () => {
    expect(parseLineSpec('0')).toEqual({ line: 1, column: null });
    expect(parseLineSpec('4:0')).toEqual({ line: 4, column: 1 });
  });

  it('refuses anything else', () => {
    for (const text of ['', ' ', 'abc', '12:', ':5', '1:2:3', '-3', '1.5', '12a', '0x10']) {
      expect(parseLineSpec(text), text).toBeNull();
    }
  });
});

describe('gotoLine', () => {
  it('puts the cursor at the start of the line', () => {
    const v = view();
    gotoLine(v, { line: 120, column: null });
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(120);
    expect(v.state.selection.main.head).toBe(v.state.doc.line(120).from);
    v.destroy();
  });

  it('asks for the line to be centered in the view', () => {
    const state = EditorState.create({ doc });
    const tr = state.update(gotoLineTransaction(state, { line: 120, column: 5 }));
    expect(tr.effects).toHaveLength(1);
  });

  it('honors the column of "120:5"', () => {
    const v = view();
    gotoLine(v, { line: 120, column: 5 });
    expect(v.state.selection.main.head).toBe(v.state.doc.line(120).from + 4);
    v.destroy();
  });

  it('goes to the last line when the number is past the end', () => {
    const v = view();
    gotoLine(v, { line: 9999, column: null });
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(200);
    v.destroy();
  });

  it('goes to the end of the line when the column is past it', () => {
    const v = view();
    gotoLine(v, { line: 3, column: 500 });
    expect(v.state.selection.main.head).toBe(v.state.doc.line(3).to);
    v.destroy();
  });

  it('works in a document with a single empty line', () => {
    const v = new EditorView({ state: EditorState.create({ doc: '' }), parent: document.body });
    gotoLine(v, { line: 10, column: 4 });
    expect(v.state.selection.main.head).toBe(0);
    v.destroy();
  });
});

describe('GotoLinePopup', () => {
  function setup() {
    const onGo = vi.fn();
    const onClose = vi.fn();
    render(createElement(GotoLinePopup, { lineCount: 200, onGo, onClose }));
    return { onGo, onClose };
  }
  const field = () => screen.getByLabelText('Linha[:coluna]') as HTMLInputElement;

  it('has the focus on the field when it opens, with the range as hint', () => {
    setup();
    expect(document.activeElement).toBe(field());
    expect(field().placeholder).toBe('1–200');
  });

  it('goes to "120:5" on Enter and closes', () => {
    const { onGo, onClose } = setup();
    fireEvent.change(field(), { target: { value: '120:5' } });
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    expect(onGo).toHaveBeenCalledWith({ line: 120, column: 5 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the message for an invalid entry and stays open', () => {
    const { onGo, onClose } = setup();
    fireEvent.change(field(), { target: { value: 'abc' } });
    fireEvent.submit(field().closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toBe(GOTO_LINE_HELP);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(onGo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: '12' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes on Esc without going anywhere', () => {
    const { onGo, onClose } = setup();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onGo).not.toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
