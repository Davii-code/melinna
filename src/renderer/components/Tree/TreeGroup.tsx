import { LIMITS, type Group, type Task } from '../../../shared/ipc-contract';
import { isLiveStatus } from '../../labels';
import { bandColor } from '../../theme/bands';
import { AgentMenu } from './AgentMenu';
import { InlineEdit, type TreeProps } from './Tree';
import { TreeTask } from './TreeTask';

export interface TreeGroupProps extends TreeProps {
  group: Group;
  tasks: Task[];
}

export function TreeGroup(props: TreeGroupProps) {
  const { group } = props;
  const taskIds = new Set(props.tasks.map((t) => t.id));
  const live = props.executions.some((e) => taskIds.has(e.taskId) && isLiveStatus(e.status));
  return (
    <li role="treeitem" aria-expanded="true" className="tree-group" data-testid={`tree-group-${group.id}`}>
      <div className="tree-row tree-group-row" title={group.repoPath}>
        {group.repoPath && (
          <span
            className="band"
            style={{ background: bandColor(group.colorIndex ?? 0) }}
            aria-hidden="true"
          />
        )}
        <InlineEdit
          value={group.name}
          label="Nome do grupo"
          maxLength={LIMITS.groupName}
          testId={`tree-group-name-${group.id}`}
          onCommit={(name) => props.onRenameGroup(group.id, name)}
        />
        <span className="spacer" />
        <span className="tree-actions">
          {props.onNewSession && group.repoPath && (
            <AgentMenu
              label={`Nova sessão em ${group.name}`}
              agents={props.launchable ?? []}
              onPick={(agentId) => props.onNewSession?.(group.id, agentId)}
            />
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Remover workspace ${group.name}`}
            title={
              live ? 'Pare as sessões para remover o workspace' : 'Tirar da lista (a pasta não é apagada)'
            }
            disabled={live}
            onClick={() => props.onRemoveGroup(group.id)}
          >
            🗑
          </button>
        </span>
      </div>
      {props.tasks.length > 0 && (
        <ul role="group">
          {props.tasks.map((t) => (
            <TreeTask
              key={t.id}
              {...props}
              task={t}
              taskExecutions={props.executions
                .filter((e) => e.taskId === t.id)
                .sort((a, b) => a.bandIndex - b.bandIndex)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
