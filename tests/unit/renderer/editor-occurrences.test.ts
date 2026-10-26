import { addCursorAbove, addCursorBelow, history, simplifySelection, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  addCursorClick,
  occurrenceExtensions,
  rectangularFilter,
  selectNextOccurrence,
  unselectLastOccurrence,
} from '../../../src/renderer/components/Editor/extensions/occurrences';

const DOC = 'alfa beta alfa gama alfa\nlinha dois\nlinha tres';

function view(doc = DOC, anchor = 2, head = anchor): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [occurrenceExtensions, history()],
    }),
    parent: document.body,
  });
}

const selected = (v: EditorView) => v.state.selection.ranges.map((r) => v.state.sliceDoc(r.from, r.to));
const spans = (v: EditorView) => v.state.selection.ranges.map((r) => [r.from, r.to]);

describe('selectNextOccurrence', () => {
  it('selects the word under the cursor on the first use', () => {
    const v = view();
    expect(selectNextOccurrence(v)).toBe(true);
    expect(selected(v)).toEqual(['alfa']);
    v.destroy();
  });

  it('adds each following occurrence as one more cursor', () => {
    const v = view();
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    expect(spans(v)).toEqual([
      [0, 4],
      [10, 14],
    ]);
    selectNextOccurrence(v);
    expect(spans(v)).toEqual([
      [0, 4],
      [10, 14],
      [20, 24],
    ]);
    v.destroy();
  });

  it('stops when every occurrence is already selected', () => {
    const v = view('aa bb aa', 1);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    expect(selectNextOccurrence(v)).toBe(false);
    expect(spans(v)).toEqual([
      [0, 2],
      [6, 8],
    ]);
    v.destroy();
  });

  it('starts from a selection made by the user', () => {
    const v = view(DOC, 5, 9);
    selectNextOccurrence(v);
    expect(selected(v)).toEqual(['beta']);
    v.destroy();
  });

  it('does nothing in an empty line without a word', () => {
    const v = view('\n\n', 0);
    expect(selectNextOccurrence(v)).toBe(false);
    v.destroy();
  });

  it('types in every cursor and a single undo brings everything back', () => {
    const v = view();
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    v.dispatch(v.state.replaceSelection('X'));
    expect(v.state.doc.toString()).toBe('X beta X gama X\nlinha dois\nlinha tres');
    expect(undo(v)).toBe(true);
    expect(v.state.doc.toString()).toBe(DOC);
    v.destroy();
  });
});

describe('unselectLastOccurrence', () => {
  it('takes the last added occurrence out, one at a time', () => {
    const v = view();
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    expect(unselectLastOccurrence(v)).toBe(true);
    expect(spans(v)).toEqual([
      [0, 4],
      [10, 14],
    ]);
    expect(unselectLastOccurrence(v)).toBe(true);
    expect(spans(v)).toEqual([[0, 4]]);
    expect(unselectLastOccurrence(v)).toBe(false);
    v.destroy();
  });

  it('takes out the one added last even when it is before the others in the document', () => {
    const v = view(DOC, 12);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    expect(spans(v)).toEqual([
      [0, 4],
      [10, 14],
      [20, 24],
    ]);
    unselectLastOccurrence(v);
    expect(spans(v)).toEqual([
      [10, 14],
      [20, 24],
    ]);
    v.destroy();
  });

  it('does nothing with a single selection or after the selection was reset', () => {
    const v = view();
    expect(unselectLastOccurrence(v)).toBe(false);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    simplifySelection(v);
    expect(spans(v)).toHaveLength(1);
    expect(unselectLastOccurrence(v)).toBe(false);
    v.destroy();
  });

  it('keeps working after typing moved the cursors', () => {
    const v = view();
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    v.dispatch(v.state.replaceSelection('XY'));
    expect(v.state.selection.ranges).toHaveLength(3);
    expect(() => unselectLastOccurrence(v)).not.toThrow();
    v.destroy();
  });
});

describe('cursors and selection reset', () => {
  it('Esc (simplifySelection) goes back to a single cursor', () => {
    const v = view();
    selectNextOccurrence(v);
    selectNextOccurrence(v);
    expect(spans(v)).toHaveLength(2);
    expect(simplifySelection(v)).toBe(true);
    expect(spans(v)).toHaveLength(1);
    v.destroy();
  });

  it('adds a cursor above and below with the arrows', () => {
    const v = view(DOC, 27);
    expect(addCursorBelow(v)).toBe(true);
    expect(spans(v)).toHaveLength(2);
    expect(addCursorAbove(v)).toBe(true);
    expect(spans(v).length).toBeGreaterThanOrEqual(2);
    v.destroy();
  });

  it('accepts several selections', () => {
    const v = view();
    expect(v.state.facet(EditorState.allowMultipleSelections)).toBe(true);
    v.destroy();
  });

  it('adds a cursor on Alt+Shift+click and on Ctrl/Cmd+click, not on a plain click', () => {
    const ev = (init: MouseEventInit) => new MouseEvent('mousedown', init);
    expect(addCursorClick(ev({ altKey: true, shiftKey: true }))).toBe(true);
    expect(addCursorClick(ev({ ctrlKey: true }))).toBe(true);
    expect(addCursorClick(ev({ metaKey: true }))).toBe(true);
    expect(addCursorClick(ev({ altKey: true }))).toBe(false);
    expect(addCursorClick(ev({}))).toBe(false);
    const v = view();
    const handlers = v.state.facet(EditorView.clickAddsSelectionRange);
    expect(handlers.some((fn) => fn(ev({ altKey: true, shiftKey: true })))).toBe(true);
    expect(handlers.some((fn) => fn(ev({})))).toBe(false);
    v.destroy();
  });

  it('keeps Alt+drag for the rectangular selection and leaves Alt+Shift+click to the extra cursor', () => {
    const ev = (init: MouseEventInit) => new MouseEvent('mousedown', init);
    expect(rectangularFilter(ev({ altKey: true, button: 0 }))).toBe(true);
    expect(rectangularFilter(ev({ altKey: true, shiftKey: true, button: 0 }))).toBe(false);
    expect(rectangularFilter(ev({ button: 0 }))).toBe(false);
  });
});
