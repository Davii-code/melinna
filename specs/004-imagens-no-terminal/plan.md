# Implementation Plan: Imagens no chat do terminal

**Branch**: `004-imagens-no-terminal` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

O painel do terminal intercepta Ctrl+V quando a área de transferência tem só imagem e aceita arquivos
soltos e um botão "Anexar imagem". Uma prévia confirma o envio. O **main é a fonte única**: detecta a
imagem, grava o anexo colado em `userData/attachments/<execId>/`, valida arquivos, gera a miniatura e
devolve um `ImageRef` com a referência já formatada para o agente (`ref`). O renderer só mostra a
prévia e, ao enviar, revalida no main e escreve as referências no PTY, sem Enter. Remover a execução
(ou o workspace) apaga a pasta de anexos dela; uma varredura no início remove anexos órfãos.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24

**Primary Dependencies**: React 19, @xterm/xterm 6 — **nenhuma nova** (`clipboard`, `nativeImage`,
`dialog` e `webUtils.getPathForFile` do próprio Electron)

**Storage**: `userData/attachments/<execId>/<timestamp>-<n>.<ext>`

**Testing**: Vitest (unit core/main/renderer; integração com FS real em pasta temporária), Playwright

**Constraints**: imagem ≤ 20 MB; até 20 arquivos por envio; PNG/JPEG/GIF/WebP pela assinatura dos
bytes; só arquivo regular (sem seguir link simbólico para fora); nada gravado nas pastas do projeto

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Agente é processo | ✅ Capacidade `images` declarada no catálogo; nenhum caso especial por nome. |
| II. Pasta do usuário | ✅ Anexos na pasta de dados do app; arquivos do usuário nunca copiados nem apagados. A contingência de R1 (anexos dentro do projeto) **tocaria** o Princípio II e só entra com aprovação do dono. |
| III. PTY fonte da verdade | ✅ A referência é escrita no PTY como digitação comum, sem Enter. |
| IV. Núcleo independente | ✅ Formato, validação e ciclo de vida dos anexos em `src/core`, com portas `FileSystem` e `Clock` injetadas; Electron (`clipboard`, `nativeImage`, `dialog`) só em `src/main`. O renderer recebe a referência pronta; `src/shared` não importa lógica de `src/core` além de tipos. |
| V/VI | ✅ Testes por história; casos de borda viram requisitos. |
| VII. Sem surpresas | ✅ Sem dependência nova. Muda contratos, aprovados pelo dono em 2026-10-22 — ver "Aprovações". |
| VIII. Execução segura | ✅ Nada é executado; caminho com caractere de controle é recusado; bytes da área de transferência lidos no main; tamanho checado antes de gravar. |

Resultado: **passa** (aprovações do Princípio VII registradas abaixo).

### Aprovações (Princípio VII)

| Contrato | Mudança | Aprovação |
|---|---|---|
| Catálogo de agentes | campo opcional `images` (`template`, `quote`) | aprovado pelo dono em 2026-10-22 |
| IPC | grupo `attachments` (4 canais) e `files.pathOf` no preload | aprovado pelo dono em 2026-10-22 |
| Contingência R1 | se a T001 mostrar que os agentes não leem fora do projeto: anexos via pasta extra do agente (feature 003) ou, em último caso, em `.melinna/anexos` dentro do projeto | aprovado pelo dono em 2026-10-22 |

## Design

### Núcleo (`src/core`)

- `catalog/schema.ts`: `AgentDefinition.images?: { template: string; quote: 'always' | 'when-needed' }`,
  `{path}` exatamente uma vez no `template`.
- `attachments/image-format.ts` (puro): `detectImageType(bytes)`, `MAX_IMAGE_BYTES`, `MAX_FILES = 20`,
  `formatImageRef(images, path)` (aspas conforme `quote`, aspas internas escapadas, recusa caractere de
  controle).
- `attachments/attachment-service.ts`: dependências injetadas `{ fs: FileSystem, clock: Clock, paths,
  log, catalog }`.
  - `saveClipboardImage(execId, bytes)` → valida tipo e tamanho, grava, log `attachment.saved`.
  - `checkFile(path)` → `lstat` (arquivo regular), `realpath`, tamanho, assinatura; nunca copia.
  - `removeFor(execId)` e `sweepOrphans(knownExecIds)` (início do app) → log `attachment.cleaned`.
  - Recusas → log `attachment.rejected { reason }`.
- `paths.ts`: `attachmentsDir(execId)`, `attachmentsRoot`.
- `execution/lifecycle.ts`: `removeExecution` chama `removeFor`; remoção de tarefa e de workspace já
  passa por `removeExecution`, então cobre os dois casos.

### Main/IPC

- Grupo `attachments` com 4 canais (contrato em [contracts/ipc.md](contracts/ipc.md)):
  `clipboardHasImage`, `pasteImage(execId)`, `checkFiles(execId, paths)`, `pickImages(execId)`.
  Cada `ImageRef` traz `ref` (texto já formatado para o agente) e `thumbnail` (data URL ≤ 256 px,
  gerada com `nativeImage.resize` num módulo próprio `src/main/thumbnail.ts`).
- `attachments.send(execId, paths)`: revalida os arquivos (existência, tipo, tamanho) **no momento do
  envio** e escreve as referências no PTY via `ExecutionService.write`, sem Enter. Fecha a janela entre
  validar e usar (TOCTOU) e cobre "arquivo removido antes de enviar".
- `sweepOrphans` roda na inicialização, depois de carregar o estado.

### Renderer

- `TerminalView.tsx`: `attachCustomKeyEventHandler` para Ctrl+V → pergunta `clipboardHasImage`; se sim,
  cancela a colagem do xterm e chama `pasteImage`; senão segue o fluxo atual (FR-010). Ctrl+Shift+V
  cola só texto.
- `Panel/ImagePreview.tsx`: miniaturas, nomes e recusados; "Enviar" chama `attachments.send`; Esc e
  "Cancelar" fecham. Uma prévia por painel; se a execução sair de `running`/`idle`, a prévia fecha com
  aviso.
- Botão "Anexar imagem" (clipe) **no painel** (canto do terminal) e na linha da execução na árvore.
  Sem atalho de teclado novo (Ctrl+Shift+I é das DevTools).
- Aviso "Este agente não recebe imagens" usa `agent.images` da definição do catálogo, que o renderer já
  recebe por `catalog.list`.

### Erros e logs

`INPUT_INVALID` (formato, tamanho, mais de 20 arquivos, arquivo inexistente, não é arquivo regular,
agente sem `images`), `EXECUTION_NOT_RUNNING`, `IO_ERROR`. Logs `attachment.saved|rejected|cleaned`
sem conteúdo nem caminho completo do usuário (só tipo, tamanho, contagem).

### Segurança

Bytes lidos no main; nomes de anexo gerados pelo app; `lstat` + `realpath` e só arquivo regular;
revalidação no envio; caminho com caractere de controle recusado antes de virar texto no PTY.

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit core | assinaturas, limites, `formatImageRef`, schema `images` | `tests/unit/core/attachments/`, `tests/unit/core/catalog/` |
| Integração | gravar, validar arquivo regular/link, revalidar, limpar por execução e órfãos, logs | `tests/integration/core/attachments.test.ts` (adaptador real, pasta temporária) |
| Unit main | 5 canais, validação, miniatura | `tests/unit/main/ipc/register-attachments.test.ts`, `tests/unit/main/thumbnail.test.ts` |
| Unit renderer | Ctrl+V, prévia, envio, aviso, botões | `tests/unit/renderer/` |
| e2e | soltar PNG no agente falso e ver o caminho no eco | `tests/e2e/images.spec.ts` |

## Project Structure

```text
src/core/attachments/image-format.ts, attachment-service.ts (novos)
src/core/catalog/schema.ts, src/core/paths.ts, src/core/execution/lifecycle.ts
src/shared/ipc-contract.ts
src/main/ipc/register-attachments.ts, validate-attachments.ts (novos), src/main/thumbnail.ts (novo)
src/main/ipc/register.ts, src/main/main.ts
src/preload/preload.ts (files.pathOf)
src/renderer/components/TerminalView.tsx, Panel/ImagePreview.tsx (novo), Panel/Panel.tsx, Tree/TreeExecution.tsx
catalog/agents.json, tests/fixtures/catalog.fake.json
```

## Complexity Tracking

Sem violações; contingência de R1 depende de aprovação.
