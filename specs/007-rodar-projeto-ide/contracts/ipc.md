# Contrato IPC: Rodar o projeto e abrir na IDE externa

Novos grupos `run` e `ide`; todos devolvem `Result<T>`.

```ts
interface RunCommand { id: string; source: 'npm' | 'maven' | 'gradle' | 'compose' | 'custom'; label: string; program: string; args: string[]; folder: string; available: boolean; searched: string }
interface DetectResult { commands: RunCommand[]; warnings: { folder: string; message: string }[] }

run: {
  list(groupId: string): Promise<Result<DetectResult>>;          // detectados + personalizados, por pasta
  /** O main resolve commandId (nova detecção ou Group.commands); já rodando → devolve a execução existente com reused=true. */
  start(groupId: string, commandId: string, size: TermSize, confirm?: 'wrapper-sh'[]): Promise<Result<{ taskId: string; execId: string; reused: boolean } | { needsConfirm: 'wrapper-sh'; wrapper: string }>>;
  rerun(execId: string, size: TermSize): Promise<Result<void>>;
  saveCommand(groupId: string, input: { id?: string; label: string; program: string; args: string[]; folder: string }): Promise<Result<RunCommand>>;
  removeCommand(groupId: string, commandId: string): Promise<Result<void>>;
}

ide: {
  /** Onde está cada IDE (null = não encontrada) e onde o app procurou. */
  locate(): Promise<Result<{ vscode: { path: string | null; searched: string[] }; intellij: { path: string | null; searched: string[] } }>>;
  open(kind: 'vscode' | 'intellij', target: { path: string; line?: number }): Promise<Result<void>>;
  /** Diálogo nativo no main para escolher o executável (no Windows só .exe); cancelado → null. */
  choosePath(kind: 'vscode' | 'intellij'): Promise<Result<string | null>>;
  /** Volta à detecção automática. */
  resetPath(kind: 'vscode' | 'intellij'): Promise<Result<void>>;
  reveal(path: string): Promise<Result<void>>;                    // explorador de arquivos
}
```

Parar usa o canal existente `executions.stop`.

## Validação (main)

| Campo | Regra |
|---|---|
| `groupId`, `execId`, `commandId` | existentes |
| `label` | 1–80, sem quebra de linha |
| `program` | 1–`LIMITS.path`, sem caracteres de controle |
| `args` | 0–64 itens, cada um 0–4.096, sem caracteres de controle |
| `folder` | dentro de uma pasta do workspace `groupId` |
| `target.path`, `reveal.path` | após `realpath`, dentro de uma pasta de algum workspace registrado |
| `line` | inteiro 1–10.000.000 |
| executável da IDE (escolhido no diálogo ou detectado) | arquivo regular; no Windows só `.exe`; `.cmd`/`.bat` recusados também no `open` |

## Erros

| Situação | Código / mensagem |
|---|---|
| programa não encontrado | `PROGRAM_NOT_FOUND` "Programa não encontrado: X." |
| comando não existe mais | `COMMAND_STALE` "O comando mudou; abra o menu de novo." |
| lote (`.cmd`/`.bat`) que não é shim do npm | `INPUT_INVALID` "Este programa só roda pelo prompt de comando; use o executável." |
| sem vaga | `LIMIT_REACHED` |
| remover com comando rodando | `EXECUTION_RUNNING` "Pare o comando antes." |
| IDE não encontrada | `IDE_NOT_FOUND` "VS Code não encontrado. Procurado em: …" (o renderer oferece escolher o executável) |
| executável de IDE que é lote | `INPUT_INVALID` "Escolha o programa .exe da IDE." |
| pasta fora do workspace | `INPUT_INVALID` "A pasta precisa ser do workspace." |
