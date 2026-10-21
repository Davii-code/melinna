import { LIMITS, type Group, type Task } from '../../../shared/ipc-contract';
import { InlineEdit, type TreeProps } from './Tree';
import { TreeTask } from './TreeTask';

export interface TreeGroupProps extends TreeProps {
  group: Group;
  tasks: Task[];
}

export function TreeGroup(props: TreeGroupProps) {
  const { group } = props;
  return (
    <li role="treeitem" aria-expanded="true" className="tree-group" data-testid={`tree-group-${group.id}`}>
      <div className="tree-row tree-group-row">
        <InlineEdit
          value={group.name}
          label="Nome do grupo"
          maxLength={LIMITS.groupName}
          testId={`tree-group-name-${group.id}`}
          onCommit={(name) => props.onRenameGroup(group.id, name)}
        />
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
