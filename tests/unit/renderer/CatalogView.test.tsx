import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatalogView } from '../../../src/renderer/components/CatalogView';
import { agentDef, shellDef } from '../../support/renderer-fixtures';

function setup() {
  const onClose = vi.fn();
  const onReload = vi.fn();
  render(
    <CatalogView
      agents={[
        agentDef('claude', { verifiedWith: '2.1.0' }),
        agentDef('codex', { displayName: 'Codex CLI' }),
        shellDef('bash', 'Bash'),
      ]}
      detect={{
        claude: { installed: true, searched: 'claude', resolvedPath: 'C:\\bin\\claude.exe' },
        codex: { installed: false, searched: 'codex', reason: 'não está no PATH' },
      }}
      invalid={[
        { source: 'user', id: 'meu-agente', reason: 'placeholder parcial em args' },
        { source: 'user', reason: 'JSON inválido no catálogo do usuário' },
      ]}
      onClose={onClose}
      onReload={onReload}
    />,
  );
  return { onClose, onReload };
}

describe('CatalogView', () => {
  it('lists agents with kind and installation state', () => {
    setup();
    const claude = screen.getByTestId('catalog-claude');
    expect(within(claude).getByText('Claude Code')).toBeTruthy();
    expect(within(claude).getByText(/instalado/i).textContent).toMatch(/C:\\bin\\claude\.exe/);
    expect(within(claude).getByText(/conferido com 2\.1\.0/i)).toBeTruthy();
    const codex = screen.getByTestId('catalog-codex');
    expect(within(codex).getByText(/não encontrado/i).textContent).toMatch(/codex.*não está no PATH/);
    const bash = screen.getByTestId('catalog-bash');
    expect(within(bash).getByText('shell')).toBeTruthy();
    expect(within(bash).getByText(/não verificado/i)).toBeTruthy();
  });

  it('lists invalid entries with source and reason', () => {
    setup();
    const list = screen.getByRole('list', { name: /entradas inválidas/i });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      expect.stringMatching(/meu-agente.*catálogo do usuário.*placeholder parcial em args/),
      expect.stringMatching(/catálogo do usuário.*JSON inválido/),
    ]);
  });

  it('reloads and closes', () => {
    const { onClose, onReload } = setup();
    fireEvent.click(screen.getByRole('button', { name: /recarregar/i }));
    fireEvent.click(screen.getByRole('button', { name: /fechar/i }));
    expect(onReload).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says when every entry is valid', () => {
    render(<CatalogView agents={[]} detect={{}} invalid={[]} onClose={() => undefined} onReload={() => undefined} />);
    expect(screen.getByText(/todas as entradas do catálogo são válidas/i)).toBeTruthy();
  });
});
