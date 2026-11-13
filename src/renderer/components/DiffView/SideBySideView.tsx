import { Fragment, useState } from 'react';
import { toSideBySide } from '../../../shared/diff-side-by-side';
import type { DiffLine } from '../../../shared/ipc-contract';
import { CommentButton, LineCommentRow } from './LineComment';
import type { DiffTableProps } from './UnifiedView';

type Side = 'old' | 'new';

function Cell({ line, side, onComment }: { line: DiffLine | null; side: Side; onComment?: () => void }) {
  if (!line) {
    return (
      <>
        <td className="diff-no" />
        <td className="diff-text diff-empty" />
      </>
    );
  }
  const no = side === 'old' ? line.oldNo : line.newNo;
  return (
    <>
      <td className="diff-no">{no ?? ''}</td>
      <td className={`diff-text diff-${line.kind}`}>
        {line.text}
        {onComment && <CommentButton line={line} onClick={onComment} />}
      </td>
    </>
  );
}

export function SideBySideView({ file, commentExecId }: DiffTableProps) {
  const [commenting, setCommenting] = useState<string | null>(null);
  return (
    <table className="diff-table diff-split" data-testid="diff-split">
      {file.hunks.map((h, i) => (
        <tbody key={i}>
          <tr className="diff-hunk">
            <td colSpan={4}>{h.header}</td>
          </tr>
          {toSideBySide(h).map((row, j) => {
            const key = (side: Side) => `${i}:${j}:${side}`;
            const open: Side | null =
              commenting === key('old') ? 'old' : commenting === key('new') ? 'new' : null;
            const target = open === 'old' ? row.left : open === 'new' ? row.right : null;
            return (
              <Fragment key={j}>
                <tr className="diff-line">
                  <Cell
                    line={row.left}
                    side="old"
                    onComment={commentExecId ? () => setCommenting(key('old')) : undefined}
                  />
                  <Cell
                    line={row.right}
                    side="new"
                    onComment={commentExecId ? () => setCommenting(key('new')) : undefined}
                  />
                </tr>
                {commentExecId && target && (
                  <LineCommentRow
                    execId={commentExecId}
                    path={file.path}
                    line={target}
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
