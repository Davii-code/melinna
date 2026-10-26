import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { diffLines, type LineChange } from '../line-diff';

/** Texto do arquivo no último commit; `null` = sem base (fora de git, não rastreado, binário). */
export const setGitBase = StateEffect.define<string | null>();
const setGitChanges = StateEffect.define<LineChange[] | 'off'>();

export interface GitGutterState {
  base: string | null;
  /** Marcas atuais; `'off'` quando o arquivo é grande demais para marcar. */
  changes: LineChange[] | 'off';
}

export const GIT_DIFF_DELAY_MS = 150;
/** Texto acima disto não é comparado (mesmo teto da leitura do `HEAD`). */
export const GIT_GUTTER_MAX_CHARS = 2 * 1024 * 1024;

export const gitGutterState = StateField.define<GitGutterState>({
  create: () => ({ base: null, changes: [] }),
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setGitBase))
        next = { base: effect.value, changes: effect.value === null ? [] : next.changes };
      else if (effect.is(setGitChanges)) next = { ...next, changes: effect.value };
    }
    return next;
  },
});

const LABEL: Record<LineChange['kind'], string> = {
  added: 'Linhas adicionadas',
  modified: 'Linhas alteradas',
  removed: 'Linhas removidas',
};

class ChangeMarker extends GutterMarker {
  constructor(readonly change: LineChange) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof ChangeMarker &&
      other.change.kind === this.change.kind &&
      other.change.fromLine === this.change.fromLine &&
      other.change.toLine === this.change.toLine
    );
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = `git-mark git-${this.change.kind}`;
    el.setAttribute('aria-label', LABEL[this.change.kind]);
    el.title = `${LABEL[this.change.kind]}: clique para ver o original`;
    return el;
  }
}

/** Compara a base com o texto e grava as marcas. */
function recompute(view: EditorView): void {
  const { base } = view.state.field(gitGutterState);
  let changes: LineChange[] | 'off' = [];
  if (base !== null) {
    changes =
      view.state.doc.length > GIT_GUTTER_MAX_CHARS || base.length > GIT_GUTTER_MAX_CHARS
        ? 'off'
        : diffLines(base, view.state.doc.toString());
  }
  view.dispatch({ effects: setGitChanges.of(changes) });
}

/** Refaz as marcas com um respiro depois de cada edição, e na hora quando a base muda. */
const scheduler = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      const baseChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setGitBase)));
      if (baseChanged) this.schedule(0);
      else if (update.docChanged) this.schedule(GIT_DIFF_DELAY_MS);
    }

    private schedule(ms: number): void {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => recompute(this.view), ms);
    }

    destroy(): void {
      clearTimeout(this.timer);
    }
  },
);

/** A marca que cobre a linha (a partir de 1), se houver. */
export function changeAtLine(changes: LineChange[] | 'off', line: number): LineChange | undefined {
  if (changes === 'off') return undefined;
  return changes.find((c) => line >= c.fromLine && line <= c.toLine);
}

/**
 * Desfaz o trecho no texto da aba (volta ao que está no último commit): é uma edição como outra qualquer,
 * deixa a aba como não salva e não grava nada.
 */
export function revertChange(view: EditorView, change: LineChange): void {
  const { doc } = view.state;
  if (change.kind === 'removed') {
    const insert =
      change.atEnd === true
        ? { from: doc.length, insert: `\n${change.original}` }
        : { from: doc.line(Math.min(change.fromLine, doc.lines)).from, insert: `${change.original}\n` };
    view.dispatch({ changes: insert, userEvent: 'input' });
    return;
  }
  const first = doc.line(Math.min(change.fromLine, doc.lines));
  const last = doc.line(Math.min(change.toLine, doc.lines));
  if (change.kind === 'modified') {
    view.dispatch({
      changes: { from: first.from, to: last.to, insert: change.original },
      userEvent: 'input',
    });
    return;
  }
  const range =
    last.number < doc.lines
      ? { from: first.from, to: last.to + 1 }
      : first.number > 1
        ? { from: doc.line(first.number - 1).to, to: last.to }
        : { from: first.from, to: last.to };
  view.dispatch({ changes: range, userEvent: 'delete' });
}

export interface GitGutterOptions {
  /** O usuário clicou numa marca: mostrar o original e a opção de reverter. */
  onOpen: (change: LineChange) => void;
}

/** Marcas na margem com as linhas adicionadas, alteradas e removidas em relação ao último commit. */
export function gitGutter(options: GitGutterOptions): Extension {
  return [
    gitGutterState,
    scheduler,
    gutter({
      class: 'cm-git-gutter',
      markers(view) {
        const { changes } = view.state.field(gitGutterState);
        if (changes === 'off') return RangeSet.empty;
        const ranges = [];
        for (const change of changes) {
          const marker = new ChangeMarker(change);
          for (let line = change.fromLine; line <= Math.min(change.toLine, view.state.doc.lines); line++) {
            ranges.push(marker.range(view.state.doc.line(line).from));
          }
        }
        return RangeSet.of(ranges, true);
      },
      domEventHandlers: {
        mousedown(view, block) {
          const line = view.state.doc.lineAt(block.from).number;
          const change = changeAtLine(view.state.field(gitGutterState).changes, line);
          if (change === undefined) return false;
          options.onOpen(change);
          return true;
        },
      },
    }),
  ];
}
