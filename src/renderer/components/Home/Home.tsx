import { useMemo, useState, type KeyboardEvent } from 'react';
import avatar from '../../../../docs/brand/avatar.jpg?url';
import type {
  AgentDefinition,
  AgentPick,
  DetectResult,
  Group,
  LaunchResult,
  TermSize,
  WorkspaceSnapshot,
} from '../../../shared/ipc-contract';
import { LIMITS } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { BANDS, bandColor } from '../../theme/bands';
import { ConfirmDialog } from '../ConfirmDialog';

const OPEN_FOLDER = '__open__';

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

type Step = { kind: 'idle' } | { kind: 'dangerous'; prompt: string; ws: Group };

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
 * Tela inicial: saudação com o avatar, barra rápida (enunciado opcional, agente, workspace e modo),
 * "Novo terminal" (escolhe a pasta e abre o agente sem enunciado), "Abrir workspace" e os workspaces
 * recentes. Tudo roda direto na pasta escolhida.
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
  const installed = useMemo(() => agents.filter((a) => detect[a.id]?.installed), [agents, detect]);
  const [agentId, setAgentId] = useState<string>(
    () => (installed.find((a) => a.kind === 'agent') ?? installed[0])?.id ?? '',
  );
  const [extraWs, setExtraWs] = useState<Group | null>(null);
  const workspaces = useMemo(() => {
    const list = workspacesOf(snapshot.groups);
    return extraWs && !list.some((w) => w.id === extraWs.id) ? [extraWs, ...list] : list;
  }, [snapshot.groups, extraWs]);
  const [wsId, setWsId] = useState<string>(() => workspacesOf(snapshot.groups)[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  const agent = installed.find((a) => a.id === agentId) ?? installed[0];
  const [permission, setPermission] = useState<string>(() => agent?.permission?.default ?? '');
  const ws = workspaces.find((w) => w.id === wsId) ?? null;
  const execCount = (w: Group) =>
    snapshot.executions.filter((e) => snapshot.tasks.some((t) => t.id === e.taskId && t.groupId === w.id))
      .length;

  const chooseAgent = (id: string) => {
    setAgentId(id);
    setPermission(installed.find((a) => a.id === id)?.permission?.default ?? '');
  };

  const openFolder = async (defaultPath?: string): Promise<Group | null> => {
    const path = await unwrap(api.workspace.pickRepository(defaultPath));
    if (!path) return null;
    const group = await unwrap(api.workspace.openWorkspace(path));
    setExtraWs(group);
    setWsId(group.id);
    return group;
  };

  const pick = (): AgentPick | null => {
    if (!agent) return null;
    const p: AgentPick = { agentId: agent.id };
    if (agent.model) p.model = agent.model.default;
    if (agent.permission) p.permission = permission || agent.permission.default;
    return p;
  };

  const launch = async (text: string, target: Group) => {
    const p = pick();
    if (!p || !target.repoPath) return;
    setBusy(true);
    setError(null);
    try {
      const r = await unwrap(
        api.tasks.createAndLaunch({
          groupId: target.id,
          repoPath: target.repoPath,
          baseRef: 'HEAD',
          prompt: text,
          picks: [p],
          size,
        }),
      );
      setPrompt('');
      setStep({ kind: 'idle' });
      onLaunched(r.taskId, r.results);
    } catch (err) {
      setError(errorMessage(err));
      setStep({ kind: 'idle' });
    } finally {
      setBusy(false);
    }
  };

  /** Lança na pasta do workspace selecionado; com `chooseFolder`, pergunta a pasta antes (abrindo no workspace atual). */
  const start = async (text: string, chooseFolder = false) => {
    setError(null);
    if (!agent) {
      setError('Nenhum agente instalado. Veja o catálogo para instalar um.');
      return;
    }
    try {
      const target = chooseFolder || !ws ? await openFolder(ws?.repoPath) : ws;
      if (!target) return;
      const dangerous = agent.permission?.options.find((o) => o.id === permission)?.dangerous;
      if (dangerous) {
        setStep({ kind: 'dangerous', prompt: text, ws: target });
        return;
      }
      await launch(text, target);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy) void start(prompt);
    }
  };

  const modeLabel = agent?.permission?.options.find((o) => o.id === permission)?.label ?? '';

  return (
    <div className="home">
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

      <section className="home-bar" aria-label="Barra rápida">
        <textarea
          aria-label="O que você quer construir?"
          placeholder="O que você quer construir? (opcional)"
          value={prompt}
          rows={2}
          maxLength={LIMITS.prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onPromptKey}
        />
        <div className="home-bar-controls">
          <label>
            <span className="sr-only">Agente</span>
            <select aria-label="Agente" value={agent?.id ?? ''} onChange={(e) => chooseAgent(e.target.value)}>
              {installed.length === 0 && <option value="">Nenhum agente instalado</option>}
              {installed.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Workspace</span>
            <select
              aria-label="Workspace"
              value={ws?.id ?? OPEN_FOLDER}
              onChange={(e) => {
                if (e.target.value === OPEN_FOLDER)
                  void openFolder().catch((err: unknown) => setError(errorMessage(err)));
                else setWsId(e.target.value);
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              <option value={OPEN_FOLDER}>Abrir pasta…</option>
            </select>
          </label>
          {agent?.permission && (
            <label>
              <span className="sr-only">Modo</span>
              <select aria-label="Modo" value={permission} onChange={(e) => setPermission(e.target.value)}>
                {agent.permission.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.dangerous ? `⚠ ${o.label}` : o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="primary"
            aria-label="Enviar"
            disabled={busy || !agent}
            onClick={() => void start(prompt)}
          >
            ➤
          </button>
        </div>
      </section>
      {!ws && <p className="meta">Abra uma pasta para começar: ela vira um workspace.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="home-actions">
        <button type="button" disabled={busy || !agent} onClick={() => void start('', true)}>
          ▸ Novo terminal
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void openFolder().catch((err: unknown) => setError(errorMessage(err)))}
        >
          ＋ Abrir workspace
        </button>
      </div>

      {workspaces.length > 0 && (
        <section className="home-recent">
          <h2>Workspaces recentes</h2>
          <ul aria-label="Workspaces recentes">
            {workspaces.slice(0, 6).map((w) => (
              <li key={w.id} className="home-card-item">
                <button
                  type="button"
                  className={`home-card${w.id === ws?.id ? ' selected' : ''}`}
                  onClick={() => setWsId(w.id)}
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

      {step.kind === 'dangerous' && (
        <ConfirmDialog
          title="Modo sem confirmações"
          confirmLabel="Lançar sem confirmações"
          danger
          busy={busy}
          onCancel={() => setStep({ kind: 'idle' })}
          onConfirm={() => void launch(step.prompt, step.ws)}
        >
          <p>
            {agent?.displayName}: {modeLabel}. O agente poderá executar comandos sem perguntar, direto na
            pasta <code>{step.ws.repoPath}</code> e na máquina.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
