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

/** Tooltip do workspace: as pastas, com a principal marcada; um grupo de uma pasta mostra só o caminho. */
export function folderTooltip(group: Group): string | undefined {
  const folders = group.folders ?? [];
  if (folders.length <= 1) return group.repoPath;
  return folders
    .map((f) => (f.id === group.primaryFolderId ? `${f.path} (principal)` : f.path))
    .join('\n');
}

/** Pastas do workspace que podem ter git: a lista do workspace ou, em estado antigo, só o caminho do repositório. */
export function gitFolders(group: Group, availability?: Readonly<Record<string, boolean>>): { id: string; path: string }[] {
  const folders = group.folders ?? (group.repoPath ? [{ id: `${group.id}-0`, path: group.repoPath }] : []);
  return folders.filter((f) => availability?.[f.id] !== false);
}

export function TreeGroup(props: TreeGroupProps) {
  const { group } = props;
  const taskIds = new Set(props.tasks.map((t) => t.id));
  const liveCount = props.executions.filter((e) => taskIds.has(e.taskId) && isLiveStatus(e.status)).length;
  const live = liveCount > 0;
  return (
    <li role="treeitem" aria-expanded="true" className="tree-group" data-testid={`tree-group-${group.id}`}>
      <div className="tree-row tree-group-row" title={folderTooltip(group)}>
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
          {props.onEditGroup && group.repoPath && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Editar workspace ${group.name}`}
              title="Editar nome e pastas do workspace"
              onClick={() => props.onEditGroup?.(group.id)}
            >
              ✎
            </button>
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
