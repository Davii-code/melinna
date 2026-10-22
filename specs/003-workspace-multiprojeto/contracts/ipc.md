# Contrato IPC: Workspace multiprojeto

Acréscimos à `MelinnaApi` (`src/shared/ipc-contract.ts`). Todos devolvem `Result<T>`; entradas
inválidas → `INPUT_INVALID`. O contrato base continua em
`specs/001-workspace-agentes-paralelos/contracts/ipc.md`.

```ts
workspace: {
  /** Cria um workspace com nome e pastas; primaryIndex padrão 0. */
  createWorkspace(input: { name: string; folders: string[]; primaryIndex?: number }): Promise<Result<Group>>;
  /** Uma mudança por chamada; devolve o workspace atualizado. */
  updateWorkspace(
    id: string,
    change:
      | { kind: 'rename'; name: string }
      | { kind: 'addFolders'; folders: string[] }
      | { kind: 'removeFolder'; folderId: string }
      | { kind: 'setPrimary'; folderId: string },
  ): Promise<Result<Group>>;
  /** Diálogo nativo com seleção múltipla; [] se cancelado. */
  pickFolders(defaultPath?: string): Promise<Result<string[]>>;
}
```

## Tipos

```ts
interface WorkspaceFolder { id: string; path: string }
interface Group {
  // campos atuais…
  folders?: WorkspaceFolder[];
  primaryFolderId?: string;
}
interface WorkspaceSnapshot {
  // campos atuais…
  /** Disponibilidade calculada na leitura, por id de pasta. */
  folderAvailability: Record<string, boolean>;
}
type ExecutionNotice = { kind: 'extra-dirs-unsupported' } | { kind: 'extra-dirs-omitted'; count: number };
```

## Validação (main)

| Campo | Regra |
|---|---|
| `name` | string 1–80 (`LIMITS.groupName`) |
| `folders` | array 1–32 de string 1–`LIMITS.path` |
| `primaryIndex` | inteiro 0..folders.length-1 |
| `id`, `folderId` | id existente |
| `change.kind` | um dos quatro |

## Erros (userMessage)

| Situação | Mensagem |
|---|---|
| nome inválido | "O nome do workspace deve ter de 1 a 80 caracteres, sem quebra de linha." |
| workspace inexistente | "Workspace não encontrado." |
| pasta inexistente no workspace (`folderId`) | "Pasta não encontrada neste workspace." |
| `primaryIndex` fora da lista | "Escolha a pasta principal entre as pastas do workspace." |
| mais de 32 pastas | "Um workspace pode ter no máximo 32 pastas." |
| pasta inexistente | "A pasta X não existe." |
| pasta duplicada | "A pasta X já está neste workspace." |
| remover a única pasta | "Um workspace precisa de ao menos uma pasta." |
| principal indisponível ao lançar | "A pasta principal X não está disponível." |
| linha de comando longa demais | "Pastas demais para abrir este agente de uma vez; remova algumas do workspace." |

## Aplicação

Cada `updateWorkspace` aplica uma mudança e grava; o diálogo de edição chama uma vez por ação do
usuário. Chamadas ao mesmo workspace são serializadas.

## Inalterados

`openWorkspace`, `createAndLaunch`, `addExecution`, `remove`, `removeWorkspace` mantêm a assinatura;
`createAndLaunch`/`addExecution` passam a aplicar as pastas extras do workspace da tarefa.
