import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBoundaries } from './check-boundaries';

describe('architecture boundaries', () => {
  it('flags every forbidden import in the fixtures', () => {
    const found = checkBoundaries(join(__dirname, 'fixtures'))
      .map((v) => `${v.file} ${v.specifier} ${v.rule}`)
      .sort();
    expect(found).toEqual(
      [
        'src/adapters/bad.ts electron no-electron',
        'src/core/bad-electron.ts electron core-forbidden-package',
        'src/core/bad-layer.ts ../adapters/thing core-forbidden-layer',
        'src/core/bad-layer.ts ../main/thing core-forbidden-layer',
        'src/core/bad-pty.ts @xterm/xterm core-forbidden-package',
        'src/core/bad-pty.ts node-pty core-forbidden-package',
        'src/core/bad-react.ts react core-forbidden-package',
        'src/host/bad.ts electron no-electron',
        'src/renderer/bad.ts ../core/errors renderer-forbidden-layer',
        'src/renderer/bad.ts ../main/thing renderer-forbidden-layer',
        'src/renderer/bad.ts node:fs renderer-node-builtin',
        'src/renderer/bad.ts path renderer-node-builtin',
      ].sort(),
    );
  });

  it('the real source tree has no violations', () => {
    expect(checkBoundaries(join(__dirname, '..', '..'))).toEqual([]);
  });
});
