# Feature Specification: Configurações de execução e edição de código no estilo de IDE

**Feature Branch**: `009-execucao-e-editor`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "Duas frentes por cima da 007 (rodar projeto) e do editor da 002. (A) Configurações de execução no estilo do IntelliJ, com o visual Melinna: janela com árvore de configurações salvas agrupadas por ferramenta, formulário com nome, pasta, script, argumentos, opções do runtime, variáveis de ambiente, antes de lançar e várias instâncias; o seletor da barra superior lista só as configurações salvas. (B) Edição manual de código melhor: decidir no research entre o modelo do VS Code e o do IntelliJ e trazer ir para linha, ir para símbolo, busca no projeto, multicursor, editor dividido, marcas do git na margem, gestão de abas e atalhos do mapa escolhido, respeitando a constitution."

## Contexto

A feature 007 deixou o app rodar o projeto: ela detecta scripts (npm, maven, gradle, compose) e permite configurações personalizadas com programa, argumentos e pasta. Hoje o seletor da barra superior mostra todos os scripts detectados de todos os workspaces, o que vira uma lista longa e sem foco, e uma configuração não aceita variáveis de ambiente, opções do runtime, um passo antes de lançar nem mais de uma instância. O dono do projeto usa o IntelliJ e quer o mesmo modelo de "configurações de execução", com o visual Melinna.

O editor da 002 já abre arquivos em abas, salva só por ação explícita (com conflito detectado) e busca no arquivo. Para editar código à mão no dia a dia faltam navegação (ir para linha, para símbolo, busca no projeto), edição múltipla, editor dividido e a visão do que mudou desde o último commit. Esta feature escolhe um modelo de referência (VS Code ou IntelliJ) para que o editor tenha um comportamento coerente, e implementa os itens acima sem mudar as regras de escrita da constitution.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Janela de configurações de execução (Priority: P1)

O usuário abre "Editar configurações…" no seletor de execução. Uma janela mostra, à esquerda, as configurações salvas do workspace ativo em árvore, agrupadas pela ferramenta (npm, Maven/Spring Boot, Gradle, Compose, Programa), e à direita o formulário da configuração escolhida. Ele cria uma configuração a partir de um script detectado, ajusta argumentos, opções do runtime e variáveis de ambiente, e confirma.

**Why this priority**: é a base da frente A; sem configurações salvas e editáveis, o seletor não tem o que listar.

**Independent Test**: num workspace com um `package.json`, abrir a janela, criar uma configuração do script `start` com a variável `PORT=4000`, confirmar com OK, fechar e reabrir o app: a configuração continua lá com a variável.

**Acceptance Scenarios**:

1. **Given** um workspace ativo, **When** o usuário abre "Editar configurações…", **Then** a janela lista as configurações salvas do workspace em árvore por ferramenta, com a configuração ativa selecionada, e o formulário dela à direita.
2. **Given** a janela aberta, **When** o usuário usa "+", **Then** escolhe a ferramenta (ou "a partir de um script detectado") e uma configuração nova aparece selecionada, com nome sugerido e os campos padrão da ferramenta.
3. **Given** uma configuração selecionada, **When** o usuário usa "Copiar", **Then** uma cópia aparece logo abaixo com o nome seguido de "(cópia)" e os mesmos campos.
4. **Given** uma configuração selecionada, **When** o usuário usa "−", **Then** ela sai da lista depois de uma confirmação que diz o nome dela; uma configuração rodando não pode ser removida enquanto roda.
5. **Given** a árvore, **When** o usuário cria uma pasta e arrasta (ou move por menu) configurações para ela, **Then** elas aparecem agrupadas dentro da pasta, sob a mesma ferramenta.
6. **Given** a árvore, **When** o usuário usa "Ordenar", **Then** as configurações de cada grupo ficam em ordem alfabética.
7. **Given** o formulário, **When** o usuário preenche nome, pasta do workspace, script ou programa, argumentos, opções do runtime e variáveis de ambiente (pares nome=valor, com adicionar e remover), **Then** os campos são validados enquanto ele digita, com a mensagem junto do campo.
8. **Given** alterações no formulário, **When** o usuário clica em "Aplicar", **Then** elas são gravadas e a janela continua aberta; "OK" grava e fecha; "Cancelar" descarta o que não foi aplicado, perguntando antes se havia alteração.
9. **Given** uma configuração no formulário, **When** o usuário clica em "Rodar", **Then** as alterações são aplicadas e a configuração roda.
10. **Given** a ferramenta npm, **When** o usuário escolhe a pasta (uma das pastas do workspace), **Then** a lista de scripts é a que o app já detectou naquela pasta; nas ferramentas Maven/Gradle, os objetivos/tarefas comuns são sugeridos (`clean`, `install`, `test`, `spring-boot:run`; `build`, `test`, `bootRun`) e o campo aceita texto livre, separado em argumentos por espaço (aspas agrupam).
11. **Given** a árvore, **When** o usuário usa o teclado, **Then** consegue navegar, renomear, copiar, remover e "Mover para pasta…" pelo menu da linha, sem depender de arrastar.

---

### User Story 2 - Seletor com as configurações salvas e lançamento completo (Priority: P1)

Na barra superior, o seletor de execução mostra só as configurações salvas do workspace ativo, agrupadas por ferramenta. Ao rodar, o app usa as variáveis de ambiente e as opções do runtime da configuração, executa antes a configuração indicada em "antes de lançar" e, se a configuração permitir várias instâncias, abre mais uma em vez de reaproveitar a que já roda.

**Why this priority**: é o que o usuário usa várias vezes por dia; a lista de scripts detectados hoje esconde o que ele realmente roda.

**Independent Test**: com duas configurações salvas e dez scripts detectados, abrir o seletor e ver só as duas; rodar uma com `PORT=4000` e ver no terminal o processo com essa variável.

**Acceptance Scenarios**:

1. **Given** configurações salvas, **When** o usuário abre o seletor, **Then** vê só elas, agrupadas por ferramenta, a ativa marcada e as que estão rodando indicadas; no fim, "Editar configurações…" e "Adicionar a partir de um script detectado…".
2. **Given** nenhuma configuração salva no workspace ativo, **When** o usuário abre o seletor, **Then** vê "Nenhuma configuração" e as duas ações acima.
3. **Given** "Adicionar a partir de um script detectado…", **When** o usuário escolhe um script, **Then** uma configuração é salva com os valores do script, passa a ser a ativa e aparece no seletor.
4. **Given** uma configuração com variáveis de ambiente e opções do runtime, **When** ela roda, **Then** o processo recebe o ambiente do app mais as variáveis da configuração (as da configuração vencem em caso de nome repetido) e as opções do runtime.
5. **Given** uma configuração com "antes de lançar" apontando para outra, **When** o usuário a roda, **Then** a outra roda primeiro num terminal visível; quando termina com sucesso, a principal começa; se termina com erro ou é cancelada, a principal não roda e o motivo aparece.
6. **Given** uma configuração sem "permitir várias instâncias" que já roda, **When** o usuário a roda de novo, **Then** o app mostra o terminal dela, como na 007; com a opção ligada, abre mais uma instância em outro terminal.
7. **Given** configurações personalizadas criadas na 007, **When** o usuário abre o app depois da atualização, **Then** elas aparecem como configurações salvas, com os mesmos programa, argumentos e pasta, e a configuração ativa continua a mesma.
8. **Given** a configuração ativa, **When** o usuário usa os atalhos de rodar e parar do mapa escolhido (007), **Then** eles agem sobre ela como antes.

---

### User Story 3 - Navegar e editar código com produtividade (Priority: P2)

No editor do app, o usuário vai direto a uma linha ou a uma função do arquivo, busca um texto em todos os arquivos do workspace, edita várias ocorrências de uma vez e reabre a aba que fechou sem querer. Os atalhos seguem o mapa escolhido na 007, e o comportamento segue o modelo de referência decidido no research.

**Why this priority**: torna o editor útil para ajustes manuais sem sair do app; depende só do editor que já existe.

**Independent Test**: abrir um arquivo TypeScript, ir para a linha 120 por atalho, ir para uma função pelo nome, selecionar uma palavra e as duas próximas ocorrências, digitar e ver as três mudarem; buscar um texto no workspace e abrir um resultado na linha certa.

**Acceptance Scenarios**:

1. **Given** um arquivo aberto, **When** o usuário usa "Ir para linha" e digita `120` (ou `120:5`), **Then** o cursor vai para a linha 120 (coluna 5) e ela aparece centralizada; número fora do arquivo vai para a última linha.
2. **Given** um arquivo de linguagem com estrutura reconhecida (JavaScript, TypeScript, JSON, CSS, HTML, Markdown), **When** o usuário usa "Ir para símbolo", **Then** vê a lista de funções, classes, métodos, chaves ou títulos do arquivo, filtra digitando e vai até o escolhido.
3. **Given** uma palavra selecionada, **When** o usuário usa "Selecionar próxima ocorrência" repetidas vezes, **Then** cada ocorrência seguinte entra como mais um cursor; o que ele digita vale em todos; Esc volta a um cursor.
4. **Given** o editor, **When** o usuário adiciona cursores com o mouse (com o modificador do modelo de referência) ou com as setas, **Then** a edição acontece em todos os cursores e o desfazer volta tudo de uma vez.
5. **Given** o workspace ativo, **When** o usuário usa "Buscar no projeto" com um texto (opções: diferenciar maiúsculas, palavra inteira, expressão regular, filtro de arquivos), **Then** vê os resultados agrupados por arquivo com a linha e o trecho; clicar abre o arquivo na linha e destaca a ocorrência.
6. **Given** uma busca no arquivo, **When** o usuário usa substituir (uma ou todas), **Then** as substituições ficam no texto da aba como alteração não salva; nada é gravado até ele salvar.
7. **Given** abas abertas, **When** o usuário usa "Fechar outras" ou "Fechar todas", **Then** as abas saem, perguntando antes por cada arquivo com alteração não salva; "Reabrir aba fechada" traz de volta a última fechada na mesma posição.
8. **Given** um trecho selecionado, **When** o usuário usa "Reindentar" ou "Comentar/descomentar linhas", **Then** a mudança fica no texto da aba, como qualquer edição, e só é gravada ao salvar.
9. **Given** o mapa de atalhos escolhido na 007 (Windows, IntelliJ, Eclipse ou VS Code), **When** o usuário usa os atalhos do editor, **Then** eles seguem esse mapa, e o diálogo de atalhos lista as ações novas do editor.

---

### User Story 4 - Editor dividido e alterações do git na margem (Priority: P3)

O usuário divide o editor para ver dois arquivos (ou dois pontos do mesmo arquivo) lado a lado e vê na margem quais linhas mudaram desde o último commit, com acesso rápido ao trecho original.

**Why this priority**: melhora a revisão manual das mudanças dos agentes, mas o editor funciona sem ela.

**Independent Test**: num repositório git, alterar uma linha e apagar outra num arquivo; abrir no editor e ver as marcas de "alterada" e "removida" na margem; dividir à direita e editar o mesmo arquivo nos dois lados.

**Acceptance Scenarios**:

1. **Given** um arquivo aberto, **When** o usuário usa "Dividir à direita" (ou "Dividir abaixo"), **Then** um segundo editor abre ao lado com o mesmo arquivo; cada lado tem a própria rolagem e cursor.
2. **Given** o mesmo arquivo nos dois lados, **When** o usuário edita de um lado, **Then** o outro mostra a edição na hora, e a aba fica como não salva nos dois; salvar de qualquer lado grava uma vez.
3. **Given** um arquivo dentro de um repositório git, **When** ele está aberto, **Then** a margem mostra as linhas adicionadas, alteradas e o ponto das removidas em relação ao último commit, e as marcas se atualizam enquanto o usuário edita.
4. **Given** uma marca na margem, **When** o usuário clica nela, **Then** vê o trecho original e pode "Reverter este trecho", o que muda o texto da aba (sem gravar).
5. **Given** um arquivo fora de git, novo (não rastreado) ou binário, **When** é aberto, **Then** a margem não mostra marcas e nenhum erro aparece.

### Edge Cases

- Configuração com nome repetido no mesmo workspace: recusada com "Já existe uma configuração com esse nome". Uma cópia cujo nome "(cópia)" já existe vira "(cópia 2)", "(cópia 3)"…
- Nomes de variável de ambiente são comparados sem diferenciar maiúsculas (`Path` e `PATH` são a mesma), como no Windows.
- `NODE_OPTIONS` (ou `MAVEN_OPTS`/`GRADLE_OPTS`) definido nas variáveis da configuração e também em "Opções do runtime": as opções do runtime são acrescentadas depois do valor das variáveis.
- "Antes de lançar" apontando para uma configuração que já roda e não permite várias instâncias: a principal não roda e a mensagem pede para parar a outra ou ligar várias instâncias.
- Etapa de "antes de lançar" que não termina (um servidor): o seletor mostra "Aguardando <nome>…" com Cancelar; cancelar para a etapa e a principal não roda.
- Etapa de "antes de lançar" que pede confirmação (ex.: wrapper sem permissão, da 007): a confirmação aparece para a etapa antes de ela rodar; recusar cancela o lançamento.
- Relançar (rerun) uma execução cuja configuração foi removida: recusado com "A configuração desta execução foi removida".
- Editar uma configuração que está rodando: permitido; vale no próximo lançamento, e o formulário avisa "Em execução — as mudanças valem no próximo lançamento".
- Programa de uma ferramenta que só existe como `.cmd`/`.bat` sem alvo real resolvível: a configuração fica indisponível com o motivo, nunca é lançada por `cmd.exe` (constitution VIII).
- Variável de ambiente com nome inválido (vazio, com `=` ou espaço) ou repetido: recusada no campo.
- Valor de variável de ambiente que parece segredo (`TOKEN`, `PASSWORD`, `SECRET`, `KEY` no nome): o campo fica mascarado com opção de mostrar, e um aviso diz que o valor fica gravado em texto no estado do app nesta máquina.
- "Antes de lançar" que forma ciclo (A antes de B, B antes de A, ou A antes de A): recusado ao aplicar, com a cadeia mostrada.
- "Antes de lançar" que aponta para uma configuração removida: a principal não roda e a mensagem diz qual configuração falta.
- Várias instâncias além do teto de execuções vivas (constitution: 12): a nova instância é recusada com a mensagem de limite.
- Pasta da configuração que deixou de pertencer ao workspace ou está indisponível: a configuração aparece marcada como indisponível, com o motivo, e não roda.
- Script removido do `package.json`: a configuração continua salva, aparece como indisponível com "script não encontrado".
- Fechar a janela de configurações com alterações não aplicadas: pergunta se descarta.
- Migração do estado: configurações personalizadas da 007 entram sem perda; o estado antigo é gravado de forma atômica com a versão de esquema nova; um estado de versão futura é recusado sem sobrescrever.
- Ir para símbolo num arquivo sem estrutura reconhecida (texto puro): a lista mostra "Nenhum símbolo neste arquivo".
- Busca no projeto com milhares de resultados: mostra os primeiros 2.000 com o aviso "resultados demais, refine a busca"; arquivos binários, acima de 2 MB, em `.git/` e nas pastas ignoradas pelo explorador (002) ficam de fora.
- Expressão regular inválida na busca: mensagem junto do campo, sem buscar.
- Expressão regular que demora demais: a busca é interrompida com "A busca demorou demais; simplifique a expressão" e o app continua respondendo.
- Busca em andamento: o popup mostra "Buscando…" com Cancelar; Esc fecha o popup e cancela a busca.
- Arquivos em UTF-8 com ou sem BOM e UTF-16 com BOM entram na busca; outras codificações são tratadas como binário.
- Atalhos e links simbólicos/junções não são seguidos na busca; arquivo sem permissão de leitura é pulado e contado.
- Substituir em vários arquivos de uma vez não existe nesta feature: a constitution proíbe escrita em massa do app; a substituição vale só no arquivo da aba.
- Arquivo alterado em disco enquanto está aberto nos dois lados do editor dividido: o conflito da 002 aparece uma vez, ao salvar.
- Arquivo muito grande (acima de 5.000 linhas alteradas ou de 2 MB): as marcas do git na margem não são calculadas e uma dica diz o motivo.
- Fim de linha diferente entre o commit e o arquivo (CRLF × LF com `core.autocrlf`): só a diferença de conteúdo marca a linha; a troca de fim de linha sozinha não marca.
- Commit feito pelo painel Commit, por um agente ou fora do app: as marcas se recalculam contra o novo último commit quando a janela ganha o foco ou uma operação de git termina.
- Fechar todas as abas com dez arquivos não salvos: uma pergunta só, com a lista e "Salvar todos", "Descartar todos" e "Cancelar".

## Requirements *(mandatory)*

### Functional Requirements

**Frente A — configurações de execução**

- **FR-001**: O app MUST manter configurações de execução salvas por workspace, cada uma com nome, ferramenta, pasta do workspace, script/programa, argumentos, opções do runtime, variáveis de ambiente, "antes de lançar" (opcional, outra configuração do mesmo workspace), "permitir várias instâncias" e pasta de agrupamento (opcional).
- **FR-002**: A janela de configurações MUST mostrar as configurações do workspace ativo em árvore por ferramenta e pasta de agrupamento, com as ações adicionar, remover (com confirmação), copiar, criar pasta, mover para pasta e ordenar.
- **FR-003**: O formulário MUST validar cada campo (nome único no workspace, pasta do workspace, script existente, nomes de variáveis válidos e únicos, "antes de lançar" sem ciclo) e oferecer Rodar, OK, Cancelar e Aplicar com a semântica do cenário 8 da US1.
- **FR-004**: O seletor da barra superior MUST listar só as configurações salvas do workspace ativo, com "Editar configurações…" e "Adicionar a partir de um script detectado…".
- **FR-005**: Ao rodar, o processo MUST receber o ambiente do app somado às variáveis da configuração (as da configuração prevalecem) e as opções do runtime; o lançamento continua sem shell e com o programa resolvido (constitution VIII).
- **FR-006**: "Antes de lançar" MUST rodar a configuração indicada até o fim e só iniciar a principal se ela terminar com código 0.
- **FR-007**: Com "permitir várias instâncias", rodar de novo MUST abrir outra execução; sem a opção, o comportamento da 007 continua (mostra a execução viva).
- **FR-008**: As configurações personalizadas da 007 MUST ser migradas para o modelo novo na primeira abertura, sem perda, com gravação atômica e versão de esquema nova.
- **FR-009**: Valores de variáveis de ambiente MUST NOT aparecer em logs; nomes com aparência de segredo MUST ser mascarados na interface.

**Frente B — edição de código**

- **FR-010**: O editor MUST seguir o comportamento do IntelliJ onde VS Code e IntelliJ diferem (decisão no research R1); as teclas vêm do mapa escolhido na 007.
- **FR-011**: O editor MUST oferecer ir para linha (e coluna), ir para símbolo do arquivo nas linguagens com estrutura reconhecida, selecionar a próxima ocorrência e multicursor com desfazer único.
- **FR-012**: O app MUST oferecer busca no projeto (workspace ativo) com diferenciar maiúsculas, palavra inteira, expressão regular e filtro de arquivos, com limite de resultados e exclusões do edge case, abrindo o resultado na linha.
- **FR-013**: Substituir MUST valer só no arquivo da aba e deixar o texto como não salvo; nenhuma ação desta feature grava arquivo sem o salvar explícito.
- **FR-014**: As abas MUST oferecer fechar outras, fechar todas e reabrir a última fechada, perguntando antes por arquivos não salvos.
- **FR-015**: O editor MUST oferecer reindentar e comentar/descomentar linhas como comandos explícitos; não há formatação automática ao salvar nem ao colar.
- **FR-016**: O editor MUST poder ser dividido à direita ou abaixo, com o mesmo arquivo sincronizado nos dois lados e um único salvar.
- **FR-017**: A margem MUST mostrar as linhas adicionadas, alteradas e removidas em relação ao último commit, com a visão do trecho original e "Reverter este trecho" como edição não salva.
- **FR-018**: As ações do editor com tecla na tabela de `contracts/ui.md` MUST ter atalho nos quatro mapas da 007 e aparecer no diálogo de atalhos; "Fechar outras", "Fechar todas" e "Dividir abaixo" ficam no menu da aba, e "Dividir à direita" tem tecla só no mapa VS Code (como nos produtos originais).
- **FR-019**: As regras da 002 continuam: salvar explícito, conflito de hash reportado, nunca gravar em `.git/` nem fora de uma raiz registrada.

### Key Entities

- **Configuração de execução**: nome, ferramenta, pasta, script/programa, argumentos, opções do runtime, variáveis de ambiente, antes de lançar, várias instâncias, pasta de agrupamento, ordem; pertence a um workspace.
- **Script detectado**: o que a 007 encontra nas pastas (npm, maven, gradle, compose); serve de origem para criar configurações, não é listado no seletor.
- **Instância de execução**: uma execução viva de uma configuração; várias quando a configuração permite.
- **Resultado de busca no projeto**: arquivo, linha, coluna, trecho.
- **Marca de alteração**: trecho do arquivo com tipo (adicionado, alterado, removido) e o texto original.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Criar uma configuração a partir de um script detectado e rodá-la leva no máximo 4 cliques a partir do seletor.
- **SC-002**: O seletor abre mostrando só as configurações salvas em 100% dos casos, e abre em menos de 200 ms com até 50 configurações.
- **SC-003**: 100% das configurações personalizadas da 007 aparecem depois da atualização com os mesmos valores (verificado por teste de migração).
- **SC-004**: Ir para linha e ir para símbolo levam o cursor ao destino em menos de 100 ms num arquivo de 10.000 linhas.
- **SC-005**: A busca no projeto devolve os primeiros resultados em menos de 2 s num workspace de 20.000 arquivos.
- **SC-006**: As marcas do git na margem aparecem em menos de 500 ms ao abrir um arquivo de até 5.000 linhas e acompanham a edição sem atraso perceptível (menos de 100 ms por tecla).
- **SC-007**: Nenhuma ação desta feature grava arquivo do usuário sem o salvar explícito (verificado por teste que observa a porta de escrita).

## Assumptions

- As ferramentas da 007 continuam as mesmas (npm/pnpm/yarn, Maven, Gradle, Compose, programa); Spring Boot é tratado como Maven ou Gradle com objetivo sugerido.
- "Antes de lançar" aceita uma configuração do mesmo workspace; tarefas de outros tipos (build externo, script avulso) ficam fora.
- Variáveis de ambiente ficam no estado do app nesta máquina (local-first), sem cofre de segredos; o aviso do edge case deixa isso claro.
- Fora de escopo: depuração com breakpoints, autocompletar e diagnóstico por linguagem (LSP), refatoração automática, formatação por formatador de linguagem, substituição em vários arquivos, compartilhar configurações com o repositório (arquivo no projeto).
- Nenhuma dependência nova é pressuposta; se o research concluir que algum item precisa de pacote novo, ele entra no plan para aprovação.
