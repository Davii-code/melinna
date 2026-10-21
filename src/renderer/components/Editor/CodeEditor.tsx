import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';

/** Realce por extensão; sem extensão conhecida, texto puro. */
export function languageFor(path: string): Extension {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return javascript({ typescript: true });
    case '.tsx':
      return javascript({ typescript: true, jsx: true });
    case '.jsx':
      return javascript({ jsx: true });
    case '.js':
    case '.mjs':
    case '.cjs':
      return javascript();
    case '.json':
      return json();
    case '.md':
    case '.mdx':
    case '.markdown':
      return markdown();
    case '.css':
      return css();
    case '.html':
    case '.htm':
      return html();
    default:
      return [];
  }
}

/** Tema do editor montado a partir dos tokens do app: nada de cor fixa no componente. */
const appTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--field)', color: 'var(--text)', height: '100%' },
    '.cm-content': { fontFamily: 'var(--font-mono)', fontSize: '12.5px', caretColor: 'var(--accent)' },
    '.cm-gutters': {
      backgroundColor: 'var(--field)',
      color: 'var(--prism)',
      border: 'none',
      borderRight: '1px solid var(--border-weak)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(79,140,255,0.28)' },
  },
  { dark: true },
);

export interface CodeEditorProps {
  /** Trocar de arquivo recria o editor com o conteúdo daquele arquivo. */
  path: string;
  value: string;
  onChange(value: string): void;
  onSave(): void;
}

export function CodeEditor({ path, value, onChange, onSave }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          indentOnInput(),
          bracketMatching(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          highlightSelectionMatches(),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          languageFor(path),
          appTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // `value` entra só na criação: quem recria ao trocar de arquivo é o `path`.
  }, [path]);

  return <div className="editor-host" ref={host} data-testid="code-editor" />;
}
