import type { Placeholder } from './schema';

export type PlaceholderValues = Partial<Record<Placeholder, string>>;

/** Substitui elementos que são exatamente um placeholder; nunca substitui parte de um argumento. */
export function substituteArgs(args: readonly string[], values: PlaceholderValues): string[] {
  return args.map((a) => {
    const v = values[a as Placeholder];
    return v === undefined ? a : v;
  });
}

/** Preenche o template de troca em voo (`/model {model}\r`). */
export function fillTemplate(template: string, values: PlaceholderValues): string {
  return template.replace(/\{(model|permission)\}/g, (m) => values[m as Placeholder] ?? m);
}
