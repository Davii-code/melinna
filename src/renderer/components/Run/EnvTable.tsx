import { useState } from 'react';
import { LIMITS, type RunEnvVar } from '../../../shared/ipc-contract';
import { isSecretName } from '../../../shared/run-names';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvTableProps {
  value: RunEnvVar[];
  onChange: (next: RunEnvVar[]) => void;
}

/** Motivo pelo qual o nome da linha não vale, ou `null`: vazio, caracteres fora de `[A-Za-z0-9_]`, começo por número ou repetido. */
function nameProblem(name: string, index: number, all: readonly RunEnvVar[]): string | null {
  if (!ENV_NAME.test(name))
    return 'Nome de variável inválido: use letras, números e _, sem começar por número.';
  const key = name.toLowerCase();
  if (all.findIndex((v) => v.name.toLowerCase() === key) !== index) return 'Nome repetido.';
  return null;
}

/** Tabela de variáveis de ambiente de uma configuração; valores de nomes com cara de segredo ficam mascarados. */
export function EnvTable({ value, onChange }: EnvTableProps) {
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const patch = (index: number, over: Partial<RunEnvVar>) =>
    onChange(value.map((v, i) => (i === index ? { ...v, ...over } : v)));
  const toggle = (index: number) =>
    setShown((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const anySecret = value.some((v) => isSecretName(v.name));

  return (
    <div className="env-table">
      {value.map((v, i) => {
        const problem = nameProblem(v.name, i, value);
        const secret = isSecretName(v.name);
        const masked = secret && !shown.has(i);
        const label = v.name === '' ? `variável ${i + 1}` : v.name;
        return (
          <div key={i} className="env-row">
            <div className="env-cell">
              <input
                type="text"
                aria-label={`Nome da variável ${i + 1}`}
                aria-invalid={problem !== null}
                value={v.name}
                spellCheck={false}
                onChange={(e) => patch(i, { name: e.target.value })}
              />
              {problem !== null && <p className="field-error">{problem}</p>}
            </div>
            <input
              type={masked ? 'password' : 'text'}
              aria-label={v.name === '' ? `Valor da variável ${i + 1}` : `Valor de ${v.name}`}
              value={v.value}
              maxLength={LIMITS.envValue}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => patch(i, { value: e.target.value })}
            />
            {secret && (
              <button
                type="button"
                className="icon-button"
                aria-label={`${masked ? 'Mostrar' : 'Ocultar'} valor de ${v.name}`}
                onClick={() => toggle(i)}
              >
                {masked ? '👁' : '🙈'}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={`Remover ${label}`}
              title="Remover variável"
              onClick={() => {
                setShown(new Set());
                onChange(value.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        disabled={value.length >= LIMITS.envPairs}
        onClick={() => onChange([...value, { name: '', value: '' }])}
      >
        Adicionar variável
      </button>
      {anySecret && (
        <p className="hint">Os valores ficam gravados em texto no estado local do app, nesta máquina.</p>
      )}
    </div>
  );
}
