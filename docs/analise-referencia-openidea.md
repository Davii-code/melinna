# OpenIDEA como referência para o editor do Melinna

Data: 13/11/2026. Estado: análise e proposta; escopo de implementação ainda não aprovado.

Referência: [l0ng-ai/openidea](https://github.com/l0ng-ai/openidea), snapshot `4aed449dc06443e4b42415c01fb77a011f499fed`. Comparação com o Melinna após `50d5e77`.

## Conclusão

O OpenIDEA é uma referência tecnicamente próxima na interface: React, TypeScript, CodeMirror 6 e xterm. Seus serviços nativos usam Rust/Tauri; o Melinna usa Electron e serviços TypeScript. A proposta é aproveitar padrões de interação e extensões de editor, adaptando serviços aos contratos IPC existentes. Incorporar um backend Rust seria uma decisão arquitetural separada.

O objetivo sugerido é proporcionar o fluxo de trabalho de uma IDE dentro do Melinna, preservando a orquestração de agentes. Paridade completa com IntelliJ, incluindo indexação e refatorações específicas de Java, não está demonstrada por essa referência.

## O que foi validado no código de referência

Inspeção estática de módulos selecionados. O OpenIDEA não foi executado, compilado ou testado; presença de implementação não demonstra estabilidade ou correção em todas as linguagens. A análise visual foi baseada na composição dos componentes, sem inspeção da aplicação em execução.

| Área                | Evidência no OpenIDEA                                                                                                                                                                                                                                                                                                                               | Consequência para o Melinna                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Extensões de editor | [`src/editor/api.ts`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/src/editor/api.ts): `EditorContribution`, editor ativo e participantes do salvamento                                                                                                                                                        | Organizar extensões do CodeMirror por capacidade; manter o controle de documentos do Melinna |
| Abas e splits       | [`model/tabs.ts`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/src/editor/core/model/tabs.ts): árvore de grupos, preview, pin, MRU e abas fechadas                                                                                                                                                             | Evoluir as abas existentes e a restauração da área de trabalho                               |
| Sincronização       | [`DocSync.ts`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/src/editor/core/sync/DocSync.ts): alterações locais pendentes e rebase de patches; [`diskSync.ts`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/src/editor/core/diskSync.ts): sincronização ao recuperar foco | Estudar atualização de arquivos alterados pelos agentes sem perder rascunhos                 |
| Linguagens          | [`src/editor/lsp`](https://github.com/l0ng-ai/openidea/tree/4aed449dc06443e4b42415c01fb77a011f499fed/src/editor/lsp): completion, diagnostics, hover, actions e inplaceRename; [`ide-host/ops/lsp.rs`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/crates/ide-host/src/ops/lsp.rs): operações nativas         | Implementar ciclo de servidores de linguagem e ponte IPC, com extensões CodeMirror           |
| Estrutura da IDE    | [`Workbench.tsx`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/src/workbench/Workbench.tsx): composição da área central e janelas de ferramentas                                                                                                                                                               | Adotar organização familiar mantendo o tema e os componentes locais                          |
| Execução            | [`ide-run/src/lib.rs`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/crates/ide-run/src/lib.rs): configurações persistidas, detecção, testes e referência a adaptador de debug                                                                                                                                  | Estender o RunService existente, evitando outro sistema paralelo                             |
| Depuração           | [`debugger/actions.ts`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/src/features/debugger/actions.ts): integração de breakpoints e sessões DAP                                                                                                                                                                | Precisa de serviço DAP, estado de sessão e UI próprios no Melinna                            |
| Git                 | [`ide-vcs/backend.rs`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/crates/ide-vcs/src/backend.rs): operações reais com gitoxide e Git CLI                                                                                                                                                                     | Usar como referência de experiência; preservar GitService e worktrees do Melinna             |
| HTTP                | [`ide-http/src/lib.rs`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/crates/ide-http/src/lib.rs): parser, ambientes, execução cancelável, timeout e histórico                                                                                                                                                  | Possível ferramenta posterior, independente do editor semântico                              |
| Banco de dados      | [`ide-db/src/lib.rs`](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/crates/ide-db/src/lib.rs): fontes de dados, conexão, consulta e introspecção                                                                                                                                                                | Feature separada com drivers, credenciais e confirmação de operações                         |

## Base existente do Melinna

- `src/renderer/components/Editor/CodeEditor.tsx`: CodeMirror, busca/substituição no documento, folding, múltiplos cursores, comentários, status de seleção e integração Git. Realce de sintaxe para JS/TS/JSX, JSON, Markdown, CSS e HTML; realce não equivale a compreensão semântica.
- `src/renderer/components/Editor/editor-session.tsx` e `editor-controller.ts`: rascunhos e controle de documentos. Views divididas compartilham conteúdo.
- `src/core/layout/` e `src/renderer/store/layout-store.ts`: painéis mistos de editor/terminal, divisões, redimensionamento, reordenação e modos de foco.
- `FileExplorer.tsx`, `QuickOpen.tsx` e `Search/ProjectSearch.tsx`: árvore de arquivos, abertura por caminho e busca de conteúdo. Já existe um perfil de atalhos IntelliJ.
- `src/core/run/` e componentes `Run/`: configurações detectadas/customizadas, argumentos, ambiente, diretório e tarefas anteriores à execução.
- `src/core/git/` e componentes `Git/`: status, diff, stage/unstage, commit, histórico, branches, conflitos e operações remotas.

Não foi localizada infraestrutura equivalente a servidores LSP, diagnósticos semânticos, navegação entre arquivos, refatoração semântica ou depurador DAP. Uma configuração de execução com porta de debug não fornece sozinha breakpoints, pilha e variáveis.

### Invariantes a preservar

1. Mesmo arquivo aberto em dois painéis compartilha o rascunho.
2. Salvar com `baseHash` deve continuar recusando sobrescrita quando o disco mudou. A proteção atual de `FilesService.write` é relevante porque agentes também editam os arquivos.
3. Digitação durante um salvamento não pode desaparecer quando a gravação anterior terminar.
4. Caminhos e raízes devem considerar o worktree da sessão ativa. Dois worktrees do mesmo repositório não podem compartilhar indevidamente diagnóstico, texto aberto ou servidor de linguagem.
5. O frontend continua acessando arquivos e processos pelos contratos autorizados do app.

Hoje há proteção contra conflito ao salvar, mas não foi encontrado fluxo completo de atualização/mesclagem automática quando um agente modifica um arquivo aberto. Essa lacuna merece prioridade antes de refatorações entre arquivos.

## Direção de layout proposta

Estrutura familiar de IDE, usando os tokens atuais do Melinna:

```text
Workspace / sessão / branch                 Execução e busca
┌──────────┬─────────────────────────┬──────────────────┐
│ Projeto  │ Abas de arquivos         │ Agentes/prompts  │
│ Arquivos │ Breadcrumbs             │ Sessões e estado │
│ Busca    │ Editor e divisões       │                  │
│ Git      │                         │                  │
├──────────┴─────────────────────────┴──────────────────┤
│ Terminal | Execução | Problemas | Depuração            │
├───────────────────────────────────────────────────────┤
│ Linguagem | linha/coluna | estado do servidor | Git    │
└───────────────────────────────────────────────────────┘
```

- Editor ganha uma área central previsível; ferramentas laterais e inferiores abrem por botão e atalho, com tamanho restaurado.
- Orquestração continua acessível no painel de agentes; o usuário pode alternar entre foco em código e foco em agentes sem perder documentos ou processos.
- Preservar navy, azul de destaque, Segoe UI Variable, Cascadia Mono, bandas de estado dos agentes e iconografia própria. Ajustar densidade por função: abas e árvores compactas; formulários e diálogos com o espaçamento atual.
- Aproveitar organização, atalhos e comportamento de janelas do OpenIDEA. Cores, marcas e aparência final pertencem ao Melinna.
- Essa composição é uma proposta; a direção visual precisa de uma prévia antes de alterar a tela.

## Ordem sugerida de implementação

| Etapa                     | Entrega observável                                                | Critérios para especificação                                                                                                 |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Área de edição         | Shell de IDE e abas previsíveis integrados aos painéis existentes | Layout restaurado; alternância código/agentes sem perder estado; navegação por teclado                                       |
| 2. Arquivos concorrentes  | Atualização de documentos modificados pelos agentes               | Documento limpo recarrega; documento sujo oferece comparação/recarga; nenhuma sobrescrita silenciosa                         |
| 3. Linguagens             | Primeiro servidor LSP e painel Problemas                          | Completion, hover, ir à definição, referências e diagnósticos no worktree correto; encerramento do servidor e erros visíveis |
| 4. Navegação e alterações | Busca de símbolos, renomeação e ações de código                   | Resultado por capacidade do servidor; mudanças entre arquivos conferem versões e oferecem prévia para alterações amplas      |
| 5. Depuração              | Um runtime com DAP integrado ao RunService                        | Breakpoints, iniciar/parar, continuar/step, pilha e variáveis, encerramento sem processos órfãos                             |
| 6. Ferramentas adicionais | Escolher cliente HTTP ou banco de dados conforme uso              | Fluxos, armazenamento de segredos e dependências especificados separadamente                                                 |

As etapas são capacidades candidatas, não tarefas aprovadas. Para a primeira entrega de LSP, escolher as linguagens prioritárias. Java pode exigir JDT LS e uma JVM compatível; regras específicas de Fluig não surgem automaticamente de um servidor Java. A seleção dos servidores e suas versões/licenças precisa ser validada quando o escopo for definido.

## Reaproveitamento e licença

Fontes: [LICENSE](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/LICENSE), [NOTICE](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/NOTICE) e [THIRD_PARTY_LICENSES.md](https://github.com/l0ng-ai/openidea/blob/4aed449dc06443e4b42415c01fb77a011f499fed/THIRD_PARTY_LICENSES.md).

A licença principal é Apache 2.0. Para incorporar código derivado, preservar a licença e os avisos aplicáveis e identificar modificações nos arquivos copiados, observando as condições do texto da licença. Assets e componentes de terceiros têm licenças individuais; o NOTICE inclui material relacionado a IntelliJ e VS Code. Isso exige inventário por arquivo efetivamente incorporado, sem presumir uma licença única para todos os recursos. A licença não concede uso de marcas JetBrains.

Preferência inicial: adaptar padrões e pequenos módulos de TypeScript cuja dependência esteja clara. Não importar bindings gerados de Tauri nem todo o sistema de estado do editor. Manter registro da origem e do commit de cada trecho incorporado.

## Próximo passo

Definir linguagens prioritárias e recorte inicial; então abrir uma nova feature pelo fluxo Spec Kit já existente, usando `specs/009-execucao-e-editor/` como contexto histórico. Novas dependências e mudanças de arquitetura devem aparecer na proposta antes da implementação. Nenhum código de aplicação, dependência ou spec foi alterado nesta análise.
