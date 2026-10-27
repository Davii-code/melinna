import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OrchestrationStore } from '../core/orchestration/ports';
import type { OrchestrationSnapshot } from '../core/orchestration/types';
import { object, parseTeam } from '../core/orchestration/validation';
import { MelinnaError } from '../core/errors';

export class JsonOrchestrationStore implements OrchestrationStore {
  constructor(private readonly file: string) {}
  async load(): Promise<OrchestrationSnapshot> {
    let contents: string;
    try {
      contents = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, templates: [], runs: [] };
      throw err;
    }
    try {
      const state = object(JSON.parse(contents));
      if (state.schemaVersion !== 1 || !Array.isArray(state.templates) || !Array.isArray(state.runs))
        throw new Error('schema');
      const templates = state.templates.map(parseTeam);
      // Recovery is intentionally conservative: malformed history is never silently overwritten.
      for (const raw of state.runs) {
        const run = object(raw);
        parseTeam(run.team);
        if (
          typeof run.id !== 'string' ||
          typeof run.cwd !== 'string' ||
          typeof run.groupId !== 'string' ||
          !Array.isArray(run.jobs) ||
          !Array.isArray(run.messages) ||
          !Array.isArray(run.coordinatorEvents) ||
          typeof run.coordinatorTurn !== 'number' ||
          !run.usage
        )
          throw new Error('run');
        for (const rawJob of run.jobs) {
          const job = object(rawJob);
          if (
            typeof job.id !== 'string' ||
            typeof job.roleId !== 'string' ||
            typeof job.cwd !== 'string' ||
            !Array.isArray(job.events)
          )
            throw new Error('job');
        }
      }
      return { schemaVersion: 1, templates, runs: state.runs as OrchestrationSnapshot['runs'] };
    } catch (cause) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: 'O histórico de equipes está inválido. O arquivo original foi preservado: ' + this.file,
        cause,
      });
    }
  }
  async save(state: OrchestrationSnapshot): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, this.file);
  }
}
