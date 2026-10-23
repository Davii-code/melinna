/** Superfície do xterm usada pelo TerminalView; a implementação real fica em xterm-factory. */
export interface TerminalLike {
  readonly cols: number;
  readonly rows: number;
  open(el: HTMLElement): void;
  write(data: Uint8Array | string, cb?: () => void): void;
  onData(fn: (data: string) => void): { dispose(): void };
  onBinary(fn: (data: string) => void): { dispose(): void };
  focus(): void;
  dispose(): void;
  /** Tamanho que caberia no elemento, ou null se oculto. */
  proposeSize(): { cols: number; rows: number } | null;
  fit(): void;
  /**
   * Filtro de teclas do terminal: devolver `false` impede o xterm de tratar a tecla. Usado para observar o
   * Ctrl+V sem mexer na colagem de texto.
   */
  attachCustomKeyEventHandler(fn: (event: KeyboardEvent) => boolean): void;
  /** Avisa quando o renderizador WebGL perdeu o contexto e trocou para DOM. */
  onRendererFallback(fn: () => void): void;
  search(term: string, direction: 'next' | 'previous'): boolean;
  clearSearch(): void;
}

export interface TerminalFactoryOptions {
  openLink: (url: string) => void;
}

export type TerminalFactory = (opts: TerminalFactoryOptions) => TerminalLike;
