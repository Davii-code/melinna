import { MelinnaError } from '../errors';
import { errorCode, type FileSystem } from '../ports/file-system';
import { pathModule } from '../paths';
import type { OsName } from '../ports/platform';

export interface WorktreeLease {
  execId: string;
  worktreePath: string;
  createdAt: string;
}

export async function readLease(
  fs: FileSystem,
  leasePath: string,
): Promise<WorktreeLease | null | 'unreadable'> {
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(leasePath);
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    return 'unreadable';
  }
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Partial<WorktreeLease>;
    if (typeof raw.execId === 'string' && typeof raw.worktreePath === 'string') {
      return { execId: raw.execId, worktreePath: raw.worktreePath, createdAt: String(raw.createdAt ?? '') };
    }
  } catch {
    return 'unreadable';
  }
  return 'unreadable';
}

export interface AcquireLeaseOptions {
  fs: FileSystem;
  os: OsName;
  leasePath: string;
  lease: WorktreeLease;
  isKnownExecution: (execId: string) => boolean;
}

/**
 * Adquire a posse exclusiva do worktree (`flag: 'wx'`). Já possuída pela mesma execução: mantém.
 * Possuída por outra execução conhecida: WORKTREE_IN_USE. Lease sem execução: WORKTREE_RESIDUE.
 */
export async function acquireLease(opts: AcquireLeaseOptions): Promise<'acquired' | 'kept'> {
  const { fs, leasePath, lease } = opts;
  await fs.mkdir(pathModule(opts.os).dirname(leasePath), { recursive: true });
  try {
    await fs.writeFile(leasePath, JSON.stringify(lease), { flag: 'wx' });
    return 'acquired';
  } catch (err) {
    if (errorCode(err) !== 'EEXIST') throw err;
  }
  const current = await readLease(fs, leasePath);
  if (current && current !== 'unreadable') {
    if (current.execId === lease.execId) return 'kept';
    if (opts.isKnownExecution(current.execId)) {
      throw new MelinnaError('WORKTREE_IN_USE', {
        userMessage: `Worktree em uso pela execução ${current.execId}.`,
        details: { ownerExecId: current.execId },
      });
    }
  }
  throw new MelinnaError('WORKTREE_RESIDUE', {
    userMessage: 'Há um registro de posse sem execução para este worktree.',
    details: { residuePath: lease.worktreePath },
  });
}

/** Confere que o lease existente pertence à execução (relançamento). */
export async function verifyLeaseOwner(fs: FileSystem, leasePath: string, execId: string): Promise<boolean> {
  const current = await readLease(fs, leasePath);
  return current !== null && current !== 'unreadable' && current.execId === execId;
}

export async function releaseLease(fs: FileSystem, leasePath: string): Promise<void> {
  await fs.rm(leasePath, { force: true });
}
