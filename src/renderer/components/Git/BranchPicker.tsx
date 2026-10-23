import { useCallback, useEffect, useState } from 'react';
import type { Branch, Confirm, NeedsConfirm, Result } from '../../../shared/ipc-contract';
import { errorMessage, unwrap, useApi } from '../../api';
import { ConfirmGitDialog } from './ConfirmGitDialog';
import { isNeedsConfirm } from './git-ui';

export const BRANCH_RULE =
  'Nome de branch inválido: sem espaços, sem os caracteres ~ ^ : ? * [ e contrabarra, sem ".." nem "@{", sem começar com "-" e sem terminar com ".lock" ou "/".';

/** Confere só o que dá para ver sem o git; a decisão final é sempre do `git check-ref-format`. */
export function isPlausibleBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name) &&
    !name.startsWith('-') &&
    !name.includes('..') &&
    !name.includes('@{') &&
    !name.endsWith('/') &&
    !name.endsWith('.') &&
    !name.endsWith('.lock')
  );
}

export interface BranchPickerProps {
  repo: string;
  onClose: () => void;
  /** O merge terminou com conflitos: quem abriu mostra a lista deles. */
  onConflicts: (files: string[]) => void;
}

type Action =
  | { kind: 'checkout'; branch: string; confirm: Confirm[] }
  | { kind: 'merge'; branch: string; confirm: Confirm[] };

/** Lista, troca, cria e mescla branches; trocar ou mesclar com pendências pede confirmação. */
export function BranchPicker({ repo, onClose, onConflicts }: BranchPickerProps) {
  const api = useApi();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ action: Action; request: NeedsConfirm } | null>(null);

  const load = useCallback(async () => {
    try {
      setBranches(await unwrap(api.git.branches(repo)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  const run = async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      const withConfirm = action.confirm.length > 0;
      if (action.kind === 'checkout') {
        const r: Result<void | NeedsConfirm> = await (withConfirm
          ? api.git.checkout(repo, action.branch, action.confirm)
          : api.git.checkout(repo, action.branch));
        if (!r.ok) return setError(r.error.message);
        if (isNeedsConfirm(r.value)) return setPending({ action, request: r.value });
        onClose();
        return;
      }
      const r = await (withConfirm
        ? api.git.merge(repo, action.branch, action.confirm)
        : api.git.merge(repo, action.branch));
      if (!r.ok) return setError(r.error.message);
      if (isNeedsConfirm(r.value)) return setPending({ action, request: r.value });
      if (r.value.conflicts.length > 0) onConflicts(r.value.conflicts);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const wanted = name.trim();
    if (!isPlausibleBranchName(wanted)) return setError(BRANCH_RULE);
    setBusy(true);
    setError(null);
    try {
      const r = await api.git.createBranch(repo, wanted);
      if (!r.ok) return setError(r.error.message);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = () => {
    const current = pending;
    if (!current) return;
    setPending(null);
    void run({ ...current.action, confirm: [...current.action.confirm, current.request.needsConfirm] });
  };

  const locals = (branches ?? []).filter((b) => b.kind === 'local');
  const remotes = (branches ?? []).filter((b) => b.kind === 'remote');

  const row = (b: Branch) => (
    <li key={`${b.kind}:${b.name}`} data-testid={`branch-${b.name}`} className="git-file">
      <span className="git-file-name" title={b.upstream ? `acompanha ${b.upstream}` : undefined}>
        {b.name}
        {b.current ? ' · atual' : ''}
      </span>
      {!b.current && (
        <>
          <button
            type="button"
            aria-label={`Trocar para ${b.name}`}
            disabled={busy}
            onClick={() => void run({ kind: 'checkout', branch: b.name, confirm: [] })}
          >
            Trocar
          </button>
          <button
            type="button"
            aria-label={`Mesclar ${b.name} na atual`}
            disabled={busy}
            onClick={() => void run({ kind: 'merge', branch: b.name, confirm: [] })}
          >
            Mesclar
          </button>
        </>
      )}
    </li>
  );

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="branches-title">
        <header className="diff-toolbar">
          <h2 id="branches-title">Branches</h2>
          <span className="spacer" />
          <button type="button" className="icon-button" aria-label="Fechar branches" onClick={onClose}>
            ×
          </button>
        </header>
        {error && (
          <p role="alert" className="error git-error">
            {error}
          </p>
        )}
        {branches === null && !error && <p className="meta">Lendo as branches…</p>}
        {branches && (
          <div className="git-files">
            <h3>Locais</h3>
            <ul>{locals.map(row)}</ul>
            {remotes.length > 0 && (
              <>
                <h3>Remotas</h3>
                <ul>{remotes.map(row)}</ul>
              </>
            )}
          </div>
        )}
        <div className="git-message">
          <label>
            Nome da nova branch
            <input
              type="text"
              value={name}
              placeholder="feature/minha-ideia"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
          </label>
          <p className="meta">Criada a partir da branch atual, que passa a ser a nova.</p>
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Fechar
          </button>
          <button type="button" className="primary" disabled={busy || name.trim().length === 0} onClick={() => void create()}>
            Criar branch
          </button>
        </div>
      </div>
      {pending && (
        <ConfirmGitDialog request={pending.request} busy={busy} onConfirm={confirmPending} onCancel={() => setPending(null)} />
      )}
    </div>
  );
}
