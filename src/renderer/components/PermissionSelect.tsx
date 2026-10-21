import type { AgentDefinition, Execution } from '../../shared/ipc-contract';
import { isSwitchable, useSwitchFlow } from './ModelSelect';

export interface PermissionSelectProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
}

/** Seletor de modo de permissão do painel; modos perigosos exigem confirmação explícita. */
export function PermissionSelect({ execution, agent }: PermissionSelectProps) {
  const flow = useSwitchFlow(execution, 'permission');
  const spec = agent?.permission;
  if (!spec) return null;
  const labelOf = (v: string) => spec.options.find((o) => o.id === v)?.label ?? v;
  const pending = execution.pendingSwitch?.kind === 'permission' ? execution.pendingSwitch.value : null;
  return (
    <span className="switch-select">
      <select
        aria-label="Modo de permissão"
        value={execution.permissionMode ?? spec.default}
        disabled={!isSwitchable(execution) || flow.busy}
        onChange={(e) => flow.start(e.target.value, labelOf(e.target.value))}
      >
        {spec.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.dangerous ? `⚠ ${o.label}` : o.label}
          </option>
        ))}
      </select>
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
