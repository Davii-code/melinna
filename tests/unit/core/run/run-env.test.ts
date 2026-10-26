import { describe, expect, it } from 'vitest';
import { buildEnv, envNames, runtimeVariable } from '../../../../src/core/run/run-env';
import type { RunConfig } from '../../../../src/core/run/types';

function config(over: Partial<RunConfig> = {}): RunConfig {
  return {
    id: 'c1',
    name: 'X',
    tool: 'npm',
    folder: '/repo',
    script: 'start',
    program: 'npm',
    args: [],
    runtimeOptions: '',
    env: [],
    beforeLaunch: null,
    allowParallel: false,
    folderGroup: null,
    order: 0,
    ...over,
  };
}

describe('runtimeVariable', () => {
  it('maps the tools to their variable and leaves compose and program without one', () => {
    expect(runtimeVariable('npm')).toBe('NODE_OPTIONS');
    expect(runtimeVariable('pnpm')).toBe('NODE_OPTIONS');
    expect(runtimeVariable('yarn')).toBe('NODE_OPTIONS');
    expect(runtimeVariable('maven')).toBe('MAVEN_OPTS');
    expect(runtimeVariable('gradle')).toBe('GRADLE_OPTS');
    expect(runtimeVariable('compose')).toBeNull();
    expect(runtimeVariable('program')).toBeNull();
  });
});

describe('buildEnv', () => {
  it('starts from the base and adds the variables of the config', () => {
    const env = buildEnv({ HOME: '/h', PATH: '/bin' }, config({ env: [{ name: 'PORT', value: '4000' }] }));
    expect(env).toEqual({ HOME: '/h', PATH: '/bin', PORT: '4000' });
  });

  it('lets the config win over the base, comparing names without regard to case', () => {
    const env = buildEnv(
      { Path: 'C:\\base', HOME: '/h' },
      config({ env: [{ name: 'PATH', value: 'C:\\config' }] }),
    );
    expect(env).toEqual({ HOME: '/h', PATH: 'C:\\config' });
  });

  it('drops base entries with an undefined value', () => {
    expect(buildEnv({ A: '1', B: undefined }, config())).toEqual({ A: '1' });
  });

  it('does not change the base object', () => {
    const base = { A: '1' };
    buildEnv(base, config({ env: [{ name: 'A', value: '2' }] }));
    expect(base).toEqual({ A: '1' });
  });

  it('appends runtimeOptions to the end of the tool variable with a space', () => {
    expect(
      buildEnv({ NODE_OPTIONS: '--max-old-space-size=512' }, config({ runtimeOptions: '--inspect' })),
    ).toEqual({ NODE_OPTIONS: '--max-old-space-size=512 --inspect' });
    expect(buildEnv({}, config({ tool: 'maven', runtimeOptions: '-Xmx1g' }))).toEqual({
      MAVEN_OPTS: '-Xmx1g',
    });
    expect(buildEnv({ GRADLE_OPTS: '-Dx=1' }, config({ tool: 'gradle', runtimeOptions: '-Xmx1g' }))).toEqual({
      GRADLE_OPTS: '-Dx=1 -Xmx1g',
    });
  });

  it('appends to the variable that comes from the config itself', () => {
    const env = buildEnv(
      { NODE_OPTIONS: 'base' },
      config({ env: [{ name: 'NODE_OPTIONS', value: '--a' }], runtimeOptions: '--b' }),
    );
    expect(env).toEqual({ NODE_OPTIONS: '--a --b' });
  });

  it('finds the tool variable regardless of case', () => {
    const env = buildEnv({ node_options: '--a' }, config({ runtimeOptions: '--b' }));
    expect(Object.values(env)).toEqual(['--a --b']);
    expect(Object.keys(env)).toHaveLength(1);
  });

  it('adds nothing in compose and program, even with runtimeOptions', () => {
    expect(buildEnv({ A: '1' }, config({ tool: 'compose', runtimeOptions: '-X' }))).toEqual({ A: '1' });
    expect(buildEnv({ A: '1' }, config({ tool: 'program', runtimeOptions: '-X' }))).toEqual({ A: '1' });
  });

  it('keeps an empty runtimeOptions from touching the variable', () => {
    expect(buildEnv({}, config())).toEqual({});
  });
});

describe('envNames', () => {
  it('lists only the names, never the values', () => {
    const names = envNames(
      config({
        env: [
          { name: 'PORT', value: '4000' },
          { name: 'API_TOKEN', value: 'segredo' },
        ],
      }),
    );
    expect(names).toEqual(['PORT', 'API_TOKEN']);
    expect(JSON.stringify(names)).not.toContain('segredo');
  });

  it('is empty without variables', () => {
    expect(envNames(config())).toEqual([]);
  });
});
