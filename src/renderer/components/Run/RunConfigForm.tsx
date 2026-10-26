import { useEffect, useState } from 'react';
import { LIMITS, type RunCommand, type RunConfigTool } from '../../../shared/ipc-contract';
import { joinArgs, tokenizeArgs } from '../../../shared/tokenize-args';
import { EnvTable } from './EnvTable';
import type { DraftItem } from './run-draft';

export interface RunConfigFormProps {
  item: DraftItem;
  /** Todas as configurações em edição do workspace (nomes usados e etapas possíveis de "Antes de lançar"). */
  siblings: readonly DraftItem[];
  /** Pastas do workspace. */
  folders: readonly string[];
  /** Scripts detectados do workspace; os de `package.json` alimentam o campo Script. */
  detected: readonly RunCommand[];
  onChange: (patch: Partial<DraftItem>) => void;
}

const TOOL_OPTIONS: readonly { id: RunConfigTool; label: string }[] = [
  { id: 'npm', label: 'npm' },
  { id: 'pnpm', label: 'pnpm' },
  { id: 'yarn', label: 'yarn' },
  { id: 'maven', label: 'Maven' },
  { id: 'gradle', label: 'Gradle' },
  { id: 'compose', label: 'Compose' },
  { id: 'program', label: 'Programa' },
];

let goalsCounter = 0;

const MAVEN_GOALS = ['clean', 'install', 'test', 'spring-boot:run'];
const GRADLE_TASKS = ['build', 'test', 'bootRun'];

const RUNTIME_LABEL: Partial<Record<RunConfigTool, string>> = {
  npm: 'Node options',
  pnpm: 'Node options',
  yarn: 'Node options',
  maven: 'MAVEN_OPTS',
  gradle: 'GRADLE_OPTS',
};

const isNpmFamily = (tool: RunConfigTool) => tool === 'npm' || tool === 'pnpm' || tool === 'yarn';

function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
}

/** Campo de texto dos argumentos: guarda o texto digitado (espaço no fim, aspas abertas) e emite o vetor. */
function ArgsField({ args, onChange }: { args: string[]; onChange: (args: string[]) => void }) {
  const [text, setText] = useState(() => joinArgs(args));
  useEffect(() => {
    if (JSON.stringify(tokenizeArgs(text)) !== JSON.stringify(args)) setText(joinArgs(args));
    // `text` fica de fora de propósito: só uma mudança externa dos argumentos reescreve o texto digitado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args]);
  return (
    <input
      type="text"
      aria-label="Argumentos"
      value={text}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onChange(tokenizeArgs(e.target.value));
      }}
    />
  );
}

/** Mensagem de cada campo que não vale (junto do campo), ou `null` quando está bem. */
export function problemsOf(
  item: DraftItem,
  siblings: readonly DraftItem[],
  folders: readonly string[],
): Partial<Record<'name' | 'folder' | 'script' | 'program' | 'args', string>> {
  const problems: Partial<Record<'name' | 'folder' | 'script' | 'program' | 'args', string>> = {};
  const name = item.name.trim();
  if (name === '') problems.name = 'Informe o nome.';
  else if (siblings.some((s) => s.key !== item.key && s.name.trim().toLowerCase() === name.toLowerCase())) {
    problems.name = 'Já existe uma configuração com esse nome.';
  }
  if (item.folder === '' || !folders.some((f) => samePath(f, item.folder))) {
    problems.folder = 'A pasta precisa ser do workspace.';
  }
  if (isNpmFamily(item.tool) && (item.script ?? '').trim() === '') problems.script = 'Escolha um script.';
  if (item.tool === 'maven' && (item.script ?? '').trim() === '') problems.script = 'Informe um objetivo.';
  if (item.tool === 'gradle' && (item.script ?? '').trim() === '') problems.script = 'Informe uma tarefa.';
  if (item.tool === 'program' && item.program.trim() === '') problems.program = 'Informe o programa.';
  if (item.args.length > LIMITS.commandArgs)
    problems.args = `Use no máximo ${LIMITS.commandArgs} argumentos.`;
  return problems;
}

/** Campos da configuração escolhida: edita só o rascunho; quem grava é a janela (Aplicar/OK). */
export function RunConfigForm({ item, siblings, folders, detected, onChange }: RunConfigFormProps) {
  const [goalsId] = useState(() => `run-goals-${++goalsCounter}`);
  const problems = problemsOf(item, siblings, folders);
  const scripts = detected
    .filter((c) => c.source === 'npm' && samePath(c.folder, item.folder))
    .map((c) => c.label);
  const scriptOptions = item.script && !scripts.includes(item.script) ? [...scripts, item.script] : scripts;
  const folderOptions =
    folders.some((f) => samePath(f, item.folder)) || item.folder === ''
      ? [...folders]
      : [...folders, item.folder];
  const others = siblings.filter((s) => s.key !== item.key);
  const runtimeLabel = RUNTIME_LABEL[item.tool];
  const invalid = (key: keyof typeof problems) => problems[key] !== undefined;
  const error = (key: keyof typeof problems) =>
    problems[key] !== undefined ? (
      <p className="field-error" role="alert">
        {problems[key]}
      </p>
    ) : null;

  return (
    <form className="run-config-form-fields" onSubmit={(e) => e.preventDefault()}>
      {item.running > 0 && (
        <p className="hint" role="status">
          Em execução — as mudanças valem no próximo lançamento
        </p>
      )}
      <label>
        Nome
        <input
          type="text"
          value={item.name}
          maxLength={LIMITS.commandLabel}
          aria-invalid={invalid('name')}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      {error('name')}
      <label>
        Ferramenta
        <select
          value={item.tool}
          onChange={(e) => {
            const tool = e.target.value as RunConfigTool;
            onChange({
              tool,
              script: tool === 'compose' || tool === 'program' ? null : (item.script ?? ''),
              runtimeOptions: RUNTIME_LABEL[tool] === undefined ? '' : item.runtimeOptions,
            });
          }}
        >
          {TOOL_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Pasta
        <select
          value={item.folder}
          aria-invalid={invalid('folder')}
          onChange={(e) => onChange({ folder: e.target.value })}
        >
          {folderOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      {error('folder')}
      {isNpmFamily(item.tool) && (
        <>
          <label>
            Script
            <select
              value={item.script ?? ''}
              aria-invalid={invalid('script')}
              onChange={(e) => onChange({ script: e.target.value })}
            >
              {item.script === null || item.script === '' ? <option value="">—</option> : null}
              {scriptOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {error('script')}
        </>
      )}
      {(item.tool === 'maven' || item.tool === 'gradle') && (
        <>
          <label>
            {item.tool === 'maven' ? 'Objetivos' : 'Tarefas'}
            <input
              type="text"
              list={goalsId}
              value={item.script ?? ''}
              spellCheck={false}
              aria-invalid={invalid('script')}
              onChange={(e) => onChange({ script: e.target.value })}
            />
          </label>
          <datalist id={goalsId}>
            {(item.tool === 'maven' ? MAVEN_GOALS : GRADLE_TASKS).map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          {error('script')}
        </>
      )}
      {item.tool === 'program' && (
        <>
          <label>
            Programa
            <input
              type="text"
              value={item.program}
              spellCheck={false}
              aria-invalid={invalid('program')}
              onChange={(e) => onChange({ program: e.target.value })}
            />
          </label>
          {error('program')}
        </>
      )}
      <label>
        Argumentos
        <ArgsField key={item.key} args={item.args} onChange={(args) => onChange({ args })} />
      </label>
      {error('args')}
      {runtimeLabel !== undefined && (
        <label>
          {runtimeLabel}
          <input
            type="text"
            value={item.runtimeOptions}
            maxLength={LIMITS.runtimeOptions}
            spellCheck={false}
            onChange={(e) => onChange({ runtimeOptions: e.target.value })}
          />
        </label>
      )}
      <fieldset className="env-fieldset">
        <legend>Variáveis de ambiente</legend>
        <EnvTable value={item.env} onChange={(env) => onChange({ env })} />
      </fieldset>
      <label>
        Antes de lançar
        <select
          value={item.beforeLaunch ?? ''}
          onChange={(e) => onChange({ beforeLaunch: e.target.value === '' ? null : e.target.value })}
        >
          <option value="">Nenhuma</option>
          {others.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={item.allowParallel}
          onChange={(e) => onChange({ allowParallel: e.target.checked })}
        />
        Permitir várias instâncias
      </label>
    </form>
  );
}
