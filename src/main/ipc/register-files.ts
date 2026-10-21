import type { FilesService } from '../../core/files/files-service';
import type { Logger } from '../../core/ports/logger';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseFilePath, parseFilesRoots, parseFileWrite } from './validate-files';

export interface FilesIpcDeps {
  files: FilesService;
  log: Logger;
}

export function registerFiles(handle: Handle, deps: FilesIpcDeps): void {
  const { files, log } = deps;
  const C = CHANNELS.files;
  handle(
    C.roots,
    handler(log, C.roots, parseFilesRoots, () => files.roots()),
  );
  handle(
    C.list,
    handler(log, C.list, parseFilePath, (path) => files.list(path)),
  );
  handle(
    C.read,
    handler(log, C.read, parseFilePath, (path) => files.read(path)),
  );
  handle(
    C.write,
    handler(log, C.write, parseFileWrite, (path, content, hash) => files.write(path, content, hash)),
  );
}
