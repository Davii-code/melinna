import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { checkStates, visibleRows, type CheckState, type Selection, type TreeNode } from '../../git/git-store';
import { KIND_LABEL, absolutePath } from './git-ui';

export interface ActiveFile {
  root: string;
  path: string;
}

export interface ChangeTreeProps {
  tree: TreeNode[];
  expanded: ReadonlySet<string>;
  selection: Selection;
  /** Arquivo com o diff aberto, destacado na árvore. */
  activeFile: ActiveFile | null;
  onToggleExpand: (id: string) => void;
  onToggleCheck: (node: TreeNode) => void;
  onShowDiff: (root: string, path: string) => void;
  /** Recebe o caminho absoluto do arquivo. */
  onOpenFile: (path: string) => void;
  /** Ctrl+Alt+A num nó: leva os não rastreados dele para "Changes". */
  onAddToVcs?: (node: TreeNode) => void;
}

export const ROW_HEIGHT = 24;
const OVERSCAN = 8;
/** Altura usada antes de a área ser medida (e no jsdom, que não mede). */
const FALLBACK_HEIGHT = 480;

function Check(props: { label: string; state: CheckState; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.state === 'partial';
  }, [props.state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={`Selecionar ${props.label}`}
      checked={props.state === 'checked'}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={props.onChange}
    />
  );
}

function filesLabel(n: number): string {
  return `${n} ${n === 1 ? 'file' : 'files'}`;
}

/** Árvore de alterações com caixas de seleção; só as linhas visíveis na rolagem são montadas. */
export function ChangeTree(props: ChangeTreeProps) {
  const { tree, expanded, selection, activeFile } = props;
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      if (el.clientHeight > 0) setHeight(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  const states = useMemo(() => checkStates(tree, selection), [tree, selection]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const shown = rows.slice(first, last);

  const activate = (node: TreeNode) => {
    if (node.kind === 'file') props.onShowDiff(node.root, node.path as string);
    else props.onToggleExpand(node.id);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, node: TreeNode) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      activate(node);
    } else if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      props.onAddToVcs?.(node);
    } else if (e.key === ' ') {
      e.preventDefault();
      props.onToggleCheck(node);
    } else if (e.key === 'ArrowRight' && node.kind !== 'file' && !expanded.has(node.id)) {
      props.onToggleExpand(node.id);
    } else if (e.key === 'ArrowLeft' && node.kind !== 'file' && expanded.has(node.id)) {
      props.onToggleExpand(node.id);
    }
  };

  return (
    <div
      ref={box}
      className="change-tree"
      role="tree"
      aria-label="Alterações"
      aria-multiselectable="true"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        {shown.map(({ node, depth }, i) => {
          const removed = node.kind === 'file' && node.change?.kind === 'deleted';
          const active = node.kind === 'file' && activeFile?.root === node.root && activeFile.path === node.path;
          const title =
            node.kind === 'file'
              ? [
                  node.change?.oldPath ? `${node.change.oldPath} → ${node.path}` : node.path,
                  removed ? 'arquivo removido' : null,
                ]
                  .filter(Boolean)
                  .join(' — ')
              : undefined;
          return (
            <div
              key={node.id}
              role="treeitem"
              tabIndex={0}
              aria-level={depth + 1}
              aria-expanded={node.kind === 'file' ? undefined : expanded.has(node.id)}
              aria-selected={active}
              aria-posinset={first + i + 1}
              aria-setsize={rows.length}
              className={`change-row change-${node.kind}${active ? ' active' : ''}`}
              style={{ position: 'absolute', top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: 6 + depth * 14 }}
              title={title}
              onClick={() => activate(node)}
              onDoubleClick={() => {
                if (node.kind === 'file' && !removed) props.onOpenFile(absolutePath(node.root, node.path as string));
              }}
              onKeyDown={(e) => onKey(e, node)}
            >
              <span className="change-caret" aria-hidden="true">
                {node.kind === 'file' ? '' : expanded.has(node.id) ? '▾' : '▸'}
              </span>
              <Check label={node.label} state={states.get(node.id) ?? 'unchecked'} onChange={() => props.onToggleCheck(node)} />
              <span className="change-label">{node.label}</span>
              {node.kind === 'repo' && node.branch && <span className="change-branch">{node.branch}</span>}
              {node.kind !== 'file' && <span className="meta">{filesLabel(node.count)}</span>}
              {node.kind === 'file' && node.change && (
                <span className={`git-kind git-kind-${node.change.kind}`}>{KIND_LABEL[node.change.kind]}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
