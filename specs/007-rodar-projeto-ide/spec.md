# Feature Specification: Configurações de execução e mapas de atalhos, no estilo do IntelliJ

**Feature Branch**: `007-rodar-projeto-ide`

**Created**: 2026-10-22

**Updated**: 2026-10-23 — a abertura em IDE externa saiu do escopo; a execução passou a seguir a barra de execução do IntelliJ; entrou a escolha do mapa de atalhos.

**Status**: Draft

**Input**: User description: "Rodar o projeto com a mesma estrutura do IntelliJ: configurações de execução nomeadas num seletor da barra superior, botão Rodar e menu com editar, rodar de novo e parar; as detectadas (npm, Maven, Gradle, Docker Compose) e as personalizadas no mesmo seletor. Sem depuração e sem abrir em IDE externa. E poder escolher o mapa de atalhos do app: IntelliJ, Eclipse, VS Code ou Windows."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rodar pela barra de execução (Priority: P1)

Na barra superior, o usuário vê o seletor da configuração de execução ativa (ícone do tipo e nome, por exemplo "back end nest"), o botão Rodar (▶) ao lado e um menu (⋮). Abre o seletor, escolhe uma configuração detectada no projeto ou criada por ele e clica em Rodar: a saída aparece num painel de terminal do app. Pelo menu, roda de novo, para ou edita as configurações.

**Why this priority**: tira o usuário do terminal externo para as tarefas mais comuns, com a mesma barra que ele já usa no IntelliJ.

**Independent Test**: num projeto com `package.json` com o script `dev`, escolher "dev" no seletor, clicar em Rodar e ver a saída num painel; pelo menu, rodar de novo e parar.

**Acceptance Scenarios**:

1. **Given** um workspace com `package.json` com scripts, **When** o usuário abre o seletor, **Then** vê uma configuração por script, com o gerenciador certo (npm, pnpm ou yarn, pelo arquivo de lock).
2. **Given** um projeto Maven (`pom.xml`) ou Gradle (`build.gradle`/`build.gradle.kts`), **When** abre o seletor, **Then** vê as configurações comuns (compilar, testar, empacotar) usando o wrapper do projeto quando existir (`mvnw`, `gradlew`).
3. **Given** um `docker-compose.yml` ou `compose.yaml`, **When** abre o seletor, **Then** vê "subir" e "derrubar".
4. **Given** workspaces e pastas diferentes, **When** abre o seletor, **Then** as configurações aparecem agrupadas por workspace e por pasta, as personalizadas primeiro.
5. **Given** uma configuração escolhida no seletor, **When** o usuário clica em Rodar (▶), **Then** abre um painel de terminal com a saída, na pasta da configuração, e a configuração passa a mostrar que está rodando.
6. **Given** a configuração ativa rodando, **When** o usuário clica em Rodar de novo, **Then** o painel existente ganha o foco em vez de abrir outra instância.
7. **Given** a configuração ativa rodando, **When** escolhe "Rodar de novo" no menu (⋮), **Then** o comando é parado e iniciado de novo no mesmo painel.
8. **Given** a configuração ativa rodando, **When** escolhe "Parar" no menu, **Then** o comando para como num Ctrl+C e o painel mostra o código de saída.
9. **Given** o menu (⋮), **When** o usuário escolhe "Editar configurações", **Then** abre a janela de configurações com a lista à esquerda (detectadas e personalizadas) e os campos da selecionada à direita.
10. **Given** a janela de configurações, **When** o usuário cria uma configuração com nome, programa, argumentos e pasta do workspace, **Then** ela aparece no seletor e continua após reabrir o app.
11. **Given** uma configuração personalizada, **When** o usuário a edita, duplica ou exclui, **Then** o seletor reflete a mudança.
12. **Given** uma configuração detectada, **When** o usuário a abre na janela, **Then** vê os campos só para leitura e pode duplicá-la como personalizada para alterar.
13. **Given** a configuração ativa escolhida, **When** o usuário fecha e reabre o app, **Then** a mesma configuração continua ativa no seletor.
14. **Given** no Linux um wrapper do projeto sem permissão de execução, **When** o usuário roda uma configuração que o usa, **Then** o app pede confirmação para rodá-lo com o interpretador do wrapper; recusando, usa a ferramenta do sistema.

---

### User Story 2 - Escolher o mapa de atalhos (Priority: P2)

O usuário escolhe, nas preferências do app, o mapa de atalhos de teclado que já tem na memória: IntelliJ, Eclipse, VS Code ou Windows (o padrão, com os atalhos atuais do app). Os atalhos do app passam a seguir o mapa escolhido.

**Why this priority**: quem vem de outra IDE não precisa reaprender atalhos; o app funciona sem isso com o mapa padrão.

**Independent Test**: escolher o mapa IntelliJ e abrir o "ir para arquivo" com Ctrl+Shift+N; voltar ao mapa Windows e abrir com Ctrl+P.

**Acceptance Scenarios**:

1. **Given** as preferências do app, **When** o usuário abre "Mapa de atalhos", **Then** vê as opções IntelliJ, Eclipse, VS Code e Windows, com a atual marcada e a tabela dos atalhos de cada uma.
2. **Given** um mapa escolhido, **When** o usuário usa um atalho dele, **Then** a ação correspondente acontece, com o terminal em foco ou não.
3. **Given** um mapa escolhido, **When** o usuário usa o atalho de outro mapa que não existe no atual, **Then** nada do app acontece e a tecla segue para onde estiver o foco (terminal ou editor).
4. **Given** um mapa escolhido, **When** fecha e reabre o app, **Then** o mapa continua o mesmo.
5. **Given** a primeira abertura do app (ou estado sem preferência), **When** nada foi escolhido, **Then** vale o mapa Windows, com os atalhos de hoje.
6. **Given** os botões e menus que citam atalho (dicas e títulos), **When** o mapa muda, **Then** o texto mostra a tecla do mapa atual.

### Edge Cases

- Projeto sem nenhum arquivo reconhecido: o seletor mostra "Nenhuma configuração" e a opção "Editar configurações" para criar uma.
- Nenhuma configuração ativa (primeiro uso ou a ativa sumiu): o botão Rodar fica desabilitado com a dica "Escolha uma configuração".
- Configuração ativa desabilitada (ferramenta ausente ou pasta fora do workspace): o botão Rodar fica desabilitado com o motivo como dica.
- Configuração ativa parada: "Rodar de novo" e "Parar" ficam desabilitados no menu (⋮); "Editar configurações" continua disponível.
- Dois cliques rápidos em Rodar: uma só execução; o segundo foca o painel.
- `package.json` inválido: o app ignora esse arquivo e mostra o aviso no seletor, sem erro.
- `package.json` sem scripts: nenhuma configuração daquele arquivo, sem aviso.
- Configuração detectada que deixou de existir no projeto entre abrir o seletor e clicar em Rodar: recusada com "A configuração mudou; abra o seletor de novo."
- Configuração ativa detectada que sumiu do projeto: o seletor volta a "Nenhuma configuração ativa".
- Pasta de uma configuração personalizada removida do workspace: a configuração aparece desabilitada com "pasta fora do workspace" até ser editada.
- Nome de script com caracteres especiais (`;`, `&`, `$()`, espaços): passado como está, sem efeito de shell.
- Argumentos com espaços e aspas: passados como estão, um por item, sem interpretação de shell.
- Ferramenta não instalada (npm, mvn, gradle, docker): a configuração aparece desabilitada com "não encontrado: <nome>".
- Docker Compose antigo (`docker-compose` separado): usado quando `docker compose` não existe.
- `docker compose up` fica em primeiro plano no painel; "Parar" encerra os contêineres como Ctrl+C.
- Comando que termina sozinho: o painel mostra o código de saída; Rodar continua disponível.
- Comando de longa duração com o app fechado: segue rodando como as sessões de agente, e o estado volta ao reabrir.
- Excluir uma configuração ou remover o workspace com o comando rodando: pede para parar antes.
- Limite de terminais vivos (o mesmo das sessões de agente): rodar sem vaga é recusado com a mensagem de limite.
- Atalho do mapa escolhido que o terminal precisa (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+B e as setas): nunca é capturado pelo app; o mapa não usa essas teclas.
- Atalho do mapa que o sistema operacional reserva (por exemplo Ctrl+Alt+Del, teclas de mídia): não entra no mapa.
- Configuração personalizada com nome repetido no mesmo workspace: recusada com "Já existe uma configuração com esse nome".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST detectar, em cada pasta do workspace, configurações de execução de `package.json` (scripts, com npm/pnpm/yarn pelo arquivo de lock), Maven (`pom.xml`: compilar, testar, empacotar), Gradle (`build.gradle`/`.kts`: build, test, e `run`/`bootRun` quando o projeto declara a aplicação) e Docker Compose (subir, derrubar).
- **FR-002**: O sistema MUST usar o wrapper do projeto (`mvnw`, `gradlew`) quando existir e puder ser executado sem passar pelo prompt de comando; no Windows, onde o wrapper é um arquivo de lote, MUST usar a ferramenta do sistema e avisar que o wrapper foi ignorado.
- **FR-003**: A barra superior MUST mostrar o seletor da configuração ativa (ícone do tipo e nome), o botão Rodar e o menu com "Rodar de novo", "Parar" e "Editar configurações".
- **FR-004**: O seletor MUST listar as configurações de todos os workspaces abertos, agrupadas por workspace e pasta, com as personalizadas antes das detectadas, e indicar as que estão rodando.
- **FR-005**: Rodar MUST abrir um painel de terminal na pasta da configuração; rodar uma configuração que já está rodando MUST focar o painel existente.
- **FR-006**: "Rodar de novo" MUST parar e iniciar o comando no mesmo painel; "Parar" MUST interromper como Ctrl+C e, sem resposta, encerrar o processo.
- **FR-007**: Comandos MUST ser executados sem interpretação de shell: programa e argumentos separados.
- **FR-008**: Ferramenta ausente MUST deixar a configuração desabilitada com o nome procurado.
- **FR-009**: O usuário MUST poder criar, editar, duplicar e excluir configurações personalizadas por workspace (nome 1–80 único no workspace, programa, até 64 argumentos, pasta do workspace), persistidas entre aberturas; configurações detectadas são só leitura e podem ser duplicadas como personalizadas.
- **FR-010**: A configuração ativa MUST ser lembrada entre aberturas do app.
- **FR-011**: Comandos rodando MUST contar no mesmo limite de terminais vivos das sessões de agente.
- **FR-012**: Excluir uma configuração personalizada ou remover o workspace com o comando rodando MUST exigir parar antes.
- **FR-013**: O usuário MUST poder escolher o mapa de atalhos entre IntelliJ, Eclipse, VS Code e Windows (padrão); a escolha MUST valer na hora, sem reiniciar, e persistir entre aberturas.
- **FR-014**: Cada mapa MUST cobrir as mesmas ações do app: ir para arquivo, salvar, fechar aba, mostrar/esconder a barra lateral, abrir a biblioteca de prompts, rodar a configuração ativa e parar. Ações sem atalho num mapa ficam sem atalho nele (continuam disponíveis pelos botões).
- **FR-015**: Os mapas MUST NOT capturar teclas que o terminal precisa (Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+B, setas) nem teclas reservadas pelo sistema operacional.
- **FR-016**: As dicas e títulos que citam atalhos MUST mostrar a tecla do mapa atual.
- **FR-017**: Rodar, parar e trocar de mapa MUST ficar registrados para diagnóstico (tipo, workspace, resultado), sem argumentos nem caminhos completos.

### Key Entities

- **Configuração de execução**: nome, tipo (npm, pnpm, yarn, Maven, Gradle, Docker Compose ou personalizada), origem (detectada ou personalizada), programa, argumentos, pasta, workspace.
- **Configuração ativa**: a configuração escolhida no seletor, lembrada entre aberturas.
- **Execução de comando**: um terminal rodando uma configuração, com estado como as sessões.
- **Mapa de atalhos**: nome (IntelliJ, Eclipse, VS Code, Windows) e tecla de cada ação do app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Rodar a configuração ativa leva 1 ação (clique em Rodar ou atalho); trocar de configuração e rodar leva no máximo 2.
- **SC-002**: O seletor abre em menos de 1 segundo com até 10 workspaces abertos.
- **SC-003**: 0 comandos executados através de um shell.
- **SC-004**: Em cada um dos 4 mapas, todas as ações listadas em FR-014 que têm atalho funcionam com o terminal em foco e com o editor em foco.
- **SC-005**: Trocar de mapa tem efeito imediato, sem reiniciar o app, verificado em teste para os 4 mapas.

## Assumptions

- Depuração (botão 🐞, pontos de parada) fica fora desta feature.
- Abrir em IDE externa e "mostrar no explorador de arquivos" ficam fora desta feature.
- Os mapas trocam o conjunto inteiro; editar atalho por atalho fica para depois.
- As teclas de cada mapa seguem as das IDEs de referência para as mesmas ações quando existem e não conflitam com FR-015; o plano fixa a tabela.
- Os comandos detectados cobrem o caso comum; personalização fina (perfis do Maven, variáveis de ambiente) fica para depois.
- Fora de escopo: servidores de linguagem (LSP), busca em todos os arquivos.
