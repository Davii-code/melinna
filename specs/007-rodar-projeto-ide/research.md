# Research: Rodar o projeto e abrir na IDE externa

## R1. Como rodar sem shell

- **Decision**: reaproveitar o caminho de lançamento das sessões (PTY no hospedeiro), com a execução
  guardando `command { file, args, label }` em vez de um agente do catálogo. Programa resolvido por
  `resolveExecutable`; `npm.cmd`/`pnpm.cmd`/`yarn.cmd` resolvidos pelo `npm-shim` para `node` + script.
- **Rationale**: mesmas garantias da feature 001 (sem `cmd.exe`, sobrevive ao fechar o app).
- **Alternatives considered**: abrir um shell e digitar o comando (passa por shell; viola VIII);
  `child_process` sem PTY (perde cores e interatividade).

## R2. Wrappers `mvnw`/`gradlew`

- **Decision**: no Windows, `mvnw.cmd`/`gradlew.bat` são lotes: lançados via `cmd.exe` não são
  permitidos, então o app usa `mvn`/`gradle` do sistema e mostra "wrapper do projeto ignorado no
  Windows". No Linux, wrapper executável é usado direto; sem bit de execução, `sh <wrapper>` com
  confirmação.
- **Rationale**: Princípio VIII proíbe lançar por shell argumentos da interface. O wrapper no Windows é
  um caso conhecido a revisitar se o dono aprovar uma exceção.
- **Alternatives considered**: `cmd.exe /c gradlew.bat` (exceção ao VIII, exige aprovação).

## R3. Onde encontrar as IDEs

- **Decision**: lista de candidatos por sistema (ver plano) + caminho escolhido pelo usuário (diálogo)
  em `tools.json`. No Windows só `.exe`: VS Code pelo `Code.exe` (o `code.cmd` é lote), IntelliJ pelo
  `idea64.exe` (o `idea.cmd` do Toolbox é lote e não é usado).
- **Rationale**: cobre instalações padrão e Toolbox; o caminho manual resolve o resto.

## R4. Onde guardar os comandos personalizados

- **Decision**: `Group.commands` no estado (campo opcional, sem subir a versão).
- **Rationale**: pertence ao workspace e acompanha remoção; `parseState` preserva campos desconhecidos.

## R5. Wrappers no Windows

- **Decision**: `mvnw.cmd`/`gradlew.bat` não são executados no Windows (seriam lançados por
  `cmd.exe`); o app usa `mvn`/`gradle` do sistema e avisa. Uma exceção ao Princípio VIII para wrappers
  só entra com aprovação explícita do dono, numa feature futura.

## R6. Sem subir a versão do esquema

- **Decision**: os campos novos são opcionais e `parseState` preserva campos desconhecidos.
- **Risco de downgrade**: uma versão antiga do app que regrave o estado mantém os campos (objetos
  preservados), mas não os exibe nem os valida; comandos personalizados continuam lá ao voltar à
  versão nova. Coberto por teste em T003.

## R7. IDE escolhida pelo usuário

- **Decision**: o caminho da IDE é escolhido por diálogo nativo no main, nunca recebido como texto do
  renderer; no Windows só `.exe`.
- **Rationale**: o main lança esse executável; aceitar um caminho arbitrário do renderer permitiria
  lançar qualquer programa.
