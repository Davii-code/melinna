import { execFile } from 'node:child_process';

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // já terminou
    }
  }
}

/**
 * Encerra à força a árvore de um processo criado por este hospedeiro.
 * Windows: `taskkill /PID <pid> /T /F`. POSIX: SIGTERM ao grupo e SIGKILL após 1 s.
 */
export function killTree(pid: number, isAlive: () => boolean): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false }, () =>
        resolve(),
      );
    });
  }
  signalGroup(pid, 'SIGTERM');
  return new Promise((resolve) => {
    setTimeout(() => {
      if (isAlive()) signalGroup(pid, 'SIGKILL');
      resolve();
    }, 1000);
  });
}

/** Depois de uma saída graciosa, encerra descendentes que ficaram no grupo (POSIX). */
export function reapGroup(pid: number): void {
  if (process.platform !== 'win32') signalGroup(pid, 'SIGTERM');
}
