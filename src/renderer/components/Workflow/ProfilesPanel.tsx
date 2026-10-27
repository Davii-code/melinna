import { useState } from 'react';
import type { AgentDefinition, Group } from '../../../shared/ipc-contract';
import type { UsageProfile, WorkflowApi, WorkflowSnapshot } from '../../../shared/workflow-api';
import { AgentFields } from './AgentFields';
import { unwrap } from '../../api';
interface Props {
  api: WorkflowApi;
  data: WorkflowSnapshot;
  groups: readonly Group[];
  agents: readonly AgentDefinition[];
  action(fn: () => Promise<unknown>): void;
  busy: boolean;
}
export function ProfilesPanel({ api, data, groups, agents, action, busy }: Props) {
  const first = agents.find((a) => a.kind === 'agent');
  const make = (name = 'Novo perfil', instructions = ''): UsageProfile => ({
    id: '',
    name,
    groupId: null,
    agentId: first?.id ?? '',
    model: null,
    permission: null,
    instructions,
    checkpointBeforeLaunch: true,
  });
  const [draft, setDraft] = useState<UsageProfile>(() => make());
  const [deleting, setDeleting] = useState(false);
  const presets = [
    {
      name: 'Revisar código',
      text: 'Revise o código em somente leitura. Relate problemas concretos com arquivo, evidência e impacto. Não altere arquivos nem faça commits ou pushes.',
      read: true,
    },
    {
      name: 'Implementar',
      text: 'Implemente o objetivo com mudanças pequenas e consistentes com o projeto. Preserve alterações locais anteriores. Ao concluir, informe arquivos alterados, decisões, pendências e verificações realmente executadas. Não faça commits ou pushes sem solicitação.',
      read: false,
    },
    {
      name: 'Investigar erro',
      text: 'Investigue a causa do erro. Diferencie evidências de hipóteses. Comece em somente leitura e proponha uma correção mínima. Informe o que precisa ser validado antes de editar.',
      read: true,
    },
  ];
  return (
    <div className="workflow-profile-layout">
      <aside>
        <button
          type="button"
          onClick={() => {
            setDraft(make());
            setDeleting(false);
          }}
        >
          + Novo perfil
        </button>
        <h3>Perfis salvos</h3>
        {data.profiles.map((profile) => (
          <button
            type="button"
            key={profile.id}
            aria-pressed={draft.id === profile.id}
            className="workflow-profile-item"
            onClick={() => {
              setDraft(structuredClone(profile));
              setDeleting(false);
            }}
          >
            <strong>{profile.name}</strong>
            <span>
              {profile.agentId} · {profile.groupId ? 'Workspace' : 'Global'}
            </span>
          </button>
        ))}
        <h3>Começar com um exemplo</h3>
        {presets.map((preset) => (
          <button
            type="button"
            key={preset.name}
            className="workflow-profile-item"
            onClick={() =>
              setDraft({
                ...make(preset.name, preset.text),
                permission: preset.read
                  ? (first?.permission?.options.find((p) => p.id === 'read-only' || p.id === 'plan')?.id ??
                    null)
                  : null,
              })
            }
          >
            {preset.name}
          </button>
        ))}
      </aside>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(async () => setDraft(await unwrap(api.saveProfile(draft))));
        }}
      >
        <h3>{draft.id ? 'Editar perfil' : 'Criar perfil'}</h3>
        <label>
          Nome do perfil
          <input
            aria-label="Nome do perfil"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={80}
            required
          />
        </label>
        <label>
          Disponível em
          <select
            aria-label="Escopo do perfil"
            value={draft.groupId ?? ''}
            onChange={(e) => setDraft({ ...draft, groupId: e.target.value || null })}
          >
            <option value="">Todos os workspaces</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <AgentFields
          agents={agents}
          value={{ agentId: draft.agentId, model: draft.model, permission: draft.permission }}
          onChange={(pick) =>
            setDraft({
              ...draft,
              agentId: pick.agentId,
              model: pick.model ?? null,
              permission: pick.permission ?? null,
            })
          }
          prefix="Perfil: "
        />
        <label>
          Instruções do perfil
          <textarea
            aria-label="Instruções do perfil"
            rows={9}
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            maxLength={20000}
          />
        </label>
        <label className="workflow-checkbox">
          <input
            type="checkbox"
            checked={draft.checkpointBeforeLaunch}
            onChange={(e) => setDraft({ ...draft, checkpointBeforeLaunch: e.target.checked })}
          />
          Criar checkpoint antes de iniciar
        </label>
        <p className="meta">
          As instruções são adicionadas ao objetivo ao iniciar uma nova tarefa. Modelos e permissões continuam
          sujeitos ao catálogo e às confirmações existentes.
        </p>
        <div className="actions">
          <button type="submit" className="primary" disabled={busy || !draft.agentId || !draft.name.trim()}>
            Salvar perfil
          </button>
          {draft.id && (
            <button type="button" className="danger" disabled={busy} onClick={() => setDeleting(true)}>
              Excluir perfil
            </button>
          )}
        </div>
        {deleting && (
          <div className="workflow-confirm-inline" role="alertdialog" aria-label="Excluir perfil">
            <p>Excluir este perfil? Tarefas já iniciadas serão preservadas.</p>
            <button type="button" onClick={() => setDeleting(false)}>
              Cancelar exclusão
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await unwrap(api.removeProfile(draft.id));
                  setDraft(make());
                  setDeleting(false);
                })
              }
            >
              Confirmar exclusão
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
