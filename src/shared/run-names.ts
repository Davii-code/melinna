/** Nomes de variáveis de ambiente cujo valor a interface mostra mascarado. */
const SECRET_NAME = /TOKEN|PASSWORD|PASSWD|SECRET|KEY|CREDENTIAL/i;

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

const COPY_SUFFIX = / \(cópia(?: \d+)?\)$/;

/**
 * Nome da cópia de uma configuração: "X (cópia)", depois "X (cópia 2)", "X (cópia 3)"… o primeiro que não
 * existe entre `names` (sem diferenciar maiúsculas). Copiar uma cópia parte do nome original.
 */
export function copyName(name: string, names: readonly string[]): string {
  const base = name.replace(COPY_SUFFIX, '');
  const taken = new Set(names.map((n) => n.toLowerCase()));
  let candidate = `${base} (cópia)`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (cópia ${n})`;
  return candidate;
}
