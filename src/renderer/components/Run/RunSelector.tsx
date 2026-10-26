import type { ActiveRunRef, Group, RunConfigView, RunWarning } from '../../../shared/ipc-contract';
import { ToolIcon } from './ToolIcon';
import { buildSelectorModel, unavailableNote } from './selector-model';

export { unavailableNote };

export interface RunSelectorProps {
  /** Configurações salvas; `null` até a primeira leitura. */
  configs: RunConfigView[] | null;
  warnings: readonly RunWarning[];
  groups: readonly Group[];
  active: ActiveRunRef | null;
  /** Configurações com execução viva, como `groupId:configId`. */
  runningIds: ReadonlySet<string>;
  /** Etapa de "antes de lançar" que a configuração ativa espera agora; `null` quando não espera. */
  waiting: { name: string } | null;
  onChoose: (ref: ActiveRunRef) => void;
  onEdit: () => void;
  onAddDetected: () => void;
  onCancelWaiting: () => void;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** Lista das configurações salvas por workspace e ferramenta, com as ações de editar e de criar a partir de um script. */
export function RunSelector({
  configs,
  warnings,
  groups,
  active,
  runningIds,
  waiting,
  onChoose,
  onEdit,
  onAddDetected,
  onCancelWaiting,
}: RunSelectorProps) {
  const model = configs === null ? [] : buildSelectorModel(configs, groups, warnings);
  const hasAny = (configs?.length ?? 0) > 0;
  return (
    <div className="run-selector" role="presentation">
      {waiting !== null && (
        <div className="run-waiting" data-testid="run-waiting">
          <span>{`Aguardando ${waiting.name}…`}</span>
          <button type="button" onClick={onCancelWaiting}>
            Cancelar
          </button>
        </div>
      )}
      {configs === null && <p className="run-empty">Carregando…</p>}
      {configs !== null && !hasAny && <p className="run-empty">Nenhuma configuração</p>}
      {model.length > 0 && (
        <div role="listbox" aria-label="Configurações de execução" className="run-list">
          {model.map(({ group, tools, warnings: groupWarnings }) => (
            <div key={group.id} className="run-group" data-testid={`run-group-${group.id}`}>
              <div className="run-group-name">{group.name}</div>
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className="run-folder"
                  data-testid={`run-tool-group-${group.id}-${tool.id}`}
                  data-tool-group={tool.id}
                >
                  <div className="run-folder-name">{tool.label}</div>
                  {tool.configs.map((c) => {
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
                        title={c.folder}
                        className={`run-option${selected ? ' selected' : ''}`}
                        onClick={() => {
                          if (note === null) onChoose({ groupId: c.groupId, commandId: c.id });
                        }}
                      >
                        <ToolIcon tool={c.tool} />
                        <span className="run-option-label">{c.name}</span>
                        {running && (
                          <span className="run-dot" data-testid="run-option-running" title="Rodando" />
                        )}
                        {note !== null && <span className="run-option-note">{note}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {groupWarnings.map((w) => (
                <p key={`${w.folder}|${w.message}`} className="run-warning" role="status">
                  {`${baseName(w.folder)}: ${w.message}`}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="run-selector-footer">
        <button type="button" onClick={onEdit}>
          Editar configurações…
        </button>
        <button type="button" onClick={onAddDetected}>
          Adicionar a partir de um script detectado…
        </button>
      </div>
    </div>
  );
}
