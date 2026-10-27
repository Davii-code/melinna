import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CatalogService } from '../../../../src/core/catalog/catalog-service';
import { OrchestrationService } from '../../../../src/core/orchestration/orchestration-service';
import { DEFAULT_TEAM, type Provider } from '../../../../src/core/orchestration/types';
import { NodeFileSystem } from '../../../../src/adapters/node-fs';
import { nodePlatform } from '../../../../src/adapters/node-platform';
import { CliOrchestrationRuntime } from '../../../../src/adapters/orchestration-runtime';
import { JsonOrchestrationStore } from '../../../../src/adapters/orchestration-store';
import { LocalDelegationBridge } from '../../../../src/main/orchestration/mcp-bridge';
import { MemoryLogger } from '../../../support/fakes/logger';
import { createTempRepo } from '../../../support/git-fixture';
import { removeDirRecursive } from '../../../support/temp-dirs';

/** Explicitly opt in: invokes installed real CLIs and may consume account usage. */
describe.skipIf(process.env.MELINNA_LIVE_ORCHESTRATION !== '1')('real CLI cross-provider smoke', () => {
  it.each([
    ['claude', 'codex'],
    ['codex', 'claude'],
  ] as const)(
    '%s delegates one read-only task to %s',
    async (coordinator: Provider, worker: Provider) => {
      const repo = createTempRepo();
      const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-live-orchestration-')));
      mkdirSync(join(root, 'data'));
      const fs = new NodeFileSystem();
      const catalog = new CatalogService({
        fs,
        platform: nodePlatform(),
        log: new MemoryLogger(),
        builtinPath: join(__dirname, '../../../../catalog/agents.json'),
        userPath: join(root, 'unused-catalog.json'),
      });
      const runtime = new CliOrchestrationRuntime({
        catalog,
        fs,
        platform: nodePlatform(),
        root: join(root, 'data'),
        env: process.env as Record<string, string>,
      });
      const bridge = new LocalDelegationBridge((runId, name, args) => service.tool(runId, name, args));
      const service: OrchestrationService = new OrchestrationService({
        store: new JsonOrchestrationStore(join(root, 'state.json')),
        runtime,
        bridge,
        newId: randomUUID,
        workspace: () => repo.root,
        now: () => new Date().toISOString(),
        changed: () => undefined,
      });
      try {
        await service.load();
        const team = await service.saveTeam({
          ...structuredClone(DEFAULT_TEAM),
          name: 'Read-only live smoke',
          coordinator: {
            ...DEFAULT_TEAM.coordinator,
            provider: coordinator,
            model: coordinator === 'claude' ? 'haiku' : '',
            instructions:
              'This is a bounded integration smoke. You MUST call melinna delegate_task exactly once with roleId researcher, requestKey smoke-one and prompt "Reply exactly MELINNA_SMOKE_OK. Do not read, write, or execute anything." Use collect_results or wait_tasks as needed. Then respond with the worker marker. Do not use other tools.',
          },
          workers: [
            {
              ...DEFAULT_TEAM.workers[0],
              id: 'researcher',
              name: 'Smoke worker',
              provider: worker,
              model: worker === 'claude' ? 'haiku' : '',
              access: 'read-only',
              instructions: 'Reply exactly MELINNA_SMOKE_OK. Do not use tools, edit files or run commands.',
            },
          ],
          limits: { parallel: 1, jobs: 1, timeoutMinutes: 1, maxTurns: 3, maxTokens: 100000 },
        });
        const id = await service.start({
          teamId: team.id,
          groupId: 'workspace',
          prompt:
            'Delegate the single smoke task and return its marker. Do not inspect or modify the repository.',
        });
        const deadline = Date.now() + 140000;
        while (Date.now() < deadline) {
          const run = service.snapshot().runs.find((item) => item.id === id);
          if (!run || !['running', 'paused'].includes(run.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const run = service.snapshot().runs[0];
        console.log(
          JSON.stringify({
            direction: coordinator + '->' + worker,
            status: run?.status,
            error: run?.error,
            jobs: run?.jobs.map((j) => ({ status: j.status, error: j.error })),
            usage: run?.usage,
            messages: run?.messages.map((m) => m.text),
            events: run?.coordinatorEvents,
          }),
        );
        expect(run?.status, run?.error).toBe('succeeded');
        expect(run?.jobs).toHaveLength(1);
        expect(run?.jobs[0]?.status, run?.jobs[0]?.error).toBe('succeeded');
        expect(run?.jobs[0]?.result).toContain('MELINNA_SMOKE_OK');
        expect(run?.messages.at(-1)?.text).toContain('MELINNA_SMOKE_OK');
      } finally {
        await service.shutdown();
        removeDirRecursive(root);
        repo.cleanup();
      }
    },
    180000,
  );
});
