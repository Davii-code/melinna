import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FileRoot, Pane } from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import { registerEditorCloser, registerEditorSaver } from '../../keymap/editor-save';
import { useShortcutLabel, withShortcut } from '../../keymap/keymap-store';
import { CodeEditor, type CodeEditorProps, type EditorStatus } from './CodeEditor';
import { useClosedCount, useDrafts, useEditorSession, type ClosedTab } from './editor-session';
import { useGitBase } from './use-git-base';

export type EditorPaneModel = Extract<Pane, { kind: 'editor' }>;

export type SplitDirection = 'right' | 'down';

export interface EditorPaneProps {
  pane: EditorPaneModel;
  roots?: readonly FileRoot[];
  editorFocus?: boolean;
  onToggleFocus?: () => void;
  focused: boolean;
  onFocus(): void;
  onSelect(index: number): void;
  /** Fecha a aba do arquivo; fechar a última fecha o painel (o store decide). */
  onCloseTab(path: string): void;
  /** Divide o arquivo da aba em outro painel (à direita ou abaixo); sem isto os itens não aparecem. */
  onSplit?: (path: string, direction: SplitDirection) => void;
  /** Reabre uma aba fechada, a de cima da pilha, na posição em que estava. */
  onReopenTab?: (tab: ClosedTab) => void;
  /** Permite trocar o editor nos testes (o CodeMirror exige medição de layout). */
  renderEditor?: (props: CodeEditorProps) => ReactNode;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

type Menu = { kind: 'tab'; path: string } | { kind: 'pane' } | null;

interface PendingClose {
  /** Abas a fechar. */
  paths: string[];
  /** As que têm alteração não salva. */
  dirty: string[];
}

/** Painel de editor: uma aba por arquivo, texto em memória e salvamento com checagem de hash. */
export function EditorPane({
  pane,
  roots = [],
  editorFocus = false,
  onToggleFocus,
  focused,
  onFocus,
  onSelect,
  onCloseTab,
  onSplit,
  onReopenTab,
  renderEditor,
}: EditorPaneProps) {
  const api = useApi();
  const session = useEditorSession();
  const drafts = useDrafts(session);
  const closedCount = useClosedCount(session);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [positions, setPositions] = useState<Record<string, EditorStatus>>({});
  const [menu, setMenu] = useState<Menu>(null);
  const [pending, setPending] = useState<PendingClose | null>(null);

  const activePath = pane.docs[Math.min(pane.activeIndex, pane.docs.length - 1)] ?? null;
  const saveShortcut = useShortcutLabel('save');
  const useFocusShortcut = useShortcutLabel('toggleEditorFocus');
  const gitBase = useGitBase(activePath);

  // Diz à sessão quais arquivos este painel mostra: fechar uma aba cujo arquivo aparece em outro painel
  // não perde o texto.
  useEffect(() => {
    session.panes.register(pane.id, pane.docs);
    return () => session.panes.unregister(pane.id);
  }, [session, pane.id, pane.docs]);

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
      session.drafts.set(activePath, { text: r.value.content, baseHash: r.value.hash, dirty: false });
    });
    return () => {
      alive = false;
    };
  }, [api, session, activePath, drafts]);

  const change = useCallback(
    (path: string, text: string) => {
      session.drafts.patch(path, (draft) => (text === draft.text ? draft : { ...draft, text, dirty: true }));
    },
    [session],
  );

  /** Grava um arquivo com o hash lido; devolve a mensagem de erro, ou `null` quando gravou. */
  const writeFile = useCallback(
    async (path: string): Promise<string | null> => {
      const draft = session.drafts.snapshot()[path];
      if (draft === undefined) return null;
      const r = await api.files.write(path, draft.text, draft.baseHash);
      if (!r.ok) return r.error.message;
      session.drafts.patch(path, (now) => ({
        ...now,
        baseHash: r.value.hash,
        dirty: now.text !== draft.text,
      }));
      return null;
    },
    [api, session],
  );

  const save = useCallback(
    async (path: string) => {
      if (session.drafts.snapshot()[path] === undefined || saving) return;
      setSaving(true);
      setError(null);
      const failure = await writeFile(path);
      setSaving(false);
      if (failure !== null) setError(failure);
    },
    [session, saving, writeFile],
  );

  /** Salva, arquivo por arquivo, os que têm alteração; devolve os que não foram gravados (com a mensagem). */
  const saveMany = useCallback(
    async (paths: readonly string[]): Promise<Map<string, string>> => {
      const failed = new Map<string, string>();
      setSaving(true);
      setError(null);
      for (const path of paths) {
        if (session.drafts.snapshot()[path]?.dirty !== true) continue;
        const failure = await writeFile(path);
        if (failure !== null) failed.set(path, failure);
      }
      setSaving(false);
      const first = [...failed.entries()][0];
      if (first) {
        setError(
          failed.size === 1
            ? `${fileName(first[0])}: ${first[1]}`
            : `${failed.size} arquivos não foram salvos. ${fileName(first[0])}: ${first[1]}`,
        );
      }
      return failed;
    },
    [session, writeFile],
  );

  // O atalho de salvar vem do mapa de atalhos (ouvinte único do app): ele chama o salvar deste painel.
  const saveActive = useRef<() => void>(() => undefined);
  saveActive.current = () => {
    if (activePath !== null && drafts[activePath]?.dirty === true) void save(activePath);
  };
  useEffect(() => registerEditorSaver(pane.id, () => saveActive.current()), [pane.id]);

  /** Fecha a aba: guarda na pilha para reabrir e, sem outro painel com o arquivo, esquece o rascunho. */
  const closeTab = useCallback(
    (path: string, index: number) => {
      session.closed.push({ paneId: pane.id, path, index });
      onCloseTab(path);
      if (!session.panes.holds(path, pane.id)) session.drafts.remove(path);
    },
    [session, pane.id, onCloseTab],
  );

  const requestClose = (path: string) => {
    const draft = drafts[path];
    const lost = draft?.dirty === true && !session.panes.holds(path, pane.id);
    if (lost && !window.confirm(`Descartar as alterações de ${fileName(path)}?`)) return;
    closeTab(path, pane.docs.indexOf(path));
  };

  const closeActive = useRef<() => void>(() => undefined);
  closeActive.current = () => {
    if (activePath !== null) requestClose(activePath);
  };
  useEffect(() => registerEditorCloser(pane.id, () => closeActive.current()), [pane.id]);

  /** Fecha várias abas; se alguma tem alteração não salva, uma pergunta só decide por todas. */
  const closeMany = (paths: string[]) => {
    const dirty = paths.filter((p) => drafts[p]?.dirty === true && !session.panes.holds(p, pane.id));
    if (dirty.length > 0) {
      setPending({ paths, dirty });
      return;
    }
    for (const path of paths) closeTab(path, pane.docs.indexOf(path));
  };

  const resolvePending = async (choice: 'save' | 'discard' | 'cancel') => {
    const current = pending;
    setPending(null);
    if (current === null || choice === 'cancel') return;
    const failed = choice === 'save' ? await saveMany(current.dirty) : new Map<string, string>();
    for (const path of current.paths) {
      if (failed.has(path)) continue;
      closeTab(path, pane.docs.indexOf(path));
    }
  };

  const dirtyPaths = pane.docs.filter((p) => drafts[p]?.dirty === true);
  const closeMenu = () => setMenu(null);

  useEffect(() => {
    if (menu === null) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.editor-menu')) setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  const menuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  };

  const normalized = activePath?.replace(/\\/g, '/') ?? '';
  const root = [...roots]
    .sort((a, b) => b.path.length - a.path.length)
    .find((r) =>
      normalized.toLowerCase().startsWith(r.path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() + '/'),
    );
  const relativePath = root ? normalized.slice(root.path.replace(/\/$/, '').length + 1) : normalized;
  const position = activePath ? positions[activePath] : undefined;
  const tabMenuPath = menu?.kind === 'tab' ? menu.path : null;

  return (
    <section
      className={`editor-pane${focused ? ' focused' : ''}`}
      onMouseDown={onFocus}
      onFocus={onFocus}
      data-testid={`editor-pane-${pane.id}`}
      aria-label="Editor de arquivos"
    >
      <div draggable className="editor-tabs" role="tablist" aria-label="Arquivos abertos">
        {pane.docs.map((path, index) => {
          const draft = drafts[path];
          const active = index === pane.activeIndex;
          return (
            <div
              key={path}
              className={`editor-tab${active ? ' active' : ''}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ kind: 'tab', path });
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-haspopup="menu"
                className="editor-tab-name"
                title={path}
                onClick={() => onSelect(index)}
                onKeyDown={(e) => {
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault();
                    setMenu({ kind: 'tab', path });
                  }
                }}
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
        {onToggleFocus && (
          <button
            type="button"
            className="editor-focus"
            aria-pressed={editorFocus}
            title={withShortcut('Editor em Foco', useFocusShortcut)}
            onClick={onToggleFocus}
          >
            {editorFocus ? 'Restaurar' : 'Expandir'}
          </button>
        )}
        {activePath !== null ? (
          <button
            type="button"
            className="editor-save"
            onClick={() => void save(activePath)}
            disabled={drafts[activePath]?.dirty !== true || saving}
            title={withShortcut('Salvar', saveShortcut)}
          >
            Salvar
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label="Menu do painel"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'pane'}
          onClick={() => setMenu(menu?.kind === 'pane' ? null : { kind: 'pane' })}
        >
          ⋮
        </button>
      </div>

      {activePath && (
        <nav className="editor-breadcrumbs" aria-label="Caminho do arquivo" title={activePath}>
          {relativePath
            .split('/')
            .filter(Boolean)
            .map((part, i, parts) => (
              <span key={i} className={i === parts.length - 1 ? 'breadcrumb-current' : ''}>
                {i > 0 && (
                  <span className="breadcrumb-separator" aria-hidden="true">
                    ›
                  </span>
                )}
                {part}
              </span>
            ))}
        </nav>
      )}
      {tabMenuPath !== null && (
        <ul className="agent-menu-list editor-menu" role="menu" aria-label="Menu da aba" onKeyDown={menuKey}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                requestClose(tabMenuPath);
              }}
            >
              Fechar
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              disabled={pane.docs.length < 2}
              onClick={() => {
                closeMenu();
                closeMany(pane.docs.filter((p) => p !== tabMenuPath));
              }}
            >
              Fechar outras
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                closeMany([...pane.docs]);
              }}
            >
              Fechar todas
            </button>
          </li>
          {onSplit !== undefined && (
            <>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onSplit(tabMenuPath, 'right');
                  }}
                >
                  Dividir à direita
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onSplit(tabMenuPath, 'down');
                  }}
                >
                  Dividir abaixo
                </button>
              </li>
            </>
          )}
        </ul>
      )}

      {menu?.kind === 'pane' && (
        <ul
          className="agent-menu-list editor-menu editor-menu-pane"
          role="menu"
          aria-label="Menu do painel"
          onKeyDown={menuKey}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              disabled={closedCount === 0 || onReopenTab === undefined}
              onClick={() => {
                closeMenu();
                const tab = session.closed.pop();
                if (tab !== undefined) onReopenTab?.(tab);
              }}
            >
              Reabrir aba fechada
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              disabled={dirtyPaths.length === 0 || saving}
              onClick={() => {
                closeMenu();
                void saveMany(dirtyPaths);
              }}
            >
              Salvar todos
            </button>
          </li>
        </ul>
      )}

      {error !== null ? (
        <div className="editor-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar aviso"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="editor-body">
        {activePath !== null && drafts[activePath] === undefined && (
          <p className="editor-loading">Abrindo {fileName(activePath)}…</p>
        )}
        {pane.docs.map((path) =>
          drafts[path] === undefined ? null : (
            <div
              key={path}
              className={'editor-document' + (path === activePath ? '' : ' editor-document-hidden')}
              inert={path !== activePath || undefined}
              aria-hidden={path !== activePath || undefined}
            >
              {(renderEditor ?? ((props) => <CodeEditor {...props} />))({
                paneId: pane.id,
                path,
                active: path === activePath,
                value: drafts[path].text,
                onChange: (text) => change(path, text),
                onSave: () => void save(path),
                gitBase: path === activePath ? gitBase : null,
                onStatus: (status) => setPositions((old) => ({ ...old, [path]: status })),
              })}
            </div>
          ),
        )}
      </div>

      <footer className="editor-status" aria-label="Status do editor">
        <span>
          {saving ? 'Salvando…' : activePath && drafts[activePath]?.dirty ? 'Alterações não salvas' : 'Salvo'}
        </span>
        <span className="spacer" />
        <span>
          Ln {position?.line ?? 1}, Col {position?.column ?? 1}
        </span>
        {(position?.cursors ?? 1) > 1 && <span>{position?.cursors} cursores</span>}
        {(position?.selected ?? 0) > 0 && <span>{position?.selected} selecionados</span>}
        <span>{activePath?.split('.').pop()?.toUpperCase() ?? 'Texto'}</span>
      </footer>
      {pending !== null && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal run-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Alterações não salvas"
          >
            <h2>Alterações não salvas</h2>
            <div className="confirm">
              <p>
                {pending.dirty.length === 1
                  ? 'Este arquivo tem alterações não salvas:'
                  : `${pending.dirty.length} arquivos têm alterações não salvas:`}
              </p>
              <ul className="unsaved-list">
                {pending.dirty.map((path) => (
                  <li key={path} title={path}>
                    {fileName(path)}
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button type="button" onClick={() => void resolvePending('cancel')}>
                  Cancelar
                </button>
                <button type="button" className="danger" onClick={() => void resolvePending('discard')}>
                  Descartar todos
                </button>
                <button type="button" className="primary" onClick={() => void resolvePending('save')}>
                  Salvar todos
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
