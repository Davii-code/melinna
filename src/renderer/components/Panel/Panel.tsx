import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentDefinition, Execution, ImageCheck } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { TerminalView, type TerminalHandle } from '../TerminalView';
import { ImagePreview } from './ImagePreview';
import { isSearchShortcut, TerminalSearch } from './TerminalSearch';

export const NO_IMAGES_NOTICE = 'Este agente não recebe imagens.';
const MAX_DROPPED_FILES = 20;

export interface PanelProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  banner?: ReactNode;
  overlay?: ReactNode;
  onTerminalReady?: (h: TerminalHandle | null) => void;
}

function carriesFiles(e: DragEvent<HTMLElement>): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Painel de uma execução: só o terminal, sem cabeçalho. Agente, estado, modelo, modo e fechar ficam na
 * linha da execução na árvore. Imagens chegam por Ctrl+V, por arquivos soltos no painel ou pelo botão de
 * anexar; todas passam pela mesma prévia antes de a referência ir para o prompt.
 */
export function Panel(p: PanelProps) {
  const api = useApi();
  const handle = useRef<TerminalHandle | null>(null);
  const [searching, setSearching] = useState(false);
  const [check, setCheck] = useState<ImageCheck | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const execId = p.execution.id;
  const supportsImages = p.agent?.images !== undefined;
  const live = p.execution.status === 'running' || p.execution.status === 'idle';

  // Ctrl+Shift+F abre a busca do painel; a captura impede que o atalho chegue ao PTY.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (!isSearchShortcut(e) || !handle.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSearching(true);
  };

  /** Mostra a prévia (ou o aviso de erro) do resultado de uma das origens de imagem. */
  const attempt = async (action: () => Promise<ImageCheck | null>) => {
    setNotice(null);
    try {
      const result = await action();
      if (result && result.accepted.length + result.rejected.length > 0) setCheck(result);
    } catch (err) {
      setNotice(errorMessage(err));
    }
  };

  const pasteImage = () =>
    attempt(async () => {
      if (!supportsImages) {
        setNotice(NO_IMAGES_NOTICE);
        return null;
      }
      const image = await unwrap(api.attachments.pasteImage(execId));
      return { accepted: [image], rejected: [] };
    });

  const dropFiles = (files: File[]) =>
    attempt(async () => {
      if (!supportsImages) {
        setNotice(NO_IMAGES_NOTICE);
        return null;
      }
      const paths = files.map((file) => api.files.pathOf(file)).filter((path) => path.length > 0);
      if (paths.length === 0) return null;
      if (paths.length > MAX_DROPPED_FILES) {
        setNotice(`Envie até ${MAX_DROPPED_FILES} imagens por vez.`);
        return null;
      }
      return unwrap(api.attachments.checkFiles(execId, paths));
    });

  const pickImages = () => attempt(() => unwrap(api.attachments.pickImages(execId)));

  const closePreview = useCallback((message?: string) => {
    setCheck(null);
    if (message) setNotice(message);
    else handle.current?.term.focus();
  }, []);

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (carriesFiles(e)) e.preventDefault();
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!carriesFiles(e)) return;
    // sem isto o Electron abriria o arquivo solto na própria janela
    e.preventDefault();
    void dropFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className={`panel${p.focused ? ' focused' : ''}`}
      data-testid={`panel-${p.execution.id}`}
      onMouseDown={p.onFocus}
      onFocus={p.onFocus}
      onKeyDownCapture={onKeyDownCapture}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label={`Painel ${p.execution.command?.label ?? p.agent?.displayName ?? p.execution.agentId}`}
    >
      {p.banner}
      {notice && (
        <div className="panel-banner warning" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dispensar aviso"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      <div className="panel-body">
        <TerminalView
          execId={p.execution.id}
          visible={p.visible}
          onReady={(h) => {
            handle.current = h;
            p.onTerminalReady?.(h);
          }}
          onPasteImage={() => void pasteImage()}
        />
        {supportsImages && (
          <button
            type="button"
            className="panel-attach icon-button"
            aria-label="Anexar imagem"
            title="Anexar imagem (ou cole com Ctrl+V, ou solte arquivos aqui)"
            disabled={!live}
            onClick={() => void pickImages()}
          >
            📎
          </button>
        )}
        {searching && handle.current && (
          <TerminalSearch terminal={handle.current.term} onClose={() => setSearching(false)} />
        )}
        {p.overlay}
      </div>
      {check && <ImagePreview execution={p.execution} check={check} onClose={closePreview} />}
    </section>
  );
}
