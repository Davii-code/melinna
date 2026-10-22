# Tasks: Git na interface, no estilo do IntelliJ

**Input**: `specs/006-git-na-interface/` (plan.md, spec.md, data-model.md, contracts/ipc.md, research.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

## Phase 1: Setup

- [ ] T001 [simples] Helper `tests/support/git-remote-fixture.ts`: repositório com remoto `--bare` local e um segundo clone, em pasta temporária, reaproveitando `tests/support/git-fixture.ts`

## Phase 2: Foundational

- [ ] T002 [P] Testes em `tests/unit/core/git/status-v2.test.ts`: `# branch.*` com e sem upstream (`ahead`/`behind` null), detached; `1` alterado; `2` renomeado com `oldPath`; `u` conflito; `?` novo dentro de pasta nova (arquivo listado, não a pasta); `indexChanged`/`worktreeChanged`; caminhos com espaço e acento
- [ ] T003 [P] Testes em `tests/unit/core/git/log-parse.test.ts`: separadores `\x1f`/`\x1e`, corpo com várias linhas, `--name-status -z` com renomeado
- [ ] T004 [P] Testes em `tests/unit/core/git/git-errors.test.ts`: escolhe a linha `fatal:`/`error:` e ignora avisos (`LF will be replaced`); `Authentication failed`/`could not read Username` → `GIT_AUTH`; `[rejected]`/`fetch first` → `GIT_REJECTED`; `Please tell me who you are` → `GIT_IDENTITY`; hook → `GIT_HOOK_FAILED`; `index.lock` → `GIT_LOCKED`; outros → `GIT_FAILED`; `https://user:token@host` vira `https://***@host`
- [ ] T005 (depende de T002) `src/core/git/status-v2.ts`
- [ ] T006 (depende de T003) `src/core/git/log-parse.ts`
- [ ] T007 (depende de T004) `src/core/git/git-errors.ts` e códigos `GIT_AUTH`, `GIT_REJECTED`, `GIT_IDENTITY`, `GIT_HOOK_FAILED`, `GIT_LOCKED`, `GIT_FAILED` com as mensagens de contracts/ipc.md em `src/core/errors.ts`, com teste em `tests/unit/core/errors.test.ts`
- [ ] T008 (depende de T005; sessão principal — muda contrato público) Tipos `RepoStatus`, `Change`, `Branch`, `Commit`, `Confirm`, `NeedsConfirm`, `OpStarted` e o grupo `git` em `src/shared/ipc-contract.ts`; `CONTRACT` em `tests/unit/preload/preload.test.ts`; mocks em `tests/support/fake-api.ts`; evento `gitProgress` em `src/preload/preload.ts`

## Phase 3: User Story 1 — Commitar pela janela (P1) 🎯 MVP

**Goal**: commitar só os arquivos marcados, com mensagem, amend, descarte confirmado e aviso de agente vivo.

**Independent Test**: três arquivos alterados; commitar dois; o commit tem só os dois.

### Tests (escritos antes)

- [ ] T009 [P] [US1] (depende de T001) Integração em `tests/integration/core/git/commit.test.ts`: commit de dois de três arquivos (o terceiro continua alterado); renomeado inclui `oldPath` (commit sem sobra do antigo); arquivo novo em pasta nova; mensagem com várias linhas e acentos via `-F` com temporário em `os.tmpdir()` apagado depois; lista vazia sem amend e mensagem vazia → `INPUT_INVALID`; caminho `:(glob)*` tratado como literal; em falha (hook que recusa → `GIT_HOOK_FAILED`; identidade ausente → `GIT_IDENTITY`) o índice volta ao estado anterior; `index.lock` presente → `GIT_LOCKED`; operações concorrentes no mesmo repo serializadas; log `git.op` sem mensagem
- [ ] T010 [P] [US1] (depende de T001) Integração em `tests/integration/core/git/amend-discard.test.ts`: amend local com paths e só mensagem (paths vazio); amend de commit no upstream (`merge-base --is-ancestor HEAD @{u}`) → `needsConfirm: 'amend-published'`, confirmado refaz sem push; `discard` sem confirmação → `needsConfirm: 'discard'` com ação por arquivo (`apagar` para novo, `reverter` para alterado/removido, renomeado restaura o antigo e apaga o novo); confirmado executa
- [ ] T011 [P] [US1] (depende de T001) Desempenho em `tests/integration/core/git/status-perf.test.ts`: `status` com 500 arquivos alterados em < 2 s
- [ ] T012 [P] [US1] Testes do IPC em `tests/unit/main/ipc/register-git.test.ts`: `status`, `diffFile`, `commit`, `discard`; `repo` fora das raízes registradas recusado; `paths` relativos sem `..`, `-` inicial nem controle, 0–5.000 (0 só com amend); `message` 1–20.000
- [ ] T013 [P] [US1] Testes em `tests/unit/renderer/CommitDialog.test.tsx`: agrupado por pasta, todos marcados; seleção por arquivo e pasta; diff ao clicar (binário e "grande demais"); botões bloqueados sem seleção/mensagem; Amend; confirmação `amend-published` e `discard` com a ação por arquivo; aviso de agente vivo a partir do snapshot; "Commit and Push" chama `commit` e, com sucesso, `push`

### Implementação

- [ ] T014 [US1] (depende de T005, T007, T009, T010) `src/core/git/git-service.ts`: `status` (com `--untracked-files=all`, `state`, `mergeMessage`, `defaultRemoteBranch`, `lastFetchAt`), `diffFile`, `commit` (restauração do índice em falha; regra de merge), `discard` por tipo; `GIT_LITERAL_PATHSPECS=1`; `KeyedMutex` por repositório; log `git.op`
- [ ] T015 [US1] (depende de T008, T012, T014) `src/main/ipc/register-git.ts`, `src/main/ipc/validate-git.ts` (raízes registradas), registro em `src/main/ipc/register.ts`, montagem em `src/main/main.ts`
- [ ] T016 [US1] (depende de T013, T015) `src/renderer/components/Git/CommitDialog.tsx` (reaproveita `DiffView`) e `ConfirmGitDialog.tsx`
- [ ] T017 [US1] (depende de T016) Botão "Commit" do workspace em `src/renderer/components/Tree/TreeGroup.tsx` e CSS em `src/renderer/styles/app.css`

**Checkpoint**: commit pela interface funciona.

## Phase 4: User Story 2 — Sincronizar com o remoto (P1)

**Goal**: barra com branch e ↑/↓; fetch, pull e push com progresso, cancelamento e confirmações.

**Independent Test**: commit + push para o remoto `--bare`; commit no remoto + pull.

### Tests (escritos antes)

- [ ] T018 [P] [US2] (depende de T001) Integração em `tests/integration/core/git/network.test.ts`: `fetch` atualiza `behind` e `lastFetchAt`; `push` envia e zera `ahead`; push na `defaultRemoteBranch` (de `refs/remotes/origin/HEAD`, senão `main`/`master`) → `needsConfirm: 'push-main'`; sem upstream → `'set-upstream'` e, confirmado, `--set-upstream`; push rejeitado → `GIT_REJECTED`; `pull --no-rebase` integra; pull com árvore suja → `'merge-dirty'`; pull com conflito → evento final com `result.conflicts`; sem remoto → `hasRemote=false`
- [ ] T019 [P] [US2] (depende de T001) Integração em `tests/integration/core/git/network-failures.test.ts`: remoto HTTPS inválido com `GIT_TERMINAL_PROMPT=0` → `GIT_AUTH` sem travar (timeout curto); URL com credencial mascarada na mensagem e no log; cancelamento mata o processo; progresso com porcentagem
- [ ] T020 [US2] (depois de T012, mesmo arquivo) Testes do IPC `fetch`, `pull`, `push`, `cancel` e evento `gitProgress` em `tests/unit/main/ipc/register-git.test.ts`
- [ ] T021 [P] [US2] Testes em `tests/unit/renderer/GitBar.test.tsx`: branch, ↑/↓ (vazio sem upstream), último fetch, estado (merging, rebasing, cherry-picking com instrução de concluir fora, detached sem push); botões com progresso e cancelar; desabilitados sem remoto com explicação; confirmações `push-main`, `set-upstream`, `merge-dirty`; erro `GIT_AUTH` com orientação; relê o status ao ganhar foco; uma barra por pasta git do workspace e nenhuma para pasta sem git

### Implementação

- [ ] T022 [US2] (depende de T014, T018, T019) Rede em `src/core/git/git-service.ts`: `fetch`, `pull`, `push` com `--progress`, `GIT_TERMINAL_PROMPT=0`, `AbortSignal`, confirmações e resultado com conflitos
- [ ] T023 [US2] (depende de T015, T020, T022) Canais de rede, `cancel` e `gitProgress` em `src/main/ipc/register-git.ts` e `validate-git.ts`
- [ ] T024 [US2] (depende de T017, T021, T023) `src/renderer/components/Git/GitBar.tsx` sob o workspace em `src/renderer/components/Tree/TreeGroup.tsx`

## Phase 5: User Story 3 — Branches e merge (P2)

**Goal**: listar, criar, trocar e mesclar branches; resolver conflitos pelo editor; abortar com confirmação.

**Independent Test**: criar branch, commitar, voltar e mesclar; repetir com conflito e resolver.

### Tests (escritos antes)

- [ ] T025 [P] [US3] (depende de T001) Integração em `tests/integration/core/git/branches.test.ts`: `branches` locais e remotas com a atual; `createBranch` válido e inválido (`@{-1}`, `-x`, espaço); `checkout` de branch inexistente recusado; com pendências → `'checkout-dirty'` com os arquivos; branch remota sem local cria a local com tracking; git recusando a troca → erro com a mensagem
- [ ] T026 [P] [US3] (depende de T001) Integração em `tests/integration/core/git/merge.test.ts`: `merge` sem conflito; árvore suja → `'merge-dirty'`; com conflito → `conflicts[]`, `state='merging'` e `mergeMessage`; `markResolved`; commit parcial durante merge recusado e commit de todos funciona; `abortMerge` sem confirmação → `'abort-merge'`, confirmado volta ao estado anterior; merge, rebase e cherry-pick iniciados fora do app reconhecidos no `state`
- [ ] T027 [US3] (depois de T020, mesmo arquivo) Testes do IPC `branches`, `createBranch`, `checkout`, `merge`, `abortMerge`, `markResolved` em `tests/unit/main/ipc/register-git.test.ts`
- [ ] T028 [P] [US3] Testes em `tests/unit/renderer/BranchPicker.test.tsx`: lista e atual; nome inválido mostra a regra; confirmação de troca com pendências
- [ ] T029 [P] [US3] Testes em `tests/unit/renderer/ConflictList.test.tsx`: "Abrir no editor" abre o arquivo no editor do app; "Marcar como resolvido"; "Abortar merge" com confirmação; concluir abre a janela de commit com `mergeMessage`

### Implementação

- [ ] T030 [US3] (depende de T022, T025, T026) Branches, checkout, merge, abortMerge e markResolved em `src/core/git/git-service.ts`
- [ ] T031 [US3] (depende de T023, T027, T030) Canais em `src/main/ipc/register-git.ts` e `validate-git.ts` (branch precisa existir em `branches()`)
- [ ] T032 [US3] (depende de T024, T028, T031) `src/renderer/components/Git/BranchPicker.tsx` aberto pela branch na `GitBar`
- [ ] T033 [US3] (depende de T029, T031) `src/renderer/components/Git/ConflictList.tsx` ligado ao editor em `src/renderer/App.tsx`

## Phase 6: User Story 4 — Histórico (P3)

**Goal**: commits da branch com arquivos e diff por arquivo.

**Independent Test**: cinco commits; ver os cinco e o diff de um arquivo do terceiro.

- [ ] T034 [P] [US4] (depende de T001) Integração em `tests/integration/core/git/history.test.ts`: `log` com 200 por página e `skip`; `commitDiff` de um arquivo
- [ ] T035 [US4] (depois de T027, mesmo arquivo) Testes do IPC `log` e `commitDiff` em `tests/unit/main/ipc/register-git.test.ts`
- [ ] T036 [P] [US4] Testes em `tests/unit/renderer/HistoryView.test.tsx`: lista com autor, data e mensagem; carregar mais; diff do arquivo do commit
- [ ] T037 [US4] (depende de T030, T034, T035) `log` e `commitDiff` em `src/core/git/git-service.ts` e canais em `src/main/ipc/register-git.ts`
- [ ] T038 [US4] (depende de T024, T036, T037) `src/renderer/components/Git/HistoryView.tsx` aberto pela `GitBar`

## Phase 7: Polish

- [ ] T039 [P] e2e em `tests/e2e/git.spec.ts`: commit parcial e push para um remoto `--bare` local pela interface
- [ ] T040 [P] [simples] `README.md` (funcionalidades)

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2 → US3 → US4 → Polish.
- Arquivos compartilhados (sem `[P]` entre si): `register-git.test.ts` (T012 → T020 → T027 → T035), `git-service.ts` (T014 → T022 → T030 → T037), `register-git.ts` (T015 → T023 → T031 → T037), `TreeGroup.tsx` (T017 → T024).

## Parallel Examples

- Foundational: T002 ∥ T003 ∥ T004.
- US1: T009 ∥ T010 ∥ T011 ∥ T012 ∥ T013.
- US2: T018 ∥ T019 ∥ T021. US3: T025 ∥ T026 ∥ T028 ∥ T029.

## Implementation Strategy

Foundational → US1 + US2 (MVP: commit e push) → US3 → US4 → Polish.
