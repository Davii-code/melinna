import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api';
import { planCommit, type PlanItem } from '../../git/git-store';
import { useGitWorkspace } from '../../git/git-workspace';
import { commitAll, commitAndPush, type StepResult } from '../../git/sequence';
import { useConfirm } from '../../git/use-confirm';

const HINT_MESSAGE = 'Escreva a mensagem';
const HINT_FILES = 'Marque ao menos um arquivo';

function commitLine(r: StepResult): string {
  if (r.outcome === 'ok') return `${r.name}: commitado${r.sha ? ` (${r.sha.slice(0, 7)})` : ''}`;
  if (r.outcome === 'skipped') return `${r.name}: não commitado`;
  return `${r.name}: falhou: ${r.message ?? 'erro desconhecido'}`;
}

function pushLine(r: StepResult): string {
  if (r.outcome === 'ok') return `${r.name}: push enviado`;
  if (r.outcome === 'skipped') return `${r.name}: push não enviado`;
  return `${r.name}: push falhou: ${r.message ?? 'erro desconhecido'}`;
}

/** Amend, mensagem, "Commit" e "Commit and Push…" para os repositórios com arquivos marcados. */
export function CommitMessage() {
  const api = useApi();
  const gw = useGitWorkspace();
  const { ask, dialog } = useConfirm();
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [amendRepo, setAmendRepo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const edited = useRef(false);

  const { repos, selection } = gw;
  const markedRepos = useMemo(
    () => repos.filter((r) => r.status.changes.some((c) => selection.get(r.root)?.has(c.path))),
    [repos, selection],
  );
  const merging = repos.find((r) => r.status.state === 'merging' && r.status.mergeMessage);
  const suggested = merging?.status.mergeMessage ?? null;

  // A mensagem do merge é sugerida enquanto o usuário não escreveu a dele.
  const lastSuggested = useRef<string | null>(null);
  useEffect(() => {
    if (!suggested) {
      lastSuggested.current = null;
      return;
    }
    if (suggested !== lastSuggested.current && !edited.current && message === '') {
      lastSuggested.current = suggested;
      setMessage(suggested);
    }
  }, [suggested, message]);

  const amendTarget: string | null =
    markedRepos.length > 0 ? null : repos.length === 1 ? (repos[0]?.root ?? null) : amendRepo || null;
  const needsAmendRepo = amend && markedRepos.length === 0 && repos.length > 1;
  const hasWork = markedRepos.length > 0 || (amend && amendTarget !== null);
  const disabledHint = message.trim() === '' ? HINT_MESSAGE : !hasWork ? HINT_FILES : undefined;
  // Uma operação de rede em um dos repositórios marcados segura o commit; os outros seguem livres.
  const netBusy = markedRepos.some((r) => gw.ops.has(r.root));
  const canCommit = !gw.busy && !netBusy && disabledHint === undefined;

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (!on || message.trim() !== '') return;
    const root = markedRepos[0]?.root ?? (repos.length === 1 ? repos[0]?.root : amendRepo);
    if (!root) return;
    const r = await api.git.log(root, 0);
    const last = r.ok ? r.value[0] : undefined;
    if (last) setMessage(last.body ? `${last.subject}\n\n${last.body}` : last.subject);
  };

  const run = async (thenPush: boolean) => {
    setError(null);
    setLines([]);
    const planned = planCommit(markedRepos, selection);
    if (planned.error) return setError(planned.error);
    let plan: PlanItem[] = planned.plan;
    if (plan.length === 0 && amend && amendTarget) {
      const repo = repos.find((r) => r.root === amendTarget);
      plan = repo ? [{ repo, paths: [] }] : [];
    }
    if (plan.length === 0) return setError(HINT_FILES);
    await gw.runExclusive(async () => {
      if (thenPush) {
        const r = await commitAndPush(api.git, plan, message, amend, ask, gw.waitOp);
        setLines([...r.commits.results.map(commitLine), ...r.pushes.map(pushLine)]);
        if (!r.commits.failed && r.commits.results.some((x) => x.outcome === 'ok')) reset();
      } else {
        const r = await commitAll(api.git, plan, message, amend, ask);
        setLines(r.results.map(commitLine));
        if (!r.failed && r.results.some((x) => x.outcome === 'ok')) reset();
      }
      await gw.refresh();
    });
  };

  const reset = () => {
    edited.current = false;
    setMessage('');
    setAmend(false);
    setAmendRepo('');
  };

  return (
    <div className="commit-message">
      <label className="git-amend">
        <input
          type="checkbox"
          aria-label="Amend"
          checked={amend}
          onChange={(e) => void toggleAmend(e.target.checked)}
        />
        <span>Amend</span>
      </label>
      {needsAmendRepo && (
        <select aria-label="Repositório do amend" value={amendRepo} onChange={(e) => setAmendRepo(e.target.value)}>
          <option value="">Escolha o repositório…</option>
          {repos.map((r) => (
            <option key={r.root} value={r.root}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        aria-label="Mensagem do commit"
        rows={4}
        placeholder="Mensagem do commit"
        value={message}
        onChange={(e) => {
          edited.current = true;
          setMessage(e.target.value);
        }}
      />
      {error && (
        <p role="alert" className="error git-error">
          {error}
        </p>
      )}
      {lines.length > 0 && (
        <ul role="status" className="commit-results">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" disabled={!canCommit} title={disabledHint} onClick={() => void run(false)}>
          Commit
        </button>
        <button type="button" className="primary" disabled={!canCommit} title={disabledHint} onClick={() => void run(true)}>
          Commit and Push…
        </button>
      </div>
      {dialog}
    </div>
  );
}
