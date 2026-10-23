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

/** Forma persistida em `Group.commands`: só configurações personalizadas, sem os campos calculados. */
export type StoredCommand = Omit<
  RunCommand,
  'groupId' | 'tool' | 'available' | 'unavailableReason' | 'searched'
>;

export interface RunWarning {
  groupId: string;
  folder: string;
  message: string;
}

/** Configurações de todos os workspaces (personalizadas antes das detectadas) e os avisos da detecção. */
export interface RunCatalog {
  commands: RunCommand[];
  warnings: RunWarning[];
}

/** Escolha do usuário quando o wrapper do projeto não tem bit de execução. */
export type RunChoice = 'wrapper-sh' | 'system-tool';

/** Dados de uma configuração personalizada vindos do usuário; `id` presente = edição. */
export interface RunCommandInput {
  id?: string;
  label: string;
  program: string;
  args: string[];
  folder: string;
}

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

/** Comando de uma execução; `file` é o caminho já resolvido do programa. */
export interface ExecutionCommand {
  commandId: string;
  label: string;
  file: string;
  args: string[];
}

/** Marcador de `Execution.agentId` nas execuções de comando (não existe no catálogo de agentes). */
export const COMMAND_AGENT_ID = 'command';
