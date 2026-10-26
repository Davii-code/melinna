import { useEffect } from 'react';
import type { Group, RunCommand } from '../../../shared/ipc-contract';
import { baseName } from './RunSelector';
import { ToolIcon } from './ToolIcon';

export interface DetectedPickerProps {
  detected: readonly RunCommand[];
  groups: readonly Group[];
  /** Workspace ativo; só os scripts dele aparecem. */
  groupId: string | null;
  onPick: (command: RunCommand) => void;
  onClose: () => void;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/[\/]+$/, '').toLowerCase() === b.replace(/[\/]+$/, '').toLowerCase();
}

/** Pastas do workspace na ordem em que ele as guarda. */
function foldersOf(group: Group | undefined, commands: readonly RunCommand[]): string[] {
  const folders = (group?.folders ?? []).map((f) => f.path);
  if (folders.length === 0 && group?.repoPath) folders.push(group.repoPath);
  for (const c of commands) if (!folders.some((f) => samePath(f, c.folder))) folders.push(c.folder);
  return folders;
}

/** Janela para criar uma configuração salva a partir de um script detectado no workspace ativo. */
export function DetectedPicker({ detected, groups, groupId, onPick, onClose }: DetectedPickerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const own = detected.filter((c) => c.groupId === groupId);
  const group = groups.find((g) => g.id === groupId);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal detected-picker" role="dialog" aria-modal="true" aria-label="Scripts detectados">
        <h2>Scripts detectados</h2>
        {own.length === 0 ? (
          <p className="run-empty">Nenhum script detectado neste workspace.</p>
        ) : (
          <div className="run-list">
            {foldersOf(group, own).map((folder) => {
              const inFolder = own.filter((c) => samePath(c.folder, folder));
              if (inFolder.length === 0) return null;
              return (
                <div
                  key={folder}
                  className="run-folder"
                  data-testid={`detected-folder-${baseName(folder)}`}
                  data-folder={folder}
                >
                  <div className="run-folder-name" title={folder}>
                    {baseName(folder)}
                  </div>
                  {inFolder.map((c) => (
                    <button key={c.id} type="button" className="run-option" onClick={() => onPick(c)}>
                      <ToolIcon tool={c.tool} />
                      <span className="run-option-label">{c.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
