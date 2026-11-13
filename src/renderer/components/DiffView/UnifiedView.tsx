import { Fragment, useState } from 'react';
import type { DiffLine, FileDiff } from '../../../shared/ipc-contract';
import { CommentButton, LineCommentRow } from './LineComment';

const SIGN: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-' };

export interface DiffTableProps {
  file: FileDiff;
  /** Execução que recebe os comentários por linha; sem ela o diff é só leitura. */
  commentExecId?: string;
}

export function UnifiedView({ file, commentExecId }: DiffTableProps) {
  const [commenting, setCommenting] = useState<string | null>(null);
  return (
    <table className="diff-table diff-unified" data-testid="diff-unified">
      {file.hunks.map((h, i) => (
        <tbody key={i}>
          <tr className="diff-hunk">
            <td colSpan={4}>{h.header}</td>
          </tr>
          {h.lines.map((l, j) => {
            const key = `${i}:${j}`;
            return (
              <Fragment key={j}>
                <tr className={`diff-line diff-${l.kind}`}>
                  <td className="diff-no">{l.oldNo ?? ''}</td>
                  <td className="diff-no">{l.newNo ?? ''}</td>
                  <td className="diff-sign">{SIGN[l.kind]}</td>
                  <td className="diff-text">
                    {l.text}
                    {commentExecId && <CommentButton line={l} onClick={() => setCommenting(key)} />}
                  </td>
                </tr>
                {commentExecId && commenting === key && (
                  <LineCommentRow
                    execId={commentExecId}
                    path={file.path}
                    line={l}
                    colSpan={4}
                    onClose={() => setCommenting(null)}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}
