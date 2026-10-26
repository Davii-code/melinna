import { parentPort, workerData } from 'node:worker_threads';
import { NodeFileSystem } from '../adapters/node-fs';
import { nodePlatform } from '../adapters/node-platform';
import { isMelinnaError } from '../core/errors';
import { searchProject, type ProjectSearchQuery } from '../core/files/search';
import type { SearchWorkerMessage } from './search-worker';

/**
 * Corpo da thread da busca no projeto: recebe a consulta, roda `searchProject` com o sistema de arquivos
 * real e devolve o resultado (ou o erro) ao processo principal. O principal encerra a thread se ela passar
 * do tempo, o que corta uma expressão regular que não termina.
 */
async function main(): Promise<void> {
  const port = parentPort;
  if (port === null) return;
  const { query } = workerData as { query: ProjectSearchQuery };
  let message: SearchWorkerMessage;
  try {
    const result = await searchProject({ fs: new NodeFileSystem(), os: nodePlatform().os }, query);
    message = { type: 'result', result };
  } catch (err) {
    message = isMelinnaError(err)
      ? { type: 'error', code: err.code, message: err.userMessage }
      : { type: 'error', code: 'INTERNAL', message: 'Erro interno inesperado. Detalhes no log.' };
  }
  port.postMessage(message);
}

void main();
