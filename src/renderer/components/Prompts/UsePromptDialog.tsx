import { useEffect, useMemo, useState } from 'react';
import {
  LIMITS,
  type AgentDefinition,
  type Execution,
  type SendResult,
  type SendStatus,
  type Task,
} from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { isLiveStatus } from '../../labels';
import { braces, extractVariables, isAutoVariable } from '../../prompts/variables';

export interface UsePromptDialogProps {
  /** Prompt a usar; `null` = texto avulso, digitado aqui mesmo. */
  prompt: { name: string; body: string } | null;
  /** Sessão em foco: o destino padrão. */
  targetExecId: string | null;
  executions: readonly Execution[];
  tasks: readonly Task[];
  agents: ReadonlyMap<string, AgentDefinition>;
  /** `notice` é a mensagem de sucesso para a interface mostrar depois de fechar. */
  onClose: (notice?: string) => void;
}

type Mode = 'focus' | 'many' | 'queue';

const NOT_SENT: Record<Exclude<SendStatus, 'sent'>, string> = {
  'not-running': 'Não enviado: sessão encerrada',
  'not-ready': 'Não enviado: sessão ainda iniciando',
  'not-found': 'Não enviado: sessão removida',
  failed: 'Não enviado: falha ao escrever no terminal',
};

function statusText(status: SendStatus): string {
  return status === 'sent' ? 'Enviado' : NOT_SENT[status];
}

/** Rótulo da sessão: agente e título. */
export function sessionLabel(
  exec: Execution,
  tasks: readonly Task[],
  agents: ReadonlyMap<string, AgentDefinition>,
): string {
  const agent = agents.get(exec.agentId)?.displayName ?? exec.agentId;
  const title = tasks.find((t) => t.id === exec.taskId)?.title;
  return title ? `${agent} · ${title}` : agent;
}

interface Risk {
  shell: boolean;
  unconfirmed: boolean;
}

/** Riscos de mandar texto a uma sessão: shell executa como comando; modo sem confirmações age sem perguntar. */
function riskOf(exec: Execution, agents: ReadonlyMap<string, AgentDefinition>): Risk {
  const agent = agents.get(exec.agentId);
  return {
    shell: agent?.kind === 'shell',
    unconfirmed:
      exec.permissionMode !== null &&
      agent?.permission?.options.find((o) => o.id === exec.permissionMode)?.dangerous === true,
  };
}

function riskNotes(risk: Risk): string[] {
  return [
    ...(risk.shell ? ['shell: o texto será executado como comando'] : []),
    ...(risk.unconfirmed ? ['modo sem confirmações'] : []),
  ];
}

/** Formulário de uso de um prompt: variáveis, destinos, confirmação, prévia e envio. */
export function UsePromptDialog({
  prompt,
  targetExecId,
  executions,
  tasks,
  agents,
  onClose,
}: UsePromptDialogProps) {
  const api = useApi();
  const [freeText, setFreeText] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [empty, setEmpty] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<Mode>('focus');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(targetExecId ? [targetExecId] : []));
  const [queueTarget, setQueueTarget] = useState<string | null>(targetExecId);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SendResult[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const body = prompt ? prompt.body : freeText;
  const variables = useMemo(() => extractVariables(body), [body]);
  const manual = variables.filter((v) => !isAutoVariable(v));
  const automatic = variables.filter(isAutoVariable);
  const execById = useMemo(() => new Map(executions.map((e) => [e.id, e])), [executions]);
  const live = useMemo(() => executions.filter((e) => isLiveStatus(e.status)), [executions]);
  const focused = targetExecId ? execById.get(targetExecId) : undefined;
  /** Sessões de destino, na ordem da lista. */
  const targets = useMemo(() => {
    if (mode === 'focus') return focused ? [focused] : [];
    if (mode === 'queue') {
      const chosen = live.find((e) => e.id === queueTarget) ?? live.find((e) => e.id === targetExecId) ?? live[0];
      return chosen ? [chosen] : [];
    }
    return live.filter((e) => picked.has(e.id));
  }, [mode, focused, live, picked, queueTarget, targetExecId]);
  const label = (exec: Execution) => sessionLabel(exec, tasks, agents);

  const filled = manual.every((v) => empty.has(v) || (values[v] ?? '') !== '');
  const canSend = targets.length > 0 && body !== '' && filled && !busy && results === null;
  const multi = targets.length > 1;

  const payload = () => ({
    body,
    values: Object.fromEntries(
      manual.filter((v) => !empty.has(v) && (values[v] ?? '') !== '').map((v) => [v, values[v]!] as const),
    ),
    allowEmpty: manual.filter((v) => empty.has(v)),
  });

  const showPreview = async () => {
    const first = targets[0];
    if (!first) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await unwrap(api.prompts.preview({ ...payload(), execId: first.id })));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      if (mode === 'queue' && targets[0]) {
        const items = await unwrap(api.prompts.queue.enqueue({ ...payload(), execId: targets[0].id }));
        // Fila vazia depois de enfileirar = a sessão estava ociosa e o texto foi enviado na hora.
        onClose(items.length === 0 ? 'Prompt enviado.' : `Prompt na fila (${items.length} na fila).`);
        return;
      }
      const sent = await unwrap(api.prompts.send({ ...payload(), execIds: targets.map((t) => t.id) }));
      if (!multi && sent.every((r) => r.status === 'sent')) onClose('Prompt enviado.');
      else setResults(sent);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const closeWithResults = () => {
    const sent = (results ?? []).filter((r) => r.status === 'sent').length;
    const total = results?.length ?? 0;
    if (sent === 0) return onClose('Nenhuma sessão recebeu o prompt.');
    onClose(sent === total ? `Prompt enviado para ${sent} sessões.` : `Prompt enviado para ${sent} de ${total} sessões.`);
  };

  const labelOfResult = (r: SendResult) => {
    const exec = execById.get(r.execId);
    return exec ? label(exec) : r.execId;
  };

  const togglePicked = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const onlyTarget = !multi ? targets[0] : undefined;
  const singleRisk = onlyTarget ? riskOf(onlyTarget, agents) : null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal use-prompt"
        role="dialog"
        aria-modal="true"
        aria-label={prompt ? `Usar prompt ${prompt.name}` : 'Enviar texto avulso'}
      >
        <h2>{prompt ? prompt.name : 'Enviar texto avulso'}</h2>
        {results !== null && multi ? (
          <div className="confirm">
            <section role="region" aria-label="Resultado do envio">
              <ul className="target-list">
                {results.map((r) => (
                  <li key={r.execId} className={r.status === 'sent' ? undefined : 'error'}>
                    {`${labelOfResult(r)}: ${statusText(r.status)}`}
                  </li>
                ))}
              </ul>
            </section>
            <div className="actions">
              <button type="button" className="primary" onClick={closeWithResults}>
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSend) return;
              if (multi) setConfirming(true);
              else void send();
            }}
          >
            {!prompt && (
              <label>
                Texto
                <textarea
                  rows={6}
                  value={freeText}
                  maxLength={LIMITS.prompt}
                  onChange={(e) => {
                    setFreeText(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
            )}
            {manual.map((name) => (
              <div className="var-row" key={name}>
                <label className="grow">
                  {name}
                  <input
                    value={values[name] ?? ''}
                    disabled={empty.has(name)}
                    maxLength={LIMITS.promptValue}
                    onChange={(e) => {
                      setValues({ ...values, [name]: e.target.value });
                      setPreview(null);
                    }}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    aria-label={`Deixar ${braces(name)} vazia`}
                    checked={empty.has(name)}
                    onChange={(e) => {
                      const next = new Set(empty);
                      if (e.target.checked) next.add(name);
                      else next.delete(name);
                      setEmpty(next);
                      setPreview(null);
                    }}
                  />
                  deixar vazia
                </label>
              </div>
            ))}
            {automatic.length > 0 && (
              <p className="meta">{`Preenchidas sozinhas: ${automatic.map(braces).join(', ')}`}</p>
            )}
            <div className="mode-row" role="radiogroup" aria-label="Destino">
              <label className="check">
                <input
                  type="radio"
                  name="prompt-mode"
                  checked={mode === 'focus'}
                  onChange={() => {
                    setMode('focus');
                    setPreview(null);
                  }}
                />
                Sessão em foco
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="prompt-mode"
                  checked={mode === 'many'}
                  onChange={() => {
                    setMode('many');
                    setPreview(null);
                  }}
                />
                Várias sessões
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="prompt-mode"
                  checked={mode === 'queue'}
                  onChange={() => {
                    setMode('queue');
                    setPreview(null);
                  }}
                />
                Enfileirar
              </label>
            </div>
            {mode === 'focus' ? (
              <p className="meta">
                {focused
                  ? `Destino: ${label(focused)}`
                  : 'Nenhuma sessão em foco: abra um terminal para receber o prompt.'}
              </p>
            ) : mode === 'queue' ? (
              <>
                <label>
                  Sessão da fila
                  <select
                    value={targets[0]?.id ?? ''}
                    onChange={(e) => {
                      setQueueTarget(e.target.value);
                      setPreview(null);
                    }}
                  >
                    {live.length === 0 && <option value="">Nenhuma sessão viva</option>}
                    {live.map((exec) => (
                      <option key={exec.id} value={exec.id}>
                        {label(exec)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="meta">
                  O prompt espera a sessão ficar ociosa e vai um por vez. Se ela já estiver ociosa e sem fila, é
                  enviado na hora.
                </p>
              </>
            ) : (
              <fieldset className="target-list">
                <legend>Sessões de destino</legend>
                {live.length === 0 && <p className="meta">Nenhuma sessão viva.</p>}
                {live.map((exec) => {
                  const notes = riskNotes(riskOf(exec, agents));
                  return (
                    <label className="check" key={exec.id}>
                      <input
                        type="checkbox"
                        aria-label={label(exec)}
                        checked={picked.has(exec.id)}
                        onChange={(e) => togglePicked(exec.id, e.target.checked)}
                      />
                      <span>{label(exec)}</span>
                      {notes.length > 0 && <span className="target-warn">{notes.join('; ')}</span>}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {singleRisk?.shell && (
              <p className="warning" role="status">
                Esta sessão é um shell: o texto será executado como comando.
              </p>
            )}
            {singleRisk?.unconfirmed && (
              <p className="warning" role="status">
                Esta sessão está no modo sem confirmações: o agente age sem perguntar.
              </p>
            )}
            {preview !== null && (
              <pre className="prompt-preview" aria-label="Prévia do texto">
                {preview}
              </pre>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {!multi &&
              (results ?? [])
                .filter((r) => r.status !== 'sent')
                .map((r) => (
                  <p className="error" role="alert" key={r.execId}>
                    {`${labelOfResult(r)}: ${statusText(r.status)}`}
                  </p>
                ))}
            <div className="actions">
              <button type="button" onClick={() => onClose()}>
                Cancelar
              </button>
              <button type="button" onClick={() => void showPreview()} disabled={!canSend}>
                Prévia
              </button>
              <button type="submit" className="primary" disabled={!canSend}>
                {mode === 'queue' ? 'Enfileirar' : 'Enviar'}
              </button>
            </div>
          </form>
        )}
      </div>
      {confirming && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal use-prompt"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Enviar para ${targets.length} sessões?`}
          >
            <h2>{`Enviar para ${targets.length} sessões?`}</h2>
            <div className="confirm">
              <ul className="target-list">
                {targets.map((exec) => {
                  const notes = riskNotes(riskOf(exec, agents));
                  return (
                    <li key={exec.id}>
                      {label(exec)}
                      {notes.length > 0 && <span className="target-warn">{` — ${notes.join('; ')}`}</span>}
                    </li>
                  );
                })}
              </ul>
              <div className="actions">
                <button type="button" onClick={() => setConfirming(false)}>
                  Voltar
                </button>
                <button type="button" className="primary" onClick={() => void send()}>
                  Confirmar envio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
