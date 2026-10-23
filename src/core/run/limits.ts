/** Limites das configurações de execução (validados no main e no núcleo). */
export const RUN_LIMITS = {
  label: 80,
  program: 4096,
  args: 64,
  arg: 4096,
  /** Maior arquivo de projeto lido pelo detector. */
  projectFileBytes: 1024 * 1024,
} as const;
