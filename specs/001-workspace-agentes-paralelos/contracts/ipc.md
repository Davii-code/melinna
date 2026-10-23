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
    openWorkspace(path: string, name?: string): Promise<Result<Group>>; // abre ou reaproveita o workspace da pasta (raiz do repositório git, ou a própria pasta fora do git)
    onChange(fn: (s: WorkspaceSnapshot) => void): Unsubscribe;
    createGroup(name: string): Promise<Result<Group>>;
    renameGroup(id: string, name: string): Promise<Result<void>>;
    renameTask(id: string, title: string): Promise<Result<void>>;
    pickRepository(defaultPath?: string): Promise<Result<string | null>>;   // diálogo nativo de pasta, aberto em defaultPath
    // Feature 003 (workspace multiprojeto) — contrato completo em specs/003-workspace-multiprojeto/contracts/ipc.md
    createWorkspace(input: { name: string; folders: string[]; primaryIndex?: number }): Promise<Result<Group>>; // 1–32 pastas; a de primaryIndex (padrão 0) é a principal
    updateWorkspace(id: string, change:
      | { kind: 'rename'; name: string } | { kind: 'addFolders'; folders: string[] }
      | { kind: 'removeFolder'; folderId: string } | { kind: 'setPrimary'; folderId: string }): Promise<Result<Group>>; // uma mudança por chamada, serializada por workspace
    pickFolders(defaultPath?: string): Promise<Result<string[]>>;           // diálogo nativo com seleção múltipla; [] se cancelado
    inspectRepo(repoPath: string, baseRef: string): Promise<Result<RepoInspection>>;
  };
  // Feature 004 (imagens no terminal) — contrato completo em specs/004-imagens-no-terminal/contracts/ipc.md
  attachments: {
    clipboardHasImage(): Promise<Result<boolean>>;                          // área de transferência com imagem e sem texto
    pasteImage(execId: string): Promise<Result<ImageRef>>;                  // grava como anexo da execução (userData/attachments/<execId>/)
    checkFiles(execId: string, paths: string[]): Promise<Result<ImageCheck>>; // 1–20 caminhos; recusados vêm com o motivo
    pickImages(execId: string): Promise<Result<ImageCheck>>;                // diálogo nativo de imagens + checkFiles
    send(execId: string, paths: string[]): Promise<Result<void>>;           // revalida e digita as referências no PTY, sem Enter
  };
  // `files.pathOf(file)` (só no preload): caminho real de um arquivo solto, via webUtils.getPathForFile
  tasks: {
    createAndLaunch(input: { groupId: string; repoPath: string; baseRef: string; prompt: string; title?: string;
      picks: AgentPick[]; size: TermSize }): Promise<Result<{ taskId: string; results: LaunchResult[] }>>;
      // a tarefa é criada em execução direta: o processo roda na própria pasta (repoPath), sem worktree
    addExecution(taskId: string, pick: AgentPick, size: TermSize): Promise<Result<LaunchResult[]>>; // mais um terminal na sessão, sem o enunciado
    remove(taskId: string): Promise<Result<void>>;            // sessão e execuções (paradas); a pasta não é tocada
    removeWorkspace(groupId: string): Promise<Result<void>>;  // tira o workspace da lista com as sessões (paradas)
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
  files: {
    roots(): Promise<Result<FileRoot[]>>;              // workspace (repositório) e worktrees das execuções
    list(path: string): Promise<Result<DirectoryListing>>;
    read(path: string): Promise<Result<FileText>>;     // traz o hash do conteúdo para o salvamento
    write(path: string, content: string, expectedHash: string): Promise<Result<FileWriteResult>>;
    status(root: string): Promise<Result<Record<string, FileChange>>>; // decoração de git por arquivo
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

## Navegação de arquivos (`files`)

- **Raízes**: `roots()` devolve o repositório de cada workspace aberto (`Group.repoPath`) e o worktree de cada execução com `worktreePath` preenchido; execução não preparada não aparece. Caminho repetido aparece uma vez só.
- **Contenção**: `list` e `read` resolvem o caminho com `realpath` **antes** de conferir se está dentro de alguma raiz. Link simbólico que aponte para fora é recusado com `FILE_OUTSIDE_ROOT`, não seguido.
- **Limites**: 5.000 entradas por listagem (`truncated: true` acima disso) e 5 MB por leitura (conteúdo cortado, `truncated: true`). Arquivo binário (byte nulo nos primeiros 8 KB) volta com `binary: true` e `content` vazio.
- **Erros**: `INPUT_INVALID` (argumento malformado ou pasta em vez de arquivo), `FILE_OUTSIDE_ROOT`, `FILE_UNREADABLE` (não existe, sumiu ou falhou leitura), `FILE_CONFLICT` (o arquivo mudou em disco desde a leitura).
- **Leitura**: sem escrita nenhuma até a fatia do editor.
- **Escrita (`write`)**: exige o hash devolvido por `read`; se o arquivo em disco não tem mais esse hash, devolve `FILE_CONFLICT` e **nada é gravado**. Gravação atômica (`.melinna-tmp` + renomeação) e log com caminho e os dois hashes, nunca o conteúdo. É a exceção do Princípio II: só por ação explícita do usuário, sem autosave.
- **Decoração (`status`)**: roda `git status --porcelain=v1 -z --untracked-files=all` em modo leitura na raiz pedida e devolve `caminho relativo → added|modified|deleted|renamed|untracked`. Raiz fora das raízes navegáveis devolve `{}` sem executar git; pasta que não é repositório também devolve `{}`.
