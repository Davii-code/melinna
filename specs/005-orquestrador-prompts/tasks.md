# Tasks: Orquestrador de prompts (primeira fatia)

**Input**: `specs/005-orquestrador-prompts/` (plan.md, spec.md, data-model.md, contracts/ipc.md, research.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

## Phase 1: Setup

- [X] T001 [simples] `promptsFile` (`userData/prompts.json`) em `src/core/paths.ts`, com teste em `tests/unit/core/paths.test.ts`

## Phase 2: Foundational

- [X] T002 [P] Testes em `tests/unit/core/prompts/variables.test.ts`: `extractVariables` (únicas, na ordem, repetida uma vez, nome `[A-Za-z0-9_]+`, `{{a-b}}` e `{{ }}` são texto); `resolve` com valores e automáticas `pasta`/`workspace`/`data` (AAAA-MM-DD local); passada única (valor `{{x}}` fica literal; `$&` e `$1` ficam literais); variável faltando → "Preencha a variável {{x}} ou marque para deixar vazia."; `allowEmpty`; `assertNoControlChars` recusa C0 e ESC (`\x1b`, `\x03`, `\x00`) e aceita `\n`/`\t`
- [X] T003 [P] Testes em `tests/unit/core/prompts/prompt-store.test.ts` (FS em memória): arquivo ausente → vazio; gravação atômica (temporário + rename); corrompido → `prompts.json.bad` e vazio com log `prompts.load_failed`; `version` ≠ 1 → leitura funciona e gravar falha com `IO_ERROR` "versão mais nova"; gravações concorrentes serializadas
- [X] T004 [P] [simples] Tipos `Prompt`, `PromptScope`, `QueueItem`, `SendStatus`, `SendResult`, `SendInput` e o grupo `prompts` em `src/shared/ipc-contract.ts` (assinaturas de contracts/ipc.md); `CONTRACT` em `tests/unit/preload/preload.test.ts`; mocks em `tests/support/fake-api.ts`; eventos `promptsChanged` e `queueDiscarded` em `src/preload/preload.ts`
- [X] T005 (depende de T002) `src/core/prompts/variables.ts` (substituição com função no `replace`, uma passada) e `assertNoControlChars`
- [X] T006 (depende de T001, T003) `src/core/prompts/prompt-store.ts` com portas `FileSystem`, `Clock`, `Logger` e `KeyedMutex`

## Phase 3: User Story 1 — Biblioteca com variáveis (P1) 🎯 MVP

**Goal**: criar, editar, duplicar, excluir e usar prompts com variáveis na sessão em foco.

**Independent Test**: criar "Revise {{arquivo}}", usá-lo num terminal do agente falso com `arquivo=x`; o eco mostra "Revise x".

### Tests (escritos antes)

- [X] T007 [P] [US1] Testes em `tests/unit/core/prompts/prompt-library.test.ts`: nome 1–80 sem quebra de linha; `body` 1–100.000 sem caracteres de controle; escopo global ou `groupId` existente ("Workspace não encontrado."); `listFor(groupId)` = globais + do workspace; duplicar cria "(cópia)"; excluir; `countForGroup`; remoção em cascata dos prompts de um workspace removido; logs `prompts.saved { promptId, size }` e `prompts.deleted { promptId }` sem texto nem nome
- [X] T008 [P] [US1] Testes em `tests/unit/core/prompts/prompt-sender.test.ts`: resolve **por destino** (`{{pasta}}` diferente para duas sessões de pastas diferentes; sessão legada usa o worktree); escreve `promptBytes(text)` (várias linhas com `ESC[200~…ESC[201~` + `\r`); texto final revalidado sem caracteres de controle (um valor com `ESC[201~` é recusado antes de escrever); status `sent`, `not-ready` (`preparing`/`starting`), `not-running`, `not-found`, `failed` (erro ao escrever); log `prompts.sent { targets, sent }` sem texto nem nome
- [X] T009 [P] [US1] Testes do IPC em `tests/unit/main/ipc/register-prompts.test.ts`: `list`, `save`, `duplicate`, `remove`, `countForGroup`, `preview`, `send` com a validação de contracts/ipc.md (controle recusado, `execIds` 1–12)
- [X] T010 [P] [US1] Testes em `tests/unit/renderer/PromptLibrary.test.tsx`: criar/editar/duplicar/excluir; escopo; busca
- [X] T011 [P] [US1] Testes em `tests/unit/renderer/UsePromptDialog.test.tsx`: variáveis listadas (repetida uma vez) e automáticas marcadas; enviar bloqueado com variável faltando; prévia via `preview`; envio à sessão em foco chama `send` com `body` e `values`

### Implementação

- [X] T012 [US1] (depende de T006, T007) `src/core/prompts/prompt-library.ts` e chamada de remoção em cascata em `removeGroup` de `src/core/workspace/workspace-service.ts`
- [X] T013 [US1] (depende de T005, T008) `src/core/prompts/prompt-sender.ts` usando `promptBytes` de `src/core/execution/prompt-delivery.ts` e `ExecutionService.write`
- [X] T014 [US1] (depende de T004, T009, T012, T013) `src/main/ipc/register-prompts.ts`, `src/main/ipc/validate-prompts.ts`, registro em `src/main/ipc/register.ts`, montagem em `src/main/main.ts` e envio do evento `promptsChanged`
- [X] T015 [US1] (depende de T010, T014) `src/renderer/components/Prompts/PromptLibrary.tsx` e CSS em `src/renderer/styles/app.css`
- [X] T016 [US1] (depende de T011, T014) `src/renderer/components/Prompts/UsePromptDialog.tsx` (destino: sessão em foco)
- [X] T017 [US1] (depende de T015, T016) Botão no topo e atalho Ctrl+Shift+P em `src/renderer/App.tsx` (listener na janela em fase de captura, funciona com o terminal em foco e não chega ao PTY), com teste em `tests/unit/renderer/App-shortcuts.test.tsx`
- [X] T018 [US1] (depende de T013) Teste de integração em `tests/integration/core/prompts.test.ts`: prompt resolvido enviado a uma sessão do agente falso e ecoado

**Checkpoint**: biblioteca e uso na sessão em foco funcionam.

## Phase 4: User Story 2 — Enviar para várias sessões (P2)

**Goal**: o mesmo prompt para várias sessões vivas, resolvido por sessão, com confirmação e resultado por sessão.

**Independent Test**: três sessões do agente falso em pastas diferentes; enviar "{{pasta}}" para duas; cada uma ecoa a própria pasta; a terceira não recebe.

### Tests (escritos antes)

- [X] T019 [US2] (depois de T011, mesmo arquivo) Testes em `tests/unit/renderer/UsePromptDialog.test.tsx`: escolha de várias sessões vivas; confirmação lista as sessões quando > 1; aviso para sessão de agente com `kind: 'shell'` no catálogo; destaque para sessão cujo modo de permissão tem `dangerous: true` no catálogo; resultado por sessão com os cinco status
- [X] T020 [US2] (depois de T018, mesmo arquivo) Teste de integração em `tests/integration/core/prompts.test.ts`: `send` com `{{pasta}}` para duas de três sessões em pastas diferentes; cada uma recebe a própria pasta; a terceira não recebe; sessão encerrada no meio volta `not-running`

### Implementação

- [X] T021 [US2] (depende de T016, T019) Destino "várias sessões", confirmação, avisos (a partir de `AgentDefinition.kind` e `PermissionOption.dangerous`, já existentes no catálogo) e resultado em `src/renderer/components/Prompts/UsePromptDialog.tsx`

## Phase 5: User Story 3 — Fila por sessão (P3)

**Goal**: enfileirar prompts e despachar no máximo uma vez, um por ociosidade, com persistência e descarte avisado.

**Independent Test**: agente falso em `/busy`; enfileirar dois; ao ficar ocioso, vai um; na próxima ociosidade, o outro.

### Tests (escritos antes)

- [X] T022 [P] [US3] Testes em `tests/unit/core/prompts/prompt-queue.test.ts`: `enqueue` resolve para a sessão; sessão ociosa e fila vazia envia na hora; senão acrescenta; sessão não viva → `EXECUTION_NOT_RUNNING`; `onIdle` remove e grava **antes** de escrever (falha simulada após gravar não reenvia); falha de escrita → `queueDiscarded { reason: 'write-failed' }`; duas ociosidades seguidas não duplicam; `remove`/`clear`; `discard` com `reason` `ended`/`removed` e log `prompts.queue_discarded { execId, items }`; na abertura, despacha filas cujas sessões já estão ociosas e descarta filas de execuções inexistentes; item guarda o texto resolvido mesmo se o prompt for excluído
- [X] T023 [US3] (depois de T009, mesmo arquivo) Testes do IPC `queue.get/enqueue/remove/clear` e evento `queueDiscarded` em `tests/unit/main/ipc/register-prompts.test.ts`
- [X] T024 [US3] (depois de T020, mesmo arquivo) Teste de integração em `tests/integration/core/prompts.test.ts`: agente falso ocupado (`/busy 500`), dois itens na fila, despacho em ociosidades sucessivas
- [X] T025 [P] [US3] Testes em `tests/unit/renderer/Tree.test.tsx`: selo "N na fila"; menu ver/limpar fila; aviso "N itens descartados" ao receber `queueDiscarded`
- [X] T026 [P] [US3] Testes em `tests/unit/renderer/RemoveFromListDialog.test.tsx`: remover workspace com prompts no escopo dele mostra "N prompts deste workspace serão removidos" (via `countForGroup`)

### Implementação

- [X] T027 [US3] (depende de T006, T013, T022) `src/core/prompts/prompt-queue.ts`
- [X] T028 [US3] (depende de T027) `onIdle(fn)` e `onEnded(fn)` em `src/core/execution/execution-service.ts` (a partir do `BusyTracker` e dos eventos de saída e remoção), ligação da fila e despacho na abertura em `src/main/main.ts`
- [X] T029 [US3] (depende de T014, T023, T027) Canais `queue.*` e evento `queueDiscarded` em `src/main/ipc/register-prompts.ts` e `validate-prompts.ts`
- [X] T030 [US3] (depende de T021, T029) Opção "enfileirar" em `src/renderer/components/Prompts/UsePromptDialog.tsx`
- [X] T031 [US3] (depende de T025, T029) Selo, menu da fila e aviso de descarte em `src/renderer/components/Tree/TreeExecution.tsx`
- [X] T032 [US3] (depende de T026, T014) Contagem de prompts na confirmação de `src/renderer/components/RemoveFromListDialog.tsx`

## Phase 6: Polish

- [X] T033 [P] e2e em `tests/e2e/prompts.spec.ts`: criar prompt com variável, enviar para duas sessões do agente falso
- [X] T034 [P] [simples] `README.md` (funcionalidades)

## Dependencies & Execution Order

- Setup → Foundational (T002–T006) → US1 → US2; US3 depende de Foundational, T013 e T014.
- Arquivos compartilhados (sem `[P]` entre si): `UsePromptDialog.test.tsx` (T011 → T019), `tests/integration/core/prompts.test.ts` (T018 → T020 → T024), `register-prompts.test.ts` (T009 → T023), `UsePromptDialog.tsx` (T016 → T021 → T030), `register-prompts.ts` (T014 → T029).

## Parallel Examples

- Foundational: T002 ∥ T003 ∥ T004.
- US1: T007 ∥ T008 ∥ T009 ∥ T010 ∥ T011.
- US3: T022 ∥ T025 ∥ T026.

## Implementation Strategy

Foundational → US1 (MVP: biblioteca) → US2 → US3 → Polish.
