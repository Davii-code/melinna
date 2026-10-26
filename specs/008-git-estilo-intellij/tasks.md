# Tasks: Interface de git no estilo do IntelliJ

**Input**: `specs/008-git-estilo-intellij/` (plan.md, spec.md, research.md, data-model.md, contracts/ui.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

## Phase 1: Setup

- [X] T001 [simples] Preferências em `src/renderer/prefs.ts`: `storedSidebarPanel`/`storeSidebarPanel` e `storedActiveWorkspace`/`storeActiveWorkspace` no padrão de `SidebarResizer.tsx` (storage injetável, `try/catch`, padrão quando inválido ou indisponível), com testes em `tests/unit/renderer/prefs.test.ts`

## Phase 2: Foundational

- [X] T002 [P] Testes em `tests/unit/renderer/git/git-store.test.ts`: `buildChangeTree` (grupos "Changes" e "Unversioned Files", um nó por repo com contagem e branch, pastas aninhadas, renomeado no caminho novo, repo sem alterações só com mais de um repo); `checkState` parcial em pasta, repo e grupo; `toggle` em cada nível; `initialSelection` (alterados marcados, não rastreados desmarcados); `mergeSelection` mantém marcas que continuam e aplica a regra inicial aos novos; `planCommit` (só repos com marcados; repo em merge com seleção parcial recusado com a mensagem da 006; repo com conflito recusado)
- [X] T003 [P] Testes em `tests/unit/renderer/git/sequence.test.ts`: `commitAll` em ordem, mesma mensagem, para no primeiro erro mantendo os já feitos, devolve resultado por repo; `needsConfirm` (amend publicado) pausa até a resposta; `commitAndPush` não faz nenhum push quando algum commit falhou; `pushAll` um por vez, `needsConfirm` por repo com aceitar (repete com a confirmação acumulada) e recusar (pula e segue); `fetchAll`/`pullAll` em sequência com resultado por repo
- [X] T004 (depende de T002) `src/renderer/git/git-store.ts`
- [X] T005 (depende de T003) `src/renderer/git/sequence.ts`
- [X] T006 [P] Testes em `tests/unit/renderer/git/git-workspace.test.tsx`: `GitWorkspaceProvider` carrega o status das pastas do workspace ativo em paralelo (todas as chamadas antes da primeira resposta); ignora `REPO_INVALID` e pastas indisponíveis; uma só releitura por `focus` mesmo com dois consumidores; adota operação pelo `opId` com evento que chega antes do `opId`; relê ao `done`; `busy` verdadeiro durante uma sequência e troca de workspace bloqueada enquanto isso; troca de workspace descarta o estado do anterior
- [X] T007 (depende de T004, T006) `src/renderer/git/git-workspace.tsx` (provider + hook `useGitWorkspace`; buffer de eventos antecipados movido da `GitBar` da 006)
- [X] T008 [P] Testes em `tests/unit/renderer/ToolStrip.test.tsx`: ícones Workspaces, Arquivos e Commit com nome e atalho na dica; clicar troca o painel e chama `onSelect`; o ícone ativo destacado (`aria-pressed`)
- [X] T009 (depende de T008) `src/renderer/components/Layout/ToolStrip.tsx` (ícones SVG próprios) montada em `src/renderer/App.tsx` no lugar das abas "Workspaces"/"Arquivos" do cabeçalho da barra lateral, com o painel `commit` vazio por enquanto

## Phase 3: User Story 1 — Painel de Commit fixo (P1) 🎯 MVP

**Goal**: painel lateral Commit com a árvore por repositório, diff ao lado e commit em vários repositórios.

**Independent Test**: workspace com duas pastas git; ícone Commit; marcar um arquivo de cada e commitar; cada repo ganha um commit só com o seu arquivo.

### Tests (escritos antes)

- [X] T010 [P] [US1] Testes em `tests/unit/renderer/ChangeTree.test.tsx`: `role="tree"`/`treeitem`, expandir e recolher (um nó e tudo), caixas com estado parcial (`indeterminate`), tipo de alteração por arquivo, clique chama `onShowDiff`, duplo clique chama `onOpenFile` com caminho absoluto e não faz nada em arquivo removido (dica "arquivo removido"), só as linhas visíveis renderizadas com 5.000 arquivos
- [X] T011 [P] [US1] Testes em `tests/unit/renderer/DiffPane.test.tsx`: mostra o diff (`git.diffFile`) com o caminho no título; binário e "grande demais"; "Fechar diff" volta à grade; erro do diff mostrado
- [X] T012 [P] [US1] Testes em `tests/unit/renderer/CommitPanel-actions.test.tsx`: barra de ações Atualizar, Ver diff, Expandir/Recolher tudo; Reverter dos marcados com a confirmação `discard` por arquivo (não rastreados marcados aparecem com "apagar"), recusar não muda nada; aviso de agente vivo; estados vazios ("Nenhuma alteração", "Nenhum repositório git neste workspace", "Abra um workspace"); relê ao ganhar foco mantendo marcas
- [X] T013 [P] [US1] Testes em `tests/unit/renderer/CommitPanel-commit.test.tsx`: "Changes" e "Unversioned Files" com contagens e branch por repo; não rastreados desmarcados; "Commit" desabilitado sem marcados ou sem mensagem, com a dica; um clique em "Commit" commita dois repos em sequência com a mesma mensagem e limpa a mensagem; falha no segundo mostra o repo e o motivo e preserva a mensagem; "Commit and Push…" chama `push` por repo com `push-main` por repo, recusa que pula, e nenhum push quando um commit falhou; Amend carrega a última mensagem, vale para os repos marcados e pede o repo quando há vários sem marcados; confirmação `amend-published`
- [X] T014 [P] [US1] Testes em `tests/unit/renderer/CommitPanel-merge.test.tsx`: repo em merge mostra "merge em andamento" e os conflitos; "Abrir no editor" com caminho absoluto (`/` e `\`); "Marcar como resolvido" (`git.markResolved`) relê; "Abortar merge" só depois da confirmação `abort-merge`; commit do repo em merge exige todos os arquivos e sugere a mensagem do merge
- [X] T015 [P] [US1] Desempenho em `tests/perf/change-tree.test.ts`: montar a árvore de 3 repos com 500 arquivos e marcar/desmarcar o grupo em < 200 ms

### Implementação

- [X] T016 [US1] (depende de T004, T010) `src/renderer/components/Git/ChangeTree.tsx`
- [X] T017 [US1] (depende de T011) `src/renderer/components/Git/DiffPane.tsx` (reaproveita `FileSection`)
- [X] T018 [US1] (depende de T007, T012, T016) `src/renderer/components/Git/CommitPanel.tsx`: estrutura, barra de ações, reverter, aviso de agente e estados vazios
- [X] T019 [US1] (depende de T005, T013, T018) `src/renderer/components/Git/CommitMessage.tsx`: Amend, mensagem, "Commit", "Commit and Push…" e resultado por repositório, montada no `CommitPanel`
- [X] T020 [US1] (depende de T014, T018) `src/renderer/components/Git/MergeConflicts.tsx`: conflitos e abortar merge por repositório (lógica da `ConflictList` da 006), montada no `CommitPanel`
- [X] T021 [US1] (depende de T009, T017, T019, T020) Estado em `src/renderer/App.tsx`: `GitWorkspaceProvider`, painel `commit` com o `CommitPanel`, `DiffPane` sobre a grade e duplo clique abrindo no editor
- [X] T022 [US1] (depende de T021) CSS do painel Commit, da árvore e do `DiffPane` em `src/renderer/styles/app.css`

**Checkpoint**: commit em vários repositórios pelo painel funciona.

## Phase 4: User Story 2 — Barra superior com workspace ativo e branch (P1)

**Goal**: seletor de workspace ativo e menu da branch com todas as ações de git que estavam na `GitBar`.

**Independent Test**: criar branch e fazer push pelo menu num workspace de uma pasta; ver as duas branches num workspace de duas pastas.

### Tests (escritos antes)

- [X] T023 [P] [US2] Testes em `tests/unit/renderer/WorkspaceSwitcher.test.tsx`: lista os workspaces com ícone de iniciais e cor da faixa; escolher grava em `localStorage`; workspace guardado que sumiu cai no primeiro; desabilitado com a dica durante uma sequência de commit ou push; sem workspaces não aparece
- [X] T024 [P] [US2] Testes em `tests/unit/renderer/BranchMenu-branches.test.tsx`: branch do repo principal, "HEAD solto em <sha>", ↑/↓ só com upstream, "+N" com vários repos, "Sem git" desabilitado; menu por repo com branch e ↑/↓; Nova branch (regra de nome e erro do git); Trocar com `checkout-dirty`; Mesclar com `merge-dirty` e conflitos chamando `onConflicts`; rebase/cherry-pick desabilitam trocar/mesclar/pull com a instrução; Histórico abre a `HistoryView`; nome longo abreviado com o nome inteiro na dica
- [X] T025 [P] [US2] Testes em `tests/unit/renderer/BranchMenu-network.test.tsx`: Fetch/Pull/Push… com progresso e Cancelar na barra superior; confirmações `push-main`, `set-upstream` e `merge-dirty`; erro `GIT_AUTH` com orientação; "Fetch todos"/"Pull todos" só com vários repos, em sequência, com resultado por repo; pull com conflito chama `onConflicts`

### Implementação

- [X] T026 [US2] (depende de T001, T007, T023) `src/renderer/components/WorkspaceSwitcher.tsx`
- [X] T027 [US2] (depende de T007, T024) `src/renderer/components/Git/BranchMenu.tsx`: botão, menu por repositório, branches, trocar, mesclar, nova branch e histórico (lógica da `BranchPicker` da 006; `HistoryView` reaproveitada)
- [X] T028 [US2] (depende de T005, T025, T027) `src/renderer/components/Git/NetworkActions.tsx`: fetch/pull/push com progresso e cancelar, por repo e "todos", montada no `BranchMenu`
- [X] T029 [US2] (depende de T021, T026, T028) Seletores na `src/renderer/components/TopBar.tsx` e workspace ativo em `src/renderer/App.tsx`; conflitos do menu abrem o painel Commit
- [X] T030 [US2] (depende de T029) CSS da barra superior e do menu em `src/renderer/styles/app.css` (janela estreita esconde tagline e depois o nome)
- [X] T031 [US2] (depende de T029) Teste em `tests/unit/renderer/git-channels-coverage.test.tsx`: com `App` montado e o `fakeApi`, cada um dos 16 canais `git:*` e o evento `gitProgress` é alcançado por uma ação da nova interface, conforme a tabela de contracts/ui.md
- [X] T032 [US2] (depende de T031) Remover `Git/GitBar.tsx`, `Git/CommitDialog.tsx`, `Git/BranchPicker.tsx`, `Git/ConflictList.tsx` e a montagem da barra em `src/renderer/components/Tree/TreeGroup.tsx`; remover `GitBar.test.tsx`, `CommitDialog.test.tsx`, `BranchPicker.test.tsx` e `ConflictList.test.tsx`, cujos cenários foram reescritos em T012–T014 e T024–T025

## Phase 5: User Story 3 — Barra de ferramentas vertical completa (P2)

**Goal**: recolher pelo ícone, selo de alterações, painéis de baixo, atalhos e persistência.

**Independent Test**: alternar os painéis pelos ícones e pelos atalhos; clicar no ativo recolhe; reabrir volta igual.

### Tests (escritos antes)

- [X] T033 [P] [US3] Testes em `tests/unit/renderer/ToolStrip.test.tsx` (mesmo arquivo de T008, acrescentando): clicar no ativo recolhe e de novo expande; selo com a quantidade de alterações no Commit; Biblioteca de prompts e Catálogo embaixo chamam as ações
- [X] T034 [P] [US3] Testes em `tests/unit/renderer/App-panels.test.tsx`: Alt+0/Alt+1/Alt+2 trocam o painel com o foco fora do terminal; com o terminal em foco a tecla segue para o terminal e o painel não muda; painel e recolhimento voltam do `localStorage` ao montar (e o padrão quando o valor é inválido)

### Implementação

- [X] T035 [US3] (depende de T009, T033) Recolher, selo e ícones de baixo em `src/renderer/components/Layout/ToolStrip.tsx`
- [X] T036 [US3] (depende de T001, T029, T034, T035) Em `src/renderer/App.tsx`: `ToolStrip` no lugar do `SidebarRail`, persistência do painel, atalhos Alt+0/1/2 no listener de janela existente, ignorados com o foco no terminal; CSS em `src/renderer/styles/app.css`

## Phase 6: Polish

- [X] T037 [P] e2e em `tests/e2e/git-intellij.spec.ts`: workspace de duas pastas git com remotos `--bare`; um clique em Commit commita um arquivo de cada pelo painel; push pelo menu da branch com a confirmação da main; substitui `tests/e2e/git.spec.ts` da 006
- [X] T038 [simples] (depende de T036) `README.md`: linha "Git na interface" descrevendo o painel Commit, o menu da branch e a barra vertical

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2 → US3 → Polish.
- Arquivos compartilhados (sem `[P]` entre si): `App.tsx` (T009 → T021 → T029 → T036), `app.css` (T022 → T030 → T036), `ToolStrip.tsx` e o teste dela (T008/T009 → T033/T035).
- A `GitBar` (T032) só sai depois que T031 prova que os 16 canais têm acesso na nova interface.

## Parallel Examples

- Foundational: T002 ∥ T003 ∥ T006 ∥ T008.
- US1: T010 ∥ T011 ∥ T012 ∥ T013 ∥ T014 ∥ T015. US2: T023 ∥ T024 ∥ T025. US3: T033 ∥ T034.

## Implementation Strategy

Foundational (com o acesso mínimo pela barra vertical) → US1 (MVP: painel Commit) → US2 (menu da branch; remove a `GitBar`) → US3 → Polish.
