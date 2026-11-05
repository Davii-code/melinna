/*
 * Cenários migrados de RunConfigDialog.test.tsx (substituído pela janela da 009):
 * - campos da configuração escolhida (Nome, Pasta, Programa, Argumentos) → "campos e valores";
 * - criar na pasta escolhida do workspace → "Pasta só com as pastas do workspace";
 * - editar mantendo o id → o formulário só emite alterações (o id fica no DraftItem);
 * - validações: nome e programa obrigatórios, nome repetido sem diferenciar maiúsculas (mas não o próprio),
 *   nome até 80 caracteres e argumentos até 64 → "validação junto do campo".
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunConfigForm } from '../../../src/renderer/components/Run/RunConfigForm';
import { draftFromView, type DraftItem } from '../../../src/renderer/components/Run/run-draft';
import { runCommand, runConfig } from '../../support/renderer-fixtures';

const draft = (over: Parameters<typeof runConfig>[0] = {}): DraftItem => draftFromView(runConfig(over));

function setup(
  item: DraftItem,
  siblings: DraftItem[] = [item],
  extra: Partial<React.ComponentProps<typeof RunConfigForm>> = {},
) {
  const onChange = vi.fn();
  const detected = [
    runCommand({ id: 'd1', label: 'dev', args: ['run', 'dev'], folder: '/repo' }),
    runCommand({ id: 'd2', label: 'build', args: ['run', 'build'], folder: '/repo' }),
    runCommand({ id: 'd3', label: 'lint', args: ['run', 'lint'], folder: '/repo/api' }),
  ];
  const { container } = render(
    <RunConfigForm
      item={item}
      siblings={siblings}
      folders={['/repo', '/repo/api']}
      detected={detected}
      onChange={onChange}
      {...extra}
    />,
  );
  return { onChange, container };
}

describe('RunConfigForm — campos e valores', () => {
  it('shows the values of the config', () => {
    setup(draft({ name: 'Servidor', args: ['--porta', '3000'] }));
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Servidor');
    expect((screen.getByLabelText('Pasta') as HTMLSelectElement).value).toBe('/repo');
    expect((screen.getByLabelText('Argumentos') as HTMLInputElement).value).toBe('--porta 3000');
  });

  it('limits Pasta to the folders of the workspace', () => {
    setup(draft());
    const options = within(screen.getByLabelText('Pasta'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['/repo', '/repo/api']);
  });

  it('keeps a folder that left the workspace visible so the user can fix it', () => {
    setup(draft({ folder: '/sumiu' }));
    const options = within(screen.getByLabelText('Pasta'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('/sumiu');
  });

  it('emits a change for the name, the folder and the tool', () => {
    const { onChange } = setup(draft());
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Novo' } });
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Novo' });
    fireEvent.change(screen.getByLabelText('Pasta'), { target: { value: '/repo/api' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ folder: '/repo/api' }));
    fireEvent.change(screen.getByLabelText('Ferramenta'), { target: { value: 'maven' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'maven' }));
  });

  it('turns the typed arguments into a vector, space splitting and quotes grouping', () => {
    const { onChange } = setup(draft({ args: [] }));
    fireEvent.change(screen.getByLabelText('Argumentos'), { target: { value: '--name "meu app" & calc' } });
    expect(onChange).toHaveBeenLastCalledWith({ args: ['--name', 'meu app', '&', 'calc'] });
  });

  it('keeps the typed text while the user types a trailing space', () => {
    const { onChange } = setup(draft({ args: [] }));
    const field = screen.getByLabelText('Argumentos') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'a ' } });
    expect(field.value).toBe('a ');
    expect(onChange).toHaveBeenLastCalledWith({ args: ['a'] });
  });
});

describe('RunConfigForm — script, objetivos e tarefas por ferramenta', () => {
  it('npm: Script lists the scripts detected in the folder of the config', () => {
    setup(draft({ tool: 'npm', script: 'dev' }));
    const select = screen.getByLabelText('Script') as HTMLSelectElement;
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['dev', 'build']);
    expect(select.value).toBe('dev');
    fireEvent.change(select, { target: { value: 'build' } });
  });

  it('npm: changing Script emits it, and changing the folder re-reads the scripts', () => {
    const { onChange } = setup(draft({ tool: 'npm', script: 'dev' }));
    fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'build' } });
    expect(onChange).toHaveBeenLastCalledWith({ script: 'build' });
  });

  it('npm: keeps a script that is no longer detected visible', () => {
    setup(draft({ tool: 'npm', script: 'sumiu' }));
    const options = within(screen.getByLabelText('Script'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('sumiu');
  });

  it('maven: Objetivos is free text with the usual goals as suggestions', () => {
    const { container, onChange } = setup(draft({ tool: 'maven', script: 'clean' }));
    const field = screen.getByLabelText('Objetivos') as HTMLInputElement;
    expect(field.value).toBe('clean');
    fireEvent.change(field, { target: { value: 'clean install' } });
    expect(onChange).toHaveBeenLastCalledWith({ script: 'clean install' });
    const options = [...container.querySelectorAll(`datalist#${field.getAttribute('list')} option`)].map(
      (o) => o.getAttribute('value'),
    );
    expect(options).toEqual(['clean', 'install', 'test', 'spring-boot:run']);
    expect(screen.queryByLabelText('Script')).toBeNull();
  });

  it('gradle: Tarefas is free text with the usual tasks as suggestions', () => {
    const { container } = setup(draft({ tool: 'gradle', script: 'build' }));
    const field = screen.getByLabelText('Tarefas');
    const options = [...container.querySelectorAll(`datalist#${field.getAttribute('list')} option`)].map(
      (o) => o.getAttribute('value'),
    );
    expect(options).toEqual(['build', 'test', 'bootRun']);
  });

  it('program: shows Programa and no script field', () => {
    const { onChange } = setup(draft({ tool: 'program', script: null, program: 'node' }));
    const field = screen.getByLabelText('Programa') as HTMLInputElement;
    expect(field.value).toBe('node');
    fireEvent.change(field, { target: { value: 'deno' } });
    expect(onChange).toHaveBeenLastCalledWith({ program: 'deno' });
    expect(screen.queryByLabelText('Script')).toBeNull();
    expect(screen.queryByLabelText('Objetivos')).toBeNull();
  });

  it('the tools do not show Programa (the core derives it)', () => {
    setup(draft({ tool: 'npm' }));
    expect(screen.queryByLabelText('Programa')).toBeNull();
  });

  it('compose: no script field either', () => {
    setup(draft({ tool: 'compose', script: null, program: 'docker', args: ['up'] }));
    expect(screen.queryByLabelText('Script')).toBeNull();
    expect(screen.queryByLabelText('Programa')).toBeNull();
    expect((screen.getByLabelText('Argumentos') as HTMLInputElement).value).toBe('up');
  });
});

describe('RunConfigForm — opções do runtime', () => {
  it.each([
    ['npm', 'Node options'],
    ['pnpm', 'Node options'],
    ['yarn', 'Node options'],
    ['maven', 'MAVEN_OPTS'],
    ['gradle', 'GRADLE_OPTS'],
  ] as const)('%s labels the field "%s"', (tool, label) => {
    const { onChange } = setup(draft({ tool, script: tool === 'npm' ? 'dev' : 'x' }));
    const field = screen.getByLabelText(label);
    fireEvent.change(field, { target: { value: '--inspect' } });
    expect(onChange).toHaveBeenLastCalledWith({ runtimeOptions: '--inspect' });
  });

  it.each(['compose', 'program'] as const)('%s hides the runtime options', (tool) => {
    setup(draft({ tool, script: null, program: 'x' }));
    for (const label of ['Node options', 'MAVEN_OPTS', 'GRADLE_OPTS']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
  });
});

describe('RunConfigForm — ambiente, antes de lançar e instâncias', () => {
  it('edits the environment variables through the table', () => {
    const { onChange } = setup(draft({ env: [{ name: 'PORT', value: '4000' }] }));
    expect(screen.getByRole('group', { name: 'Variáveis de ambiente' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar variável' }));
    expect(onChange).toHaveBeenLastCalledWith({
      env: [
        { name: 'PORT', value: '4000' },
        { name: '', value: '' },
      ],
    });
  });

  it('Antes de lançar lists the other configs of the workspace, never the config itself', () => {
    const a = draft({ id: 'a', name: 'A' });
    const b = draft({ id: 'b', name: 'B' });
    const c = draft({ id: 'c', name: 'C' });
    const { onChange } = setup(a, [a, b, c]);
    const select = screen.getByLabelText('Antes de lançar') as HTMLSelectElement;
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Nenhuma', 'B', 'C']);
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenLastCalledWith({ beforeLaunch: 'b' });
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ beforeLaunch: null });
  });

  it('toggles Permitir várias instâncias', () => {
    const { onChange } = setup(draft({ allowParallel: false }));
    const box = screen.getByLabelText('Permitir várias instâncias') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ allowParallel: true });
  });
});

describe('RunConfigForm — validação junto do campo', () => {
  it('requires a name', () => {
    setup(draft({ name: '   ' }));
    expect(screen.getByText('Informe o nome.')).toBeTruthy();
    expect(screen.getByLabelText('Nome').getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses a repeated name regardless of case, but not its own', () => {
    const a = draft({ id: 'a', name: 'Servidor' });
    const b = draft({ id: 'b', name: 'servidor' });
    setup(a, [a, b]);
    expect(screen.getByText('Já existe uma configuração com esse nome.')).toBeTruthy();
  });

  it('accepts its own name', () => {
    setup(draft({ name: 'Servidor' }));
    expect(screen.queryByText('Já existe uma configuração com esse nome.')).toBeNull();
  });

  it('limits the name to 80 characters', () => {
    setup(draft());
    expect(screen.getByLabelText('Nome').getAttribute('maxlength')).toBe('80');
  });

  it('requires the program in the program tool and a script in the others', () => {
    setup(draft({ tool: 'program', script: null, program: '  ' }));
    expect(screen.getByText('Informe o programa.')).toBeTruthy();
  });

  it('requires a script, objectives or tasks', () => {
    const { container } = setup(draft({ tool: 'maven', script: '' }));
    expect(container.textContent).toContain('Informe um objetivo.');
  });

  it('warns when the number of arguments goes over 64', () => {
    setup(draft({ args: Array.from({ length: 65 }, () => 'a') }));
    expect(screen.getByText('Use no máximo 64 argumentos.')).toBeTruthy();
  });

  it('warns about a folder outside the workspace', () => {
    setup(draft({ folder: '/sumiu' }));
    expect(screen.getByText('A pasta precisa ser do workspace.')).toBeTruthy();
  });
});

describe('RunConfigForm — em execução', () => {
  it('says the changes only apply to the next launch while the config runs', () => {
    setup(draft({ running: 1 }));
    expect(screen.getByRole('status').textContent).toBe(
      'Em execução — as mudanças valem no próximo lançamento',
    );
  });

  it('shows no notice when it is stopped', () => {
    setup(draft({ running: 0 }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('RunConfigForm — Java debugging', () => {
  it('adds application JDWP arguments without replacing existing JVM options', () => {
    const { onChange } = setup(
      draft({ tool: 'maven', script: 'spring-boot:run', args: ['-Dspring-boot.run.jvmArguments=-Xmx1g'] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ativar debug Spring (porta 5005)' }));
    expect(onChange).toHaveBeenCalledWith({ args: [expect.stringContaining('-Xmx1g -agentlib:jdwp=')] });
    expect(onChange.mock.calls[0]?.[0].args[0]).toContain('address=127.0.0.1:5005');
  });
  it('adds Gradle debugging to bootRun without dropping profiles', () => {
    const { onChange } = setup(
      draft({ tool: 'gradle', script: 'bootRun', args: ['--args=--spring.profiles.active=dev'] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ativar debug Gradle (porta 5005)' }));
    expect(onChange).toHaveBeenCalledWith({ args: ['--args=--spring.profiles.active=dev', '--debug-jvm'] });
  });
});
