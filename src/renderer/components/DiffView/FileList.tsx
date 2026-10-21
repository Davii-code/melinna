import type { FileDiff } from '../../../shared/ipc-contract';

export const CHANGE_LABEL: Record<FileDiff['change'], string> = {
  added: 'adicionado',
  modified: 'modificado',
  deleted: 'apagado',
  renamed: 'renomeado',
  untracked: 'não rastreado',
};

export function fileTitle(f: FileDiff): string {
  return f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
}

export function fileAnchor(path: string): string {
  return `diff-${encodeURIComponent(path)}`;
}

export function FileList({ files }: { files: readonly FileDiff[] }) {
  return (
    <ul className="diff-file-list" aria-label="Arquivos alterados">
      {files.map((f) => (
        <li key={f.path}>
          <a href={`#${fileAnchor(f.path)}`}>{fileTitle(f)}</a>
          <span className={`diff-change diff-change-${f.change}`}>{CHANGE_LABEL[f.change]}</span>
        </li>
      ))}
    </ul>
  );
}
