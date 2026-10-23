import type { AttachmentService, CheckedImage } from '../../core/attachments/attachment-service';
import { formatImageRef, MAX_FILES } from '../../core/attachments/image-format';
import type { CatalogService } from '../../core/catalog/catalog-service';
import type { ImagesSpec } from '../../core/catalog/schema';
import { isMelinnaError, MelinnaError } from '../../core/errors';
import type { ExecutionService } from '../../core/execution/execution-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS, type ImageCheck, type ImageRef } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import {
  parseClipboardHasImage,
  parseExecIdAndPaths,
  parseExecIdOnly,
  tooManyFiles,
} from './validate-attachments';

/** Área de transferência do sistema; a implementação com `clipboard` do Electron fica em `main.ts`. */
export interface ClipboardPort {
  /** Há imagem e não há texto (um print copiado do navegador traz os dois: aí a colagem é de texto). */
  hasImageOnly(): Promise<boolean>;
  /** Bytes da imagem (PNG de preferência), ou `null` se a área de transferência não tem imagem. */
  readImage(): Promise<Uint8Array | null>;
}

export interface AttachmentsIpcDeps {
  attachments: AttachmentService;
  executions: Pick<ExecutionService, 'write'>;
  model: WorkspaceModel;
  catalog: Pick<CatalogService, 'agent'>;
  clipboard: ClipboardPort;
  /** Miniatura em data URL (vazia se o formato não é decodificado). */
  thumbnail: (bytes: Uint8Array) => string;
  /** Diálogo nativo de imagens com seleção múltipla; lista vazia se cancelado. */
  pickImagePaths: () => Promise<string[]>;
  log: Logger;
}

const encoder = new TextEncoder();

/** Canais de imagem no terminal: o main detecta, valida, gera a miniatura e formata a referência. */
export function registerAttachments(handle: Handle, deps: AttachmentsIpcDeps): void {
  const { attachments, model, log } = deps;
  const C = CHANNELS.attachments;
  const exists = (id: string) => model.execution(id) !== undefined;

  /** A execução precisa estar viva e o agente dela precisa aceitar imagem; devolve o formato dele. */
  const target = async (execId: string): Promise<ImagesSpec> => {
    const exec = model.execution(execId);
    if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    if (exec.status !== 'running' && exec.status !== 'idle') throw new MelinnaError('EXECUTION_NOT_RUNNING');
    if (exec.command) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Comandos não recebem imagens.' });
    }
    const agent = await deps.catalog.agent(exec.agentId);
    if (!agent.images) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Este agente não recebe imagens.' });
    }
    return agent.images;
  };

  const toRef = (image: CheckedImage, source: ImageRef['source'], images: ImagesSpec): ImageRef => ({
    path: image.path,
    type: image.type,
    bytes: image.bytes,
    thumbnail: deps.thumbnail(image.data),
    ref: formatImageRef(images, image.path),
    source,
  });

  const checkMany = async (images: ImagesSpec, paths: readonly string[]): Promise<ImageCheck> => {
    const result: ImageCheck = { accepted: [], rejected: [] };
    for (const path of paths) {
      try {
        result.accepted.push(toRef(await attachments.checkFile(path), 'file', images));
      } catch (err) {
        if (!isMelinnaError(err) || err.code !== 'INPUT_INVALID') throw err;
        result.rejected.push({ path, reason: err.userMessage });
      }
    }
    return result;
  };

  handle(
    C.clipboardHasImage,
    handler(log, C.clipboardHasImage, parseClipboardHasImage, () => deps.clipboard.hasImageOnly()),
  );

  handle(
    C.pasteImage,
    handler(log, C.pasteImage, parseExecIdOnly(exists), async (execId): Promise<ImageRef> => {
      const images = await target(execId);
      const data = await deps.clipboard.readImage();
      if (data === null) {
        throw new MelinnaError('INPUT_INVALID', { userMessage: 'Nenhuma imagem na área de transferência.' });
      }
      const saved = await attachments.saveClipboardImage(execId, data);
      return toRef({ ...saved, data }, 'clipboard', images);
    }),
  );

  handle(
    C.checkFiles,
    handler(log, C.checkFiles, parseExecIdAndPaths(exists), async (execId, paths) =>
      checkMany(await target(execId), paths),
    ),
  );

  handle(
    C.pickImages,
    handler(log, C.pickImages, parseExecIdOnly(exists), async (execId): Promise<ImageCheck> => {
      const images = await target(execId);
      const paths = await deps.pickImagePaths();
      if (paths.length > MAX_FILES) throw tooManyFiles();
      return checkMany(images, paths);
    }),
  );

  handle(
    C.send,
    handler(log, C.send, parseExecIdAndPaths(exists), async (execId, paths) => {
      const images = await target(execId);
      // Revalida na hora de enviar: o arquivo pode ter sumido ou mudado desde a prévia. Se algum falha,
      // nada é escrito no terminal.
      const refs: string[] = [];
      for (const path of paths) {
        refs.push(formatImageRef(images, (await attachments.checkFile(path)).path));
      }
      // Digitação comum, sem Enter; o espaço final deixa o usuário continuar escrevendo.
      deps.executions.write(execId, encoder.encode(`${refs.join(' ')} `));
      log.info('attachment.sent', { execId, count: refs.length });
    }),
  );
}
