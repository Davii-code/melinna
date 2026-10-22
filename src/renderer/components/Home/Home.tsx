import { useMemo, useState } from 'react';
import avatar from '../../../../docs/brand/avatar.jpg?url';
import backgroundVideo from '../../../../docs/brand/background.mp4?url';
import type {
  AgentDefinition,
  AgentPick,
  DetectResult,
  Group,
  LaunchResult,
  TermSize,
  WorkspaceSnapshot,
} from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { BANDS, bandColor } from '../../theme/bands';
import { ConfirmDialog } from '../ConfirmDialog';
import { PixelBackdrop } from './PixelBackdrop';

export function greeting(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Workspaces (grupos com pasta), do aberto mais recentemente para o mais antigo. */
export function workspacesOf(groups: readonly Group[]): Group[] {
  return groups
    .filter((g) => g.repoPath)
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? '') || a.order - b.order);
}

/** Agente padrão da tela inicial: o primeiro agente instalado; sem agente, o primeiro shell. */
export function defaultAgent(agents: readonly AgentDefinition[], detect: Record<string, DetectResult>) {
  const installed = agents.filter((a) => detect[a.id]?.installed);
  return installed.find((a) => a.kind === 'agent') ?? installed[0];
}

/** Escolha de um agente com o modelo e o modo padrão do catálogo. */
export function defaultPick(agent: AgentDefinition): AgentPick {
  const p: AgentPick = { agentId: agent.id };
  if (agent.model) p.model = agent.model.default;
  if (agent.permission) p.permission = agent.permission.default;
  return p;
}

export interface HomeProps {
  snapshot: WorkspaceSnapshot;
  agents: AgentDefinition[];
  detect: Record<string, DetectResult>;
  size: TermSize;
  onLaunched: (taskId: string, results: LaunchResult[]) => void;
  /** Pede a confirmação para tirar o workspace da lista (a pasta não é apagada). */
  onRemoveWorkspace: (group: Group) => void;
  now?: Date;
}

/**
 * Tela inicial: saudação, "Novo terminal" (escolhe a pasta e abre o agente padrão nela), "Abrir workspace"
 * e os workspaces recentes (um clique abre um terminal na pasta). Ao fundo, o vídeo da marca pixelado.
 */
export function Home({
  snapshot,
  agents,
  detect,
  size,
  onLaunched,
  onRemoveWorkspace,
  now = new Date(),
}: HomeProps) {
  const api = useApi();
  const agent = useMemo(() => defaultAgent(agents, detect), [agents, detect]);
  const workspaces = useMemo(() => workspacesOf(snapshot.groups), [snapshot.groups]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dangerous, setDangerous] = useState<Group | null>(null);

  const execCount = (w: Group) =>
    snapshot.executions.filter((e) => snapshot.tasks.some((t) => t.id === e.taskId && t.groupId === w.id))
      .length;

  const pick = (): AgentPick | null => (agent ? defaultPick(agent) : null);

  const launch = async (target: Group) => {
    const p = pick();
    if (!p || !target.repoPath) return;
    setBusy(true);
    setError(null);
    setDangerous(null);
    try {
      const r = await unwrap(
        api.tasks.createAndLaunch({
          groupId: target.id,
          repoPath: target.repoPath,
          baseRef: 'HEAD',
          prompt: '',
          picks: [p],
          size,
        }),
      );
      onLaunched(r.taskId, r.results);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** Abre um terminal na pasta: com o modo padrão do agente marcado como perigoso, confirma antes. */
  const openTerminal = async (target: Group) => {
    if (!agent) {
      setError('Nenhum agente instalado. Veja o catálogo para instalar um.');
      return;
    }
    const mode = agent.permission?.options.find((o) => o.id === agent.permission?.default);
    if (mode?.dangerous) {
      setDangerous(target);
      return;
    }
    await launch(target);
  };

  const pickFolder = async (): Promise<Group | null> => {
    const path = await unwrap(api.workspace.pickRepository(workspaces[0]?.repoPath));
    if (!path) return null;
    return unwrap(api.workspace.openWorkspace(path));
  };

  const newTerminal = async () => {
    setError(null);
    try {
      const target = await pickFolder();
      if (target) await openTerminal(target);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const openWorkspace = async () => {
    setError(null);
    try {
      await pickFolder();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="home">
      <PixelBackdrop src={backgroundVideo} />
      <div className="home-spectrum" aria-hidden="true">
        {BANDS.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <img className="home-avatar" src={avatar} alt="Melinna" width={96} height={96} />
      <h1 className="home-greeting">{greeting(now)}</h1>
      <p className="home-date">
        {now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })} ·{' '}
        {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </p>

      <div className="home-actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !agent}
          onClick={() => void newTerminal()}
        >
          ▸ Novo terminal
        </button>
        <button type="button" disabled={busy} onClick={() => void openWorkspace()}>
          ＋ Abrir workspace
        </button>
      </div>
      {agent ? (
        <p className="meta">
          Abre {agent.displayName} na pasta escolhida. Para outro agente ou um enunciado, use "Nova tarefa".
        </p>
      ) : (
        <p className="meta">Nenhum agente instalado. Veja o catálogo para instalar um.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {workspaces.length > 0 && (
        <section className="home-recent">
          <h2>Workspaces recentes</h2>
          <ul aria-label="Workspaces recentes">
            {workspaces.slice(0, 6).map((w) => (
              <li key={w.id} className="home-card-item">
                <button
                  type="button"
                  className="home-card"
                  title={`Abrir um terminal em ${w.repoPath}`}
                  disabled={busy || !agent}
                  onClick={() => void openTerminal(w)}
                >
                  <span className="home-card-band" style={{ background: bandColor(w.colorIndex ?? 0) }} />
                  <span className="home-card-name">{w.name}</span>
                  <span className="home-card-path">{w.repoPath}</span>
                  <span className="meta">
                    {execCount(w)} {execCount(w) === 1 ? 'execução' : 'execuções'}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button home-card-remove"
                  aria-label={`Remover ${w.name} dos recentes`}
                  title="Tirar da lista (a pasta não é apagada)"
                  onClick={() => onRemoveWorkspace(w)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dangerous && agent && (
        <ConfirmDialog
          title="Modo sem confirmações"
          confirmLabel="Lançar sem confirmações"
          danger
          busy={busy}
          onCancel={() => setDangerous(null)}
          onConfirm={() => void launch(dangerous)}
        >
          <p>
            O modo padrão de {agent.displayName} executa comandos sem perguntar, direto na pasta{' '}
            <code>{dangerous.repoPath}</code> e na máquina.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
