import { indentSelection, toggleComment } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { gotoLine, type LineSpec } from './extensions/goto-line';
import { selectNextOccurrence, unselectLastOccurrence } from './extensions/occurrences';
import { extractSymbols, type FileSymbol } from './extensions/structure';

/**
 * O que o app pode pedir a um editor aberto: os comandos do mapa de atalhos e dos popups. Todos mexem só no
 * texto da aba (substituir, comentar e reindentar são edições como qualquer outra); gravar é sempre o
 * salvar explícito.
 */
export interface EditorController {
  lineCount(): number;
  goToLine(spec: LineSpec): void;
  symbols(): FileSymbol[];
  goToPosition(position: number): void;
  /** Seleciona a ocorrência (linha e coluna a partir de 1) e a centraliza; devolve o foco ao editor. */
  revealMatch(line: number, column: number, length: number): void;
  selectNextOccurrence(): boolean;
  unselectLastOccurrence(): boolean;
  toggleComment(): boolean;
  reindent(): boolean;
  /** Abre o painel de buscar e substituir do arquivo, com o foco no campo de substituição. */
  openReplace(): void;
  /** O texto selecionado, ou a palavra sob o cursor; vazio quando não há. */
  selectedText(): string;
  focus(): void;
}

export function createEditorController(view: EditorView): EditorController {
  return {
    lineCount: () => view.state.doc.lines,
    goToLine: (spec) => gotoLine(view, spec),
    symbols: () => extractSymbols(view.state),
    goToPosition(position) {
      const at = Math.max(0, Math.min(position, view.state.doc.length));
      view.dispatch({
        selection: EditorSelection.cursor(at),
        effects: EditorView.scrollIntoView(at, { y: 'center' }),
        userEvent: 'select',
      });
      view.focus();
    },
    revealMatch(line, column, length) {
      const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      const from = Math.min(target.from + Math.max(0, column - 1), target.to);
      const to = Math.min(from + Math.max(0, length), target.to);
      view.dispatch({
        selection: EditorSelection.single(from, to),
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
        userEvent: 'select',
      });
      view.focus();
    },
    selectNextOccurrence: () => selectNextOccurrence(view),
    unselectLastOccurrence: () => unselectLastOccurrence(view),
    toggleComment: () => toggleComment(view),
    reindent: () => indentSelection(view),
    openReplace() {
      openSearchPanel(view);
      view.dom.querySelector<HTMLInputElement>('input[name="replace"]')?.focus();
    },
    selectedText() {
      const { main } = view.state.selection;
      if (!main.empty) return view.state.sliceDoc(main.from, main.to);
      const word = view.state.wordAt(main.head);
      return word === null ? '' : view.state.sliceDoc(word.from, word.to);
    },
    focus: () => view.focus(),
  };
}

const controllers = new Map<string, EditorController>();

/** O editor de um painel diz como controlá-lo; devolve quem desfaz o registro. */
export function registerEditorController(paneId: string, controller: EditorController): () => void {
  controllers.set(paneId, controller);
  return () => {
    if (controllers.get(paneId) === controller) controllers.delete(paneId);
  };
}

/** O controle do editor do painel; `undefined` quando o painel não é um editor com arquivo aberto. */
export function getEditorController(paneId: string | null): EditorController | undefined {
  return paneId === null ? undefined : controllers.get(paneId);
}
