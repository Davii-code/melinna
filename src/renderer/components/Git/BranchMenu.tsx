import { useCallback, useEffect, useRef, useState } from 'react';
import type { Branch, Confirm, NeedsConfirm, Result } from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import type { RepoView } from '../../git/git-store';
import { useGitWorkspace } from '../../git/git-workspace';
import { useConfirm } from '../../git/use-confirm';
import { HistoryView } from './HistoryView';
import { AllNetworkItems, NetworkProgress, RepoNetworkItems, useNetworkActions } from './NetworkActions';
import { BRANCH_RULE, branchLabel, isNeedsConfirm, isPlausibleBranchName, stateNote } from './git-ui';

export interface BranchMenuProps {
  /** Um merge terminou com conflitos neste repositório: quem monta abre o painel Commit. */
  onConflicts: (root: string) => void;
}

const MAX_LABEL = 28;

function abbreviate(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

function Arrows({ repo }: { repo: RepoView }) {
  const { upstream, ahead, behind } = repo.status;
  if (upstream === null || ahead === null || behind === null) return null;
  return (
    <span className="branch-counts">
      <span title="Commits para enviar">↑{ahead}</span>
      <span title="Commits para receber">↓{behind}</span>
    </span>
  );
}

/** Ícone de branch desenhado no projeto (a fonte da interface não tem o glifo ⎇). */
function BranchIcon() {
  return (
    <svg className="branch-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.75" />
      <circle cx="4.5" cy="12.5" r="1.75" />
      <circle cx="11.5" cy="5.5" r="1.75" />
      <path d="M4.5 5.25v5.5M11.5 7.25c0 2.5-2.5 2.75-6 3.75" />
    </svg>
  );
}

/** Troca e mescla só valem fora de merge, rebase e cherry-pick. */
function changesBranch(repo: RepoView): boolean {
  return repo.status.state === 'normal' || repo.status.state === 'detached';
}

function RepoSection(props: {
  repo: RepoView;
  single: boolean;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  creating: boolean;
  onCreating: (on: boolean) => void;
  onCreate: (name: string) => void;
  onCheckout: (branch: string) => void;
  onMerge: (branch: string) => void;
  onHistory: () => void;
  onPick: () => void;
  net: ReturnType<typeof useNetworkActions>;
  branches: Branch[] | null;
}) {
  const { repo, open } = props;
  const [name, setName] = useState('');
  const note = stateNote(repo.status);
  const movable = changesBranch(repo) && !props.busy;
  const locals = (props.branches ?? []).filter((b) => b.kind === 'local');
  const remotes = (props.branches ?? []).filter((b) => b.kind === 'remote');

  const row = (b: Branch) => (
    <li key={`${b.kind}:${b.name}`} data-testid={`branch-${b.name}`} className="menu-branch">
      <span className="menu-branch-name" title={b.upstream ? `acompanha ${b.upstream}` : undefined}>
        {b.name}
        {b.current ? ' · atual' : ''}
      </span>
      {!b.current && (
        <>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            aria-label={`Trocar para ${b.name}`}
            disabled={!movable}
            onClick={() => props.onCheckout(b.name)}
          >
            Trocar
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            aria-label={`Mesclar ${b.name} na atual`}
            disabled={!movable || repo.status.branch === null}
            onClick={() => props.onMerge(b.name)}
          >
            Mesclar
          </button>
        </>
      )}
    </li>
  );

  return (
    <div role="group" aria-label={repo.name} className="menu-repo">
      <button
        type="button"
        className="menu-repo-header"
        aria-label={`Repositório ${repo.name}`}
        aria-expanded={open}
        disabled={props.single}
        onClick={props.onToggle}
      >
        <strong>{repo.name}</strong> <span className="change-branch">{branchLabel(repo.status)}</span> <Arrows repo={repo} />
      </button>
      {note && <p className="git-state">{note}</p>}
      {open && (
        <div className="menu-repo-body">
          {props.creating ? (
            <div className="menu-new-branch">
              <input
                type="text"
                aria-label="Nome da nova branch"
                value={name}
                placeholder="feature/minha-ideia"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.onCreate(name);
                }}
              />
              <button type="button" className="primary" disabled={props.busy} onClick={() => props.onCreate(name)}>
                Criar branch
              </button>
              <button type="button" onClick={() => props.onCreating(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={!movable}
              title="Criada a partir da branch atual, que passa a ser a nova"
              onClick={() => props.onCreating(true)}
            >
              Nova branch…
            </button>
          )}
          <RepoNetworkItems repo={repo} net={props.net} onPick={props.onPick} />
          <button type="button" role="menuitem" className="menu-item" onClick={props.onHistory}>
            Histórico
          </button>
          {props.branches === null ? (
            <p className="meta">Lendo as branches…</p>
          ) : (
            <>
              <h4>Locais</h4>
              <ul>{locals.map(row)}</ul>
              {remotes.length > 0 && (
                <>
                  <h4>Remotas</h4>
                  <ul>{remotes.map(row)}</ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Action = { kind: 'checkout' | 'merge'; repo: RepoView; branch: string };

/** Seletor de branch da barra superior: branches, trocar, mesclar, fetch, pull, push e histórico por repositório. */
export function BranchMenu({ onConflicts }: BranchMenuProps) {
  const api = useApi();
  const gw = useGitWorkspace();
  const { ask, dialog } = useConfirm();
  const { repos, workspace } = gw;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [branches, setBranches] = useState<Record<string, Branch[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string[]>([]);
  const [history, setHistory] = useState<RepoView | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const net = useNetworkActions({ onConflicts, onReport: setReport, onError: setError });

  const primary = repos.find((r) => r.folderId === workspace?.primaryFolderId) ?? repos[0];
  const single = repos.length === 1;
  const openRoot = single ? (repos[0]?.root ?? null) : (expanded ?? primary?.root ?? null);

  const loadBranches = useCallback(
    async (repoRoot: string) => {
      const r = await api.git.branches(repoRoot);
      if (r.ok) setBranches((prev) => ({ ...prev, [repoRoot]: r.value }));
      else setError(r.error.message);
    },
    [api],
  );

  useEffect(() => {
    if (open && openRoot) void loadBranches(openRoot);
  }, [open, openRoot, loadBranches]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const run = async (action: Action, confirm: Confirm[] = []) => {
    setBusy(true);
    setError(null);
    setReport([]);
    try {
      const { repo, branch } = action;
      const withConfirm = confirm.length > 0;
      if (action.kind === 'checkout') {
        const r: Result<void | NeedsConfirm> = await (withConfirm
          ? api.git.checkout(repo.root, branch, confirm)
          : api.git.checkout(repo.root, branch));
        if (!r.ok) return setError(r.error.message);
        if (isNeedsConfirm(r.value)) {
          if (await ask(r.value)) await run(action, [...confirm, r.value.needsConfirm]);
          return;
        }
      } else {
        const r = await (withConfirm
          ? api.git.merge(repo.root, branch, confirm)
          : api.git.merge(repo.root, branch));
        if (!r.ok) return setError(r.error.message);
        if (isNeedsConfirm(r.value)) {
          if (await ask(r.value)) await run(action, [...confirm, r.value.needsConfirm]);
          return;
        }
        if (r.value.conflicts.length > 0) onConflicts(repo.root);
      }
      setOpen(false);
      await gw.refresh();
    } finally {
      setBusy(false);
    }
  };

  const create = async (repo: RepoView, raw: string) => {
    const wanted = raw.trim();
    if (!isPlausibleBranchName(wanted)) return setError(BRANCH_RULE);
    setBusy(true);
    setError(null);
    try {
      const r = await api.git.createBranch(repo.root, wanted);
      if (!r.ok) return setError(r.error.message);
      setCreating(null);
      setOpen(false);
      await gw.refresh();
    } finally {
      setBusy(false);
    }
  };

  const button = (() => {
    if (!primary) {
      return (
        <button type="button" className="branch-button" disabled aria-label="Sem git" title="Nenhuma pasta do workspace é um repositório git">
          <BranchIcon />
          <span>Sem git</span>
        </button>
      );
    }
    const full = branchLabel(primary.status);
    return (
      <button
        type="button"
        className="branch-button"
        aria-label={`Branch ${full}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${full}${repos.length > 1 ? ` — mais ${repos.length - 1} repositório(s)` : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <BranchIcon />
        <span className="branch-name">{abbreviate(full)}</span>
        <Arrows repo={primary} />
        {repos.length > 1 && <span className="branch-more">+{repos.length - 1}</span>}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
    );
  })();

  return (
    <div className="branch-menu" ref={root}>
      {button}
      <NetworkProgress repos={repos} />
      {open && primary && (
        <div role="menu" className="branch-popup" aria-label="Branches e git">
          {repos.length > 1 && <AllNetworkItems repos={repos} net={net} onPick={() => setOpen(false)} />}
          {repos.map((repo) => (
            <RepoSection
              key={repo.root}
              repo={repo}
              single={single}
              open={single || repo.root === openRoot}
              onToggle={() => setExpanded(repo.root === openRoot ? '' : repo.root)}
              busy={busy || gw.busy}
              creating={creating === repo.root}
              onCreating={(on) => setCreating(on ? repo.root : null)}
              onCreate={(name) => void create(repo, name)}
              onCheckout={(branch) => void run({ kind: 'checkout', repo, branch })}
              onMerge={(branch) => void run({ kind: 'merge', repo, branch })}
              onHistory={() => {
                setOpen(false);
                setHistory(repo);
              }}
              onPick={() => setOpen(false)}
              net={net}
              branches={branches[repo.root] ?? null}
            />
          ))}
        </div>
      )}
      {report.length > 0 && (
        <ul role="status" className="commit-results branch-report">
          {report.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="error git-error branch-error">
          {error}
        </p>
      )}
      {history && <HistoryView repo={history.root} title={history.name} onClose={() => setHistory(null)} />}
      {net.dialog}
      {dialog}
    </div>
  );
}
