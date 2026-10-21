import type { CustomGrid } from '../persistence/state-schema';

/** Move o item da posição `from` para `to`. Posições fora da lista devolvem uma cópia inalterada. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved as T);
  return out;
}

/** Troca as células de dois painéis na grade personalizada; quem não tinha célula assume a do outro. */
export function swapCells(grid: CustomGrid, a: string, b: string): CustomGrid {
  const cells = { ...grid.cells };
  const ca = cells[a];
  const cb = cells[b];
  if (cb) cells[a] = cb;
  else delete cells[a];
  if (ca) cells[b] = ca;
  else delete cells[b];
  return { ...grid, cells };
}
