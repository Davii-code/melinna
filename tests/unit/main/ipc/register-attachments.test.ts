import { describe, expect, it } from 'vitest';
import { AttachmentService } from '../../../../src/core/attachments/attachment-service';
import { registerAttachments, type ClipboardPort } from '../../../../src/main/ipc/register-attachments';
import type { ImageCheck, ImageRef } from '../../../../src/shared/ipc-contract';
import { createFakeCore, FAKE_AGENTS, handleRecorder } from '../../../support/fake-core';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PDF = new TextEncoder().encode('%PDF-1.7');
const THUMB = 'data:image/png;base64,TUlOSQ==';

const WITH_IMAGES = { ...FAKE_AGENTS.fake, id: 'fake-img', images: { template: '{path}', quote: 'when-needed' } };
const WITH_AT = { ...FAKE_AGENTS.fake, id: 'fake-at', images: { template: '@{path}', quote: 'always' } };

interface Opts {
  clipboardImage?: Uint8Array | null;
  hasImageOnly?: boolean;
  picked?: string[];
}

async function setup(agentId = 'fake-img', opts: Opts = {}) {
  const core = createFakeCore();
  core.fs.seed(
    '/app/catalog/agents.json',
    JSON.stringify({ schemaVersion: 1, agents: [...Object.values(FAKE_AGENTS), WITH_IMAGES, WITH_AT] }),
  );
  const attachments = new AttachmentService({
    fs: core.fs,
    clock: core.clock,
    paths: core.paths,
    log: core.log,
  });
  const clipboard: ClipboardPort = {
    hasImageOnly: async () => opts.hasImageOnly ?? opts.clipboardImage != null,
    readImage: async () => opts.clipboardImage ?? null,
  };
  const rec = handleRecorder();
  registerAttachments(rec.handle, {
    attachments,
    executions: core.executions,
    model: core.model,
    catalog: core.catalog,
    clipboard,
    thumbnail: () => THUMB,
    pickImagePaths: async () => opts.picked ?? [],
    log: core.log,
  });
  const g = await core.workspace.createGroup('G');
  const task = await core.workspace.createTask({ groupId: g.id, repoPath: '/repo', baseRef: 'main', prompt: '' });
  const [r] = await core.executions.launch(task.id, [{ agentId }], { cols: 80, rows: 24 });
  if (!r?.ok) throw new Error('lançamento falhou');
  return { core, rec, execId: r.execId };
}

type Reply<T> = { ok: boolean; value?: T; error?: { code: string; message: string } };

describe('attachments IPC', () => {
  it('registers the five attachment channels', async () => {
    const { rec } = await setup();
    expect(rec.channels()).toEqual([
      'attachments:checkFiles',
      'attachments:clipboardHasImage',
      'attachments:pasteImage',
      'attachments:pickImages',
      'attachments:send',
    ]);
  });

  describe('clipboardHasImage', () => {
    it('is true for an image without text and false when there is text too', async () => {
      const yes = await setup('fake-img', { hasImageOnly: true });
      expect(await yes.rec.call('attachments:clipboardHasImage')).toEqual({ ok: true, value: true });
      const no = await setup('fake-img', { hasImageOnly: false });
      expect(await no.rec.call('attachments:clipboardHasImage')).toEqual({ ok: true, value: false });
    });

    it('takes no arguments', async () => {
      const { rec } = await setup();
      expect((await rec.call('attachments:clipboardHasImage', 'x')).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('pasteImage', () => {
    it('saves the image as an attachment and returns the reference and the thumbnail', async () => {
      const { rec, core, execId } = await setup('fake-img', { clipboardImage: PNG });
      const r = (await rec.call('attachments:pasteImage', execId)) as Reply<ImageRef>;
      expect(r.ok).toBe(true);
      const ref = r.value as ImageRef;
      expect(ref).toMatchObject({ type: 'png', bytes: PNG.length, thumbnail: THUMB, source: 'clipboard' });
      expect(ref.path.startsWith(core.paths.attachmentsDir(execId))).toBe(true);
      expect(ref.ref).toBe(ref.path);
      expect(await core.fs.exists(ref.path)).toBe(true);
    });

    it('formats the reference with the template and quoting of the agent', async () => {
      const { rec, execId } = await setup('fake-at', { clipboardImage: PNG });
      const ref = ((await rec.call('attachments:pasteImage', execId)) as Reply<ImageRef>).value as ImageRef;
      expect(ref.ref).toBe(`@"${ref.path}"`);
    });

    it('refuses when the clipboard has no image', async () => {
      const { rec, execId } = await setup('fake-img', { clipboardImage: null });
      expect(await rec.call('attachments:pasteImage', execId)).toMatchObject({
        ok: false,
        error: { code: 'INPUT_INVALID', message: 'Nenhuma imagem na área de transferência.' },
      });
    });

    it('refuses an unsupported format in the clipboard', async () => {
      const { rec, execId } = await setup('fake-img', { clipboardImage: PDF });
      expect((await rec.call('attachments:pasteImage', execId)).error?.message).toBe(
        'Formato não aceito: use PNG, JPEG, GIF ou WebP.',
      );
    });

    it('refuses a stopped execution with EXECUTION_NOT_RUNNING and saves nothing', async () => {
      const { rec, core, execId } = await setup('fake-img', { clipboardImage: PNG });
      core.model.mutate((s) => {
        const e = s.executions.find((x) => x.id === execId);
        if (e) e.status = 'exited';
      });
      expect((await rec.call('attachments:pasteImage', execId)).error?.code).toBe('EXECUTION_NOT_RUNNING');
      expect(await core.fs.exists(core.paths.attachmentsDir(execId))).toBe(false);
    });

    it('refuses an agent without images', async () => {
      const { rec, execId } = await setup('fake', { clipboardImage: PNG });
      expect(await rec.call('attachments:pasteImage', execId)).toMatchObject({
        ok: false,
        error: { code: 'INPUT_INVALID', message: 'Este agente não recebe imagens.' },
      });
    });

    it('refuses an unknown execution and a malformed id', async () => {
      const { rec } = await setup('fake-img', { clipboardImage: PNG });
      expect((await rec.call('attachments:pasteImage', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('attachments:pasteImage', 42)).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('attachments:pasteImage')).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('checkFiles', () => {
    it('separates accepted and rejected files with the reason', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/meus/foto.png', PNG);
      core.fs.seed('/meus/doc.pdf', PDF);
      const r = (await rec.call('attachments:checkFiles', execId, [
        '/meus/foto.png',
        '/meus/doc.pdf',
        '/meus/sumiu.png',
      ])) as Reply<ImageCheck>;
      expect(r.ok).toBe(true);
      expect(r.value?.accepted.map((a) => a.path)).toEqual(['/meus/foto.png']);
      expect(r.value?.accepted[0]).toMatchObject({ source: 'file', type: 'png', thumbnail: THUMB, ref: '/meus/foto.png' });
      expect(r.value?.rejected).toEqual([
        { path: '/meus/doc.pdf', reason: 'Formato não aceito: use PNG, JPEG, GIF ou WebP.' },
        { path: '/meus/sumiu.png', reason: 'O arquivo /meus/sumiu.png não existe.' },
      ]);
    });

    it('quotes a path with a space in the reference', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/meus dados/foto.jpg', JPEG);
      const r = (await rec.call('attachments:checkFiles', execId, ['/meus dados/foto.jpg'])) as Reply<ImageCheck>;
      expect(r.value?.accepted[0]?.ref).toBe('"/meus dados/foto.jpg"');
    });

    it('rejects a path with a control character instead of failing the whole drop', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/meus/foto.png', PNG);
      const r = (await rec.call('attachments:checkFiles', execId, [
        '/meus/foto.png',
        '/meus/a\nb.png',
      ])) as Reply<ImageCheck>;
      expect(r.value?.accepted).toHaveLength(1);
      expect(r.value?.rejected).toHaveLength(1);
      expect(r.value?.rejected[0]?.path).toBe('/meus/a\nb.png');
    });

    it('accepts 1 to 20 paths and refuses 0 or 21', async () => {
      const { rec, core, execId } = await setup();
      const paths = Array.from({ length: 20 }, (_, i) => {
        core.fs.seed(`/m/${i}.png`, PNG);
        return `/m/${i}.png`;
      });
      expect(((await rec.call('attachments:checkFiles', execId, paths)) as Reply<ImageCheck>).value?.accepted).toHaveLength(20);
      expect((await rec.call('attachments:checkFiles', execId, [])).error?.code).toBe('INPUT_INVALID');
      expect(await rec.call('attachments:checkFiles', execId, [...paths, '/m/extra.png'])).toMatchObject({
        ok: false,
        error: { code: 'INPUT_INVALID', message: 'Envie até 20 imagens por vez.' },
      });
    });

    it.each([
      ['paths not an array', '/m/a.png'],
      ['a non-string path', [42]],
      ['an empty path', ['']],
      ['a path over the limit', ['x'.repeat(4097)]],
    ])('refuses %s', async (_name, paths) => {
      const { rec, execId } = await setup();
      expect((await rec.call('attachments:checkFiles', execId, paths)).error?.code).toBe('INPUT_INVALID');
    });

    it('refuses an agent without images and a stopped execution', async () => {
      const plain = await setup('fake');
      expect((await plain.rec.call('attachments:checkFiles', plain.execId, ['/m/a.png'])).error?.message).toBe(
        'Este agente não recebe imagens.',
      );
      const { rec, core, execId } = await setup();
      core.model.mutate((s) => {
        const e = s.executions.find((x) => x.id === execId);
        if (e) e.status = 'exited';
      });
      expect((await rec.call('attachments:checkFiles', execId, ['/m/a.png'])).error?.code).toBe(
        'EXECUTION_NOT_RUNNING',
      );
    });
  });

  describe('pickImages', () => {
    it('checks what the native dialog returned', async () => {
      const { rec, core, execId } = await setup('fake-img', { picked: ['/m/a.png', '/m/b.pdf'] });
      core.fs.seed('/m/a.png', PNG);
      core.fs.seed('/m/b.pdf', PDF);
      const r = (await rec.call('attachments:pickImages', execId)) as Reply<ImageCheck>;
      expect(r.value?.accepted.map((a) => a.path)).toEqual(['/m/a.png']);
      expect(r.value?.rejected.map((a) => a.path)).toEqual(['/m/b.pdf']);
    });

    it('returns empty lists when the dialog is cancelled', async () => {
      const { rec, execId } = await setup('fake-img', { picked: [] });
      expect(await rec.call('attachments:pickImages', execId)).toEqual({
        ok: true,
        value: { accepted: [], rejected: [] },
      });
    });

    it('refuses more than 20 files from the dialog', async () => {
      const picked = Array.from({ length: 21 }, (_, i) => `/m/${i}.png`);
      const { rec, execId } = await setup('fake-img', { picked });
      expect((await rec.call('attachments:pickImages', execId)).error?.message).toBe(
        'Envie até 20 imagens por vez.',
      );
    });

    it('does not even open the dialog for an agent without images', async () => {
      const { rec, execId } = await setup('fake', { picked: ['/m/a.png'] });
      expect((await rec.call('attachments:pickImages', execId)).error?.message).toBe(
        'Este agente não recebe imagens.',
      );
    });
  });

  describe('send', () => {
    it('revalidates and writes the references separated by a space, without Enter', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/m/a.png', PNG);
      core.fs.seed('/m dados/b.jpg', JPEG);
      expect(await rec.call('attachments:send', execId, ['/m/a.png', '/m dados/b.jpg'])).toEqual({
        ok: true,
        value: undefined,
      });
      const written = core.host.writes.filter((w) => w.execId === execId).map((w) => w.data);
      expect(written).toEqual(['/m/a.png "/m dados/b.jpg" ']);
      expect(written.join('')).not.toMatch(/[\r\n]/);
    });

    it('uses the template of the agent', async () => {
      const { rec, core, execId } = await setup('fake-at');
      core.fs.seed('/m/a.png', PNG);
      await rec.call('attachments:send', execId, ['/m/a.png']);
      expect(core.host.writes.at(-1)?.data).toBe('@"/m/a.png" ');
    });

    it('writes nothing when a file disappeared after the preview', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/m/a.png', PNG);
      const r = await rec.call('attachments:send', execId, ['/m/a.png', '/m/sumiu.png']);
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'INPUT_INVALID', message: 'O arquivo /m/sumiu.png não existe.' },
      });
      expect(core.host.writes).toEqual([]);
    });

    it('writes nothing when a file stopped being an image', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/m/a.png', PDF);
      expect((await rec.call('attachments:send', execId, ['/m/a.png'])).error?.message).toBe(
        'Formato não aceito: use PNG, JPEG, GIF ou WebP.',
      );
      expect(core.host.writes).toEqual([]);
    });

    it('refuses a stopped execution and an agent without images, writing nothing', async () => {
      const plain = await setup('fake');
      plain.core.fs.seed('/m/a.png', PNG);
      expect((await plain.rec.call('attachments:send', plain.execId, ['/m/a.png'])).error?.message).toBe(
        'Este agente não recebe imagens.',
      );
      const { rec, core, execId } = await setup();
      core.fs.seed('/m/a.png', PNG);
      core.model.mutate((s) => {
        const e = s.executions.find((x) => x.id === execId);
        if (e) e.status = 'exited';
      });
      expect((await rec.call('attachments:send', execId, ['/m/a.png'])).error?.code).toBe('EXECUTION_NOT_RUNNING');
      expect(core.host.writes).toEqual([]);
    });

    it('refuses 0 and 21 paths', async () => {
      const { rec, execId } = await setup();
      expect((await rec.call('attachments:send', execId, [])).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('attachments:send', execId, Array(21).fill('/m/a.png'))).error?.message).toBe(
        'Envie até 20 imagens por vez.',
      );
    });

    it('logs the count without the paths', async () => {
      const { rec, core, execId } = await setup();
      core.fs.seed('/segredo/a.png', PNG);
      await rec.call('attachments:send', execId, ['/segredo/a.png']);
      expect(core.log.records.find((r) => r.event === 'attachment.sent')?.fields).toEqual({ execId, count: 1 });
      expect(core.log.text()).not.toContain('segredo');
    });
  });
});
