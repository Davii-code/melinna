import { useMemo, useState } from 'react';
import type {
  AgentDefinition,
  AgentPick,
  DetectResult,
  LaunchResult,
  TermSize,
  WorkspaceSnapshot,
} from '../../shared/ipc-contract';
import { LIMITS } from '../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../api';
import { workspacesOf } from './Home/Home';

export const CUSTOM_MODEL = '__custom__';
const CUSTOM_MODEL_RE = /^[A-Za-z0-9._:/@-]{1,100}$/;
const NEW_GROUP = '__new__';

interface Selection {
  checked: boolean;
  model: string;
  customModel: string;
  permission: string;
}

export interface NewTaskDialogProps {
  snapshot: WorkspaceSnapshot;
  agents: AgentDefinition[];
  detect: Record<string, DetectResult>;
  size: TermSize;
  onClose: () => void;
  onLaunched: (taskId: string, results: LaunchResult[]) => void;
}

type Step =
  { kind: 'form' } | { kind: 'confirm-dangerous'; modes: string[] } | { kind: 'uncommitted'; count: number };

function initialSelection(a: AgentDefinition): Selection {
  return {
    checked: false,
    model: a.model?.default ?? '',
    customModel: '',
    permission: a.permission?.default ?? '',
  };
}

export function NewTaskDialog({ snapshot, agents, detect, size, onClose, onLaunched }: NewTaskDialogProps) {
  const api = useApi();
  const initialGroup = workspacesOf(snapshot.groups)[0] ?? snapshot.groups[0];
  const [groupId, setGroupId] = useState(initialGroup?.id ?? NEW_GROUP);
  const [groupName, setGroupName] = useState('');
  const [repoPath, setRepoPath] = useState(initialGroup?.repoPath ?? snapshot.tasks.at(-1)?.repoPath ?? '');
  const [baseRef, setBaseRef] = useState('HEAD');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sel, setSel] = useState<Record<string, Selection>>(() =>
    Object.fromEntries(agents.map((a) => [a.id, initialSelection(a)])),
  );
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const freeSlots = Math.max(0, snapshot.maxLive - snapshot.liveCount);
  const checkedIds = agents.filter((a) => sel[a.id]?.checked).map((a) => a.id);
  const full = checkedIds.length >= freeSlots;

  const picks: AgentPick[] = useMemo(
    () =>
      agents
        .filter((a) => sel[a.id]?.checked)
        .map((a) => {
          const s = sel[a.id] as Selection;
          const pick: AgentPick = { agentId: a.id };
          if (a.model) pick.model = s.model === CUSTOM_MODEL ? s.customModel.trim() : s.model;
          if (a.permission) pick.permission = s.permission;
          return pick;
        }),
    [agents, sel],
  );

  const customInvalid = agents.some(
    (a) =>
      sel[a.id]?.checked &&
      sel[a.id]?.model === CUSTOM_MODEL &&
      !CUSTOM_MODEL_RE.test((sel[a.id]?.customModel ?? '').trim()),
  );
  const canSubmit =
    !busy &&
    prompt.length <= LIMITS.prompt &&
    picks.length > 0 &&
    picks.length <= freeSlots &&
    repoPath.trim().length > 0 &&
    baseRef.trim().length > 0 &&
    (groupId !== NEW_GROUP || groupName.trim().length > 0) &&
    !customInvalid;

  const update = (id: string, patch: Partial<Selection>) =>
    setSel((s) => ({ ...s, [id]: { ...(s[id] as Selection), ...patch } }));

  const dangerousModes = () =>
    agents
      .filter((a) => sel[a.id]?.checked)
      .flatMap((a) => {
        const opt = a.permission?.options.find((o) => o.id === sel[a.id]?.permission);
        return opt?.dangerous ? [`${a.displayName}: ${opt.label}`] : [];
      });

  const pickRepo = async () => {
    try {
      const p = await unwrap(api.workspace.pickRepository());
      if (p) setRepoPath(p);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      let gid = groupId;
      if (gid === NEW_GROUP) gid = (await unwrap(api.workspace.createGroup(groupName.trim()))).id;
      const input = { groupId: gid, repoPath: repoPath.trim(), baseRef: baseRef.trim(), prompt, picks, size };
      const result = await unwrap(
        api.tasks.createAndLaunch(title.trim() ? { ...input, title: title.trim() } : input),
      );
      onLaunched(result.taskId, result.results);
    } catch (err) {
      setError(errorMessage(err));
      setStep({ kind: 'form' });
    } finally {
      setBusy(false);
    }
  };

  const checkRepoThenLaunch = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await unwrap(api.workspace.inspectRepo(repoPath.trim(), baseRef.trim()));
      setBusy(false);
      if (info.uncommittedCount > 0) {
        setStep({ kind: 'uncommitted', count: info.uncommittedCount });
        return;
      }
      await launch();
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    const modes = dangerousModes();
    if (modes.length > 0 && step.kind !== 'confirm-dangerous') {
      setStep({ kind: 'confirm-dangerous', modes });
      return;
    }
    await checkRepoThenLaunch();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal new-task" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <h2 id="new-task-title">Nova tarefa</h2>
        {step.kind === 'form' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              Grupo
              <select
                value={groupId}
                onChange={(e) => {
                  setGroupId(e.target.value);
                  const ws = snapshot.groups.find((g) => g.id === e.target.value);
                  if (ws?.repoPath) setRepoPath(ws.repoPath);
                }}
              >
                {snapshot.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value={NEW_GROUP}>Novo grupo…</option>
              </select>
            </label>
            {groupId === NEW_GROUP && (
              <label>
                Nome do novo grupo
                <input
                  value={groupName}
                  maxLength={LIMITS.groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </label>
            )}
            <div className="row">
              <label className="grow">
                Repositório
                <input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="Caminho de um repositório git"
                />
              </label>
              <button type="button" onClick={() => void pickRepo()}>
                Escolher…
              </button>
            </div>
            <div className="row">
              <label className="grow">
                Ponto de partida
                <input
                  value={baseRef}
                  maxLength={LIMITS.baseRef}
                  onChange={(e) => setBaseRef(e.target.value)}
                  placeholder="branch, tag ou commit"
                />
              </label>
              <label className="grow">
                Título (opcional)
                <input
                  value={title}
                  maxLength={LIMITS.taskTitle}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            </div>
            <label>
              Enunciado
              <textarea
                value={prompt}
                rows={6}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="O que os agentes devem fazer (opcional: sem enunciado, o agente abre vazio)"
              />
            </label>
            <fieldset className="agents">
              <legend>
                Agentes <span className="hint">{freeSlots} vaga(s) livre(s)</span>
              </legend>
              {agents.map((a) => {
                const d = detect[a.id];
                const installed = d?.installed ?? false;
                const s = sel[a.id] as Selection;
                return (
                  <div
                    key={a.id}
                    className={`agent-row${installed ? '' : ' disabled'}`}
                    data-testid={`agent-${a.id}`}
                  >
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={s.checked}
                        disabled={!installed || (!s.checked && full)}
                        onChange={(e) => update(a.id, { checked: e.target.checked })}
                      />
                      {a.displayName}
                    </label>
                    {!installed && (
                      <span className="not-found">
                        não encontrado — procurado: {d?.searched ?? a.executable.command}
                      </span>
                    )}
                    {installed && s.checked && a.model && (
                      <select
                        aria-label={`Modelo de ${a.displayName}`}
                        value={s.model}
                        onChange={(e) => update(a.id, { model: e.target.value })}
                      >
                        {a.model.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                        {a.model.allowCustom && <option value={CUSTOM_MODEL}>Personalizado…</option>}
                      </select>
                    )}
                    {installed && s.checked && s.model === CUSTOM_MODEL && (
                      <input
                        aria-label={`Modelo personalizado de ${a.displayName}`}
                        value={s.customModel}
                        maxLength={100}
                        onChange={(e) => update(a.id, { customModel: e.target.value })}
                        placeholder="nome do modelo"
                      />
                    )}
                    {installed && s.checked && a.permission && (
                      <select
                        aria-label={`Modo de permissão de ${a.displayName}`}
                        value={s.permission}
                        onChange={(e) => update(a.id, { permission: e.target.value })}
                      >
                        {a.permission.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.dangerous ? `⚠ ${o.label}` : o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </fieldset>
            {customInvalid && (
              <p className="error">
                Nome de modelo inválido: use letras, números e . _ : / @ - (até 100 caracteres).
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={!canSubmit}>
                Lançar
              </button>
            </div>
          </form>
        )}
        {step.kind === 'confirm-dangerous' && (
          <div className="confirm" role="alertdialog" aria-label="Modo sem confirmações">
            <p className="warning">Você escolheu modos que desligam as confirmações do agente:</p>
            <ul>
              {step.modes.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p>
              O agente poderá executar comandos sem perguntar. O worktree isola apenas os arquivos do
              repositório, não a máquina.
            </p>
            <div className="actions">
              <button type="button" onClick={() => setStep({ kind: 'form' })}>
                Voltar
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void checkRepoThenLaunch()}
                disabled={busy}
              >
                Lançar sem confirmações
              </button>
            </div>
          </div>
        )}
        {step.kind === 'uncommitted' && (
          <div className="confirm" role="alertdialog" aria-label="Alterações não commitadas">
            <p className="warning">
              O repositório tem {step.count} alterações não commitadas. Os worktrees partem de{' '}
              {baseRef.trim()} e não incluem essas alterações.
            </p>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" onClick={() => setStep({ kind: 'form' })}>
                Cancelar
              </button>
              <button type="button" className="primary" onClick={() => void launch()} disabled={busy}>
                Lançar mesmo assim
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
