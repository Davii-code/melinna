const PHASES: Record<string, string> = {
  'Enumerating objects': 'Enumerando objetos',
  'Counting objects': 'Contando objetos',
  'Compressing objects': 'Compactando objetos',
  'Receiving objects': 'Recebendo objetos',
  'Writing objects': 'Enviando objetos',
  'Unpacking objects': 'Descompactando objetos',
  'Resolving deltas': 'Resolvendo deltas',
};

const LINE =
  /(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Writing objects|Unpacking objects|Resolving deltas):\s+(\d+)%/g;

/** Última fase com porcentagem num pedaço do stderr do git (`Receiving objects:  45% (9/20)`), ou `null`. */
export function parseProgress(chunk: string): { phase: string; percent: number } | null {
  let last: { phase: string; percent: number } | null = null;
  for (const m of chunk.matchAll(LINE)) {
    last = { phase: PHASES[m[1]!] ?? m[1]!, percent: Number(m[2]) };
  }
  return last;
}
