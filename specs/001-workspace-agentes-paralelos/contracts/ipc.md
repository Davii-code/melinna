# Contrato: API do preload (`window.melinna`)

Tipos em `src/shared/ipc-contract.ts`. Toda chamada devolve `Promise<Result<T>>`, com `Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }`. O principal valida cada payload (tipos, tamanhos, ids existentes) antes de chamar o núcleo.

```ts
interface MelinnaApi {
  catalog: {
    list(): Promise<Result<{ agents: AgentView[]; invalid: CatalogIssue[] }>>;
    detectAll(): Promise<Result<Record<string, DetectResult>>>;
  };
  workspace: {
    snapshot(): Promise<Result<WorkspaceSnapshot>>;
    cleanResidue(residuePath: string): Promise<Result<void>>; // só caminhos devolvidos num erro WORKTREE_RESIDUE
    openWorkspace(path: string, name?: string): Promise<Result<Group>>; // abre ou reaproveita o workspace do repositório
    onChange(fn: (s: WorkspaceSnapshot) => void): Unsubscribe;
    createGroup(name: string): Promise<Result<Group>>;
    renameGroup(id: string, name: string): Promise<Result<void>>;
    renameTask(id: string, title: string): Promise<Result<void>>;
    pickRepository(): Promise<Result<string | null>>;   // diálogo nativo de pasta
    inspectRepo(repoPath: string, baseRef: string): Promise<Result<RepoInspection>>;
  };
  tasks: {
    createAndLaunch(input: { groupId: string; repoPath: string; baseRef: string; prompt: string; title?: string;
      picks: AgentPick[]; size: TermSize }): Promise<Result<{ taskId: string; results: LaunchResult[] }>>;
  };
  executions: {
    stop(execId: string): Promise<Result<void>>;
    relaunch(execId: string, size: TermSize): Promise<Result<void>>;
    removalCheck(execId: string): Promise<Result<RemovalCheck>>;
    remove(execId: string, opts: { deleteBranch: boolean; force: boolean }): Promise<Result<void>>;
    requestSwitch(execId: string, kind: 'model' | 'permission', value: string): Promise<Result<SwitchPlan>>;
    confirmSwitch(execId: string, planId: string): Promise<Result<void>>;
    cancelPendingSwitch(execId: string): Promise<Result<void>>;
    diff(execId: string): Promise<Result<DiffResult>>;
    divergence(execId: string): Promise<Result<{ baseAdvancedBy: number }>>;
  };
  terminal: {
    // Pede ao principal um canal dedicado para a execução. O port NÃO é o valor de retorno
    // (o contextBridge não transfere MessagePort); ver "Entrega do port do terminal" abaixo.
    open(execId: string): Promise<Result<{ channelId: string }>>;
    close(execId: string): Promise<Result<void>>;
  };
  layout: {
    get(): Promise<Result<LayoutState>>;
    set(state: LayoutState): Promise<Result<void>>;
  };
  app: {
    onCloseRequested(fn: (info: { liveCount: number }) => void): Unsubscribe;
    answerClose(choice: 'keep-running' | 'stop-all' | 'cancel'): Promise<Result<void>>;
    openExternal(url: string): Promise<Result<void>>;   // só http/https
  };
}
```

## Entrega do port do terminal

1. A página chama `window.melinna.terminal.open(execId)`; o preload encaminha por `ipcRenderer.invoke('terminal:open', execId)`.
2. O principal cria um `MessageChannelMain`, guarda `port1`, gera `channelId` e envia `port2` com `webContents.postMessage('terminal:port', { execId, channelId }, [port2])`; depois resolve a chamada com `{ channelId }`.
3. O preload escuta `ipcRenderer.on('terminal:port')` e repassa à página com `window.postMessage({ source: 'melinna-terminal', execId, channelId }, location.origin, [port])`.
4. A página aceita só mensagens com `event.source === window`, `event.origin === location.origin`, `source === 'melinna-terminal'` e `channelId` pendente; qualquer outra é ignorada.
5. Mensagens no port: do principal, `{ type: 'data', offset, bytes } | { type: 'marker', kind, lostBytes? } | { type: 'replay-start' } | { type: 'replay-end' } | { type: 'exit', exitCode, signal }`; da página, `{ type: 'input', bytes } | { type: 'resize', cols, rows } | { type: 'ack', offset }`.
6. Entre `replay-start` e `replay-end` a página descarta o que o xterm gerar em `onData` (respostas automáticas a consultas reproduzidas), para não injetar bytes antigos no PTY.
7. A página envia `ack` a cada 256 KB processados pelo xterm (controle de fluxo, ver host-protocol).

## Tipos auxiliares

`RemovalCheck = { uncommittedFiles: number; unmergedCommits: number; branch: string }` — `unmergedCommits` conta commits da branch da execução que não estão em `baseRef`.

Limites validados no principal: `prompt` de 0 a 100.000 caracteres (vazio = agente sem enunciado); `name`/`title` conforme data-model; `input` por mensagem ≤ 64 KB; `cols` 20–1000, `rows` 5–500; `picks` ≤ vagas livres.
