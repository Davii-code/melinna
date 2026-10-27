import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyWorkflow, type WorkflowData } from '../core/workflow/types';
import type { WorkflowStore } from '../core/workflow/ports';
import { notes, profile, record, workflowError } from '../core/workflow/validation';

export class JsonWorkflowStore implements WorkflowStore {
  constructor(private readonly path: string) {}
  async load(): Promise<WorkflowData> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkflow();
      throw err;
    }
    try {
      const data = record(JSON.parse(raw));
      if (data.version !== 1) workflowError('Versão de dados de revisão não suportada.');
      for (const key of ['profiles', 'tasks', 'checkpoints', 'verifications', 'handoffs', 'notices'])
        if (!Array.isArray(data[key])) workflowError('Dados de revisão inválidos.');
      for (const item of data.profiles as unknown[]) profile(item);
      for (const item of data.tasks as unknown[]) {
        const task = record(item);
        if (typeof task.taskId !== 'string' || typeof task.checkpointBeforeLaunch !== 'boolean')
          workflowError('Tarefa inválida.');
        notes(task.notes);
      }
      for (const rawCheckpoint of data.checkpoints as unknown[]) {
        const checkpoint = record(rawCheckpoint),
          manifest = record(checkpoint.manifest);
        if (
          typeof checkpoint.id !== 'string' ||
          typeof checkpoint.executionId !== 'string' ||
          typeof checkpoint.taskId !== 'string' ||
          !Array.isArray(manifest.folders) ||
          typeof manifest.fingerprint !== 'string'
        )
          workflowError('Checkpoint inválido.');
        for (const rawFolder of manifest.folders) {
          const folder = record(rawFolder);
          if (typeof folder.root !== 'string' || !Array.isArray(folder.files))
            workflowError('Pasta do checkpoint inválida.');
          for (const rawFile of folder.files) {
            const file = record(rawFile);
            if (
              typeof file.path !== 'string' ||
              typeof file.hash !== 'string' ||
              !/^[a-f0-9]{64}$/.test(file.hash) ||
              typeof file.bytes !== 'number' ||
              typeof file.mode !== 'number'
            )
              workflowError('Arquivo do checkpoint inválido.');
          }
        }
      }
      const preferences = record(data.preferences);
      if (
        ['checkpointBeforeLaunch', 'desktopNotifications', 'quietNotifications'].some(
          (k) => typeof preferences[k] !== 'boolean',
        )
      )
        workflowError('Preferências inválidas.');
      return data as unknown as WorkflowData;
    } catch {
      workflowError('Não foi possível ler ' + this.path + '. O arquivo original foi preservado.');
    }
  }
  async save(data: WorkflowData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = this.path + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temp, this.path);
  }
}
