import { tags as t } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';
import { darkHighlightStyle, languageFor } from '../../../src/renderer/components/Editor/CodeEditor';

describe('darkHighlightStyle', () => {
  it('colors the main token kinds for a dark background', () => {
    for (const tag of [t.keyword, t.string, t.comment, t.number, t.typeName, t.function(t.variableName)]) {
      expect(darkHighlightStyle.style([tag])).toBeTruthy();
    }
    const rules = darkHighlightStyle.module?.getRules() ?? '';
    expect(rules).toContain('#c586c0');
    expect(rules).toContain('#ce9178');
    expect(rules).toContain('#6a9955');
  });
});

describe('languageFor', () => {
  it('picks a language by extension and falls back to plain text', () => {
    expect(languageFor('/a/app.tsx')).not.toEqual([]);
    expect(languageFor('/a/dados.JSON')).not.toEqual([]);
    expect(languageFor('/a/LEIAME')).toEqual([]);
    expect(languageFor('/a/Main.java')).toEqual([]);
  });
});
