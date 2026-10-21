import { toSideBySide } from '../../../shared/diff-side-by-side';
import type { DiffLine, FileDiff } from '../../../shared/ipc-contract';

function Cell({ line, side }: { line: DiffLine | null; side: 'old' | 'new' }) {
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
      <td className={`diff-text diff-${line.kind}`}>{line.text}</td>
    </>
  );
}

export function SideBySideView({ file }: { file: FileDiff }) {
  return (
    <table className="diff-table diff-split" data-testid="diff-split">
      {file.hunks.map((h, i) => (
        <tbody key={i}>
          <tr className="diff-hunk">
            <td colSpan={4}>{h.header}</td>
          </tr>
          {toSideBySide(h).map((row, j) => (
            <tr key={j} className="diff-line">
              <Cell line={row.left} side="old" />
              <Cell line={row.right} side="new" />
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
