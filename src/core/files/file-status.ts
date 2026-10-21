import type { FileChange, FileRoot } from '../api-types';
import type { GitRunner } from '../git/git-runner';
import { pathModule } from '../paths';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import { parseStatusZ, toStatusMap } from './git-status';
import { isInsideRoot } from './tree';

export interface FileStatusDeps {
  git: GitRunner;
  os: OsName;
  log: Logger;
  roots(): readonly FileRoot[];
}

/**
 * Estado do git por arquivo, para decorar o explorador.
 *
 * Só leitura (`--no-optional-locks`): nada é escrito no repositório do usuário. A raiz pedida precisa
 * ser uma das raízes navegáveis; fora delas, o resultado é vazio em vez de um erro que atrapalharia
 * a árvore.
 */
export class FileStatusService {
  constructor(private readonly deps: FileStatusDeps) {}

  async status(rawRoot: string): Promise<Record<string, FileChange>> {
    const root = pathModule(this.deps.os).resolve(rawRoot);
    const inside = this.deps.roots().some((r) => isInsideRoot(r.path, root, this.deps.os));
    if (!inside) return {};
    const r = await this.deps.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: root,
      read: true,
      allowFail: true,
    });
    if (r.exitCode !== 0) return {};
    const map = toStatusMap(parseStatusZ(r.stdout));
    this.deps.log.info('files.status', { root, entries: Object.keys(map).length });
    return map;
  }
}
