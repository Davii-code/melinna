/** Variáveis preenchidas pelo núcleo com os dados da sessão de destino; a interface não as pergunta. */
export const AUTO_VARIABLES: readonly string[] = ['pasta', 'workspace', 'data'];

const VARIABLE = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Variáveis `{{nome}}` do texto: únicas, na ordem da primeira ocorrência (mesma regra do núcleo). */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VARIABLE)) seen.add(m[1]!);
  return [...seen];
}

export function isAutoVariable(name: string): boolean {
  return AUTO_VARIABLES.includes(name);
}

export function braces(name: string): string {
  return `{{${name}}}`;
}
