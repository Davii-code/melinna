import { useEffect, useState } from 'react';
import { LIMITS, type Group } from '../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../api';

/** Mesmo limite do núcleo (`MAX_FOLDERS`); a interface bloqueia antes de chamar o principal. */
export const MAX_WORKSPACE_FOLDERS = 32;

export interface WorkspaceDialogProps {
  /** Ausente = criar um workspace; presente = editar este (a lista vem sempre daqui, do estado). */
  group?: Group;
  /** Disponibilidade por id de pasta, como veio no snapshot; ausente conta como disponível. */
  availability?: Readonly<Record<string, boolean>>;
  /** O workspace tem sessão viva: as mudanças valem só para terminais novos. */
  hasLiveSession?: boolean;
  /** Chamado ao criar com sucesso. */
  onDone?: (group: Group) => void;
  onClose: () => void;
}

interface Entry {
  id: string;
  path: string;
}

/** Chave para achar repetidas: sem separador no fim e, em caminhos do Windows, sem diferenciar maiúsculas. */
function samePathKey(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
  return /^[A-Za-z]:|\\/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function tooMany(): string {
  return `Um workspace pode ter no máximo ${MAX_WORKSPACE_FOLDERS} pastas.`;
}

/** Cria ou edita um workspace: nome, pastas (várias, pelo diálogo nativo) e qual é a principal. */
export function WorkspaceDialog({ group, availability, hasLiveSession, onDone, onClose }: WorkspaceDialogProps) {
  const api = useApi();
  const editing = group !== undefined;
  const [name, setName] = useState(group?.name ?? '');
  const [draft, setDraft] = useState<string[]>([]);
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries: Entry[] = editing
    ? (group.folders ?? [])
    : draft.map((path, i) => ({ id: String(i), path }));
  const primaryId = editing ? group.primaryFolderId : String(primaryIndex);

  /** Escolhe pastas no diálogo nativo e devolve só as novas; mostra o motivo quando há repetida ou excesso. */
  const pickNew = async (): Promise<string[] | null> => {
    const picked = await unwrap(api.workspace.pickFolders(entries.at(-1)?.path));
    if (picked.length === 0) return null;
    const known = new Set(entries.map((e) => samePathKey(e.path)));
    const fresh: string[] = [];
    for (const path of picked) {
      const key = samePathKey(path);
      if (known.has(key)) {
        setError(`A pasta ${path} já está neste workspace.`);
        return null;
      }
      known.add(key);
      fresh.push(path);
    }
    if (entries.length + fresh.length > MAX_WORKSPACE_FOLDERS) {
      setError(tooMany());
      return null;
    }
    return fresh;
  };

  /** Executa uma ação do diálogo mostrando o erro do principal sem fechar nada. */
  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addFolders = () =>
    attempt(async () => {
      const fresh = await pickNew();
      if (!fresh) return;
      if (editing) await unwrap(api.workspace.updateWorkspace(group.id, { kind: 'addFolders', folders: fresh }));
      else setDraft((d) => [...d, ...fresh]);
    });

  const removeFolder = (entry: Entry, index: number) => {
    if (!editing) {
      setDraft((d) => d.filter((_, i) => i !== index));
      setPrimaryIndex((p) => (index < p ? p - 1 : index === p ? 0 : p));
      return;
    }
    void attempt(async () => {
      await unwrap(api.workspace.updateWorkspace(group.id, { kind: 'removeFolder', folderId: entry.id }));
    });
  };

  const choosePrimary = (entry: Entry, index: number) => {
    if (!editing) {
      setPrimaryIndex(index);
      return;
    }
    void attempt(async () => {
      await unwrap(api.workspace.updateWorkspace(group.id, { kind: 'setPrimary', folderId: entry.id }));
    });
  };

  const commitName = () => {
    if (!editing) return;
    const next = name.trim();
    if (next.length === 0) {
      setName(group.name);
      return;
    }
    if (next === group.name) return;
    void attempt(async () => {
      await unwrap(api.workspace.updateWorkspace(group.id, { kind: 'rename', name: next }));
    });
  };

  const canCreate = !editing && name.trim().length > 0 && draft.length > 0 && !busy;

  const create = () =>
    attempt(async () => {
      const created = await unwrap(
        api.workspace.createWorkspace({ name: name.trim(), folders: draft, primaryIndex }),
      );
      onDone?.(created);
    });

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <h2 id="workspace-dialog-title">{editing ? 'Editar workspace' : 'Novo workspace'}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing) commitName();
            else if (canCreate) void create();
          }}
        >
          <label>
            Nome
            <input
              value={name}
              maxLength={LIMITS.groupName}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
            />
          </label>
          <fieldset className="workspace-folders">
            <legend>Pastas</legend>
            {entries.length === 0 ? (
              <p className="meta">Nenhuma pasta ainda. A pasta principal é onde os terminais abrem.</p>
            ) : (
              <ul>
                {entries.map((entry, index) => {
                  const available = availability?.[entry.id] !== false;
                  return (
                    <li key={entry.id} className={available ? undefined : 'unavailable'}>
                      <label className="check" title="Os terminais abrem nesta pasta">
                        <input
                          type="radio"
                          name="workspace-primary"
                          aria-label={`Principal: ${entry.path}`}
                          checked={entry.id === primaryId}
                          disabled={busy}
                          onChange={() => choosePrimary(entry, index)}
                        />
                        <span className="folder-path">{entry.path}</span>
                      </label>
                      {entry.id === primaryId && <span className="badge">principal</span>}
                      {!available && <span className="badge badge-warn">indisponível</span>}
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remover pasta ${entry.path}`}
                        title={entries.length === 1 ? 'Um workspace precisa de ao menos uma pasta' : 'Tirar do workspace'}
                        disabled={busy || entries.length === 1}
                        onClick={() => removeFolder(entry, index)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div>
              <button type="button" onClick={() => void addFolders()} disabled={busy}>
                Adicionar pastas…
              </button>
            </div>
          </fieldset>
          {editing && hasLiveSession && (
            <p className="meta" role="status">
              Vale para terminais novos; os que já estão abertos continuam como estão.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            {editing ? (
              <button type="button" className="primary" onClick={onClose}>
                Fechar
              </button>
            ) : (
              <>
                <button type="button" onClick={onClose}>
                  Cancelar
                </button>
                <button type="submit" className="primary" disabled={!canCreate}>
                  Criar workspace
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
