import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', () => ({
  realpath: async (path: string) => path,
  stat: async () => ({ isDirectory: () => true }),
}));
import { IdeService } from '../../../src/main/ide-service';
import { MessageFramer, encodeMessage } from '../../../src/core/ide/framing';
import type { ProtocolProcess } from '../../../src/core/ports/protocol-process';
import { FakeClock } from '../../support/fakes/clock';

const root = process.platform === 'win32' ? 'C:\\repo' : '/repo';
const file = root + (process.platform === 'win32' ? '\\a.ts' : '/a.ts');
const outside = process.platform === 'win32' ? 'C:\\outside\\secret.ts' : '/outside/secret.ts';
function setup() {
  let receive: (bytes: Uint8Array) => void = () => undefined;
  const parser = new MessageFramer();
  const child: ProtocolProcess = {
    write(bytes) {
      for (const message of parser.push(bytes))
        if (typeof message.id === 'number')
          receive(
            encodeMessage({
              jsonrpc: '2.0',
              id: message.id,
              result:
                message.method === 'initialize'
                  ? { capabilities: { textDocumentSync: 1, definitionProvider: true } }
                  : [
                      {
                        uri: pathToFileURL(outside).href,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                      },
                    ],
            }),
          );
    },
    onData: (fn) => {
      receive = fn;
      return () => undefined;
    },
    onExit: () => () => undefined,
    close: vi.fn(),
  };
  const factory = { start: vi.fn(async () => child) };
  const service = new IdeService({
    files: { roots: () => [{ path: root, label: 'Repo', kind: 'workspace' }] },
    factory,
    clock: new FakeClock(),
    emit: vi.fn(),
  });
  return { service, factory, child };
}
describe('IDE service boundaries', () => {
  it('rejects external roots and .git before launching a process', async () => {
    const s = setup();
    await expect(
      s.service.start({ protocol: 'lsp', root: outside, executable: 'server', args: [] }),
    ).rejects.toMatchObject({ code: 'FILE_OUTSIDE_ROOT' });
    await expect(s.service.canonical(root + '/.git/config')).rejects.toMatchObject({
      code: 'FILE_OUTSIDE_ROOT',
    });
    expect(s.factory.start).not.toHaveBeenCalled();
  });
  it('refuses navigation outside the current worktree and releases the process on close', async () => {
    const s = setup();
    const { sessionId } = await s.service.start({ protocol: 'lsp', root, executable: 'server', args: [] });
    const uri = pathToFileURL(file).href;
    await s.service.call(
      {
        sessionId,
        method: 'textDocument/didOpen',
        params: { textDocument: { uri, text: 'a', version: 1, languageId: 'typescript' } },
      },
      true,
    );
    await expect(
      s.service.call({
        sessionId,
        method: 'textDocument/definition',
        params: { textDocument: { uri }, position: { line: 0, character: 0 } },
      }),
    ).rejects.toMatchObject({ code: 'FILE_OUTSIDE_ROOT' });
    s.service.close();
    expect(s.child.close).toHaveBeenCalled();
    await expect(
      s.service.start({ protocol: 'lsp', root, executable: 'server', args: [] }),
    ).rejects.toThrow();
  });
});
