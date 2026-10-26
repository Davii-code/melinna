import type { RunConfig, RunConfigTool } from './types';

/** Variável que recebe `runtimeOptions` em cada ferramenta; compose e program não têm. */
export function runtimeVariable(tool: RunConfigTool): string | null {
  switch (tool) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return 'NODE_OPTIONS';
    case 'maven':
      return 'MAVEN_OPTS';
    case 'gradle':
      return 'GRADLE_OPTS';
    default:
      return null;
  }
}

/** A chave de `env` que casa com `name` sem diferenciar maiúsculas (no Windows os nomes são assim). */
function keyOf(env: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  return Object.keys(env).find((k) => k.toLowerCase() === wanted);
}

/**
 * Ambiente do processo: o ambiente base, depois as variáveis da configuração (vencem), e por fim
 * `runtimeOptions` acrescentado ao fim da variável da ferramenta, separado por espaço — inclusive
 * quando essa variável vem da própria configuração. Não altera o objeto de entrada.
 */
export function buildEnv(
  base: Readonly<Record<string, string | undefined>>,
  config: Pick<RunConfig, 'tool' | 'env' | 'runtimeOptions'>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined) env[name] = value;
  }
  for (const { name, value } of config.env) {
    const existing = keyOf(env, name);
    if (existing !== undefined) delete env[existing];
    env[name] = value;
  }
  const variable = runtimeVariable(config.tool);
  const options = config.runtimeOptions.trim();
  if (variable !== null && options !== '') {
    const existing = keyOf(env, variable) ?? variable;
    const current = env[existing] ?? '';
    env[existing] = current === '' ? options : `${current} ${options}`;
  }
  return env;
}

/** Só os nomes das variáveis da configuração, para log: os valores nunca saem. */
export function envNames(config: Pick<RunConfig, 'env'>): string[] {
  return config.env.map((v) => v.name);
}
