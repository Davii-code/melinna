import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { gotoLineTransaction } from '../../src/renderer/components/Editor/extensions/goto-line';
import { extractSymbols } from '../../src/renderer/components/Editor/extensions/structure';

const BUDGET_MS = 100;

/** 10.000 linhas de TypeScript com classes, métodos e funções. */
function bigSource(): string {
  const lines: string[] = [];
  for (let i = 0; lines.length < 10_000; i++) {
    lines.push(`export class Classe${i} {`, `  metodo${i}(a: number) {`, `    return a + ${i};`, '  }', '}');
    lines.push(`export function funcao${i}(x: string) {`, `  return x.length + ${i};`, '}', '');
  }
  return lines.slice(0, 10_000).join('\n');
}

function median(fn: () => void): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[2] ?? Infinity;
}

describe('editor navigation performance (10,000 lines)', () => {
  const state = EditorState.create({ doc: bigSource(), extensions: [javascript({ typescript: true })] });

  it('goes to a line in under 100 ms', () => {
    expect(state.doc.lines).toBe(10_000);
    const ms = median(() => {
      const tr = state.update(gotoLineTransaction(state, { line: 9_876, column: 5 }));
      expect(tr.newSelection.main.head).toBe(state.doc.line(9_876).from + 4);
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('builds the file structure in under 100 ms once the file is parsed', () => {
    extractSymbols(state);
    const ms = median(() => {
      expect(extractSymbols(state).length).toBeGreaterThan(3_000);
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
