import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function filesIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => filesIn(join(path, name)));
}

/** Execução de comando de projeto nunca passa por um shell (Princípio VIII). */
const SCOPE = [join(ROOT, 'src', 'core', 'run'), join(ROOT, 'src', 'main', 'ipc', 'register-run.ts')];

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'shell: true', pattern: /shell\s*:\s*true/ },
  { name: 'cmd.exe', pattern: /cmd\.exe/i },
  { name: '"/c" argument', pattern: /['"]\/c['"]/ },
  { name: '"-c" argument (sh -c)', pattern: /['"]-c['"]/ },
  { name: 'child_process import', pattern: /child_process/ },
];

describe('no shell launch in the run feature', () => {
  const files = SCOPE.flatMap(filesIn).filter((f) => f.endsWith('.ts'));

  it('covers the run sources', () => {
    const names = files.map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(names).toEqual(
      expect.arrayContaining([
        'src/core/run/detect.ts',
        'src/core/run/resolve-program.ts',
        'src/core/run/run-service.ts',
        'src/main/ipc/register-run.ts',
      ]),
    );
  });

  it.each(FORBIDDEN)('never uses $name', ({ pattern }) => {
    const offenders = files
      .filter((f) => pattern.test(readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
