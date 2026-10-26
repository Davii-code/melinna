# Tasks: Configurações de execução e edição de código no estilo de IDE

**Input**: `specs/009-execucao-e-editor/` (plan.md, spec.md, research.md, data-model.md, contracts/ipc.md, contracts/ui.md, quickstart.md)

> **Gate do contrato (constitution VII)** — **aprovado em 2026-10-26** (pacotes A, B, C e D). Registro original: as tasks de cada pacote só começam depois que o dono do
> projeto aprovar o pacote correspondente, na seção "Aprovação do contrato" do [plan.md](plan.md):
> **A** (execução) T004, T007–T013, T029–T031; **B** (busca no projeto) T046–T049; **C** (git) T063;
> **D** (layout) T066. As demais (testes escritos antes, Setup e editor sem canal novo) não dependem
> da aprovação.

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

## Phase 1: Setup

- [X] T001 [simples] Ações novas em `src/renderer/keymap/keymaps.ts` (`goToLine`, `goToSymbol`, `selectNextOccurrence`, `unselectLastOccurrence`, `findInProject`, `replaceInFile`, `toggleComment`, `reindent`, `reopenClosedTab`, `splitRight`) com as teclas da tabela de `contracts/ui.md` (`splitRight` só no mapa vscode) e os rótulos do diálogo de atalhos; testes em `tests/unit/renderer/keymaps.test.ts` (tecla certa por mapa; nenhum conflito com as ações existentes de cada mapa)
- [X] T002 Ações de editor só com um editor em foco em `src/renderer/keymap/use-shortcuts.ts` (com o terminal em foco a tecla segue para o PTY e `preventDefault` não é chamado); testes em `tests/unit/renderer/use-shortcuts.test.tsx`

## Phase 2: Foundational (pacote A)

- [X] T003 [P] Testes da migração em `tests/unit/core/persistence/state-migration-v4.test.ts`: esquema 3 com `Group.commands` vira esquema 4 com `Group.runConfigs` (`tool: 'program'`, `script: null`, mesmos `id`/`program`/`args`/`folder`, `name = label`, `runtimeOptions: ''`, `env: []`, `beforeLaunch: null`, `allowParallel: false`, `folderGroup: null`, `order` pela posição); grupo sem `commands` vira `runConfigs: []`; cópia `state.v3.bak` gravada antes do estado 4; estado de esquema 5 recusado sem sobrescrever; id ativo preservado
- [X] T004 (depende de T003) Tipos `RunConfig`, `RunConfigInput`, `RunConfigView` e erros novos em `src/core/run/types.ts` (limites do data-model: nome "1–80 caracteres, único no workspace (sem diferenciar maiúsculas)", `runtimeOptions` "até 1.000 caracteres", `env` "até 100 pares; nome `[A-Za-z_][A-Za-z0-9_]*`, único sem diferenciar maiúsculas; valor até 8.000 caracteres", `folderGroup` "1–60 caracteres"); `STATE_SCHEMA_VERSION = 4`, `migrateRunConfigs` e a cópia `.bak` em `src/core/persistence/state-schema.ts`
- [X] T005 [P] Testes em `tests/unit/core/run/run-configs.test.ts`: nome vazio, longo e repetido (sem diferenciar maiúsculas); cópia com "(cópia)", "(cópia 2)"; pasta fora do workspace; script fora dos detectados da pasta; nome de variável inválido (vazio, `=`, espaço) e repetido sem diferenciar maiúsculas (`Path`/`PATH`); limites de `env`, `args`, `runtimeOptions`; objetivos/tarefas viram vetor (espaço separa, aspas agrupam); `program` ignorado nas ferramentas e derivado pelo núcleo; alvo só `.cmd`/`.bat` → `unsafe-target`; `beforeLaunch` inexistente; ciclos (A→A, A→B→A, cadeia longa) com a cadeia em `details`; `removeConfig` de configuração viva → `RUN_CONFIG_RUNNING`; `reorder`; `toView` com `folder-missing`, `program-missing`, `script-missing`, `before-launch-missing`, `unsafe-target`
- [X] T006 [P] Testes em `tests/unit/core/run/run-env.test.ts`: base → variáveis da configuração (vencem, comparando nomes sem diferenciar maiúsculas) → `runtimeOptions` acrescentado ao fim de `NODE_OPTIONS`/`MAVEN_OPTS`/`GRADLE_OPTS` com espaço, inclusive quando a variável vem da própria configuração; nada em compose/program; `envNames` só nomes
- [X] T007 (depende de T004, T005) `src/core/run/run-configs.ts` (substitui `custom-commands.ts`: `saveConfig`, `removeConfig`, `reorder`, `toView`, tokenização dos objetivos, derivação do programa pelo `resolve-program.ts`) e `src/core/run/before-launch.ts` (`chainOf` com ciclo por busca em profundidade)
- [X] T008 (depende de T004, T006) `src/core/run/run-env.ts` (`buildEnv`, `envNames`)
- [X] T009 [P] Testes em `tests/unit/main/ipc/register-run.test.ts` (reescrevendo os cenários de `saveCommand`/`removeCommand` para `saveConfig`/`removeConfig` sem enfraquecer asserts): `run:list` devolve `{ configs, detected }`; `run:saveConfig`, `run:removeConfig`, `run:reorder` com erros pt-BR; log `run.config.save` com quantidade de variáveis e sem valores
- [X] T010 (depende de T007) Assinaturas em `src/shared/ipc-contract.ts` e `src/preload/*` conforme `contracts/ipc.md` (alterado `run:list`; novos `run:saveConfig`, `run:removeConfig`, `run:reorder`; removidos `run:saveCommand`, `run:removeCommand`)
- [X] T011 (depende de T009, T010) Handlers em `src/main/ipc/register-run.ts`
- [X] T012 (depende de T010) [simples] `tests/support/fake-api.ts` com os canais novos e o `run:list` novo
- [X] T013 (depende de T011, T012) `src/renderer/store/run-store.ts` (`configs`, `detected`, `save`, `remove`, `reorder`, `addFromDetected`, ativa preservada); testes em `tests/unit/renderer/run-store.test.ts`

## Phase 3: User Story 1 — Janela de configurações de execução (P1) 🎯 MVP

**Goal**: criar, editar, copiar, remover, agrupar e ordenar configurações salvas, com Aplicar/OK/Cancelar.

**Independent Test**: criar a configuração do script `start` com `PORT=4000`, OK, reabrir o app e vê-la com a variável.

### Tests (escritos antes)

- [X] T014 [P] [US1] Testes em `tests/unit/renderer/RunConfigTree.test.tsx`: árvore `role="tree"` por ferramenta (`npm`, `Maven`, `Gradle`, `Compose`, `Programa`) e pasta; a ativa selecionada; `Adicionar configuração` (ferramenta ou script detectado), `Copiar configuração`, `Remover configuração` com confirmação que cita o nome e desabilitado quando roda, `Nova pasta`, arrastar para pasta e "Mover para pasta…" pelo menu da linha (teclado), `Ordenar` alfabético por grupo; navegação por setas
- [X] T015 [P] [US1] Testes em `tests/unit/renderer/RunConfigForm.test.tsx`: `Nome`, `Pasta` (só pastas do workspace), `Script` com os detectados da pasta, `Objetivos`/`Tarefas` com sugestões (`clean`, `install`, `test`, `spring-boot:run`; `build`, `test`, `bootRun`) e texto livre, `Programa` só na ferramenta programa, `Argumentos`, `Opções do runtime` com rótulo por ferramenta (oculto em compose/program), `Antes de lançar` (sem a própria), `Permitir várias instâncias`; validação junto do campo; aviso "Em execução — as mudanças valem no próximo lançamento"; cenários de criar/editar/validar migrados de `RunConfigDialog.test.tsx` (listados no topo do arquivo)
- [X] T016 [P] [US1] Testes em `tests/unit/renderer/EnvTable.test.tsx`: adicionar e remover; nome inválido e repetido (sem diferenciar maiúsculas) recusados; nomes com `TOKEN`, `PASSWORD`, `PASSWD`, `SECRET`, `KEY` ou `CREDENTIAL` mascarados com `Mostrar valor de <nome>` e o aviso de gravação local
- [X] T017 [P] [US1] Testes em `tests/unit/renderer/RunConfigsDialog.test.tsx`: `Aplicar` grava e mantém aberta; `OK` grava e fecha; `Cancelar` descarta perguntando se havia alteração; `Rodar` aplica e roda; ciclo recusado ao aplicar com a cadeia; fechar com alteração pendente pergunta; Esc e foco inicial; cenário de remover migrado de `RunConfigDialog.test.tsx`

### Implementação

- [X] T018 [US1] (depende de T013, T014) `src/renderer/components/Run/RunConfigTree.tsx`
- [X] T019 [US1] (depende de T013, T015) `src/renderer/components/Run/RunConfigForm.tsx`
- [X] T020 [US1] (depende de T016) `src/renderer/components/Run/EnvTable.tsx`
- [X] T021 [US1] (depende de T017, T018, T019, T020) `src/renderer/components/Run/RunConfigsDialog.tsx` montado em `RunBar.tsx`; remove `RunConfigDialog.tsx` e `tests/unit/renderer/RunConfigDialog.test.tsx` (cenários já migrados para T015 e T017)
- [X] T022 [US1] (depende de T021) CSS da janela, árvore, formulário e tabela de variáveis em `src/renderer/styles/app.css`
- [X] T023 [P] [US1] (depende de T021) e2e em `tests/e2e/run-configs.spec.ts`: criar a partir do script `start` com `PORT=4000`, OK, fechar e reabrir o app e ver a configuração

**Checkpoint**: configurações salvas e editáveis.

## Phase 4: User Story 2 — Seletor com as salvas e lançamento completo (P1)

**Goal**: seletor só com as salvas; ambiente, opções do runtime, antes de lançar e várias instâncias.

**Independent Test**: com 2 salvas e 10 detectados, o seletor mostra 2; rodar com `PORT=4000` e ver a variável no processo.

### Tests (escritos antes)

- [X] T024 [P] [US2] Testes em `tests/unit/core/run/run-service.test.ts` (acrescentando): `start` usa `buildEnv`; antes de lançar roda a etapa visível, espera o fim e segue só com código 0; código ≠ 0, cancelamento, etapa removida e etapa já rodando sem várias instâncias devolvem `RUN_BEFORE_LAUNCH_FAILED` com o motivo; confirmação da 007 (`RunNeedsConfirm`) por etapa antes de ela rodar, recusa cancela; `allowParallel` cria outra execução; teto de 12 recusa; `rerun` de configuração removida → `RUN_CONFIG_MISSING`; log `run.start` com `envNames` e sem valores
- [X] T025 [P] [US2] Testes em `tests/unit/renderer/RunSelector.test.tsx` (reescrito; os cenários de marcar ativa, rodando e atalhos da 007 são mantidos e listados no topo): só salvas agrupadas por ferramenta; vazio "Nenhuma configuração"; `Editar configurações…`; `Adicionar a partir de um script detectado…` cria, ativa e lista; "Aguardando <nome>…" com Cancelar durante o antes de lançar
- [X] T026 [P] [US2] Testes em `tests/unit/renderer/DetectedPicker.test.tsx`: scripts detectados do workspace ativo por pasta e ferramenta; escolher chama `addFromDetected`; Esc fecha
- [X] T027 [P] [US2] Integração em `tests/integration/core/run.test.ts` (acrescentando): processo real recebe a variável e `NODE_OPTIONS`; etapa que sai com 1 impede a principal; argumento `& calc` e aspas chegam literais ao processo, sem shell
- [X] T028 [P] [US2] Desempenho em `tests/perf/run-selector.perf.test.ts`: seletor com 50 configurações em < 200 ms

### Implementação

- [X] T029 [US2] (depende de T007, T008, T024) `src/core/run/run-service.ts`: ambiente, cadeia de antes de lançar com espera pela porta de estado das execuções e cancelamento, confirmação por etapa, `allowParallel`, logs
- [X] T030 [P] [US2] Testes em `tests/unit/main/ipc/register-run.test.ts` (acrescentando): `run:start` com `configId`, erros de antes de lançar, `run:rerun` com `RUN_CONFIG_MISSING`
- [X] T031 [US2] (depende de T029, T030) `run:start`/`run:rerun` em `src/shared/ipc-contract.ts`, `src/preload/*`, `src/main/ipc/register-run.ts` e `tests/support/fake-api.ts`
- [X] T032 [US2] (depende de T026) [simples] `src/renderer/components/Run/DetectedPicker.tsx`
- [X] T033 [US2] (depende de T013, T025, T031, T032) `src/renderer/components/Run/RunSelector.tsx` e `RunBar.tsx`: só salvas, as duas ações e o estado de espera do antes de lançar
- [X] T034 [US2] (depende de T033) [simples] CSS do seletor e do `DetectedPicker` em `src/renderer/styles/app.css`
- [X] T035 [US2] (depende de T033) e2e em `tests/e2e/run-configs.spec.ts` (acrescentando): rodar com `PORT=4000` e ver a porta no terminal; antes de lançar com etapa que falha impede a principal

**Checkpoint**: frente A completa.

## Phase 5: User Story 3 — Navegar e editar código com produtividade (P2)

**Goal**: ir para linha, estrutura, próxima ocorrência e multicursor, busca no projeto, substituir no arquivo, abas, comentar e reindentar, no comportamento do IntelliJ (research R1).

**Independent Test**: linha 120, ir para uma função, três ocorrências editadas juntas, busca no projeto abrindo o resultado na linha.

### Tests (escritos antes)

- [X] T036 [P] [US3] Testes em `tests/unit/renderer/editor-goto-line.test.ts`: `120` e `120:5` posicionam e centralizam; fora do arquivo vai à última; entrada inválida mostra a mensagem; Esc fecha e devolve o foco ao editor
- [X] T037 [P] [US3] Testes em `tests/unit/renderer/editor-structure.test.ts`: TypeScript (funções, classes, métodos), JSON (chaves de 1º e 2º nível), CSS (seletores), HTML (elementos com id), Markdown (títulos); texto puro "Nenhum símbolo neste arquivo"; filtro ao digitar; Esc fecha
- [X] T038 [P] [US3] Testes em `tests/unit/renderer/editor-occurrences.test.ts`: próxima ocorrência adiciona cursores; desfazer a última; digitar vale em todos; Esc volta a um cursor; desfazer único; cursor a mais por seta e por clique com o modificador
- [X] T039 [P] [US3] Testes em `tests/unit/core/files/search.test.ts` (com a porta de sistema de arquivos em memória): texto, maiúsculas, palavra inteira, regex, inclusão/exclusão; exclusões de `.git/`, ignorados, binários e > 2 MB; UTF-8 com e sem BOM e UTF-16 com BOM; não segue links; sem permissão pulado e contado; para em 2.000 com `truncated`; regex inválida `SEARCH_REGEX_INVALID`
- [X] T040 [P] [US3] Testes em `tests/unit/main/search-worker.test.ts`: busca no worker devolve os resultados; cancelamento encerra o worker (`SEARCH_CANCELLED`); regex catastrófica é cortada pelo tempo (`SEARCH_TIMEOUT`) enquanto o principal continua respondendo; busca nova cancela a anterior; raízes fora do workspace recusadas; log sem o texto buscado
- [X] T041 [P] [US3] Testes em `tests/unit/main/ipc/register-files.test.ts` (acrescentando): `files:searchProject` com resultado e erros
- [X] T042 [P] [US3] Testes em `tests/unit/renderer/ProjectSearch.test.tsx`: opções, "Buscando…" com Cancelar, resultados agrupados por arquivo com linha e trecho, prévia, clicar abre na linha com a ocorrência destacada, aviso de resultados demais, erro de regex junto do campo, Esc cancela e fecha
- [X] T043 [P] [US3] Testes em `tests/unit/renderer/EditorPane-tabs.test.tsx`: fechar outras e fechar todas perguntam pelos não salvos (uma pergunta só com "Salvar todos", "Descartar todos", "Cancelar"); "Salvar todos" grava arquivo por arquivo com o hash esperado e reporta conflito; reabrir aba fechada na mesma posição; pilha de até 20
- [X] T044 [P] [US3] Testes em `tests/unit/renderer/CodeEditor-commands.test.tsx`: substituir no arquivo, comentar/descomentar e reindentar deixam a aba não salva e não chamam `files.write`
- [X] T045 [P] [US3] Desempenho em `tests/perf/editor-navigation.perf.test.ts` (ir para linha e estrutura em 10.000 linhas < 100 ms) e `tests/perf/project-search.perf.test.ts` (primeiros resultados em 20.000 arquivos < 2 s)

### Implementação

- [X] T046 [US3] (depende de T039) `src/core/files/search.ts` pela porta de sistema de arquivos do núcleo
- [X] T047 [US3] (depende de T040, T046) `src/main/search-worker.ts` (worker, tempo de 10 s, `terminate()` ao cancelar, validação das raízes)
- [X] T048 [US3] (depende de T041, T047) Canal `files:searchProject` em `src/shared/ipc-contract.ts`, `src/preload/*`, `src/main/ipc/register-files.ts` e `tests/support/fake-api.ts`
- [X] T049 [US3] (depende de T042, T048) `src/renderer/components/Search/ProjectSearch.tsx` com a abertura na linha via `layoutStore.openDoc`
- [X] T050 [US3] (depende de T001, T036) `src/renderer/components/Editor/extensions/goto-line.ts` e o popup "Ir para linha"
- [X] T051 [US3] (depende de T037) `src/renderer/components/Editor/extensions/structure.ts` e o popup "Estrutura do arquivo"
- [X] T052 [US3] (depende de T038) `src/renderer/components/Editor/extensions/occurrences.ts`
- [X] T053 [US3] (depende de T043) Menu da aba, pilha de abas fechadas e "Salvar todos" em `src/renderer/components/Editor/EditorPane.tsx`
- [X] T054 [US3] (depende de T002, T044, T050, T051, T052) Extensões e comandos (`toggleComment`, `indentSelection`, substituir) montados em `src/renderer/components/Editor/CodeEditor.tsx`
- [X] T055 [US3] (depende de T049, T054) Popups "Ir para linha", "Estrutura do arquivo" e "Buscar no projeto" e as ações do mapa ligadas em `src/renderer/App.tsx`
- [X] T056 [US3] (depende de T055) CSS dos popups, da busca e do menu da aba em `src/renderer/styles/app.css`
- [X] T057 [P] [US3] (depende de T055) e2e em `tests/e2e/editor.spec.ts`: ir para linha, estrutura, próxima ocorrência, busca no projeto abrindo o resultado

## Phase 6: User Story 4 — Editor dividido e alterações do git na margem (P3)

**Goal**: dois editores com o mesmo arquivo sincronizado e marcas do git na margem com reverter trecho.

**Independent Test**: alterar e apagar linhas num arquivo git e ver as marcas; dividir à direita e editar nos dois lados; salvar uma vez.

### Tests (escritos antes)

- [X] T058 [P] [US4] Testes em `tests/unit/renderer/line-diff.test.ts`: adicionadas, alteradas, removidas no início, meio e fim; iguais; CRLF × LF não marca; limite de 5.000 linhas alteradas devolve "desligado"
- [X] T059 [P] [US4] Testes em `tests/unit/renderer/editor-git-gutter.test.tsx`: marcas com `aria-label` por tipo; atualização ao editar (150 ms); clique mostra o original e "Reverter este trecho" muda só o texto da aba; `HEAD` relido no foco e quando o `head` do `status` muda; fora de git, não rastreado, binário ou > 2 MB sem marcas e sem erro, com a dica no caso grande
- [X] T060 [P] [US4] Testes em `tests/unit/core/git/file-at-head.test.ts`, `tests/unit/main/ipc/register-git.test.ts` (acrescentando) e `tests/integration/core/git.test.ts` (acrescentando): texto ou `{ missing: true }`; caminho relativo à raiz do repositório com `/` (repo diferente da pasta do workspace); fora da raiz `FILE_OUTSIDE_ROOT`; `--no-optional-locks`; > 2 MB e binário → `missing`
- [X] T061 [P] [US4] Testes em `tests/unit/renderer/editor-split.test.tsx` e `tests/unit/renderer/layout-store.test.ts` (acrescentando): `splitDoc` cria outro painel com o mesmo caminho (direita e abaixo) e `openDoc` continua reaproveitando; estado com o mesmo caminho em dois painéis carrega e é podado corretamente; edição de um lado aparece no outro; aba não salva nos dois; salvar grava uma vez; conflito da 002 aparece uma vez
- [X] T062 [P] [US4] Desempenho em `tests/perf/line-diff.perf.test.ts`: diff de 5.000 linhas < 500 ms; edição incremental < 100 ms

### Implementação

- [X] T063 [US4] (depende de T060) `fileAtHead` em `src/core/git/` e canal `git:fileAtHead` em `src/shared/ipc-contract.ts`, `src/preload/*`, `src/main/ipc/register-git.ts` e `tests/support/fake-api.ts`
- [X] T064 [US4] (depende de T058) `src/renderer/components/Editor/line-diff.ts`
- [X] T065 [US4] (depende de T059, T063, T064) `src/renderer/components/Editor/extensions/git-gutter.ts` montada em `CodeEditor.tsx`
- [X] T066 [US4] (depende de T061) `splitDoc` em `src/renderer/store/layout-store.ts`
- [X] T067 [US4] (depende de T066) `src/renderer/components/Editor/shared-doc.ts`, rascunho por caminho em `EditorPane.tsx` e "Dividir à direita/abaixo" no menu da aba
- [X] T068 [US4] (depende de T065, T067) CSS da margem do git, do popup do original e do editor dividido em `src/renderer/styles/app.css`
- [X] T069 [P] [US4] (depende de T068) e2e em `tests/e2e/editor.spec.ts` (acrescentando): dividir à direita, editar dos dois lados, margem do git, reverter trecho, salvar uma vez e conferir o disco

## Phase 7: Polish

- [X] T070 Teste transversal em `tests/unit/renderer/no-write-without-save.test.tsx` (SC-007): com o `App` montado e o `fakeApi`, substituir, reindentar, comentar, "Reverter este trecho", editar no editor dividido, "Fechar todas" com "Descartar todos" e abrir resultado da busca nunca chamam `files.write`; só "Salvar" e "Salvar todos" chamam, sempre com o hash esperado
- [X] T071 [simples] (depende de T069) `README.md`: linhas de "Rodar o projeto" (configurações salvas) e "Editor" (comportamento do IntelliJ e as ações novas)

## Dependencies & Execution Order

- Setup → Foundational (após a aprovação do pacote A) → US1 → US2 → US3 → US4 → Polish.
- US3 depende só de T001/T002, exceto a busca no projeto (pacote B). US4 depende dos pacotes C e D.
- Arquivos compartilhados (sem `[P]` entre si): `app.css` (T022 → T034 → T056 → T068), `register-run.ts` (T011 → T031), `ipc-contract.ts` (T010 → T031 → T048 → T063), `fake-api.ts` (T012 → T031 → T048 → T063), `CodeEditor.tsx` (T054 → T065), `EditorPane.tsx` (T053 → T067), `tests/e2e/run-configs.spec.ts` (T023 → T035), `tests/e2e/editor.spec.ts` (T057 → T069).

## Parallel Examples

- Foundational: T003 ∥ T005 ∥ T006 ∥ T009.
- US1: T014 ∥ T015 ∥ T016 ∥ T017. US2: T024 ∥ T025 ∥ T026 ∥ T027 ∥ T028.
- US3: T036 ∥ T037 ∥ T038 ∥ T039 ∥ T040 ∥ T041 ∥ T042 ∥ T043 ∥ T044 ∥ T045. US4: T058 ∥ T059 ∥ T060 ∥ T061 ∥ T062.

## Implementation Strategy

MVP = Foundational + US1 → US2 (fecha a frente A) → US3 (pode começar junto com A, exceto a busca) → US4 → Polish.
