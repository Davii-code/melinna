# Feature Specification: Orquestrador de prompts (primeira fatia)

**Feature Branch**: `005-orquestrador-prompts`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Orquestrador de prompts, primeira fatia (bloco 2 de docs/ideias-proximas-versoes.md): biblioteca de prompts com variáveis, enviar o mesmo prompt para várias sessões e fila de prompts por sessão."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Biblioteca de prompts com variáveis (Priority: P1)

O usuário guarda os prompts que repete (revisar um PR, escrever testes, gerar mensagem de commit), com variáveis como `{{arquivo}}`. Para usar, escolhe o prompt, preenche as variáveis e envia para o terminal em foco.

**Why this priority**: é a base das outras histórias e já economiza tempo sozinha.

**Independent Test**: criar um prompt com uma variável, usá-lo num terminal, preencher a variável e ver o texto final chegar ao agente.

**Acceptance Scenarios**:

1. **Given** a biblioteca vazia, **When** o usuário cria o prompt "Revisar" com o texto "Revise {{arquivo}} e aponte riscos", **Then** ele aparece na biblioteca com a variável `arquivo` detectada.
2. **Given** o prompt "Revisar" e um terminal de agente em foco, **When** o usuário escolhe usá-lo, **Then** um formulário pede `arquivo`; ao confirmar, o texto final é enviado ao agente como se fosse digitado e confirmado.
3. **Given** um prompt com as variáveis automáticas `{{pasta}}`, `{{workspace}}` ou `{{data}}`, **When** é usado, **Then** elas são preenchidas sozinhas com a pasta da sessão, o nome do workspace e a data de hoje, sem perguntar.
4. **Given** um prompt existente, **When** o usuário edita, duplica ou exclui, **Then** a biblioteca reflete a mudança e ela continua após reabrir o app.
5. **Given** um prompt do escopo de um workspace, **When** o usuário está em outro workspace, **Then** esse prompt não aparece; prompts globais aparecem em todos.

---

### User Story 2 - Enviar para várias sessões (Priority: P2)

O usuário quer a mesma revisão feita por três agentes. Escolhe um prompt (ou escreve um texto), marca as sessões vivas que vão receber e envia para todas de uma vez.

**Why this priority**: é o "um feixe entra, seis saem" aplicado a prompts; depende da US1 para reaproveitar o formulário.

**Independent Test**: com três terminais vivos, enviar um texto para dois deles e conferir que só esses dois receberam.

**Acceptance Scenarios**:

1. **Given** três sessões vivas, **When** o usuário escolhe "Enviar para várias", marca duas e envia, **Then** só as duas recebem o texto, e a interface mostra o resultado por sessão.
2. **Given** a seleção de mais de uma sessão, **When** o usuário vai enviar, **Then** uma confirmação mostra quantas e quais sessões vão receber.
3. **Given** uma sessão que terminou entre a escolha e o envio, **When** o envio acontece, **Then** ela é marcada como "não enviado: sessão encerrada" e as demais recebem normalmente.

---

### User Story 3 - Fila de prompts por sessão (Priority: P3)

O agente está ocupado. O usuário enfileira o próximo prompt para aquela sessão; quando o agente fica ocioso, o prompt é enviado sozinho.

**Why this priority**: útil para encadear trabalho sem ficar olhando o terminal, mas não é essencial.

**Independent Test**: com o agente ocupado, enfileirar dois prompts; ao ficar ocioso, o primeiro é enviado; ao ficar ocioso de novo, o segundo.

**Acceptance Scenarios**:

1. **Given** uma sessão ocupada, **When** o usuário enfileira um prompt, **Then** a sessão mostra "1 na fila" e nada é enviado ainda.
2. **Given** uma sessão com fila, **When** ela fica ociosa, **Then** o primeiro da fila é enviado e sai da fila; o próximo espera a próxima ociosidade.
3. **Given** uma fila com itens, **When** o usuário remove um item ou limpa a fila, **Then** os itens saem sem serem enviados.
4. **Given** uma sessão com fila, **When** ela termina ou é removida, **Then** a fila é descartada e a interface informa quantos itens foram descartados.
5. **Given** uma sessão ociosa e fila vazia, **When** o usuário enfileira, **Then** o prompt é enviado na hora.

### Edge Cases

- Prompt com variável não preenchida: o envio fica bloqueado até preencher (vazio é permitido só se o usuário marcar "deixar vazio").
- Variável com nome inválido (fora de letras, números e `_`): tratada como texto comum, não como variável.
- Texto com várias linhas: chega ao agente como um bloco só e é confirmado uma vez.
- Prompt maior que o limite (100.000 caracteres): recusado ao salvar e ao enviar.
- Sessão de shell: recebe o texto como comandos; a interface avisa antes de enviar para shells.
- Enviar para várias sessões com uma delas em modo sem confirmações: a confirmação destaca essa sessão.
- O app fecha com itens na fila: a fila é guardada e retomada quando o app reabre (na abertura, se a sessão já estiver ociosa).
- Duas ociosidades seguidas muito próximas: cada item é enviado uma vez só.
- Prompt excluído que está na fila: o item da fila mantém o texto já resolvido e é enviado normalmente.
- Workspace removido: prompts do escopo dele são removidos junto, com confirmação que informa quantos.
- Texto com caracteres de controle (por exemplo, copiado de um terminal): recusado com mensagem.
- Variável repetida no texto: pedida uma vez e usada em todas as ocorrências.
- Valor de variável que contém `{{outra}}`: entra literal, sem ser preenchido de novo.
- Sessão ainda iniciando: o envio para ela volta "não pronta"; enfileirar é a alternativa.
- Dois envios ao mesmo tempo para a mesma sessão: chegam um depois do outro, sem misturar.
- `{{pasta}}` numa sessão antiga em worktree: usa a pasta onde aquela sessão roda.
- App reabre com fila e a sessão já ociosa: o primeiro item é enviado na abertura.
- A fila só anda com o app aberto.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST permitir criar, editar, duplicar e excluir prompts com nome (1 a 80 caracteres), texto (até 100.000 caracteres) e escopo (global ou de um workspace).
- **FR-002**: O sistema MUST detectar variáveis no formato `{{nome}}` (letras, números e `_`) e pedir o valor de cada uma no uso.
- **FR-003**: As variáveis `{{pasta}}`, `{{workspace}}` e `{{data}}` MUST ser preenchidas automaticamente a partir de cada sessão de destino; ao enviar para várias sessões, cada uma recebe os próprios valores.
- **FR-004**: Usar um prompt MUST enviar o texto final à sessão como uma única entrada confirmada.
- **FR-005**: A biblioteca MUST persistir entre aberturas do app e mostrar, em cada workspace, os prompts globais e os daquele workspace.
- **FR-006**: O sistema MUST permitir enviar um texto ou prompt a várias sessões vivas escolhidas, com confirmação que lista as sessões quando forem mais de uma.
- **FR-007**: O resultado do envio MUST ser mostrado por sessão (enviado ou motivo de não envio).
- **FR-008**: O sistema MUST manter uma fila de prompts por sessão, enviando o primeiro item quando a sessão fica ociosa e um item por ociosidade.
- **FR-009**: O usuário MUST poder ver, remover itens e limpar a fila de uma sessão.
- **FR-010**: A fila MUST sobreviver ao fechamento do app e ser descartada, com aviso, quando a sessão termina ou é removida.
- **FR-011**: Itens da fila MUST guardar o texto já resolvido (com variáveis preenchidas) no momento de enfileirar.
- **FR-012**: Antes de enviar texto a uma sessão de shell, o sistema MUST avisar que o texto será executado como comando.
- **FR-013**: O conteúdo e o nome dos prompts MUST NOT aparecer em logs.
- **FR-014**: Prompts, valores de variáveis e textos enviados MUST NOT conter caracteres de controle (exceto quebra de linha e tabulação); o sistema recusa com mensagem.
- **FR-015**: Cada item da fila MUST ser enviado no máximo uma vez; se não puder ser entregue (sessão parou), MUST ser descartado com aviso.

### Key Entities

- **Prompt**: nome, texto, escopo (global ou workspace), variáveis detectadas, datas de criação e alteração.
- **Item de fila**: sessão de destino, texto resolvido, momento em que entrou na fila.
- **Envio**: sessões de destino e resultado por sessão (não persistido).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Usar um prompt salvo com uma variável leva no máximo 3 ações (escolher, preencher, enviar).
- **SC-002**: Enviar o mesmo prompt para 6 sessões exige uma única escolha de destinos e uma única confirmação.
- **SC-003**: 0 itens enfileirados enviados mais de uma vez; todo item não enviado é descartado com aviso.
- **SC-004**: 0 ocorrências do texto de prompts nos logs do app.

## Assumptions

- "Ocioso" usa a detecção de ocupado/ocioso que o app já tem para as sessões.
- Pipelines (etapas encadeadas com o resultado de uma alimentando a outra) e histórico/comparação de execuções ficam para a segunda fatia.
- A biblioteca é local da máquina; compartilhar com a equipe (arquivo no repositório) fica para depois.
- Fora de escopo: variáveis com valores calculados por comando, prompts com anexos de imagem.
