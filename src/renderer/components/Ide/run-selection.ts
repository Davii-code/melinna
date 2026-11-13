import type { RunStore } from '../../store/run-store';

/** Só executa se a escolha solicitada continuou ativa após a persistência. */
export async function runSelectedConfiguration(
  store: Pick<RunStore, 'choose' | 'get' | 'run'>,
  groupId: string,
  configId: string,
): Promise<void> {
  await store.choose({ groupId, commandId: configId });
  const selected = store.get().active;
  if (selected?.groupId === groupId && selected.commandId === configId) await store.run();
}
