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

/** Programa e argumentos para rodar um agente sem terminal. */
export interface HeadlessLaunch {
  agent: AgentDefinition;
  file: string;
  args: string[];
}

/** Programa e argumentos para conversar com um agente sem terminal. */
export interface ChatLaunch {
  agent: AgentDefinition;
  file: string;
  /** Argumentos de toda mensagem, já com os do modo de permissão escolhido. */
  args: string[];
  /** Acrescentados, com o identificador da sessão, a partir da segunda mensagem. */
  resumeArgs: string[];
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

  /**
   * Primeiro agente do catálogo, na ordem do arquivo, que declara `headless` e está instalado; `null` se
   * nenhum. Lançador inseguro conta como não instalado.
   */
  async headlessLaunch(): Promise<HeadlessLaunch | null> {
    const catalog = this.cached ?? (await this.load());
    for (const agent of catalog.agents) {
      if (!agent.headless) continue;
      try {
        const launcher = await resolveLauncher(agent, this.deps.platform, this.deps.fs);
        return { agent, file: launcher.file, args: [...launcher.prefixArgs, ...agent.headless.args] };
      } catch (err) {
        if (!(err instanceof MelinnaError)) throw err;
      }
    }
    return null;
  }

  /**
   * Primeiro agente instalado que declara `chat`, com os argumentos do modo de permissão pedido (ou
   * do padrão do agente); `null` se nenhum. Modo desconhecido ou que desliga as confirmações é recusado:
   * no chat não há como confirmar ação por ação.
   */
  async chatLaunch(permission?: string): Promise<ChatLaunch | null> {
    const catalog = this.cached ?? (await this.load());
    for (const agent of catalog.agents) {
      if (!agent.chat) continue;
      let launcher;
      try {
        launcher = await resolveLauncher(agent, this.deps.platform, this.deps.fs);
      } catch (err) {
        if (!(err instanceof MelinnaError)) throw err;
        continue;
      }
      const wanted = permission ?? agent.permission?.default;
      const option = agent.permission?.options.find((o) => o.id === wanted);
      if (permission !== undefined && !option) {
        throw new MelinnaError('INPUT_INVALID', { userMessage: 'Modo de permissão desconhecido.' });
      }
      if (option?.dangerous) {
        throw new MelinnaError('INPUT_INVALID', {
          userMessage: 'O chat não aceita modos que desligam as confirmações do agente.',
        });
      }
      return {
        agent,
        file: launcher.file,
        args: [...launcher.prefixArgs, ...agent.chat.args, ...(option?.args ?? [])],
        resumeArgs: agent.chat.resumeArgs,
      };
    }
    return null;
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
