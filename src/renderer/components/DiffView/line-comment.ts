import type { DiffLine, SendInput } from '../../../shared/ipc-contract';

/** Tamanho máximo do comentário digitado. */
export const COMMENT_MAX = 4000;

/** Linhas minificadas não vão inteiras ao agente. */
export const SNIPPET_MAX = 2000;

const SIGN: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-' };

/** Caracteres de controle exceto tabulação: o núcleo recusa o envio inteiro se algum chegar lá. */
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/g;

const BODY = 'Comentário de revisão em {{arquivo}}, {{linha}}:\n{{trecho}}\n\n{{comentario}}';

/** Como a linha é citada: a removida só existe na versão antiga. */
export function lineRef(line: DiffLine): string {
  if (line.kind === 'del') return `linha ${line.oldNo ?? '?'} (removida)`;
  return `linha ${line.newNo ?? line.oldNo ?? '?'}`;
}

function snippet(line: DiffLine): string {
  const text = line.text.replace(CONTROL, '');
  const cut = text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX)}…` : text;
  return `${SIGN[line.kind]}${cut}`;
}

/**
 * Texto de um comentário sobre uma linha do diff, pronto para `prompts.send`. O caminho, a linha e o
 * comentário vão como valores de variáveis: assim um `{{x}}` no código não é tratado como variável.
 */
export function buildLineComment(path: string, line: DiffLine, comment: string): Omit<SendInput, 'execIds'> {
  return {
    body: BODY,
    values: {
      arquivo: path.replace(CONTROL, ''),
      linha: lineRef(line),
      trecho: snippet(line),
      comentario: comment.trim(),
    },
    allowEmpty: [],
  };
}
