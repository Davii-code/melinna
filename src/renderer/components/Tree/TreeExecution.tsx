import { useState, type ReactNode } from 'react';
import type { AgentDefinition, Execution, ExecutionNotice, QueueItem } from '../../../shared/ipc-contract';
import { isLiveStatus, modelLabel, statusLabel } from '../../labels';
import { bandColor, bandLabel } from '../../theme/bands';
import { DivergenceBadge } from '../DivergenceBadge';

export interface TreeExecutionProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
  open: boolean;
  baseAdvancedBy: number;
  /** Parada pedida e ainda em curso (Ctrl+C e, após o prazo, encerramento forçado). */
  stopping?: boolean;
  /** Botões extras da execução com painel aberto (diff, fechar painel), antes dos demais. */
  tools?: ReactNode;
  onOpen: (execId: string) => void;
  onStop: (execId: string) => void;
  onRelaunch: (execId: string) => void;
  onRemove: (execId: string) => void;
  /** Anexar imagem a esta execução; o clipe só aparece se ela está viva e o agente recebe imagens. */
  onAttachImage?: (execId: string) => void;
  /** Prompts na fila desta execução, na ordem de envio. */
  queue?: readonly QueueItem[];
  /** Itens da fila descartados e ainda não dispensados. */
  discarded?: number;
  onRemoveQueueItem?: (execId: string, itemId: string) => void;
  onClearQueue?: (execId: string) => void;
  onDismissDiscarded?: (execId: string) => void;
}

const QUEUE_TEXT_MAX = 60;

function shortText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > QUEUE_TEXT_MAX ? `${flat.slice(0, QUEUE_TEXT_MAX - 1)}…` : flat;
}

/** Selo do aviso de lançamento sobre as pastas extras do workspace. */
export function noticeBadge(notice: ExecutionNotice): { label: string; hint: string } {
  if (notice.kind === 'extra-dirs-unsupported') {
    return {
      label: 'só a principal',
      hint: 'Este agente não recebe as outras pastas do workspace: ele enxerga só a pasta principal.',
    };
  }
  const label = notice.count === 1 ? '1 pasta indisponível' : `${notice.count} pastas indisponíveis`;
  return { label, hint: 'Pastas do workspace que não estavam acessíveis ficaram de fora deste terminal.' };
}

export function TreeExecution(p: TreeExecutionProps) {
  const [queueOpen, setQueueOpen] = useState(false);
  const e = p.execution;
  const queue = p.queue ?? [];
  const discarded = p.discarded ?? 0;
  const command = e.command;
  const name = command?.label ?? p.agent?.displayName ?? e.agentId;
  const color = bandColor(e.bandIndex);
  const number = bandLabel(e.bandIndex);
  const model = modelLabel(p.agent, e.model);
  const live = isLiveStatus(e.status);
  const canStop = live && e.status !== 'preparing' && !p.stopping;
  return (
    <li
      role="treeitem"
      className="tree-exec"
      data-testid={`tree-exec-${e.id}`}
      aria-current={p.open ? 'true' : undefined}
    >
      {/* Clicar na linha (fora dos botões) abre ou foca o painel, como o botão ▣. */}
      <div
        className="tree-row tree-exec-row"
        title={p.open ? 'Focar o painel' : 'Abrir o painel'}
        onClick={(ev) => {
          if (!(ev.target as HTMLElement).closest('button')) p.onOpen(e.id);
        }}
      >
        <span className="band" style={{ background: color }} aria-hidden="true" />
        {number && (
          <span className="band-number" style={{ color }} data-testid="band-number">
            {number}
          </span>
        )}
        {command && (
          <span
            className="run-tool"
            data-testid={`tree-exec-command-icon-${e.id}`}
            title="Comando de projeto"
            aria-hidden="true"
          >
            ▸
          </span>
        )}
        <span className="agent-name">{name}</span>
        {model && <span className="meta">{model}</span>}
        <span className={`status status-${e.status}`} data-testid={`tree-exec-status-${e.id}`}>
          {p.stopping && live ? 'parando…' : statusLabel(e)}
        </span>
        <DivergenceBadge count={p.baseAdvancedBy} />
        {queue.length > 0 && (
          <button
            type="button"
            className="queue-badge"
            aria-label={`Ver fila de ${name}`}
            aria-expanded={queueOpen}
            title="Prompts que esperam esta sessão ficar ociosa"
            onClick={() => setQueueOpen((v) => !v)}
          >
            {`${queue.length} na fila`}
          </button>
        )}
        {(e.notices ?? []).map((notice) => {
          const { label, hint } = noticeBadge(notice);
          return (
            <span
              key={notice.kind}
              className="notice-badge"
              title={hint}
              data-testid={`tree-exec-notice-${e.id}`}
            >
              {label}
            </span>
          );
        })}
        <span className="spacer" />
        <span className="tree-actions">
          {p.tools}
          {p.onAttachImage && p.agent?.images && (e.status === 'running' || e.status === 'idle') && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Anexar imagem a ${name}`}
              title="Anexar imagem"
              onClick={() => p.onAttachImage?.(e.id)}
            >
              📎
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={p.open ? `Focar ${name}` : `Abrir ${name}`}
            title={p.open ? 'Focar o painel' : 'Abrir o painel'}
            onClick={() => p.onOpen(e.id)}
          >
            ▣
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Parar ${name}`}
            title={command ? 'Parar o comando' : 'Parar o processo (o worktree fica)'}
            disabled={!canStop}
            onClick={() => p.onStop(e.id)}
          >
            ■
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Relançar ${name}`}
            title={command ? 'Rodar o comando de novo' : 'Relançar no mesmo lugar'}
            disabled={live}
            onClick={() => p.onRelaunch(e.id)}
          >
            ↻
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remover ${name}`}
            title="Remover execução"
            disabled={live}
            onClick={() => p.onRemove(e.id)}
          >
            🗑
          </button>
        </span>
      </div>
      {queueOpen && queue.length > 0 && (
        <div className="queue-menu">
          <ol aria-label={`Fila de ${name}`}>
            {queue.map((item) => (
              <li key={item.id}>
                <span className="queue-text" title={item.text}>
                  {shortText(item.text)}
                </span>
                {p.onRemoveQueueItem && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remover da fila: ${shortText(item.text)}`}
                    title="Tirar da fila sem enviar"
                    onClick={() => p.onRemoveQueueItem?.(e.id, item.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ol>
          {p.onClearQueue && (
            <button type="button" onClick={() => p.onClearQueue?.(e.id)}>
              Limpar fila
            </button>
          )}
        </div>
      )}
      {discarded > 0 && (
        <div className="queue-discarded" role="status">
          <span>
            {discarded === 1 ? '1 item descartado da fila' : `${discarded} itens descartados da fila`}
          </span>
          {p.onDismissDiscarded && (
            <button
              type="button"
              className="icon-button"
              aria-label="Dispensar aviso da fila"
              onClick={() => p.onDismissDiscarded?.(e.id)}
            >
              ×
            </button>
          )}
        </div>
      )}
    </li>
  );
}
