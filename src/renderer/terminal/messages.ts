import type { MarkerKind } from '../../shared/ipc-contract';

const DIM = '\x1b[0m\x1b[2m';
const RESET = '\x1b[0m';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

/** Linha visível (pt-BR) para cada marca do histórico. */
export function markerLine(kind: MarkerKind, lostBytes?: number): string | null {
  switch (kind) {
    case 'discarded':
      return `${RESET}\r\n${DIM}── histórico anterior descartado (limite de 8 MB) ──${RESET}\r\n`;
    case 'gap':
      return `${RESET}\r\n${DIM}── lacuna no histórico${lostBytes ? ` (${formatBytes(lostBytes)} não gravados)` : ''} ──${RESET}\r\n`;
    case 'separator':
      return `${RESET}\r\n${DIM}── relançado ──${RESET}\r\n`;
    case 'replay-start':
    case 'replay-end':
      return null;
  }
}

export function exitLine(exitCode: number | null, signal: string | null): string {
  const why = signal ? `sinal ${signal}` : `código ${exitCode ?? '?'}`;
  return `${RESET}\r\n${DIM}── processo encerrado (${why}) ──${RESET}\r\n`;
}
