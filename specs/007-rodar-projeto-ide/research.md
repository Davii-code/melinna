# Research: Configurações de execução e mapas de atalhos

Revisão de 2026-10-23: a abertura em IDE externa saiu do escopo (R3 e R7 antigos removidos); entram a
barra de execução, a configuração ativa e os mapas de atalhos.

## R1. Como rodar sem shell

- **Decision**: reaproveitar o caminho de lançamento das sessões (PTY no hospedeiro), com a execução
  guardando `command { commandId, label, file, args }` em vez de um agente do catálogo. Programa
  resolvido por `resolveExecutable`; `npm.cmd`/`pnpm.cmd`/`yarn.cmd` resolvidos pelo `npm-shim` para
  `node` + script; outros `.cmd`/`.bat` recusados.
- **Rationale**: mesmas garantias da feature 001 (sem `cmd.exe`, sobrevive ao fechar o app, conta nas
  12 vagas).
- **Alternatives considered**: abrir um shell e digitar o comando (viola VIII); `child_process` sem PTY
  (perde cores, interatividade e a sobrevivência ao fechar o app).

## R2. Wrappers `mvnw`/`gradlew`

- **Decision**: no Windows, `mvnw.cmd`/`gradlew.bat` são lotes e não são executados; o app usa
  `mvn`/`gradle` do sistema e avisa "wrapper do projeto ignorado no Windows". No Linux/macOS, wrapper
  com bit de execução é usado direto; sem o bit, `run.start` devolve `needsConfirm: 'wrapper-sh'`; o
  usuário escolhe `wrapper-sh` (`sh <wrapper> <args>`, sem `-c`) ou `system-tool` (`mvn`/`gradle`).
- **Rationale**: Princípio VIII; cenário 14 da US1 (recusar = ferramenta do sistema).
- **Alternatives considered**: `cmd.exe /c gradlew.bat` (exceção ao VIII, não aprovada).

## R3. Identidade das configurações

- **Decision**: detectada = `sha256(groupId | pasta normalizada | origem | nome)` (16 hex); personalizada
  = `newId()`. O renderer só envia o id; o main resolve programa e argumentos de novo a cada `start`
  (nova detecção ou `Group.commands`). Id ausente → `COMMAND_STALE`.
- **Rationale**: id estável permite lembrar a configuração ativa entre aberturas e impede o renderer de
  escolher o programa.

## R4. Onde guardar as personalizadas

- **Decision**: `Group.commands?: StoredCommand[]` no estado (campo opcional, sem subir a versão);
  saem junto com o workspace.
- **Rationale**: pertencem ao workspace; `parseState` preserva campos desconhecidos.

## R5. Onde guardar a configuração ativa e o mapa de atalhos

- **Decision**: arquivo novo `userData/preferences.json` (versão 1, gravação atômica, versão maior →
  somente leitura): `{ version, keymap, activeRun: { groupId, commandId } | null }`. Substitui o
  `tools.json` do plano anterior.
- **Rationale**: são preferências do app, não do workspace; o seletor é global (lista todos os
  workspaces). `localStorage` não serve: não é lido pelo main nem tem gravação atômica/versão.
- **Alternatives considered**: campo opcional no `state.json` (mistura preferência com estado das
  sessões e entra no modo somente leitura do estado).

## R6. Sem subir a versão do esquema do estado

- **Decision**: `Group.commands`, `Task.kind` e `Execution.command` opcionais; `parseState` preserva.
- **Risco de downgrade**: versão antiga regrava o estado mantendo os campos, mas mostra a execução de
  comando como agente desconhecido `command`. Aceito (coberto por teste de leitura/regravação).

## R7. Rodar uma configuração que já rodou

- **Decision**: `start` de uma configuração com execução viva → devolve a existente (`reused: true`,
  o renderer foca o painel). Com execução encerrada da mesma configuração no mesmo workspace → relança
  essa execução (mesmo painel, separador no histórico) com programa/argumentos resolvidos de novo.
  Sem execução anterior → cria `Task { kind: 'command' }` + `Execution`.
- **Rationale**: cenários 5–7 da US1 (um painel por configuração, como o IntelliJ); evita uma tarefa
  nova a cada clique.
- `rerun(execId)` também passa pelo `run-service`: resolve a configuração de novo pelo
  `command.commandId` (sumiu → `COMMAND_STALE`; programa ausente → `PROGRAM_NOT_FOUND`), atualiza
  `exec.command`, para se viva e relança. `start` é serializado por `groupId+commandId` (mutex), para
  dois cliques rápidos não criarem duas execuções.

## R9. Parar

- **Decision**: `executions.stop` existente: Ctrl+C pelo hospedeiro de PTY e, após `STOP_GRACE_MS`
  (5 s), encerramento forçado da árvore de processos (FR-006).

## R8. Mapas de atalhos

- **Decision**: tabela fixa no renderer (`src/renderer/keymap/keymaps.ts`), uma entrada por mapa e
  ação; um único ouvinte de `keydown` em fase de captura na `window` (App.tsx) resolve a ação pelo mapa
  atual, chama `preventDefault`/`stopPropagation` e executa. `Mod` = Ctrl (Windows/Linux) ou Cmd
  (macOS). Teste garante que nenhum mapa usa Ctrl+C/D/Z/B, setas nem teclas reservadas (FR-015).
- **Rationale**: a captura na `window` roda antes do xterm e do editor, então o atalho funciona com
  qualquer foco (SC-004); tecla fora do mapa não é tocada e segue ao terminal/editor.
- **Alternatives considered**: `attachCustomKeyEventHandler` por terminal (não cobre o editor);
  `globalShortcut` do Electron (captura fora da janela, invasivo).

Tabela (ações sem tecla ficam só nos botões):

| Ação | Windows (padrão) | IntelliJ | Eclipse | VS Code |
|---|---|---|---|---|
| Ir para arquivo | Mod+P | Mod+Shift+N | Mod+Shift+R | Mod+P |
| Salvar | Mod+S | Mod+S | Mod+S | Mod+S |
| Fechar aba | Mod+W | Mod+F4 | Mod+W | Mod+W |
| Barra lateral | Mod+Shift+B | Mod+Shift+F12 | — | Mod+Shift+E |
| Biblioteca de prompts | Mod+Shift+P | Mod+Shift+A | Mod+Shift+L | Mod+Shift+P |
| Rodar configuração ativa | Mod+F5 | Shift+F10 | Mod+F11 | Mod+F5 |
| Parar | Shift+F5 | Mod+F2 | Mod+F2 | Shift+F5 |

Teclas proibidas em qualquer mapa (teste de T030): Ctrl+C/D/Z/B, Ctrl+M (Enter), Ctrl+[ (Esc),
Ctrl+1..9 e Alt+dígito (argumento numérico do readline), setas, e as reservadas pelo sistema
(Ctrl+Alt+Del, Alt+F4, Alt+Tab, teclas de mídia). Shift+F10 (Rodar no IntelliJ) é o atalho de menu de
contexto do Chromium, não do sistema: o ouvinte em captura chama `preventDefault`, o que impede o menu
de contexto; o teste de T031 confere isso.

O mapa Windows mantém os atalhos de hoje (Mod+P, Mod+S, Mod+W, Mod+Shift+B, Mod+Shift+P) e só
acrescenta Rodar/Parar. Ctrl+Shift+F (busca no terminal) segue fixo, fora dos mapas.
