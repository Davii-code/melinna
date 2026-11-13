import { describe, expect, it, vi } from 'vitest';
import { LanguageService } from '../../../../src/core/ide/language-service';

describe('LanguageService', () => {
  it('negotiates capabilities and translates full drafts to incremental edits', async () => {
    const client = {
      request: vi.fn(async () => ({ capabilities: { textDocumentSync: 2, hoverProvider: true } })),
      notify: vi.fn(),
      close: vi.fn(),
    };
    const service = new LanguageService(client);
    await service.initialize('file:///repo');
    expect(client.notify).toHaveBeenCalledWith('initialized', {});
    service.notify('textDocument/didOpen', {
      textDocument: { uri: 'file:///repo/a.ts', text: 'one\ntwo', languageId: 'typescript', version: 1 },
    });
    service.notify('textDocument/didChange', {
      textDocument: { uri: 'file:///repo/a.ts', version: 2 },
      contentChanges: [{ text: 'new' }],
    });
    expect(client.notify).toHaveBeenLastCalledWith(
      'textDocument/didChange',
      expect.objectContaining({
        contentChanges: [
          { range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } }, text: 'new' },
        ],
      }),
    );
    expect(() =>
      service.notify('textDocument/didChange', {
        textDocument: { uri: 'file:///repo/a.ts', version: 1 },
        contentChanges: [{ text: 'stale' }],
      }),
    ).toThrow();
    await expect(
      service.request('textDocument/rename', {
        textDocument: { uri: 'file:///repo/a.ts' },
        position: { line: 0, character: 0 },
        newName: 'x',
      }),
    ).rejects.toThrow();
  });
  it('discards a response after a document changes', async () => {
    let finish!: (value: unknown) => void;
    const client = {
      request: vi
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValueOnce({ capabilities: { textDocumentSync: 1, hoverProvider: true } })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        ),
      notify: vi.fn(),
      close: vi.fn(),
    };
    const service = new LanguageService(client);
    await service.initialize('file:///repo');
    service.notify('textDocument/didOpen', {
      textDocument: { uri: 'file:///repo/a', version: 1, text: 'a', languageId: 'text' },
    });
    const result = service.request('textDocument/hover', {
      textDocument: { uri: 'file:///repo/a' },
      position: { line: 0, character: 0 },
    });
    const check = expect(result).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    service.notify('textDocument/didChange', {
      textDocument: { uri: 'file:///repo/a', version: 2 },
      contentChanges: [{ text: 'b' }],
    });
    finish({ contents: 'old' });
    await check;
  });
});
