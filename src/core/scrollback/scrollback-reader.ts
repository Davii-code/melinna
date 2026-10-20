import type { PendingChunk } from './scrollback-writer';
import type { ReplayItem } from './segment-store';

/**
 * Junta o que está em disco (já com marcas) com a fila em memória ainda não gravada, a partir de `fromOffset`,
 * sem lacuna nem duplicação. Devolve os itens e o deslocamento seguinte ao último byte reproduzido.
 */
export function mergeReplay(
  disk: ReplayItem[],
  pending: PendingChunk[],
  fromOffset: number,
): { items: ReplayItem[]; endOffset: number } {
  const items: ReplayItem[] = [];
  let cursor = fromOffset;
  for (const it of disk) {
    if (it.kind === 'data') {
      items.push(it);
      cursor = it.offset + it.bytes.length;
    } else if (it.marker === 'discarded') {
      items.push(it);
      cursor += it.lostBytes;
    } else {
      // Lacuna no fim do disco pode estar coberta pela fila em memória.
      const covered = pending.find((c) => c.offset <= cursor && c.offset + c.bytes.length > cursor);
      if (covered) break;
      items.push(it);
      cursor += it.lostBytes;
    }
  }
  for (const chunk of pending) {
    const end = chunk.offset + chunk.bytes.length;
    if (end <= cursor) continue;
    if (chunk.offset > cursor) {
      items.push({ kind: 'marker', marker: 'gap', lostBytes: chunk.offset - cursor });
      cursor = chunk.offset;
    }
    items.push({ kind: 'data', offset: cursor, bytes: chunk.bytes.subarray(cursor - chunk.offset) });
    cursor = end;
  }
  return { items, endOffset: cursor };
}
