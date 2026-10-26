# Research: Configurações de execução e edição de código no estilo de IDE

## R1. Modelo de referência do editor: VS Code ou IntelliJ

O mapa de atalhos da 007 já resolve **quais teclas** acionam cada ação (Windows, IntelliJ, Eclipse,
VS Code). O que falta decidir é o **comportamento**: onde cada ação aparece, como ela se apresenta e
o que acontece nos casos em que os dois produtos divergem.

| Item | VS Code | IntelliJ | Cobertura no CodeMirror já instalado |
|---|---|---|---|
| Ir para linha | caixa no topo, `linha:coluna` | diálogo pequeno, `linha:coluna` | `gotoLine` (`@codemirror/search`); a caixa é nossa |
| Ir para símbolo | lista no topo (`@`), agrupável | popup "File Structure" com filtro ao digitar | árvore de sintaxe (`syntaxTree`, `@codemirror/language`) + parsers `lang-*`; extração dos símbolos é nossa |
| Próxima ocorrência / multicursor | Ctrl+D, Alt+clique | Alt+J, Alt+Shift+clique; Shift+Alt+J desfaz a última | `selectNextOccurrence` (`@codemirror/search`), seleção múltipla do `@codemirror/state`; `allowMultipleSelections` |
| Buscar e substituir no arquivo | widget no canto, substituir na mesma caixa | barra acima do editor, substituir na mesma barra | painel do `@codemirror/search` (já usado) |
| Buscar no projeto | painel lateral persistente, lista em árvore | popup "Find in Files" com lista e prévia do trecho; pode virar painel | busca no principal (nossa); a prévia usa o próprio editor somente leitura |
| Editor dividido | botão na barra de abas, grupos de editores | "Split Right/Down" no menu da aba | duas `EditorView` com o mesmo documento, sincronizadas por transações (padrão documentado do CM6) |
| Marcas do git na margem | faixa colorida; clique abre a "peek" do diff | faixa colorida; clique abre popup com o original e "Rollback" | `gutter` + `GutterMarker` (`@codemirror/view`); o diff de linhas é nosso |
| Abas | "Close Others", "Reopen Closed Editor" | "Close Others", "Reopen Closed Tab", fixar | nosso (`EditorPane`) |
| Comentar / reindentar | Ctrl+/, formatar documento | Ctrl+/, "Auto-Indent Lines" (Ctrl+Alt+I) | `toggleComment`, `indentSelection` (`@codemirror/commands`) |

- **Decision**: **IntelliJ** como modelo de comportamento. As teclas continuam vindo do mapa escolhido.
  **Limitação assumida**: quem escolhe o mapa "vscode" recebe as teclas do VS Code com o comportamento
  do IntelliJ (ex.: Ctrl+Shift+F abre o popup "Buscar no projeto", não um painel lateral). É uma mistura
  só de teclas, não de comportamento; o comportamento é um só para todos os mapas.
- **Rationale**:
  - O dono do projeto usa o IntelliJ no dia a dia, e as features 008 (git) e 009-A (configurações de
    execução) já seguem o IntelliJ. Um editor no modelo do VS Code deixaria o app com dois idiomas de
    interação.
  - Onde o IntelliJ difere, a diferença favorece o app: o popup "File Structure" e o popup "Find in
    Files" com prévia não ocupam a barra lateral, que agora é da barra de ferramentas vertical (008);
    a margem do git com "Reverter este trecho" é a mesma ideia do "Rollback" do painel Commit.
  - Nada do modelo exige pacote novo: todas as peças estão nos pacotes `@codemirror/*` já instalados.
- **Alternatives considered**: modelo VS Code (painel de busca lateral, peek inline do diff). Rejeitado
  pela inconsistência com 008 e por competir pelo espaço lateral. Comportamento misto por item (cada
  ação no estilo de um produto): rejeitado, deixaria o comportamento imprevisível.
- **Referências públicas (constitution IX)**: `gotoLine`, `selectNextOccurrence`, `search`/`openSearchPanel`
  — https://codemirror.net/docs/ref/#search; `toggleComment`, `indentSelection` —
  https://codemirror.net/docs/ref/#commands; `gutter`, `GutterMarker` — https://codemirror.net/docs/ref/#view.gutter
  e https://codemirror.net/examples/gutter/; `syntaxTree` — https://codemirror.net/docs/ref/#language.syntaxTree;
  duas views sincronizadas — https://codemirror.net/examples/split/; seleção múltipla —
  https://codemirror.net/docs/ref/#state.EditorState^allowMultipleSelections.

## R2. Diff de linhas para a margem do git

- **Decision**: diff de linhas próprio no renderer (Myers em linhas, com prefixo/sufixo comuns
  aparados antes), entre o conteúdo do arquivo em `HEAD` e o texto atual da aba, recalculado com
  atraso de 150 ms após a edição; desligado acima de 5.000 linhas alteradas (edge case da spec).
- **Rationale**: o `git.diffFile` da 006 compara o disco com `HEAD`, não o texto não salvo; as marcas
  precisam acompanhar a edição. O conteúdo de `HEAD` vem de um canal novo somente leitura
  (`git:fileAtHead`, `git show HEAD:<caminho>` com `--no-optional-locks`), lido uma vez por arquivo
  aberto e relido quando a janela ganha o foco ou uma operação de git termina (evento `gitProgress`
  com `done` e o `head` diferente no `status` da 006/008), o que cobre commits do painel, de agentes e
  de fora do app.
- **Detalhes**: os dois textos são normalizados para LF antes do diff (a troca de fim de linha sozinha
  não marca); o caminho para `git show` é relativo à raiz do repositório que contém o arquivo, com `/`,
  e o repositório é o do `status` (pode ser diferente da raiz da pasta do workspace); arquivos acima de
  2 MB ou com byte nulo (binário) devolvem `{ missing: true }` e não têm marcas.
- **Alternatives considered**: `@codemirror/merge` (dependência nova, traz a visão de merge inteira que
  não usamos); reler `diffFile` a cada edição (exigiria salvar).

## R3. Busca no projeto

- **Decision**: a lógica fica em `src/core/files/search.ts` (núcleo, sem Electron, usando a porta de
  sistema de arquivos do núcleo, não `fs` direto) e **roda num `worker_threads` do Node** criado pelo
  principal para cada busca. Cancelar ou estourar o tempo (10 s no total; uma expressão regular não é
  interrompível dentro do JS) encerra o worker com `terminate()`, o que corta até uma regex
  catastrófica sem travar o principal. `worker_threads` é módulo do Node, não dependência nova, mas a
  escolha é decisão de arquitetura e entra no pacote de aprovação B do plan. O percurso segue
  as raízes do workspace ativo com as mesmas exclusões do explorador da 002 (`.git/`, `node_modules/` e
  ignorados), pulando binários e arquivos acima de 2 MB, lendo com `fs` e casando em JS (texto,
  palavra inteira, maiúsculas, expressão regular). Para no 2.000º resultado e devolve `truncated`. Uma
  busca nova cancela a anterior da mesma janela. Não segue links simbólicos nem junções; arquivo sem
  permissão é pulado e contado; UTF-8 (com ou sem BOM) e UTF-16 com BOM são lidos, o resto é binário.
  As raízes recebidas do renderer são validadas no principal contra as raízes registradas do workspace.
- **Rationale**: sem processo externo (constitution VIII), sem dependência nova; o núcleo fica testável
  com um sistema de arquivos em memória.
- **Alternatives considered**: `ripgrep` empacotado (rápido, mas dependência e binário novos);
  `git grep` (só funciona em pastas git e lança processo).

## R4. Modelo das configurações de execução

- **Decision**: `RunConfig` substitui o `StoredCommand` em `Group.runConfigs`. As opções do runtime viram
  a variável de ambiente da ferramenta (`NODE_OPTIONS` para npm/pnpm/yarn, `MAVEN_OPTS` para Maven,
  `GRADLE_OPTS` para Gradle); Compose e Programa não têm o campo. Variáveis da configuração somam-se ao
  ambiente base e vencem em nome repetido. Esquema do estado sobe de 3 para 4 com migração.
- **Rationale**: é o modelo do IntelliJ (configuração salva com ambiente e opções), mantém o lançamento
  sem shell, e as ferramentas leem as próprias variáveis de opções.
- **Alternatives considered**: guardar as configurações num arquivo do projeto (como `.run/` do
  IntelliJ): exige o app escrever na pasta do usuário, fora do Princípio II. Fica fora de escopo.

## R5. "Antes de lançar" e várias instâncias

- **Decision**: o `RunService` roda a configuração de "antes de lançar" como uma execução comum (painel
  visível), espera o fim pela mesma porta que já observa o estado das execuções e só então lança a
  principal se o código de saída for 0. Ciclos são recusados ao salvar (busca em profundidade no grafo
  do workspace) e de novo ao lançar. Com `allowParallel`, `start` não reaproveita a execução viva e
  cria outra, sujeita ao teto de 12.
- **Rationale**: reutiliza o caminho de lançamento da 007; o usuário vê a etapa anterior rodando.
- **Alternatives considered**: rodar a etapa anterior em segundo plano sem painel (o usuário não veria a
  falha).

## R6. Segredos nas variáveis de ambiente

- **Decision**: valores nunca vão para log (o `run.start` registra `configId`, ferramenta e só os
  **nomes** das variáveis); nomes que contêm `TOKEN`, `PASSWORD`, `PASSWD`, `SECRET`, `KEY` ou
  `CREDENTIAL` (sem diferenciar maiúsculas) aparecem mascarados no formulário, com "Mostrar". O estado
  continua local-first, em texto, com o aviso da spec.
- **Alternatives considered**: `safeStorage` do Electron para cifrar os valores (bom, mas muda o formato
  do estado e prende o arquivo à máquina; candidato a uma feature própria).
