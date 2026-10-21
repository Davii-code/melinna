import { LIMITS, type Execution, type Task } from '../../../shared/ipc-contract';
import { isLiveStatus } from '../../labels';
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
