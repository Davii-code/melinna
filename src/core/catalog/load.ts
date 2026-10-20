import { errorCode, type FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import type { AgentDefinition, CatalogIssue, CatalogLoadResult, CatalogSource } from './schema';
import { validateCatalog } from './validate';

async function readSource(
  fs: FileSystem,
  path: string,
  source: CatalogSource,
): Promise<{ agents: AgentDefinition[]; invalid: CatalogIssue[] } | null> {
  let text: string;
  try {
    text = new TextDecoder().decode(await fs.readFile(path));
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    return {
      agents: [],
      invalid: [{ source, reason: `não foi possível ler o arquivo (${errorCode(err) ?? 'erro'})` }],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { agents: [], invalid: [{ source, reason: 'JSON inválido' }] };
  }
  return validateCatalog(raw, source);
}

export interface LoadCatalogOptions {
  fs: FileSystem;
  builtinPath: string;
  userPath: string;
  os: OsName;
  log: Logger;
}

/**
 * Carrega o catálogo embutido e o do usuário. Entradas do usuário substituem as embutidas com o mesmo id;
 * entradas inválidas são relatadas e ignoradas, sem derrubar as válidas.
 */
export async function loadCatalog(opts: LoadCatalogOptions): Promise<CatalogLoadResult> {
  const builtin = (await readSource(opts.fs, opts.builtinPath, 'builtin')) ?? {
    agents: [],
    invalid: [{ source: 'builtin', reason: 'catálogo embutido ausente' }],
  };
  const user = (await readSource(opts.fs, opts.userPath, 'user')) ?? { agents: [], invalid: [] };
  const byId = new Map<string, AgentDefinition>();
  for (const a of builtin.agents) byId.set(a.id, a);
  for (const a of user.agents) byId.set(a.id, a);
  const agents = [...byId.values()].filter((a) => !a.platforms || a.platforms.includes(opts.os));
  const invalid = [...builtin.invalid, ...user.invalid];
  for (const issue of invalid) {
    opts.log.warn('catalog.invalid_entry', { source: issue.source, agentId: issue.id, reason: issue.reason });
  }
  return { agents, invalid };
}
