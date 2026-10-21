import { useState } from 'react';
import type { Execution, Group, Task } from '../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../api';
import { ConfirmDialog } from './ConfirmDialog';

export type RemoveTarget = { kind: 'task'; task: Task } | { kind: 'workspace'; group: Group };

export interface RemoveFromListDialogProps {
  target: RemoveTarget;
  tasks: readonly Task[];
  executions: readonly Execution[];
  onDone: () => void;
  onCancel: () => void;
}

/** Tarefas antigas (sem `isolation`) rodavam em worktree do app, que sai junto. */
function usesWorktree(task: Task): boolean {
  return task.isolation !== 'direct';
}

/**
 * Confirma a remoção de uma sessão ou de um workspace da lista. A pasta do usuário nunca é apagada;
 * saem o registro, o histórico do terminal e, nas sessões antigas, o worktree do app (a branch fica).
 */
export function RemoveFromListDialog({
  target,
  tasks,
  executions,
  onDone,
  onCancel,
}: RemoveFromListDialogProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const affected =
    target.kind === 'task' ? [target.task] : tasks.filter((t) => t.groupId === target.group.id);
  const ids = new Set(affected.map((t) => t.id));
  const execCount = executions.filter((e) => ids.has(e.taskId)).length;
  const worktrees = executions.filter(
    (e) => e.branch !== '' && affected.some((t) => t.id === e.taskId && usesWorktree(t)),
  ).length;
  const folder = target.kind === 'task' ? target.task.repoPath : target.group.repoPath;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        target.kind === 'task'
          ? api.tasks.remove(target.task.id)
          : api.tasks.removeWorkspace(target.group.id),
      );
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const title =
    target.kind === 'task' ? `Remover sessão ${target.task.title}` : `Remover workspace ${target.group.name}`;
  return (
    <ConfirmDialog
      title={title}
      confirmLabel="Remover"
      danger
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => void confirm()}
    >
      {target.kind === 'workspace' && (
        <p>
          {affected.length} {affected.length === 1 ? 'sessão sai' : 'sessões saem'} junto com o workspace.
        </p>
      )}
      {execCount > 0 && (
        <p>O histórico de {execCount === 1 ? '1 terminal' : `${execCount} terminais`} será apagado.</p>
      )}
      {worktrees > 0 && (
        <p>
          {worktrees === 1
            ? '1 worktree antigo será apagado'
            : `${worktrees} worktrees antigos serão apagados`}
          , com o que não foi commitado nele; as branches ficam.
        </p>
      )}
      {folder && (
        <p className="meta">
          A pasta <code>{folder}</code> não é apagada.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
