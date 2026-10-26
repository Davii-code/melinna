# Implementation Plan: Configurações de execução e edição de código no estilo de IDE

**Branch**: `009-execucao-e-editor` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

## Summary

Duas frentes. **A**: as configurações de execução da 007 viram `RunConfig` salvas por workspace, com
ambiente, opções do runtime, "antes de lançar" e várias instâncias, editadas numa janela no modelo do
IntelliJ (árvore à esquerda, formulário à direita); o seletor da barra superior lista só as salvas.
Isso muda o estado em disco (esquema 3→4) e os canais `run:*`. **B**: o editor (CodeMirror 6) passa a
seguir o comportamento do IntelliJ (decisão em [research.md](research.md#r1)): ir para linha, estrutura
do arquivo, próxima ocorrência e multicursor, busca no projeto, comentar/reindentar, gestão de abas,
editor dividido e marcas do git na margem, com teclas nos quatro mapas da 007. Nenhuma dependência nova.
Constitution de referência: 2.0.0.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24

**Primary Dependencies**: React 19, `@codemirror/{commands,language,search,state,view,lang-*}` e
`@lezer/highlight` já instalados — **nenhuma nova**

**Storage**: estado do app (`state-schema.ts`), esquema **4** com `Group.runConfigs`; gravação atômica
existente e cópia `state.v3.bak` antes da migração; pilha de abas fechadas só em memória

**Testing**: Vitest (unit do núcleo, unit do main/ipc, unit:renderer com `fakeApi`), integração com
processos e git reais, perf (`*.perf.test.ts`), e2e Playwright

**Target Platform**: Windows 10 1809+ validado; Linux/macOS compilam

**Performance Goals**: SC-002 (seletor < 200 ms com 50 configurações), SC-004 (< 100 ms em 10.000
linhas), SC-005 (busca < 2 s em 20.000 arquivos), SC-006 (margem < 500 ms; < 100 ms por tecla)

**Constraints**: lançamento sem shell (VIII); app só grava por salvar explícito (II); busca no principal
sem processo externo; valores de ambiente fora dos logs

**Scale/Scope**: até 50 configurações por workspace, 100 variáveis por configuração, 2.000 resultados
de busca, 5.000 linhas alteradas para a margem

## Constitution Check

| Princípio | Situação |
|---|---|
| I | ✅ Não envolve agentes. |
| II. Pasta do usuário | ✅ Busca é leitura; substituir, reindentar, comentar e "Reverter este trecho" mudam só o texto da aba; o salvar continua o único caminho de escrita (FR-013/FR-019). Configurações ficam no estado do app, não na pasta do projeto (research R4). |
| III | ✅ "Antes de lançar" e várias instâncias são execuções comuns no PTY. |
| IV. Núcleo independente | ✅ `RunConfig`, migração, validação, ciclo e busca vivem em `src/core`; o principal só registra canais. |
| V/VI | ✅ Testes por história antes da implementação; sem decisão em aberto. |
| VII. Sem surpresas | ⚠️ **Mudança de contrato a aprovar**: esquema do estado 3→4 (`Group.commands` → `Group.runConfigs`), canais `run:list`/`run:start` alterados, `run:saveConfig`/`run:removeConfig` substituem `saveCommand`/`removeCommand`, novos `run:reorder`, `files:searchProject`, `git:fileAtHead`. Detalhes em [contracts/ipc.md](contracts/ipc.md). Sem dependência nova. |
| VIII. Processos | ✅ Opções do runtime viram variável de ambiente da ferramenta, não argumento interpretado; objetivos/tarefas e argumentos viram vetor (espaço separa, aspas agrupam); o programa das ferramentas é derivado pelo núcleo (o valor do renderer é ignorado) e resolvido pelo `resolve-program.ts` da 007, que nunca lança `.cmd`/`.bat`; sem alvo real, a configuração fica indisponível (`unsafe-target`); busca sem processo externo; valores de ambiente não vão para log. |
| IX/X | ✅ IntelliJ é referência de uso; ícones e visual Melinna. |

Resultado: **passa** — contrato aprovado pelo dono do projeto em 2026-10-26 (seção abaixo e Complexity Tracking).

## Aprovação do contrato (VII)

**Status**: **aprovado** em 2026-10-26 pelo dono do projeto — pacotes A, B, C e D, como descritos abaixo.

| Pacote | O que muda | Tasks bloqueadas |
|---|---|---|
| A — execução | esquema do estado 3→4 (`Group.commands` → `Group.runConfigs`, cópia `state.v3.bak`); `run:list` passa a devolver `{ configs, detected }`; `run:start`/`run:rerun` com `configId`, "antes de lançar" e várias instâncias; **remoção** de `run:saveCommand`/`run:removeCommand`; novos `run:saveConfig`, `run:removeConfig`, `run:reorder`; erros novos | T004, T007–T013, T029–T031 |
| B — busca no projeto | canal novo `files:searchProject`; busca num `worker_threads` do Node no principal (decisão de arquitetura, sem dependência nova) | T046–T049 |
| C — git | canal novo somente leitura `git:fileAtHead` | T063 |
| D — layout | `layoutStore.splitDoc`: o `LayoutState` persistido passa a admitir o mesmo caminho em dois painéis `editor` (formato igual, invariante nova) | T066 |

B, C e D são aditivos e independentes de A. Nenhuma chave nova de `localStorage`: a pilha de abas
fechadas fica só em memória.

## Design

### Frente A — núcleo (`src/core/run`)

- `types.ts`: `RunConfig`, `RunConfigInput`, `RunConfigView`, erros novos ([data-model](data-model.md)).
- `run-configs.ts` (substitui `custom-commands.ts`): `saveConfig` (valida nome único, pasta do
  workspace, nomes de variáveis, limites, `beforeLaunch` existente e sem ciclo), `removeConfig` (recusa
  viva), `reorder`, `toView` (disponibilidade: pasta, programa resolvido, script presente no
  `package.json` detectado).
- `before-launch.ts`: `chainOf(configId)` com detecção de ciclo (DFS); usado ao salvar e ao lançar.
- `run-env.ts`: `buildEnv(base, config)` (soma, configuração vence; `runtimeOptions` → variável da
  ferramenta, somada ao valor base se existir) e `envNames(config)` para log.
- `run-service.ts`: `start` resolve a cadeia de "antes de lançar", lança cada etapa como execução,
  espera o fim pela porta de estado das execuções e só segue com código 0; `allowParallel` pula o
  reaproveitamento da execução viva; teto de 12 continua.
- `state-schema.ts`: `STATE_SCHEMA_VERSION = 4`, `migrateRunConfigs` (3→4) na cadeia de migração.

### Frente A — renderer

- `store/run-store.ts`: `configs`, `detected`, `save`, `remove`, `reorder`, `addFromDetected`.
- `Run/RunConfigsDialog.tsx` (novo, substitui `RunConfigDialog.tsx`): `RunConfigTree.tsx` (árvore,
  barra, arrastar para pasta) e `RunConfigForm.tsx` (campos, validação, `EnvTable.tsx` com máscara);
  estado "sujo" e Aplicar/OK/Cancelar.
- `Run/RunSelector.tsx`: só salvas + as duas ações; `Run/DetectedPicker.tsx` para "a partir de um
  script detectado".

### Frente B — editor (renderer, salvo a busca)

- `Editor/extensions/`: `goto-line.ts` (popup + `gotoLine`), `structure.ts` (extração de símbolos por
  linguagem a partir de `syntaxTree`: JS/TS funções, classes, métodos; JSON chaves de 1º e 2º nível;
  CSS seletores; HTML elementos com id; Markdown títulos), `occurrences.ts` (`selectNextOccurrence`,
  desfazer a última, Alt+Shift+clique), `git-gutter.ts` (`gutter` + marcas, diff de `line-diff.ts`).
- `Editor/line-diff.ts`: Myers em linhas com corte de prefixo/sufixo; limite de 5.000 linhas alteradas.
- `Editor/shared-doc.ts`: sincroniza duas `EditorView` do mesmo caminho por transações anotadas;
  `EditorPane` passa a ler o rascunho de um mapa por caminho.
- `Editor/EditorPane.tsx`: menu da aba (fechar outras/todas, dividir), pilha de abas fechadas,
  pergunta única "Salvar todos/Descartar todos/Cancelar".
- `Search/ProjectSearch.tsx`: popup com campo, opções, lista agrupada e prévia; chama
  `files:searchProject`; abre o resultado com `layoutStore.openDoc` + posição.
- `keymap/keymaps.ts`: `AppAction` ganha as ações do [contracts/ui.md](contracts/ui.md); ações de
  editor só disparam com um editor em foco (o terminal continua recebendo as teclas).
- Núcleo: `src/core/files/search.ts` (percurso pela porta de sistema de arquivos do núcleo, filtros,
  limites, codificações, sem seguir links) e `src/core/git` ganha `fileAtHead` (caminho relativo à raiz
  do repositório com `/`, teto de 2 MB, binário → `missing`). Principal: `src/main/search-worker.ts`
  roda a busca num `worker_threads` (encerrado por `terminate()` ao cancelar ou após 10 s, o que corta
  uma regex catastrófica sem travar o principal) e valida as raízes contra as registradas;
  `register-files.ts` e `register-git.ts` registram os canais.
- Margem do git: textos normalizados para LF antes do diff; `HEAD` relido no foco da janela e quando
  o `head` do `status` muda (provedor da 008), cobrindo commits do painel, de agentes e de fora.
- Editor dividido: `layoutStore.splitDoc(paneId, path, 'right' | 'down')` (o `openDoc` continua
  reaproveitando o painel que já tem o caminho).
- `keymap/use-shortcuts.ts`: as ações de editor só disparam com um editor em foco; com o terminal em
  foco a tecla segue para o PTY.
- "Salvar todos" usa o mesmo caminho do salvar da 002 (hash esperado, conflito reportado, log de
  caminho, tamanho e hash antes e depois), arquivo por arquivo.

### Erros e logs

Erros novos com mensagem pt-BR ([contracts/ipc.md](contracts/ipc.md#erros-novos)), mostrados junto do
campo (formulário) ou no popup (busca). Logs estruturados no principal: `run.start`, `run.config.save`
(`configId`, ferramenta, quantidade de variáveis), `files.search` (contagens e duração); nunca valores
de ambiente, opções do runtime ou o texto buscado.

### Segurança

- Ambiente: nomes validados; valores só no estado local; máscara para nomes com cara de segredo
  (research R6); nada em log.
- Busca: as raízes vindas do renderer são validadas no principal contra as registradas do workspace;
  não segue links simbólicos nem junções; arquivo sem permissão é pulado; worker encerrado por tempo
  (regex catastrófica não trava o app); arquivos > 2 MB e binários ignorados.
- Lançamento: argumento malicioso (`& calc`, aspas) nunca passa por shell; teste com alvo `.cmd`.
- `git:fileAtHead`: caminho validado contra a raiz (mesma regra `FILE_OUTSIDE_ROOT` da 006).

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit núcleo | validação de `RunConfig`, ciclo, `buildEnv`, migração 3→4 (inclui estado futuro recusado), `run-service` com antes de lançar (sucesso, falha, cancelado) e várias instâncias, busca (filtros, limites, regex inválida, cancelamento) | `tests/unit/core/run/*`, `tests/unit/core/files/search.test.ts`, `tests/unit/core/persistence/*` |
| Unit main | canais novos e alterados, log sem valores de ambiente | `tests/unit/main/ipc/register-run.test.ts`, `register-files.test.ts`, `register-git.test.ts` |
| Unit renderer | janela de configurações (árvore, barra, formulário, validação, Aplicar/OK/Cancelar, máscara), seletor só com salvas, extensões do editor (linha, estrutura, ocorrências, margem), `line-diff`, editor dividido, abas, busca no projeto, atalhos nos quatro mapas | `tests/unit/renderer/*` |
| Integração | lançamento real com variável de ambiente e `NODE_OPTIONS`; antes de lançar com código de saída; `fileAtHead` em repo real | `tests/integration/core/run.test.ts`, `tests/integration/core/git.test.ts` |
| Perf | seletor com 50 configurações; estrutura e ir para linha em 10.000 linhas; busca em 20.000 arquivos; diff de 5.000 linhas | `tests/perf/*.perf.test.ts` |
| e2e | criar configuração a partir de script detectado com variável e rodar; editar no editor dividido e ver a margem | `tests/e2e/run-configs.spec.ts`, `tests/e2e/editor.spec.ts` |

Nenhum teste da 007 é apagado; os que verificam `saveCommand`/`removeCommand` e o seletor com
detectados são reescritos para o contrato novo, mantendo os cenários que continuam válidos.

### Roteiro de tela (para o `/testar-tela`)

- **US1**: seletor → "Editar configurações…" → "+" a partir do script `start` → `PORT=4000` → Aplicar →
  Copiar → Nova pasta e mover → Ordenar → OK; reabrir o app e ver a configuração.
- **US2**: seletor só com as salvas; rodar com a variável; "antes de lançar" com uma etapa que falha;
  várias instâncias abrindo dois terminais.
- **US3**: ir para linha `120:5`; estrutura do arquivo; Ctrl+D/Alt+J três vezes e digitar; buscar no
  projeto e abrir um resultado; fechar outras e reabrir aba fechada.
- **US4**: dividir à direita e editar dos dois lados; margem do git e "Reverter este trecho".

## Project Structure

```text
src/core/run/types.ts, run-configs.ts (novo; substitui custom-commands.ts), before-launch.ts, run-env.ts, run-service.ts
src/core/persistence/state-schema.ts (esquema 4 + migração)
src/core/files/search.ts (novo); src/core/git/* (fileAtHead)
src/shared/ipc-contract.ts; src/preload/*; src/main/ipc/register-run.ts, register-files.ts, register-git.ts
src/renderer/store/run-store.ts
src/renderer/components/Run/RunConfigsDialog.tsx, RunConfigTree.tsx, RunConfigForm.tsx, EnvTable.tsx, DetectedPicker.tsx (novos), RunSelector.tsx, RunBar.tsx (alterados), RunConfigDialog.tsx (removido)
src/renderer/components/Editor/CodeEditor.tsx, EditorPane.tsx (alterados), line-diff.ts, shared-doc.ts, extensions/* (novos)
src/renderer/components/Search/ProjectSearch.tsx (novo)
src/renderer/keymap/keymaps.ts, use-shortcuts.ts; src/renderer/styles/app.css
```

## Complexity Tracking

| Item | Por quê | Alternativa rejeitada |
|---|---|---|
| Mudança de contrato (esquema 3→4 e canais `run:*`, `files:searchProject`, `git:fileAtHead`) — **aprovada pelo dono do projeto em 2026-10-26 (VII), pacotes A, B, C e D** | ambiente, opções, antes de lançar e várias instâncias precisam ser persistidos; busca e conteúdo em `HEAD` só existem no principal | manter `StoredCommand` e guardar o resto em `localStorage` (perde-se entre máquinas de estado e não chega ao núcleo que lança); `@codemirror/merge` e ripgrep (dependências novas) |
