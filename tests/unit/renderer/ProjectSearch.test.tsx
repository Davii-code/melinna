import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ProjectSearch } from '../../../src/renderer/components/Search/ProjectSearch';
import type { ProjectSearchResult, SearchHit } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  path: '/ws/src/a.ts',
  line: 3,
  column: 7,
  preview: 'const alfa = 1;',
  matchStart: 6,
  matchEnd: 10,
  ...over,
});

const RESULT: ProjectSearchResult = {
  hits: [
    hit(),
    hit({ line: 9, column: 1, preview: 'alfa();', matchStart: 0, matchEnd: 4 }),
    hit({ path: '/ws/src/b.ts', line: 1, column: 1, preview: 'alfa', matchStart: 0, matchEnd: 4 }),
  ],
  truncated: false,
  scannedFiles: 12,
  skipped: 0,
};

function setup(over: Partial<React.ComponentProps<typeof ProjectSearch>> = {}) {
  const api = fakeApi();
  api.files.searchProject.mockImplementation(() => okR(RESULT));
  api.files.read.mockImplementation(() =>
    okR({
      path: '/ws/src/a.ts',
      content: ['l1', 'l2', 'const alfa = 1;', 'l4', 'l5', 'l6', 'l7', 'l8', 'alfa();'].join('\n'),
      size: 10,
      binary: false,
      truncated: false,
      hash: 'a'.repeat(64),
    }),
  );
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <ProjectSearch roots={['/ws']} onOpen={onOpen} onClose={onClose} {...over} />
    </ApiContext.Provider>,
  );
  return { api, onOpen, onClose };
}

const field = () => screen.getByLabelText('Texto da busca') as HTMLInputElement;
const submit = () => fireEvent.submit(field().closest('form') as HTMLFormElement);

async function typeAndSearch(text: string) {
  fireEvent.change(field(), { target: { value: text } });
  await act(async () => {
    submit();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ProjectSearch — consulta', () => {
  it('has the focus on the field and the four options', () => {
    setup();
    expect(document.activeElement).toBe(field());
    for (const label of ['Maiúsculas', 'Palavra inteira', 'Expressão regular', 'Arquivos']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('sends the roots, the text and the options to the main process', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByLabelText('Maiúsculas'));
    fireEvent.click(screen.getByLabelText('Palavra inteira'));
    fireEvent.click(screen.getByLabelText('Expressão regular'));
    fireEvent.change(screen.getByLabelText('Arquivos'), { target: { value: ' *.ts, src/** ' } });
    await typeAndSearch('alfa');
    expect(api.files.searchProject).toHaveBeenLastCalledWith({
      roots: ['/ws'],
      text: 'alfa',
      caseSensitive: true,
      wholeWord: true,
      regex: true,
      include: '*.ts, src/**',
    });
  });

  it('does not send an include filter when the field is blank', async () => {
    const { api } = setup();
    await typeAndSearch('alfa');
    const [query] = api.files.searchProject.mock.calls.at(-1) as unknown as [Record<string, unknown>];
    expect(query).not.toHaveProperty('include');
  });

  it('searches by itself after a pause in typing', async () => {
    vi.useFakeTimers();
    const { api } = setup();
    fireEvent.change(field(), { target: { value: 'alfa' } });
    expect(api.files.searchProject).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.files.searchProject).toHaveBeenCalledTimes(1);
  });

  it('searches again when an option changes', async () => {
    vi.useFakeTimers();
    const { api } = setup();
    fireEvent.change(field(), { target: { value: 'alfa' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(screen.getByLabelText('Palavra inteira'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(api.files.searchProject).toHaveBeenCalledTimes(2);
    expect(api.files.searchProject).toHaveBeenLastCalledWith(expect.objectContaining({ wholeWord: true }));
  });

  it('searches right away with the text that came from the editor selection', async () => {
    vi.useFakeTimers();
    const { api } = setup({ initialText: 'alfa' });
    expect(field().value).toBe('alfa');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.files.searchProject).toHaveBeenCalledWith(expect.objectContaining({ text: 'alfa' }));
  });

  it('keeps only the answer of the latest search', async () => {
    const { api } = setup();
    let release: (v: unknown) => void = () => undefined;
    api.files.searchProject.mockImplementationOnce(
      () =>
        new Promise((resolve) => (release = resolve as (v: unknown) => void)) as ReturnType<
          typeof api.files.searchProject
        >,
    );
    fireEvent.change(field(), { target: { value: 'alfa' } });
    await act(async () => {
      submit();
    });
    api.files.searchProject.mockImplementationOnce(() =>
      okR({
        hits: [hit({ path: '/ws/novo.ts', preview: 'novo', matchEnd: 4, matchStart: 0 })],
        truncated: false,
        scannedFiles: 1,
        skipped: 0,
      }),
    );
    fireEvent.change(field(), { target: { value: 'novo' } });
    await act(async () => {
      submit();
    });
    await act(async () => {
      release({ ok: true, value: RESULT });
    });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('novo.ts', { exact: false })).toBeTruthy();
  });
});

describe('ProjectSearch — resultados', () => {
  it('groups by file with line and snippet, highlighting the match', async () => {
    setup();
    await typeAndSearch('alfa');
    const results = screen.getByRole('listbox', { name: 'Resultados' });
    expect(within(results).getByText('src/a.ts', { exact: false }).textContent).toContain('2');
    expect(within(results).getByText('src/b.ts', { exact: false }).textContent).toContain('1');
    const options = within(results).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain('3');
    expect(options[0]?.querySelector('mark')?.textContent).toBe('alfa');
    expect(options[1]?.textContent).toContain('alfa();');
  });

  it('shows a preview of the active hit with the lines around it', async () => {
    setup();
    await typeAndSearch('alfa');
    const preview = await screen.findByLabelText('Prévia');
    const lines = [...preview.querySelectorAll('.preview-line')].map((l) => l.textContent);
    expect(lines).toEqual(['1l1', '2l2', '3const alfa = 1;', '4l4', '5l5', '6l6']);
    expect(preview.querySelector('.current')?.textContent).toBe('3const alfa = 1;');
  });

  it('moves the active hit with the arrows and updates the preview', async () => {
    setup();
    await typeAndSearch('alfa');
    await screen.findByLabelText('Prévia');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    await waitFor(() =>
      expect(screen.getByLabelText('Prévia').querySelector('.current')?.textContent).toContain('9alfa();'),
    );
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('opens the clicked hit and closes the popup', async () => {
    const { onOpen, onClose } = setup();
    await typeAndSearch('alfa');
    fireEvent.click(screen.getAllByRole('option')[1] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/ws/src/a.ts', line: 9, column: 1 }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the active hit on Enter once the results answer the text on screen', async () => {
    const { onOpen, api } = setup();
    await typeAndSearch('alfa');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    await act(async () => {
      submit();
    });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ line: 9 }));
    expect(api.files.searchProject).toHaveBeenCalledTimes(1);
  });

  it('searches again, instead of opening a stale hit, when the text changed after the results', async () => {
    const { onOpen, api } = setup();
    await typeAndSearch('alfa');
    fireEvent.change(field(), { target: { value: 'alfab' } });
    await act(async () => {
      submit();
    });
    expect(onOpen).not.toHaveBeenCalled();
    expect(api.files.searchProject).toHaveBeenCalledTimes(2);
  });

  it('says there were no results', async () => {
    const { api } = setup();
    api.files.searchProject.mockImplementation(() =>
      okR({ hits: [], truncated: false, scannedFiles: 4, skipped: 0 }),
    );
    await typeAndSearch('zzz');
    expect(screen.getByText('Nenhum resultado')).toBeTruthy();
  });

  it('warns when there are too many results', async () => {
    const { api } = setup();
    api.files.searchProject.mockImplementation(() => okR({ ...RESULT, truncated: true }));
    await typeAndSearch('alfa');
    expect(screen.getByText('Resultados demais, refine a busca.')).toBeTruthy();
  });

  it('says how many files were skipped for lack of permission', async () => {
    const { api } = setup();
    api.files.searchProject.mockImplementation(() => okR({ ...RESULT, skipped: 2 }));
    await typeAndSearch('alfa');
    expect(screen.getByText('2 arquivo(s) sem permissão de leitura foram pulados.')).toBeTruthy();
  });
});

describe('ProjectSearch — erros, andamento e Esc', () => {
  it('shows the regular expression error next to the field, with no results', async () => {
    const { api } = setup();
    api.files.searchProject.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'SEARCH_REGEX_INVALID' as const, message: 'Expressão regular inválida: (' },
      }),
    );
    await typeAndSearch('(');
    expect(screen.getByRole('alert').textContent).toBe('Expressão regular inválida: (');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the timeout message', async () => {
    const { api } = setup();
    api.files.searchProject.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: 'SEARCH_TIMEOUT' as const,
          message: 'A busca demorou demais; simplifique a expressão.',
        },
      }),
    );
    await typeAndSearch('(a+)+$');
    expect(screen.getByRole('alert').textContent).toContain('demorou demais');
  });

  it('shows "Buscando…" with Cancelar, and Cancelar stops it through an empty search', async () => {
    const { api } = setup();
    api.files.searchProject.mockImplementationOnce(
      () => new Promise(() => undefined) as ReturnType<typeof api.files.searchProject>,
    );
    fireEvent.change(field(), { target: { value: 'alfa' } });
    await act(async () => {
      submit();
    });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Buscando…');
    await act(async () => {
      fireEvent.click(within(status).getByRole('button', { name: 'Cancelar' }));
    });
    expect(api.files.searchProject).toHaveBeenLastCalledWith(expect.objectContaining({ text: '' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Esc while searching cancels the search and closes the popup', async () => {
    const { api, onClose } = setup();
    api.files.searchProject.mockImplementationOnce(
      () => new Promise(() => undefined) as ReturnType<typeof api.files.searchProject>,
    );
    fireEvent.change(field(), { target: { value: 'alfa' } });
    await act(async () => {
      submit();
    });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(api.files.searchProject).toHaveBeenLastCalledWith(expect.objectContaining({ text: '' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc with no search running just closes, without calling the main process', () => {
    const { api, onClose } = setup();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.files.searchProject).not.toHaveBeenCalled();
  });

  it('clearing the text cancels and clears the results', async () => {
    vi.useFakeTimers();
    const { api } = setup();
    fireEvent.change(field(), { target: { value: 'alfa' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.change(field(), { target: { value: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(api.files.searchProject).toHaveBeenCalledTimes(1);
  });
});
