import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api';
import { buildChangeTree, leaves, toggle, type TreeNode } from '../../git/git-store';
import { useGitWorkspace } from '../../git/git-workspace';
import { useConfirm } from '../../git/use-confirm';
import { ChangeTree, type ActiveFile } from './ChangeTree';
import { CommitMessage } from './CommitMessage';
import { MergeConflicts } from './MergeConflicts';
import { isNeedsConfirm } from './git-ui';

export interface CommitPanelProps {
  /** Sessões de agente vivas no workspace ativo; podem estar escrevendo nos arquivos. */
  liveAgents: number;
  /** Abre o arquivo (caminho absoluto) no editor do app. */
  onOpenFile: (path: string) => void;
  /** Mostra o diff do arquivo na área principal. */
  onShowDiff: (root: string, path: string) => void;
  /** Arquivo com o diff aberto, para destacar na árvore. */
  activeFile?: ActiveFile | null;
}

/** Repositório com mais arquivos que isso abre recolhido. */
const COLLAPSED_ABOVE = 500;

export function agentWarning(n: number): string {
  return n === 1
    ? 'Há 1 agente rodando neste workspace; ele pode estar escrevendo nos arquivos agora.'
    : `Há ${n} agentes rodando neste workspace; eles podem estar escrevendo nos arquivos agora.`;
}

function folderIds(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'file' ? [] : [n.id, ...folderIds(n.children)]));
}

/** Painel lateral Commit: alterações do workspace ativo por repositório, merge, mensagem e commit. */
export function CommitPanel({ liveAgents, onOpenFile, onShowDiff, activeFile }: CommitPanelProps) {
  const api = useApi();
  const gw = useGitWorkspace();
  const { ask, dialog } = useConfirm();
  const tree = useMemo(() => buildChangeTree(gw.repos, gw.added), [gw.repos, gw.added]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<ActiveFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  // Nós novos abrem expandidos, exceto os de um repositório grande.
  useEffect(() => {
    const open: string[] = [];
    const walk = (node: TreeNode, big: boolean) => {
      if (node.kind === 'file') return;
      const loose = node.kind === 'group' && !node.children.some((c) => c.kind === 'repo');
      const here = big || ((node.kind === 'repo' || loose) && node.count > COLLAPSED_ABOVE);
      if (!seen.current.has(node.id)) {
        seen.current.add(node.id);
        if (node.kind === 'group' || !here) open.push(node.id);
      }
      for (const c of node.children) walk(c, here);
    };
    for (const g of tree) walk(g, false);
    if (open.length > 0) setExpanded((prev) => new Set([...prev, ...open]));
  }, [tree]);

  const toggleExpand = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  const markedFiles = useMemo(
    () =>
      gw.repos.flatMap((r) =>
        r.status.changes.filter((c) => gw.selection.get(r.root)?.has(c.path)).map((c) => ({ repo: r, change: c })),
      ),
    [gw.repos, gw.selection],
  );

  /** Não rastreados marcados que ainda estão em "Unversioned Files". */
  const markedUnversioned = useMemo(
    () =>
      markedFiles
        .filter((m) => m.change.kind === 'untracked' && !gw.added.get(m.repo.root)?.has(m.change.path))
        .map((m) => ({ root: m.repo.root, path: m.change.path })),
    [markedFiles, gw.added],
  );

  const addNode = (node: TreeNode) =>
    gw.addToVcs(
      leaves(node)
        .filter((l) => l.change?.kind === 'untracked' && !gw.added.get(l.root)?.has(l.path as string))
        .map((l) => ({ root: l.root, path: l.path as string })),
    );

  const show = (root: string, path: string) => {
    setFocused({ root, path });
    onShowDiff(root, path);
  };

  const current = activeFile ?? focused;
  const diffTarget: ActiveFile | null = current ?? (markedFiles[0] ? { root: markedFiles[0].repo.root, path: markedFiles[0].change.path } : null);

  const revert = () =>
    gw.runExclusive(async () => {
      setError(null);
      for (const repo of gw.repos) {
        const paths = markedFiles.filter((m) => m.repo.root === repo.root).map((m) => m.change.path);
        if (paths.length === 0) continue;
        const first = await api.git.discard(repo.root, paths);
        if (!first.ok) {
          setError(`${repo.name}: ${first.error.message}`);
          break;
        }
        if (!isNeedsConfirm(first.value)) continue;
        if (!(await ask(first.value))) continue;
        const second = await api.git.discard(repo.root, paths, ['discard']);
        if (!second.ok) {
          setError(`${repo.name}: ${second.error.message}`);
          break;
        }
      }
      await gw.refresh();
    });

  if (!gw.workspace) {
    return (
      <section className="commit-panel" aria-label="Commit">
        <p className="meta commit-empty">Abra um workspace</p>
      </section>
    );
  }

  const mergingRepos = gw.repos.filter((r) => r.status.state === 'merging');
  const body = !gw.loaded ? (
    <p className="meta commit-empty">Lendo as alterações…</p>
  ) : gw.repos.length === 0 ? (
    <p className="meta commit-empty">Nenhum repositório git neste workspace</p>
  ) : tree.length === 0 ? (
    <p className="meta commit-empty">Nenhuma alteração</p>
  ) : (
    <ChangeTree
      tree={tree}
      expanded={expanded}
      selection={gw.selection}
      activeFile={current}
      onToggleExpand={toggleExpand}
      onToggleCheck={(node) => gw.setSelection(toggle(node, gw.selection))}
      onShowDiff={show}
      onOpenFile={onOpenFile}
      onAddToVcs={addNode}
    />
  );

  return (
    <section className="commit-panel" aria-label="Commit">
      <div className="commit-actions" role="toolbar" aria-label="Ações do commit">
        <button type="button" className="icon-button" aria-label="Atualizar" title="Atualizar" onClick={() => void gw.refresh()}>
          ⟳
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Reverter"
          title="Reverter os arquivos marcados"
          disabled={gw.busy || markedFiles.length === 0}
          onClick={() => void revert()}
        >
          ↶
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Adicionar ao git"
          title="Adicionar ao git (Ctrl+Alt+A): leva os arquivos novos marcados para Changes"
          disabled={markedUnversioned.length === 0}
          onClick={() => gw.addToVcs(markedUnversioned)}
        >
          ＋
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Ver diff"
          title="Ver o diff do arquivo"
          disabled={diffTarget === null}
          onClick={() => diffTarget && show(diffTarget.root, diffTarget.path)}
        >
          ±
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Expandir tudo"
          title="Expandir tudo"
          onClick={() => setExpanded(new Set(folderIds(tree)))}
        >
          ⊞
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Recolher tudo"
          title="Recolher tudo"
          onClick={() => setExpanded(new Set())}
        >
          ⊟
        </button>
      </div>
      {liveAgents > 0 && (
        <p role="status" className="git-agent-warning">
          {agentWarning(liveAgents)}
        </p>
      )}
      {(error ?? gw.error) && (
        <p role="alert" className="error git-error">
          {error ?? gw.error}
        </p>
      )}
      {mergingRepos.map((r) => (
        <MergeConflicts key={r.root} repo={r} onOpenFile={onOpenFile} />
      ))}
      {body}
      {gw.loaded && gw.repos.length > 0 && <CommitMessage />}
      {dialog}
    </section>
  );
}
