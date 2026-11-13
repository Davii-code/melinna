import { describe, expect, it } from 'vitest';
import {
  buildLineComment,
  lineRef,
  SNIPPET_MAX,
} from '../../../src/renderer/components/DiffView/line-comment';
import type { DiffLine } from '../../../src/shared/ipc-contract';

const ADD: DiffLine = { kind: 'add', text: 'const a = 1;', oldNo: null, newNo: 12 };
const DEL: DiffLine = { kind: 'del', text: 'const a = 0;', oldNo: 11, newNo: null };
const CONTEXT: DiffLine = { kind: 'context', text: 'return a;', oldNo: 13, newNo: 14 };

describe('lineRef', () => {
  it('cites the new number for added and context lines', () => {
    expect(lineRef(ADD)).toBe('linha 12');
    expect(lineRef(CONTEXT)).toBe('linha 14');
  });

  it('cites the old number for removed lines and says so', () => {
    expect(lineRef(DEL)).toBe('linha 11 (removida)');
  });
});

describe('buildLineComment', () => {
  it('puts path, line, snippet and comment in values, never in the body', () => {
    const input = buildLineComment('src/a.ts', ADD, '  renomeie para total  ');
    expect(input.values).toEqual({
      arquivo: 'src/a.ts',
      linha: 'linha 12',
      trecho: '+const a = 1;',
      comentario: 'renomeie para total',
    });
    expect(input.allowEmpty).toEqual([]);
    expect(input.body).not.toContain('src/a.ts');
    expect(input.body).not.toContain('const a = 1;');
  });

  it('keeps template braces of the code out of the body', () => {
    const line: DiffLine = { kind: 'context', text: '<p>{{nome}}</p>', oldNo: 3, newNo: 3 };
    const input = buildLineComment('view.html', line, 'troque a variável');
    expect(input.body).not.toContain('{{nome}}');
    expect(input.values.trecho).toBe(' <p>{{nome}}</p>');
  });

  it('marks removed lines with a minus sign', () => {
    expect(buildLineComment('a.ts', DEL, 'por que saiu?').values.trecho).toBe('-const a = 0;');
  });

  it('keeps the sign when the line is blank, so the snippet is never empty', () => {
    const blank: DiffLine = { kind: 'add', text: '', oldNo: null, newNo: 2 };
    expect(buildLineComment('a.ts', blank, 'linha a mais').values.trecho).toBe('+');
  });

  it('strips control characters but keeps tabs', () => {
    const line: DiffLine = { kind: 'add', text: '\tx\x1b[31m\x00y\r', oldNo: null, newNo: 1 };
    const input = buildLineComment('a\x07.ts', line, 'ok');
    expect(input.values.trecho).toBe('+\tx[31my');
    expect(input.values.arquivo).toBe('a.ts');
  });

  it('cuts very long lines', () => {
    const line: DiffLine = { kind: 'add', text: 'x'.repeat(SNIPPET_MAX + 50), oldNo: null, newNo: 1 };
    const { trecho } = buildLineComment('min.js', line, 'ok').values;
    expect(trecho).toBe(`+${'x'.repeat(SNIPPET_MAX)}…`);
  });
});
