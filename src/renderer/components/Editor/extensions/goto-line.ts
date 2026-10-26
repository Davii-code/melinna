import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export interface LineSpec {
  /** Linha a partir de 1. */
  line: number;
  /** Coluna a partir de 1; `null` = início da linha. */
  column: number | null;
}

export const GOTO_LINE_HELP = 'Digite a linha ou linha:coluna, por exemplo 120:5.';

/** "120" ou "120:5"; `null` quando o texto não é um destes. Zero vale como o primeiro. */
export function parseLineSpec(text: string): LineSpec | null {
  const match = /^\s*(\d{1,9})\s*(?::\s*(\d{1,9}))?\s*$/.exec(text);
  if (!match) return null;
  const line = Math.max(1, Number(match[1]));
  const column = match[2] === undefined ? null : Math.max(1, Number(match[2]));
  return { line, column };
}

/**
 * Leva o cursor à linha (e coluna) e centraliza a linha na tela. Linha além do fim vai para a última;
 * coluna além do fim da linha vai para o fim dela.
 */
export function gotoLineTransaction(state: EditorState, spec: LineSpec): TransactionSpec {
  const line = state.doc.line(Math.min(spec.line, state.doc.lines));
  const offset = spec.column === null ? 0 : Math.min(spec.column - 1, line.length);
  const pos = line.from + offset;
  return {
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    userEvent: 'select',
  };
}

export function gotoLine(view: EditorView, spec: LineSpec): void {
  view.dispatch(gotoLineTransaction(view.state, spec));
  view.focus();
}
