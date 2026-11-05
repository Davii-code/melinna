import { describe, it, expect } from 'vitest';
import { springDebugArgs } from '../../../../src/shared/java-debug';
describe('Spring application JVM debugging', () => {
  it('binds only loopback and suspends the application until attach', () => {
    expect(springDebugArgs([])).toEqual([
      '-Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:5005',
    ]);
  });
  it('keeps existing JVM arguments, profiles and shell characters literal', () => {
    const args = ['-Dspring-boot.run.profiles=dev', '-Dspring-boot.run.jvmArguments=-Xmx1g -Dname="a & b"'];
    const result = springDebugArgs(args, 5006);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(args[0]);
    expect(result[1]).toContain('-Xmx1g -Dname="a & b" -agentlib:jdwp=');
    expect(result[1]).toContain('127.0.0.1:5006');
    expect(springDebugArgs(result)).toEqual(result);
  });
  it('rejects invalid ports', () => {
    for (const port of [0, 80, 65536, NaN, 5005.5]) expect(() => springDebugArgs([], port)).toThrow();
  });
});
