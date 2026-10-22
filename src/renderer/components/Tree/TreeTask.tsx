import { LIMITS, type Execution, type Task } from '../../../shared/ipc-contract';
import { isLiveStatus } from '../../labels';
import { AgentMenu } from './AgentMenu';
import { InlineEdit, type TreeProps } from './Tree';
import { TreeExecution } from './TreeExecution';

export interface TreeTaskProps extends TreeProps {
  task: Task;
  taskExecutions: Execution[];
}

export function TreeTask(props: TreeTaskProps) {
  const { task } = props;
  const live = props.taskExecutions.some((e) => isLiveStatus(e.status));
  return (
    <li role="treeitem" aria-expanded="true" className="tree-task" data-testid={`tree-task-${task.id}`}>
      <div className="tree-row tree-task-row" title={`${task.repoPath} @ ${task.baseRef}`}>
        <InlineEdit
          value={task.title}
          label="Título da tarefa"
          maxLength={LIMITS.taskTitle}
          testId={`tree-task-name-${task.id}`}
          onCommit={(title) => props.onRenameTask(task.id, title)}
        />
        <span className="spacer" />
        <span className="tree-actions">
          {props.onAddTerminal && (
            <AgentMenu
              label={`Novo terminal na sessão ${task.title}`}
              agents={props.launchable ?? []}
              onPick={(agentId) => props.onAddTerminal?.(task.id, agentId)}
            />
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Remover sessão ${task.title}`}
            title={live ? 'Pare a sessão para removê-la' : 'Remover sessão'}
            disabled={live}
            onClick={() => props.onRemoveTask(task.id)}
          >
            🗑
          </button>
        </span>
      </div>
      {props.taskExecutions.length > 0 && (
        <ul role="group">
          {props.taskExecutions.map((e) => (
            <TreeExecution
              key={e.id}
              execution={e}
              agent={props.agents.get(e.agentId)}
              open={props.openIds.includes(e.id)}
              tools={props.openIds.includes(e.id) ? props.execTools?.(e) : undefined}
              stopping={props.stoppingIds?.includes(e.id) ?? false}
              baseAdvancedBy={props.divergence?.get(e.id) ?? 0}
              onOpen={props.onOpen}
              onStop={props.onStop}
              onRelaunch={props.onRelaunch}
              onRemove={props.onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
