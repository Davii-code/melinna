import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ImagePreview } from '../../../src/renderer/components/Panel/ImagePreview';
import type { Execution, ImageCheck } from '../../../src/shared/ipc-contract';
import { fakeApi, imageRef } from '../../support/fake-api';
import { execution } from '../../support/renderer-fixtures';

const CHECK: ImageCheck = {
  accepted: [
    imageRef({ path: '/anexos/e1/1-1.png', bytes: 2048 }),
    imageRef({ path: 'C:\\Meus Dados\\print.jpg', type: 'jpeg', bytes: 3 * 1024 * 1024, source: 'file' }),
  ],
  rejected: [{ path: '/m/relatorio.pdf', reason: 'Formato não aceito: use PNG, JPEG, GIF ou WebP.' }],
};

function setup(check: ImageCheck = CHECK, exec: Execution = execution('e1', { status: 'running' })) {
  const api = fakeApi();
  const onClose = vi.fn();
  const view = render(
    <ApiContext.Provider value={api}>
      <ImagePreview execution={exec} check={check} onClose={onClose} />
    </ApiContext.Provider>,
  );
  const rerender = (next: Execution) =>
    view.rerender(
      <ApiContext.Provider value={api}>
        <ImagePreview execution={next} check={check} onClose={onClose} />
      </ApiContext.Provider>,
    );
  return { api, onClose, rerender };
}

describe('ImagePreview', () => {
  it('shows a thumbnail, the file name and the size of each accepted image', () => {
    setup();
    expect(screen.getByRole('img', { name: '1-1.png' }).getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(screen.getByRole('img', { name: 'print.jpg' })).toBeTruthy();
    expect(screen.getByText('2.0 kB')).toBeTruthy();
    expect(screen.getByText('3.0 MB')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Anexar imagens' })).toBeTruthy();
  });

  it('uses the singular title for one image', () => {
    setup({ accepted: [CHECK.accepted[0]!], rejected: [] });
    expect(screen.getByRole('dialog', { name: 'Anexar imagem' })).toBeTruthy();
  });

  it('lists the rejected files with the reason', () => {
    setup();
    expect(screen.getByText('relatorio.pdf')).toBeTruthy();
    expect(screen.getByText('Formato não aceito: use PNG, JPEG, GIF ou WebP.')).toBeTruthy();
  });

  it('shows only the name when the image has no thumbnail', () => {
    setup({ accepted: [imageRef({ path: '/m/a.webp', type: 'webp', thumbnail: '' })], rejected: [] });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('a.webp')).toBeTruthy();
    expect(screen.getByText('WEBP')).toBeTruthy();
  });

  it('"Enviar" sends the accepted paths of this execution and closes', async () => {
    const { api, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith());
    expect(api.attachments.send).toHaveBeenCalledWith('e1', ['/anexos/e1/1-1.png', 'C:\\Meus Dados\\print.jpg']);
  });

  it('"Cancelar" and Esc close without sending', () => {
    const { api, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(api.attachments.send).not.toHaveBeenCalled();
  });

  it('keeps the preview open and shows the error when the send fails', async () => {
    const { api, onClose } = setup();
    api.attachments.send.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'O arquivo /m/a.png não existe.' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O arquivo /m/a.png não existe.');
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('with only rejected files offers just "Fechar"', () => {
    const { api } = setup({ accepted: [], rejected: CHECK.rejected });
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(api.attachments.send).not.toHaveBeenCalled();
  });

  it('closes with a notice when the execution stops running or idle', () => {
    const { onClose, rerender } = setup();
    expect(onClose).not.toHaveBeenCalled();
    rerender(execution('e1', { status: 'idle' }));
    expect(onClose).not.toHaveBeenCalled();
    rerender(execution('e1', { status: 'exited', exitCode: 0 }));
    expect(onClose).toHaveBeenCalledWith('A execução terminou: as imagens não foram enviadas.');
  });

  it('closes at once with the notice when it opens on a stopped execution', () => {
    const { onClose } = setup(CHECK, execution('e1', { status: 'exited' }));
    expect(onClose).toHaveBeenCalledWith('A execução terminou: as imagens não foram enviadas.');
  });
});
