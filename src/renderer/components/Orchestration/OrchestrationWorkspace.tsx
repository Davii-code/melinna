import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ACTIVE_JOBS,
  DEFAULT_TEAM,
  type AgentRole,
  type OrchestrationApi,
  type OrchestrationRun,
  type OrchestrationSnapshot,
  type TeamTemplate,
  type PreflightResult,
  type AgentEvent,
} from '../../../shared/orchestration-api';
import type { AgentDefinition, Group } from '../../../shared/ipc-contract';
import { errorMessage, unwrap } from '../../api';
import './orchestration.css';

const LABELS: Record<string, string> = {
  queued: 'Na fila',
  starting: 'Preparando',
  running: 'Executando',
  paused: 'Pausada',
  waiting_user: 'Revisão necessária',
  succeeded: 'Concluído',
  failed: 'Falha',
  cancelled: 'Cancelado',
  interrupted: 'Interrompido',
};
const clone = (team: TeamTemplate) => structuredClone(team);
interface Props {
  api: OrchestrationApi;
  open: boolean;
  onClose(): void;
  groups: readonly Group[];
  activeGroupId: string | null;
  agents: readonly AgentDefinition[];
}
function Status({ status }: { status: string }) {
  return <span className={'team-status team-status-' + status}>{LABELS[status] ?? status}</span>;
}
function EventConsole({ events }: { events: AgentEvent[] }) {
  const [follow, setFollow] = useState(true);
  const tail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) tail.current?.scrollIntoView({ block: 'nearest' });
  }, [events.at(-1)?.seq, follow]);
  return (
    <div className="team-console-wrap">
      <label className="team-checkbox">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        Acompanhar atividade
      </label>
      <div
        className="team-console"
        role="log"
        aria-label="Console de eventos da sessão"
        aria-live="off"
        tabIndex={0}
      >
        {events.length === 0 && <p className="meta">A atividade aparecerá aqui quando a sessão iniciar.</p>}
        {events.map((event) => (
          <div key={event.seq} className={'team-event team-event-' + event.type}>
            <time>{new Date(event.at).toLocaleTimeString()}</time>
            <span>{event.text}</span>
          </div>
        ))}
        <div ref={tail} />
      </div>
    </div>
  );
}

export function OrchestrationWorkspace({ api, open, onClose, groups, activeGroupId, agents }: Props) {
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot>({
    schemaVersion: 1,
    templates: [],
    runs: [],
  });
  const [draft, setDraft] = useState<TeamTemplate>(() => clone(DEFAULT_TEAM));
  const [mode, setMode] = useState<'configure' | 'run'>('configure');
  const [roleId, setRoleId] = useState('coordinator');
  const [runId, setRunId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(activeGroupId ?? '');
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult[]>([]);
  const [patch, setPatch] = useState<{ jobId: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{
    label: string;
    message: string;
    action: () => Promise<unknown>;
  } | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [importSource, setImportSource] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        refreshAgain.current = false;
        const next = await unwrap(api.snapshot());
        if (alive.current) setSnapshot(next);
      } while (refreshAgain.current && alive.current);
    } catch (err) {
      if (alive.current) setError(errorMessage(err));
    } finally {
      refreshing.current = false;
    }
  }, [api]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const off = api.onChange(() => void refresh());
    return () => {
      alive.current = false;
      off();
    };
  }, [api, refresh]);
  useEffect(() => {
    if (activeGroupId) setWorkspaceId(activeGroupId);
  }, [activeGroupId]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, [open]);
  useEffect(() => {
    if (!open || (!confirm && !patch && imported === null)) return;
    const previous = document.activeElement as HTMLElement | null;
    const scope = root.current?.querySelector<HTMLElement>('.team-overlay:last-child > section');
    scope?.querySelector<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]')?.focus();
    return () => previous?.focus();
  }, [confirm, patch, imported === null, open]);
  const action = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error && !(err.name === 'UiError') ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const run = snapshot.runs.find((item) => item.id === runId) ?? null;
  const job = run?.jobs.find((item) => item.id === jobId) ?? null;
  const team = mode === 'run' && run ? run.team : draft;
  const role =
    team.coordinator.id === roleId
      ? team.coordinator
      : (team.workers.find((item) => item.id === roleId) ?? team.coordinator);
  const updateRole = (values: Partial<AgentRole>) => {
    setDraft((previous) =>
      previous.coordinator.id === role.id
        ? { ...previous, coordinator: { ...previous.coordinator, ...values, access: 'read-only' } }
        : {
            ...previous,
            workers: previous.workers.map((item) => (item.id === role.id ? { ...item, ...values } : item)),
          },
    );
    setPreflight([]);
  };
  const openRun = (item: OrchestrationRun) => {
    setRunId(item.id);
    setJobId(null);
    setMode('run');
    setPatch(null);
    setRoleId(item.team.coordinator.id);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The underlying IDE shortcuts must not receive keystrokes from the team workspace.
    event.stopPropagation();
    if (event.key === 'Escape') {
      if (confirm) setConfirm(null);
      else if (imported !== null) setImported(null);
      else if (patch) setPatch(null);
      else onClose();
      event.preventDefault();
    }
    if (event.key === 'Tab') {
      const scope =
        root.current?.querySelector<HTMLElement>('.team-overlay:last-child > section') ?? root.current;
      const controls = Array.from(
        scope?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  const save = async () => {
    const saved = await unwrap(api.saveTeam(draft));
    setDraft(saved);
    return saved;
  };
  const start = async () => {
    const saved = await save();
    const newId = await unwrap(api.start({ teamId: saved.id, groupId: workspaceId, prompt }));
    setRunId(newId);
    setJobId(null);
    setMode('run');
    setPatch(null);
    setPrompt('');
  };
  const chooseRole = (item: AgentRole) => {
    setRoleId(item.id);
    setJobId(null);
    setPatch(null);
  };
  const templateCard = (item: AgentRole, coordinator = false) => (
    <button
      type="button"
      key={item.id}
      className={
        'team-node' + (roleId === item.id ? ' selected' : '') + (coordinator ? ' team-coordinator' : '')
      }
      onClick={() => chooseRole(item)}
      aria-pressed={roleId === item.id}
    >
      <span className="team-node-provider">
        {item.provider === 'claude' ? '✳ Claude' : '◇ Codex'}
        {coordinator && <span>Coordenador</span>}
      </span>
      <strong>{item.name}</strong>
      <span className="meta">{item.model || 'Modelo padrão do CLI'}</span>
      <span className="team-node-detail">
        {item.access === 'read-only' ? 'Somente leitura' : 'Escrita em worktree'}
      </span>
    </button>
  );
  const activeRun = snapshot.runs.find((item) => ['running', 'paused', 'waiting_user'].includes(item.status));
  const isWorking = run?.status === 'running' || run?.status === 'paused';

  return (
    <div
      ref={root}
      className="team-workspace"
      data-shortcut-scope="orchestration"
      hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-workspace-title"
      onKeyDown={onKey}
    >
      <header className="team-header">
        <div>
          <span className="team-eyebrow">MELINNA / EQUIPES</span>
          <h1 id="team-workspace-title">Um objetivo. Uma equipe.</h1>
        </div>
        <span className="meta team-header-caption">Delegação visual entre Claude e Codex</span>
        <button type="button" ref={closeButton} onClick={onClose}>
          Voltar à IDE
        </button>
      </header>
      {(error || snapshot.warning) && (
        <div className="panel-banner error" role="alert">
          <span>{error || snapshot.warning}</span>
          <button type="button" onClick={() => setError(null)} disabled={!!snapshot.warning}>
            Dispensar
          </button>
        </div>
      )}
      <div className="team-layout">
        <nav className="team-library" aria-label="Equipes e execuções">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setDraft(clone(DEFAULT_TEAM));
              setMode('configure');
              setRoleId('coordinator');
              setPreflight([]);
            }}
          >
            + Nova equipe
          </button>
          <h2>Equipes salvas</h2>
          {!snapshot.templates.length && (
            <p className="meta">Configure os papéis e salve sua primeira equipe.</p>
          )}
          {snapshot.templates.map((item) => (
            <button
              type="button"
              key={item.id}
              className={
                'team-library-item' + (mode === 'configure' && draft.id === item.id ? ' selected' : '')
              }
              onClick={() => {
                setDraft(clone(item));
                setMode('configure');
                setRoleId(item.coordinator.id);
                setPreflight([]);
              }}
            >
              <strong>{item.name}</strong>
              <span>
                {item.workers.length} papéis · {item.coordinator.provider}
              </span>
            </button>
          ))}
          <h2>Execuções</h2>
          {snapshot.runs.map((item) => (
            <button
              type="button"
              key={item.id}
              className={'team-library-item' + (mode === 'run' && runId === item.id ? ' selected' : '')}
              onClick={() => openRun(item)}
            >
              <strong>{item.objective.slice(0, 65)}</strong>
              <span>{item.team.name}</span>
              <Status status={item.status} />
            </button>
          ))}
          {!snapshot.runs.length && <p className="meta">O histórico aparecerá aqui.</p>}
        </nav>
        <main className="team-main">
          <div className="team-main-toolbar">
            <h2>{team.name}</h2>
            {mode === 'configure' ? (
              <>
                <button type="button" disabled={busy} onClick={() => void action(save)}>
                  Salvar equipe
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      setPreflight(await unwrap(api.preflight(draft)));
                    })
                  }
                >
                  Verificar CLIs
                </button>
              </>
            ) : (
              run && (
                <>
                  <Status status={run.status} />
                  {run.status === 'running' && (
                    <button
                      type="button"
                      disabled={busy}
                      title="Pausa novos despachos; trabalhos em andamento continuam"
                      onClick={() => void action(() => unwrap(api.control(run.id, 'pause')))}
                    >
                      Pausar fila
                    </button>
                  )}
                  {['paused', 'interrupted', 'waiting_user'].includes(run.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void action(() => unwrap(api.control(run.id, 'resume')))}
                    >
                      Retomar
                    </button>
                  )}
                  {['running', 'paused', 'waiting_user', 'failed', 'interrupted'].includes(run.status) && (
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          label: 'Cancelar equipe',
                          message:
                            'Interromper o coordenador e todos os trabalhos pendentes? Alterações já produzidas serão preservadas.',
                          action: () => unwrap(api.control(run.id, 'cancel')),
                        })
                      }
                    >
                      Cancelar equipe
                    </button>
                  )}
                </>
              )
            )}
          </div>
          {preflight.length > 0 && (
            <div className="team-preflight" role="status">
              {preflight.map((item) => (
                <p key={item.provider} className={item.available ? 'success' : 'error'}>
                  {item.provider}: {item.available ? item.version : item.error}
                </p>
              ))}
              <p className="meta">
                Detecta os executáveis. Autenticação, modelo e cobrança são confirmados somente ao executar.
              </p>
            </div>
          )}
          {run?.error && mode === 'run' && (
            <div className="panel-banner warning" role="status">
              {run.error}
            </div>
          )}
          <div className="team-graph" aria-label="Hierarquia da equipe">
            <div className="team-root">{templateCard(team.coordinator, true)}</div>
            <div className="team-connections" aria-hidden="true">
              <svg viewBox="0 0 600 48" preserveAspectRatio="none">
                <path
                  d={
                    'M300 0 V18 M' +
                    300 / team.workers.length +
                    ' 18 H' +
                    (600 - 300 / team.workers.length) +
                    team.workers
                      .map((_, i) => ' M' + ((i + 0.5) * 600) / team.workers.length + ' 18 V48')
                      .join('')
                  }
                />
              </svg>
            </div>
            <div className="team-workers">
              {team.workers.map((item) => (
                <div key={item.id} className="team-worker-column">
                  {templateCard(item)}
                  {mode === 'run' &&
                    run?.jobs
                      .filter((j) => j.roleId === item.id)
                      .map((itemJob) => (
                        <button
                          type="button"
                          key={itemJob.id}
                          className={'team-job' + (jobId === itemJob.id ? ' selected' : '')}
                          onClick={() => {
                            setJobId(itemJob.id);
                            setRoleId(item.id);
                            setPatch(null);
                          }}
                        >
                          <Status status={itemJob.status} />
                          <span>{itemJob.prompt.slice(0, 110)}</span>
                          <span className="team-job-open">Abrir sessão →</span>
                        </button>
                      ))}
                </div>
              ))}
            </div>
            {mode === 'configure' && (
              <button
                type="button"
                className="team-add"
                disabled={draft.workers.length >= 12}
                onClick={() => {
                  const newRole: AgentRole = {
                    id: 'worker-' + crypto.randomUUID(),
                    name: 'Novo trabalhador',
                    provider: 'codex',
                    model: '',
                    instructions: '',
                    access: 'read-only',
                  };
                  setDraft({ ...draft, workers: [...draft.workers, newRole] });
                  setRoleId(newRole.id);
                }}
              >
                + Adicionar trabalhador
              </button>
            )}
            {mode === 'run' && run && (
              <p className="meta team-graph-caption">
                {run.jobs.length}/{run.team.limits.jobs} trabalhos · até {run.team.limits.parallel} em
                paralelo · clique em um trabalho para acompanhar
              </p>
            )}
          </div>
          {mode === 'configure' ? (
            <form
              className="team-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void action(start);
              }}
            >
              <label>
                Workspace
                <select
                  aria-label="Workspace"
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  required
                >
                  <option value="">Selecione um workspace</option>
                  {groups
                    .filter((g) => g.repoPath)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </label>
              <label htmlFor="team-objective">O que a equipe deve fazer?</label>
              <textarea
                id="team-objective"
                placeholder="Descreva o objetivo, as restrições e os critérios de aceitação…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={100000}
                required
                rows={4}
              />
              <div className="team-compose-footer">
                <span className="meta">
                  O envio inicia os agentes e consome o uso das contas configuradas nos CLIs.
                </span>
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !prompt.trim() || !workspaceId || !!activeRun || !!snapshot.warning}
                >
                  {busy ? 'Preparando…' : 'Iniciar orquestração'}
                </button>
              </div>
              {activeRun && (
                <button type="button" onClick={() => openRun(activeRun)}>
                  Acompanhar equipe ativa
                </button>
              )}
            </form>
          ) : (
            run && (
              <section className="team-conversation" aria-label="Conversa com o coordenador">
                <div className="team-usage">
                  <span>
                    {(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens reportados /{' '}
                    {run.team.limits.maxTokens.toLocaleString()}
                  </span>
                  <span>
                    {run.usage.costUsd === undefined
                      ? 'Custo não informado'
                      : 'Custo parcial reportado: US$ ' + run.usage.costUsd.toFixed(4)}
                  </span>
                </div>
                <p className="meta">
                  Limite de tokens aproximado: o uso pode ser reportado apenas ao concluir cada turno. Custos
                  não informados por um provedor não entram no total.
                </p>
                {run.messages.map((message, index) => (
                  <article className={'team-message team-message-' + message.role} key={index}>
                    <strong>{message.role === 'user' ? 'Você' : 'Coordenador'}</strong>
                    <div>{message.text}</div>
                  </article>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      await unwrap(api.message(run.id, reply));
                      setReply('');
                    });
                  }}
                >
                  <textarea
                    aria-label="Nova mensagem ao coordenador"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    maxLength={100000}
                    placeholder="Continue a conversa após a equipe terminar…"
                  />
                  <button
                    type="submit"
                    className="primary"
                    disabled={
                      busy ||
                      isWorking ||
                      run.status === 'cancelled' ||
                      !reply.trim() ||
                      run.jobs.some((j) => ACTIVE_JOBS.includes(j.status))
                    }
                  >
                    Enviar mensagem
                  </button>
                </form>
              </section>
            )
          )}
        </main>
        <aside
          className="team-inspector"
          aria-label={mode === 'configure' ? 'Configuração do papel' : 'Inspeção da sessão'}
        >
          {mode === 'configure' ? (
            <>
              <h2>Configuração da equipe</h2>
              <label>
                Nome da equipe
                <input
                  value={draft.name}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <h3>{role.id === team.coordinator.id ? 'Coordenador' : 'Trabalhador'}</h3>
              <label>
                Nome do papel
                <input
                  value={role.name}
                  maxLength={80}
                  onChange={(e) => updateRole({ name: e.target.value })}
                />
              </label>
              <label>
                Provedor
                <select
                  value={role.provider}
                  onChange={(e) =>
                    updateRole({ provider: e.target.value as AgentRole['provider'], model: '' })
                  }
                >
                  <option value="claude">Claude Code</option>
                  <option value="codex">Codex CLI</option>
                </select>
              </label>
              <label>
                Modelo
                <input
                  aria-label="Modelo"
                  list={'team-models-' + role.provider}
                  value={role.model}
                  onChange={(e) => updateRole({ model: e.target.value })}
                  maxLength={100}
                  placeholder="Padrão do CLI"
                />
                <datalist id={'team-models-' + role.provider}>
                  {agents
                    .find((a) => a.id === role.provider)
                    ?.model?.options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </datalist>
              </label>
              <label>
                Permissão
                <select
                  value={role.access}
                  disabled={role.id === team.coordinator.id}
                  onChange={(e) => updateRole({ access: e.target.value as AgentRole['access'] })}
                >
                  <option value="read-only">Somente leitura</option>
                  <option value="workspace-write">Editar worktree isolado</option>
                </select>
              </label>
              <label>
                Instruções
                <textarea
                  value={role.instructions}
                  maxLength={20000}
                  rows={7}
                  onChange={(e) => updateRole({ instructions: e.target.value })}
                />
              </label>
              <label className="team-import">
                Importar instruções do Kit (.md/.txt)
                <input
                  type="file"
                  accept=".md,.txt"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (file.size > 100000) {
                        setError('O arquivo excede 100 kB.');
                        return;
                      }
                      setImportSource(file.name);
                      void file
                        .text()
                        .then((value) => setImported(value.slice(0, 20000)))
                        .catch(() => setError('Não foi possível ler o arquivo.'));
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="meta">
                Importação assistida de instruções. Comandos, hooks e ferramentas específicos do Kit precisam
                de adaptação.
              </p>
              {role.id !== team.coordinator.id && (
                <button
                  type="button"
                  className="danger"
                  disabled={draft.workers.length <= 1}
                  onClick={() => {
                    setDraft({ ...draft, workers: draft.workers.filter((item) => item.id !== role.id) });
                    setRoleId(team.coordinator.id);
                  }}
                >
                  Remover papel
                </button>
              )}
              <fieldset className="team-limits">
                <legend>Limites por execução</legend>
                {(
                  [
                    ['parallel', 'Trabalhos paralelos', 1, 4],
                    ['jobs', 'Total de trabalhos', 1, 32],
                    ['timeoutMinutes', 'Timeout por sessão (min)', 1, 120],
                    ['maxTurns', 'Turnos do coordenador', 1, 32],
                    ['maxTokens', 'Tokens reportados (aproximado)', 1000, 10000000],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={draft.limits[key]}
                      onChange={(e) =>
                        setDraft({ ...draft, limits: { ...draft.limits, [key]: Number(e.target.value) } })
                      }
                    />
                  </label>
                ))}
              </fieldset>
              <p className="meta">
                Sem delegação recursiva gerenciada. Escrita exige Git. Trabalhos usam o commit base, sem
                copiar alterações locais não commitadas.
              </p>
              {draft.id && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      label: 'Excluir equipe',
                      message:
                        'Excluir este modelo de equipe? O histórico e os worktrees existentes serão preservados.',
                      action: async () => {
                        await unwrap(api.removeTeam(draft.id));
                        setDraft(clone(DEFAULT_TEAM));
                      },
                    })
                  }
                >
                  Excluir equipe salva
                </button>
              )}
            </>
          ) : (
            run && (
              <>
                <h2>{job ? team.workers.find((item) => item.id === job.roleId)?.name : 'Coordenador'}</h2>
                <span className="team-eyebrow">CONSOLE DE EVENTOS</span>
                <p className="meta">
                  Transcrição da sessão programática. Este painel não é uma segunda CLI nem um terminal
                  interativo.
                </p>
                {job && (
                  <>
                    <Status status={job.status} />
                    <p>{job.prompt}</p>
                    {job.cwd && (
                      <details>
                        <summary>Worktree e identidade</summary>
                        <code>{job.cwd}</code>
                        <p className="meta">{job.providerSessionId ?? 'Identidade ainda não reportada'}</p>
                      </details>
                    )}
                    {job.error && (
                      <p className="error" role="status">
                        {job.error}
                      </p>
                    )}
                    {ACTIVE_JOBS.includes(job.status) && (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            label: 'Parar trabalho',
                            message: 'Interromper este trabalho? Arquivos já produzidos serão preservados.',
                            action: () => unwrap(api.cancelJob(run.id, job.id)),
                          })
                        }
                      >
                        Parar trabalho
                      </button>
                    )}
                    {['failed', 'interrupted', 'cancelled'].includes(job.status) && (
                      <button
                        type="button"
                        disabled={busy || run.status === 'cancelled'}
                        onClick={() =>
                          setConfirm({
                            label: 'Repetir trabalho',
                            message:
                              'Criar uma nova tentativa em outro worktree? Essa ação consome uso adicional; a tentativa anterior será preservada.',
                            action: () => unwrap(api.retryJob(run.id, job.id)),
                          })
                        }
                      >
                        Repetir em novo worktree
                      </button>
                    )}
                    {job.baseCommit && !ACTIVE_JOBS.includes(job.status) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void action(async () =>
                            setPatch({ jobId: job.id, text: await unwrap(api.patch(run.id, job.id)) }),
                          )
                        }
                      >
                        Revisar alterações
                      </button>
                    )}
                  </>
                )}
                <EventConsole events={job ? job.events : run.coordinatorEvents} />
                {job?.result && (
                  <details open>
                    <summary>Resultado do trabalho</summary>
                    <div className="team-result">{job.result}</div>
                  </details>
                )}
                {job && (
                  <button
                    type="button"
                    onClick={() => {
                      setJobId(null);
                      setRoleId(team.coordinator.id);
                    }}
                  >
                    Ver sessão do coordenador
                  </button>
                )}
              </>
            )
          )}
        </aside>
      </div>
      {patch && run && (
        <div className="team-overlay">
          <section role="dialog" aria-modal="true" aria-labelledby="team-patch-title" className="team-patch">
            <h2 id="team-patch-title">Revisar alterações</h2>
            <p className="meta">
              O patch é aplicado aos arquivos do workspace, sem commit ou push. A primeira aplicação exige
              workspace limpo. Patches seguintes da mesma equipe podem ser aplicados se não houver outras
              edições.
            </p>
            <pre tabIndex={0}>{patch.text || 'Nenhuma alteração.'}</pre>
            <div className="actions">
              <button type="button" onClick={() => setPatch(null)}>
                Fechar
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !patch.text || !!run.jobs.find((j) => j.id === patch.jobId)?.patchApplied}
                onClick={() =>
                  setConfirm({
                    label: 'Aplicar patch',
                    message:
                      'Aplicar estas alterações ao workspace? Conflitos impedem a aplicação. Nenhum commit será criado.',
                    action: async () => {
                      await unwrap(api.applyPatch(run.id, patch.jobId));
                      setPatch(null);
                    },
                  })
                }
              >
                Aplicar ao workspace
              </button>
            </div>
          </section>
        </div>
      )}
      {imported !== null && (
        <div className="team-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-import-title"
            className="team-import-preview"
          >
            <h2 id="team-import-title">Importar {importSource}</h2>
            <p className="meta">Revise as instruções antes de substituir o conteúdo do papel selecionado.</p>
            <textarea
              aria-label="Instruções importadas"
              value={imported}
              onChange={(e) => setImported(e.target.value)}
              maxLength={20000}
              rows={16}
            />
            <div className="actions">
              <button type="button" onClick={() => setImported(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  updateRole({ instructions: imported });
                  setImported(null);
                }}
              >
                Usar instruções
              </button>
            </div>
          </section>
        </div>
      )}
      {confirm && (
        <div className="team-overlay">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="team-confirm-title"
            className="team-confirm"
          >
            <h2 id="team-confirm-title">{confirm.label}</h2>
            <p>{confirm.message}</p>
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                Voltar
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  const operation = confirm.action;
                  setConfirm(null);
                  void action(operation);
                }}
              >
                {confirm.label}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
