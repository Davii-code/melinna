import type { CatalogService } from '../../core/catalog/catalog-service';
import type { Logger } from '../../core/ports/logger';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseCatalogList, parseDetectAll } from './validate-catalog';

export function registerCatalog(handle: Handle, deps: { catalog: CatalogService; log: Logger }): void {
  const { catalog, log } = deps;
  handle(
    CHANNELS.catalog.list,
    handler(log, CHANNELS.catalog.list, parseCatalogList, () => catalog.load()),
  );
  handle(
    CHANNELS.catalog.detectAll,
    handler(log, CHANNELS.catalog.detectAll, parseDetectAll, () => catalog.detectAll()),
  );
}
