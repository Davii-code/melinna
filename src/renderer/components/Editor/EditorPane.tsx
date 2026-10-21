import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Pane } from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import { CodeEditor, type CodeEditorProps } from './CodeEditor';

export type EditorPaneModel = Extract<Pane, { kind: 'editor' }>;

interface Draft {
  text: string;
  baseHash: string;
  dirty: boolean;
}

export interface EditorPaneProps {
  pane: EditorPaneModel;
  focused: boolean;
  onFocus(): void;
  onSelect(index: number): void;
  /** Fecha a aba do arquivo; fechar a última fecha o painel (o store decide). */
  onCloseTab(path: string): void;
  /** Permite trocar o editor nos testes (o CodeMirror exige medição de layout). */
  renderEditor?: (props: CodeEditorProps) => ReactNode;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Painel de editor: uma aba por arquivo, texto em memória e salvamento com checagem de hash. */
export function EditorPane({
  pane,
  focused,
  onFocus,
  onSelect,
  onCloseTab,
  renderEditor,
}: EditorPaneProps) {
  const api = useApi();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activePath = pane.docs[Math.min(pane.activeIndex, pane.docs.length - 1)] ?? null;

  useEffect(() => {
    if (activePath === null || drafts[activePath] !== undefined) return;
    let alive = true;
    void api.files.read(activePath).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      if (r.value.binary) {
        setError(`${fileName(activePath)} é binário e não abre no editor.`);
        return;
      }
      setDrafts((current) => ({
        ...current,
        [activePath]: { text: r.value.content, baseHash: r.value.hash, dirty: false },
      }));
    });
    return () => {
      alive = false;
    };
  }, [api, activePath, drafts]);

  const change = useCallback(
    (path: string, text: string) => {
      setDrafts((current) => {
        const draft = current[path];
        if (draft === undefined) return current;
        return { ...current, [path]: { ...draft, text, dirty: text !== draft.text || draft.dirty } };
      });
    },
    [],
  );

  const save = useCallback(
    async (path: string) => {
      const draft = drafts[path];
      if (draft === undefined || saving) return;
      setSaving(true);
      setError(null);
      const r = await api.files.write(path, draft.text, draft.baseHash);
      setSaving(false);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setDrafts((current) => {
        const now = current[path];
        if (now === undefined) return current;
        return { ...current, [path]: { ...now, baseHash: r.value.hash, dirty: false } };
      });
    },
    [api, drafts, saving],
  );

  const requestClose = (path: string) => {
    const draft = drafts[path];
    if (draft?.dirty === true && !window.confirm(`Descartar as alterações de ${fileName(path)}?`)) return;
    onCloseTab(path);
  };

  return (
    <section
      className={`editor-pane${focused ? ' focused' : ''}`}
      onMouseDown={onFocus}
      data-testid={`editor-pane-${pane.id}`}
      aria-label="Editor de arquivos"
    >
      <div className="editor-tabs" role="tablist" aria-label="Arquivos abertos">
        {pane.docs.map((path, index) => {
          const draft = drafts[path];
          const active = index === pane.activeIndex;
          return (
            <div key={path} className={`editor-tab${active ? ' active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="editor-tab-name"
                title={path}
                onClick={() => onSelect(index)}
              >
                {draft?.dirty === true ? <span className="editor-tab-dirty" aria-label="não salvo" /> : null}
                {fileName(path)}
              </button>
              <button
                type="button"
                className="editor-tab-close"
                aria-label={`Fechar ${fileName(path)}`}
                onClick={() => requestClose(path)}
              >
                ×
              </button>
            </div>
          );
        })}
        <span className="spacer" />
        {activePath !== null ? (
          <button
            type="button"
            className="editor-save"
            onClick={() => void save(activePath)}
            disabled={drafts[activePath]?.dirty !== true || saving}
            title="Salvar (Ctrl+S)"
          >
            Salvar
          </button>
        ) : null}
      </div>

      {error !== null ? (
        <div className="editor-error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" aria-label="Fechar aviso" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      ) : null}

      <div className="editor-body">
        {activePath === null ? null : drafts[activePath] === undefined ? (
          <p className="editor-loading">Abrindo {fileName(activePath)}…</p>
        ) : (
          (renderEditor ?? ((props) => <CodeEditor {...props} />))({
            path: activePath,
            value: drafts[activePath].text,
            onChange: (text) => change(activePath, text),
            onSave: () => void save(activePath),
          })
        )}
      </div>
    </section>
  );
}
