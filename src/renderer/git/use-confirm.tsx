import { useCallback, useState, type ReactNode } from 'react';
import type { NeedsConfirm } from '../../shared/ipc-contract';
import { ConfirmGitDialog } from '../components/Git/ConfirmGitDialog';

/** Confirmações do git como promessa: `ask` abre o diálogo e resolve com a resposta; `dialog` vai no JSX. */
export function useConfirm(): { ask: (request: NeedsConfirm) => Promise<boolean>; dialog: ReactNode } {
  const [current, setCurrent] = useState<{ request: NeedsConfirm; resolve: (ok: boolean) => void } | null>(null);
  const ask = useCallback(
    (request: NeedsConfirm) => new Promise<boolean>((resolve) => setCurrent({ request, resolve })),
    [],
  );
  const answer = (ok: boolean) => {
    current?.resolve(ok);
    setCurrent(null);
  };
  const dialog = current ? (
    <ConfirmGitDialog request={current.request} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
  ) : null;
  return { ask, dialog };
}
