import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentDefinition, AgentPick, MelinnaApi, WorkspaceSnapshot } from '../../../shared/ipc-contract';
import type {
  RestorePreview,
  TaskNotes,
  TaskReview,
  WorkflowApi,
  ReviewDiff,
} from '../../../shared/workflow-api';
import { errorMessage, unwrap } from '../../api';
import { useWorkflow } from '../../workflow/use-workflow';
import { FileSection, type DiffMode } from '../DiffView/DiffView';
import { isLiveStatus } from '../../labels';
import { AgentFields } from './AgentFields';
import { ProfilesPanel } from './ProfilesPanel';
import './workflow.css';

export type WorkflowTab = 'review' | 'handoff' | 'profiles' | 'notices';
interface Props {
  api: MelinnaApi;
  workflow: WorkflowApi;
  workspace: WorkspaceSnapshot;
  agents: readonly AgentDefinition[];
  executionId: string | null;
  initialTab: WorkflowTab;
  onClose(): void;
  onOpenExecution(id: string): void;
}
const CHECK_STATUS: Record<string, string> = {
  starting: 'Preparando',
  running: 'Executando',
  passed: 'Código 0',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  interrupted: 'Interrompida',
};
export function TaskWorkflowDialog({
  api,
  workflow,
  workspace,
  agents,
  executionId,
  initialTab,
  onClose,
  onOpenExecution,
}: Props) {
  const state = useWorkflow(api);
  const available = workspace.executions.filter((e) => !e.command);
  const [selected, setSelected] = useState(executionId ?? available.at(-1)?.id ?? '');
  const [tab, setTab] = useState<WorkflowTab>(initialTab);
  const [review, setReview] = useState<TaskReview | null>(null);
  const [checkpointId, setCheckpointId] = useState('');
  const [draftNotes, setDraftNotes] = useState<TaskNotes | null>(null);
  const notesDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checkpointName, setCheckpointName] = useState('Checkpoint manual');
  const [diff, setDiff] = useState<ReviewDiff | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>('split');
  const [briefing, setBriefing] = useState('');
  const [target, setTarget] = useState<AgentPick>(() => ({
    agentId: agents.find((a) => a.kind === 'agent')?.id ?? '',
  }));
  const [configId, setConfigId] = useState('');
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    action: () => Promise<unknown>;
    discard?: () => void;
  } | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<import('../../../shared/ipc-contract').RunConfigView[]>(
    [],
  );
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const request = ++seq.current;
    if (!selected) {
      setReview(null);
      return;
    }
    try {
      const value = await unwrap(workflow.review(selected, checkpointId || undefined));
      if (request === seq.current) {
        setReview(value);
        if (!notesDirty.current) setDraftNotes(value.notes);
      }
    } catch (err) {
      if (request === seq.current) setError(errorMessage(err));
    }
  }, [workflow, selected, checkpointId]);
  useEffect(() => {
    void load();
    const off = workflow.onChange(() => void load());
    return () => {
      seq.current++;
      off();
    };
  }, [workflow, load]);
  useEffect(() => {
    void unwrap(api.run.list()).then(
      (list) => setSavedConfigs(list.configs),
      (err) => setError(errorMessage(err)),
    );
  }, [api, state.data.preferences, selected]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (!confirm && !restorePreview) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('.workflow-overlay:last-child button')?.focus();
    return () => previous?.focus();
  }, [confirm, restorePreview]);
  const action = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
      await load();
      await state.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const saveNotes = async () => {
    if (draftNotes && review) {
      await unwrap(workflow.saveNotes(review.task.id, draftNotes));
      notesDirty.current = false;
    }
  };
  const requestClose = () => {
    if (notesDirty.current)
      setConfirm({
        title: 'Salvar notas antes de sair',
        discard: onClose,
        text: 'As notas têm alterações locais. Salvar e fechar a revisão?',
        action: async () => {
          await saveNotes();
          onClose();
        },
      });
    else onClose();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirm) setConfirm(null);
      else if (restorePreview) setRestorePreview(null);
      else requestClose();
    }
    if (event.key === 'Tab') {
      const scope =
        root.current?.querySelector<HTMLElement>('.workflow-overlay:last-child > section') ?? root.current;
      const items = [
        ...(scope?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  const selectExecution = (id: string) => {
    const change = () => {
      notesDirty.current = false;
      setSelected(id);
      setCheckpointId('');
      setDiff(null);
      setBriefing('');
      setDraftNotes(null);
      setReview(null);
      return Promise.resolve();
    };
    if (notesDirty.current)
      setConfirm({
        title: 'Salvar e trocar execução',
        text: 'Salvar as notas editadas antes de revisar outra execução?',
        action: async () => {
          await saveNotes();
          await change();
        },
      });
    else void change();
  };
  const runVerification = async (choice?: 'wrapper-sh' | 'system-tool') => {
    const result = await unwrap(workflow.verify(selected, configId, { cols: 100, rows: 30 }, choice));
    if ('needsConfirm' in result)
      setConfirm({
        title: 'Executar wrapper com sh',
        text: 'O wrapper não tem permissão de execução. Executá-lo com sh? A configuração e as etapas anteriores podem alterar arquivos do projeto.',
        action: () => runVerification('wrapper-sh'),
      });
    else setMessage('Verificação iniciada. O resultado será associado a esta tarefa.');
  };
  const activeConfigs = savedConfigs.filter((c) => c.groupId === review?.task.groupId);
  const stopIds = review
    ? [review.execution.id, ...review.otherLiveExecutions].filter((id) => {
        const exec = workspace.executions.find((e) => e.id === id);
        return exec && isLiveStatus(exec.status);
      })
    : [];
  const unread = state.data.notices.filter((n) => !n.read).length;
  return (
    <div className="modal-backdrop workflow-backdrop" role="presentation">
      <div
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-workflow-title"
        data-shortcut-scope="task-workflow"
        ref={root}
        onKeyDown={onKey}
      >
        <header className="workflow-header">
          <div>
            <span className="workflow-eyebrow">MELINNA / TAREFAS</span>
            <h2 id="task-workflow-title">Revisar, verificar e continuar</h2>
          </div>
          <button type="button" ref={close} onClick={requestClose}>
            Voltar à IDE
          </button>
        </header>
        <nav className="workflow-tabs" aria-label="Seções da tarefa">
          {(
            [
              ['review', 'Revisão'],
              ['handoff', 'Passar para outro agente'],
              ['profiles', 'Perfis de uso'],
              ['notices', 'Avisos' + (unread ? ' (' + unread + ')' : '')],
            ] as const
          ).map(([id, label]) => (
            <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        {(error || state.error || state.data.warning) && (
          <div className="panel-banner error" role="alert">
            <span>{error || state.error || state.data.warning}</span>
            <button type="button" onClick={() => setError(null)}>
              Dispensar
            </button>
          </div>
        )}
        {message && (
          <div className="panel-banner" role="status">
            {message}
          </div>
        )}
        <div className="workflow-content">
          {(tab === 'review' || tab === 'handoff') && (
            <>
              <div className="workflow-selector">
                <label>
                  Execução da tarefa
                  <select
                    aria-label="Execução da tarefa"
                    value={selected}
                    onChange={(e) => selectExecution(e.target.value)}
                  >
                    <option value="">Selecione uma execução</option>
                    {available.map((exec) => (
                      <option key={exec.id} value={exec.id}>
                        {workspace.tasks.find((t) => t.id === exec.taskId)?.title} · {exec.agentId} ·{' '}
                        {exec.status}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={busy || !selected} onClick={() => void action(load)}>
                  Atualizar revisão
                </button>
              </div>
              {!selected && (
                <p className="meta">
                  Inicie ou selecione uma tarefa para revisar seu trabalho. Os perfis podem ser configurados
                  antes de abrir um agente.
                </p>
              )}
              {selected && !review && !error && <p role="status">Carregando revisão…</p>}
              {review && (
                <>
                  <p className="meta workflow-root">{review.execution.worktreePath}</p>
                  {review.partial && (
                    <p className="warning">
                      Revisão parcial: uma pasta extra está indisponível. As alterações mostradas cobrem
                      somente as pastas acessíveis.
                    </p>
                  )}
                  {review.otherLiveExecutions.length > 0 && (
                    <p className="warning">
                      Há outras execuções nestas pastas. O diff mostra mudanças desde o checkpoint; não
                      comprova qual agente ou pessoa fez cada alteração.
                    </p>
                  )}
                  {tab === 'review' && (
                    <>
                      <div className="workflow-review-grid">
                        <section aria-label="Objetivo e notas">
                          <h3>Contexto da tarefa</h3>
                          {draftNotes &&
                            (
                              Object.entries({
                                objective: 'Objetivo',
                                decisions: 'Decisões',
                                pending: 'Pendências',
                                constraints: 'Restrições',
                              }) as [keyof TaskNotes, string][]
                            ).map(([key, label]) => (
                              <label key={key}>
                                {label}
                                <textarea
                                  aria-label={'Notas: ' + label}
                                  rows={key === 'objective' ? 4 : 3}
                                  value={draftNotes?.[key] ?? ''}
                                  maxLength={key === 'objective' ? 100000 : 20000}
                                  onChange={(e) => {
                                    notesDirty.current = true;
                                    setDraftNotes((previous) =>
                                      previous ? { ...previous, [key]: e.target.value } : previous,
                                    );
                                  }}
                                />
                              </label>
                            ))}
                          <button
                            type="button"
                            disabled={busy || !draftNotes}
                            onClick={() =>
                              void action(async () => {
                                await saveNotes();
                                setMessage('Notas salvas.');
                              })
                            }
                          >
                            Salvar notas
                          </button>
                        </section>
                        <section aria-label="Checkpoints da tarefa">
                          <h3>Checkpoints</h3>
                          <p className="meta">
                            Preservam os arquivos no momento da captura, inclusive alterações locais
                            anteriores. Não substituem commits.
                          </p>
                          <label>
                            Comparar com
                            <select
                              aria-label="Checkpoint de comparação"
                              value={checkpointId || review.checkpoint?.id || ''}
                              onChange={(e) => {
                                setCheckpointId(e.target.value);
                                setDiff(null);
                              }}
                            >
                              <option value="">Sem checkpoint anterior</option>
                              {[...review.checkpoints].reverse().map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} · {new Date(c.createdAt).toLocaleString()}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Nome do checkpoint
                            <input
                              aria-label="Nome do checkpoint"
                              value={checkpointName}
                              maxLength={100}
                              onChange={(e) => setCheckpointName(e.target.value)}
                            />
                          </label>
                          <div className="actions">
                            <button
                              type="button"
                              disabled={busy || !checkpointName.trim()}
                              onClick={() =>
                                void action(async () => {
                                  const c = await unwrap(workflow.checkpoint(selected, checkpointName));
                                  setCheckpointId(c.id);
                                  setMessage('Checkpoint criado.');
                                })
                              }
                            >
                              Criar checkpoint
                            </button>
                            <button
                              type="button"
                              disabled={busy || !review.checkpoint}
                              onClick={() =>
                                void action(async () => {
                                  if (review.checkpoint)
                                    setRestorePreview(
                                      await unwrap(workflow.previewRestore(review.checkpoint.id)),
                                    );
                                })
                              }
                            >
                              Prévia da restauração
                            </button>
                          </div>
                          {stopIds.length > 0 && (
                            <button
                              type="button"
                              className="danger"
                              disabled={busy}
                              onClick={() =>
                                setConfirm({
                                  title: 'Encerrar execuções nestas pastas',
                                  text: 'A restauração exige as execuções paradas. Encerrar os agentes e comandos destas pastas? Os arquivos atuais serão preservados.',
                                  action: async () => {
                                    for (const id of stopIds) await unwrap(api.executions.stop(id));
                                  },
                                })
                              }
                            >
                              Encerrar execuções para restaurar
                            </button>
                          )}
                          <details>
                            <summary>Escopo e limites</summary>
                            <p className="meta">{review.scope}</p>
                            <p className="meta">
                              Até 20 mil arquivos, 100 MB totais e 25 MB por arquivo. Links simbólicos e
                              submódulos não são suportados. Restauração faz um checkpoint de segurança e
                              recusa arquivos alterados depois da prévia.
                            </p>
                          </details>
                        </section>
                      </div>
                      <section className="workflow-changes" aria-label="Alterações da tarefa">
                        <h3>
                          Alterações desde o checkpoint{' '}
                          <span className="meta">{review.changes.length} arquivo(s)</span>
                        </h3>
                        {!review.checkpoint ? (
                          <p className="warning">
                            Sem checkpoint anterior: não é possível atribuir alterações a esta execução. Crie
                            um checkpoint para acompanhar as próximas mudanças.
                          </p>
                        ) : review.changes.length === 0 ? (
                          <p className="meta">Nenhuma alteração detectada no escopo.</p>
                        ) : (
                          <div className="workflow-change-list">
                            {review.changes.map((change) => (
                              <button
                                type="button"
                                key={change.root + '/' + change.path}
                                onClick={() =>
                                  void action(async () => {
                                    if (review.checkpoint)
                                      setDiff(
                                        await unwrap(
                                          workflow.diff(
                                            selected,
                                            review.checkpoint.id,
                                            change.root,
                                            change.path,
                                          ),
                                        ),
                                      );
                                  })
                                }
                              >
                                <span className={'workflow-change-' + change.change}>
                                  {change.change === 'added' ? '+' : change.change === 'deleted' ? '−' : '●'}
                                </span>
                                <code>{change.path}</code>
                                <span className="meta">
                                  {change.beforeBytes} → {change.afterBytes} B
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {diff && (
                          <div className="workflow-diff">
                            <div className="actions">
                              <button
                                type="button"
                                aria-pressed={diffMode === 'split'}
                                onClick={() => setDiffMode('split')}
                              >
                                Lado a lado
                              </button>
                              <button
                                type="button"
                                aria-pressed={diffMode === 'unified'}
                                onClick={() => setDiffMode('unified')}
                              >
                                Unificado
                              </button>
                            </div>
                            <FileSection file={diff} mode={diffMode} />
                          </div>
                        )}
                      </section>
                      <section className="workflow-verification" aria-label="Verificações da tarefa">
                        <h3>Verificar a entrega</h3>
                        <p className="meta">
                          Executa uma configuração salva nos arquivos desta execução. Um código 0 confirma o
                          processo; não comprova todos os critérios do objetivo. Alterações posteriores deixam
                          o resultado desatualizado.
                        </p>
                        <div className="workflow-selector">
                          <label>
                            Configuração para verificar
                            <select
                              aria-label="Configuração para verificar"
                              value={configId}
                              onChange={(e) => setConfigId(e.target.value)}
                            >
                              <option value="">Escolha uma configuração salva</option>
                              {activeConfigs.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="primary"
                            disabled={
                              busy ||
                              !configId ||
                              review.verifications.some(
                                (v) => v.status === 'starting' || v.status === 'running',
                              )
                            }
                            onClick={() =>
                              setConfirm({
                                title: 'Executar verificação',
                                text: 'Executar a configuração selecionada, incluindo suas etapas anteriores e variáveis? Ela pode alterar arquivos, criar artefatos ou acessar serviços conforme sua configuração.',
                                action: () => runVerification(),
                              })
                            }
                          >
                            Executar verificação
                          </button>
                        </div>
                        {!activeConfigs.length && (
                          <p className="meta">
                            Crie uma configuração de build, lint ou testes no seletor de execução da IDE para
                            oferecê-la aqui.
                          </p>
                        )}
                        {!review.verifications.length && (
                          <p className="meta">Nenhuma verificação foi executada nesta tarefa.</p>
                        )}
                        {review.verifications.map((v) => (
                          <article key={v.id} className={'workflow-check workflow-check-' + v.status}>
                            <div>
                              <strong>{v.label}</strong>
                              <span>
                                {CHECK_STATUS[v.status]}
                                {v.stale ? ' · arquivos alterados desde o início' : ''}
                                {v.exitCode !== null ? ' · saída ' + v.exitCode : ''}
                              </span>
                              {v.error && <p className="error">{v.error}</p>}
                            </div>
                            <div className="actions">
                              {v.commandExecutionId && (
                                <button
                                  type="button"
                                  onClick={() => onOpenExecution(v.commandExecutionId as string)}
                                >
                                  Abrir saída
                                </button>
                              )}
                              {(v.status === 'running' || v.status === 'starting') && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void action(() => unwrap(workflow.cancelVerification(v.id)))}
                                >
                                  Parar verificação
                                </button>
                              )}
                            </div>
                          </article>
                        ))}
                      </section>
                    </>
                  )}
                  {tab === 'handoff' && (
                    <section className="workflow-handoff">
                      <h3>Continuar com outro agente</h3>
                      <p>
                        O resumo reúne o objetivo, suas notas, a lista de alterações e as verificações
                        registradas. Revise e edite antes de enviar.
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void action(async () => {
                            await saveNotes();
                            setBriefing(await unwrap(workflow.draftHandoff(selected)));
                          })
                        }
                      >
                        Preparar resumo com as notas
                      </button>
                      <label>
                        Resumo para o próximo agente
                        <textarea
                          aria-label="Resumo para o próximo agente"
                          rows={17}
                          value={briefing}
                          maxLength={100000}
                          onChange={(e) => setBriefing(e.target.value)}
                        />
                      </label>
                      <AgentFields agents={agents} value={target} onChange={setTarget} prefix="Destino: " />
                      <p className="meta">
                        O agente de origem será encerrado antes da continuação. Seus arquivos e histórico
                        serão preservados. O destino recebe os arquivos atuais e este texto; não recebe a
                        memória interna do modelo anterior.
                      </p>
                      <div className="actions">
                        <button
                          type="button"
                          disabled={!briefing}
                          onClick={() =>
                            void action(async () => {
                              await navigator.clipboard.writeText(briefing);
                              setMessage('Resumo copiado.');
                            })
                          }
                        >
                          Copiar resumo
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || !briefing.trim() || !target.agentId}
                          onClick={() => {
                            const agent = agents.find((a) => a.id === target.agentId);
                            const permission = agent?.permission?.options.find(
                              (p) => p.id === (target.permission ?? agent.permission?.default),
                            );
                            setConfirm({
                              title: 'Enviar continuação',
                              text:
                                'Encerrar a execução de origem, criar um checkpoint e abrir ' +
                                (agent?.displayName ?? target.agentId) +
                                ' com o resumo revisado? A nova sessão pode consumir uso da conta.' +
                                (permission?.dangerous
                                  ? ' ATENÇÃO: o destino usa permissões ampliadas: ' + permission.label + '.'
                                  : ''),
                              action: async () => {
                                const results = await unwrap(
                                  workflow.handoff({
                                    executionId: selected,
                                    briefing,
                                    pick: target,
                                    size: { cols: 100, rows: 30 },
                                  }),
                                );
                                const failed = results.find((r) => !r.ok);
                                if (failed && !failed.ok) {
                                  setError(failed.error.message);
                                  return;
                                }
                                const next = results.find((r) => r.ok);
                                if (next) onOpenExecution(next.execId);
                              },
                            });
                          }}
                        >
                          Enviar continuação
                        </button>
                      </div>
                      {review.handoffs.length > 0 && (
                        <details>
                          <summary>Passagens registradas</summary>
                          {review.handoffs.map((h) => (
                            <p className="meta" key={h.id}>
                              {new Date(h.createdAt).toLocaleString()} ·{' '}
                              {h.targetExecutionId ? 'Destino criado' : 'Tentativa sem destino confirmado'}
                            </p>
                          ))}
                        </details>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}
          {tab === 'profiles' && (
            <ProfilesPanel
              api={workflow}
              data={state.data}
              groups={workspace.groups}
              agents={agents}
              action={(operation) => void action(operation)}
              busy={busy}
            />
          )}
          {tab === 'notices' && (
            <section className="workflow-notices">
              <h3>Avisos e preferências</h3>
              <label className="workflow-checkbox">
                <input
                  type="checkbox"
                  checked={state.data.preferences.checkpointBeforeLaunch}
                  disabled={busy}
                  onChange={(e) =>
                    void action(() =>
                      unwrap(
                        workflow.preferences({
                          ...state.data.preferences,
                          checkpointBeforeLaunch: e.target.checked,
                        }),
                      ),
                    )
                  }
                />
                Criar checkpoint antes de iniciar agentes por padrão
              </label>
              <label className="workflow-checkbox">
                <input
                  type="checkbox"
                  checked={state.data.preferences.desktopNotifications}
                  disabled={busy}
                  onChange={(e) =>
                    void action(() =>
                      unwrap(
                        workflow.preferences({
                          ...state.data.preferences,
                          desktopNotifications: e.target.checked,
                        }),
                      ),
                    )
                  }
                />
                Notificações do sistema quando o Melinna estiver em segundo plano
              </label>
              <label className="workflow-checkbox">
                <input
                  type="checkbox"
                  checked={state.data.preferences.quietNotifications}
                  disabled={busy}
                  onChange={(e) =>
                    void action(() =>
                      unwrap(
                        workflow.preferences({
                          ...state.data.preferences,
                          quietNotifications: e.target.checked,
                        }),
                      ),
                    )
                  }
                />
                Avisar quando um agente ficar sem saída recente (estimativa)
              </label>
              <p className="meta">
                Fim do processo e falha de execução são eventos confirmados. Falta de saída é apenas uma
                estimativa; não confirma conclusão nem bloqueio do agente.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(() => unwrap(workflow.markRead()))}
              >
                Marcar avisos como lidos
              </button>
              {state.data.notices.map((n) => (
                <article key={n.id} className={'workflow-notice' + (n.read ? '' : ' unread')}>
                  <div>
                    <time>{new Date(n.at).toLocaleString()}</time>
                    <p>{n.text}</p>
                  </div>
                  <button type="button" onClick={() => onOpenExecution(n.executionId)}>
                    Abrir execução
                  </button>
                </article>
              ))}
            </section>
          )}
        </div>
        {restorePreview && (
          <div className="workflow-overlay">
            <section role="alertdialog" aria-modal="true" aria-labelledby="workflow-restore-title">
              <h3 id="workflow-restore-title">Confirmar restauração de arquivos</h3>
              {error && <p className="error">{error}</p>}
              <p>
                Os arquivos abaixo voltarão ao checkpoint escolhido. Arquivos criados depois dele serão
                removidos apenas se constarem nesta prévia. Um checkpoint de segurança dos arquivos atuais
                será salvo antes.
              </p>
              <div className="workflow-restore-list">
                {restorePreview.changes.map((c) => (
                  <p key={c.root + c.path}>
                    <code>
                      {c.root}/{c.path}
                    </code>{' '}
                    · {c.change}
                  </p>
                ))}
              </div>
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => setRestorePreview(null)}>
                  Cancelar restauração
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy || !restorePreview.changes.length}
                  onClick={() =>
                    void action(async () => {
                      await unwrap(workflow.restore(restorePreview.id));
                      setRestorePreview(null);
                      setDiff(null);
                      setMessage('Arquivos restaurados. O checkpoint de segurança está disponível na lista.');
                    })
                  }
                >
                  Restaurar arquivos
                </button>
              </div>
            </section>
          </div>
        )}
        {confirm && (
          <div className="workflow-overlay">
            <section role="alertdialog" aria-modal="true" aria-labelledby="workflow-confirm-title">
              <h3 id="workflow-confirm-title">{confirm.title}</h3>
              <p>{confirm.text}</p>
              <div className="actions">
                {confirm.discard && (
                  <button type="button" disabled={busy} onClick={confirm.discard}>
                    Sair sem salvar notas
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setConfirm(null)}>
                  Cancelar
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
                  {confirm.title}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
