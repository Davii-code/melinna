import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { DiffView, FileSection } from '../../../src/renderer/components/DiffView/DiffView';
import type { DiffResult, FileDiff } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

function textFile(path: string, change: FileDiff['change'], lines: number, extra: Partial<FileDiff> = {}): FileDiff {
  return {
    path,
    change,
    hunks: [
      {
        header: '@@ -1,1 +1,2 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: lines,
        lines: [
          { kind: 'del', text: 'antigo', oldNo: 1, newNo: null },
          ...Array.from({ length: lines }, (_, i) => ({
            kind: 'add' as const,
            text: `novo ${i + 1}`,
            oldNo: null,
            newNo: i + 1,
          })),
        ],
      },
    ],
    lineCount: lines + 1,
    ...extra,
  };
}

const RESULT: DiffResult = {
  files: [
    textFile('src/a.ts', 'modified', 1),
    textFile('para.ts', 'renamed', 1, { oldPath: 'de.ts' }),
    { path: 'img.png', change: 'modified', binary: { oldSize: 1024, newSize: 2048 }, hunks: [], lineCount: 0 },
    { path: 'nova.bin', change: 'added', binary: { oldSize: null, newSize: 10 }, hunks: [], lineCount: 0 },
    textFile('enorme.txt', 'untracked', 5001),
  ],
};

function setup(result: DiffResult = RESULT) {
  const api = fakeApi();
  api.executions.diff.mockImplementation(() => okR(result));
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <DiffView execId="e1" title="Claude Code" onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onClose };
}

describe('DiffView', () => {
  it('lists files with their kind of change', async () => {
    setup();
    const list = await screen.findByRole('list', { name: /arquivos alterados/i });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      expect.stringContaining('src/a.ts'),
      expect.stringMatching(/de\.ts → para\.ts.*renomeado/),
      expect.stringContaining('img.png'),
      expect.stringMatching(/nova\.bin.*adicionado/),
      expect.stringMatching(/enorme\.txt.*não rastreado/),
    ]);
  });

  it('switches between unified and side by side without fetching again', async () => {
    const { api } = setup();
    const file = await screen.findByTestId('diff-file-src/a.ts');
    expect(within(file).getByTestId('diff-unified')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /lado a lado/i }));
    const split = within(screen.getByTestId('diff-file-src/a.ts')).getByTestId('diff-split');
    expect(within(split).getByText('antigo')).toBeTruthy();
    expect(within(split).getByText('novo 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /unificado/i }));
    expect(within(screen.getByTestId('diff-file-src/a.ts')).getByTestId('diff-unified')).toBeTruthy();
    expect(api.executions.diff).toHaveBeenCalledTimes(1);
  });

  it('shows binary files with sizes and no content', async () => {
    setup();
    const img = await screen.findByTestId('diff-file-img.png');
    expect(within(img).getByText(/binário alterado/i).textContent).toMatch(/1,0 KB → 2,0 KB/);
    const bin = screen.getByTestId('diff-file-nova.bin');
    expect(within(bin).getByText(/binário alterado/i).textContent).toMatch(/— → 10 B/);
  });

  it('collapses files above 5,000 lines until asked', async () => {
    setup();
    const big = await screen.findByTestId('diff-file-enorme.txt');
    expect(within(big).queryByTestId('diff-unified')).toBeNull();
    const show = within(big).getByRole('button', { name: /mostrar 5\.002 linhas/i });
    fireEvent.click(show);
    expect(within(screen.getByTestId('diff-file-enorme.txt')).getByTestId('diff-unified')).toBeTruthy();
  });

  it('shows an empty state and errors', async () => {
    setup({ files: [] });
    expect(await screen.findByText(/nenhuma alteração/i)).toBeTruthy();
  });

  it('shows the error message from the main process', async () => {
    const api = fakeApi();
    api.executions.diff.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'GIT_FAILED', message: 'O comando git diff falhou' } }),
    );
    render(
      <ApiContext.Provider value={api}>
        <DiffView execId="e1" title="X" onClose={() => undefined} />
      </ApiContext.Provider>,
    );
    expect(await screen.findByText('O comando git diff falhou')).toBeTruthy();
  });

  it('closes', async () => {
    const { onClose } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /fechar diff/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('sends a comment about a line to the agent of the execution', async () => {
    const { api } = setup();
    const file = await screen.findByTestId('diff-file-src/a.ts');
    fireEvent.click(within(file).getByRole('button', { name: 'Comentar linha 1' }));
    fireEvent.change(within(file).getByRole('textbox', { name: /comentário sobre linha 1/i }), {
      target: { value: 'renomeie para total' },
    });
    fireEvent.click(within(file).getByRole('button', { name: /enviar ao agente/i }));
    expect(await within(file).findByRole('status')).toHaveProperty(
      'textContent',
      'Comentário enviado ao agente.',
    );
    expect(api.prompts.send).toHaveBeenCalledTimes(1);
    expect(api.prompts.send).toHaveBeenCalledWith(
      expect.objectContaining({
        execIds: ['e1'],
        values: {
          arquivo: 'src/a.ts',
          linha: 'linha 1',
          trecho: '+novo 1',
          comentario: 'renomeie para total',
        },
      }),
    );
    fireEvent.click(within(file).getByRole('button', { name: /fechar/i }));
    expect(within(file).queryByRole('status')).toBeNull();
  });

  it('comments on a removed line from the side by side view', async () => {
    const { api } = setup();
    await screen.findByTestId('diff-file-src/a.ts');
    fireEvent.click(screen.getByRole('button', { name: /lado a lado/i }));
    const file = screen.getByTestId('diff-file-src/a.ts');
    fireEvent.click(within(file).getByRole('button', { name: 'Comentar linha 1 (removida)' }));
    fireEvent.change(within(file).getByRole('textbox'), { target: { value: 'por que saiu?' } });
    fireEvent.click(within(file).getByRole('button', { name: /enviar ao agente/i }));
    await waitFor(() => expect(api.prompts.send).toHaveBeenCalledTimes(1));
    expect(api.prompts.send.mock.calls[0]![0]).toMatchObject({
      values: { linha: 'linha 1 (removida)', trecho: '-antigo' },
    });
  });

  it('does not send an empty comment and cancels without sending', async () => {
    const { api } = setup();
    const file = await screen.findByTestId('diff-file-src/a.ts');
    fireEvent.click(within(file).getByRole('button', { name: 'Comentar linha 1' }));
    const send = within(file).getByRole('button', { name: /enviar ao agente/i });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.change(within(file).getByRole('textbox'), { target: { value: '   ' } });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.click(within(file).getByRole('button', { name: /cancelar/i }));
    expect(within(file).queryByRole('textbox')).toBeNull();
    expect(api.prompts.send).not.toHaveBeenCalled();
  });

  it('says why the comment was not sent and keeps the text', async () => {
    const { api } = setup();
    api.prompts.send.mockImplementation(() => okR([{ execId: 'e1', status: 'not-running' as const }]));
    const file = await screen.findByTestId('diff-file-src/a.ts');
    fireEvent.click(within(file).getByRole('button', { name: 'Comentar linha 1' }));
    const box = within(file).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'ajuste isso' } });
    fireEvent.click(within(file).getByRole('button', { name: /enviar ao agente/i }));
    expect(await within(file).findByText('Não enviado: sessão encerrada')).toBeTruthy();
    expect(box).toHaveProperty('value', 'ajuste isso');
    expect(within(file).queryByRole('status')).toBeNull();
  });

  it('shows the error from the main process when sending fails', async () => {
    const { api } = setup();
    api.prompts.send.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'INPUT_INVALID', message: 'O prompt contém caracteres de controle; remova-os.' } }),
    );
    const file = await screen.findByTestId('diff-file-src/a.ts');
    fireEvent.click(within(file).getByRole('button', { name: 'Comentar linha 1' }));
    fireEvent.change(within(file).getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(within(file).getByRole('button', { name: /enviar ao agente/i }));
    expect(await within(file).findByText(/caracteres de controle/)).toBeTruthy();
  });

  it('offers no comment button when the diff has no execution', () => {
    render(
      <ApiContext.Provider value={fakeApi()}>
        <FileSection file={RESULT.files[0]!} mode="unified" />
      </ApiContext.Provider>,
    );
    expect(screen.queryByRole('button', { name: /comentar/i })).toBeNull();
  });
});
