import { useEffect, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '../../../shared/ipc-contract';
import { isLiveStatus } from '../../labels';
import {
  configOf,
  executionOfCommand,
  liveExecutionsOf,
  runningKeys,
  stepsOf,
  useRun,
  type RunState,
  type RunStore,
} from '../../store/run-store';
import { useShortcutLabel, withShortcut } from '../../keymap/keymap-store';
import { DetectedPicker } from './DetectedPicker';
import { RunConfigsDialog } from './RunConfigsDialog';
import { RunSelector, baseName, unavailableNote } from './RunSelector';
import { ToolIcon } from './ToolIcon';

export interface RunBarProps {
  store: RunStore;
  snapshot: WorkspaceSnapshot | null;
  /** Workspace ativo da janela: origem dos scripts detectados oferecidos em "Adicionar a partir de…". */
  activeGroupId?: string | null;
}

const NONE = 'Nenhuma configuração ativa';

/** Ferramenta do sistema que substitui o wrapper do projeto (`mvnw` → `mvn`). */
function systemToolOf(wrapper: string): string {
  return baseName(wrapper).toLowerCase().startsWith('gradlew') ? 'gradle' : 'mvn';
}

/**
 * A etapa de "antes de lançar" que o lançamento em andamento espera: a que está viva ou, se nenhuma ainda
 * subiu, a primeira da cadeia. `null` quando não há lançamento esperando etapas.
 */
function waitingStep(
  busy: boolean,
  configs: RunState['configs'],
  config: ReturnType<typeof configOf>,
  snapshot: WorkspaceSnapshot | null,
): { name: string } | null {
  if (!busy || !config || config.beforeLaunch === null) return null;
  const inOrder = stepsOf(configs, config).reverse();
  const live = inOrder.find((s) => liveExecutionsOf(snapshot, config.groupId, s.id).length > 0);
  const step = live ?? inOrder[0];
  return step ? { name: step.name } : null;
}

/** Barra de execução: seletor da configuração ativa, ▶ Rodar e o menu com rodar de novo, parar e editar. */
export function RunBar({ store, snapshot, activeGroupId = null }: RunBarProps) {
  const state = useRun(store);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const config = configOf(state.configs, state.active);
  const exec = executionOfCommand(snapshot, state.active);
  const running = exec !== undefined && isLiveStatus(exec.status);
  const note = config ? unavailableNote(config) : null;
  const canRun = config !== undefined && note === null && !state.busy;
  const waiting = waitingStep(state.busy, state.configs, config, snapshot);
  const runShortcut = useShortcutLabel('runActive');
  const stopShortcut = useShortcutLabel('stop');
  const playTitle = !config
    ? 'Escolha uma configuração'
    : (note ?? withShortcut(`Rodar ${config.name}`, runShortcut));
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
        aria-label={`Configuração de execução: ${config?.name ?? NONE}`}
        aria-haspopup="listbox"
        aria-expanded={selectorOpen}
        title="Escolher a configuração de execução"
        onClick={openSelector}
      >
        {config && <ToolIcon tool={config.tool} />}
        <span className="run-name">{config?.name ?? NONE}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {running && <span className="run-dot" data-testid="run-running" title="Rodando" />}
      {waiting !== null && (
        <span className="run-waiting-inline" data-testid="run-waiting-bar">
          {`Aguardando ${waiting.name}…`}
          <button type="button" onClick={() => void store.cancelBeforeLaunch()}>
            Cancelar
          </button>
        </span>
      )}
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
            configs={state.configs}
            warnings={state.warnings}
            waiting={waiting}
            groups={groups}
            active={state.active}
            runningIds={runningKeys(snapshot)}
            onChoose={(ref) => {
              setSelectorOpen(false);
              void store.choose(ref);
            }}
            onEdit={openConfig}
            onAddDetected={() => {
              setSelectorOpen(false);
              setPickerOpen(true);
            }}
            onCancelWaiting={() => void store.cancelBeforeLaunch()}
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
        <RunConfigsDialog
          store={store}
          groups={groups}
          initialSelection={state.active}
          onClose={() => setConfigOpen(false)}
        />
      )}
      {pickerOpen && (
        <DetectedPicker
          detected={state.detected}
          groups={groups}
          groupId={activeGroupId ?? state.active?.groupId ?? groups[0]?.id ?? null}
          onPick={(command) => {
            setPickerOpen(false);
            void store.addFromDetected(command);
          }}
          onClose={() => setPickerOpen(false)}
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
