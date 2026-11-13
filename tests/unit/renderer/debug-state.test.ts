import { describe, expect, it } from 'vitest';
import {
  debugEvent,
  EMPTY_DEBUG_STATE,
  readBreakpoints,
  writeBreakpoints,
  type DebugState,
} from '../../../src/renderer/components/Ide/debug-state';

const root = 'C:\\Users\\dev\\repo';

describe('IDE debug state', () => {
  it('sets stopped state with a valid thread and clears stale inspection data', () => {
    const state: DebugState = {
      stopped: false,
      threadId: 9,
      frames: [{ id: 1 }],
      scopes: [{ id: 2 }],
      variables: [{ name: 'old' }],
    };
    expect(debugEvent(state, { event: 'stopped', body: { threadId: 4 } })).toEqual({
      stopped: true,
      threadId: 4,
      frames: [],
      scopes: [],
      variables: [],
    });
    expect(debugEvent(state, { event: 'stopped', body: { threadId: '4' } }).threadId).toBeNull();
    expect(debugEvent(state, { event: 'stopped', body: null }).threadId).toBeNull();
  });

  it.each([{ event: 'continued' }, { event: 'terminated' }, { event: 'exited' }, { kind: 'closed' }])(
    'clears inspection state after lifecycle end: %o',
    (message) => {
      const state: DebugState = { stopped: true, threadId: 2, frames: [{}], scopes: [{}], variables: [{}] };
      expect(debugEvent(state, message)).toEqual(EMPTY_DEBUG_STATE);
    },
  );

  it('ignores events without a state transition', () => {
    const state: DebugState = { stopped: false, threadId: null, frames: [], scopes: [], variables: [] };
    expect(debugEvent(state, { event: 'output', body: { output: 'not persisted' } })).toBe(state);
  });

  it('round-trips versioned breakpoints limited to absolute paths inside the root', () => {
    let raw: string | null = null;
    const key = `melinna.ide.breakpoints.v1:${root}`;
    const storage = {
      getItem: (requested: string) => (requested === key ? raw : null),
      setItem: (requested: string, value: string) => {
        expect(requested).toBe(key);
        raw = value;
      },
    };
    writeBreakpoints(storage, root, {
      'C:/Users/DEV/repo/src/a.ts': [20, 4, 4, 0, 1_000_001, -1, 8.5],
      'C:\\Users\\dev\\repo\\.git\\config': [1],
      'C:\\Users\\dev\\outside.ts': [2],
      relativePath: [3],
      'C:\\Users\\dev\\repo\\src\\with\nnewline.ts': [4],
    });
    expect(readBreakpoints(storage, root)).toEqual({ 'C:/Users/DEV/repo/src/a.ts': [4, 20] });
    expect(JSON.parse(raw!).version).toBe(1);
    expect(raw).not.toContain('token');
  });

  it('rejects malformed, outdated and oversized storage data', () => {
    expect(readBreakpoints({ getItem: () => '{bad' }, root)).toEqual({});
    expect(
      readBreakpoints(
        { getItem: () => JSON.stringify({ version: 2, breakpoints: { [`${root}/a.ts`]: [1] } }) },
        root,
      ),
    ).toEqual({});
    expect(readBreakpoints({ getItem: () => 'x'.repeat(2 * 1024 * 1024 + 1) }, root)).toEqual({});
    expect(
      readBreakpoints(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        root,
      ),
    ).toEqual({});
    expect(
      readBreakpoints(
        {
          getItem: () =>
            JSON.stringify({
              version: 1,
              breakpoints: Object.fromEntries(
                Array.from({ length: 110 }, (_, i) => [`${root}/f${i}.ts`, [1]]),
              ),
            }),
        },
        root,
      ),
    ).toHaveProperty(`${root}/f99.ts`);
    expect(
      Object.keys(
        readBreakpoints(
          {
            getItem: () =>
              JSON.stringify({
                version: 1,
                breakpoints: Object.fromEntries(
                  Array.from({ length: 110 }, (_, i) => [`${root}/f${i}.ts`, [1]]),
                ),
              }),
          },
          root,
        ),
      ),
    ).toHaveLength(100);
  });

  it('enforces line limits and ignores storage quota errors', () => {
    const manyLines = Array.from({ length: 1002 }, (_, index) => index + 1);
    writeBreakpoints(
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
      root,
      { [`${root}/a.ts`]: manyLines },
    );
    let saved = '';
    writeBreakpoints(
      {
        setItem: (_key, value) => {
          saved = value;
        },
      },
      root,
      { [`${root}/a.ts`]: manyLines },
    );
    expect(readBreakpoints({ getItem: () => saved }, root)[`${root}/a.ts`]).toHaveLength(1000);
    writeBreakpoints(
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
      root,
      { [`${root}/a.ts`]: [1] },
    );
  });
});
