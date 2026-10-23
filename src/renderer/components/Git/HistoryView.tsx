import { useCallback, useEffect, useState } from 'react';
import type { Commit, FileDiff } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { FileSection } from '../DiffView/DiffView';
import { KIND_LABEL_COMMIT } from './git-ui';

/** Tamanho da página do histórico; página cheia = pode haver mais. */
const PAGE = 200;

export interface HistoryViewProps {
  repo: string;
  title: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Histórico da branch atual: commits (200 por página), arquivos de cada um e o diff por arquivo. */
export function HistoryView({ repo, title, onClose }: HistoryViewProps) {
  const api = useApi();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [lastPage, setLastPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const loadPage = useCallback(
    async (skip: number) => {
    try {
      const page = await unwrap(api.git.log(repo, skip));
      setCommits((prev) => (skip === 0 ? page : [...prev, ...page]));
      setLastPage(page.length);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
    },
    [api, repo],
  );

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const open = (c: Commit) => {
    setSelected(c);
    setDiff(null);
    setDiffPath(null);
  };

  const showDiff = async (c: Commit, path: string) => {
    setDiffPath(path);
    setDiff(null);
    try {
      setDiff(await unwrap(api.git.commitDiff(repo, c.sha, path)));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal git-history" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header className="diff-toolbar">
          <h2 id="history-title">Histórico: {title}</h2>
          <span className="spacer" />
          <button type="button" className="icon-button" aria-label="Fechar histórico" onClick={onClose}>
            ×
          </button>
        </header>
        {error && (
          <p role="alert" className="error git-error">
            {error}
          </p>
        )}
        {!loaded && <p className="meta">Lendo o histórico…</p>}
        {loaded && commits.length === 0 && !error && <p>Nenhum commit nesta branch ainda.</p>}
        {commits.length > 0 && (
          <div className="git-body">
            <div className="git-commit-list">
              {commits.map((c) => (
                <button
                  key={c.sha}
                  type="button"
                  className={selected?.sha === c.sha ? 'git-commit active' : 'git-commit'}
                  onClick={() => open(c)}
                >
                  <strong>{c.subject}</strong>
                  <br />
                  <span className="meta">
                    {c.shortSha} · {c.author} · {formatDate(c.date)}
                  </span>
                </button>
              ))}
              {lastPage === PAGE && (
                <button type="button" onClick={() => void loadPage(commits.length)}>
                  Carregar mais
                </button>
              )}
            </div>
            <section className="git-diff" aria-label="Detalhes do commit">
              {selected === null && <p className="meta">Escolha um commit para ver os arquivos.</p>}
              {selected && (
                <>
                  <h3>{selected.subject}</h3>
                  {selected.body && <p className="git-notice">{selected.body}</p>}
                  <p className="meta">
                    {selected.author} &lt;{selected.email}&gt; · {formatDate(selected.date)}
                  </p>
                  {selected.files.length === 0 && <p className="meta">Sem arquivos alterados (merge ou commit vazio).</p>}
                  <ul>
                    {selected.files.map((f) => (
                      <li key={`${f.kind}:${f.path}`} className={diffPath === f.path ? 'git-file active' : 'git-file'}>
                        <button
                          type="button"
                          className="git-file-name"
                          aria-label={`Ver diff de ${f.path}`}
                          title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                          onClick={() => void showDiff(selected, f.path)}
                        >
                          {f.path}
                        </button>
                        <span className={`git-kind git-kind-${f.kind}`}>{KIND_LABEL_COMMIT[f.kind]}</span>
                      </li>
                    ))}
                  </ul>
                  {diffPath !== null && diff === null && !error && <p className="meta">Calculando o diff…</p>}
                  {diff && <FileSection file={diff} mode="unified" />}
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
