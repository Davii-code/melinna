import { useState } from 'react';
import { useApi } from '../../api';
import type { RepoView } from '../../git/git-store';
import { useGitWorkspace } from '../../git/git-workspace';
import { useConfirm } from '../../git/use-confirm';
import { absolutePath, isNeedsConfirm } from './git-ui';

export interface MergeConflictsProps {
  repo: RepoView;
  /** Abre o arquivo (caminho absoluto) no editor do app. */
  onOpenFile: (path: string) => void;
}

/** Merge em andamento de um repositório: conflitos (abrir no editor, marcar como resolvido) e abortar. */
export function MergeConflicts({ repo, onOpenFile }: MergeConflictsProps) {
  const api = useApi();
  const { refresh, runExclusive } = useGitWorkspace();
  const { ask, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const conflicts = repo.status.changes.filter((c) => c.kind === 'conflict');

  const resolve = (path: string) =>
    runExclusive(async () => {
      const r = await api.git.markResolved(repo.root, [path]);
      setError(r.ok ? null : r.error.message);
      await refresh();
    });

  const abort = () =>
    runExclusive(async () => {
      setError(null);
      const first = await api.git.abortMerge(repo.root);
      if (!first.ok) return setError(first.error.message);
      if (isNeedsConfirm(first.value)) {
        if (!(await ask(first.value))) return;
        const second = await api.git.abortMerge(repo.root, ['abort-merge']);
        if (!second.ok) setError(second.error.message);
      }
      await refresh();
    });

  return (
    <section className="merge-conflicts" aria-label={`Conflitos de ${repo.name}`}>
      <h3>Merge em andamento</h3>
      <p className="meta">{repo.name}</p>
      {error && (
        <p role="alert" className="error git-error">
          {error}
        </p>
      )}
      {conflicts.length === 0 ? (
        <p className="meta">Nenhum conflito: conclua o merge com um commit.</p>
      ) : (
        <ul className="git-conflicts">
          {conflicts.map((c) => (
            <li key={c.path}>
              <code>{c.path}</code>
              <span className="spacer" />
              <button
                type="button"
                aria-label={`Abrir ${c.path} no editor`}
                onClick={() => onOpenFile(absolutePath(repo.root, c.path))}
              >
                Abrir no editor
              </button>
              <button type="button" aria-label={`Marcar ${c.path} como resolvido`} onClick={() => void resolve(c.path)}>
                Marcar como resolvido
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" className="danger" onClick={() => void abort()}>
          Abortar merge
        </button>
      </div>
      {dialog}
    </section>
  );
}
