import { MelinnaError } from '../errors';

const VARIABLE = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Caracteres de controle (C0 e DEL, incluindo ESC) exceto quebra de linha e tabulação. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;

export const AUTO_VARIABLES = ['pasta', 'workspace', 'data'] as const;
export type AutoVariable = (typeof AUTO_VARIABLES)[number];
export type AutoValues = Record<AutoVariable, string>;

/** Variáveis `{{nome}}` do texto: únicas, na ordem da primeira ocorrência. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VARIABLE)) seen.add(m[1]!);
  return [...seen];
}

export function isAutoVariable(name: string): name is AutoVariable {
  return (AUTO_VARIABLES as readonly string[]).includes(name);
}

export function hasControlChars(text: string): boolean {
  return CONTROL.test(text);
}

/** Recusa texto com caracteres de controle: ele poderia fechar a colagem entre marcadores e injetar teclas. */
export function assertNoControlChars(text: string): void {
  if (CONTROL.test(text)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: 'O prompt contém caracteres de controle; remova-os.',
    });
  }
}

/**
 * Substitui as variáveis em uma passada só: o valor inserido nunca é reexpandido nem interpreta `$&`/`$1`.
 * As automáticas vêm da sessão de destino e vencem o que foi informado. Variável sem valor falha, a menos
 * que conste em `allowEmpty`.
 */
export function resolve(
  body: string,
  values: Readonly<Record<string, string>>,
  auto: AutoValues,
  allowEmpty: readonly string[] = [],
): string {
  return body.replace(VARIABLE, (_match, name: string) => {
    const value = isAutoVariable(name) ? auto[name] : values[name];
    if (value !== undefined && value !== '') return value;
    if (allowEmpty.includes(name)) return '';
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `Preencha a variável {{${name}}} ou marque para deixar vazia.`,
    });
  });
}

/** Texto colado do Windows traz `\r\n`; o núcleo trabalha só com `\n`. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}
