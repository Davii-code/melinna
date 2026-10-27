import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANDS, THEME, bandColor, bandLabel } from '../../../../src/renderer/theme/bands';

describe('bands', () => {
  it('uses the six brand colors in order and repeats them', () => {
    expect(BANDS).toEqual(['#ff3b30', '#ff9f0a', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2']);
    expect([0, 1, 2, 3, 4, 5].map(bandColor)).toEqual([...BANDS]);
    expect(bandColor(6)).toBe('#ff3b30');
    expect(bandColor(13)).toBe('#ff9f0a');
  });

  it('labels from the 7th execution without a ceiling', () => {
    expect(bandLabel(0)).toBeNull();
    expect(bandLabel(5)).toBeNull();
    expect(bandLabel(6)).toBe('7');
    expect(bandLabel(41)).toBe('42');
  });

  it('declares the spec palette as CSS variables', () => {
    const css = readFileSync(join(__dirname, '../../../../src/renderer/theme/tokens.css'), 'utf8');
    for (const color of [...Object.values(THEME), ...BANDS]) {
      expect(css).toContain(color);
    }
    expect(css).toContain("'Segoe UI', system-ui");
  });
});
