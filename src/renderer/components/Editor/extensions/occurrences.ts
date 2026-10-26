import { selectNextOccurrence as nextOccurrence } from '@codemirror/search';
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type ChangeDesc,
  type StateCommand,
  type Transaction,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';

interface Entry {
  from: number;
  to: number;
}

interface Added {
  /** Começou do zero (cursores viraram a palavra); senão continua a pilha ou parte da seleção anterior. */
  reset: boolean;
  base: Entry[];
  added: Entry[];
}

const occurrenceAdded = StateEffect.define<Added>();
const occurrenceRemoved = StateEffect.define<null>();

function mapEntry(entry: Entry, changes: ChangeDesc): Entry {
  const from = changes.mapPos(entry.from, 1);
  const to = changes.mapPos(entry.to, -1);
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Pilha das seleções acrescentadas por "próxima ocorrência", na ordem em que entraram: é ela que diz qual
 * delas "Desfazer última ocorrência" tira. Qualquer outra mudança que volte a um cursor só a esvazia.
 */
const occurrences = StateField.define<Entry[]>({
  create: () => [],
  update(value, tr) {
    let stack = tr.docChanged ? value.map((e) => mapEntry(e, tr.changes)) : value;
    let ours = false;
    for (const effect of tr.effects) {
      if (effect.is(occurrenceAdded)) {
        ours = true;
        const { reset, base, added } = effect.value;
        const start = reset ? [] : stack.length === 0 ? base : stack;
        stack = [...start, ...added];
      } else if (effect.is(occurrenceRemoved)) {
        ours = true;
        stack = stack.slice(0, -1);
      }
    }
    if (!ours && tr.selection && tr.newSelection.ranges.length < 2) return [];
    return stack;
  },
});

const sameRange = (a: Entry, b: Entry) => a.from === b.from && a.to === b.to;

/**
 * Seleciona a próxima ocorrência do texto selecionado (ou da palavra sob o cursor) como mais um cursor;
 * o que o usuário digitar vale em todos e o desfazer volta tudo de uma vez.
 */
export const selectNextOccurrence: StateCommand = ({ state, dispatch }) => {
  let captured: Transaction | undefined;
  const handled = nextOccurrence({
    state,
    dispatch: (tr) => {
      captured = tr;
    },
  });
  if (!handled || captured === undefined) return false;
  const tr: Transaction = captured;
  const before = state.selection;
  const after = tr.selection ?? before;
  const wasCarets = before.ranges.some((r) => r.from === r.to);
  const added = after.ranges
    .filter((r) => !before.ranges.some((o) => o.from === r.from && o.to === r.to))
    .map((r) => ({ from: r.from, to: r.to }));
  dispatch(
    state.update({
      selection: after,
      effects: [
        ...tr.effects,
        occurrenceAdded.of({
          reset: wasCarets,
          base: before.ranges.map((r) => ({ from: r.from, to: r.to })),
          added,
        }),
      ],
      userEvent: 'select.search',
    }),
  );
  return true;
};

/** Tira da seleção a última ocorrência acrescentada; `false` quando há só uma. */
export const unselectLastOccurrence: StateCommand = ({ state, dispatch }) => {
  const stack = state.field(occurrences, false) ?? [];
  const { ranges, mainIndex } = state.selection;
  const last = stack[stack.length - 1];
  const previous = stack[stack.length - 2];
  if (last === undefined || previous === undefined || ranges.length < 2) return false;
  const found = ranges.findIndex((r) => sameRange(r, last));
  const remove = found >= 0 ? found : mainIndex;
  const remaining = ranges.filter((_, i) => i !== remove);
  const main = remaining.findIndex((r) => sameRange(r, previous));
  dispatch(
    state.update({
      selection: EditorSelection.create(
        remaining,
        main >= 0 ? main : Math.min(mainIndex, remaining.length - 1),
      ),
      effects: [occurrenceRemoved.of(null), EditorView.scrollIntoView(previous.to)],
      userEvent: 'select.search',
    }),
  );
  return true;
};

/** Alt+Shift+clique (como no IntelliJ) ou Ctrl/Cmd+clique acrescenta um cursor. */
export function addCursorClick(event: MouseEvent): boolean {
  return (event.altKey && event.shiftKey) || event.ctrlKey || event.metaKey;
}

/** Arrastar com Alt faz seleção retangular; com Alt+Shift o clique é de cursor extra e não de retângulo. */
export function rectangularFilter(event: MouseEvent): boolean {
  return event.altKey && !event.shiftKey && event.button === 0;
}

/** Vários cursores e a pilha das ocorrências selecionadas. */
export const occurrenceExtensions = [
  EditorState.allowMultipleSelections.of(true),
  occurrences,
  EditorView.clickAddsSelectionRange.of(addCursorClick),
];
