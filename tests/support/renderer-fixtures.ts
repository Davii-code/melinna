import type { AgentDefinition, Execution } from '../../src/shared/ipc-contract';

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
