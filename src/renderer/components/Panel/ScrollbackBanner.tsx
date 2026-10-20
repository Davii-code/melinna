export interface ScrollbackBannerProps {
  reason: 'DISK_FULL' | 'IO_ERROR' | null;
}

/** Aviso no painel quando o histórico deixou de ser gravado; o terminal continua funcionando. */
export function ScrollbackBanner({ reason }: ScrollbackBannerProps) {
  if (!reason) return null;
  return (
    <div className="panel-banner warning" role="status" data-testid="scrollback-banner">
      {reason === 'DISK_FULL'
        ? 'Histórico não está sendo gravado: disco cheio'
        : 'Histórico não está sendo gravado: erro ao gravar no disco'}
      <span className="hint"> — nova tentativa a cada 30 s</span>
    </div>
  );
}
