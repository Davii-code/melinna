import type { AgentDefinition, Execution, RunCommand } from '../../src/shared/ipc-contract';

export function agentDef(id: string, over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id,
    displayName: id === 'claude' ? 'Claude Code' : id,
    kind: 'agent',
    executable: { command: id },
    args: [],
    prompt: { delivery: 'argument', args: ['{prompt}'] },
    model: {
      options: [
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'opus', label: 'Opus' },
      ],
      default: 'sonnet',
      allowCustom: true,
      args: ['--model', '{model}'],
      switch: { strategy: 'pty-command', template: '/model {model}\r' },
    },
    permission: {
      options: [
        { id: 'manual', label: 'Perguntar', args: [] },
        { id: 'bypass', label: 'Sem confirmações', args: ['--yolo'], dangerous: true },
      ],
      default: 'manual',
      switch: { strategy: 'restart-resume' },
    },
    resume: { args: ['--continue'] },
    detect: { strategy: 'path' },
    ...over,
  };
}

export function execution(id: string, over: Partial<Execution> = {}): Execution {
  return {
    id,
    taskId: 't1',
    agentId: 'claude',
    bandIndex: 0,
    model: 'sonnet',
    permissionMode: 'manual',
    branch: `melinna/t/${id}`,
    worktreePath: `/data/worktrees/r/${id}`,
    baseCommit: 'a'.repeat(40),
    status: 'running',
    pendingSwitch: null,
    pid: 10,
    exitCode: null,
    signal: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    launchCount: 1,
    failure: null,
    ...over,
  };
}

/** Entrada de shell: sem modelo, sem modos de permissão e sem enunciado. */
export function shellDef(id: string, displayName = id): AgentDefinition {
  const { model: _model, permission: _permission, resume: _resume, ...rest } = agentDef(id);
  return { ...rest, displayName, kind: 'shell', prompt: { delivery: 'none' } };
}

/** Configuração de execução disponível; `over` ajusta o que o teste precisa. */
export function runCommand(over: Partial<RunCommand> = {}): RunCommand {
  return {
    id: 'c1',
    groupId: 'g1',
    source: 'npm',
    tool: 'npm',
    label: 'dev',
    program: 'npm',
    args: ['run', 'dev'],
    folder: '/repo',
    available: true,
    unavailableReason: null,
    searched: 'npm',
    ...over,
  };
}
