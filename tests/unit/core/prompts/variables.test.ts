import { describe, expect, it } from 'vitest';
import {
  assertNoControlChars,
  extractVariables,
  hasControlChars,
  normalizeNewlines,
  resolve,
  type AutoValues,
} from '../../../../src/core/prompts/variables';

const auto: AutoValues = { pasta: '/proj/a', workspace: 'Meu WS', data: '2026-10-22' };

describe('extractVariables', () => {
  it('lists unique variables in order of first occurrence', () => {
    expect(extractVariables('{{b}} e {{a}} e {{b}} de novo')).toEqual(['b', 'a']);
  });

  it('accepts letters, digits and underscore in names', () => {
    expect(extractVariables('{{arq_1}} {{A9}}')).toEqual(['arq_1', 'A9']);
  });

  it('treats invalid names as plain text', () => {
    expect(extractVariables('{{a-b}} {{ }} {{}} {{ x }} {x} {{a b}}')).toEqual([]);
  });

  it('returns an empty list for text without variables', () => {
    expect(extractVariables('nada aqui')).toEqual([]);
  });

  it('includes the automatic variables', () => {
    expect(extractVariables('{{pasta}} {{workspace}} {{data}}')).toEqual(['pasta', 'workspace', 'data']);
  });
});

describe('resolve', () => {
  it('replaces every occurrence of a repeated variable', () => {
    expect(resolve('{{a}}-{{a}}', { a: 'x' }, auto)).toBe('x-x');
  });

  it('fills the automatic variables from the session values', () => {
    expect(resolve('{{pasta}}|{{workspace}}|{{data}}', {}, auto)).toBe('/proj/a|Meu WS|2026-10-22');
  });

  it('lets the automatic values win over informed ones', () => {
    expect(resolve('{{pasta}}', { pasta: '/outra' }, auto)).toBe('/proj/a');
  });

  it('keeps invalid names as literal text', () => {
    expect(resolve('{{a-b}} {{ }}', {}, auto)).toBe('{{a-b}} {{ }}');
  });

  it('does not expand a value that contains another variable', () => {
    expect(resolve('{{a}} {{b}}', { a: '{{b}}', b: 'B' }, auto)).toBe('{{b}} B');
  });

  it('does not interpret replacement patterns in values', () => {
    expect(resolve('<{{a}}>', { a: "$& $1 $$ $'" }, auto)).toBe("<$& $1 $$ $'>");
  });

  it('fails when a variable has no value', () => {
    expect(() => resolve('{{falta}}', {}, auto)).toThrow('Preencha a variável {{falta}}');
  });

  it('treats an empty value as missing unless allowed', () => {
    expect(() => resolve('{{a}}', { a: '' }, auto)).toThrow('Preencha a variável {{a}}');
    expect(resolve('x{{a}}y', { a: '' }, auto, ['a'])).toBe('xy');
    expect(resolve('x{{a}}y', {}, auto, ['a'])).toBe('xy');
  });

  it('does not let allowEmpty hide a missing automatic value with content', () => {
    expect(resolve('{{pasta}}', {}, auto, ['pasta'])).toBe('/proj/a');
  });
});

describe('control characters', () => {
  it('allows line breaks and tabs', () => {
    expect(() => assertNoControlChars('a\nb\tc')).not.toThrow();
    expect(hasControlChars('a\nb\tc')).toBe(false);
  });

  it.each(['\x00', '\x07', '\x1b', '\x1b[201~', '\r', '\x7f'])('rejects %j', (c) => {
    expect(hasControlChars(`a${c}b`)).toBe(true);
    expect(() => assertNoControlChars(`a${c}b`)).toThrow('caracteres de controle');
  });
});

describe('normalizeNewlines', () => {
  it('turns CRLF into LF and leaves a lone CR for the control check', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\rc');
  });
});
