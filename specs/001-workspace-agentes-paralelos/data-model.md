# Data Model: Workspace de agentes paralelos

Identificadores: `crypto.randomUUID()`. Datas: ISO 8601 UTC. Caminhos: absolutos, normalizados.

## Entidades

### Group

| Campo | Tipo | Regra |
|-------|------|-------|
| id | string | único |
| name | string | 1–80 caracteres, sem quebra de linha |
| order | number | ordem na árvore |

### Task

| Campo | Tipo | Regra |
|-------|------|-------|
| id | string | único |
| groupId | string | grupo existente |
| title | string | 1–120; padrão = primeira linha do enunciado |
| prompt | string | 1–100.000 caracteres, sem `\0` |
| repoPath | string | raiz de um repositório git (`git rev-parse --show-toplevel`) |
| repoId | string | sha256 do `repoPath` normalizado, 16 primeiros hex |
| baseRef | string | texto informado (branch, tag ou commit) |
| baseCommit | string | sha resolvido no momento da criação |
| slug | string | `[a-z0-9-]{1,40}`, derivado do título |
| createdAt | string | |

### Execution

| Campo | Tipo | Regra |
|-------|------|-------|
| id | string | único |
| taskId | string | |
| agentId | string | id do catálogo |
| bandIndex | number | inteiro ≥ 0 pela ordem de criação na tarefa, sem teto (execuções removidas não liberam o índice); cor = `bands[bandIndex % 6]`, número `bandIndex + 1` exibido quando `bandIndex >= 6` |
| model | string \| null | da lista ou personalizado validado; null para shells |
| permissionMode | string \| null | id da lista do catálogo |
| branch | string | `melinna/<slug>/<agentId>[-n]` |
| worktreePath | string | `<userData>/worktrees/<repoId>/<id>` |
| baseCommit | string | copiado da tarefa |
| status | ExecutionStatus | ver máquina de estados |
| pendingSwitch | { kind: 'model' \| 'permission', value: string } \| null | troca aguardando ociosidade |
| pid | number \| null | |
| exitCode | number \| null | |
| signal | string \| null | |
| startedAt, endedAt | string \| null | |
| launchCount | number | incrementado a cada relançamento |
| failure | { code, message } \| null | quando `failed_to_start` ou `lost` |

### Máquina de estados de Execution

```text
preparing ──ok──▶ starting ──spawned──▶ running ◀──output── idle
    │                 │                   │  └──1,5 s sem saída──▶ idle
    │                 │                   │
    └─erro─▶ failed_to_start ◀─erro───────┘ (spawn falhou)
running|idle ──exit──▶ exited
running|idle ──host caiu──▶ lost
exited|failed_to_start|lost ──relançar──▶ starting
exited|failed_to_start|lost ──remover──▶ (apagada)
```

Transições fora deste grafo lançam `MelinnaError` (`EXECUTION_RUNNING` ou `EXECUTION_NOT_RUNNING`).

### WorktreeLease

Arquivo `<userData>/worktrees/<repoId>/<execId>.lease` com `{ execId, worktreePath, createdAt }`, criado com `flag: 'wx'` (exclusivo).

| Momento | Ação |
|---------|------|
| Preparo da execução | adquire, antes do `git worktree add`; já existir com outro `execId` → `WORKTREE_IN_USE` |
| Preparo falhou | libera depois de desfazer o worktree |
| Parar, relançar, trocar modelo/modo | mantém; relançar confere que o lease é da mesma execução |
| Abertura do app | lease sem execução correspondente em `state.json` vira resíduo (`WORKTREE_RESIDUE`, limpável) |
| Remoção | libera depois do `git worktree remove` |

A exclusividade entre instâncias do app é garantida por `app.requestSingleInstanceLock()`; o lease garante exclusividade entre execuções.

### LayoutState

| Campo | Tipo | Regra |
|-------|------|-------|
| mode | `'auto' \| 'spotlight' \| 'sidebar' \| 'custom'` | padrão `auto` |
| openExecutionIds | string[] | ordem dos painéis; máximo 12 |
| focusedExecutionId | string \| null | usado por spotlight e sidebar |
| custom | { columns: number[]; rows: number[]; cells: Record<execId, { col, row, colSpan, rowSpan }> } | frações somam 1 com tolerância 1e-6 |

### AgentDefinition

Ver [`contracts/catalog-schema.md`](./contracts/catalog-schema.md).

## Formatos em disco

### `state.json` (principal)

```json
{
  "schemaVersion": 1,
  "groups": [],
  "tasks": [],
  "executions": [],
  "layout": { "mode": "auto", "openExecutionIds": [], "focusedExecutionId": null, "custom": { "columns": [1], "rows": [1], "cells": {} } }
}
```

Gravação atômica: escreve `state.json.tmp`, `fsync`, renomeia. Na leitura, `schemaVersion` desconhecido maior que o suportado: abre em modo somente leitura e avisa. Corrompido: ver plan, Tratamento de erro.

### `host/registry.json` (hospedeiro)

```json
{ "schemaVersion": 1, "processes": { "<execId>": { "pid": 1234, "startedAt": "…", "exitCode": null, "signal": null, "endedAt": null, "totalBytes": 0 } } }
```

### Scrollback

```text
<userData>/scrollback/<execId>/
├── meta.json        { schemaVersion, totalBytes, firstAvailableOffset, gaps: [{ at, lostBytes, reason }], segments: [...] }
├── 0000000000000000.seg
└── 0000000002097152.seg
```

- Nome do segmento = deslocamento inicial com 16 dígitos.
- Segmento fecha ao atingir 2.097.152 bytes. Antes de abrir um novo segmento quando já existem 4, o mais antigo é apagado e `firstAvailableOffset` avança; assim nunca há mais de 4 segmentos (8 MB) em disco.
- Relançamento e hospedeiro novo continuam os deslocamentos a partir de `totalBytes`.
- Relançamento grava um separador (texto com data e hora e reset de atributos) no mesmo log.
- Reprodução a partir de deslocamento descartado começa em `firstAvailableOffset` precedida da marca "histórico anterior descartado" e de `ESC[0m`.

### Hospedeiro

`<userData>/host/token` (segredo), `<userData>/host/endpoint` (nome do pipe/socket e pid do hospedeiro).
