import { MelinnaError } from '../errors';
import type { AppPaths } from '../paths';
import type { Clock } from '../ports/clock';
import { errorCode, type FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import {
  detectImageType,
  hasControlChar,
  imageExtension,
  MAX_IMAGE_BYTES,
  type ImageType,
} from './image-format';

export interface AttachmentServiceDeps {
  fs: FileSystem;
  clock: Clock;
  paths: Pick<AppPaths, 'attachmentsRoot' | 'attachmentsDir' | 'attachmentFile'>;
  log: Logger;
}

/** Imagem validada: caminho, formato, tamanho e os bytes lidos (para a miniatura). */
export interface CheckedImage {
  path: string;
  type: ImageType;
  bytes: number;
  data: Uint8Array;
}

/** Motivos de recusa que vão para o log (nunca o caminho nem o conteúdo). */
type RejectReason = 'empty' | 'too-large' | 'format' | 'missing' | 'not-regular' | 'control-char';

const FORMAT_MESSAGE = 'Formato não aceito: use PNG, JPEG, GIF ou WebP.';
const TOO_LARGE_MESSAGE = 'A imagem passa de 20 MB.';

/**
 * Anexos de imagem: grava a imagem colada na pasta de dados do app (uma pasta por execução) e valida
 * arquivos do usuário sem copiá-los nem alterá-los. Arquivos do usuário nunca são apagados aqui.
 */
export class AttachmentService {
  constructor(private readonly deps: AttachmentServiceDeps) {}

  private reject(reason: RejectReason, userMessage: string): MelinnaError {
    this.deps.log.warn('attachment.rejected', { reason });
    return new MelinnaError('INPUT_INVALID', { userMessage });
  }

  /** Valida e grava os bytes colados como `<timestamp>-<n>.<ext>` em `attachmentsDir(execId)`. */
  async saveClipboardImage(
    execId: string,
    data: Uint8Array,
  ): Promise<{ path: string; type: ImageType; bytes: number }> {
    if (data.length === 0) {
      throw this.reject('empty', 'Nenhuma imagem na área de transferência.');
    }
    if (data.length > MAX_IMAGE_BYTES) throw this.reject('too-large', TOO_LARGE_MESSAGE);
    const type = detectImageType(data);
    if (type === null) throw this.reject('format', FORMAT_MESSAGE);

    const { fs, clock, paths, log } = this.deps;
    const dir = paths.attachmentsDir(execId);
    const stamp = clock.now().getTime();
    try {
      await fs.mkdir(dir, { recursive: true });
      for (let n = 1; ; n++) {
        const path = paths.attachmentFile(execId, `${stamp}-${n}.${imageExtension(type)}`);
        try {
          await fs.writeFile(path, data, { flag: 'wx' });
        } catch (err) {
          if (errorCode(err) === 'EEXIST') continue;
          throw err;
        }
        log.info('attachment.saved', { execId, bytes: data.length, type });
        return { path, type, bytes: data.length };
      }
    } catch (cause) {
      log.error('attachment.save_failed', { execId, err: cause });
      if (errorCode(cause) === 'ENOSPC') throw new MelinnaError('DISK_FULL', { cause });
      throw new MelinnaError('INTERNAL', { userMessage: 'Não foi possível gravar a imagem.', cause });
    }
  }

  /**
   * Confere um arquivo do usuário sem copiá-lo: precisa existir, ser arquivo comum (link simbólico e pasta
   * são recusados), ter até 20 MB e assinatura de PNG, JPEG, GIF ou WebP.
   */
  async checkFile(path: string): Promise<CheckedImage> {
    if (hasControlChar(path)) {
      throw this.reject('control-char', 'O caminho da imagem tem caracteres que não podem ir para o terminal.');
    }
    const { fs } = this.deps;
    const stat = await fs.lstat(path).catch(() => null);
    if (stat === null) throw this.reject('missing', `O arquivo ${path} não existe.`);
    if (stat.isSymbolicLink === true || !stat.isFile) {
      throw this.reject('not-regular', `${path} não é um arquivo de imagem.`);
    }
    if (stat.size > MAX_IMAGE_BYTES) throw this.reject('too-large', TOO_LARGE_MESSAGE);
    let data: Uint8Array;
    try {
      data = await fs.readFile(path);
    } catch {
      throw this.reject('missing', `O arquivo ${path} não existe.`);
    }
    // o arquivo pode ter crescido entre o `lstat` e a leitura
    if (data.length > MAX_IMAGE_BYTES) throw this.reject('too-large', TOO_LARGE_MESSAGE);
    const type = detectImageType(data);
    if (type === null) throw this.reject('format', FORMAT_MESSAGE);
    return { path, type, bytes: data.length, data };
  }

  /** Apaga os anexos de uma execução (só a pasta dela); devolve quantos arquivos saíram, ou `null` se não havia pasta. */
  async removeFor(execId: string): Promise<number | null> {
    const { fs, paths, log } = this.deps;
    const dir = paths.attachmentsDir(execId);
    const names = await fs.readdir(dir).catch(() => null);
    if (names === null) return null;
    await fs.rm(dir, { recursive: true, force: true });
    log.info('attachment.cleaned', { execId, files: names.length });
    return names.length;
  }

  /** Apaga as pastas de anexos de execuções que não existem mais (início do app); devolve quantas saíram. */
  async sweepOrphans(knownExecIds: Iterable<string>): Promise<number> {
    const { fs, paths } = this.deps;
    const known = new Set(knownExecIds);
    const names = await fs.readdir(paths.attachmentsRoot).catch(() => []);
    let removed = 0;
    for (const execId of names) {
      if (known.has(execId)) continue;
      if ((await this.removeFor(execId)) !== null) removed++;
    }
    return removed;
  }
}
