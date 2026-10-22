# Feature Specification: Rodar o projeto e abrir na IDE externa

**Feature Branch**: `007-rodar-projeto-ide`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Rodar o projeto e abrir na IDE externa, níveis A e B do bloco 3 de docs/ideias-proximas-versoes.md: detectar e rodar comandos do projeto (npm, Maven, Gradle, Docker Compose) num terminal do app e abrir pasta ou arquivo no VS Code ou no IntelliJ."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rodar um comando detectado do projeto (Priority: P1)

O usuário abre o menu "Rodar" do workspace e vê os comandos que o app encontrou no projeto (por exemplo `npm run dev`, `mvn test`, `gradle build`, `docker compose up`). Escolhe um, que abre num terminal do app, com "Rodar de novo" e "Parar".

**Why this priority**: tira o usuário do terminal externo para as tarefas mais comuns do projeto.

**Independent Test**: num projeto com `package.json` com o script `dev`, rodar `dev` pelo menu e ver a saída num painel; parar e rodar de novo.

**Acceptance Scenarios**:

1. **Given** um workspace com `package.json` com scripts, **When** o usuário abre "Rodar", **Then** vê um item por script, com o gerenciador certo (npm, pnpm ou yarn, pelo arquivo de lock).
2. **Given** um projeto Maven (`pom.xml`) ou Gradle (`build.gradle`/`build.gradle.kts`), **When** abre "Rodar", **Then** vê os comandos comuns (compilar, testar, empacotar) usando o wrapper do projeto quando existir (`mvnw`, `gradlew`).
3. **Given** um `docker-compose.yml` ou `compose.yaml`, **When** abre "Rodar", **Then** vê "subir" e "derrubar".
4. **Given** um comando escolhido, **When** ele roda, **Then** abre um painel de terminal com a saída, na pasta onde o arquivo foi encontrado, e a linha dele aparece no workspace com "Parar" e "Rodar de novo".
5. **Given** um comando rodando, **When** o usuário clica em "Rodar de novo", **Then** o comando é parado e iniciado de novo no mesmo painel.
6. **Given** um workspace com várias pastas (feature 003), **When** abre "Rodar", **Then** os comandos aparecem agrupados por pasta.
7. **Given** no Linux um wrapper do projeto sem permissão de execução, **When** o usuário escolhe um comando que o usa, **Then** o app pede confirmação para rodá-lo com o interpretador do wrapper; recusando, usa a ferramenta do sistema.
8. **Given** um comando já rodando, **When** o usuário o escolhe de novo no menu, **Then** o painel existente ganha o foco em vez de abrir outra instância.

---

### User Story 2 - Comandos personalizados do workspace (Priority: P2)

O usuário cadastra um comando que o app não detecta (por exemplo, um script interno), com nome, programa, argumentos e pasta, e passa a rodá-lo pelo mesmo menu.

**Why this priority**: cobre projetos fora do padrão; o detectado resolve a maioria.

**Independent Test**: cadastrar "Subir mock" com programa `node` e argumento `mock/server.js`, rodar pelo menu e ver a saída.

**Acceptance Scenarios**:

1. **Given** o menu "Rodar", **When** o usuário cria um comando com nome, programa, argumentos e pasta, **Then** ele aparece no menu do workspace e continua após reabrir o app.
2. **Given** um comando personalizado, **When** o usuário edita ou exclui, **Then** o menu reflete a mudança.
3. **Given** um programa que não existe, **When** o usuário tenta rodar, **Then** aparece "Programa não encontrado" com o nome procurado.

---

### User Story 3 - Abrir no VS Code ou no IntelliJ (Priority: P2)

O usuário abre o workspace, uma pasta ou o arquivo aberto no editor (na linha atual) no VS Code ou no IntelliJ, para depurar ou usar recursos que o Melinna não tem.

**Why this priority**: cobre a depuração e os recursos de IDE sem reconstruí-los no app.

**Independent Test**: com o VS Code instalado, "Abrir no VS Code" num arquivo na linha 42 abre o VS Code naquele arquivo e linha.

**Acceptance Scenarios**:

1. **Given** o VS Code ou o IntelliJ instalados, **When** o usuário escolhe "Abrir no VS Code" ou "Abrir no IntelliJ" num workspace ou pasta, **Then** a IDE abre aquela pasta.
2. **Given** um arquivo aberto no editor do app, **When** escolhe abrir na IDE, **Then** a IDE abre o arquivo na linha do cursor.
3. **Given** a IDE não encontrada, **When** o usuário escolhe abrir nela, **Then** aparece a mensagem com onde o app procurou e a opção de informar o caminho do executável, que fica guardado.
4. **Given** qualquer pasta do workspace, **When** escolhe "Mostrar no explorador de arquivos", **Then** o gerenciador de arquivos do sistema abre na pasta.

### Edge Cases

- Projeto sem nenhum arquivo reconhecido: o menu mostra "Nenhum comando encontrado" e a opção de criar um personalizado.
- `package.json` inválido: o app ignora esse arquivo e mostra o aviso no menu, sem erro.
- Wrapper sem permissão de execução no Linux: roda com o interpretador do wrapper só se o usuário confirmar; senão usa a ferramenta do sistema.
- Mesmo comando escolhido duas vezes (duplo clique ou com ele já rodando): foca o painel existente; para outra instância, o usuário usa "Rodar de novo".
- Pasta de um comando personalizado removida do workspace depois de salvo: o comando aparece desabilitado com "pasta fora do workspace" até ser editado.
- `package.json` sem scripts: nenhum item daquele arquivo, sem aviso.
- Docker Compose antigo (`docker-compose` separado): usado quando `docker compose` não existe.
- `docker compose up` fica em primeiro plano no painel; "Parar" encerra os contêineres como Ctrl+C.
- O projeto mudou entre abrir o menu e escolher o comando (comando não existe mais): recusado com "O comando mudou; abra o menu de novo."
- Nome de script com caracteres especiais (`;`, `&`, `$()`, espaços): passado como está, sem efeito de shell.
- Ferramenta não instalada (npm, mvn, gradle, docker): o item aparece desabilitado com "não encontrado: <nome>".
- Comando que termina sozinho: o painel mostra o código de saída; "Rodar de novo" continua disponível.
- Comando de longa duração com o app fechado: segue rodando como as sessões de agente, e a linha volta ao reabrir.
- Remover o comando ou o workspace com o comando rodando: pede para parar antes.
- Argumentos com espaços e aspas: passados como estão, um por item, sem interpretação de shell.
- Caminho da IDE informado que deixou de existir: volta a procurar e avisa.
- Limite de terminais vivos (o mesmo das sessões de agente): rodar um comando sem vaga é recusado com a mensagem de limite.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST detectar, em cada pasta do workspace, os comandos de `package.json` (scripts, com npm/pnpm/yarn pelo arquivo de lock), Maven (`pom.xml`: compilar, testar, empacotar), Gradle (`build.gradle`/`.kts`: build, test, e `run`/`bootRun` quando o projeto declara a aplicação) e Docker Compose (subir, derrubar).
- **FR-002**: O sistema MUST usar o wrapper do projeto (`mvnw`, `gradlew`) quando existir e puder ser executado sem passar pelo prompt de comando; no Windows, onde o wrapper é um arquivo de lote, MUST usar a ferramenta do sistema e avisar que o wrapper foi ignorado.
- **FR-003**: Rodar um comando MUST abrir um painel de terminal na pasta onde ele foi encontrado (ou na pasta escolhida, para os personalizados), com "Parar" e "Rodar de novo".
- **FR-004**: Comandos MUST ser executados sem interpretação de shell: programa e argumentos separados.
- **FR-005**: Ferramenta ausente MUST deixar o item desabilitado com o nome procurado.
- **FR-006**: O usuário MUST poder criar, editar e excluir comandos personalizados por workspace (nome 1–80, programa, até 64 argumentos, pasta do workspace), persistidos entre aberturas.
- **FR-007**: O sistema MUST abrir workspace, pasta ou arquivo (com linha) no VS Code e no IntelliJ, procurando os executáveis nos locais padrão de cada sistema.
- **FR-008**: Quando a IDE não for encontrada, o sistema MUST mostrar onde procurou e permitir escolher o executável num diálogo do sistema; a escolha fica guardada. No Windows, só programas `.exe` são aceitos.
- **FR-009**: O sistema MUST oferecer "Mostrar no explorador de arquivos" para pastas do workspace.
- **FR-010**: Comandos rodando MUST contar no mesmo limite de terminais vivos das sessões de agente.
- **FR-011**: Remover um comando personalizado ou o workspace com o comando rodando MUST exigir parar antes.
- **FR-012**: Rodar, parar e abrir na IDE MUST ficar registrados para diagnóstico (tipo, workspace, resultado), sem argumentos nem caminhos completos.

### Key Entities

- **Comando do projeto**: nome, origem (detectado ou personalizado), programa, argumentos, pasta.
- **Execução de comando**: um terminal rodando um comando, com estado como as sessões.
- **IDE externa**: tipo (VS Code ou IntelliJ) e caminho do executável (detectado ou informado).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Rodar o comando de desenvolvimento de um projeto Node, Maven ou Gradle leva no máximo 2 ações a partir do workspace.
- **SC-002**: O menu "Rodar" abre em menos de 1 segundo num workspace com até 10 pastas.
- **SC-003**: Abrir um arquivo na IDE externa leva no máximo 2 ações e cai na linha certa.
- **SC-004**: 0 comandos executados através de um shell.

## Assumptions

- Depuração com pontos de parada fica com a IDE externa (nível D do bloco 3 não entra nesta feature).
- Os comandos detectados cobrem o caso comum; personalização fina (perfis do Maven, variáveis de ambiente) fica para depois.
- Fora de escopo: servidores de linguagem (LSP), busca em todos os arquivos, outras IDEs.
