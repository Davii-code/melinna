/**
 * Texto digitado → vetor de argumentos: espaço separa, aspas simples ou duplas agrupam (e saem do
 * resultado), `""` é um argumento vazio. Aspas sem fechamento valem até o fim do texto. Nada é
 * interpretado: `&`, `;`, `$(…)` e afins chegam ao processo como texto, sem shell.
 */
export function tokenizeArgs(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

/** O inverso aproximado, para mostrar o vetor num campo de texto: argumentos com espaço ou aspas vão entre aspas. */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((a) => {
      if (a === '') return '""';
      if (!/[\s"']/.test(a)) return a;
      return a.includes('"') ? `'${a}'` : `"${a}"`;
    })
    .join(' ');
}
