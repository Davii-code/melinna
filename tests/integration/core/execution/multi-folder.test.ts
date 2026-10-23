import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Execution } from '../../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../../support/execution-harness';
import { collector, enc, sleep } from '../../../support/host-harness';
import { removeDirRecursive } from '../../../support/temp-dirs';

const SIZE = { cols: 100, rows: 30 };

let h: CoreHarness;
let root: string;
let main: string;
let extraA: string;
let extraB: string;

beforeEach(async () => {
  h = await createCoreHarness();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'melinna-multi-')));
  main = join(root, 'principal');
  extraA = join(root, 'extra a com espaço');
  extraB = join(root, 'extra-b');
  for (const dir of [main, extraA, extraB]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'arquivo.txt'), 'oi\n');
  }
});

afterEach(async () => {
  await h.cleanup();
  removeDirRecursive(root);
});

function exec(id: string): Execution {
  const e = h.model.execution(id);
  if (!e) throw new Error(`sem execução ${id}`);
  return e;
}

async function waitStatus(id: string, statuses: string[], timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!statuses.includes(exec(id).status)) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`status ${exec(id).status}, esperado ${statuses.join('|')}`);
    await sleep(25);
  }
}

async function launchIn(taskId: string, agentId: string): Promise<Execution> {
  const [r] = await h.executions.launch(taskId, [{ agentId }], SIZE);
  if (!r?.ok) throw new Error(`falha ao lançar: ${r?.ok === false ? r.error.message : 'sem resultado'}`);
  await waitStatus(r.execId, ['running', 'idle']);
  return exec(r.execId);
}

async function argvAndCwd(e: Execution): Promise<{ argv: string[]; cwd: string }> {
  const col = collector();
  await h.executions.attach(e.id, col.sink);
  await col.waitFor('pronto');
  h.executions.write(e.id, enc('/argv\r'));
  await col.waitFor('argv=');
  h.executions.write(e.id, enc('/cwd\r'));
  await col.waitFor('cwd=');
  const text = col.text();
  const argv = /argv=(\[.*\])/.exec(text)?.[1];
  const cwd = /cwd=([^\r\n]+)/.exec(text)?.[1];
  if (!argv || !cwd) throw new Error(`sem argv/cwd na saída: ${text}`);
  return { argv: JSON.parse(argv) as string[], cwd };
}

describe('workspace com várias pastas', () => {
  it('runs in the primary folder and passes each extra as its own --add-dir', async () => {
    const ws = await h.workspace.createWorkspace('Multi', [main, extraA, extraB]);
    const task = await h.workspace.createTask({
      groupId: ws.id,
      repoPath: main,
      baseRef: 'HEAD',
      prompt: '',
      isolation: 'direct',
    });
    expect(task.repoPath).toBe(main);
    expect(task.extraDirs).toEqual([extraA, extraB]);
    const e = await launchIn(task.id, 'fake');
    const { argv, cwd } = await argvAndCwd(e);
    expect(realpathSync(cwd)).toBe(realpathSync(main));
    const at = argv.indexOf('--add-dir');
    expect(argv.slice(at, at + 4)).toEqual(['--add-dir', extraA, '--add-dir', extraB]);
    expect(e.notices).toBeUndefined();
    expect(h.log.records.find((r) => r.event === 'execution.extra_dirs')?.fields).toEqual({
      execId: e.id,
      applied: 2,
      omitted: 0,
    });
  });

  it('relaunches with the folders saved in the task even after the workspace changes', async () => {
    const ws = await h.workspace.createWorkspace('Multi', [main, extraA]);
    const task = await h.workspace.createTask({
      groupId: ws.id,
      repoPath: main,
      baseRef: 'HEAD',
      prompt: '',
      isolation: 'direct',
    });
    const e = await launchIn(task.id, 'fake');
    const folderA = ws.folders?.find((f) => f.path === extraA);
    await h.workspace.updateWorkspace(ws.id, { kind: 'removeFolder', folderId: folderA?.id ?? '' });
    await h.workspace.updateWorkspace(ws.id, { kind: 'addFolders', folders: [extraB] });
    expect(h.model.task(task.id)?.extraDirs).toEqual([extraA]);

    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await h.executions.relaunch(e.id, SIZE);
    await waitStatus(e.id, ['running', 'idle']);
    const { argv } = await argvAndCwd(exec(e.id));
    expect(argv).toContain(extraA);
    expect(argv).not.toContain(extraB);
  });

  it('an agent without extraDirs sees only the primary folder and gets the notice', async () => {
    const ws = await h.workspace.createWorkspace('Multi', [main, extraA]);
    const task = await h.workspace.createTask({
      groupId: ws.id,
      repoPath: main,
      baseRef: 'HEAD',
      prompt: '',
      isolation: 'direct',
    });
    const e = await launchIn(task.id, 'fake-pty');
    expect(e.notices).toEqual([{ kind: 'extra-dirs-unsupported' }]);
    const { argv } = await argvAndCwd(e);
    expect(argv).not.toContain('--add-dir');
  });
});
