import { useEffect, useMemo, useState } from 'react';
import {
  LIMITS,
  type ActiveRunRef,
  type Group,
  type RunCatalog,
  type RunCommand,
} from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { ToolIcon } from './ToolIcon';

export interface RunConfigDialogProps {
  catalog: RunCatalog | null;
  groups: readonly Group[];
  /** Configuração que já abre selecionada (a ativa). */
  initialSelection: ActiveRunRef | null;
  /** Algo foi criado, editado ou excluído: quem abriu lê o catálogo de novo. */
  onChanged: () => void;
  onClose: () => void;
}

/** Campos do formulário; `id` presente = edição de uma personalizada. */
interface Form {
  groupId: string;
  id?: string;
  label: string;
  program: string;
  args: string[];
  folder: string;
  /** Detectada: só leitura. */
  readOnly: boolean;
}

const DUPLICATE_NAME = 'Já existe uma configuração com esse nome.';

function foldersOfGroup(group: Group | undefined): string[] {
  const folders = (group?.folders ?? []).map((f) => f.path);
  if (folders.length === 0 && group?.repoPath) folders.push(group.repoPath);
  return folders;
}

function fromCommand(c: RunCommand): Form {
  return {
    groupId: c.groupId,
    id: c.id,
    label: c.label,
    program: c.program,
    args: [...c.args],
    folder: c.folder,
    readOnly: c.source !== 'custom',
  };
}

function blank(groups: readonly Group[], preferred: string | undefined): Form {
  const group = groups.find((g) => g.id === preferred) ?? groups[0];
  return {
    groupId: group?.id ?? '',
    label: '',
    program: '',
    args: [],
    folder: foldersOfGroup(group)[0] ?? '',
    readOnly: false,
  };
}

/** "<nome> (cópia)"; com número ("(cópia 2)") se já existir entre as personalizadas do workspace. */
export function copyName(label: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const first = `${label} (cópia)`;
  if (!used.has(first.toLowerCase())) return first;
  for (let n = 2; ; n++) {
    const candidate = `${label} (cópia ${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Janela de configurações: a lista à esquerda, os campos da escolhida à direita. */
export function RunConfigDialog({
  catalog,
  groups,
  initialSelection,
  onChanged,
  onClose,
}: RunConfigDialogProps) {
  const api = useApi();
  const commands = useMemo(() => catalog?.commands ?? [], [catalog]);
  const [form, setForm] = useState<Form | null>(() => {
    const found = commands.find(
      (c) => c.groupId === initialSelection?.groupId && c.id === initialSelection.commandId,
    );
    return found ? fromCommand(found) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ordered = useMemo(() => [...groups].sort((a, b) => a.order - b.order), [groups]);
  const customLabels = (groupId: string, exceptId?: string) =>
    commands
      .filter((c) => c.groupId === groupId && c.source === 'custom' && c.id !== exceptId)
      .map((c) => c.label);

  const select = (c: RunCommand) => {
    setError(null);
    setForm(fromCommand(c));
  };
  const patch = (over: Partial<Form>) => setForm((f) => (f ? { ...f, ...over } : f));

  const group = ordered.find((g) => g.id === form?.groupId);
  const folderOptions = (() => {
    const list = foldersOfGroup(group);
    if (form && form.folder !== '' && !list.includes(form.folder)) list.push(form.folder);
    return list;
  })();
  const name = form?.label.trim() ?? '';
  const repeated =
    form !== null &&
    !form.readOnly &&
    name !== '' &&
    customLabels(form.groupId, form.id).some((l) => l.toLowerCase() === name.toLowerCase());
  const canSave =
    form !== null &&
    !form.readOnly &&
    !busy &&
    name !== '' &&
    form.program.trim() !== '' &&
    form.folder !== '' &&
    !repeated;

  /** Roda uma ação do diálogo mostrando o erro do principal sem fechar nada. */
  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!form || !canSave) return;
    void guarded(async () => {
      const input = {
        label: name,
        program: form.program.trim(),
        args: form.args,
        folder: form.folder,
        ...(form.id !== undefined ? { id: form.id } : {}),
      };
      const saved = await unwrap(api.run.saveCommand(form.groupId, input));
      setForm(fromCommand(saved));
      onChanged();
    });
  };

  const remove = () => {
    if (!form?.id || form.readOnly) return;
    const { groupId, id } = form;
    void guarded(async () => {
      await unwrap(api.run.removeCommand(groupId, id));
      setForm(null);
      onChanged();
    });
  };

  const duplicate = () => {
    if (!form) return;
    setError(null);
    setForm({
      groupId: form.groupId,
      label: copyName(form.label, customLabels(form.groupId)),
      program: form.program,
      args: [...form.args],
      folder: form.folder,
      readOnly: false,
    });
  };

  const newConfig = () => {
    setError(null);
    setForm(blank(ordered, form?.groupId ?? initialSelection?.groupId));
  };

  const isSaved = form?.id !== undefined;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal run-config"
        role="dialog"
        aria-modal="true"
        aria-label="Configurações de execução"
      >
        <h2>Configurações de execução</h2>
        <div className="run-config-body">
          <div className="run-config-list">
            <button type="button" onClick={newConfig}>
              Nova configuração
            </button>
            <div role="listbox" aria-label="Configurações" className="run-list">
              {ordered.map((g) => {
                const own = commands.filter((c) => c.groupId === g.id);
                if (own.length === 0) return null;
                return (
                  <div key={g.id} className="run-group">
                    <div className="run-group-name">{g.name}</div>
                    {own.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={form?.id === c.id && form.groupId === c.groupId}
                        className={`run-option${form?.id === c.id && form.groupId === c.groupId ? ' selected' : ''}`}
                        onClick={() => select(c)}
                      >
                        <ToolIcon tool={c.tool} />
                        <span className="run-option-label">{c.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="run-config-form">
            {form === null ? (
              <p className="run-empty">Escolha uma configuração ou crie uma nova.</p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save();
                }}
              >
                {form.readOnly && (
                  <p className="hint">
                    Detectada no projeto: somente leitura. Use Duplicar para criar uma versão editável.
                  </p>
                )}
                <label>
                  Nome
                  <input
                    type="text"
                    value={form.label}
                    maxLength={LIMITS.commandLabel}
                    disabled={form.readOnly}
                    onChange={(e) => patch({ label: e.target.value })}
                  />
                </label>
                {repeated && <p className="field-error">{DUPLICATE_NAME}</p>}
                <label>
                  Workspace
                  <select
                    aria-label="Workspace"
                    value={form.groupId}
                    disabled={form.readOnly || isSaved}
                    onChange={(e) => {
                      const next = ordered.find((g) => g.id === e.target.value);
                      patch({ groupId: e.target.value, folder: foldersOfGroup(next)[0] ?? '' });
                    }}
                  >
                    {ordered.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Programa
                  <input
                    type="text"
                    value={form.program}
                    disabled={form.readOnly}
                    onChange={(e) => patch({ program: e.target.value })}
                  />
                </label>
                <fieldset className="run-args">
                  <legend>Argumentos</legend>
                  {form.args.map((arg, i) => (
                    <div key={i} className="run-arg-row">
                      <input
                        type="text"
                        aria-label={`Argumento ${i + 1}`}
                        value={arg}
                        disabled={form.readOnly}
                        onChange={(e) =>
                          patch({ args: form.args.map((a, j) => (j === i ? e.target.value : a)) })
                        }
                      />
                      {!form.readOnly && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remover argumento ${i + 1}`}
                          title="Remover argumento"
                          onClick={() => patch({ args: form.args.filter((_, j) => j !== i) })}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {!form.readOnly && (
                    <button
                      type="button"
                      disabled={form.args.length >= LIMITS.commandArgs}
                      onClick={() => patch({ args: [...form.args, ''] })}
                    >
                      Adicionar argumento
                    </button>
                  )}
                </fieldset>
                <label>
                  Pasta
                  <select
                    aria-label="Pasta"
                    value={form.folder}
                    disabled={form.readOnly}
                    onChange={(e) => patch({ folder: e.target.value })}
                  >
                    {folderOptions.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                {error !== null && (
                  <p role="alert" className="field-error">
                    {error}
                  </p>
                )}
                <div className="actions">
                  <button type="button" onClick={duplicate} disabled={busy}>
                    Duplicar
                  </button>
                  {!form.readOnly && isSaved && (
                    <button type="button" className="danger" onClick={remove} disabled={busy}>
                      Excluir
                    </button>
                  )}
                  {!form.readOnly && (
                    <button type="submit" className="primary" disabled={!canSave}>
                      Salvar
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
        {form === null && error !== null && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
