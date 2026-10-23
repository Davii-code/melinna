import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../../src/adapters/node-fs';
import { AttachmentService } from '../../../src/core/attachments/attachment-service';
import { MAX_IMAGE_BYTES } from '../../../src/core/attachments/image-format';
import { makePaths } from '../../../src/core/paths';
import { FakeClock } from '../../support/fakes/clock';
import { MemoryLogger } from '../../support/fakes/logger';
import { currentOs } from '../../support/os';
import { removeDirRecursive } from '../../support/temp-dirs';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.7 conteudo');

let root: string;
let userData: string;
let outside: string;
let log: MemoryLogger;
let clock: FakeClock;
let service: AttachmentService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'melinna-anexos-'));
  userData = join(root, 'userData');
  outside = join(root, 'meus arquivos');
  mkdirSync(userData);
  mkdirSync(outside);
  log = new MemoryLogger();
  clock = new FakeClock(Date.parse('2026-10-23T10:00:00.000Z'));
  service = new AttachmentService({
    fs: new NodeFileSystem(),
    clock,
    paths: makePaths(userData, currentOs),
    log,
  });
});

afterEach(() => {
  removeDirRecursive(root);
});

const paths = () => makePaths(userData, currentOs);
const rejection = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as { code: string; userMessage: string };
  }
  throw new Error('esperava uma recusa');
};

describe('AttachmentService.saveClipboardImage', () => {
  it('writes <timestamp>-<n>.png in the execution attachments folder', async () => {
    const saved = await service.saveClipboardImage('e1', PNG);
    const stamp = Date.parse('2026-10-23T10:00:00.000Z');
    expect(saved).toEqual({ path: paths().attachmentFile('e1', `${stamp}-1.png`), type: 'png', bytes: PNG.length });
    expect([...readFileSync(saved.path)]).toEqual([...PNG]);
    expect(readdirSync(paths().attachmentsDir('e1'))).toEqual([`${stamp}-1.png`]);
  });

  it('numbers images saved in the same millisecond and uses the extension of the real format', async () => {
    const a = await service.saveClipboardImage('e1', PNG);
    const b = await service.saveClipboardImage('e1', PNG);
    const c = await service.saveClipboardImage('e1', JPEG);
    expect(new Set([a.path, b.path, c.path]).size).toBe(3);
    expect(b.path.endsWith('-2.png')).toBe(true);
    expect(c.path.endsWith('-3.jpg')).toBe(true);
  });

  it('keeps each execution in its own folder', async () => {
    await service.saveClipboardImage('e1', PNG);
    await service.saveClipboardImage('e2', PNG);
    expect(readdirSync(paths().attachmentsRoot).sort()).toEqual(['e1', 'e2']);
  });

  it('refuses an unknown format without writing anything', async () => {
    const err = await rejection(service.saveClipboardImage('e1', PDF));
    expect(err).toMatchObject({ code: 'INPUT_INVALID', userMessage: 'Formato não aceito: use PNG, JPEG, GIF ou WebP.' });
    expect(existsSync(paths().attachmentsDir('e1'))).toBe(false);
  });

  it('refuses empty data and more than 20 MB without writing anything', async () => {
    expect(await rejection(service.saveClipboardImage('e1', new Uint8Array()))).toMatchObject({
      userMessage: 'Nenhuma imagem na área de transferência.',
    });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(await rejection(service.saveClipboardImage('e1', big))).toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'A imagem passa de 20 MB.',
    });
    expect(existsSync(paths().attachmentsDir('e1'))).toBe(false);
  });

  it('accepts exactly 20 MB', async () => {
    const edge = new Uint8Array(MAX_IMAGE_BYTES);
    edge.set(PNG);
    expect((await service.saveClipboardImage('e1', edge)).bytes).toBe(MAX_IMAGE_BYTES);
  });

  it('logs attachment.saved with the execution, size and type, and attachment.rejected with the reason only', async () => {
    await service.saveClipboardImage('e1', PNG);
    await rejection(service.saveClipboardImage('e1', PDF));
    expect(log.records.find((r) => r.event === 'attachment.saved')?.fields).toEqual({
      execId: 'e1',
      bytes: PNG.length,
      type: 'png',
    });
    expect(log.records.find((r) => r.event === 'attachment.rejected')?.fields).toEqual({ reason: 'format' });
    expect(log.text()).not.toContain(userData);
  });
});

describe('AttachmentService.checkFile', () => {
  const file = (name: string, data: Uint8Array | string) => {
    const path = join(outside, name);
    writeFileSync(path, data);
    return path;
  };

  it('accepts a regular image and copies nothing', async () => {
    const path = file('print de tela.png', PNG);
    const checked = await service.checkFile(path);
    expect(checked).toMatchObject({ path, type: 'png', bytes: PNG.length });
    expect([...checked.data]).toEqual([...PNG]);
    expect(existsSync(paths().attachmentsRoot)).toBe(false);
    expect(readdirSync(outside)).toEqual(['print de tela.png']);
  });

  it('detects the type by the bytes, not the extension', async () => {
    expect((await service.checkFile(file('foto.png', JPEG))).type).toBe('jpeg');
  });

  it('refuses a file that does not exist', async () => {
    const path = join(outside, 'nao-existe.png');
    expect(await rejection(service.checkFile(path))).toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: `O arquivo ${path} não existe.`,
    });
  });

  it('refuses a PDF and a text file renamed to .png', async () => {
    const msg = 'Formato não aceito: use PNG, JPEG, GIF ou WebP.';
    expect(await rejection(service.checkFile(file('a.pdf', PDF)))).toMatchObject({ userMessage: msg });
    expect(await rejection(service.checkFile(file('b.png', 'texto')))).toMatchObject({ userMessage: msg });
  });

  it('refuses a folder', async () => {
    const dir = join(outside, 'pasta');
    mkdirSync(dir);
    expect(await rejection(service.checkFile(dir))).toMatchObject({
      userMessage: `${dir} não é um arquivo de imagem.`,
    });
  });

  it('refuses a file above 20 MB before reading it', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(await rejection(service.checkFile(file('enorme.png', big)))).toMatchObject({
      userMessage: 'A imagem passa de 20 MB.',
    });
  });

  it('refuses a symbolic link, even one that points to a real image', async () => {
    const real = file('real.png', PNG);
    const link = join(outside, 'atalho.png');
    try {
      symlinkSync(real, link);
    } catch {
      // criar link simbólico exige privilégio no Windows; sem ele não há o que exercitar aqui
      return;
    }
    expect(await rejection(service.checkFile(link))).toMatchObject({
      userMessage: `${link} não é um arquivo de imagem.`,
    });
  });

  it('refuses a path with a control character', async () => {
    expect(await rejection(service.checkFile(`${outside}/a\nb.png`))).toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('a file deleted after being checked is refused on the next check (the send revalidates)', async () => {
    const path = file('some.png', PNG);
    await service.checkFile(path);
    removeDirRecursive(outside);
    expect(await rejection(service.checkFile(path))).toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('logs the rejection reason without the path', async () => {
    await rejection(service.checkFile(join(outside, 'segredo-nao-existe.png')));
    expect(log.records.find((r) => r.event === 'attachment.rejected')?.fields).toEqual({ reason: 'missing' });
    expect(log.text()).not.toContain('segredo');
  });
});

describe('AttachmentService.removeFor and sweepOrphans', () => {
  it('removeFor deletes only that execution folder and logs the file count', async () => {
    await service.saveClipboardImage('e1', PNG);
    await service.saveClipboardImage('e1', JPEG);
    await service.saveClipboardImage('e2', PNG);
    const mine = join(outside, 'meu.png');
    writeFileSync(mine, PNG);

    expect(await service.removeFor('e1')).toBe(2);
    expect(existsSync(paths().attachmentsDir('e1'))).toBe(false);
    expect(existsSync(paths().attachmentsDir('e2'))).toBe(true);
    expect(existsSync(mine)).toBe(true);
    expect(log.records.find((r) => r.event === 'attachment.cleaned')?.fields).toEqual({ execId: 'e1', files: 2 });
  });

  it('removeFor on an execution without attachments does nothing and logs nothing', async () => {
    expect(await service.removeFor('sem-anexos')).toBeNull();
    expect(log.records.some((r) => r.event === 'attachment.cleaned')).toBe(false);
  });

  it('sweepOrphans deletes the folders of unknown executions and keeps the known ones', async () => {
    await service.saveClipboardImage('vive', PNG);
    await service.saveClipboardImage('orfa-1', PNG);
    await service.saveClipboardImage('orfa-2', PNG);
    expect(await service.sweepOrphans(['vive'])).toBe(2);
    expect(readdirSync(paths().attachmentsRoot)).toEqual(['vive']);
  });

  it('sweepOrphans without an attachments folder is a no-op', async () => {
    expect(await service.sweepOrphans([])).toBe(0);
  });

  it('sweepOrphans leaves user files elsewhere untouched', async () => {
    const mine = join(outside, 'meu.png');
    writeFileSync(mine, PNG);
    await service.saveClipboardImage('orfa', PNG);
    await service.sweepOrphans([]);
    expect(existsSync(mine)).toBe(true);
  });
});
