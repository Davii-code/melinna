import { useMemo, useRef, useState } from 'react';
import { LIMITS, type RunCommand, type RunConfigTool } from '../../../shared/ipc-contract';
import { ToolIcon } from './ToolIcon';
import { TOOL_GROUPS, toolGroupOf, type DraftItem, type ToolGroup } from './run-draft';

export interface RunConfigTreeProps {
  items: readonly DraftItem[];
  selectedKey: string | null;
  /** Pastas criadas com "Nova pasta" que ainda não têm configuração. */
  extraFolders: readonly string[];
  /** Scripts detectados do workspace: origem do menu "a partir de um script detectado". */
  detected: readonly RunCommand[];
  onSelect: (key: string) => void;
  onAdd: (tool: RunConfigTool) => void;
  onAddDetected: (command: RunCommand) => void;
  onCopy: () => void;
  onRemove: (key: string) => void;
  onNewFolder: (name: string) => void;
  onSort: () => void;
  onMove: (key: string, folderGroup: string | null) => void;
}

const DRAG_TYPE = 'text/x-melinna-run-config';
const ADD_TOOL: Record<ToolGroup, RunConfigTool> = {
  npm: 'npm',
  maven: 'maven',
  gradle: 'gradle',
  compose: 'compose',
  program: 'program',
};

function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

type RowMenu = { key: string; stage: 'actions' | 'folders' } | null;

/** Árvore das configurações do workspace por ferramenta e pasta, com a barra de ações. */
export function RunConfigTree({
  items,
  selectedKey,
  extraFolders,
  detected,
  onSelect,
  onAdd,
  onAddDetected,
  onCopy,
  onRemove,
  onNewFolder,
  onSort,
  onMove,
}: RunConfigTreeProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [rowMenu, setRowMenu] = useState<RowMenu>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const treeRef = useRef<HTMLUListElement>(null);

  const selected = items.find((i) => i.key === selectedKey) ?? null;
  const folderNames = useMemo(() => {
    const names = new Set<string>(extraFolders);
    for (const i of items) if (i.folderGroup !== null) names.add(i.folderGroup);
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [items, extraFolders]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const byOrder = (a: DraftItem, b: DraftItem) => a.order - b.order;

  const focusRelative = (from: HTMLElement, step: 1 | -1) => {
    const all = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const next = all[all.indexOf(from) + step];
    next?.focus();
  };

  const onTreeKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!target) return;
    const expandable = target.hasAttribute('aria-expanded');
    const id = target.dataset.nodeId ?? '';
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRelative(target, 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRelative(target, -1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (expandable && !collapsed.has(id)) toggle(id);
        else target.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (expandable && collapsed.has(id)) toggle(id);
        else if (expandable) (target.querySelector('[role="treeitem"]') as HTMLElement | null)?.focus();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (expandable) toggle(id);
        else if (target.dataset.key) onSelect(target.dataset.key);
        break;
      default:
    }
  };

  const configNode = (item: DraftItem) => (
    <li
      key={item.key}
      role="treeitem"
      aria-label={item.name}
      aria-selected={item.key === selectedKey}
      data-key={item.key}
      tabIndex={item.key === selectedKey ? 0 : -1}
      draggable
      className={`tree-config${item.key === selectedKey ? ' selected' : ''}${item.available ? '' : ' unavailable'}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.key);
      }}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, item.key);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <span className="tree-row">
        <ToolIcon tool={item.tool} />
        <span className="run-option-label">{item.name}</span>
        {item.running > 0 && <span className="run-dot" data-testid="run-config-running" title="Rodando" />}
        <button
          type="button"
          className="icon-button tree-more"
          aria-label={`Mais ações de ${item.name}`}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(item.key);
            setRowMenu({ key: item.key, stage: 'actions' });
          }}
        >
          ⋮
        </button>
      </span>
    </li>
  );

  const dropTarget = (folder: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.dataTransfer.getData(DRAG_TYPE);
      if (key !== '') onMove(key, folder);
    },
  });

  const groupNode = (group: { id: ToolGroup; label: string }) => {
    const own = items.filter((i) => toolGroupOf(i.tool) === group.id);
    const nodeId = `tool:${group.id}`;
    const open = !collapsed.has(nodeId);
    const loose = own.filter((i) => i.folderGroup === null).sort(byOrder);
    return (
      <li
        key={group.id}
        role="treeitem"
        aria-label={group.label}
        aria-expanded={open}
        data-node-id={nodeId}
        tabIndex={-1}
        className="tree-group"
        onClick={(e) => {
          e.stopPropagation();
          toggle(nodeId);
        }}
        {...dropTarget(null)}
      >
        <span className="tree-row tree-group-name">{group.label}</span>
        {open && (
          <ul role="group">
            {loose.map(configNode)}
            {folderNames
              .filter((name) => extraFolders.includes(name) || own.some((i) => i.folderGroup === name))
              .map((name) => {
                const inFolder = own.filter((i) => i.folderGroup === name).sort(byOrder);
                const folderId = `${nodeId}/${name}`;
                const folderOpen = !collapsed.has(folderId);
                return (
                  <li
                    key={name}
                    role="treeitem"
                    aria-label={name}
                    aria-expanded={folderOpen}
                    data-node-id={folderId}
                    tabIndex={-1}
                    className="tree-folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(folderId);
                    }}
                    {...dropTarget(name)}
                  >
                    <span className="tree-row tree-folder-name">{name}</span>
                    {folderOpen && inFolder.length > 0 && <ul role="group">{inFolder.map(configNode)}</ul>}
                  </li>
                );
              })}
          </ul>
        )}
      </li>
    );
  };

  const presentGroups = TOOL_GROUPS.filter((g) => items.some((i) => toolGroupOf(i.tool) === g.id));
  const menuItem = rowMenu === null ? null : (items.find((i) => i.key === rowMenu.key) ?? null);
  const closeMenus = () => {
    setAddOpen(false);
    setRowMenu(null);
  };
  const stopEsc = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenus();
    }
  };
  const removeTitle =
    selected === null
      ? 'Escolha uma configuração'
      : selected.running > 0
        ? 'A configuração está rodando: pare-a antes de remover'
        : 'Remover configuração';
  const confirmItem = items.find((i) => i.key === confirmKey) ?? null;

  return (
    <div className="run-config-tree">
      <div className="tree-toolbar" role="toolbar" aria-label="Ações da árvore">
        <button
          type="button"
          className="icon-button"
          aria-label="Adicionar configuração"
          aria-haspopup="menu"
          aria-expanded={addOpen}
          title="Adicionar configuração"
          onClick={() => {
            setRowMenu(null);
            setAddOpen((v) => !v);
          }}
        >
          +
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Remover configuração"
          title={removeTitle}
          disabled={selected === null || selected.running > 0}
          onClick={() => selected && setConfirmKey(selected.key)}
        >
          −
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Copiar configuração"
          title="Copiar configuração"
          disabled={selected === null}
          onClick={onCopy}
        >
          ⧉
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Nova pasta"
          title="Nova pasta"
          aria-expanded={folderOpen}
          onClick={() => setFolderOpen((v) => !v)}
        >
          🗀
        </button>
        <button type="button" className="icon-button" aria-label="Ordenar" title="Ordenar" onClick={onSort}>
          A↓
        </button>
      </div>
      {addOpen && (
        <ul
          className="agent-menu-list run-menu"
          role="menu"
          aria-label="Tipos de configuração"
          onKeyDown={stopEsc}
        >
          {TOOL_GROUPS.map((g) => (
            <li key={g.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAddOpen(false);
                  onAdd(ADD_TOOL[g.id]);
                }}
              >
                {g.label}
              </button>
            </li>
          ))}
          {detected.length > 0 && <li role="separator" className="menu-separator" />}
          {detected.map((c) => (
            <li key={c.id} role="none">
              <button
                type="button"
                role="menuitem"
                title="Criar a partir de um script detectado"
                onClick={() => {
                  setAddOpen(false);
                  onAddDetected(c);
                }}
              >
                {`${c.label} (${baseName(c.folder)})`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {folderOpen && (
        <form
          className="tree-new-folder"
          onSubmit={(e) => {
            e.preventDefault();
            const name = folderName.trim();
            if (name === '') return;
            onNewFolder(name);
            setFolderName('');
            setFolderOpen(false);
          }}
        >
          <input
            type="text"
            aria-label="Nome da pasta"
            value={folderName}
            maxLength={LIMITS.folderGroup}
            onChange={(e) => setFolderName(e.target.value)}
          />
          <button type="submit" aria-label="Criar pasta" disabled={folderName.trim() === ''}>
            Criar
          </button>
        </form>
      )}
      {menuItem !== null && rowMenu !== null && rowMenu.stage === 'actions' && (
        <ul
          className="agent-menu-list run-menu"
          role="menu"
          aria-label={`Ações de ${menuItem.name}`}
          onKeyDown={stopEsc}
        >
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => setRowMenu({ key: menuItem.key, stage: 'folders' })}
            >
              Mover para pasta…
            </button>
          </li>
        </ul>
      )}
      {menuItem !== null && rowMenu !== null && rowMenu.stage === 'folders' && (
        <ul className="agent-menu-list run-menu" role="menu" aria-label="Pastas" onKeyDown={stopEsc}>
          {[null, ...folderNames].map((name) => (
            <li key={name ?? '∅'} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRowMenu(null);
                  onMove(menuItem.key, name);
                }}
              >
                {name ?? 'Sem pasta'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul
        ref={treeRef}
        role="tree"
        aria-label="Configurações"
        className="run-tree"
        tabIndex={selectedKey === null ? 0 : -1}
        onKeyDown={onTreeKey}
      >
        {presentGroups.map(groupNode)}
      </ul>
      {items.length === 0 && <p className="run-empty">Nenhuma configuração</p>}
      {confirmItem !== null && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal run-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Remover configuração?"
          >
            <div className="confirm">
              <p>{`Remover a configuração "${confirmItem.name}"? A remoção vale ao aplicar.`}</p>
              <div className="actions">
                <button type="button" onClick={() => setConfirmKey(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setConfirmKey(null);
                    onRemove(confirmItem.key);
                  }}
                >
                  Remover
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
