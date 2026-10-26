import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveRunRef,
  Group,
  RunCommand,
  RunConfigTool,
  RunConfigView,
} from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import { useRun, type RunStore } from '../../store/run-store';
import { RunConfigForm, problemsOf } from './RunConfigForm';
import { RunConfigTree } from './RunConfigTree';
import {
  applyDraft,
  blankDraft,
  copyDraft,
  draftFromDetected,
  draftFromView,
  isDirty,
  moveToFolder,
  sortAlphabetically,
  type DraftItem,
} from './run-draft';

export interface RunConfigsDialogProps {
  store: RunStore;
  groups: readonly Group[];
  /** Configuração que já abre selecionada (a ativa). */
  initialSelection: ActiveRunRef | null;
  onClose: () => void;
}

function foldersOfGroup(group: Group | undefined): string[] {
  const folders = (group?.folders ?? []).map((f) => f.path);
  if (folders.length === 0 && group?.repoPath) folders.push(group.repoPath);
  return folders;
}

function viewsOf(configs: RunConfigView[] | null, groupId: string): RunConfigView[] {
  return (configs ?? []).filter((c) => c.groupId === groupId);
}

/**
 * Janela de configurações de execução: a árvore à esquerda, os campos da escolhida à direita. As mudanças
 * ficam num rascunho até Aplicar ou OK; Cancelar (ou Esc) descarta, perguntando se houve alteração.
 */
export function RunConfigsDialog({ store, groups, initialSelection, onClose }: RunConfigsDialogProps) {
  const api = useApi();
  const state = useRun(store);
  const ordered = useMemo(() => [...groups].sort((a, b) => a.order - b.order), [groups]);
  const [groupId, setGroupId] = useState(
    () => ordered.find((g) => g.id === initialSelection?.groupId)?.id ?? ordered[0]?.id ?? '',
  );
  const [items, setItems] = useState<DraftItem[]>(() => (store.get().configs ?? []).map(draftFromView));
  const [removed, setRemoved] = useState<{ groupId: string; id: string }[]>([]);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const found = (store.get().configs ?? []).find(
      (c) => c.groupId === initialSelection?.groupId && c.id === initialSelection.commandId,
    );
    return found?.id ?? null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const counter = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const group = ordered.find((g) => g.id === groupId);
  const folders = useMemo(() => foldersOfGroup(group), [group]);
  const groupItems = useMemo(() => items.filter((i) => i.groupId === groupId), [items, groupId]);
  const detected = useMemo(
    () => state.detected.filter((c) => c.groupId === groupId),
    [state.detected, groupId],
  );
  const selected = groupItems.find((i) => i.key === selectedKey) ?? null;

  const originalOf = useCallback((id: string) => viewsOf(store.get().configs, id), [store]);
  const removedIdsOf = (id: string) => removed.filter((r) => r.groupId === id).map((r) => r.id);
  const dirty = ordered.some((g) =>
    isDirty(
      originalOf(g.id),
      items.filter((i) => i.groupId === g.id),
      removedIdsOf(g.id),
    ),
  );
  const valid = items.every((i) => {
    const siblings = items.filter((s) => s.groupId === i.groupId);
    const own = foldersOfGroup(ordered.find((g) => g.id === i.groupId));
    return Object.keys(problemsOf(i, siblings, own)).length === 0;
  });

  useEffect(() => {
    const target =
      root.current?.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]') ??
      root.current?.querySelector<HTMLElement>('[role="tree"]');
    target?.focus();
    // Só no primeiro desenho: depois o foco é de quem o usuário usa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestClose = useCallback(() => {
    if (dirty) setAskDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (askDiscard) setAskDiscard(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askDiscard, requestClose]);

  const newKey = () => `novo:${++counter.current}`;
  const add = (item: DraftItem) => {
    setError(null);
    setItems((list) => [...list, item]);
    setSelectedKey(item.key);
  };
  const patchSelected = (patch: Partial<DraftItem>) => {
    if (!selected) return;
    setItems((list) => list.map((i) => (i.key === selected.key ? { ...i, ...patch } : i)));
  };

  /** Grava o rascunho de cada workspace e relê as configurações; devolve o mapa de chaves para ids. */
  const apply = async (): Promise<Map<string, string> | null> => {
    setBusy(true);
    setError(null);
    try {
      const ids = new Map<string, string>();
      for (const g of ordered) {
        const mine = items.filter((i) => i.groupId === g.id);
        const gone = removedIdsOf(g.id);
        if (!isDirty(originalOf(g.id), mine, gone)) {
          for (const i of mine) if (i.id !== null) ids.set(i.key, i.id);
          continue;
        }
        const result = await applyDraft(api, g.id, originalOf(g.id), mine, gone);
        if (!result.ok) {
          setError(result.message);
          if (result.key !== null) setSelectedKey(result.key);
          await store.refresh();
          return null;
        }
        for (const [key, id] of result.ids) ids.set(key, id);
      }
      await store.refresh();
      setItems((store.get().configs ?? []).map(draftFromView));
      setRemoved([]);
      setSelectedKey((key) => (key === null ? null : (ids.get(key) ?? key)));
      return ids;
    } finally {
      setBusy(false);
    }
  };

  const canApply = dirty && valid && !busy;
  const canRun = selected !== null && selected.available && valid && !busy;

  const run = async () => {
    if (!selected) return;
    const ids = dirty ? await apply() : new Map([[selected.key, selected.id ?? '']]);
    const id = ids?.get(selected.key);
    if (!id) return;
    await store.choose({ groupId: selected.groupId, commandId: id });
    onClose();
    await store.run();
  };

  const ok = async () => {
    if (!dirty) return onClose();
    if (await apply()) onClose();
  };

  const remove = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (!item) return;
    if (item.id !== null) setRemoved((r) => [...r, { groupId: item.groupId, id: item.id as string }]);
    setItems((list) =>
      list
        .filter((i) => i.key !== key)
        .map((i) => (i.beforeLaunch === key ? { ...i, beforeLaunch: null } : i)),
    );
    setSelectedKey(null);
  };

  const addTool = (tool: RunConfigTool) => {
    const folder = selected?.folder ?? folders[0] ?? '';
    add(blankDraft(tool, groupId, folder, newKey(), groupItems));
  };
  const addDetected = (command: RunCommand) => add(draftFromDetected(command, newKey(), groupItems));

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal run-config"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações de execução"
        ref={root}
      >
        <h2>Configurações de execução</h2>
        <div className="run-config-body">
          <div className="run-config-list">
            {ordered.length > 1 && (
              <label>
                Workspace
                <select
                  value={groupId}
                  onChange={(e) => {
                    setGroupId(e.target.value);
                    setSelectedKey(null);
                    setExtraFolders([]);
                    setError(null);
                  }}
                >
                  {ordered.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <RunConfigTree
              items={groupItems}
              selectedKey={selectedKey}
              extraFolders={extraFolders}
              detected={detected}
              onSelect={(key) => {
                setError(null);
                setSelectedKey(key);
              }}
              onAdd={addTool}
              onAddDetected={addDetected}
              onCopy={() => selected && add(copyDraft(selected, newKey(), groupItems))}
              onRemove={remove}
              onNewFolder={(name) => setExtraFolders((f) => (f.includes(name) ? f : [...f, name]))}
              onSort={() =>
                setItems((list) => {
                  const sorted = new Map(
                    sortAlphabetically(list.filter((i) => i.groupId === groupId)).map((i) => [i.key, i]),
                  );
                  return list.map((i) => sorted.get(i.key) ?? i);
                })
              }
              onMove={(key, folderGroup) => setItems((list) => moveToFolder(list, key, folderGroup))}
            />
          </div>
          <div className="run-config-form">
            {selected === null ? (
              <p className="run-empty">Escolha uma configuração ou crie uma nova.</p>
            ) : (
              <RunConfigForm
                item={selected}
                siblings={groupItems}
                folders={folders}
                detected={detected}
                onChange={patchSelected}
              />
            )}
          </div>
        </div>
        {error !== null && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="run-config-run"
            disabled={!canRun}
            title={selected === null ? 'Escolha uma configuração' : undefined}
            onClick={() => void run()}
          >
            Rodar
          </button>
          <span className="actions-spacer" />
          <button
            type="button"
            className="primary"
            disabled={busy || (dirty && !valid)}
            onClick={() => void ok()}
          >
            OK
          </button>
          <button type="button" onClick={requestClose}>
            Cancelar
          </button>
          <button type="button" disabled={!canApply} onClick={() => void apply()}>
            Aplicar
          </button>
        </div>
        {askDiscard && (
          <div className="modal-backdrop" role="presentation">
            <div
              className="modal run-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-label="Descartar as alterações?"
            >
              <div className="confirm">
                <p>Descartar as alterações feitas nas configurações de execução?</p>
                <div className="actions">
                  <button type="button" onClick={() => setAskDiscard(false)}>
                    Continuar editando
                  </button>
                  <button type="button" className="danger" onClick={onClose}>
                    Descartar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
