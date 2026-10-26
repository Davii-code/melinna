export type LineChangeKind = 'added' | 'modified' | 'removed';

/**
 * Uma marca da margem: linhas do texto atual (a partir de 1) e o trecho que havia no último commit. Em
 * `removed`, `fromLine = toLine` é a linha logo depois do ponto de onde as linhas saíram.
 */
export interface LineChange {
  fromLine: number;
  toLine: number;
  kind: LineChangeKind;
  /** As linhas do último commit que este trecho substitui (vazio em `added`). */
  original: string;
  /** Em `removed`: as linhas saíram depois da última linha do texto atual (a marca fica nela). */
  atEnd?: boolean;
}

/** Acima disto (linhas adicionadas mais removidas) a margem não é calculada. */
export const LINE_DIFF_MAX_CHANGED = 5000;

/** Linhas do texto com o fim de linha normalizado: CRLF × LF sozinho não marca nada. */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Pares iguais (índice no original, índice no atual), em ordem, pelo algoritmo de Myers em espaço linear
 * (meio da "cobra" e divisão recursiva), depois de cortar o começo e o fim iguais.
 */
function matchingPairs(a: Int32Array, b: Int32Array): [number, number][] {
  const pairs: [number, number][] = [];
  const size = a.length + b.length + 2;
  const vf = new Int32Array(2 * size + 1);
  const vb = new Int32Array(2 * size + 1);
  const offset = size;

  const middleSnake = (
    aLo: number,
    aHi: number,
    bLo: number,
    bHi: number,
  ): [number, number, number, number] => {
    const n = aHi - aLo;
    const m = bHi - bLo;
    const delta = n - m;
    const odd = (delta & 1) !== 0;
    const max = Math.ceil((n + m) / 2);
    vf[offset + 1] = 0;
    vb[offset + 1] = 0;
    for (let d = 0; d <= max; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && (vf[offset + k - 1] ?? 0) < (vf[offset + k + 1] ?? 0))
            ? (vf[offset + k + 1] ?? 0)
            : (vf[offset + k - 1] ?? 0) + 1;
        let y = x - k;
        const x0 = x;
        const y0 = y;
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
          x++;
          y++;
        }
        vf[offset + k] = x;
        if (odd && k >= delta - (d - 1) && k <= delta + (d - 1) && x + (vb[offset + delta - k] ?? 0) >= n) {
          return [x0, y0, x, y];
        }
      }
      for (let k = -d; k <= d; k += 2) {
        let x =
          k === -d || (k !== d && (vb[offset + k - 1] ?? 0) < (vb[offset + k + 1] ?? 0))
            ? (vb[offset + k + 1] ?? 0)
            : (vb[offset + k - 1] ?? 0) + 1;
        let y = x - k;
        const x0 = x;
        const y0 = y;
        while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
          x++;
          y++;
        }
        vb[offset + k] = x;
        if (!odd && delta - k >= -d && delta - k <= d && x + (vf[offset + delta - k] ?? 0) >= n) {
          return [n - x, m - y, n - x0, m - y0];
        }
      }
    }
    return [n, m, n, m];
  };

  const walk = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
      pairs.push([aLo, bLo]);
      aLo++;
      bLo++;
    }
    const tail: [number, number][] = [];
    while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
      aHi--;
      bHi--;
      tail.push([aHi, bHi]);
    }
    if (aLo < aHi && bLo < bHi) {
      const [x, y, u, v] = middleSnake(aLo, aHi, bLo, bHi);
      walk(aLo, aLo + x, bLo, bLo + y);
      for (let i = 0; i < u - x; i++) pairs.push([aLo + x + i, bLo + y + i]);
      walk(aLo + u, aHi, bLo + v, bHi);
    }
    for (let i = tail.length - 1; i >= 0; i--) pairs.push(tail[i] as [number, number]);
  };

  walk(0, a.length, 0, b.length);
  return pairs;
}

/**
 * Marcas da margem entre o texto do último commit (`base`) e o texto da aba (`current`). Devolve `'off'`
 * quando há mais de {@link LINE_DIFF_MAX_CHANGED} linhas alteradas: aí a margem não é desenhada.
 */
export function diffLines(base: string, current: string): LineChange[] | 'off' {
  const baseLines = splitLines(base);
  const curLines = splitLines(current);
  const ids = new Map<string, number>();
  const idOf = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = Int32Array.from(baseLines, idOf);
  const b = Int32Array.from(curLines, idOf);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (endA - start + (endB - start) > LINE_DIFF_MAX_CHANGED * 4) return 'off';
  const middle = matchingPairs(a.subarray(start, endA), b.subarray(start, endB)).map(
    ([i, j]): [number, number] => [i + start, j + start],
  );
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  pairs.push(...middle);
  for (let i = 0; i < a.length - endA; i++) pairs.push([endA + i, endB + i]);
  pairs.push([a.length, b.length]);

  const changes: LineChange[] = [];
  let changed = 0;
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    if (pi > i || pj > j) {
      const removed = baseLines.slice(i, pi);
      changed += pi - i + (pj - j);
      if (pj > j && pi > i) {
        changes.push({ fromLine: j + 1, toLine: pj, kind: 'modified', original: removed.join('\n') });
      } else if (pj > j) {
        changes.push({ fromLine: j + 1, toLine: pj, kind: 'added', original: '' });
      } else {
        const at = Math.max(1, Math.min(j + 1, curLines.length));
        const removal: LineChange = {
          fromLine: at,
          toLine: at,
          kind: 'removed',
          original: removed.join('\n'),
        };
        if (j + 1 > curLines.length) removal.atEnd = true;
        changes.push(removal);
      }
    }
    i = pi + 1;
    j = pj + 1;
  }
  return changed > LINE_DIFF_MAX_CHANGED ? 'off' : changes;
}
