import type { HostClient } from '../ports/host-client';

const encoder = new TextEncoder();

/** Texto a escrever no PTY: com quebra de linha, usa colagem entre colchetes para não enviar no meio. */
export function promptBytes(prompt: string): Uint8Array {
  const text = /[\r\n]/.test(prompt)
    ? `\x1b[200~${prompt.replace(/\r?\n/g, '\r')}\x1b[201~\r`
    : `${prompt}\r`;
  return encoder.encode(text);
}

export interface PendingDelivery {
  done: Promise<boolean>;
  cancel(): void;
}

/** Escreve o enunciado no PTY depois da primeira saída da execução. */
export function deliverPromptAfterFirstOutput(
  host: HostClient,
  execId: string,
  prompt: string,
  timeoutMs = 60_000,
): PendingDelivery {
  let cancel: () => void = () => undefined;
  const done = new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (sent: boolean) => {
      if (done) return;
      done = true;
      offActivity();
      offExit();
      clearTimeout(timer);
      resolve(sent);
    };
    const offActivity = host.on('activity', (e) => {
      if (e.execId !== execId) return;
      host.write(execId, promptBytes(prompt));
      finish(true);
    });
    const offExit = host.on('exit', (e) => {
      if (e.execId === execId) finish(false);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    cancel = () => finish(false);
  });
  return { done, cancel };
}
