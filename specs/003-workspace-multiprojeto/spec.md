# Feature Specification: Workspace multiprojeto

**Feature Branch**: `003-workspace-multiprojeto`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Workspace multiprojeto (bloco 1 de docs/ideias-proximas-versoes.md): criar um workspace com nome próprio e várias pastas, uma delas a principal, para que um agente aberto nele enxergue e edite todos os projetos na mesma conversa."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criar um workspace com vários projetos (Priority: P1)

O usuário trabalha numa tarefa que atravessa o front, o back e uma biblioteca, cada um numa pasta. Ele cria um workspace "Portal" com as três pastas, marca o back como principal e abre um terminal com o Claude Code. O agente roda na pasta principal e enxerga e edita também as outras duas na mesma conversa.

**Why this priority**: é o motivo da feature: hoje um agente só enxerga uma pasta por vez.

**Independent Test**: criar um workspace com duas pastas, abrir uma sessão com um agente que aceita pastas extras e confirmar que o processo roda na principal e recebe a outra como pasta extra.

**Acceptance Scenarios**:

1. **Given** nenhum workspace, **When** o usuário usa "Novo workspace", dá o nome "Portal", adiciona três pastas e escolhe a principal, **Then** o workspace aparece na barra lateral e nos recentes com o nome "Portal", mostrando as três pastas e qual é a principal.
2. **Given** o workspace "Portal" com três pastas, **When** o usuário abre um terminal com um agente que aceita pastas extras, **Then** o terminal roda na pasta principal e o agente recebe as outras duas como pastas extras.
3. **Given** o diálogo "Novo workspace" com pastas adicionadas, **When** o usuário não escolhe a principal, **Then** a primeira pasta adicionada é a principal.
4. **Given** o diálogo "Novo workspace", **When** o usuário tenta criar sem nenhuma pasta ou sem nome, **Then** a criação é bloqueada com uma mensagem dizendo o que falta.

---

### User Story 2 - Editar as pastas de um workspace (Priority: P2)

O usuário percebe que esqueceu um projeto. Ele abre a edição do workspace, adiciona a pasta, troca qual é a principal ou tira uma pasta que não usa mais, e renomeia o workspace.

**Why this priority**: sem editar, qualquer erro na criação obriga a apagar e recriar o workspace e perder as sessões.

**Independent Test**: num workspace existente, adicionar uma pasta, remover outra, trocar a principal e renomear; conferir que o estado salvo e a barra lateral refletem tudo após reabrir o app.

**Acceptance Scenarios**:

1. **Given** um workspace com duas pastas, **When** o usuário adiciona uma terceira, **Then** ela aparece no workspace e entra nas sessões abertas a partir de então.
2. **Given** um workspace com sessões vivas, **When** o usuário adiciona, remove ou troca a principal, **Then** as sessões vivas continuam rodando sem relançar e a interface avisa que a mudança vale para terminais novos.
3. **Given** um workspace com uma pasta só, **When** o usuário tenta removê-la, **Then** a remoção é recusada: todo workspace tem ao menos uma pasta.
4. **Given** um workspace, **When** o usuário remove a pasta principal, **Then** a próxima pasta da lista vira a principal e a interface mostra qual é.
5. **Given** a edição de um workspace, **When** o usuário remove pastas ou o próprio workspace, **Then** nenhuma pasta é apagada do disco.

---

### User Story 3 - Navegar e ver o git de todas as pastas (Priority: P3)

Na aba Arquivos, o usuário vê uma raiz por pasta do workspace, com o nome de cada uma e a decoração de git (alterado, novo, removido) de cada repositório.

**Why this priority**: complementa o fluxo principal; o agente já funciona sem isso, mas o usuário perde a visão do que mudou em cada projeto.

**Independent Test**: com um workspace de duas pastas git, alterar um arquivo em cada uma e conferir que a aba Arquivos mostra as duas raízes com as marcas corretas.

**Acceptance Scenarios**:

1. **Given** um workspace com três pastas, **When** o usuário abre a aba Arquivos, **Then** aparecem três raízes, a principal primeiro e marcada como principal.
2. **Given** uma das pastas não é repositório git, **When** a aba Arquivos é aberta, **Then** essa raiz aparece sem decoração de git e sem erro.

---

### User Story 4 - Saber quando um agente não aceita pastas extras (Priority: P3)

O usuário abre um shell ou um agente que não aceita pastas extras num workspace multiprojeto. A interface avisa que só a pasta principal está disponível para aquele terminal.

**Why this priority**: evita que o usuário ache que o agente enxerga tudo quando não enxerga.

**Independent Test**: num workspace com duas pastas, abrir um shell e conferir que ele roda na principal e que o aviso aparece.

**Acceptance Scenarios**:

1. **Given** um workspace com mais de uma pasta, **When** o usuário abre um terminal com um agente sem suporte a pastas extras, **Then** o terminal abre na principal e a interface mostra o aviso "só a pasta principal" para aquela execução.
2. **Given** um workspace com uma pasta só, **When** qualquer agente é aberto, **Then** nenhum aviso aparece.

### Edge Cases

- Pasta adicionada já está no workspace: é recusada com mensagem, sem duplicar.
- Mesma pasta em dois workspaces diferentes: é permitido; cada workspace tem a sua lista.
- Pasta do workspace foi apagada ou renomeada no disco: o workspace continua listado; a pasta aparece como indisponível; abrir terminal com a principal indisponível é recusado com mensagem; pasta extra indisponível é omitida do lançamento com aviso.
- Pasta dentro de um repositório git: é guardada como escolhida (não sobe para a raiz do repositório) quando o usuário a adiciona pela edição; o "Abrir workspace" de uma pasta só mantém o comportamento atual (raiz do repositório).
- Workspace sem nome ou nome só com espaços: recusado.
- Caminhos com espaços e acentos: funcionam no lançamento e no explorador.
- Muitas pastas: o lançamento respeita o limite de tamanho da linha de comando do sistema; se a lista de pastas extras não couber, o lançamento é recusado com mensagem clara, sem truncar em silêncio.
- Estado salvo por uma versão anterior (workspace com uma pasta): é lido como workspace de uma pasta principal, sem perder sessões; uma cópia do estado anterior é guardada antes da primeira gravação no formato novo.
- Pasta existe mas sem permissão de leitura: tratada como indisponível.
- Nome de pasta com o caractere que um agente usa para separar a lista de pastas: a pasta não é passada àquele agente e a execução mostra o aviso de pasta omitida.
- Editar o workspace enquanto um terminal está sendo aberto: o terminal usa as pastas do momento em que começou a abrir; edições seguidas são aplicadas na ordem.
- Relançar uma sessão cuja pasta extra sumiu: a pasta é omitida com aviso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir criar um workspace com nome e uma ou mais pastas, sendo exatamente uma delas a principal.
- **FR-002**: O sistema MUST usar a primeira pasta adicionada como principal quando o usuário não escolher outra.
- **FR-003**: O sistema MUST permitir, num workspace existente, adicionar pasta, remover pasta, trocar a principal e renomear.
- **FR-004**: O sistema MUST recusar remover a última pasta de um workspace e recusar pasta duplicada no mesmo workspace.
- **FR-005**: O sistema MUST permitir a mesma pasta em mais de um workspace.
- **FR-006**: Ao remover a pasta principal, o sistema MUST promover a próxima pasta da lista a principal; se a removida era a última da lista, a anterior.
- **FR-007**: Toda sessão nova de um workspace MUST rodar com a pasta principal como diretório de trabalho.
- **FR-008**: Para agentes que declaram suporte a pastas extras, o sistema MUST entregar ao agente, no lançamento, acesso a todas as pastas não principais disponíveis.
- **FR-009**: O suporte a pastas extras MUST ser uma capacidade opcional declarada por agente; acrescentar suporte a um agente não exige mudar o motor.
- **FR-010**: Para agentes sem essa capacidade, o sistema MUST lançar só na pasta principal e indicar na interface que aquela execução enxerga só a principal.
- **FR-011**: Mudanças nas pastas de um workspace MUST valer para sessões novas; sessões vivas MUST continuar rodando sem relançar, e a interface MUST avisar que a mudança vale para terminais novos.
- **FR-012**: O explorador de arquivos MUST mostrar uma raiz por pasta do workspace, a principal primeiro e identificada, com a decoração de git de cada repositório.
- **FR-013**: Remover pasta ou workspace MUST NOT apagar nada do disco.
- **FR-014**: O estado salvo por versões anteriores MUST ser migrado automaticamente: cada workspace existente vira um workspace de uma pasta, que é a principal, sem perder sessões nem histórico.
- **FR-015**: Pasta indisponível no disco MUST aparecer como indisponível; lançar com a principal indisponível MUST ser recusado com mensagem; pasta extra indisponível MUST ser omitida do lançamento com aviso.
- **FR-016**: Se as pastas extras não couberem no limite de linha de comando do sistema, o lançamento MUST ser recusado com mensagem clara, sem truncar.
- **FR-017**: Nome do workspace MUST ter de 1 a 80 caracteres, sem quebra de linha.
- **FR-019**: Um workspace MUST ter no máximo 32 pastas.
- **FR-020**: Relançar uma sessão MUST usar as pastas do momento em que ela foi criada; pasta desse conjunto que não estiver mais disponível MUST ser omitida com aviso, como no lançamento novo.
- **FR-021**: Pasta sem permissão de leitura MUST ser tratada como indisponível.
- **FR-022**: Edições de um mesmo workspace MUST ser aplicadas uma de cada vez, na ordem; um lançamento em andamento usa as pastas do momento em que começou.
- **FR-018**: Toda criação, edição e remoção de workspace MUST ficar registrada para diagnóstico, sem expor os caminhos das pastas (só identificador e contagem).

### Key Entities

- **Workspace**: nome, lista ordenada de pastas, identificação da pasta principal, cor, data da última abertura. Pode conter sessões.
- **Pasta do workspace**: caminho absoluto; se é a principal; se está disponível no disco no momento.
- **Capacidade de pastas extras do agente**: se o agente aceita pastas extras e como as recebe (detalhado no plano).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O usuário cria um workspace com três pastas e abre o primeiro terminal nele em menos de 1 minuto.
- **SC-002**: Em 100% dos lançamentos com agentes que declaram a capacidade, o agente recebe todas as pastas extras disponíveis do workspace.
- **SC-003**: Abrir o app com estado salvo pela versão anterior preserva 100% dos workspaces, sessões e históricos.
- **SC-004**: Nenhuma operação desta feature apaga ou altera arquivos nas pastas do usuário.
- **SC-005**: A aba Arquivos mostra as raízes de um workspace com 10 pastas em menos de 2 segundos após ser aberta (alvo de desempenho; o limite funcional é 32 pastas).

## Assumptions

- A forma exata de cada agente receber pastas extras é conferida na versão instalada antes de declarar o suporte (primeira task da implementação); agente sem confirmação fica sem o suporte e mostra o aviso.
- O histórico de conversas do agente fica atrelado à pasta principal, por isso trocar a principal muda o histórico que os terminais novos enxergam; isso é aceito e informado na interface.
- "Abrir workspace" e "Novo terminal" da tela inicial continuam criando ou reaproveitando workspaces de uma pasta, como hoje.
- Fora de escopo: sessões legadas em worktree (continuam como estão), sincronização entre máquinas, arrastar pastas para dentro do workspace.
