import { MelinnaError } from '../errors';

export function invalidInput(message: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage: message });
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Caminho relativo seguro para o git: dentro do repositório, sem `..`, sem `-` inicial e sem caracteres de controle. */
export function assertSafeRelPath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
    throw invalidInput('Caminho de arquivo inválido.');
  }
  const absolute = path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path);
  const segments = path.split(/[\\/]/);
  if (CONTROL.test(path) || absolute || path.startsWith('-') || segments.includes('..')) {
    throw invalidInput('Caminho de arquivo inválido.');
  }
}

export function assertSafeRelPaths(paths: unknown, max = 5000): asserts paths is string[] {
  if (!Array.isArray(paths) || paths.length > max) throw invalidInput('Lista de arquivos inválida.');
  for (const p of paths) assertSafeRelPath(p);
}

export function assertSha(sha: unknown): asserts sha is string {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) throw invalidInput('Identificador de commit inválido.');
}
