import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { JsonlSink } from '../../../../src/core/log/jsonl-sink';
import { createLogger, type LogSink } from '../../../../src/core/log/logger';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';

class ArraySink implements LogSink {
  lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  records(): Record<string, unknown>[] {
    return this.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

describe('logger', () => {
  it('writes JSON lines with ts, level, component, event and fields', () => {
    const sink = new ArraySink();
    const log = createLogger({ sink, clock: new FakeClock(0), component: 'main' });
    log.info('launch', { agent: 'claude', durationMs: 12 });
    log.child('git').warn('slow');
    expect(sink.records()).toEqual([
      {
        ts: '1970-01-01T00:00:00.000Z',
        level: 'info',
        component: 'main',
        event: 'launch',
        agent: 'claude',
        durationMs: 12,
      },
      { ts: '1970-01-01T00:00:00.000Z', level: 'warn', component: 'git', event: 'slow' },
    ]);
  });

  it('respects the minimum level', () => {
    const sink = new ArraySink();
    const log = createLogger({ sink, clock: new FakeClock(0), component: 'x', minLevel: 'warn' });
    log.debug('a');
    log.info('b');
    log.error('c');
    expect(sink.records().map((r) => r.event)).toEqual(['c']);
  });

  it('serializes err with name, message, code and stack', () => {
    const sink = new ArraySink();
    createLogger({ sink, clock: new FakeClock(0), component: 'x' }).error('fail', {
      err: new MelinnaError('GIT_FAILED'),
    });
    const err = sink.records()[0]?.err as Record<string, unknown>;
    expect(err.name).toBe('MelinnaError');
    expect(err.code).toBe('GIT_FAILED');
    expect(typeof err.stack).toBe('string');
  });

  it('drops prompt, input, output and env with a warning', () => {
    const sink = new ArraySink();
    createLogger({ sink, clock: new FakeClock(0), component: 'x' }).info('launch', {
      prompt: 'segredo do usuário',
      input: 'tecla',
      output: 'bytes',
      env: 'PATH=…',
      size: 3,
    });
    expect(sink.lines.join('\n')).not.toContain('segredo');
    expect(sink.lines.join('\n')).not.toContain('tecla');
    expect(sink.records()[0]).toMatchObject({ event: 'launch', size: 3 });
    expect(sink.records()[1]).toMatchObject({
      level: 'warn',
      event: 'log.fields_dropped',
      fields: 'prompt,input,output,env',
    });
  });
});

describe('JsonlSink', () => {
  it('appends lines and rotates at the size limit keeping 3 files', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/logs', { recursive: true });
    const sink = new JsonlSink(fs, '/logs/main.log', { maxBytes: 20, maxFiles: 3 });
    for (let i = 0; i < 8; i++) sink.write(`line-${i}-xxxxxx`); // 16 bytes cada com \n
    await sink.flush();
    expect(fs.readText('/logs/main.log')).toBe('line-7-xxxxxx\n');
    expect(fs.readText('/logs/main.log.1')).toBe('line-6-xxxxxx\n');
    expect(fs.readText('/logs/main.log.2')).toBe('line-5-xxxxxx\n');
    expect(await fs.exists('/logs/main.log.3')).toBe(false);
  });

  it('defaults to 5 MB and survives disk errors', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/logs', { recursive: true });
    fs.failOn('appendFile', '/logs/h.log', 'ENOSPC', 1);
    const sink = new JsonlSink(fs, '/logs/h.log');
    sink.write('a');
    sink.write('b');
    await sink.flush();
    expect(fs.readText('/logs/h.log')).toBe('b\n');
  });
});
