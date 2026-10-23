import type { DirectoryListing, FileEntry, FileRoot, FileText, FileWriteResult } from '../api-types';
import { MelinnaError } from '../errors';
import { pathModule } from '../paths';
import type { FileStat, FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import { contentHash } from './hash';
import { isInsideRoot, looksBinary, MAX_ENTRIES, MAX_TEXT_BYTES, naturalCompare } from './tree';

/** Quantas entradas são medidas por vez: `stat` em massa estoura handles em pasta grande. */
const STAT_BATCH = 64;

export interface FilesDeps {
  fs: FileSystem;
  os: OsName;
  log: Logger;
  /** Raízes navegáveis no momento: repositórios de workspaces abertos e worktrees de execuções. */
  roots(): readonly FileRoot[];
  /** Teto de entradas por listagem e de bytes por leitura; os padrões vêm de `tree.ts`. */
  limits?: { maxEntries?: number; maxTextBytes?: number };
}

function outsideRoot(path: string): MelinnaError {
  return new MelinnaError('FILE_OUTSIDE_ROOT', {
    userMessage: 'Este caminho está fora das pastas abertas no app.',
    details: { path },
  });
}

function unreadable(path: string, cause?: unknown): MelinnaError {
  return new MelinnaError(
    'FILE_UNREADABLE',
    cause === undefined
      ? { userMessage: `Não foi possível ler ${path}.`, details: { path } }
      : { userMessage: `Não foi possível ler ${path}.`, details: { path }, cause },
  );
}

/**
 * Navegação de arquivos restrita às raízes registradas.
 *
 * Toda entrada passa por `realpath` antes da checagem de contenção: comparar só o caminho pedido
 * deixaria um link simbólico apontar para fora da raiz e vazar o sistema de arquivos.
 */
export class FilesService {
  constructor(private readonly deps: FilesDeps) {}

  private get maxEntries(): number {
    return this.deps.limits?.maxEntries ?? MAX_ENTRIES;
  }

  private get maxTextBytes(): number {
    return this.deps.limits?.maxTextBytes ?? MAX_TEXT_BYTES;
  }

  roots(): FileRoot[] {
    return [...this.deps.roots()];
  }

  /** Raízes que valem agora: uma pasta de workspace indisponível não autoriza nada. */
  private activeRoots(): FileRoot[] {
    return this.deps.roots().filter((root) => root.available !== false);
  }

  /** Checagem barata, sem tocar no disco: o caminho literal está dentro de alguma raiz? */
  containsPath(path: string): boolean {
    return this.activeRoots().some((root) => isInsideRoot(root.path, path, this.deps.os));
  }

  async list(rawPath: string): Promise<DirectoryListing> {
    const { os } = this.deps;
    const p = pathModule(os);
    const target = await this.canonicalInside(rawPath);
    const names = await this.readDir(target, rawPath);
    const sorted = [...names].sort(naturalCompare);
    const kept = sorted.slice(0, this.maxEntries);
    const entries: FileEntry[] = [];
    for (let i = 0; i < kept.length; i += STAT_BATCH) {
      const batch = kept.slice(i, i + STAT_BATCH);
      const measured = await Promise.all(
        batch.map(async (name): Promise<FileEntry | null> => {
          const abs = p.join(target, name);
          const st = await this.statOrNull(abs);
          return st === null ? null : toEntry(name, abs, st);
        }),
      );
      for (const entry of measured) if (entry !== null) entries.push(entry);
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return naturalCompare(a.name, b.name);
    });
    const truncated = sorted.length > this.maxEntries;
    this.deps.log.info('files.listed', { path: target, entries: entries.length, truncated });
    return { path: target, entries, truncated };
  }

  async read(rawPath: string): Promise<FileText> {
    const target = await this.canonicalInside(rawPath);
    const st = await this.statOrNull(target);
    if (st === null) throw unreadable(rawPath);
    if (st.isDirectory) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: 'Esta entrada é uma pasta, não um arquivo.',
        details: { path: target },
      });
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.deps.fs.readFile(target);
    } catch (cause) {
      throw unreadable(rawPath, cause);
    }
    const binary = looksBinary(bytes);
    const truncated = bytes.length > this.maxTextBytes;
    const slice = truncated ? bytes.slice(0, this.maxTextBytes) : bytes;
    const content = binary ? '' : new TextDecoder().decode(slice);
    this.deps.log.info('files.read', { path: target, size: st.size, binary, truncated });
    return { path: target, content, size: st.size, binary, truncated, hash: contentHash(bytes) };
  }

  /**
   * Grava o arquivo só se o hash em disco ainda for o que o editor recebeu na leitura.
   *
   * É a exceção do Princípio II: escrita por ação explícita do usuário, com hash antes e depois no
   * log, conflito recusado e gravação atômica (temporário + renomeação).
   */
  async write(rawPath: string, content: string, expectedHash: string): Promise<FileWriteResult> {
    const { fs } = this.deps;
    const target = await this.canonicalInside(rawPath);
    if (this.insideDotGit(target)) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: 'O app não grava dentro da pasta .git de um repositório.',
        details: { path: target },
      });
    }
    const st = await this.statOrNull(target);
    if (st === null || st.isDirectory) throw unreadable(rawPath);

    let current: Uint8Array;
    try {
      current = await fs.readFile(target);
    } catch (cause) {
      throw unreadable(rawPath, cause);
    }
    const before = contentHash(current);
    if (before !== expectedHash) {
      throw new MelinnaError('FILE_CONFLICT', {
        userMessage: 'O arquivo mudou no disco desde que foi aberto. Recarregue antes de salvar.',
        details: { path: target },
      });
    }

    const bytes = new TextEncoder().encode(content);
    if (bytes.length > this.maxTextBytes) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: 'O arquivo é grande demais para salvar por aqui.',
        details: { path: target, size: bytes.length },
      });
    }

    const temp = `${target}.melinna-tmp`;
    try {
      await fs.writeFile(temp, bytes, { flag: 'w' });
      await fs.rename(temp, target);
    } catch (cause) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw unreadable(rawPath, cause);
    }
    const after = contentHash(bytes);
    this.deps.log.info('files.written', { path: target, size: bytes.length, before, after });
    return { path: target, size: bytes.length, hash: after };
  }

  /** Caminho canônico que está dentro de alguma raiz; fora dela, `FILE_OUTSIDE_ROOT`. */
  private async canonicalInside(rawPath: string): Promise<string> {
    let real: string;
    try {
      real = await this.deps.fs.realpath(rawPath);
    } catch (cause) {
      throw unreadable(rawPath, cause);
    }
    const inside = this.activeRoots().some((root) => isInsideRoot(root.path, real, this.deps.os));
    if (!inside) throw outsideRoot(rawPath);
    return real;
  }

  /** O caminho passa por uma pasta `.git` dentro da raiz que o contém? Nunca se grava ali. */
  private insideDotGit(real: string): boolean {
    const p = pathModule(this.deps.os);
    const root = this.activeRoots().find((r) => isInsideRoot(r.path, real, this.deps.os));
    if (!root) return false;
    const rel = p.relative(p.resolve(root.path), p.resolve(real));
    return rel.split(/[\\/]+/).some((segment) => segment.toLowerCase() === '.git');
  }

  private async readDir(target: string, rawPath: string): Promise<string[]> {
    try {
      return await this.deps.fs.readdir(target);
    } catch (cause) {
      throw unreadable(rawPath, cause);
    }
  }

  private async statOrNull(abs: string): Promise<FileStat | null> {
    try {
      return await this.deps.fs.stat(abs);
    } catch {
      // entrada que sumiu entre o `readdir` e o `stat`: sai da listagem em vez de derrubar a pasta
      return null;
    }
  }
}

function toEntry(name: string, abs: string, st: FileStat): FileEntry {
  return {
    name,
    path: abs,
    kind: st.isDirectory ? 'directory' : 'file',
    size: st.size,
  };
}
