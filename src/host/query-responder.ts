/** Cores do tema usadas nas respostas OSC 10/11. */
const FG = 'rgb:e6e6/e9e9/efef';
const BG = 'rgb:0707/0808/0b0b';

type State = 'ground' | 'esc' | 'csi' | 'osc' | 'osc-esc';

const CSI_PARAM_MAX = 16;
const OSC_MAX = 64;

/**
 * Reconhece consultas do terminal (DA1, DA2, DSR 5, CPR, OSC 10/11) num fluxo de saída, inclusive
 * divididas entre pedaços, e devolve as respostas que um terminal daria.
 */
export class TerminalQueryResponder {
  private state: State = 'ground';
  private params = '';

  constructor(private rows: () => number) {}

  /** Processa um pedaço de saída e devolve as respostas na ordem das consultas. */
  observe(chunk: Uint8Array): string[] {
    const replies: string[] = [];
    for (const byte of chunk) this.step(byte, replies);
    return replies;
  }

  private step(byte: number, replies: string[]): void {
    switch (this.state) {
      case 'ground':
        if (byte === 0x1b) this.state = 'esc';
        return;
      case 'esc':
        if (byte === 0x5b) {
          this.state = 'csi';
          this.params = '';
        } else if (byte === 0x5d) {
          this.state = 'osc';
          this.params = '';
        } else {
          this.state = byte === 0x1b ? 'esc' : 'ground';
        }
        return;
      case 'csi':
        if (byte >= 0x30 && byte <= 0x3f) {
          this.params += String.fromCharCode(byte);
          if (this.params.length > CSI_PARAM_MAX) this.state = 'ground';
          return;
        }
        if (byte >= 0x40 && byte <= 0x7e) {
          const reply = this.csiReply(this.params, String.fromCharCode(byte));
          if (reply) replies.push(reply);
        }
        this.state = byte === 0x1b ? 'esc' : 'ground';
        return;
      case 'osc':
        if (byte === 0x07) {
          const reply = this.oscReply(this.params, '\x07');
          if (reply) replies.push(reply);
          this.state = 'ground';
          return;
        }
        if (byte === 0x1b) {
          this.state = 'osc-esc';
          return;
        }
        this.params += String.fromCharCode(byte);
        if (this.params.length > OSC_MAX) this.state = 'ground';
        return;
      case 'osc-esc':
        if (byte === 0x5c) {
          const reply = this.oscReply(this.params, '\x1b\\');
          if (reply) replies.push(reply);
          this.state = 'ground';
          return;
        }
        // ESC sem `\`: começa uma nova sequência.
        this.state = 'esc';
        this.step(byte, replies);
        return;
    }
  }

  private csiReply(params: string, final: string): string | null {
    if (final === 'c' && (params === '' || params === '0')) return '\x1b[?1;2c';
    if (final === 'c' && (params === '>' || params === '>0')) return '\x1b[>0;0;0c';
    if (final === 'n' && params === '5') return '\x1b[0n';
    if (final === 'n' && params === '6') return `\x1b[${Math.max(1, this.rows())};1R`;
    return null;
  }

  private oscReply(params: string, terminator: string): string | null {
    if (params === '10;?') return `\x1b]10;${FG}${terminator}`;
    if (params === '11;?') return `\x1b]11;${BG}${terminator}`;
    return null;
  }
}

/** O hospedeiro responde só sem conexão anexada ou durante uma reprodução; senão quem responde é o xterm da interface. */
export function hostShouldRespond(attachedLive: number, replaying: number): boolean {
  return attachedLive === 0 || replaying > 0;
}
