import { MAX_FILES } from '../../core/attachments/image-format';
import { MelinnaError } from '../../core/errors';
import { LIMITS } from '../../shared/ipc-contract';
import { existing, invalid, noArgs, str } from './validate-common';

export const parseClipboardHasImage = noArgs;

export function tooManyFiles(): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage: `Envie até ${MAX_FILES} imagens por vez.` });
}

function execId(exists: (id: string) => boolean, v: unknown): string {
  return existing(v, 'Execução', exists);
}

/** `(execId)`: execução existente; se está viva e se o agente aceita imagem, quem decide é o serviço. */
export function parseExecIdOnly(exists: (id: string) => boolean) {
  return (args: unknown[]): [string] => {
    if (args.length !== 1) throw invalid('argumentos');
    return [execId(exists, args[0])];
  };
}

/**
 * `(execId, paths)`: 1 a 20 caminhos de texto. Caractere de controle não é recusado aqui: o serviço o
 * recusa por arquivo, para uma soltura mista mostrar só os recusados.
 */
export function parseExecIdAndPaths(exists: (id: string) => boolean) {
  return (args: unknown[]): [string, string[]] => {
    if (args.length !== 2) throw invalid('argumentos');
    const id = execId(exists, args[0]);
    const paths = args[1];
    if (!Array.isArray(paths) || paths.length < 1) throw invalid('imagens');
    if (paths.length > MAX_FILES) throw tooManyFiles();
    return [id, paths.map((p) => str(p, 'caminho da imagem', 1, LIMITS.path))];
  };
}
