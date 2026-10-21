import type { DiffLine, Hunk } from '../core/api-types';

export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Monta as linhas lado a lado de um hunk: contexto dos dois lados; cada bloco de remoções é pareado,
 * linha a linha, com as adições que vêm logo depois; sobras ficam com o outro lado vazio.
 */
export function toSideBySide(hunk: Hunk): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i += 1) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === 'context') {
      flush();
      rows.push({ left: line, right: line });
    } else if (line.kind === 'del') {
      if (adds.length > 0) flush();
      dels.push(line);
    } else {
      adds.push(line);
    }
  }
  flush();
  return rows;
}
