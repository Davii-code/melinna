export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', fn: () => void): void;
}

export interface FocusableWindow {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

/** Garante uma única instância por usuário: a segunda só foca a janela existente e sai. */
export function claimSingleInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  return true;
}
