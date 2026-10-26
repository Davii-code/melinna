import { describe, expect, it } from 'vitest';
import { copyName, isSecretName } from '../../../src/shared/run-names';

describe('copyName', () => {
  it('adds (cópia), then (cópia 2) and (cópia 3)', () => {
    expect(copyName('Servidor', ['Servidor'])).toBe('Servidor (cópia)');
    expect(copyName('Servidor', ['Servidor', 'Servidor (cópia)'])).toBe('Servidor (cópia 2)');
    expect(copyName('Servidor', ['Servidor', 'Servidor (cópia)', 'Servidor (cópia 2)'])).toBe(
      'Servidor (cópia 3)',
    );
  });

  it('compares without regard to case', () => {
    expect(copyName('Servidor', ['SERVIDOR (CÓPIA)'])).toBe('Servidor (cópia 2)');
  });

  it('copies a copy from the original name', () => {
    expect(copyName('Servidor (cópia)', ['Servidor', 'Servidor (cópia)'])).toBe('Servidor (cópia 2)');
    expect(copyName('Servidor (cópia 2)', ['Servidor', 'Servidor (cópia 2)'])).toBe('Servidor (cópia)');
  });
});

describe('isSecretName', () => {
  it('flags names that look like secrets, in any case', () => {
    for (const n of ['API_TOKEN', 'db_password', 'PASSWD', 'MY_SECRET', 'API_KEY', 'aws_credentials'])
      expect(isSecretName(n), n).toBe(true);
    for (const n of ['PORT', 'NODE_ENV', 'PATH']) expect(isSecretName(n), n).toBe(false);
  });
});
