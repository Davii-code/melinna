import { useState, type FormEvent } from 'react';
import type { DiffLine } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { NOT_SENT } from '../Prompts/UsePromptDialog';
import { buildLineComment, COMMENT_MAX, lineRef } from './line-comment';

export function CommentButton({ line, onClick }: { line: DiffLine; onClick: () => void }) {
  return (
    <button type="button" className="diff-comment-button" aria-label={`Comentar ${lineRef(line)}`} onClick={onClick}>
      +
    </button>
  );
}

export interface LineCommentRowProps {
  execId: string;
  path: string;
  line: DiffLine;
  colSpan: number;
  onClose: () => void;
}

/** Linha extra da tabela do diff com o formulário que envia o comentário ao agente da execução. */
export function LineCommentRow({ execId, path, line, colSpan, onClose }: LineCommentRowProps) {
  const api = useApi();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || text.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const results = await unwrap(
        api.prompts.send({ ...buildLineComment(path, line, text), execIds: [execId] }),
      );
      const status = results[0]?.status ?? 'not-found';
      if (status === 'sent') setSent(true);
      else setError(NOT_SENT[status]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="diff-comment-row">
      <td colSpan={colSpan}>
        {sent ? (
          <div className="diff-comment">
            <p role="status">Comentário enviado ao agente.</p>
            <button type="button" onClick={onClose}>
              Fechar
            </button>
          </div>
        ) : (
          <form className="diff-comment" onSubmit={(e) => void submit(e)}>
            <textarea
              aria-label={`Comentário sobre ${lineRef(line)}`}
              value={text}
              maxLength={COMMENT_MAX}
              rows={3}
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
            {error && <p className="error">{error}</p>}
            <div className="diff-comment-actions">
              <button type="submit" disabled={busy || text.trim() === ''}>
                Enviar ao agente
              </button>
              <button type="button" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </form>
        )}
      </td>
    </tr>
  );
}
