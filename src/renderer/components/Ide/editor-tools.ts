import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  hoverTooltip,
  keymap,
  showTooltip,
  type DecorationSet,
  type Tooltip,
} from '@codemirror/view';
import { positionOffset, type Position } from './workspace-edits';

export interface EditorContext {
  path: string;
  text: string;
  offset: number;
  position: Position;
}
export interface IdeDiagnostic {
  range: { start: Position; end: Position };
  message: string;
  severity?: number;
}
type HoverProvider = (path: string, position: Position) => Promise<string | null>;
export interface SemanticCompletion {
  label: string;
  apply(): Promise<void>;
}
type CompletionProvider = (context: EditorContext) => Promise<SemanticCompletion[]>;
const views = new Map<EditorView, string>();
let active: EditorView | null = null;
let hoverProvider: HoverProvider | null = null;
let completionProvider: CompletionProvider | null = null;
interface CompletionPopup {
  pos: number;
  index: number;
  items: SemanticCompletion[];
}
const completionEffect = StateEffect.define<CompletionPopup | null>();
const completionField: StateField<CompletionPopup | null> = StateField.define<CompletionPopup | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) value = null;
    for (const effect of transaction.effects) if (effect.is(completionEffect)) value = effect.value;
    return value;
  },
  provide: (field) =>
    showTooltip.from(field, (popup): Tooltip | null =>
      popup
        ? {
            pos: popup.pos,
            above: false,
            create(view) {
              const dom = document.createElement('div');
              dom.className = 'ide-completion-popup';
              dom.setAttribute('role', 'listbox');
              dom.setAttribute('aria-label', 'Sugestões de código');
              const render = () => {
                const current = view.state.field(completionField);
                dom.replaceChildren();
                if (!current) return;
                current.items.forEach((item, index) => {
                  const button = document.createElement('button');
                  button.type = 'button';
                  button.setAttribute('role', 'option');
                  button.setAttribute('aria-selected', String(index === current.index));
                  button.textContent = item.label;
                  button.addEventListener('mousedown', (event) => event.preventDefault());
                  button.addEventListener('click', () => {
                    view.dispatch({ effects: completionEffect.of(null) });
                    void item.apply();
                  });
                  dom.append(button);
                });
              };
              render();
              return { dom, update: render };
            },
          }
        : null,
    ),
});
const diagnostics = StateEffect.define<readonly IdeDiagnostic[]>();
const breakpointEffect = StateEffect.define<readonly number[]>();
const breakpointLines = new Map<string, readonly number[]>();
class BreakpointMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.textContent = '●';
    element.style.color = '#ef6874';
    element.title = 'Breakpoint';
    return element;
  }
}
const breakpointMarker = new BreakpointMarker();
const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, transaction) {
    markers = markers.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(breakpointEffect))
        markers = RangeSet.of(
          effect.value
            .filter((line) => line > 0 && line <= transaction.state.doc.lines)
            .map((line) => breakpointMarker.range(transaction.state.doc.line(line).from)),
          true,
        );
    return markers;
  },
});
const diagnosticField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(diagnostics)) {
        const text = transaction.state.doc.toString();
        const marks = effect.value.flatMap((diagnostic) => {
          try {
            const from = positionOffset(text, diagnostic.range.start);
            const to = Math.min(text.length, Math.max(from + 1, positionOffset(text, diagnostic.range.end)));
            return to > from
              ? [
                  Decoration.mark({
                    class: diagnostic.severity === 1 ? 'ide-diagnostic-error' : 'ide-diagnostic-warning',
                    attributes: { title: diagnostic.message },
                  }).range(from, to),
                ]
              : [];
          } catch {
            return [];
          }
        });
        value = Decoration.set(marks, true);
      }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
export function positionAt(text: string, offset: number): Position {
  const prefix = text.slice(0, offset).split('\n');
  return { line: prefix.length - 1, character: prefix.at(-1)!.length };
}
export function editorContext(): EditorContext | null {
  if (!active || !views.has(active)) return null;
  const text = active.state.doc.toString();
  const offset = active.state.selection.main.head;
  return { path: views.get(active)!, text, offset, position: positionAt(text, offset) };
}
export function registerIdeView(path: string, view: EditorView): () => void {
  views.set(view, path);
  view.dispatch({ effects: breakpointEffect.of(breakpointLines.get(path) ?? []) });
  return () => {
    views.delete(view);
    if (active === view) active = null;
  };
}
export function setIdeDiagnostics(path: string, values: readonly IdeDiagnostic[]): void {
  for (const [view, file] of views) if (path === file) view.dispatch({ effects: diagnostics.of(values) });
}
export function setIdeBreakpoints(path: string, lines: readonly number[]): void {
  if (lines.length) breakpointLines.set(path, lines);
  else breakpointLines.delete(path);
  for (const [view, file] of views) if (path === file) view.dispatch({ effects: breakpointEffect.of(lines) });
}
export function setHoverProvider(provider: HoverProvider): () => void {
  hoverProvider = provider;
  return () => {
    if (hoverProvider === provider) hoverProvider = null;
  };
}
export function setCompletionProvider(provider: CompletionProvider): () => void {
  completionProvider = provider;
  return () => {
    if (completionProvider === provider) completionProvider = null;
  };
}
export function requestIdeAction(action: string): void {
  window.dispatchEvent(new CustomEvent('melinna-ide-action', { detail: action }));
}
export function ideEditorExtensions(path: string): Extension {
  return [
    diagnosticField,
    breakpointField,
    completionField,
    gutter({
      class: 'ide-breakpoint-gutter',
      initialSpacer: () => breakpointMarker,
      markers: (view) => view.state.field(breakpointField),
      domEventHandlers: {
        mousedown: (view, line) => {
          active = view;
          window.dispatchEvent(
            new CustomEvent('melinna-ide-breakpoint', {
              detail: { path, line: view.state.doc.lineAt(line.from).number },
            }),
          );
          return true;
        },
      },
    }),
    EditorView.theme({
      '.ide-diagnostic-error': { textDecoration: 'underline wavy #ef6874' },
      '.ide-diagnostic-warning': { textDecoration: 'underline wavy #e4b76c' },
      '.ide-completion-popup': {
        maxHeight: '240px',
        overflowY: 'auto',
        maxWidth: '60ch',
        background: '#101a2d',
        color: '#e7eaf6',
      },
      '.ide-completion-popup button': {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: 'none',
        padding: '4px 10px',
        background: 'transparent',
        color: 'inherit',
      },
      '.ide-completion-popup [aria-selected=true]': { background: '#273c68' },
    }),
    EditorView.domEventHandlers({
      focus: (_event, view) => {
        active = view;
      },
      keydown: (event, view) => {
        const popup = view.state.field(completionField);
        if (!popup) return false;
        if (event.key === 'Escape') {
          view.dispatch({ effects: completionEffect.of(null) });
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          view.dispatch({
            effects: completionEffect.of({
              ...popup,
              index:
                (popup.index + (event.key === 'ArrowDown' ? 1 : popup.items.length - 1)) % popup.items.length,
            }),
          });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = popup.items[popup.index];
          view.dispatch({ effects: completionEffect.of(null) });
          if (item) void item.apply();
          return true;
        }
        return false;
      },
    }),
    keymap.of([
      {
        key: 'Ctrl-Space',
        run: (view) => {
          active = view;
          const context = editorContext();
          if (!completionProvider || !context) requestIdeAction('completion');
          else
            void completionProvider(context)
              .then((items) => {
                if (
                  !views.has(view) ||
                  view.state.doc.toString() !== context.text ||
                  view.state.selection.main.head !== context.offset ||
                  !items.length
                )
                  return;
                view.dispatch({
                  effects: completionEffect.of({ pos: context.offset, index: 0, items: items.slice(0, 100) }),
                });
              })
              .catch(() => requestIdeAction('completion'));
          return true;
        },
      },
      {
        key: 'F12',
        run: (view) => {
          active = view;
          requestIdeAction('definition');
          return true;
        },
      },
      {
        key: 'Shift-F12',
        run: (view) => {
          active = view;
          requestIdeAction('references');
          return true;
        },
      },
    ]),
    hoverTooltip(async (view, pos) => {
      if (!hoverProvider) return null;
      const text = view.state.doc.toString();
      try {
        const content = await hoverProvider(path, positionAt(text, pos));
        if (!content || view.state.doc.toString() !== text) return null;
        return {
          pos,
          create: () => {
            const dom = document.createElement('pre');
            dom.textContent = content;
            dom.style.maxWidth = '60ch';
            dom.style.whiteSpace = 'pre-wrap';
            return { dom };
          },
        };
      } catch {
        return null;
      }
    }),
  ];
}
