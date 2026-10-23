import type { OsName } from '../ports/platform';

export const CATALOG_SCHEMA_VERSION = 1;

export type SwitchStrategy =
  | { strategy: 'pty-command'; template: string }
  | { strategy: 'restart-resume' }
  | { strategy: 'unsupported' };

export interface ModelSpec {
  options: Array<{ id: string; label: string }>;
  default: string;
  allowCustom: boolean;
  args: string[];
  switch: SwitchStrategy;
}

export interface PermissionOption {
  id: string;
  label: string;
  args: string[];
  dangerous?: boolean;
}

export interface PermissionSpec {
  options: PermissionOption[];
  default: string;
  switch: SwitchStrategy;
}

export type PromptSpec =
  { delivery: 'argument'; args: string[] } | { delivery: 'pty' } | { delivery: 'none' };

/**
 * Como o agente recebe pastas extras: `repeat` repete `args` por pasta (`{dir}`); `join` passa uma só
 * vez, com as pastas unidas por `separator` em `{dirs}`.
 */
export type ExtraDirsSpec =
  | { style: 'repeat'; args: string[] }
  | { style: 'join'; separator: string; args: string[] };

/**
 * Como o agente recebe uma imagem no prompt: `template` com `{path}` (ex.: `{path}`, `@{path}`) e se o
 * caminho leva aspas sempre ou só quando precisa (espaço ou aspas no caminho).
 */
export interface ImagesSpec {
  template: string;
  quote: 'always' | 'when-needed';
}

export interface AgentDefinition {
  id: string;
  displayName: string;
  kind: 'agent' | 'shell';
  platforms?: OsName[];
  verifiedWith?: string;
  executable: {
    command: string;
    windows?: {
      command?: string;
      npmShim?: { package: string; bin: string };
    };
  };
  args: string[];
  prompt: PromptSpec;
  model?: ModelSpec;
  permission?: PermissionSpec;
  resume?: { args: string[] };
  extraDirs?: ExtraDirsSpec;
  images?: ImagesSpec;
  detect: { strategy: 'path' };
}

export interface CatalogFile {
  schemaVersion: 1;
  agents: AgentDefinition[];
}

export type CatalogSource = 'builtin' | 'user';

export interface CatalogIssue {
  source: CatalogSource;
  id?: string;
  reason: string;
}

export interface CatalogLoadResult {
  agents: AgentDefinition[];
  invalid: CatalogIssue[];
}

export const PLACEHOLDERS = ['{model}', '{prompt}', '{permission}', '{dir}', '{dirs}'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CUSTOM_MODEL_RE = /^[A-Za-z0-9._:/@-]{1,100}$/;
