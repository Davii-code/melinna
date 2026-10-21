import type { DiffLine, FileDiff } from '../../../shared/ipc-contract';

const SIGN: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-' };

export function UnifiedView({ file }: { file: FileDiff }) {
  return (
    <table className="diff-table diff-unified" data-testid="diff-unified">
      {file.hunks.map((h, i) => (
        <tbody key={i}>
          <tr className="diff-hunk">
            <td colSpan={4}>{h.header}</td>
          </tr>
          {h.lines.map((l, j) => (
            <tr key={j} className={`diff-line diff-${l.kind}`}>
              <td className="diff-no">{l.oldNo ?? ''}</td>
              <td className="diff-no">{l.newNo ?? ''}</td>
              <td className="diff-sign">{SIGN[l.kind]}</td>
              <td className="diff-text">{l.text}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
