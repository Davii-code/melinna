import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { DiffPane } from '../../../src/renderer/components/Git/DiffPane';
import type { FileDiff, Result } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const diff = (over: Partial<FileDiff> = {}): FileDiff => ({
  path: 'src/a.ts',
  change: 'modified',
  hunks: [
    {
      header: '@@ -1 +1 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [
        { kind: 'del', text: 'velho', oldNo: 1, newNo: null },
        { kind: 'add', text: 'novo', oldNo: null, newNo: 1 },
      ],
    },
  ] as unknown as FileDiff['hunks'],
  lineCount: 2,
  ...over,
});

function setup(result: Promise<Result<FileDiff>> = okR(diff())) {
  const api = fakeApi();
  api.git.diffFile.mockImplementation(() => result);
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <DiffPane root="/repo" path="src/a.ts" onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onClose };
}

describe('DiffPane', () => {
  it('shows the diff of the file with its path in the title', async () => {
    const { api } = setup();
    expect(await screen.findByText('novo')).toBeTruthy();
    expect(api.git.diffFile).toHaveBeenCalledWith('/repo', 'src/a.ts');
    expect(screen.getByRole('heading', { name: /src\/a\.ts/ })).toBeTruthy();
  });

  it('shows sizes for a binary file', async () => {
    setup(okR(diff({ binary: { oldSize: 1024, newSize: 2048 }, hunks: [] })));
    expect(await screen.findByText(/Binário alterado/)).toBeTruthy();
  });

  it('says a diff is too large to show', async () => {
    setup(okR(diff({ tooLarge: true, hunks: [] })));
    expect(await screen.findByText(/grande demais/)).toBeTruthy();
  });

  it('shows the error of the diff', async () => {
    setup(Promise.resolve({ ok: false, error: { code: 'REPO_INVALID', message: 'Falhou ao calcular.' } as never }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Falhou ao calcular.');
  });

  it('closes with "Fechar diff"', async () => {
    const { onClose } = setup();
    await waitFor(() => screen.getByText('novo'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar diff' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
