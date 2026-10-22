# Feature Specification: Git na interface, no estilo do IntelliJ

**Feature Branch**: `006-git-na-interface`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Git na interface no estilo do IntelliJ (bloco 5 de docs/ideias-proximas-versoes.md): commit, push, pull, fetch, merge e branches sem sair do Melinna, com uma janela de commit como a do IntelliJ."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Commitar pela janela de commit (Priority: P1)

O agente alterou vários arquivos. O usuário abre a janela de commit do workspace, vê os arquivos alterados agrupados por pasta, marca os que entram, olha o diff de cada um, escreve a mensagem e clica em "Commit" (ou "Commit and Push").

**Why this priority**: é o passo que o usuário repete depois de cada tarefa de agente; hoje exige sair para outra ferramenta.

**Independent Test**: num repositório com três arquivos alterados, commitar dois pela janela e conferir que o commit tem só os dois e a mensagem escrita.

**Acceptance Scenarios**:

1. **Given** um repositório com arquivos alterados, novos e removidos, **When** o usuário abre a janela de commit, **Then** vê todos agrupados por pasta, com o tipo de mudança, e todos marcados.
2. **Given** a janela aberta, **When** o usuário clica num arquivo, **Then** vê o diff dele.
3. **Given** dois de três arquivos marcados e uma mensagem, **When** clica em "Commit", **Then** o commit contém só os dois, com a mensagem, e a janela mostra o arquivo que ficou de fora.
4. **Given** nenhum arquivo marcado ou mensagem vazia, **When** tenta commitar, **Then** o botão fica bloqueado com a indicação do que falta.
5. **Given** a opção "Amend" marcada, **When** commita, **Then** o último commit é refeito com os arquivos e a mensagem; se o último commit já foi enviado ao remoto, a interface pede confirmação explicando que será preciso forçar o envio, e o app não força.
6. **Given** um terminal de agente vivo no mesmo workspace, **When** o usuário abre a janela de commit, **Then** aparece o aviso de que o agente pode estar alterando arquivos.

---

### User Story 2 - Sincronizar com o remoto (Priority: P1)

O usuário vê na barra do workspace a branch atual e quantos commits está à frente e atrás do remoto, e usa os botões fetch, pull e push.

**Why this priority**: commit sem push não chega à equipe; é o par natural da US1.

**Independent Test**: com um remoto local, fazer um commit e um push pela interface e conferir que o remoto recebeu; criar um commit no remoto e puxar com pull.

**Acceptance Scenarios**:

1. **Given** um repositório com remoto, **When** o workspace é aberto, **Then** a barra mostra a branch, "↑ N ↓ M" e quando foi o último fetch.
2. **Given** commits locais não enviados, **When** o usuário clica em push, **Then** eles são enviados e o contador volta a ↑ 0.
3. **Given** a branch atual é a principal do remoto (main/master), **When** o usuário faz push, **Then** a interface pede confirmação antes.
4. **Given** commits no remoto, **When** o usuário clica em pull, **Then** eles são integrados; se houver conflito, a interface lista os arquivos em conflito (ver US3).
5. **Given** o remoto pede credenciais que não estão configuradas, **When** a operação roda, **Then** ela falha com mensagem explicando como configurar, sem travar a interface.
6. **Given** uma operação demorada, **When** ela está em andamento, **Then** o botão mostra progresso e pode ser cancelado.

---

### User Story 3 - Branches e merge (Priority: P2)

O usuário lista as branches, cria uma nova, troca de branch e mescla outra branch na atual. Em conflito, vê os arquivos em conflito, abre cada um no editor e marca como resolvido.

**Why this priority**: necessário para fluxos com mais de uma branch, mas menos frequente que commitar e sincronizar.

**Independent Test**: criar uma branch, commitar nela, voltar para a principal e mesclá-la; repetir com um conflito e resolvê-lo pelo editor.

**Acceptance Scenarios**:

1. **Given** o seletor de branch, **When** o usuário abre, **Then** vê as branches locais e remotas, a atual marcada.
2. **Given** um nome válido, **When** cria uma branch, **Then** ela é criada a partir da atual e passa a ser a atual.
3. **Given** alterações não commitadas, **When** o usuário troca de branch, **Then** a interface pede confirmação listando as alterações; se o git recusar por conflito com as alterações, a troca não acontece e a mensagem explica.
4. **Given** outra branch, **When** o usuário mescla na atual, **Then** o merge acontece; com conflito, a lista de conflitos aparece com "Abrir no editor", "Marcar como resolvido" e "Abortar merge".
5. **Given** todos os conflitos marcados como resolvidos, **When** o usuário conclui, **Then** a janela de commit abre com a mensagem de merge preenchida.

---

### User Story 4 - Histórico (Priority: P3)

O usuário vê a lista de commits da branch, com autor, data, mensagem e arquivos de cada commit, e o diff de um arquivo de um commit.

**Why this priority**: consulta útil, mas não bloqueia o fluxo diário.

**Independent Test**: num repositório com cinco commits, ver os cinco na lista e o diff de um arquivo do terceiro.

**Acceptance Scenarios**:

1. **Given** um repositório, **When** abre o histórico, **Then** vê os últimos 200 commits da branch atual, mais recentes primeiro, com carregar mais.
2. **Given** um commit selecionado, **When** clica num arquivo, **Then** vê o diff daquele arquivo naquele commit.

### Edge Cases

- Pasta do workspace não é repositório git: a barra de git e a janela de commit não aparecem; nenhum erro.
- Repositório sem remoto: fetch, pull e push ficam desabilitados com a explicação.
- Branch sem upstream: o primeiro push oferece criar o upstream no remoto padrão.
- Repositório no meio de merge iniciado fora do app: a barra mostra o estado e oferece a lista de conflitos, concluir pela janela de commit ou abortar (com confirmação).
- Repositório no meio de rebase ou cherry-pick iniciado fora do app: a barra mostra o estado e a instrução para concluir fora do app; o app não aborta nem continua.
- Outro processo do git usando o repositório (por exemplo, um agente rodando git na mesma pasta): a operação falha com mensagem para tentar de novo, sem travar.
- Pasta sem permissão de escrita: a operação falha com a mensagem do git.
- Trocar para uma branch que só existe no remoto: cria a branch local acompanhando a remota.
- Commit durante um merge: todos os arquivos entram; a janela não deixa desmarcar.
- Commit que falha (hook, identidade, repositório ocupado): os arquivos marcados voltam ao estado em que estavam antes da tentativa.
- HEAD destacado (detached): a barra mostra o commit e não oferece push.
- Commit sem nome/e-mail configurados no git: falha com mensagem explicando como configurar.
- Hooks do git (pre-commit) que falham: a saída do hook aparece e o commit não acontece.
- Arquivo muito grande ou binário: a janela mostra "binário" ou "grande demais para mostrar", sem travar.
- Push rejeitado por haver commits novos no remoto: mensagem sugerindo pull; o app nunca força.
- Nome de branch inválido: recusado com a regra do git explicada.
- Workspace com várias pastas (feature 003): uma barra de git por pasta que for repositório.
- Duas operações no mesmo repositório ao mesmo tempo: a segunda espera a primeira terminar.
- Descartar alterações de um arquivo: pede confirmação mostrando o arquivo e diz que não há como desfazer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema MUST mostrar, para cada pasta do workspace que for repositório git, a branch atual, os commits à frente e atrás do upstream e o momento do último fetch.
- **FR-002**: A janela de commit MUST listar os arquivos alterados, novos, removidos e renomeados, agrupados por pasta, com seleção por arquivo e por pasta, e mostrar o diff do arquivo escolhido.
- **FR-003**: O commit MUST incluir exatamente os arquivos marcados e a mensagem escrita; arquivos não marcados ficam como estavam.
- **FR-004**: "Commit and Push" MUST commitar e, se o commit der certo, enviar.
- **FR-005**: "Amend" MUST refazer o último commit; se ele já estiver no remoto, MUST pedir confirmação avisando que o envio vai falhar sem forçar, e o app MUST NOT forçar o envio.
- **FR-006**: Fetch, pull e push MUST rodar por ação explícita do usuário, mostrar progresso, poder ser cancelados e mostrar o resultado ou o erro do git.
- **FR-007**: Push para a branch principal do remoto MUST pedir confirmação.
- **FR-008**: Pull MUST integrar com merge por padrão (sem rebase) e, em conflito, mostrar a lista de conflitos.
- **FR-009**: O sistema MUST listar, criar, trocar e mesclar branches; trocar com alterações pendentes MUST pedir confirmação listando-as.
- **FR-010**: Em conflito, o sistema MUST listar os arquivos, permitir abrir cada um no editor do app, marcar como resolvido e abortar o merge; abortar MUST pedir confirmação avisando que as resoluções feitas se perdem.
- **FR-018**: Merge e pull com alterações não commitadas MUST pedir confirmação listando os arquivos.
- **FR-019**: Se um commit falhar, os arquivos MUST voltar ao estado em que estavam antes da tentativa.
- **FR-011**: Descartar alterações MUST pedir confirmação mostrando cada arquivo e a ação: apagar (arquivo novo) ou reverter ao último commit (alterado ou removido); arquivo renomeado volta ao nome antigo.
- **FR-012**: O sistema MUST NOT oferecer force push, reset ou rebase nesta versão.
- **FR-013**: O sistema MUST NOT guardar credenciais; operações que precisam de credencial não configurada MUST falhar com mensagem, sem travar.
- **FR-014**: Com terminal de agente vivo no workspace, a janela de commit MUST avisar que arquivos podem estar mudando.
- **FR-015**: Operações no mesmo repositório MUST ser executadas uma de cada vez.
- **FR-016**: O histórico MUST mostrar commits da branch atual (200 por vez), com autor, data, mensagem, arquivos e diff por arquivo.
- **FR-017**: Toda operação de git MUST ficar registrada para diagnóstico (operação, repositório, resultado e duração), sem mensagens de commit nem conteúdo de arquivos.

### Key Entities

- **Repositório do workspace**: pasta git com branch atual, upstream, à frente/atrás, estado (normal, merge em andamento, detached).
- **Mudança**: arquivo com tipo (alterado, novo, removido, renomeado, em conflito) e se está marcado para o commit.
- **Branch**: nome, local ou remota, se é a atual, upstream.
- **Commit**: hash, autor, data, mensagem, arquivos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Commitar e enviar as alterações de uma tarefa exige no máximo 4 ações (abrir, marcar, escrever a mensagem, Commit and Push).
- **SC-002**: A janela de commit abre em menos de 2 segundos com até 500 arquivos alterados.
- **SC-003**: Todas as operações que podem perder trabalho (descartar, trocar com pendências, merge e pull com pendências, abortar merge, amend publicado) pedem confirmação antes de agir, verificado por teste para cada uma.
- **SC-004**: Nenhuma credencial é gravada pelo app.

## Assumptions

- O git instalado na máquina é usado (versão 2.30+), com as credenciais já configuradas pelo usuário (Git Credential Manager, SSH etc.).
- Gerar a mensagem de commit pelo agente fica para uma fatia seguinte (exige ler a resposta do agente de forma confiável).
- Fora de escopo: rebase, cherry-pick, stash, tags, force push, editor de conflitos de três vias, git LFS.
