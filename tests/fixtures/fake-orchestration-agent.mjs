import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('melinna-fake-agent 1.0');
  process.exit(0);
}
const mode = process.env.MELINNA_FAKE_MODE;
if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk.toString();
  if (mode === 'bad-json') {
    console.log('invalid-json');
    process.exit(0);
  }
  if (mode === 'exit-error') {
    console.error('fake authentication error');
    process.exit(2);
  }
  const claude = args.includes('--output-format');
  const resume = args.includes('--resume') || args.includes('resume');
  let result = 'result-' + (claude ? 'claude' : 'codex');
  const token = process.env.MELINNA_ORCHESTRATION_TOKEN;
  if (token && mode !== 'leak') {
    if (!claude) {
      for (const name of ['delegate_task', 'get_task', 'collect_results', 'wait_tasks', 'cancel_task']) {
        if (!args.includes('mcp_servers.melinna.tools.' + name + '.approval_mode="approve"'))
          throw new Error('Missing scoped MCP authorization for ' + name);
      }
    }
    if (!resume) {
      let url;
      if (claude) url = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.melinna.url;
      else
        url = JSON.parse(
          args
            .find((arg) => arg.startsWith('mcp_servers.melinna.url='))
            .split('=')
            .slice(1)
            .join('='),
        );
      if (new URL(url).hostname !== '127.0.0.1') throw new Error('Fixture only accepts loopback');
      const call = async (method, params) => {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
        });
        if (!response.ok) throw new Error('MCP HTTP ' + response.status);
        const value = await response.json();
        if (value.error || value.result?.isError) throw new Error(JSON.stringify(value));
        return value;
      };
      await call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'melinna-test', version: '1' },
      });
      await call('tools/list', {});
      await Promise.all(
        ['researcher', 'developer'].map((roleId) =>
          call('tools/call', {
            name: 'delegate_task',
            arguments: { roleId, prompt: 'Fixture task for ' + roleId, requestKey: roleId },
          }),
        ),
      );
      result = 'Workers delegated';
    } else {
      if (!prompt.includes('result-claude') || !prompt.includes('result-codex'))
        throw new Error('Missing worker results in coordinator continuation');
      result = 'Equipe finalizada: Claude e Codex responderam.';
    }
  } else if (mode === 'leak') result = 'secret: ' + token;
  else if (args.includes('workspace-write') || args.some((arg) => arg.includes('Edit,Write')))
    writeFileSync(join(process.cwd(), 'worker-result.txt'), 'fake worker change\n');
  const session = randomUUID();
  const emit = (event) => console.log(JSON.stringify(event));
  if (claude) {
    emit({ type: 'system', subtype: 'init', session_id: session });
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: result }] } });
    emit({
      type: 'result',
      subtype: mode === 'denied' ? 'error_during_execution' : 'success',
      result,
      session_id: session,
      is_error: mode === 'denied',
      usage: { input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0.001,
    });
  } else {
    emit({ type: 'thread.started', thread_id: session });
    if (mode === 'mcp-denied')
      emit({
        type: 'item.completed',
        item: { type: 'mcp_tool_call', error: { message: 'Tool requires approval but policy is never' } },
      });
    emit({ type: 'item.completed', item: { type: 'agent_message', text: result } });
    if (mode !== 'missing-final')
      emit({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 } });
  }
}
