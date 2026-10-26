import type { Change, RepoStatus } from '../../shared/ipc-contract';

/** Pasta git do workspace ativo com o último status lido. */
export interface RepoView {
  folderId: string;
  root: string;
  name: string;
  status: RepoStatus;
}

/** Arquivos marcados por raiz de repositório. */
export type Selection = ReadonlyMap<string, ReadonlySet<string>>;

export type CheckState = 'checked' | 'unchecked' | 'partial';

export type GroupKey = 'changes' | 'unversioned';

export interface TreeNode {
  id: string;
  kind: 'group' | 'repo' | 'dir' | 'file';
  label: string;
  /** Raiz do repositório; vazio nos grupos. */
  root: string;
  /** Caminho relativo (arquivo ou pasta). */
  path?: string;
  change?: Change;
  /** Quantidade de arquivos abaixo do nó. */
  count: number;
  /** Branch atual, nos nós de repositório. */
  branch?: string;
  children: TreeNode[];
}

export interface PlanItem {
  repo: RepoView;
  paths: string[];
}

export const GROUP_LABEL: Record<GroupKey, string> = { changes: 'Changes', unversioned: 'Unversioned Files' };

const MERGE_ALL = 'Durante um merge, todos os arquivos entram no commit.';
const MERGE_CONFLICTS = 'Resolva os conflitos antes de concluir o merge.';
const OUTSIDE = 'Conclua o rebase ou o cherry-pick fora do app antes de commitar.';

function branchLabel(status: RepoStatus): string {
  return status.branch ?? `HEAD solto em ${status.head.slice(0, 7)}`;
}

function byName(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.label.localeCompare(b.label);
}

function sortTree(node: TreeNode): void {
  node.children.sort(byName);
  for (const c of node.children) sortTree(c);
}

function buildRepoNode(group: GroupKey, repo: RepoView, changes: readonly Change[]): TreeNode {
  const node: TreeNode = {
    id: `repo:${group}:${repo.root}`,
    kind: 'repo',
    label: repo.name,
    root: repo.root,
    count: changes.length,
    branch: branchLabel(repo.status),
    children: [],
  };
  attachFiles(group, node, repo.root, changes);
  return node;
}

function attachFiles(group: GroupKey, parent: TreeNode, root: string, changes: readonly Change[]): void {
  const dirs = new Map<string, TreeNode>();
  const dirNode = (dir: string): TreeNode => {
    if (dir === '') return parent;
    const known = dirs.get(dir);
    if (known) return known;
    const slash = dir.lastIndexOf('/');
    const node: TreeNode = {
      id: `dir:${group}:${root}:${dir}`,
      kind: 'dir',
      label: slash < 0 ? dir : dir.slice(slash + 1),
      root,
      path: dir,
      count: 0,
      children: [],
    };
    dirs.set(dir, node);
    dirNode(slash < 0 ? '' : dir.slice(0, slash)).children.push(node);
    return node;
  };
  for (const change of changes) {
    const slash = change.path.lastIndexOf('/');
    const holder = dirNode(slash < 0 ? '' : change.path.slice(0, slash));
    holder.children.push({
      id: `file:${root}:${change.path}`,
      kind: 'file',
      label: slash < 0 ? change.path : change.path.slice(slash + 1),
      root,
      path: change.path,
      change,
      count: 1,
      children: [],
    });
  }
  for (const d of dirs.values()) d.count = countFiles(d);
}

function countFiles(node: TreeNode): number {
  return node.kind === 'file' ? 1 : node.children.reduce((n, c) => n + (c.kind === 'file' ? 1 : countFiles(c)), 0);
}

/**
 * Árvore "Changes" / "Unversioned Files" → repositório → pasta → arquivo.
 * Um repositório sem alterações só aparece em "Changes" quando o workspace tem mais de um repositório.
 * Não rastreados em `added` ("Adicionar ao git") ficam em "Changes", ainda como arquivo novo.
 */
export function buildChangeTree(repos: readonly RepoView[], added: Selection = new Map()): TreeNode[] {
  const multi = repos.length > 1;
  const inChanges = (root: string, c: Change) => c.kind !== 'untracked' || (added.get(root)?.has(c.path) ?? false);
  const tracked = repos.map((r) => ({ repo: r, list: r.status.changes.filter((c) => inChanges(r.root, c)) }));
  const loose = repos.map((r) => ({ repo: r, list: r.status.changes.filter((c) => !inChanges(r.root, c)) }));
  const out: TreeNode[] = [];

  const trackedShown = tracked.filter((t) => t.list.length > 0 || multi);
  if (trackedShown.some((t) => t.list.length > 0) || (multi && trackedShown.length > 0)) {
    const children = trackedShown.map((t) => buildRepoNode('changes', t.repo, t.list));
    out.push({
      id: 'group:changes',
      kind: 'group',
      label: GROUP_LABEL.changes,
      root: '',
      count: children.reduce((n, c) => n + c.count, 0),
      children,
    });
  }

  const looseShown = loose.filter((t) => t.list.length > 0);
  if (looseShown.length > 0) {
    const group: TreeNode = {
      id: 'group:unversioned',
      kind: 'group',
      label: GROUP_LABEL.unversioned,
      root: '',
      count: looseShown.reduce((n, t) => n + t.list.length, 0),
      children: [],
    };
    if (multi) group.children = looseShown.map((t) => buildRepoNode('unversioned', t.repo, t.list));
    else {
      const only = looseShown[0];
      if (only) attachFiles('unversioned', group, only.repo.root, only.list);
    }
    out.push(group);
  }
  for (const g of out) sortTree(g);
  return out;
}

/** Arquivos (folhas) abaixo de um nó. */
export function leaves(node: TreeNode): TreeNode[] {
  if (node.kind === 'file') return [node];
  return node.children.flatMap((c) => leaves(c));
}

/** Estado da caixa de cada nó, calculado em uma passada só. */
export function checkStates(nodes: readonly TreeNode[], selection: Selection): Map<string, CheckState> {
  const states = new Map<string, CheckState>();
  const walk = (node: TreeNode): number => {
    let on = 0;
    if (node.kind === 'file') on = selection.get(node.root)?.has(node.path as string) ? 1 : 0;
    else for (const c of node.children) on += walk(c);
    states.set(node.id, on === 0 ? 'unchecked' : on === node.count ? 'checked' : 'partial');
    return on;
  };
  for (const n of nodes) walk(n);
  return states;
}

export function checkState(node: TreeNode, selection: Selection): CheckState {
  return checkStates([node], selection).get(node.id) ?? 'unchecked';
}

/** Marca o nó (e tudo abaixo) ou, estando todo marcado, desmarca. Devolve uma seleção nova. */
export function toggle(node: TreeNode, selection: Selection): Selection {
  const turnOn = checkState(node, selection) !== 'checked';
  const next = new Map<string, Set<string>>();
  for (const [root, set] of selection) next.set(root, new Set(set));
  for (const leaf of leaves(node)) {
    let set = next.get(leaf.root);
    if (!set) {
      set = new Set();
      next.set(leaf.root, set);
    }
    if (turnOn) set.add(leaf.path as string);
    else set.delete(leaf.path as string);
  }
  return next;
}

/** Mantém em `added` só os caminhos que continuam não rastreados (o commit ou um `git add` de fora os tira). */
export function pruneAdded(added: Selection, repos: readonly RepoView[]): Map<string, ReadonlySet<string>> {
  const next = new Map<string, ReadonlySet<string>>();
  for (const repo of repos) {
    const wanted = added.get(repo.root);
    if (!wanted || wanted.size === 0) continue;
    const kept = repo.status.changes.filter((c) => c.kind === 'untracked' && wanted.has(c.path)).map((c) => c.path);
    if (kept.length > 0) next.set(repo.root, new Set(kept));
  }
  return next;
}

/** Junta arquivos (raiz e caminho) a uma seleção por repositório. Devolve uma seleção nova. */
export function addPaths(selection: Selection, files: readonly { root: string; path: string }[]): Selection {
  const next = new Map<string, Set<string>>();
  for (const [root, set] of selection) next.set(root, new Set(set));
  for (const f of files) {
    let set = next.get(f.root);
    if (!set) {
      set = new Set();
      next.set(f.root, set);
    }
    set.add(f.path);
  }
  return next;
}

/** Alterados marcados, não rastreados desmarcados; durante um merge, tudo entra. */
export function initialSelection(status: RepoStatus): Set<string> {
  const merging = status.state === 'merging';
  return new Set(status.changes.filter((c) => merging || c.kind !== 'untracked').map((c) => c.path));
}

/** Mantém as marcas dos caminhos que continuam alterados; os caminhos novos seguem a regra inicial. */
export function mergeSelection(
  prev: ReadonlySet<string> | undefined,
  previous: RepoStatus | undefined,
  status: RepoStatus,
): Set<string> {
  if (!prev || !previous) return initialSelection(status);
  const known = new Set(previous.changes.map((c) => c.path));
  const initial = initialSelection(status);
  const next = new Set<string>();
  for (const c of status.changes) {
    if (known.has(c.path) ? prev.has(c.path) : initial.has(c.path)) next.add(c.path);
  }
  return next;
}

/** Repositórios com arquivos marcados e os caminhos de cada um; recusa antes do IPC o que a 006 recusaria. */
export function planCommit(
  repos: readonly RepoView[],
  selection: Selection,
): { plan: PlanItem[]; error: string | null } {
  const plan: PlanItem[] = [];
  for (const repo of repos) {
    const marked = selection.get(repo.root);
    const paths = repo.status.changes.filter((c) => marked?.has(c.path)).map((c) => c.path);
    if (paths.length === 0) continue;
    const { state, changes } = repo.status;
    if (state === 'rebasing' || state === 'cherry-picking') return { plan: [], error: `${repo.name}: ${OUTSIDE}` };
    if (state === 'merging') {
      if (changes.some((c) => c.kind === 'conflict')) return { plan: [], error: `${repo.name}: ${MERGE_CONFLICTS}` };
      if (paths.length !== changes.length) return { plan: [], error: `${repo.name}: ${MERGE_ALL}` };
    }
    plan.push({ repo, paths });
  }
  return { plan, error: null };
}

export interface Row {
  node: TreeNode;
  depth: number;
}

/** Linhas visíveis (pais expandidos), em ordem, para a lista virtual. */
export function visibleRows(tree: readonly TreeNode[], expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (node: TreeNode, depth: number) => {
    rows.push({ node, depth });
    if (node.kind !== 'file' && expanded.has(node.id)) for (const c of node.children) walk(c, depth + 1);
  };
  for (const n of tree) walk(n, 0);
  return rows;
}
