import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMITS, type Group, type Prompt, type PromptScope } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { braces, extractVariables } from '../../prompts/variables';

export interface PromptLibraryProps {
  /** Workspace da sessão em foco: seus prompts aparecem junto com os globais. */
  groupId: string | null;
  groups: readonly Group[];
  /** Usar um prompt (ou `null` para enviar um texto avulso). */
  onUse: (prompt: Prompt | null) => void;
  onClose: () => void;
}

interface Draft {
  id?: string;
  name: string;
  body: string;
  /** `global` ou o id do workspace. */
  scope: string;
}

function scopeValue(scope: PromptScope): string {
  return scope === 'global' ? 'global' : scope.groupId;
}

/** Biblioteca de prompts: lista com busca, criar, editar, duplicar, excluir e usar. */
export function PromptLibrary({ groupId, groups, onUse, onClose }: PromptLibraryProps) {
  const api = useApi();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPrompts(await unwrap(api.prompts.list(groupId ?? undefined)));
      setLoaded(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, groupId]);

  useEffect(() => {
    void load();
    return api.prompts.onChange(() => void load());
  }, [api, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groupName = useCallback(
    (scope: PromptScope) =>
      scope === 'global' ? 'global' : (groups.find((g) => g.id === scope.groupId)?.name ?? 'workspace'),
    [groups],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return prompts;
    return prompts.filter((p) => p.name.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
  }, [prompts, query]);

  /** Executa uma ação mostrando o erro do principal sem fechar nada. */
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

  const save = () => {
    if (!draft) return;
    void attempt(async () => {
      const scope: PromptScope = draft.scope === 'global' ? 'global' : { groupId: draft.scope };
      await unwrap(
        api.prompts.save({
          ...(draft.id !== undefined ? { id: draft.id } : {}),
          name: draft.name,
          body: draft.body,
          scope,
        }),
      );
      setDraft(null);
      await load();
    });
  };

  const duplicate = (p: Prompt) =>
    void attempt(async () => {
      await unwrap(api.prompts.duplicate(p.id));
      await load();
    });

  const remove = (p: Prompt) =>
    void attempt(async () => {
      await unwrap(api.prompts.remove(p.id));
      setDeleting(null);
      await load();
    });

  const draftVariables = draft ? extractVariables(draft.body) : [];
  const canSave = draft !== null && draft.name.trim() !== '' && draft.body !== '' && !busy;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal prompt-library" role="dialog" aria-modal="true" aria-label="Biblioteca de prompts">
        <h2>Biblioteca de prompts</h2>
        {draft ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save();
            }}
          >
            <label>
              Nome
              <input
                value={draft.name}
                maxLength={LIMITS.promptName}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Escopo
              <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
                <option value="global">Global (todos os workspaces)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    Workspace {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Texto
              <textarea
                rows={10}
                value={draft.body}
                maxLength={LIMITS.prompt}
                placeholder="Use {{variavel}} para pedir um valor no uso. Automáticas: {{pasta}}, {{workspace}} e {{data}}."
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            {draftVariables.length > 0 && (
              <p className="meta">{`Variáveis: ${draftVariables.map(braces).join(', ')}`}</p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => setDraft(null)} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={!canSave}>
                Salvar
              </button>
            </div>
          </form>
        ) : (
          <div className="confirm">
            <div className="prompt-toolbar">
              <input
                type="search"
                className="grow"
                aria-label="Buscar prompts"
                placeholder="Buscar por nome ou texto"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setError(null);
                  setDraft({ name: '', body: '', scope: 'global' });
                }}
              >
                Novo prompt
              </button>
              <button type="button" onClick={() => onUse(null)}>
                Enviar texto avulso
              </button>
            </div>
            {loaded && prompts.length === 0 ? (
              <p className="meta">Nenhum prompt ainda. Crie o primeiro com “Novo prompt”.</p>
            ) : loaded && visible.length === 0 ? (
              <p className="meta">Nenhum prompt encontrado.</p>
            ) : (
              <ul className="prompt-list">
                {visible.map((p) => (
                  <li key={p.id}>
                    <div className="prompt-head">
                      <span className="prompt-name">{p.name}</span>
                      <span className="badge">{groupName(p.scope)}</span>
                      {p.variables.length > 0 && (
                        <span className="meta prompt-vars">{p.variables.map(braces).join(' ')}</span>
                      )}
                    </div>
                    <p className="prompt-body">{p.body}</p>
                    {deleting === p.id ? (
                      <div className="prompt-confirm" role="group">
                        <span>{`Excluir o prompt "${p.name}"?`}</span>
                        <button type="button" onClick={() => setDeleting(null)} disabled={busy}>
                          Não excluir
                        </button>
                        <button type="button" className="danger" onClick={() => remove(p)} disabled={busy}>
                          Excluir prompt
                        </button>
                      </div>
                    ) : (
                      <div className="prompt-actions">
                        <button type="button" className="primary" onClick={() => onUse(p)}>
                          Usar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setDraft({ id: p.id, name: p.name, body: p.body, scope: scopeValue(p.scope) });
                          }}
                        >
                          Editar
                        </button>
                        <button type="button" onClick={() => duplicate(p)} disabled={busy}>
                          Duplicar
                        </button>
                        <button type="button" onClick={() => setDeleting(p.id)} disabled={busy}>
                          Excluir
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
