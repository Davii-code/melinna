/** De onde veio a configuração: arquivo de projeto detectado ou criada pelo usuário no workspace. */
export type RunSource = 'npm' | 'maven' | 'gradle' | 'compose' | 'custom';

/** Ferramenta da configuração (ícone e rótulo no seletor); npm/pnpm/yarn vêm do arquivo de lock. */
export type RunTool = 'npm' | 'pnpm' | 'yarn' | 'maven' | 'gradle' | 'compose' | 'custom';

export type RunUnavailableReason = 'not-found' | 'folder-outside';

export interface RunCommand {
  /** Detectado: hash estável de workspace + pasta + origem + nome; personalizado: gerado. */
  id: string;
  /** Workspace dono da configuração. */
  groupId: string;
  source: RunSource;
  tool: RunTool;
  label: string;
  /** Nome ou caminho do programa; resolvido no lançamento. */
  program: string;
  args: string[];
  /** Pasta do workspace (absoluta) onde o comando roda. */
  folder: string;
  /** Calculado, nunca persistido: o programa foi encontrado e a pasta ainda é do workspace. */
  available: boolean;
  /** Calculado, nunca persistido: por que não está disponível; `null` quando está. */
  unavailableReason: RunUnavailableReason | null;
  /** Calculado, nunca persistido: o que foi procurado quando o programa está ausente. */
  searched: string;
}

export interface RunWarning {
  groupId: string;
  folder: string;
  message: string;
}

/** Resultado da detecção: scripts e arquivos de projeto encontrados e os avisos. */
export interface RunCatalog {
  commands: RunCommand[];
  warnings: RunWarning[];
}

/** Ferramenta de uma configuração salva; `program` roda um executável qualquer. */
export type RunConfigTool = 'npm' | 'pnpm' | 'yarn' | 'maven' | 'gradle' | 'compose' | 'program';

export const RUN_CONFIG_TOOLS: readonly RunConfigTool[] = [
  'npm',
  'pnpm',
  'yarn',
  'maven',
  'gradle',
  'compose',
  'program',
];

export interface RunEnvVar {
  name: string;
  value: string;
}

/** Configuração de execução salva no workspace (`Group.runConfigs`, esquema 4). */
export interface RunConfig {
  id: string;
  /** 1–80 caracteres, único no workspace (sem diferenciar maiúsculas). */
  name: string;
  tool: RunConfigTool;
  /** Caminho absoluto de uma pasta do workspace. */
  folder: string;
  /** Script (npm/pnpm/yarn) ou objetivos/tarefas (maven/gradle); `null` em compose e program. */
  script: string | null;
  /** Só na ferramenta `program` vem do usuário; nas demais o núcleo deriva. */
  program: string;
  args: string[];
  /** Vira NODE_OPTIONS / MAVEN_OPTS / GRADLE_OPTS; vazio em compose e program. */
  runtimeOptions: string;
  env: RunEnvVar[];
  /** Id de outra configuração do mesmo workspace, rodada antes e sem ciclo. */
  beforeLaunch: string | null;
  allowParallel: boolean;
  /** Pasta de agrupamento na árvore da janela de configurações. */
  folderGroup: string | null;
  /** Posição dentro do grupo (ferramenta + pasta). */
  order: number;
}

/** Dados vindos do usuário: sem `order` (o núcleo calcula); `id` presente = edição. */
export type RunConfigInput = Omit<RunConfig, 'id' | 'order'> & { id?: string };

export type RunConfigUnavailableReason =
  'folder-missing' | 'program-missing' | 'script-missing' | 'before-launch-missing' | 'unsafe-target';

/** Configuração com o que é calculado agora, nunca persistido. */
export interface RunConfigView extends RunConfig {
  groupId: string;
  available: boolean;
  unavailableReason: RunConfigUnavailableReason | null;
  /** O que foi procurado quando o programa está ausente. */
  searched: string;
  /** Instâncias vivas. */
  running: number;
}

/** Resposta de `run:list`: salvas, detectadas (só origem para criar uma salva) e avisos da detecção. */
export interface RunListing {
  configs: RunConfigView[];
  detected: RunCommand[];
  warnings: RunWarning[];
}

export interface RunReorderItem {
  id: string;
  folderGroup: string | null;
  order: number;
}

/** Escolha do usuário quando o wrapper do projeto não tem bit de execução. */
export type RunChoice = 'wrapper-sh' | 'system-tool';

export interface RunStarted {
  taskId: string;
  execId: string;
  /** A configuração já rodava: o painel existente é o que o usuário vê. */
  reused: boolean;
}

/** O wrapper do projeto não tem permissão de execução: o usuário escolhe como seguir. */
export interface RunNeedsConfirm {
  needsConfirm: 'wrapper-sh';
  wrapper: string;
}

/**
 * Comando de uma execução; `file` é o caminho já resolvido do programa. `tool`, `env` e `runtimeOptions` (da
 * configuração salva) montam o ambiente a cada lançamento, inclusive nos relançamentos pelo painel; ficam
 * ausentes quando vazios.
 */
export interface ExecutionCommand {
  commandId: string;
  label: string;
  file: string;
  args: string[];
  tool?: RunConfigTool;
  env?: RunEnvVar[];
  runtimeOptions?: string;
}

/** Marcador de `Execution.agentId` nas execuções de comando (não existe no catálogo de agentes). */
export const COMMAND_AGENT_ID = 'command';
