import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentDefinition, Execution, Group, Task } from '../../../shared/ipc-contract';
import { TreeGroup } from './TreeGroup';

export interface TreeActions {
  onOpen: (execId: string) => void;
  onStop: (execId: string) => void;
  onRelaunch: (execId: string) => void;
  onRemove: (execId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  /** Remover a sessão (tarefa) inteira; só com as execuções dela paradas. */
  onRemoveTask: (taskId: string) => void;
  /** Tirar o workspace (ou grupo) da lista; só com as execuções dele paradas. */
  onRemoveGroup: (groupId: string) => void;
}

export interface TreeProps extends TreeActions {
  groups: readonly Group[];
  tasks: readonly Task[];
  executions: readonly Execution[];
  agents: ReadonlyMap<string, AgentDefinition>;
  openIds: readonly string[];
  /** Commits que a base avançou, por execução (selo de divergência). */
  divergence?: ReadonlyMap<string, number>;
  /** Botões extras da execução com painel aberto (diff, fechar painel). */
  execTools?: (execution: Execution) => ReactNode;
  /** Execuções com parada em curso. */
  stoppingIds?: readonly string[];
  /** IAs instaladas, oferecidas pelo "+" da sessão e do workspace. */
  launchable?: readonly AgentDefinition[];
  /** Mais um terminal na sessão, com a IA escolhida. */
  onAddTerminal?: (taskId: string, agentId: string) => void;
  /** Nova sessão no workspace, com a IA escolhida. */
  onNewSession?: (groupId: string, agentId: string) => void;
}

/** Árvore de três níveis: grupos (pela ordem), tarefas (pela criação) e execuções (pela faixa). */
export function Tree(props: TreeProps) {
  const groups = [...props.groups].sort((a, b) => a.order - b.order);
  if (groups.length === 0) {
    return (
      <nav className="tree tree-empty" aria-label="Tarefas">
        <p>Nenhuma tarefa ainda. Abra uma pasta como workspace (＋) ou use "Nova tarefa".</p>
      </nav>
    );
  }
  return (
    <nav className="tree" aria-label="Tarefas">
      <ul role="tree">
        {groups.map((g) => (
          <TreeGroup
            key={g.id}
            {...props}
            group={g}
            tasks={props.tasks
              .filter((t) => t.groupId === g.id)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))}
          />
        ))}
      </ul>
    </nav>
  );
}

export interface InlineEditProps {
  value: string;
  label: string;
  maxLength: number;
  testId: string;
  onCommit: (value: string) => void;
}

/** Texto que vira campo de edição com duplo clique: Enter ou perda de foco confirma, Esc cancela. */
export function InlineEdit({ value, label, maxLength, testId, onCommit }: InlineEditProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <span
        className="tree-name"
        data-testid={testId}
        title="Duplo clique para renomear"
        onDoubleClick={() => setDraft(value)}
      >
        {value}
      </span>
    );
  }
  const finish = (commit: boolean) => {
    const next = draft.trim();
    setDraft(null);
    if (commit && next.length > 0 && next !== value) onCommit(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  return (
    <input
      className="tree-rename"
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => finish(true)}
    />
  );
}
