import { describe, expect, it } from 'vitest';
import { openExternal, validateExternalUrl } from '../../../src/main/open-external';

describe('openExternal', () => {
  it('accepts only http and https', async () => {
    expect(validateExternalUrl('http://example.com')).toBe('http://example.com/');
    expect(validateExternalUrl('https://example.com/x')).toBe('https://example.com/x');
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://x',
      'not a url',
      '',
      42,
      'https://' + 'a'.repeat(3000),
    ]) {
      expect(() => validateExternalUrl(bad)).toThrow(expect.objectContaining({ code: 'INPUT_INVALID' }));
    }
    const opened: string[] = [];
    await openExternal('https://melinna.dev', async (u) => void opened.push(u));
    await expect(openExternal('file:///x', async (u) => void opened.push(u))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(opened).toEqual(['https://melinna.dev/']);
  });
});
