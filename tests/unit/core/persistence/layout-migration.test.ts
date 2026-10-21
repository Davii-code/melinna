import { describe, expect, it } from 'vitest';
import { parseState, STATE_SCHEMA_VERSION } from '../../../../src/core/persistence/state-schema';

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: 1, groups: [], tasks: [], executions: [], ...over };
}

const custom = { columns: [0.4, 0.6], rows: [1], cells: { a: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } } };

describe('layout migration to schema 2', () => {
  it('turns each open execution of a v1 file into a panel with the same id', () => {
    const parsed = parseState(
      base({
        layout: { mode: 'spotlight', openExecutionIds: ['a', 'b'], focusedExecutionId: 'b', custom },
      }),
    );
    expect(parsed?.layout.mode).toBe('spotlight');
    expect(parsed?.layout.panes).toEqual([
      { id: 'a', kind: 'executions', execIds: ['a'], activeIndex: 0 },
      { id: 'b', kind: 'executions', execIds: ['b'], activeIndex: 0 },
    ]);
    expect(parsed?.layout.focusedPaneId).toBe('b');
    // as células da grade personalizada continuam válidas porque o id do painel é o id da execução
    expect(parsed?.layout.custom.cells.a).toBeDefined();
    // a versão relatada continua sendo a do arquivo, para o StateStore detectar estado mais novo
    expect(parsed?.schemaVersion).toBe(1);
  });

  it('falls back to the first panel when the focused execution no longer exists', () => {
    const parsed = parseState(
      base({ layout: { mode: 'auto', openExecutionIds: ['a'], focusedExecutionId: 'z', custom: { columns: [1], rows: [1], cells: {} } } }),
    );
    expect(parsed?.layout.focusedPaneId).toBe('a');
  });

  it('ignores a v1 layout without open panels and yields an empty panel list', () => {
    const parsed = parseState(base({ layout: { mode: 'lixo', openExecutionIds: [], focusedExecutionId: null } }));
    expect(parsed?.layout).toEqual({
      mode: 'auto',
      panes: [],
      focusedPaneId: null,
      custom: { columns: [1], rows: [1], cells: {} },
    });
  });

  it('reads a v2 file with terminal and editor panels', () => {
    const parsed = parseState(
      base({
        schemaVersion: STATE_SCHEMA_VERSION,
        layout: {
          mode: 'custom',
          panes: [
            { id: 'a', kind: 'executions', execIds: ['a', 'b'], activeIndex: 1 },
            { id: 'editor-1', kind: 'editor', docs: ['/ws/a.ts', '/ws/b.ts'], activeIndex: 0 },
          ],
          focusedPaneId: 'editor-1',
          custom,
        },
      }),
    );
    expect(parsed?.layout.panes).toHaveLength(2);
    expect(parsed?.layout.panes[0]).toMatchObject({ execIds: ['a', 'b'], activeIndex: 1 });
    expect(parsed?.layout.panes[1]).toMatchObject({ docs: ['/ws/a.ts', '/ws/b.ts'] });
    expect(parsed?.layout.focusedPaneId).toBe('editor-1');
  });

  it('drops malformed panels instead of losing the whole state', () => {
    const parsed = parseState(
      base({
        schemaVersion: 2,
        layout: {
          mode: 'auto',
          panes: [
            { id: 'ok', kind: 'editor', docs: ['/ws/a.ts'], activeIndex: 0 },
            { id: 'sem-abas', kind: 'executions', execIds: [], activeIndex: 0 },
            { id: 'tipo-errado', kind: 'quadro', docs: [] },
            { id: 'ok', kind: 'editor', docs: ['/ws/b.ts'], activeIndex: 0 },
            'não é objeto',
          ],
          focusedPaneId: 'sumiu',
          custom: { columns: [1], rows: [1], cells: {} },
        },
      }),
    );
    expect(parsed?.layout.panes).toEqual([{ id: 'ok', kind: 'editor', docs: ['/ws/a.ts'], activeIndex: 0 }]);
    expect(parsed?.layout.focusedPaneId).toBe('ok');
  });

  it('clamps an out-of-range active index to the last tab', () => {
    const parsed = parseState(
      base({
        schemaVersion: 2,
        layout: {
          mode: 'auto',
          panes: [{ id: 'e', kind: 'executions', execIds: ['a', 'b'], activeIndex: 9 }],
          focusedPaneId: null,
          custom: { columns: [1], rows: [1], cells: {} },
        },
      }),
    );
    expect(parsed?.layout.panes[0]).toMatchObject({ activeIndex: 1 });
  });
});
