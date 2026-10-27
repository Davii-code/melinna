import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDelegationBridge } from '../../../../src/main/orchestration/mcp-bridge';
const bridges: LocalDelegationBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((b) => b.close()));
});
function setup() {
  const call = vi.fn(async (runId: string, name: string, args: unknown) => ({ runId, name, args }));
  const bridge = new LocalDelegationBridge(call);
  bridges.push(bridge);
  return { bridge, call };
}
async function rpc(connection: { url: string; token: string }, method: string, params?: unknown) {
  return fetch(connection.url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + connection.token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
describe('local MCP bridge over real HTTP', () => {
  it('negotiates MCP and exposes the five bounded tools', async () => {
    const { bridge } = setup();
    const connection = await bridge.open('run-one');
    const init = await rpc(connection, 'initialize', { protocolVersion: '2025-06-18' });
    expect(await init.json()).toMatchObject({
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'melinna-orchestration' } },
    });
    const list = await rpc(connection, 'tools/list');
    const value = (await list.json()) as { result: { tools: { name: string }[] } };
    expect(value.result.tools.map((t) => t.name)).toEqual([
      'delegate_task',
      'get_task',
      'collect_results',
      'wait_tasks',
      'cancel_task',
    ]);
  });
  it('scopes calls to the authenticated run and rejects a revoked token', async () => {
    const { bridge, call } = setup();
    const one = await bridge.open('one');
    const two = await bridge.open('two');
    await rpc(one, 'tools/call', { name: 'collect_results', arguments: { runId: 'two' } });
    expect(call).toHaveBeenCalledWith('one', 'collect_results', { runId: 'two' });
    bridge.revoke('one');
    expect((await rpc(one, 'tools/list')).status).toBe(401);
    expect((await rpc(two, 'tools/list')).status).toBe(200);
  });
  it('rejects unauthenticated requests, browser origins and unknown tools', async () => {
    const { bridge, call } = setup();
    const connection = await bridge.open('one');
    expect((await fetch(connection.url)).status).toBe(401);
    expect(
      (
        await fetch(connection.url, {
          headers: { Authorization: 'Bearer ' + connection.token, Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    const response = await rpc(connection, 'tools/call', { name: 'shell', arguments: {} });
    expect(await response.json()).toMatchObject({ result: { isError: true } });
    expect(call).not.toHaveBeenCalled();
  });
});
