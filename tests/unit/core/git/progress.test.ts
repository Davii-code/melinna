import { describe, expect, it } from 'vitest';
import { parseProgress } from '../../../../src/core/git/progress';

describe('parseProgress', () => {
  it('reads the phase and percentage from git progress lines', () => {
    expect(parseProgress('Receiving objects:  45% (9/20)\r')).toEqual({ phase: 'Recebendo objetos', percent: 45 });
    expect(parseProgress('Writing objects: 100% (3/3), 250 bytes | 250.00 KiB/s, done.\n')).toEqual({
      phase: 'Enviando objetos',
      percent: 100,
    });
    expect(parseProgress('remote: Compressing objects: 12% (1/8)')).toEqual({ phase: 'Compactando objetos', percent: 12 });
  });

  it('keeps the last update of a chunk with carriage returns', () => {
    const chunk = 'Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\rResolving deltas:  20% (1/5)\r';
    expect(parseProgress(chunk)).toEqual({ phase: 'Resolvendo deltas', percent: 20 });
  });

  it('ignores lines without a percentage', () => {
    expect(parseProgress('From ../remote\n   abc..def  main -> origin/main\n')).toBeNull();
    expect(parseProgress('')).toBeNull();
  });
});
