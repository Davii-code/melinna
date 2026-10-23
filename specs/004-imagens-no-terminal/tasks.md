# Tasks: Imagens no chat do terminal

**Input**: `specs/004-imagens-no-terminal/` (plan.md, spec.md, data-model.md, contracts/ipc.md, research.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

## Phase 1: Setup

- [X] T001 Verificação que decide o fluxo (bloqueia US1): nas versões instaladas do Claude Code, Gemini CLI e Codex CLI, conferir (a) o formato de referência de imagem no prompt interativo (caminho puro, aspas, `@caminho`) e (b) se o agente lê uma imagem **fora da pasta do projeto** (em `userData/attachments`) sem erro; se pede permissão, se `--add-dir` resolve. Entregável: tabela agente × versão × formato × lê fora do cwd em `specs/004-imagens-no-terminal/research.md` (R1) e, se algum agente não ler, a escolha da contingência registrada para aprovação do dono no plan.md

## Phase 2: Foundational

- [X] T002 [P] Testes em `tests/unit/core/attachments/image-format.test.ts`: assinaturas PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), GIF (`47 49 46 38`), WebP (`RIFF....WEBP`); desconhecido → `null`; `MAX_IMAGE_BYTES = 20 * 1024 * 1024`; `MAX_FILES = 20`; `formatImageRef` com `"{path}"` e `"@{path}"`, `quote` `always`/`when-needed`, aspas internas escapadas, caractere de controle recusado
- [X] T003 [P] Testes do schema em `tests/unit/core/catalog/images.test.ts`: `template` com `{path}` exatamente uma vez; `quote` só `always`/`when-needed`; inválido vira `CatalogIssue`
- [X] T004 (depende de T002) Criar `src/core/attachments/image-format.ts`
- [X] T005 [P] (depende de T003) `images?` em `src/core/catalog/schema.ts`
- [X] T006 [P] [simples] `attachmentsRoot` e `attachmentsDir(execId)` em `src/core/paths.ts`, com teste em `tests/unit/core/paths.test.ts`
- [X] T007 [simples] (depende de T004) Contrato: tipos `ImageRef` e grupo `attachments` (5 canais: `clipboardHasImage`, `pasteImage`, `checkFiles`, `pickImages`, `send`) em `src/shared/ipc-contract.ts`; `files.pathOf` em `src/preload/preload.ts`; `CONTRACT` em `tests/unit/preload/preload.test.ts`; mocks em `tests/support/fake-api.ts`

## Phase 3: User Story 1 — Colar imagem da área de transferência (P1) 🎯 MVP

**Goal**: Ctrl+V com imagem abre a prévia e "Enviar" escreve a referência no prompt sem Enter.

**Independent Test**: imagem na área de transferência, Ctrl+V no painel do agente falso (com `images`), "Enviar"; o eco mostra o caminho do anexo.

### Tests (escritos antes)

- [X] T008 [US1] Testes de `saveClipboardImage` em `tests/integration/core/attachments.test.ts` (adaptador real de FS, pasta temporária): grava `<timestamp>-<n>.png` em `attachmentsDir(execId)`; recusa formato desconhecido e acima de 20 MB sem gravar; logs `attachment.saved { execId, bytes, type }` e `attachment.rejected { reason }` sem conteúdo
- [X] T009 [P] [US1] Testes da miniatura em `tests/unit/main/thumbnail.test.ts`: lado maior ≤ 256 px, saída `data:image/png;base64,`, imagem menor não é ampliada
- [X] T010 [US1] Testes do IPC em `tests/unit/main/ipc/register-attachments.test.ts`: `clipboardHasImage` (imagem sem texto → true; com texto → false); `pasteImage` devolve `ImageRef` com `ref` e `thumbnail`; execução parada → `EXECUTION_NOT_RUNNING`; agente sem `images` → "Este agente não recebe imagens."; `send` revalida e escreve as referências separadas por espaço, sem `\r`
- [X] T011 [P] [US1] Testes em `tests/unit/renderer/ImagePreview.test.tsx`: miniatura e nome; "Enviar" chama `attachments.send`; "Cancelar" e Esc não enviam; execução que sai de `running`/`idle` fecha a prévia com aviso
- [X] T012 [P] [US1] Testes em `tests/unit/renderer/TerminalView.test.tsx`: Ctrl+V com `clipboardHasImage=true` não cola no xterm e chama `pasteImage`; com `false` mantém a colagem; Ctrl+Shift+V cola só texto

### Implementação

- [X] T013 [US1] (depende de T004, T006, T008) `src/core/attachments/attachment-service.ts` com `saveClipboardImage`, dependências injetadas (`FileSystem`, `Clock`, `paths`, `log`)
- [X] T014 [US1] (depende de T009) `src/main/thumbnail.ts` com `nativeImage.resize`
- [X] T015 [US1] (depende de T007, T010, T013, T014) `src/main/ipc/register-attachments.ts`, `src/main/ipc/validate-attachments.ts`, registro em `src/main/ipc/register.ts` e ligação no `src/main/main.ts`: `clipboardHasImage`, `pasteImage`, `send`
- [X] T016 [US1] (depende de T011) `src/renderer/components/Panel/ImagePreview.tsx` e CSS em `src/renderer/styles/app.css`
- [X] T017 [US1] (depende de T012, T016) Ctrl+V em `src/renderer/components/TerminalView.tsx` (`attachCustomKeyEventHandler`) e prévia no `src/renderer/components/Panel/Panel.tsx`
- [X] T018 [P] [US1] [simples] (depende de T001) `images` no Claude Code em `catalog/agents.json` (Gemini e Codex só se marcados como "lê fora do cwd: sim" na tabela da T001) e no agente `fake` em `tests/fixtures/catalog.fake.json`

**Checkpoint**: colar imagem funciona de ponta a ponta.

## Phase 4: User Story 2 — Arrastar ou anexar arquivos (P2)

**Goal**: soltar arquivos, o botão "Anexar imagem" do painel e o clipe da árvore levam à mesma prévia, referenciando o arquivo original.

**Independent Test**: soltar um PNG e um PDF no painel; a prévia mostra só o PNG e lista o PDF como recusado.

### Tests (escritos antes)

- [X] T019 [US2] (depois de T008, mesmo arquivo) Testes de `checkFile` em `tests/integration/core/attachments.test.ts`: inexistente, acima de 20 MB, formato não aceito, diretório, link simbólico apontando para fora (recusado), arquivo regular aceito; nenhum arquivo copiado; arquivo apagado entre `checkFiles` e `send` é recusado no `send`
- [X] T020 [US2] (depois de T010, mesmo arquivo) Testes de `checkFiles` e `pickImages` em `tests/unit/main/ipc/register-attachments.test.ts`: 1–20 caminhos; caractere de controle recusado; separação `accepted`/`rejected` com motivo
- [X] T021 [US2] (depois de T011/T016) Testes em `tests/unit/renderer/Panel.test.tsx`: soltar arquivos chama `checkFiles` com `files.pathOf`; recusados listados; botão "Anexar imagem" do painel chama `pickImages`; e em `tests/unit/renderer/Tree.test.tsx`: clipe na linha da execução viva

### Implementação

- [X] T022 [US2] (depende de T013, T019) `checkFile` em `src/core/attachments/attachment-service.ts` (`lstat`, `realpath`, arquivo regular)
- [X] T023 [US2] (depende de T015, T020) `checkFiles` e `pickImages` (filtro de imagens, seleção múltipla) em `src/main/ipc/register-attachments.ts` e `validate-attachments.ts`
- [X] T024 [US2] (depende de T017, T021) Drop e botão "Anexar imagem" em `src/renderer/components/Panel/Panel.tsx`; clipe em `src/renderer/components/Tree/TreeExecution.tsx`

## Phase 5: User Story 3 — Agentes sem suporte (P3)

**Goal**: aviso em vez de lixo no terminal.

**Independent Test**: colar ou soltar imagem no painel de um shell mostra o aviso e nada é escrito.

- [X] T025 [US3] (depois de T021, mesmo arquivo) Testes em `tests/unit/renderer/Panel.test.tsx`: agente sem `images` → aviso "Este agente não recebe imagens" ao colar e ao soltar (inclusive arquivo que não é imagem); `send` nunca é chamado
- [X] T026 [US3] [simples] (depende de T024, T025) Aviso no `src/renderer/components/Panel/Panel.tsx` a partir de `agent.images`

## Phase 6: User Story 4 — Anexos limpos (P3)

**Goal**: remover a sessão (ou o workspace) apaga os anexos dela; órfãos somem no início; arquivos do usuário nunca.

**Independent Test**: colar duas imagens, remover a sessão; a pasta de anexos some e o arquivo arrastado continua.

- [X] T027 [US4] (depois de T019, mesmo arquivo) Testes em `tests/integration/core/attachments.test.ts`: `removeFor(execId)` apaga só `attachmentsDir(execId)`; `sweepOrphans(known)` apaga pastas de execuções desconhecidas; arquivo fora da pasta de anexos permanece; log `attachment.cleaned { execId, files }`
- [X] T028 [US4] (depende de T027) `removeFor` e `sweepOrphans` em `src/core/attachments/attachment-service.ts`; chamada em `removeExecution` de `src/core/execution/lifecycle.ts` e `sweepOrphans` na inicialização em `src/main/main.ts`

## Phase 7: Polish

- [X] T029 [P] e2e em `tests/e2e/images.spec.ts`: soltar um PNG no painel do agente falso, enviar e ver o caminho no eco
- [X] T030 [P] [simples] `README.md` (funcionalidades) e contrato base em `specs/001-workspace-agentes-paralelos/contracts/ipc.md` com o grupo `attachments`

## Dependencies & Execution Order

- T001 bloqueia T018 e decide a contingência (pode mudar R2).
- Foundational: T002 → T004 → T007; T003 → T005; T006 livre.
- US1: T008 → T013; T009 → T014; T010 → T015; T011 → T016; T012 + T016 → T017.
- US2 depois de US1. US3 depois de T024. US4 depois de T019 (mesmo arquivo de teste).
- Arquivos compartilhados (sem `[P]` entre si): `tests/integration/core/attachments.test.ts` (T008 → T019 → T027), `register-attachments.test.ts` (T010 → T020), `Panel.test.tsx` (T021 → T025), `Panel.tsx` (T017 → T024 → T026).

## Parallel Examples

- Foundational: T002 ∥ T003 ∥ T006.
- US1: T009 ∥ T011 ∥ T012 (arquivos diferentes), depois T018.

## Implementation Strategy

T001 → Foundational → US1 (MVP: print de tela no agente) → US2 → US3 → US4 → Polish.
