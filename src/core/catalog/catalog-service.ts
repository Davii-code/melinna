import { MelinnaError } from '../errors';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { Platform } from '../ports/platform';
import { detect, resolveLauncher, type DetectResult } from './detect';
import { buildLaunchArgs, type LaunchSelection } from './launch-plan';
import { loadCatalog } from './load';
import type { AgentDefinition, CatalogLoadResult } from './schema';

export interface LaunchInput extends LaunchSelection {
  agentId: string;
}

export interface LaunchPlan {
  agent: AgentDefinition;
  file: string;
  args: string[];
  promptViaPty?: string;
  model: string | null;
  permission: string | null;
  extraDirsApplied: boolean;
  extraDirsOmitted: number;
}

export interface CatalogServiceDeps {
  fs: FileSystem;
  platform: Platform;
  log: Logger;
  builtinPath: string;
  userPath: string;
}

export class CatalogService {
  private cached: CatalogLoadResult | undefined;

  constructor(private readonly deps: CatalogServiceDeps) {}

  async load(): Promise<CatalogLoadResult> {
    this.cached = await loadCatalog({
      fs: this.deps.fs,
      builtinPath: this.deps.builtinPath,
      userPath: this.deps.userPath,
      os: this.deps.platform.os,
      log: this.deps.log,
    });
    return this.cached;
  }

  async agent(agentId: string): Promise<AgentDefinition> {
    const catalog = this.cached ?? (await this.load());
    const def = catalog.agents.find((a) => a.id === agentId);
    if (!def) throw new MelinnaError('AGENT_NOT_FOUND', { details: { agentId } });
    return def;
  }

  async detect(agentId: string): Promise<DetectResult> {
    return detect(await this.agent(agentId), this.deps.platform, this.deps.fs);
  }

  async detectAll(): Promise<Record<string, DetectResult>> {
    const catalog = await this.load();
    const entries = await Promise.all(
      catalog.agents.map(async (a) => [a.id, await detect(a, this.deps.platform, this.deps.fs)] as const),
    );
    return Object.fromEntries(entries);
  }

  async buildLaunch(input: LaunchInput): Promise<LaunchPlan> {
    const def = await this.agent(input.agentId);
    const launcher = await resolveLauncher(def, this.deps.platform, this.deps.fs);
    const plan = buildLaunchArgs(def, input, {
      os: this.deps.platform.os,
      file: launcher.file,
      prefixArgs: launcher.prefixArgs,
    });
    const out: LaunchPlan = {
      agent: def,
      file: launcher.file,
      args: plan.args,
      model: plan.model,
      permission: plan.permission,
      extraDirsApplied: plan.extraDirsApplied,
      extraDirsOmitted: plan.extraDirsOmitted,
    };
    if (plan.promptViaPty !== undefined) out.promptViaPty = plan.promptViaPty;
    return out;
  }
}
