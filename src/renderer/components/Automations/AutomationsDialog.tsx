import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  AgentDefinition,
  AutomationInput,
  AutomationListing,
  AutomationRun,
  AutomationSchedule,
  AutomationView,
} from '../../../shared/ipc-contract';
import { AUTOMATION_LIMITS } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Draft = Omit<AutomationInput, 'schedule'> & {
  kind: AutomationSchedule['kind'];
  time: string;
  days: number[];
  minutes: string;
};

export interface AutomationsDialogProps {
  /** Agentes instalados que podem receber um enunciado. */
  agents: AgentDefinition[];
  onClose: () => void;
}

export function describeSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === 'interval') {
    const { minutes } = schedule;
    return minutes % 60 === 0 ? `A cada ${minutes / 60} h` : `A cada ${minutes} min`;
  }
  const days =
    schedule.days.length === 0 || schedule.days.length === 7
      ? 'Todo dia'
      : schedule.days.map((d) => WEEKDAYS[d]).join(', ');
  return `${days} às ${schedule.time}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function describeRun(run: AutomationRun | null): string {
  if (!run) return 'Ainda não disparou';
  if (run.status === 'launched') return `Disparou em ${when(run.at)}`;
  if (run.status === 'missed') return `Perdida em ${when(run.detail ?? run.at)}`;
  return `Falhou em ${when(run.at)}: ${run.detail ?? 'erro desconhecido'}`;
}

function emptyDraft(agentId: string): Draft {
  return {
    name: '',
    folder: '',
    agentId,
    prompt: '',
    enabled: true,
    isolation: 'direct',
    kind: 'daily',
    time: '09:00',
    days: [],
    minutes: '60',
  };
}

function draftOf(a: AutomationView): Draft {
  return {
    id: a.id,
    name: a.name,
    folder: a.folder,
    agentId: a.agentId,
    prompt: a.prompt,
    enabled: a.enabled,
    isolation: a.isolation,
    kind: a.schedule.kind,
    time: a.schedule.kind === 'daily' ? a.schedule.time : '09:00',
    days: a.schedule.kind === 'daily' ? a.schedule.days : [],
    minutes: a.schedule.kind === 'interval' ? String(a.schedule.minutes) : '60',
  };
}

function inputOf(draft: Draft): AutomationInput {
  const { kind, time, days, minutes, ...rest } = draft;
  const schedule: AutomationSchedule =
    kind === 'daily' ? { kind, time, days } : { kind, minutes: Number.parseInt(minutes, 10) };
  return { ...rest, schedule };
}

/** Automações agendadas: lista com o último e o próximo disparo, e o formulário de criar ou editar. */
export function AutomationsDialog({ agents, onClose }: AutomationsDialogProps) {
  const api = useApi();
  const [listing, setListing] = useState<AutomationListing | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setListing(await unwrap(api.automations.list()));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void reload();
    return api.automations.onChange(() => void reload());
  }, [api, reload]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (await act(() => unwrap(api.automations.save(inputOf(draft))))) setDraft(null);
  };

  const chooseFolder = async () => {
    if (!draft) return;
    try {
      const picked = await unwrap(api.workspace.pickRepository(draft.folder.trim() || undefined));
      if (picked) setDraft({ ...draft, folder: picked });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  const agentName = (id: string) => agents.find((a) => a.id === id)?.displayName ?? `${id} (não instalado)`;
  const minutes = draft ? Number.parseInt(draft.minutes, 10) : 0;
  const canSave =
    draft !== null &&
    !busy &&
    draft.name.trim() !== '' &&
    draft.folder.trim() !== '' &&
    draft.prompt.trim() !== '' &&
    draft.agentId !== '' &&
    (draft.kind === 'daily' ||
      (Number.isInteger(minutes) &&
        minutes >= AUTOMATION_LIMITS.intervalMin &&
        minutes <= AUTOMATION_LIMITS.intervalMax));

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal automations" role="dialog" aria-modal="true" aria-labelledby="automations-title">
        <h2 id="automations-title">Automações</h2>
        <p className="meta">
          Cada automação abre uma sessão do agente na pasta, com o enunciado, no horário marcado. Só dispara
          com o app aberto: um horário que passa com o app fechado fica registrado como perdido e não roda
          depois.
        </p>
        {listing?.readOnly && (
          <p className="warning">
            O arquivo de automações é de uma versão mais nova do app: as mudanças valem só nesta sessão.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!draft && (
          <>
            {listing && listing.automations.length === 0 && <p>Nenhuma automação ainda.</p>}
            <ul className="automation-list">
              {(listing?.automations ?? []).map((a) => (
                <li key={a.id} data-testid={`automation-${a.id}`}>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      aria-label={`Ligar ${a.name}`}
                      checked={a.enabled}
                      disabled={busy}
                      onChange={(e) =>
                        void act(() => unwrap(api.automations.setEnabled(a.id, e.target.checked)))
                      }
                    />
                    <strong>{a.name}</strong>
                  </label>
                  <span className="meta">
                    {describeSchedule(a.schedule)} · {agentName(a.agentId)} · {a.folder}
                  </span>
                  <span className={a.lastRun?.status === 'failed' ? 'error' : 'meta'}>
                    {describeRun(a.lastRun)}
                  </span>
                  {(a.runs?.length ?? 0) > 0 && (
                    <details>
                      <summary>Hist?rico de disparos</summary>
                      <ul>
                        {a.runs?.map((run, index) => (
                          <li key={index}>{describeRun(run)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {a.nextRunAt && <span className="meta">Próximo disparo: {when(a.nextRunAt)}</span>}
                  <span className="actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(() => unwrap(api.automations.runNow(a.id)))}
                    >
                      Rodar agora
                    </button>
                    <button type="button" disabled={busy} onClick={() => setDraft(draftOf(a))}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => void act(() => unwrap(api.automations.remove(a.id)))}
                    >
                      Excluir
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button type="button" onClick={onClose}>
                Fechar
              </button>
              <button
                type="button"
                className="primary"
                disabled={agents.length === 0}
                title={agents.length === 0 ? 'Nenhum agente instalado' : undefined}
                onClick={() => setDraft(emptyDraft(agents[0]?.id ?? ''))}
              >
                Nova automação
              </button>
            </div>
          </>
        )}
        {draft && (
          <form onSubmit={(e) => void save(e)}>
            <label>
              Nome
              <input
                value={draft.name}
                maxLength={AUTOMATION_LIMITS.name}
                autoFocus
                onChange={(e) => set('name', e.target.value)}
              />
            </label>
            <div className="row">
              <label className="grow">
                Pasta
                <input value={draft.folder} onChange={(e) => set('folder', e.target.value)} />
              </label>
              <button type="button" onClick={() => void chooseFolder()}>
                Escolher…
              </button>
            </div>
            <label>
              Agente
              <select value={draft.agentId} onChange={(e) => set('agentId', e.target.value)}>
                {!agents.some((a) => a.id === draft.agentId) && draft.agentId !== '' && (
                  <option value={draft.agentId}>{agentName(draft.agentId)}</option>
                )}
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Enunciado
              <textarea
                rows={5}
                value={draft.prompt}
                maxLength={AUTOMATION_LIMITS.prompt}
                onChange={(e) => set('prompt', e.target.value)}
              />
            </label>
            <label>
              Quando
              <select
                value={draft.kind}
                onChange={(e) => set('kind', e.target.value === 'interval' ? 'interval' : 'daily')}
              >
                <option value="daily">Em um horário</option>
                <option value="interval">De tempos em tempos</option>
              </select>
            </label>
            {draft.kind === 'daily' ? (
              <>
                <label>
                  Horário
                  <input
                    type="time"
                    required
                    value={draft.time}
                    onChange={(e) => set('time', e.target.value)}
                  />
                </label>
                <fieldset className="automation-days">
                  <legend>Dias (nenhum marcado = todos)</legend>
                  {WEEKDAYS.map((label, day) => (
                    <label key={label} className="check-row">
                      <input
                        type="checkbox"
                        checked={draft.days.includes(day)}
                        onChange={(e) =>
                          set(
                            'days',
                            e.target.checked
                              ? [...draft.days, day].sort()
                              : draft.days.filter((d) => d !== day),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              </>
            ) : (
              <label>
                Intervalo em minutos
                <input
                  type="number"
                  min={AUTOMATION_LIMITS.intervalMin}
                  max={AUTOMATION_LIMITS.intervalMax}
                  value={draft.minutes}
                  onChange={(e) => set('minutes', e.target.value)}
                />
              </label>
            )}
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.isolation === 'worktree'}
                onChange={(e) => set('isolation', e.target.checked ? 'worktree' : 'direct')}
              />
              Isolar em um worktree git
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              Ligada
            </label>
            <p className="meta">
              A sessão abre com o modo de permissão padrão do agente: se ele pedir confirmação, fica esperando
              você no terminal.
            </p>
            <div className="actions">
              <button type="button" onClick={() => setDraft(null)}>
                Voltar
              </button>
              <button type="submit" className="primary" disabled={!canSave}>
                Salvar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
