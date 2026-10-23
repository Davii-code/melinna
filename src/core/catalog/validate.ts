import {
  AGENT_ID_RE,
  CATALOG_SCHEMA_VERSION,
  PLACEHOLDERS,
  type AgentDefinition,
  type CatalogIssue,
  type CatalogSource,
  type ExtraDirsSpec,
  type ImagesSpec,
  type PermissionOption,
  type SwitchStrategy,
} from './schema';

class Invalid extends Error {}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function need(cond: unknown, reason: string): asserts cond {
  if (!cond) throw new Invalid(reason);
}

function str(v: unknown, field: string, min = 1, max = 200): string {
  need(
    typeof v === 'string' && v.length >= min && v.length <= max,
    `${field} deve ser texto de ${min} a ${max} caracteres`,
  );
  return v;
}

function strArray(v: unknown, field: string, allowed: readonly string[] = []): string[] {
  need(Array.isArray(v) && v.every((x) => typeof x === 'string'), `${field} deve ser lista de textos`);
  for (const el of v as string[]) {
    const hasPlaceholder = /\{[a-z]+\}/.test(el);
    if (!hasPlaceholder) continue;
    need(
      (PLACEHOLDERS as readonly string[]).includes(el),
      `${field}: placeholder deve ocupar o argumento inteiro (${el})`,
    );
    need(allowed.includes(el), `${field}: placeholder ${el} não é permitido aqui`);
  }
  return v as string[];
}

function switchStrategy(v: unknown, field: string, placeholder: '{model}' | '{permission}'): SwitchStrategy {
  need(isObj(v), `${field} é obrigatório`);
  if (v.strategy === 'pty-command') {
    const template = str(v.template, `${field}.template`, 1, 500);
    need(template.includes(placeholder), `${field}.template deve conter ${placeholder}`);
    return { strategy: 'pty-command', template };
  }
  if (v.strategy === 'restart-resume') return { strategy: 'restart-resume' };
  if (v.strategy === 'unsupported') return { strategy: 'unsupported' };
  throw new Invalid(`${field}.strategy inválida`);
}

function occurrences(args: readonly string[], placeholder: string): number {
  return args.filter((a) => a === placeholder).length;
}

function extraDirsSpec(v: unknown): ExtraDirsSpec {
  need(isObj(v), 'extraDirs inválido');
  if (v.style === 'repeat') {
    const args = strArray(v.args, 'extraDirs.args', ['{dir}']);
    need(occurrences(args, '{dir}') === 1, 'extraDirs.args deve conter {dir} exatamente uma vez');
    return { style: 'repeat', args };
  }
  if (v.style === 'join') {
    const args = strArray(v.args, 'extraDirs.args', ['{dirs}']);
    need(occurrences(args, '{dirs}') === 1, 'extraDirs.args deve conter {dirs} exatamente uma vez');
    const separator = str(v.separator, 'extraDirs.separator', 1, 5);
    return { style: 'join', separator, args };
  }
  throw new Invalid('extraDirs.style inválido');
}

function imagesSpec(v: unknown): ImagesSpec {
  need(isObj(v), 'images inválido');
  const template = str(v.template, 'images.template', 1, 200);
  need(template.split('{path}').length === 2, 'images.template deve conter {path} exatamente uma vez');
  need(v.quote === 'always' || v.quote === 'when-needed', 'images.quote deve ser always ou when-needed');
  return { template, quote: v.quote };
}

function uniqueIds(ids: string[], field: string): void {
  need(new Set(ids).size === ids.length, `${field}: ids repetidos`);
}

function validateAgent(raw: unknown): AgentDefinition {
  need(isObj(raw), 'entrada não é objeto');
  const id = raw.id;
  need(typeof id === 'string' && AGENT_ID_RE.test(id), 'id inválido');
  const displayName = str(raw.displayName, 'displayName', 1, 40);
  need(raw.kind === 'agent' || raw.kind === 'shell', 'kind deve ser agent ou shell');
  const kind = raw.kind;
  const def: AgentDefinition = {
    id,
    displayName,
    kind,
    executable: { command: '' },
    args: [],
    prompt: { delivery: 'none' },
    detect: { strategy: 'path' },
  };

  if (raw.platforms !== undefined) {
    need(
      Array.isArray(raw.platforms) &&
        raw.platforms.length > 0 &&
        raw.platforms.every((p) => p === 'win32' || p === 'darwin' || p === 'linux'),
      'platforms inválido',
    );
    def.platforms = raw.platforms as AgentDefinition['platforms'] & object;
  }
  if (raw.verifiedWith !== undefined) def.verifiedWith = str(raw.verifiedWith, 'verifiedWith', 1, 100);

  need(isObj(raw.executable), 'executable é obrigatório');
  def.executable.command = str(raw.executable.command, 'executable.command', 1, 1024);
  if (raw.executable.windows !== undefined) {
    const w = raw.executable.windows;
    need(isObj(w), 'executable.windows inválido');
    const windows: NonNullable<AgentDefinition['executable']['windows']> = {};
    if (w.command !== undefined) windows.command = str(w.command, 'executable.windows.command', 1, 1024);
    if (w.npmShim !== undefined) {
      need(isObj(w.npmShim), 'npmShim inválido');
      windows.npmShim = {
        package: str(w.npmShim.package, 'npmShim.package'),
        bin: str(w.npmShim.bin, 'npmShim.bin'),
      };
    }
    def.executable.windows = windows;
  }

  def.args = strArray(raw.args, 'args');

  need(isObj(raw.prompt), 'prompt é obrigatório');
  if (raw.prompt.delivery === 'argument') {
    const args = strArray(raw.prompt.args, 'prompt.args', ['{prompt}']);
    need(args.includes('{prompt}'), 'prompt.args deve conter {prompt}');
    def.prompt = { delivery: 'argument', args };
  } else if (raw.prompt.delivery === 'pty' || raw.prompt.delivery === 'none') {
    def.prompt = { delivery: raw.prompt.delivery };
  } else {
    throw new Invalid('prompt.delivery inválido');
  }

  if (raw.model !== undefined) {
    const m = raw.model;
    need(isObj(m), 'model inválido');
    need(Array.isArray(m.options) && m.options.length > 0, 'model.options deve ter ao menos uma opção');
    const options = (m.options as unknown[]).map((o, i) => {
      need(isObj(o), `model.options[${i}] inválido`);
      return {
        id: str(o.id, `model.options[${i}].id`, 1, 100),
        label: str(o.label, `model.options[${i}].label`, 1, 60),
      };
    });
    uniqueIds(
      options.map((o) => o.id),
      'model.options',
    );
    const dflt = str(m.default, 'model.default', 1, 100);
    need(
      options.some((o) => o.id === dflt),
      'model.default fora da lista',
    );
    need(typeof m.allowCustom === 'boolean', 'model.allowCustom deve ser booleano');
    const args = strArray(m.args, 'model.args', ['{model}']);
    def.model = {
      options,
      default: dflt,
      allowCustom: m.allowCustom,
      args,
      switch: switchStrategy(m.switch, 'model.switch', '{model}'),
    };
  }

  if (raw.permission !== undefined) {
    const p = raw.permission;
    need(isObj(p), 'permission inválido');
    need(Array.isArray(p.options) && p.options.length > 0, 'permission.options deve ter ao menos uma opção');
    const options = (p.options as unknown[]).map((o, i) => {
      need(isObj(o), `permission.options[${i}] inválido`);
      const opt: PermissionOption = {
        id: str(o.id, `permission.options[${i}].id`, 1, 100),
        label: str(o.label, `permission.options[${i}].label`, 1, 60),
        args: strArray(o.args, `permission.options[${i}].args`, ['{permission}']),
      };
      if (o.dangerous !== undefined) {
        need(typeof o.dangerous === 'boolean', `permission.options[${i}].dangerous deve ser booleano`);
        opt.dangerous = o.dangerous;
      }
      return opt;
    });
    uniqueIds(
      options.map((o) => o.id),
      'permission.options',
    );
    const dflt = str(p.default, 'permission.default', 1, 100);
    need(
      options.some((o) => o.id === dflt),
      'permission.default fora da lista',
    );
    def.permission = {
      options,
      default: dflt,
      switch: switchStrategy(p.switch, 'permission.switch', '{permission}'),
    };
  }

  if (raw.resume !== undefined) {
    need(isObj(raw.resume), 'resume inválido');
    def.resume = { args: strArray(raw.resume.args, 'resume.args') };
  }

  if (raw.extraDirs !== undefined) def.extraDirs = extraDirsSpec(raw.extraDirs);
  if (raw.images !== undefined) def.images = imagesSpec(raw.images);

  if (kind === 'shell') {
    need(def.model === undefined, 'shell não pode ter model');
    need(def.permission === undefined, 'shell não pode ter permission');
    need(def.prompt.delivery === 'none', 'shell deve ter prompt.delivery none');
  }

  const usesResume =
    def.model?.switch.strategy === 'restart-resume' || def.permission?.switch.strategy === 'restart-resume';
  need(!usesResume || def.resume, 'restart-resume exige resume');

  need(isObj(raw.detect) && raw.detect.strategy === 'path', 'detect.strategy deve ser path');
  return def;
}

export interface ValidateResult {
  agents: AgentDefinition[];
  invalid: CatalogIssue[];
}

/** Valida um arquivo de catálogo. Entradas inválidas são relatadas sem derrubar as válidas. */
export function validateCatalog(raw: unknown, source: CatalogSource): ValidateResult {
  if (!isObj(raw)) return { agents: [], invalid: [{ source, reason: 'arquivo não é um objeto JSON' }] };
  if (raw.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    return {
      agents: [],
      invalid: [{ source, reason: `schemaVersion não suportada (${String(raw.schemaVersion)})` }],
    };
  }
  if (!Array.isArray(raw.agents))
    return { agents: [], invalid: [{ source, reason: 'agents deve ser uma lista' }] };
  const agents: AgentDefinition[] = [];
  const invalid: CatalogIssue[] = [];
  const seen = new Set<string>();
  for (const entry of raw.agents) {
    const id = isObj(entry) && typeof entry.id === 'string' ? entry.id : undefined;
    try {
      const def = validateAgent(entry);
      if (seen.has(def.id)) throw new Invalid('id repetido no arquivo');
      seen.add(def.id);
      agents.push(def);
    } catch (err) {
      if (!(err instanceof Invalid)) throw err;
      const issue: CatalogIssue = { source, reason: err.message };
      if (id !== undefined) issue.id = id;
      invalid.push(issue);
    }
  }
  return { agents, invalid };
}
