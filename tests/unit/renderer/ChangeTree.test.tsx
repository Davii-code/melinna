import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChangeTree } from '../../../src/renderer/components/Git/ChangeTree';
import {
  buildChangeTree,
  initialSelection,
  toggle,
  type RepoView,
  type Selection,
  type TreeNode,
} from '../../../src/renderer/git/git-store';
import type { Change } from '../../../src/shared/ipc-contract';
import { repoStatus } from '../../support/fake-api';

const change = (path: string, kind: Change['kind'] = 'modified', extra: Partial<Change> = {}): Change => ({
  path,
  kind,
  indexChanged: false,
  worktreeChanged: true,
  ...extra,
});
const view = (name: string, changes: Change[], root = `/w/${name}`): RepoView => ({
  folderId: name,
  root,
  name,
  status: repoStatus({ root, changes, branch: 'main' }),
});

function allIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...allIds(n.children)]);
}

function Harness(props: {
  repos: RepoView[];
  open?: 'none' | 'all';
  onShowDiff?: (root: string, path: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const tree = buildChangeTree(props.repos);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(props.open === 'none' ? [] : allIds(tree)),
  );
  const [selection, setSelection] = useState<Selection>(
    new Map(props.repos.map((r) => [r.root, initialSelection(r.status)] as const)),
  );
  return (
    <ChangeTree
      tree={tree}
      expanded={expanded}
      selection={selection}
      activeFile={null}
      onToggleExpand={(id) =>
        setExpanded((s) => {
          const next = new Set(s);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
      onToggleCheck={(node) => setSelection((s) => toggle(node, s))}
      onShowDiff={props.onShowDiff ?? vi.fn()}
      onOpenFile={props.onOpenFile ?? vi.fn()}
    />
  );
}

const repos = [
  view('a', [change('src/x.ts'), change('src/y.ts', 'added'), change('old.txt', 'deleted'), change('n.txt', 'untracked')]),
  view('b', [change('z/r.ts', 'renamed', { oldPath: 'z/q.ts' })]),
];

describe('ChangeTree', () => {
  it('is a tree of treeitems', () => {
    render(<Harness repos={repos} />);
    const tree = screen.getByRole('tree');
    expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThan(5);
  });

  it('expands and collapses one node by clicking it', () => {
    render(<Harness repos={repos} />);
    expect(screen.queryByText('x.ts')).not.toBeNull();
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('x.ts')).toBeNull();
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('x.ts')).not.toBeNull();
  });

  it('starts collapsed when told to and exposes aria-expanded', () => {
    render(<Harness repos={repos} open="none" />);
    const group = screen.getByRole('treeitem', { name: /Changes/ });
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('a')).toBeNull();
    fireEvent.click(screen.getByText('Changes'));
    expect(screen.getByText('a')).toBeTruthy();
  });

  it('shows count and branch per repo', () => {
    render(<Harness repos={repos} />);
    expect(screen.getByText('4 files')).toBeTruthy();
    expect(screen.getAllByText('main').length).toBe(3);
  });

  it('shows indeterminate checkboxes for partially marked parents and toggles children', () => {
    render(<Harness repos={repos} />);
    const folder = screen.getByLabelText('Selecionar src') as HTMLInputElement;
    expect(folder.checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Selecionar x.ts'));
    expect((screen.getByLabelText('Selecionar x.ts') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Selecionar src') as HTMLInputElement).indeterminate).toBe(true);
    expect((screen.getAllByLabelText('Selecionar a')[0] as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(folder);
    expect((screen.getByLabelText('Selecionar x.ts') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(folder);
    expect((screen.getByLabelText('Selecionar y.ts') as HTMLInputElement).checked).toBe(false);
  });

  it('leaves unversioned files unchecked at first', () => {
    render(<Harness repos={repos} />);
    expect((screen.getByLabelText('Selecionar n.txt') as HTMLInputElement).checked).toBe(false);
  });

  it('labels the kind of change of each file', () => {
    render(<Harness repos={repos} />);
    const row = (name: string) => screen.getByLabelText(`Selecionar ${name}`).closest('[role="treeitem"]') as HTMLElement;
    expect(within(row('x.ts')).getByText('alterado')).toBeTruthy();
    expect(within(row('y.ts')).getByText('novo')).toBeTruthy();
    expect(within(row('old.txt')).getByText('removido')).toBeTruthy();
    expect(within(row('r.ts')).getByText('renomeado')).toBeTruthy();
  });

  it('clicking a file asks for its diff', () => {
    const onShowDiff = vi.fn();
    render(<Harness repos={repos} onShowDiff={onShowDiff} />);
    fireEvent.click(screen.getByText('x.ts'));
    expect(onShowDiff).toHaveBeenCalledWith('/w/a', 'src/x.ts');
  });

  it('double click opens the file with its absolute path', () => {
    const onOpenFile = vi.fn();
    render(<Harness repos={[view('a', [change('src/x.ts')]), view('w', [change('p/q.ts')], 'C:\w\w')]} onOpenFile={onOpenFile} />);
    fireEvent.doubleClick(screen.getByText('x.ts'));
    fireEvent.doubleClick(screen.getByText('q.ts'));
    expect(onOpenFile).toHaveBeenNthCalledWith(1, '/w/a/src/x.ts');
    expect(onOpenFile).toHaveBeenNthCalledWith(2, 'C:\w\w\p\q.ts');
  });

  it('does nothing on double click of a removed file, with a hint', () => {
    const onOpenFile = vi.fn();
    render(<Harness repos={repos} onOpenFile={onOpenFile} />);
    const row = screen.getByLabelText('Selecionar old.txt').closest('[role="treeitem"]') as HTMLElement;
    expect(row.getAttribute('title')).toContain('arquivo removido');
    fireEvent.doubleClick(screen.getByText('old.txt'));
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('renders only the visible rows with 5000 files', () => {
    const many = Array.from({ length: 5000 }, (_, i) => change(`f${String(i).padStart(4, '0')}.ts`));
    render(<Harness repos={[view('big', many)]} />);
    const rendered = screen.getAllByRole('treeitem').length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(120);
  });
});
