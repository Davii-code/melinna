import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../src/core/errors';
import type { ProjectSearchQuery, ProjectSearchResult } from '../../../src/core/files/search';
import { ProjectSearcher, SEARCH_MAX_ROOTS, SEARCH_TIMEOUT_MS } from '../../../src/main/search-worker';
import { FakeSearchWorker } from '../../support/fakes/search-worker';
import { FakeClock } from '../../support/fakes/clock';
import { MemoryLogger } from '../../support/fakes/logger';

const query = (over: Partial<ProjectSearchQuery> = {}): ProjectSearchQuery => ({
  roots: ['/ws'],
  text: 'texto-secreto-da-busca',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...over,
});

const RESULT: ProjectSearchResult = {
  hits: [{ path: '/ws/a.ts', line: 1, column: 1, preview: 'x', matchStart: 0, matchEnd: 1 }],
  truncated: false,
  scannedFiles: 3,
  skipped: 0,
};

function setup(allowed: (root: string) => boolean = (r) => r.startsWith('/ws')) {
  const clock = new FakeClock(Date.parse('2026-10-26T10:00:00.000Z'));
  const log = new MemoryLogger();
  const workers: FakeSearchWorker[] = [];
  const queries: ProjectSearchQuery[] = [];
  const searcher = new ProjectSearcher({
    createWorker: (q) => {
      queries.push(q);
      const w = new FakeSearchWorker();
      workers.push(w);
      return w;
    },
    isRootAllowed: allowed,
    clock,
    log,
  });
  return { searcher, clock, log, workers, queries };
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ProjectSearcher', () => {
  it('runs the search in a worker and returns what it found', async () => {
    const { searcher, workers, queries } = setup();
    const pending = searcher.search(query());
    await tick();
    expect(queries).toHaveLength(1);
    workers[0]?.emitMessage({ type: 'result', result: RESULT });
    expect(await pending).toEqual(RESULT);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('turns the error of the worker into a MelinnaError with the same code and message', async () => {
    const { searcher, workers } = setup();
    const pending = failure(searcher.search(query({ regex: true })));
    await tick();
    workers[0]?.emitMessage({
      type: 'error',
      code: 'SEARCH_REGEX_INVALID',
      message: 'Expressão regular inválida: x',
    });
    const err = await pending;
    expect(err.code).toBe('SEARCH_REGEX_INVALID');
    expect(err.userMessage).toBe('Expressão regular inválida: x');
  });

  it('cancels on demand: rejects with SEARCH_CANCELLED and ends the worker', async () => {
    const { searcher, workers } = setup();
    const pending = failure(searcher.search(query()));
    await tick();
    searcher.cancel();
    expect((await pending).code).toBe('SEARCH_CANCELLED');
    expect(workers[0]?.terminated).toBe(1);
  });

  it('an empty text only cancels the running search and returns nothing, without a worker', async () => {
    const { searcher, workers } = setup();
    const running = failure(searcher.search(query()));
    await tick();
    expect(await searcher.search(query({ text: '' }))).toEqual({
      hits: [],
      truncated: false,
      scannedFiles: 0,
      skipped: 0,
    });
    expect((await running).code).toBe('SEARCH_CANCELLED');
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('cancels with nothing running without failing', () => {
    const { searcher } = setup();
    expect(() => searcher.cancel()).not.toThrow();
  });

  it('a new search cancels the previous one', async () => {
    const { searcher, workers } = setup();
    const first = failure(searcher.search(query()));
    await tick();
    const second = searcher.search(query({ text: 'outro' }));
    await tick();
    expect((await first).code).toBe('SEARCH_CANCELLED');
    expect(workers[0]?.terminated).toBe(1);
    workers[1]?.emitMessage({ type: 'result', result: RESULT });
    expect(await second).toEqual(RESULT);
  });

  it('cuts a search that takes too long (a catastrophic regex) and ends the worker', async () => {
    const { searcher, clock, workers } = setup();
    const pending = failure(searcher.search(query({ regex: true, text: '(a+)+$' })));
    await tick();
    clock.advance(SEARCH_TIMEOUT_MS - 1);
    expect(workers[0]?.terminated).toBe(0);
    clock.advance(1);
    const err = await pending;
    expect(err.code).toBe('SEARCH_TIMEOUT');
    expect(err.userMessage).toBe('A busca demorou demais; simplifique a expressão.');
    expect(workers[0]?.terminated).toBe(1);
  });

  it('keeps the main process answering while a search is stuck', async () => {
    const { searcher, clock } = setup();
    const pending = failure(searcher.search(query()));
    let answered = false;
    const other = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      answered = true;
    });
    await tick();
    await other;
    expect(answered).toBe(true);
    clock.advance(SEARCH_TIMEOUT_MS);
    await pending;
  });

  it('does not keep the timer after finishing: a late timeout changes nothing', async () => {
    const { searcher, clock, workers } = setup();
    const pending = searcher.search(query());
    await tick();
    workers[0]?.emitMessage({ type: 'result', result: RESULT });
    await pending;
    clock.advance(SEARCH_TIMEOUT_MS * 2);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('ignores a message that arrives after the search was settled', async () => {
    const { searcher, workers } = setup();
    const pending = searcher.search(query());
    await tick();
    workers[0]?.emitMessage({ type: 'result', result: RESULT });
    workers[0]?.emitMessage({ type: 'error', code: 'INTERNAL', message: 'tarde demais' });
    expect(await pending).toEqual(RESULT);
  });

  it('reports INTERNAL when the worker crashes or exits without answering', async () => {
    const crash = setup();
    const a = failure(crash.searcher.search(query()));
    await tick();
    crash.workers[0]?.emitError(new Error('boom'));
    expect((await a).code).toBe('INTERNAL');
    expect(crash.log.events()).toContain('files.search_failed');

    const silent = setup();
    const b = failure(silent.searcher.search(query()));
    await tick();
    silent.workers[0]?.emitExit(1);
    expect((await b).code).toBe('INTERNAL');
  });

  it('refuses roots that are not registered, without creating a worker', async () => {
    const { searcher, workers } = setup();
    const err = await failure(searcher.search(query({ roots: ['/ws', '/etc'] })));
    expect(err.code).toBe('FILE_OUTSIDE_ROOT');
    expect(workers).toHaveLength(0);
  });

  it('refuses an absurd number of roots', async () => {
    const { searcher, workers } = setup();
    const roots = Array.from({ length: SEARCH_MAX_ROOTS + 1 }, (_, i) => `/ws/${i}`);
    expect((await failure(searcher.search(query({ roots })))).code).toBe('INPUT_INVALID');
    expect(workers).toHaveLength(0);
  });

  it('does not cancel the running search when the new one is refused', async () => {
    const { searcher, workers } = setup();
    const first = searcher.search(query());
    await tick();
    await failure(searcher.search(query({ roots: ['/etc'] })));
    expect(workers[0]?.terminated).toBe(0);
    workers[0]?.emitMessage({ type: 'result', result: RESULT });
    expect(await first).toEqual(RESULT);
  });

  it('logs counts and duration, never the searched text', async () => {
    const { searcher, workers, log } = setup();
    const pending = searcher.search(query());
    await tick();
    workers[0]?.emitMessage({ type: 'result', result: RESULT });
    await pending;
    const record = log.records.find((r) => r.event === 'files.search');
    expect(record?.fields).toMatchObject({ roots: 1, files: 3, hits: 1, truncated: false });
    expect(log.text()).not.toContain('texto-secreto-da-busca');
  });
});
