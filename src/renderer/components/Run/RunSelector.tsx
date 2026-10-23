import type { ActiveRunRef, Group, RunCatalog, RunCommand } from '../../../shared/ipc-contract';
import { ToolIcon } from './ToolIcon';

export interface RunSelectorProps {
  /** `null` até a primeira leitura. */
  catalog: RunCatalog | null;
  groups: readonly Group[];
  active: ActiveRunRef | null;
  /** Configurações com execução viva, como `groupId:commandId`. */
  runningIds: ReadonlySet<string>;
  onChoose: (ref: ActiveRunRef) => void;
  onEdit: () => void;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
}

/** Pastas de um workspace na ordem em que ele as guarda, mais as que só aparecem nas configurações. */
function foldersOf(group: Group, commands: readonly RunCommand[]): string[] {
  const folders = (group.folders ?? []).map((f) => f.path);
  if (folders.length === 0 && group.repoPath) folders.push(group.repoPath);
  for (const c of commands) if (!folders.some((f) => samePath(f, c.folder))) folders.push(c.folder);
  return folders;
}

export function unavailableNote(c: RunCommand): string | null {
  if (c.unavailableReason === 'folder-outside') return 'pasta fora do workspace';
  if (!c.available) return `não encontrado: ${c.searched}`;
  return null;
}

/** Lista de configurações por workspace e pasta; as personalizadas vêm antes das detectadas (ordem do catálogo). */
export function RunSelector({ catalog, groups, active, runningIds, onChoose, onEdit }: RunSelectorProps) {
  const ordered = [...groups].sort((a, b) => a.order - b.order);
  const hasAny = (catalog?.commands.length ?? 0) > 0;
  return (
    <div className="run-selector" role="presentation">
      {catalog === null && <p className="run-empty">Carregando…</p>}
      {catalog !== null && !hasAny && <p className="run-empty">Nenhuma configuração</p>}
      {catalog !== null && hasAny && (
        <div role="listbox" aria-label="Configurações de execução" className="run-list">
          {ordered.map((group) => {
            const commands = catalog.commands.filter((c) => c.groupId === group.id);
            const warnings = catalog.warnings.filter((w) => w.groupId === group.id);
            if (commands.length === 0 && warnings.length === 0) return null;
            return (
              <div key={group.id} className="run-group" data-testid={`run-group-${group.id}`}>
                <div className="run-group-name">{group.name}</div>
                {foldersOf(group, commands).map((folder) => {
                  const inFolder = commands.filter((c) => samePath(c.folder, folder));
                  const folderWarnings = warnings.filter((w) => samePath(w.folder, folder));
                  if (inFolder.length === 0 && folderWarnings.length === 0) return null;
                  return (
                    <div
                      key={folder}
                      className="run-folder"
                      data-testid={`run-folder-${group.id}-${baseName(folder)}`}
                      data-folder={folder}
                    >
                      <div className="run-folder-name" title={folder}>
                        {baseName(folder)}
                      </div>
                      {inFolder.map((c) => {
                        const selected = active?.groupId === c.groupId && active.commandId === c.id;
                        const note = unavailableNote(c);
                        const running = runningIds.has(`${c.groupId}:${c.id}`);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-disabled={note !== null}
                            className={`run-option${selected ? ' selected' : ''}`}
                            onClick={() => {
                              if (note === null) onChoose({ groupId: c.groupId, commandId: c.id });
                            }}
                          >
                            <ToolIcon tool={c.tool} />
                            <span className="run-option-label">{c.label}</span>
                            {running && (
                              <span className="run-dot" data-testid="run-option-running" title="Rodando" />
                            )}
                            {note !== null && <span className="run-option-note">{note}</span>}
                          </button>
                        );
                      })}
                      {folderWarnings.map((w) => (
                        <p key={w.message} className="run-warning" role="status">
                          {`${baseName(w.folder)}: ${w.message}`}
                        </p>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <div className="run-selector-footer">
        <button type="button" onClick={onEdit}>
          Editar configurações
        </button>
      </div>
    </div>
  );
}
