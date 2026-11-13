import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgentDefinition, ChatEventEnvelope } from '../../../shared/ipc-contract';
import { CHAT_LIMITS } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';

export interface ChatFolder {
  path: string;
  name: string;
}

export interface ChatDialogProps {
  /** Pastas dos workspaces abertos. */
  folders: ChatFolder[];
  /** Agente instalado com modo de chat; `undefined` se não há nenhum. */
  agent: AgentDefinition | undefined;
  onClose: () => void;
}

type EntryBody =
  | { kind: 'user' | 'agent' | 'error'; text: string }
  | { kind: 'tool'; name: string; summary: string };
type Entry = EntryBody & { id: number };

/**
 * Conversa com o agente sem terminal: cada mensagem roda o agente na pasta escolhida e a resposta chega em
 * texto e em avisos de uso de ferramenta. A conversa vale enquanto a janela está aberta.
 */
export function ChatDialog({ folders, agent, onClose }: ChatDialogProps) {
  const api = useApi();
  const modes = (agent?.permission?.options ?? []).filter((o) => !o.dangerous);
  const [folder, setFolder] = useState(folders[0]?.path ?? '');
  const [permission, setPermission] = useState(() => {
    const preferred = agent?.permission?.default;
    return modes.some((m) => m.id === preferred) ? (preferred ?? '') : (modes[0]?.id ?? '');
  });
  const [chatId, setChatId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const push = (entry: EntryBody) => setEntries((list) => [...list, { ...entry, id: ++seq.current }]);

  useEffect(
    () =>
      api.chat.onEvent((event: ChatEventEnvelope) => {
        if (event.chatId !== current.current) return;
        if (event.kind === 'text') push({ kind: 'agent', text: event.text });
        if (event.kind === 'tool') push({ kind: 'tool', name: event.name, summary: event.summary });
        if (event.kind === 'done') {
          setWaiting(false);
          if (!event.ok) push({ kind: 'error', text: event.error ?? 'O agente terminou com erro.' });
        }
      }),
    [api],
  );

  useEffect(
    () => () => {
      if (current.current) void api.chat.close(current.current);
    },
    [api],
  );

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [entries]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (message === '' || waiting || !agent) return;
    setError(null);
    setWaiting(true);
    try {
      let id = current.current;
      if (!id) {
        const started = await unwrap(api.chat.start({ folder, ...(permission ? { permission } : {}) }));
        id = started.chatId;
        current.current = id;
        setChatId(id);
      }
      await unwrap(api.chat.send(id, message));
      push({ kind: 'user', text: message });
      setText('');
    } catch (err) {
      setWaiting(false);
      setError(errorMessage(err));
    }
  };

  const restart = () => {
    if (current.current) void api.chat.close(current.current);
    current.current = null;
    setChatId(null);
    setEntries([]);
    setWaiting(false);
    setError(null);
  };

  const mode = modes.find((m) => m.id === permission);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal chat-modal" role="dialog" aria-modal="true" aria-labelledby="chat-title">
        <header className="chat-header">
          <h2 id="chat-title">Chat{agent ? ` com ${agent.displayName}` : ''}</h2>
          <span className="spacer" />
          <button type="button" disabled={chatId === null} onClick={restart}>
            Nova conversa
          </button>
          <button type="button" className="icon-button" aria-label="Fechar chat" onClick={onClose}>
            ×
          </button>
        </header>
        {!agent && <p className="warning">Nenhum agente instalado tem modo de chat. Instale o Claude Code.</p>}
        {agent && folders.length === 0 && (
          <p className="warning">Abra um workspace primeiro: o chat trabalha na pasta de um workspace.</p>
        )}
        <div className="row">
          <label className="grow">
            Pasta
            <select value={folder} disabled={chatId !== null} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name} ({f.path})
                </option>
              ))}
            </select>
          </label>
          {modes.length > 0 && (
            <label>
              Modo de permissão
              <select value={permission} disabled={chatId !== null} onChange={(e) => setPermission(e.target.value)}>
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="meta">
          No chat o agente não tem como pedir confirmação: no modo {mode?.label ?? 'padrão'}, o que exigiria
          aprovação é negado. A conversa não fica salva no app.
        </p>
        <div className="chat-log" role="log" aria-label="Conversa">
          {entries.map((entry) =>
            entry.kind === 'tool' ? (
              <p key={entry.id} className="chat-tool">
                {entry.name}
                {entry.summary ? `: ${entry.summary}` : ''}
              </p>
            ) : (
              <p key={entry.id} className={`chat-message chat-${entry.kind}`}>
                {entry.text}
              </p>
            ),
          )}
          {waiting && (
            <p className="meta" role="status">
              O agente está respondendo…
            </p>
          )}
          <div ref={end} />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <form className="chat-input" onSubmit={(e) => void send(e)}>
          <textarea
            aria-label="Mensagem"
            rows={3}
            value={text}
            maxLength={CHAT_LIMITS.message}
            placeholder="Escreva a mensagem (Ctrl+Enter envia)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(e);
            }}
          />
          <div className="actions">
            {waiting && chatId ? (
              <button type="button" onClick={() => void api.chat.stop(chatId)}>
                Parar
              </button>
            ) : null}
            <button
              type="submit"
              className="primary"
              disabled={waiting || !agent || folder === '' || text.trim() === ''}
            >
              Enviar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
