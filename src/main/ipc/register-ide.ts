import type { IdeService } from '../ide-service';
import type { NodeHttpClient } from '../../adapters/node-http-client';
import type { NodeDatabaseClient } from '../../adapters/node-database-client';
import type { Logger } from '../../core/ports/logger';
import { CHANNELS } from '../../shared/ipc-contract';
import {
  object,
  parseToolCall,
  parseToolStart,
  toolString,
  ideInvalid,
  type HttpInput,
} from '../../shared/ide-types';
import { handler, type Handle } from './result';

export function registerIde(
  handle: Handle,
  deps: {
    ide: Pick<IdeService, 'start' | 'call' | 'stop'>;
    http: Pick<NodeHttpClient, 'send' | 'cancel'>;
    database: Pick<NodeDatabaseClient, 'open' | 'query' | 'close'>;
    log: Logger;
  },
): void {
  const c = CHANNELS.ide;
  const oneId = (args: unknown[]): [string] => [toolString(args[0], 64)];
  handle(
    c.start,
    handler(
      deps.log,
      c.start,
      (args): [ReturnType<typeof parseToolStart>] => [parseToolStart(args[0])],
      async (input) => {
        const result = await deps.ide.start(input);
        deps.log.info('ide.started', { sessionId: result.sessionId, protocol: input.protocol });
        return result;
      },
    ),
  );
  handle(
    c.call,
    handler(
      deps.log,
      c.call,
      (args): [ReturnType<typeof parseToolCall>] => [parseToolCall(args[0])],
      (input) => deps.ide.call(input),
    ),
  );
  handle(
    c.notify,
    handler(
      deps.log,
      c.notify,
      (args): [ReturnType<typeof parseToolCall>] => [parseToolCall(args[0], true)],
      (input) => deps.ide.call(input, true),
    ),
  );
  handle(
    c.stop,
    handler(deps.log, c.stop, oneId, (id) => {
      deps.ide.stop(id);
      deps.log.info('ide.stopped', { sessionId: id });
    }),
  );
  handle(
    c.httpSend,
    handler(
      deps.log,
      c.httpSend,
      (args): [HttpInput] => [object(args[0]) as unknown as HttpInput],
      async (input) => {
        const result = await deps.http.send(input);
        deps.log.info('ide.http_completed', {
          status: result.status,
          durationMs: result.durationMs,
          truncated: result.truncated,
        });
        return result;
      },
    ),
  );
  handle(
    c.httpCancel,
    handler(deps.log, c.httpCancel, oneId, (id) => deps.http.cancel(id)),
  );
  handle(
    c.dbOpen,
    handler(
      deps.log,
      c.dbOpen,
      (args): [string] => [toolString(args[0])],
      (path) => deps.database.open(path),
    ),
  );
  handle(
    c.dbQuery,
    handler(
      deps.log,
      c.dbQuery,
      (args): [string, string] => {
        if (
          typeof args[1] !== 'string' ||
          !args[1].trim() ||
          args[1].length > 65536 ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(args[1])
        )
          return ideInvalid();
        return [toolString(args[0], 64), args[1]];
      },
      async (id, sql) => {
        const result = await deps.database.query(id, sql);
        deps.log.info('ide.sqlite_queried', { rows: result.rows.length, truncated: result.truncated });
        return result;
      },
    ),
  );
  handle(
    c.dbClose,
    handler(deps.log, c.dbClose, oneId, (id) => deps.database.close(id)),
  );
}
