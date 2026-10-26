import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnvTable } from '../../../src/renderer/components/Run/EnvTable';

function setup(value: { name: string; value: string }[]) {
  const onChange = vi.fn();
  render(<EnvTable value={value} onChange={onChange} />);
  return onChange;
}

describe('EnvTable', () => {
  it('shows one row per variable with name and value fields', () => {
    setup([
      { name: 'PORT', value: '4000' },
      { name: 'NODE_ENV', value: 'dev' },
    ]);
    expect((screen.getByLabelText('Nome da variável 1') as HTMLInputElement).value).toBe('PORT');
    expect((screen.getByLabelText('Valor de PORT') as HTMLInputElement).value).toBe('4000');
    expect((screen.getByLabelText('Valor de NODE_ENV') as HTMLInputElement).value).toBe('dev');
  });

  it('adds an empty variable', () => {
    const onChange = setup([{ name: 'PORT', value: '1' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar variável' }));
    expect(onChange).toHaveBeenCalledWith([
      { name: 'PORT', value: '1' },
      { name: '', value: '' },
    ]);
  });

  it('removes a variable by its name', () => {
    const onChange = setup([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remover A' }));
    expect(onChange).toHaveBeenCalledWith([{ name: 'B', value: '2' }]);
  });

  it('edits the name and the value', () => {
    const onChange = setup([{ name: 'PORT', value: '1' }]);
    fireEvent.change(screen.getByLabelText('Nome da variável 1'), { target: { value: 'HOST' } });
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'HOST', value: '1' }]);
    fireEvent.change(screen.getByLabelText('Valor de PORT'), { target: { value: '4000' } });
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'PORT', value: '4000' }]);
  });

  it('flags an invalid name next to the row (empty, with =, with space, starting with a digit)', () => {
    for (const name of ['', 'A=B', 'A B', '1A']) {
      const { unmount } = render(<EnvTable value={[{ name, value: 'x' }]} onChange={vi.fn()} />);
      expect(screen.getByLabelText('Nome da variável 1').getAttribute('aria-invalid'), name).toBe('true');
      expect(screen.getByText(/Nome de variável inválido/), name).toBeTruthy();
      unmount();
    }
  });

  it('accepts a valid name', () => {
    setup([{ name: 'MY_VAR_2', value: 'x' }]);
    expect(screen.getByLabelText('Nome da variável 1').getAttribute('aria-invalid')).toBe('false');
  });

  it('flags a repeated name regardless of case', () => {
    setup([
      { name: 'Path', value: '1' },
      { name: 'PATH', value: '2' },
    ]);
    expect(screen.getByLabelText('Nome da variável 2').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Nome repetido.')).toBeTruthy();
    expect(screen.getByLabelText('Nome da variável 1').getAttribute('aria-invalid')).toBe('false');
  });

  it.each(['API_TOKEN', 'db_password', 'PASSWD', 'MY_SECRET', 'SSH_KEY', 'AWS_CREDENTIALS'])(
    'masks the value of %s until the user chooses to show it',
    (name) => {
      setup([{ name, value: 'segredo' }]);
      const field = screen.getByLabelText(`Valor de ${name}`) as HTMLInputElement;
      expect(field.type).toBe('password');
      fireEvent.click(screen.getByRole('button', { name: `Mostrar valor de ${name}` }));
      expect((screen.getByLabelText(`Valor de ${name}`) as HTMLInputElement).type).toBe('text');
      fireEvent.click(screen.getByRole('button', { name: `Ocultar valor de ${name}` }));
      expect((screen.getByLabelText(`Valor de ${name}`) as HTMLInputElement).type).toBe('password');
    },
  );

  it('does not mask or offer Mostrar for a normal name', () => {
    setup([{ name: 'PORT', value: '4000' }]);
    expect((screen.getByLabelText('Valor de PORT') as HTMLInputElement).type).toBe('text');
    expect(screen.queryByRole('button', { name: 'Mostrar valor de PORT' })).toBeNull();
  });

  it('warns that the values are stored in plain text on this machine when one is masked', () => {
    setup([{ name: 'API_TOKEN', value: 'x' }]);
    expect(screen.getByText(/gravados em texto no estado local/)).toBeTruthy();
  });

  it('shows no warning without secret-looking names', () => {
    setup([{ name: 'PORT', value: '1' }]);
    expect(screen.queryByText(/gravados em texto no estado local/)).toBeNull();
  });

  it('limits to 100 variables', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `V${i}`, value: '' }));
    setup(many);
    expect((screen.getByRole('button', { name: 'Adicionar variável' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('limits the value to 8,000 characters', () => {
    setup([{ name: 'A', value: '' }]);
    expect(screen.getByLabelText('Valor de A').getAttribute('maxlength')).toBe('8000');
  });
});
