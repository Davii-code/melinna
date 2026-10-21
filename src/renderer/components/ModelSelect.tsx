import { useState, type ReactElement } from 'react';
import type { AgentDefinition, Execution, SwitchKind, SwitchPlan } from '../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../api';
import { ConfirmDialog } from './ConfirmDialog';

export const CUSTOM_VALUE = '__custom__';
const CUSTOM_MODEL_RE = /^[A-Za-z0-9._:/@-]{1,100}$/;

interface Pending {
  plan: SwitchPlan;
  label: string;
}

function needsConfirmation(plan: SwitchPlan): boolean {
  return plan.kind !== 'pty-command' || plan.dangerous;
}

/** Texto e botão da confirmação de uma troca, conforme a estratégia e o risco. */
function confirmation(kind: SwitchKind, plan: SwitchPlan, label: string) {
  const what = kind === 'model' ? 'o modelo' : 'o modo de permissão';
  const parts: string[] = [];
  let confirmLabel = 'Trocar';
  if (plan.kind === 'restart-resume') {
    parts.push(`Para trocar ${what} para ${label}, o agente vai encerrar e relançar retomando a conversa.`);
    confirmLabel = 'Relançar';
  } else if (plan.kind === 'restart-fresh') {
    parts.push(
      `Este agente não troca ${what} em andamento: a conversa atual será perdida. O histórico do terminal fica acima de um separador.`,
    );
    confirmLabel = kind === 'model' ? 'Relançar com o novo modelo' : 'Relançar com o novo modo';
  }
  if (plan.kind !== 'pty-command' && plan.interruptsResponse) {
    parts.push('A resposta em andamento será interrompida.');
  }
  if (plan.dangerous) {
    parts.push(
      `${label} desliga as confirmações do agente: ele poderá executar comandos sem perguntar. O worktree isola apenas os arquivos do repositório, não a máquina.`,
    );
    if (plan.kind === 'pty-command') confirmLabel = 'Desligar confirmações';
  }
  return { parts, confirmLabel };
}

export interface SwitchFlow {
  error: string | null;
  busy: boolean;
  dialog: ReactElement | null;
  start: (value: string, label: string) => void;
  cancelPending: () => void;
}

/** Fluxo comum dos seletores: pede o plano, confirma quando preciso e aplica. */
export function useSwitchFlow(execution: Execution, kind: SwitchKind): SwitchFlow {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const apply = async (plan: SwitchPlan) => {
    setBusy(true);
    try {
      await unwrap(api.executions.confirmSwitch(execution.id, plan.planId));
      setPending(null);
    } catch (err) {
      setError(errorMessage(err));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const start = (value: string, label: string) => {
    setError(null);
    setBusy(true);
    unwrap(api.executions.requestSwitch(execution.id, kind, value)).then(
      (plan) => {
        setBusy(false);
        if (needsConfirmation(plan)) setPending({ plan, label });
        else void apply(plan);
      },
      (err: unknown) => {
        setBusy(false);
        setError(errorMessage(err));
      },
    );
  };

  const cancelPending = () => {
    void unwrap(api.executions.cancelPendingSwitch(execution.id)).catch((err: unknown) =>
      setError(errorMessage(err)),
    );
  };

  let dialog: ReactElement | null = null;
  if (pending) {
    const { parts, confirmLabel } = confirmation(kind, pending.plan, pending.label);
    dialog = (
      <ConfirmDialog
        title={kind === 'model' ? 'Trocar o modelo' : 'Trocar o modo de permissão'}
        confirmLabel={confirmLabel}
        danger={pending.plan.dangerous || pending.plan.kind === 'restart-fresh'}
        busy={busy}
        onConfirm={() => void apply(pending.plan)}
        onCancel={() => setPending(null)}
      >
        {parts.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </ConfirmDialog>
    );
  }
  return { error, busy, dialog, start, cancelPending };
}

export function isSwitchable(execution: Execution): boolean {
  return execution.status === 'running' || execution.status === 'idle';
}

export interface ModelSelectProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
}

/** Seletor de modelo do painel: troca conforme a estratégia do catálogo. */
export function ModelSelect({ execution, agent }: ModelSelectProps) {
  const flow = useSwitchFlow(execution, 'model');
  const [custom, setCustom] = useState<string | null>(null);
  const spec = agent?.model;
  if (!spec) return null;
  const known = spec.options.some((o) => o.id === execution.model);
  const current = custom !== null ? CUSTOM_VALUE : (execution.model ?? spec.default);
  const labelOf = (v: string) => spec.options.find((o) => o.id === v)?.label ?? v;
  const pending = execution.pendingSwitch?.kind === 'model' ? execution.pendingSwitch.value : null;
  const disabled = !isSwitchable(execution) || flow.busy;
  return (
    <span className="switch-select">
      <select
        aria-label="Modelo"
        value={current}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM_VALUE) {
            setCustom('');
            return;
          }
          setCustom(null);
          flow.start(v, labelOf(v));
        }}
      >
        {spec.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
        {!known && execution.model && <option value={execution.model}>{execution.model}</option>}
        {spec.allowCustom && <option value={CUSTOM_VALUE}>Personalizado…</option>}
      </select>
      {custom !== null && (
        <>
          <input
            aria-label="Modelo personalizado"
            value={custom}
            maxLength={100}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button
            type="button"
            disabled={!CUSTOM_MODEL_RE.test(custom.trim()) || disabled}
            onClick={() => {
              const v = custom.trim();
              setCustom(null);
              flow.start(v, v);
            }}
          >
            Aplicar
          </button>
        </>
      )}
      {pending && (
        <span className="switch-pending" role="status">
          trocar para {labelOf(pending)} ao ficar ocioso
          <button type="button" className="link" onClick={flow.cancelPending}>
            Cancelar troca
          </button>
        </span>
      )}
      {flow.error && (
        <span className="error switch-error" role="alert">
          {flow.error}
        </span>
      )}
      {flow.dialog}
    </span>
  );
}
