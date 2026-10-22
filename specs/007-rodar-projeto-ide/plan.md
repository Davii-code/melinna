# Implementation Plan: Rodar o projeto e abrir na IDE externa

**Branch**: `007-rodar-projeto-ide` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

Um detector puro lê os arquivos de projeto de cada pasta do workspace e gera comandos (`RunCommand`).
Rodar um comando cria uma tarefa e uma execução do tipo "comando": a execução guarda `command`
(programa e argumentos) e o lançamento usa o mesmo caminho das sessões (resolver executável, shim do
npm sem `cmd.exe`, PTY no hospedeiro), sem passar pelo catálogo de agentes. Comandos personalizados
ficam no workspace. Abrir na IDE externa resolve o executável do VS Code/IntelliJ (locais padrão ou
caminho informado em `userData/tools.json`) e o lança destacado, sem shell. Constitution de
referência: 2.0.0.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24

**Primary Dependencies**: React 19 — **nenhuma nova** (`shell.showItemInFolder` do Electron)

**Storage**: `Group.commands?`, `Task.kind?` e `Execution.command?` no estado (campos opcionais, sem
subir a versão do esquema — ver research R4 e o risco de downgrade); `userData/tools.json` versão 1 com
os caminhos de IDE escolhidos

**Testing**: Vitest (unit core/main/renderer; integração com PTY real e projetos de exemplo em pasta
temporária), Playwright

**Constraints**: sem shell (Princípio VIII); mesmas 12 vagas de terminais vivos; leitura de arquivos
de projeto limitada a 1 MB

## Constitution Check

| Princípio | Situação |
|---|---|
| I. Agente é processo | ✅ Comandos não são agentes; não mexem no catálogo. Lançamento compartilha o motor de PTY. |
| II. Pasta do usuário | ✅ O app só **lê** arquivos de projeto; o comando é lançado pelo usuário, que decide o que ele faz na pasta (como um terminal comum). Nada gravado no projeto pelo app. |
| III. PTY fonte da verdade | ✅ Comando roda no hospedeiro; sobrevive ao fechar o app; "Rodar de novo" relança no mesmo painel com separador. |
| IV. Núcleo independente | ✅ Detector, modelo e lançamento em `src/core`; IDE: resolução no núcleo com portas, spawn destacado e `shell` no main. |
| V/VI | ✅ Testes por história; sem decisões em aberto. |
| VII. Sem surpresas | ✅ Sem dependência nova. Mudam estado (campos opcionais), arquivo novo `tools.json`, IPC e códigos de erro, aprovados pelo dono em 2026-10-22 — ver abaixo. |
| VIII. Execução segura | ✅ Programa resolvido por `resolveExecutable` (PATH/PATHEXT); `.cmd`/`.bat` do npm via `npm-shim` (nunca `cmd.exe`); outros `.cmd`/`.bat` recusados; wrapper `gradlew`/`mvnw` no Linux sem bit de execução → `sh <wrapper> <args>` (sem `-c`) só com confirmação; argumentos como lista. Nomes de script vêm do `package.json` (conteúdo não confiável), mas viram um item de argv de `<pm> run`, sem efeito de shell. O renderer só envia `commandId`: programa e argumentos são resolvidos no main (nova detecção ou `Group.commands`). IDE: executável escolhido por diálogo nativo no main; no Windows só `.exe` (o `idea.cmd` do Toolbox não é candidato); `open`/`reveal` só aceitam caminhos (após `realpath`) dentro de uma pasta de workspace registrado. |

Resultado: **passa** (aprovações do Princípio VII registradas abaixo).

### Aprovações (Princípio VII)

| Contrato | Mudança | Aprovação |
|---|---|---|
| Erros | códigos `PROGRAM_NOT_FOUND`, `IDE_NOT_FOUND`, `COMMAND_STALE` | aprovado pelo dono em 2026-10-22 |
| Estado | `Group.commands?: RunCommand[]`, `Task.kind?: 'agent' \| 'command'`, `Execution.command?: { file, args, label }` (opcionais) | aprovado pelo dono em 2026-10-22 |
| Arquivo novo | `userData/tools.json` versão 1 (caminhos de IDE) | aprovado pelo dono em 2026-10-22 |
| IPC | grupos `run` e `ide` (contracts/ipc.md) | aprovado pelo dono em 2026-10-22 |

## Design

### Núcleo

- `src/core/run/detect.ts` (puro sobre `FileSystem`): por pasta, lê até 1 MB de cada arquivo:
  - `package.json` → `scripts` (lock: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, senão npm;
    `<pm> run <script>`); inválido → aviso no resultado;
  - `pom.xml` → `mvnw`/`mvn` com `compile`, `test`, `package`;
  - `build.gradle(.kts)` → `gradlew`/`gradle` com `build`, `test`; `run` se houver o plugin
    `application`; `bootRun` se houver `org.springframework.boot`;
  - `docker-compose.yml`/`compose.yaml` → `docker compose up` e `docker compose down`.
  Saída: `RunCommand[]` com `available` (ferramenta resolvida) e `searched`.
- `src/core/run/run-service.ts`: `start(groupId, commandId, size)` → resolve o `commandId` **no
  servidor** (nova detecção ou `Group.commands`; inexistente → `COMMAND_STALE` "O comando mudou; abra o
  menu de novo."); comando com execução viva → devolve a execução existente (o renderer foca o painel);
  valida pasta do workspace e vagas (`assertWithinLimit`); resolve o programa (ausente →
  `PROGRAM_NOT_FOUND`); cria `Task { kind: 'command', isolation: 'direct' }` e
  `Execution { agentId: 'command', command: { commandId, label, file, args } }`, onde `file` é o
  **caminho já resolvido**; `start.ts` usa `command` em vez de `catalog.buildLaunch`.
  `rerun(execId)` = parar (se vivo) + `relaunchExecution`. Remoção de comando/workspace com execução
  viva → `EXECUTION_RUNNING`.
- Consumidores de `agentId` (`switch-service.ts`, `execution-service.ts`, `prepare.ts`, `roots.ts` e, no
  renderer, `App.tsx`, `ExecutionTabs.tsx`, `Panel.tsx`, `TreeTask.tsx`, `TreeExecution.tsx`,
  `AgentMenu.tsx`): execução com `command` não troca modelo/modo (recusa com mensagem), não é
  retomada como agente, mostra o rótulo do comando e um ícone próprio no lugar do nome do agente.
- `src/core/run/custom-commands.ts`: CRUD em `Group.commands` (nome 1–80, programa 1–`LIMITS.path`,
  até 64 argumentos de até 4.096 caracteres, sem caracteres de controle, pasta do workspace).
- `src/core/ide/ide-locator.ts`: candidatos por sistema — VS Code: `code` no PATH (no Windows,
  `Code.exe` em `%LOCALAPPDATA%\Programs\Microsoft VS Code` e `%ProgramFiles%\Microsoft VS Code`; o
  `code.cmd` não é usado); IntelliJ: `idea64.exe` em `%ProgramFiles%\JetBrains\IntelliJ*\bin` e nos
  scripts do Toolbox; Linux: `code`, `idea`, `idea.sh` no PATH e em `~/.local/share/JetBrains/Toolbox/
  scripts`. Caminho informado em `tools.json` tem prioridade; inexistente → volta a procurar e avisa.
  No Windows só `.exe` é candidato (o `idea.cmd` do Toolbox e o `code.cmd` são ignorados; o Toolbox
  também instala `idea64.exe` em `%LOCALAPPDATA%\Programs`). Argumentos: VS Code
  `--goto <arquivo>:<linha>` ou `<pasta>`; IntelliJ `--line <n> <arquivo>` ou `<pasta>`.
- `src/core/ide/tools-store.ts`: `tools.json` versão 1, gravação atômica, versão maior → somente
  leitura.

### Main/IPC

Grupos `run` e `ide` ([contracts/ipc.md](contracts/ipc.md)); `ide.open` faz `spawn` destacado
(`detached`, `stdio: 'ignore'`, sem shell) e `unref`; `ide.choosePath` abre o diálogo nativo no main
(filtro `.exe` no Windows) e valida arquivo regular e não-lote; `ide.reveal` usa
`shell.showItemInFolder`.

### Renderer

- `Run/RunMenu.tsx` no "▶" do workspace (árvore): comandos por pasta, desabilitados com motivo,
  "Novo comando…".
- `Run/CommandDialog.tsx`: criar/editar personalizado (argumentos como lista de campos, não uma linha).
- Linha da execução de comando na árvore com ícone próprio, "Parar", "Rodar de novo".
- "Abrir em…" (VS Code, IntelliJ, explorador) no workspace, nas pastas e na aba do editor (com a linha
  do cursor); diálogo para informar o caminho quando não encontrado.

### Erros e logs

`INPUT_INVALID` (validações), códigos novos `PROGRAM_NOT_FOUND`, `IDE_NOT_FOUND` (o renderer abre o
diálogo de escolha a partir dele) e `COMMAND_STALE`, além de `LIMIT_REACHED` e `EXECUTION_RUNNING`.
Logs: `run.started { groupId, source, tool }`, `run.stopped { groupId, exitCode }`,
`ide.open { kind, ok }`, `ide.reveal { ok }` — sem argumentos nem caminhos.

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit core | detector (cada tipo, lock, wrapper, plugin application/spring, inválido, > 1 MB, ferramenta ausente), comandos personalizados, localizador de IDE e argumentos, tools-store | `tests/unit/core/run/`, `tests/unit/core/ide/` |
| Integração | rodar `node -e` como comando personalizado num PTY real; rodar script npm de um projeto de exemplo; rerun e stop; limite de vagas | `tests/integration/core/run.test.ts` |
| Unit main | canais `run`/`ide`, spawn destacado sem shell (fake) | `tests/unit/main/ipc/register-run.test.ts`, `register-ide.test.ts` |
| Unit renderer | menu, diálogo, linha da execução, "Abrir em…" | `tests/unit/renderer/Run*.test.tsx`, `OpenIn.test.tsx` |
| e2e | rodar um script npm de um projeto de exemplo e ver a saída | `tests/e2e/run.spec.ts` |

### Roteiro de tela (para o `/testar-tela`)

- **US1**: "▶" do workspace Node → `dev` → painel com a saída → "Rodar de novo" → "Parar".
- **US2**: "Novo comando…" → `node`, argumentos `-e`, `console.log(1)` → rodar → saída `1`.
- **US3**: "Abrir em… → VS Code" no workspace; no editor, linha 42 → VS Code abre na linha; IDE ausente
  → informar caminho.

Detalhe em [quickstart.md](quickstart.md).

## Project Structure

```text
src/core/run/detect.ts, run-service.ts, custom-commands.ts (novos)
src/core/ide/ide-locator.ts, tools-store.ts (novos)
src/core/persistence/state-schema.ts (campos opcionais), src/core/execution/start.ts, src/core/paths.ts
src/shared/ipc-contract.ts
src/main/ipc/register-run.ts, validate-run.ts, register-ide.ts, validate-ide.ts (novos), src/main/ipc/register.ts, src/main/main.ts
src/renderer/components/Run/RunMenu.tsx, CommandDialog.tsx (novos); src/renderer/components/Ide/OpenIn.tsx (novo)
src/core/execution/switch-service.ts, execution-service.ts, prepare.ts, src/core/files/roots.ts (execução de comando)
src/renderer/App.tsx, Panel/ExecutionTabs.tsx, Panel/Panel.tsx, Tree/TreeTask.tsx, Tree/AgentMenu.tsx (rótulo e ícone)
src/renderer/components/Tree/TreeGroup.tsx, TreeExecution.tsx, Editor/EditorPane.tsx
```

## Complexity Tracking

Sem violações.
