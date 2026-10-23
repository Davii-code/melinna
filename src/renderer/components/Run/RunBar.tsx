import { useEffect, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '../../../shared/ipc-contract';
import { isLiveStatus } from '../../labels';
import { commandOf, executionOfCommand, runningKeys, useRun, type RunStore } from '../../store/run-store';
import { useShortcutLabel, withShortcut } from '../../keymap/keymap-store';
import { RunConfigDialog } from './RunConfigDialog';
import { RunSelector, baseName, unavailableNote } from './RunSelector';
import { ToolIcon } from './ToolIcon';

export interface RunBarProps {
  store: RunStore;
  snapshot: WorkspaceSnapshot | null;
}

const NONE = 'Nenhuma configuração ativa';

/** Ferramenta do sistema que substitui o wrapper do projeto (`mvnw` → `mvn`). */
function systemToolOf(wrapper: string): string {
  return baseName(wrapper).toLowerCase().startsWith('gradlew') ? 'gradle' : 'mvn';
}

/** Barra de execução: seletor da configuração ativa, ▶ Rodar e o menu com rodar de novo, parar e editar. */
export function RunBar({ store, snapshot }: RunBarProps) {
  const state = useRun(store);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectorOpen && !menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setSelectorOpen(false);
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectorOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [selectorOpen, menuOpen]);

  const command = commandOf(state.catalog, state.active);
  const exec = executionOfCommand(snapshot, state.active);
  const running = exec !== undefined && isLiveStatus(exec.status);
  const note = command ? unavailableNote(command) : null;
  const canRun = command !== undefined && note === null && !state.busy;
  const runShortcut = useShortcutLabel('runActive');
  const stopShortcut = useShortcutLabel('stop');
  const playTitle = !command
    ? 'Escolha uma configuração'
    : (note ?? withShortcut(`Rodar ${command.label}`, runShortcut));
  const groups = snapshot?.groups ?? [];

  const openSelector = () => {
    setMenuOpen(false);
    if (!selectorOpen) void store.refresh();
    setSelectorOpen((v) => !v);
  };
  const openConfig = () => {
    setSelectorOpen(false);
    setMenuOpen(false);
    void store.refresh();
    setConfigOpen(true);
  };

  return (
    <div className="run-bar" ref={root} role="group" aria-label="Execução">
      <button
        type="button"
        className="run-selector-button"
        aria-label={`Configuração de execução: ${command?.label ?? NONE}`}
        aria-haspopup="listbox"
        aria-expanded={selectorOpen}
        title="Escolher a configuração de execução"
        onClick={openSelector}
      >
        {command && <ToolIcon tool={command.tool} />}
        <span className="run-name">{command?.label ?? NONE}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {running && <span className="run-dot" data-testid="run-running" title="Rodando" />}
      <button
        type="button"
        className="icon-button run-play"
        aria-label="Rodar"
        title={playTitle}
        disabled={!canRun}
        onClick={() => void store.run()}
      >
        ▶
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Mais ações de execução"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          setSelectorOpen(false);
          setMenuOpen((v) => !v);
        }}
      >
        ⋮
      </button>
      {selectorOpen && (
        <div className="run-popup">
          <RunSelector
            catalog={state.catalog}
            groups={groups}
            active={state.active}
            runningIds={runningKeys(snapshot)}
            onChoose={(ref) => {
              setSelectorOpen(false);
              void store.choose(ref);
            }}
            onEdit={openConfig}
          />
        </div>
      )}
      {menuOpen && (
        <ul className="agent-menu-list run-menu" role="menu" aria-label="Ações de execução">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              disabled={!running}
              onClick={() => {
                setMenuOpen(false);
                void store.rerun();
              }}
            >
              Rodar de novo
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              title={withShortcut('Parar', stopShortcut)}
              disabled={!running}
              onClick={() => {
                setMenuOpen(false);
                void store.stop();
              }}
            >
              Parar
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={openConfig}>
              Editar configurações
            </button>
          </li>
        </ul>
      )}
      {configOpen && (
        <RunConfigDialog
          catalog={state.catalog}
          groups={groups}
          initialSelection={state.active}
          onChanged={() => void store.refresh()}
          onClose={() => setConfigOpen(false)}
        />
      )}
      {state.confirm && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal run-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-label="Wrapper sem permissão de execução"
          >
            <h2>Wrapper sem permissão de execução</h2>
            <div className="confirm">
              <p>
                O arquivo <code>{state.confirm.wrapper}</code> não tem permissão de execução. Rodar com{' '}
                <code>sh</code>, ou usar a ferramenta instalada no sistema?
              </p>
              <div className="actions">
                <button type="button" onClick={() => void store.answerConfirm(null)}>
                  Cancelar
                </button>
                <button type="button" onClick={() => void store.answerConfirm('system-tool')}>
                  {`Usar ${systemToolOf(state.confirm.wrapper)} do sistema`}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void store.answerConfirm('wrapper-sh')}
                >
                  Rodar com sh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
