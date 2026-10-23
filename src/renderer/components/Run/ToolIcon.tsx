import type { RunTool } from '../../../shared/ipc-contract';

/** Sigla curta de cada ferramenta: ícone próprio do app, sem logotipos de terceiros. */
const TOOL_LABEL: Record<RunTool, string> = {
  npm: 'npm',
  pnpm: 'pnpm',
  yarn: 'yarn',
  maven: 'mvn',
  gradle: 'gradle',
  compose: 'compose',
  custom: '▸',
};

export function toolName(tool: RunTool): string {
  return tool === 'custom' ? 'personalizada' : tool;
}

/** Selo do tipo da configuração de execução. */
export function ToolIcon({ tool }: { tool: RunTool }) {
  return (
    <span
      className="run-tool"
      data-testid="run-tool-icon"
      data-tool={tool}
      title={toolName(tool)}
      aria-hidden="true"
    >
      {TOOL_LABEL[tool]}
    </span>
  );
}
