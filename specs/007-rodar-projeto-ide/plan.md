# Implementation Plan: Configurações de execução e mapas de atalhos, no estilo do IntelliJ

**Branch**: `007-rodar-projeto-ide` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Revisão**: regerado para a spec de 2026-10-23. Saem a abertura em IDE externa (`tools.json`, grupo
IPC `ide`, `IDE_NOT_FOUND`) e o menu ▶ na árvore; entram a barra de execução na barra superior, a
janela de configurações, a configuração ativa e os mapas de atalhos. T001–T005 já implementadas são
reaproveitadas; o que delas pertencia à IDE é desfeito na task T006.

## Summary

Um detector puro lê os arquivos de projeto de cada pasta de cada workspace e gera configurações
(`RunCommand`) com id estável; as personalizadas ficam em `Group.commands`. Rodar cria (ou reusa) uma
tarefa e uma execução do tipo "comando" que guardam programa resolvido e argumentos e usam o mesmo
caminho de PTY das sessões, sem catálogo e sem shell. Na barra superior, um seletor mostra a
configuração ativa (lembrada em `userData/preferences.json`), com Rodar (▶) e menu (⋮: Rodar de novo,
Parar, Editar configurações). Os atalhos do app passam a vir de um mapa escolhido (Windows, IntelliJ,
Eclipse, VS Code), também em `preferences.json`, aplicado por um único ouvinte de teclado em fase de
captura. Constitution de referência: 2.0.0.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24

**Primary Dependencies**: React 19 — **nenhuma nova**

**Storage**: `Group.commands?`, `Task.kind?`, `Execution.command?` no estado (opcionais, sem subir a
versão — research R6); `userData/preferences.json` versão 1 (`keymap`, `activeRun`) — research R5

**Testing**: Vitest (unit core/main/renderer; integração com PTY real e projetos de exemplo de
`tests/fixtures/projects/`), Playwright (e2e), teste de arquitetura

**Target Platform**: Windows 10 1809+ validado; Linux/macOS compilam e rodam (wrappers com bit de
execução)

**Performance Goals**: seletor abre em < 1 s com 10 workspaces (SC-002): detecção em paralelo por pasta,
leitura ≤ 1 MB por arquivo

**Constraints**: sem shell (VIII); mesmas 12 vagas de terminais vivos; atalhos nunca capturam
Ctrl+C/D/Z/B nem setas (FR-015)

**Scale/Scope**: até 10 workspaces × poucas pastas; 4 mapas × 7 ações

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Agente é processo | ✅ Comandos não são agentes nem entram no catálogo; o lançamento compartilha o motor de PTY. |
| II. Pasta do usuário | ✅ O app só **lê** arquivos de projeto; o comando é lançado pelo usuário, como num terminal. Nada é gravado no projeto. |
| III. PTY fonte da verdade | ✅ Comando roda no hospedeiro; sobrevive ao fechar o app; "Rodar de novo" relança no mesmo painel com separador. |
| IV. Núcleo independente | ✅ Detector, resolução, serviço de execução e preferências em `src/core` com portas; main só registra canais; mapas no renderer. |
| V. Testes | ✅ Testes por história escritos antes (tasks "Tests"). |
| VI. Entregável completo | ✅ Erros com mensagem ao usuário e log estruturado. |
| VII. Sem surpresas | ✅ Sem dependência nova. Mudanças de contrato listadas abaixo, aprovadas pelo dono (2026-10-22 e 2026-10-23). |
| VIII. Execução segura | ✅ Programa resolvido por `resolveExecutable`; shim do npm sem `cmd.exe`; outros `.cmd`/`.bat` recusados; wrapper sem bit de execução → `sh <wrapper> <args>` (sem `-c`) só com confirmação; argumentos como lista; o renderer só envia ids. |
| IX/X | ✅ Ícones e textos próprios; cores da marca. |

Resultado: **passa**.

### Aprovações (Princípio VII)

| Contrato | Mudança | Aprovação |
|---|---|---|
| Erros | `PROGRAM_NOT_FOUND`, `COMMAND_STALE` (mensagem "A configuração mudou; abra o seletor de novo."); `IDE_NOT_FOUND` removido | códigos aprovados pelo dono em 2026-10-22; remoção e mensagem nova aprovadas pelo dono em 2026-10-23 |
| Estado | `Group.commands?`, `Task.kind?`, `Execution.command?` (opcionais) | aprovado pelo dono em 2026-10-22 |
| Arquivo novo | `userData/preferences.json` v1 (`keymap`, `activeRun`) no lugar de `tools.json` | aprovado pelo dono em 2026-10-23 |
| IPC | grupo `run` (com `list()` global, `choice` no `start`, `groupId`/`tool`/`unavailableReason` em `RunCommand`) e grupo `prefs`; grupo `ide` removido | aprovado pelo dono em 2026-10-23 |

## Design

### Núcleo (`src/core`)

- `run/detect.ts` (puro sobre `FileSystem`/`Platform`): por pasta, lê até 1 MB de `package.json`,
  `pom.xml`, `build.gradle(.kts)`, `docker-compose.yml`/`compose.yaml` e gera `RunCommand[]` +
  avisos (research R2, R3; data-model "Detecção"). `available`/`unavailableReason`/`searched` pela
  resolução do programa.
- `run/resolve-program.ts`: `resolveExecutable`; lote do npm/pnpm/yarn → `resolveNpmShim`; outro lote →
  `INPUT_INVALID`; ausente → `PROGRAM_NOT_FOUND`. Wrapper no Linux/macOS: confere bit de execução
  (`FileStat.mode`, novo campo opcional na porta, preenchido pelo `NodeFileSystem`).
- `run/custom-commands.ts`: validação e CRUD de `Group.commands` (nome único no workspace).
- `run/run-service.ts`: `list()` (todos os workspaces, detecção em paralelo), `start`, `rerun`,
  `saveCommand`, `removeCommand` (recusa com execução viva). `start` e `rerun` seguem research R7
  (resolve de novo, atualiza `exec.command`, serializado por configuração); cria
  `Task { kind: 'command', isolation: 'direct' }` e `Execution { agentId: 'command', command }`.
  `choice: 'wrapper-sh'` só vale quando o programa é o wrapper do projeto sem bit de execução;
  `system-tool` só troca o wrapper por `mvn`/`gradle`. Parar: `executions.stop` (Ctrl+C e, após 5 s,
  encerramento forçado — research R9).
- Os consumidores decidem por `exec.command`/`Task.kind`, nunca por `agentId === 'command'` (o
  marcador existe só para versões antigas do estado lerem um id não vazio).
- `execution/start.ts` e `relaunchExecution`: com `exec.command`, usam `file`/`args` dele em vez de
  `catalog.buildLaunch`; `prepare.ts` não consulta o catálogo para execução de comando.
- Consumidores de `agentId` (`switch-service.ts`, `execution-service.ts`, `files/roots.ts`): troca de
  modelo/modo recusada com `SWITCH_UNSUPPORTED` "Comandos não trocam de modelo nem de modo.";
  `removeTasksOf` recusa com execução de comando viva ("Pare o comando antes.").
- `prefs/preferences-store.ts`: lê/grava `preferences.json` (atômico, versão, somente leitura).

### Main/IPC

`register-run.ts`/`validate-run.ts` e `register-prefs.ts`/`validate-prefs.ts` no padrão de
`register-lifecycle.ts`/`validate-lifecycle.ts`; montagem em `register.ts` e `main.ts`
([contracts/ipc.md](contracts/ipc.md)).

### Renderer

- `Run/RunBar.tsx` no slot `children` de `TopBar.tsx`: seletor (ícone do tipo + nome; "Nenhuma
  configuração ativa"), ▶ (desabilitado com "Escolha uma configuração"), ⋮ com "Rodar de novo",
  "Parar", "Editar configurações". Indica rodando pelo snapshot (execução viva com `command.commandId`).
- `Run/RunSelector.tsx`: lista por workspace e pasta, personalizadas primeiro, desabilitadas com
  "não encontrado: X" ou "pasta fora do workspace", avisos, "Nenhuma configuração".
- `Run/RunConfigDialog.tsx`: lista à esquerda, campos à direita; detectadas só leitura com "Duplicar";
  personalizadas com editar/duplicar/excluir; argumentos como lista de campos.
- `store/run-store.ts`: catálogo, configuração ativa (via `prefs`), ações rodar/rodar de novo/parar;
  foca o painel com `layout-store.open(execId)`.
- `keymap/keymaps.ts` (tabela R8), `keymap/keymap-store.ts` (mapa atual via `prefs`),
  `keymap/use-shortcuts.ts` (ouvinte único em captura na `window`, substitui os de `App.tsx`);
  `Settings/KeymapDialog.tsx` ("Mapa de atalhos" com a tabela) aberto por um botão na barra superior;
  dicas/títulos (`EditorPane`, `TopBar`, `Sidebar`) usam `shortcutLabel(action)`.
- Execução de comando na árvore e no painel: ícone próprio e rótulo do comando no lugar do agente
  (`TreeExecution`, `TreeTask`, `ExecutionTabs`, `Panel`, `AgentMenu` sem trocas).

### Erros e logs

Ver [contracts/ipc.md](contracts/ipc.md) (Erros, Logs). FR-017 coberto pelos logs `run.*` e
`prefs.keymap_changed`, sem argumentos nem caminhos.

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit core | detector (cada tipo, lock, wrapper com/sem bit, plugins, inválido, > 1 MB, ausente, legado do compose), resolução, personalizadas, run-service, preferências | `tests/unit/core/run/`, `tests/unit/core/prefs/` |
| Integração | script npm do `node-app` num PTY real; personalizado `node -e` com argumento com espaço e aspas; rerun/stop; reusar painel; limite de vagas | `tests/integration/core/run.test.ts` |
| Unit main | canais `run`/`prefs` e validação | `tests/unit/main/ipc/register-run.test.ts`, `register-prefs.test.ts` |
| Unit renderer | barra, seletor, janela de configurações, árvore, mapas (tabela, captura com terminal/editor em foco, teclas proibidas, troca imediata), diálogo do mapa | `tests/unit/renderer/` |
| Arquitetura | nenhum `shell: true`, `cmd.exe`, `/c`, `sh -c` em `src/core/run` e `register-run.ts` | `tests/arch/no-shell-launch.test.ts` |
| Desempenho | detecção de 10 pastas < 1 s | `tests/unit/core/run/detect-perf.test.ts` |
| e2e | escolher `dev`, Rodar, ver saída; trocar mapa e usar o atalho | `tests/e2e/run.spec.ts` |

### Roteiro de tela (para o `/testar-tela`)

Ver [quickstart.md](quickstart.md).

## Project Structure

```text
src/core/run/types.ts (existe), detect.ts, resolve-program.ts, custom-commands.ts, run-service.ts
src/core/prefs/preferences-store.ts
src/core/ports/file-system.ts (mode?), src/adapters/node-fs.ts
src/core/persistence/state-schema.ts (feito), src/core/paths.ts (preferencesFile), src/core/errors.ts
src/core/execution/start.ts, lifecycle.ts, prepare.ts, switch-service.ts, execution-service.ts, src/core/files/roots.ts
src/shared/ipc-contract.ts, src/preload/preload.ts
src/main/ipc/register-run.ts, validate-run.ts, register-prefs.ts, validate-prefs.ts, register.ts, src/main/main.ts
src/renderer/components/Run/RunBar.tsx, RunSelector.tsx, RunConfigDialog.tsx; src/renderer/store/run-store.ts
src/renderer/keymap/keymaps.ts, keymap-store.ts, use-shortcuts.ts; src/renderer/components/Settings/KeymapDialog.tsx
src/renderer/App.tsx, TopBar.tsx, Tree/*, Panel/*, Editor/EditorPane.tsx, styles/app.css
```

## Complexity Tracking

Sem violações.
