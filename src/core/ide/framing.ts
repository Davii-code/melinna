import { IDE_LIMITS, object } from '../../shared/ide-types';

const encoder = new TextEncoder();
export function encodeMessage(message: Record<string, unknown>): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  if (body.length > IDE_LIMITS.message) throw new Error('Mensagem de ferramenta excede o limite.');
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  return bytes;
}

/** Framing em bytes; uma mensagem pode atravessar chunks e caracteres UTF-8. */
export class MessageFramer {
  private buffer = new Uint8Array(0);
  private length: number | null = null;
  push(chunk: Uint8Array): Record<string, unknown>[] {
    if (this.buffer.length + chunk.length > IDE_LIMITS.message + IDE_LIMITS.header)
      throw new Error('Buffer de protocolo excedido.');
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    const messages: Record<string, unknown>[] = [];
    for (;;) {
      if (this.length === null) {
        let end = -1;
        for (let i = 0; i + 3 < this.buffer.length; i++) {
          if (
            this.buffer[i] === 13 &&
            this.buffer[i + 1] === 10 &&
            this.buffer[i + 2] === 13 &&
            this.buffer[i + 3] === 10
          ) {
            end = i;
            break;
          }
        }
        if (end < 0) {
          if (this.buffer.length > IDE_LIMITS.header) throw new Error('Header de protocolo excedido.');
          break;
        }
        if (end > IDE_LIMITS.header) throw new Error('Header de protocolo excedido.');
        const header = new TextDecoder('ascii').decode(this.buffer.slice(0, end));
        const lengths = header.split('\r\n').filter((line) => /^content-length:/i.test(line));
        if (lengths.length !== 1 || !/^content-length:\s*\d+\s*$/i.test(lengths[0]!))
          throw new Error('Content-Length inválido.');
        this.length = Number(lengths[0]!.split(':')[1]);
        if (!Number.isSafeInteger(this.length) || this.length < 1 || this.length > IDE_LIMITS.message)
          throw new Error('Tamanho de mensagem inválido.');
        this.buffer = this.buffer.slice(end + 4);
      }
      if (this.buffer.length < this.length) break;
      messages.push(
        object(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.slice(0, this.length))),
        ),
      );
      this.buffer = this.buffer.slice(this.length);
      this.length = null;
    }
    return messages;
  }
}
