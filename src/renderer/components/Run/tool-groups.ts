import type { RunConfigTool } from '../../../shared/ipc-contract';

/** Grupo da árvore e do seletor; npm, pnpm e yarn ficam juntos. */
export type ToolGroup = 'npm' | 'maven' | 'gradle' | 'compose' | 'program';

export const TOOL_GROUPS: readonly { id: ToolGroup; label: string }[] = [
  { id: 'npm', label: 'npm' },
  { id: 'maven', label: 'Maven' },
  { id: 'gradle', label: 'Gradle' },
  { id: 'compose', label: 'Compose' },
  { id: 'program', label: 'Programa' },
];

export function toolGroupOf(tool: RunConfigTool): ToolGroup {
  return tool === 'pnpm' || tool === 'yarn' ? 'npm' : tool;
}
