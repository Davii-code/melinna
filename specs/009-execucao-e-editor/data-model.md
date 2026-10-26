# Data Model: Configurações de execução e edição de código

## RunConfig (persistido em `Group.runConfigs`, esquema 4)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | gerado; preservado do `StoredCommand` na migração |
| `name` | string | 1–80 caracteres, único no workspace (sem diferenciar maiúsculas) |
| `tool` | `'npm' \| 'pnpm' \| 'yarn' \| 'maven' \| 'gradle' \| 'compose' \| 'program'` | as ferramentas da 007 |
| `folder` | string | caminho absoluto de uma pasta do workspace |
| `script` | string \| null | nome do script (npm/pnpm/yarn, um dos detectados na pasta) ou objetivos/tarefas (maven/gradle), separados em argumentos por espaço com aspas agrupando, virando vetor de argumentos; `null` em `program` |
| `program` | string | só na ferramenta `program` vem do usuário; nas demais o núcleo deriva (`npm`, wrapper `mvnw`/`gradlew` ou `mvn`/`gradle`) e ignora o que vier no input; resolvido pelo `resolve-program.ts` da 007, nunca um `.cmd`/`.bat` lançado com argumentos do usuário (sem alvo real: indisponível com `unsafe-target`) |
| `args` | string[] | até o limite da 007 (`limits.ts`) |
| `runtimeOptions` | string | vira `NODE_OPTIONS` / `MAVEN_OPTS` / `GRADLE_OPTS`; vazio em compose/program; até 1.000 caracteres |
| `env` | `{ name: string; value: string }[]` | até 100 pares; nome `[A-Za-z_][A-Za-z0-9_]*`, único sem diferenciar maiúsculas; valor até 8.000 caracteres. Montagem: ambiente base → variáveis da configuração (vencem, comparando nomes sem diferenciar maiúsculas) → `runtimeOptions` acrescentado ao fim da variável da ferramenta, separado por espaço |
| `beforeLaunch` | string \| null | id de outra `RunConfig` do mesmo workspace; sem ciclo |
| `allowParallel` | boolean | padrão `false` |
| `folderGroup` | string \| null | nome da pasta de agrupamento na árvore (1–60 caracteres) |
| `order` | number | posição dentro do grupo (ferramenta + pasta) |

Calculados, nunca persistidos (`RunConfigView`): `available`, `unavailableReason`
(`folder-missing` \| `program-missing` \| `script-missing` \| `before-launch-missing` \| `unsafe-target`), `running`
(quantidade de instâncias vivas).

### Migração 3 → 4

`Group.commands: StoredCommand[]` → `Group.runConfigs: RunConfig[]`, com `tool: 'program'`,
`script: null`, mesmos `id`, `program`, `args`, `folder`, `name = label`, `runtimeOptions: ''`,
`env: []`, `beforeLaunch: null`, `allowParallel: false`, `folderGroup: null`, `order` pela posição.
O id ativo guardado nas preferências (`setActiveRun`) continua válido. Antes de gravar o estado 4, o
arquivo de esquema 3 é copiado para `state.v3.bak` (gravação atômica), para que um binário antigo possa
ser recuperado manualmente. Estado com versão maior que 4:
recusado sem sobrescrever (regra já existente).

## DetectedScript (calculado, como na 007)

`RunCommand` da 007 com `source: 'detected'`; não é listado no seletor, só serve de origem para criar
uma `RunConfig`.

## Estado do editor (renderer, não persistido além do que a 002 já guarda)

- **Aba fechada recentemente**: pilha de até 20 `{ paneId, path, index }` por janela.
- **Editor dividido**: dois painéis `editor` da grade com o mesmo caminho, criados por uma operação nova
  do `layoutStore` (`splitDoc`), já que `openDoc` reaproveita o painel que tem o caminho. O formato do
  `LayoutState` não muda, mas passa a admitir o mesmo caminho em dois painéis (pacote D de aprovação). O texto não salvo
  (`draft`) fica num mapa por caminho compartilhado pelos dois.
- **Marca de alteração**: `{ fromLine, toLine, kind: 'added' | 'modified' | 'removed', original: string }`.

## Resultado de busca no projeto

`{ path: string; line: number; column: number; preview: string; matchStart: number; matchEnd: number }`;
resposta `{ hits: SearchHit[]; truncated: boolean; scannedFiles: number }`.
