import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { createRemoteFixture, type RemoteFixture } from '../../../support/git-remote-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

/** Sem configuração global nem de sistema: nenhum gerenciador de credenciais abre janela durante o teste. */
const ISOLATED_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GCM_INTERACTIVE: 'never',
};

let repo: TempRepo;
let rig: GitServiceRig;
let server: Server | null = null;
const sockets = new Set<Socket>();

beforeEach(() => {
  repo = createTempRepo();
  rig = makeGitService({ env: ISOLATED_ENV });
});

afterEach(async () => {
  for (const s of sockets) s.destroy();
  sockets.clear();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
  repo.cleanup();
  rig.cleanup();
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(handler);
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((resolve) => server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port)));
}

function io(signal = new AbortController().signal) {
  return { signal, onProgress: vi.fn() };
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('GitService network failures', () => {
  it('reports GIT_AUTH without hanging when the remote asks for credentials', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="teste"' });
      res.end();
    });
    git(repo.root, ['remote', 'add', 'origin', `http://127.0.0.1:${port}/repo.git`]);
    const started = Date.now();
    const err = await failure(rig.service.fetch(repo.root, io()));
    expect(err.code).toBe('GIT_AUTH');
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it('never leaks credentials from the URL into the error or the log', async () => {
    const port = await listen((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="teste"' });
      res.end();
    });
    git(repo.root, ['remote', 'add', 'origin', `http://pessoa:segredo-do-token@127.0.0.1:${port}/repo.git`]);
    const err = await failure(rig.service.fetch(repo.root, io()));
    expect(err.userMessage).not.toContain('segredo-do-token');
    expect(JSON.stringify(err.details)).not.toContain('segredo-do-token');
    expect(rig.log.text()).not.toContain('segredo-do-token');
    expect(rig.log.records.some((r) => r.event === 'git.op' && r.fields.ok === false)).toBe(true);
  }, 30_000);

  it('cancelling kills the git process', async () => {
    let closed = false;
    let connected!: () => void;
    const gotRequest = new Promise<void>((resolve) => (connected = resolve));
    const port = await listen((req) => {
      req.on('close', () => (closed = true));
      connected();
    });
    git(repo.root, ['remote', 'add', 'origin', `http://127.0.0.1:${port}/repo.git`]);
    const controller = new AbortController();
    const started = rig.service.fetch(repo.root, io(controller.signal));
    const settled = failure(started);
    await gotRequest;
    controller.abort();
    const err = await settled;
    expect(err.userMessage).toBe('Operação cancelada.');
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 10_000 });
  }, 30_000);
});

describe('GitService progress', () => {
  let fx: RemoteFixture;

  afterEach(() => fx?.cleanup());

  it('reports the percentage of a push', async () => {
    fx = createRemoteFixture();
    const noise = Array.from({ length: 4000 }, (_, i) => `linha ${i} ${Math.random()}`).join('\n');
    git(fx.local.root, ['checkout', '-q', '-b', 'grande']);
    writeFileSync(join(fx.local.root, 'grande.txt'), noise);
    git(fx.local.root, ['add', '-A']);
    git(fx.local.root, ['commit', '-q', '-m', 'grande']);
    const o = { signal: new AbortController().signal, onProgress: vi.fn(), confirm: ['set-upstream' as const] };
    await rig.service.push(fx.local.root, o);
    const withPercent = o.onProgress.mock.calls.filter(([, percent]) => typeof percent === 'number');
    expect(withPercent.length).toBeGreaterThan(0);
    expect(withPercent.every(([phase]) => typeof phase === 'string' && phase.length > 0)).toBe(true);
    expect(withPercent.at(-1)?.[1]).toBeLessThanOrEqual(100);
  }, 30_000);
});
