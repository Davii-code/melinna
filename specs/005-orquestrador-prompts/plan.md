# Implementation Plan: Orquestrador de prompts (primeira fatia)

**Branch**: `005-orquestrador-prompts` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

Biblioteca de prompts num arquivo próprio (`userData/prompts.json`, versão 1), separada do
`state.json`. Um módulo puro resolve variáveis. Envio reaproveita `promptBytes` de
`src/core/execution/prompt-delivery.ts` (colagem entre marcadores quando há várias linhas + Enter). A
fila por sessão fica no mesmo arquivo e é despachada pelo evento de ocioso do `BusyTracker` existente.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24

**Primary Dependencies**: React 19 — **nenhuma nova**

**Storage**: `userData/prompts.json` (`{ version: 1, prompts: Prompt[], queues: Record<execId, QueueItem[]> }`),
gravado de forma atômica como o `StateStore` (arquivo temporário + rename)

**Testing**: Vitest (unit core/main/renderer, integração com PTY real para envio e fila), Playwright

**Constraints**: texto ≤ 100.000 caracteres; logs sem conteúdo de prompt (o logger já proíbe campos
`prompt`/`input`); um item da fila por transição para ocioso

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Agente é processo | ✅ Envio é escrita no PTY; avisos de shell e de modo sem confirmações vêm de `AgentDefinition.kind` e `PermissionOption.dangerous`, já existentes no catálogo (sem mudança de esquema). |
| II. Pasta do usuário | ✅ Biblioteca e fila na pasta de dados do app; nada gravado no projeto. |
| III. PTY fonte da verdade | ✅ Prompt chega como digitação no PTY; sessões não são relançadas. |
| IV. Núcleo independente | ✅ `src/core/prompts/` puro (variáveis, biblioteca, fila) com portas `FileSystem`, `Clock`, `Logger`; IPC em `src/main`. |
| V/VI | ✅ Testes por história; casos de borda viram requisitos. |
| VII. Sem surpresas | ✅ Sem dependência nova. Novo arquivo persistido e canais IPC aprovados — ver abaixo. |
| VIII. Execução segura | ✅ Texto escrito no PTY, nunca executado pelo app; caracteres de controle (C0 e ESC, exceto `\n`/`\t`) recusados na validação e de novo no núcleo antes de escrever, o que impede fechar a colagem entre marcadores e injetar teclas; aviso para shells (FR-012); destaque para sessão em modo sem confirmações. |

Resultado: **passa** (aprovações do Princípio VII registradas abaixo).

### Aprovações (Princípio VII)

| Contrato | Mudança | Aprovação |
|---|---|---|
| Arquivo persistido | `userData/prompts.json` versão 1 (prompts e filas) | aprovado pelo dono em 2026-10-22 |
| IPC | grupo `prompts` (CRUD, `send`, fila) e evento `promptsChanged` | aprovado pelo dono em 2026-10-22 |

Constitution de referência: 2.0.0.

## Design

### Núcleo (`src/core/prompts/`)

- `variables.ts` (puro): `extractVariables(body)` (`/\{\{([A-Za-z0-9_]+)\}\}/g`, únicas, na ordem),
  `resolve(body, values, auto)` em passada única com função no `replace` (valor nunca reexpandido;
  `- `variables.ts` (puro): `extractVariables(body)` (`/\{\{([A-Za-z0-9_]+)\}\}/g`, únicas, na ordem),
  `resolve(body, values, auto)` com `auto = { pasta, workspace, data }`; erro se faltar valor sem a
  opção "deixar vazio".`/`$1` literais), `auto = { pasta, workspace, data }`; erro se faltar valor sem "deixar
  vazio"; `assertNoControlChars`.
- `prompt-store.ts`: lê/grava `prompts.json` (atômico, versão 1, arquivo corrompido → backup
  `prompts.json.bad` e começa vazio com log `prompts.load_failed`); serializa gravações com
  `KeyedMutex`.
- `prompt-library.ts`: CRUD com validação (nome 1–80, texto ≤ 100.000, escopo `global` ou `groupId`
  existente); `listFor(groupId)`; remoção dos prompts de um workspace removido.
- `prompt-queue.ts`: `enqueue` (resolve para a sessão), `remove`, `clear`, `onIdle(execId)` →
  semântica **no máximo uma vez**: remove o primeiro item e grava o arquivo **antes** de escrever;
  falha ao escrever → descarte com `queueDiscarded { reason: 'write-failed' }`. Despacha também na
  abertura do app para sessões já ociosas. `discard(execId)` ao terminar/remover a sessão; na
  abertura, descarta filas de execuções inexistentes. Detalhes em data-model.md.
- `prompt-sender.ts`: `send({ body, values, allowEmpty, execIds })` → **resolve por destino**
  (`pasta` e `workspace` de cada sessão), revalida sem caracteres de controle e escreve
  `promptBytes(text)` via `ExecutionService.write`, serializado por execução; resultado por alvo
  (`sent` | `not-ready` | `not-running` | `not-found` | `failed`).
- Integração: `ExecutionService` expõe `onIdle(fn)` (a partir do `BusyTracker` que já existe) e
  `onEnded(fn)` (exit/lost/remoção) para a fila.

### Main/IPC

Grupo `prompts` (ver [contracts/ipc.md](contracts/ipc.md)), evento `promptsChanged` (biblioteca e
filas) e evento `queueDiscarded { execId, items, reason }` para o aviso de descarte.

### Renderer

- `components/Prompts/PromptLibrary.tsx` (diálogo, aberto por botão na barra de topo e por
  Ctrl+Shift+P — listener na janela em fase de captura, funciona com o terminal em foco e a tecla não
  chega ao PTY; não conflita com Ctrl+Shift+B nem com o Ctrl+Shift+F da busca do terminal): lista com busca, criar/editar/duplicar/excluir, escopo.
- `components/Prompts/UsePromptDialog.tsx`: formulário de variáveis, destino (sessão em foco, várias
  sessões com caixas de seleção, ou "enfileirar"), confirmação para várias sessões, aviso de shell e de
  modo sem confirmações, resultado por sessão.
- Linha da execução na árvore: selo "N na fila" e menu para ver/limpar a fila.

### Erros e logs

`INPUT_INVALID` (nome, tamanho, escopo, variável faltando), `EXECUTION_NOT_RUNNING` por alvo (no
resultado, não como erro geral), `IO_ERROR` ao gravar. Logs: `prompts.saved { promptId, size }`,
`prompts.deleted`, `prompts.sent { targets: n, sent: n }`, `prompts.queue { execId, action, size }`,
`prompts.queue_discarded { execId, items }` — nunca o texto.

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit core | variáveis (detecção, nomes inválidos, auto, faltando), biblioteca (validação, escopo), store (atômico, corrompido), fila (um por ocioso, duplo ocioso, descarte, retomada), sender (resultado por alvo) | `tests/unit/core/prompts/` |
| Integração | envio real a duas sessões do agente falso; fila despachada ao ficar ocioso | `tests/integration/core/prompts.test.ts` |
| Unit main | canais e validação | `tests/unit/main/ipc/register-prompts.test.ts` |
| Unit renderer | biblioteca, formulário, confirmação, avisos, selo de fila | `tests/unit/renderer/Prompts*.test.tsx` |
| e2e | usar prompt com variável e enviar para duas sessões | `tests/e2e/prompts.spec.ts` |

Roteiro manual para o `/testar-tela` em [quickstart.md](quickstart.md).

## Project Structure

```text
src/core/prompts/variables.ts, prompt-store.ts, prompt-library.ts, prompt-queue.ts, prompt-sender.ts (novos)
src/core/execution/execution-service.ts (onIdle, onEnded), src/core/paths.ts (promptsFile)
src/shared/ipc-contract.ts
src/main/ipc/register-prompts.ts, validate-prompts.ts (novos), src/main/ipc/register.ts, src/main/main.ts
src/renderer/components/Prompts/PromptLibrary.tsx, UsePromptDialog.tsx (novos)
src/renderer/components/Tree/TreeExecution.tsx, src/renderer/App.tsx
```

## Complexity Tracking

Sem violações.
