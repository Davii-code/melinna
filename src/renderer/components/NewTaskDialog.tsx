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

export interface NewTaskDialogProps {
  snapshot: WorkspaceSnapshot;
  agents: AgentDefinition[];
  detect: Record<string, DetectResult>;
  size: TermSize;
  onClose: () => void;
  onLaunched: (taskId: string, results: LaunchResult[]) => void;
}

type Step = { kind: 'form' } | { kind: 'confirm-dangerous'; mode: string };

/**
 * Nova tarefa: pasta, enunciado (opcional) e agente. Modelo, modo de permissão e título ficam em
 * "Avançado", já com os padrões do agente. A pasta vira (ou reaproveita) um workspace e o agente roda
 * direto nela.
 */
export function NewTaskDialog({ snapshot, agents, detect, size, onClose, onLaunched }: NewTaskDialogProps) {
  const api = useApi();
  const installed = useMemo(() => agents.filter((a) => detect[a.id]?.installed), [agents, detect]);
  const [folder, setFolder] = useState(
    () => workspacesOf(snapshot.groups)[0]?.repoPath ?? snapshot.tasks.at(-1)?.repoPath ?? '',
  );
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState(
    () => (installed.find((a) => a.kind === 'agent') ?? installed[0])?.id ?? '',
  );
  const agent = installed.find((a) => a.id === agentId);
  const [model, setModel] = useState(() => agent?.model?.default ?? '');
  const [customModel, setCustomModel] = useState('');
  const [permission, setPermission] = useState(() => agent?.permission?.default ?? '');
  const [title, setTitle] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const freeSlots = Math.max(0, snapshot.maxLive - snapshot.liveCount);
  const customInvalid =
    agent?.model !== undefined && model === CUSTOM_MODEL && !CUSTOM_MODEL_RE.test(customModel.trim());
  const canSubmit =
    !busy &&
    agent !== undefined &&
    freeSlots > 0 &&
    folder.trim().length > 0 &&
    prompt.length <= LIMITS.prompt &&
    !customInvalid;

  const chooseAgent = (id: string) => {
    const next = installed.find((a) => a.id === id);
    setAgentId(id);
    setModel(next?.model?.default ?? '');
    setCustomModel('');
    setPermission(next?.permission?.default ?? '');
  };

  const pick = (): AgentPick | null => {
    if (!agent) return null;
    const p: AgentPick = { agentId: agent.id };
    if (agent.model) p.model = model === CUSTOM_MODEL ? customModel.trim() : model;
    if (agent.permission) p.permission = permission;
    return p;
  };

  const chooseFolder = async () => {
    try {
      const p = await unwrap(api.workspace.pickRepository(folder.trim() || undefined));
      if (p) setFolder(p);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const launch = async () => {
    const p = pick();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      const ws = await unwrap(api.workspace.openWorkspace(folder.trim()));
      if (!ws.repoPath) throw new Error('O workspace aberto não tem pasta.');
      const input = { groupId: ws.id, repoPath: ws.repoPath, baseRef: 'HEAD', prompt, picks: [p], size };
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

  const submit = async () => {
    if (!canSubmit) return;
    const opt = agent?.permission?.options.find((o) => o.id === permission);
    if (opt?.dangerous && step.kind !== 'confirm-dangerous') {
      setStep({ kind: 'confirm-dangerous', mode: `${agent?.displayName}: ${opt.label}` });
      return;
    }
    await launch();
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
            <div className="row">
              <label className="grow">
                Pasta
                <input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="Qualquer pasta"
                />
              </label>
              <button type="button" onClick={() => void chooseFolder()}>
                Escolher…
              </button>
            </div>
            <label>
              Enunciado
              <textarea
                value={prompt}
                rows={5}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="O que o agente deve fazer (opcional: sem enunciado, o agente abre vazio)"
              />
            </label>
            <label>
              Agente
              <select value={agent?.id ?? ''} onChange={(e) => chooseAgent(e.target.value)}>
                {installed.length === 0 && <option value="">Nenhum agente instalado</option>}
                {installed.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
            {freeSlots === 0 && <p className="error">Não há vagas livres: pare uma execução antes.</p>}
            <details className="advanced">
              <summary>Avançado</summary>
              {agent?.model && (
                <label>
                  Modelo
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {agent.model.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                    {agent.model.allowCustom && <option value={CUSTOM_MODEL}>Personalizado…</option>}
                  </select>
                </label>
              )}
              {agent?.model && model === CUSTOM_MODEL && (
                <label>
                  Modelo personalizado
                  <input
                    value={customModel}
                    maxLength={100}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="nome do modelo"
                  />
                </label>
              )}
              {agent?.permission && (
                <label>
                  Modo de permissão
                  <select value={permission} onChange={(e) => setPermission(e.target.value)}>
                    {agent.permission.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.dangerous ? `⚠ ${o.label}` : o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Título (opcional)
                <input
                  value={title}
                  maxLength={LIMITS.taskTitle}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            </details>
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
            <p className="warning">
              Você escolheu um modo que desliga as confirmações do agente: {step.mode}.
            </p>
            <p>
              O agente poderá executar comandos sem perguntar, direto na pasta {folder.trim()} e na máquina.
            </p>
            <div className="actions">
              <button type="button" onClick={() => setStep({ kind: 'form' })}>
                Voltar
              </button>
              <button type="button" className="danger" onClick={() => void launch()} disabled={busy}>
                Lançar sem confirmações
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
