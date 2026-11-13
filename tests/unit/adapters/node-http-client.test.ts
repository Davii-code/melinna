import { describe, expect, it, vi } from 'vitest';
import { NodeHttpClient } from '../../../src/adapters/node-http-client';

const request = {
  id: 'r1',
  url: 'https://example.test/data?secret=hidden',
  method: 'GET',
  headers: {},
  body: '',
};
describe('HTTP client', () => {
  it('returns bounded response data and safe history metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const client = new NodeHttpClient(fetcher);
    expect(await client.send(request)).toMatchObject({ status: 200, body: 'ok', truncated: false });
    expect(client.history()).toEqual([
      expect.objectContaining({ origin: 'https://example.test', method: 'GET' }),
    ]);
    expect(JSON.stringify(client.history())).not.toContain('secret');
  });
  it('rejects non-http URLs and cross-origin redirects', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://other.test' } }));
    const client = new NodeHttpClient(fetcher);
    await expect(client.send({ ...request, url: 'file:///tmp/a' })).rejects.toThrow();
    await expect(client.send(request)).rejects.toThrow();
  });
  it('cancels in-flight requests and releases their identifiers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const client = new NodeHttpClient(fetcher);
    const pending = client.send(request);
    const check = expect(pending).rejects.toThrow();
    client.cancel('r1');
    await check;
    fetcher.mockResolvedValueOnce(new Response('again'));
    await expect(client.send(request)).resolves.toMatchObject({ body: 'again' });
  });
});
