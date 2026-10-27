import { useId } from 'react';
import type { AgentDefinition, AgentPick } from '../../../shared/ipc-contract';
export function AgentFields({
  agents,
  value,
  onChange,
  prefix = '',
}: {
  agents: readonly AgentDefinition[];
  value: AgentPick;
  onChange(value: AgentPick): void;
  prefix?: string;
}) {
  const id = useId();
  const agent = agents.find((a) => a.id === value.agentId);
  return (
    <div className="workflow-fields">
      <label>
        {prefix}Agente
        <select
          aria-label={prefix + 'Agente'}
          value={value.agentId}
          onChange={(e) => onChange({ agentId: e.target.value, model: null, permission: null })}
        >
          {agents
            .filter((a) => a.kind === 'agent')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
        </select>
      </label>
      {agent?.model && (
        <label>
          {prefix}Modelo
          <input
            aria-label={prefix + 'Modelo'}
            list={id}
            value={value.model ?? ''}
            maxLength={100}
            placeholder={'Padrão: ' + agent.model.default}
            onChange={(e) => onChange({ ...value, model: e.target.value || null })}
          />
          <datalist id={id}>
            {agent.model.options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </datalist>
        </label>
      )}
      {agent?.permission && (
        <label>
          {prefix}Permissão
          <select
            aria-label={prefix + 'Permissão'}
            value={value.permission ?? ''}
            onChange={(e) => onChange({ ...value, permission: e.target.value || null })}
          >
            <option value="">Padrão do agente</option>
            {agent.permission.options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.dangerous ? ' — acesso ampliado' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
