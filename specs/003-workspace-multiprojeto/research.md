# Research: Workspace multiprojeto

## R1. Como cada agente recebe pastas extras

- **Decision**: capacidade opcional `extraDirs` no catálogo, em dois estilos: `repeat` (a opção se
  repete por pasta: `--add-dir A --add-dir B`) e `join` (uma opção com a lista unida por um
  separador: `--include-directories A,B`). Catálogo inicial: Claude Code com
  `{ style: 'repeat', args: ['--add-dir', '{dir}'] }`. Codex (`--add-dir`, repeat) e Gemini
  (`--include-directories`, join com `,`) entram só depois de conferir a `--help` da versão instalada
  durante a implementação (task própria); sem confirmação, ficam sem a capacidade e mostram o aviso.
- **Conferência (T001, 2026-10-23)**: Claude Code 2.1.220 — `claude --help` lista `--add-dir <directories...>`
  (confirmado; declarado como `repeat`). Codex CLI e Gemini CLI **não estão instalados** nesta máquina,
  então a `--help` deles não pôde ser conferida: ficam sem `extraDirs` no catálogo e mostram o aviso
  "só a principal" até a conferência.
- **Rationale**: Princípio I — capacidade genérica e declarável; cobre os dois formatos conhecidos.
- **Alternatives considered**: variável de ambiente por agente (não existe nos três); arquivo de
  configuração do agente gravado na pasta (viola o Princípio II: o app escreveria na pasta).

## R2. Onde o terminal roda

- **Decision**: cwd = pasta principal.
- **Rationale**: o histórico de conversas dos agentes é por pasta; mantém o comportamento do MVP.
- **Alternatives considered**: pasta-mãe comum (pode não existir, e mistura histórico); pasta
  temporária com links (escrita fora do controle do usuário e frágil no Windows).

## R3. Migração do estado

- **Decision**: `STATE_SCHEMA_VERSION` 3. Na leitura de v2, todo `Group` com `repoPath` ganha
  `folders = [{ id, path: repoPath }]` e `primaryFolderId = id`; `repoPath`/`repoId` continuam
  gravados, derivados da principal, para não quebrar código e tarefas que os leem. Grupos sem pasta
  continuam sem pasta. Gravação passa a ser v3; uma versão antiga do app abrindo v3 cai no modo
  somente-leitura que o `StateStore` já tem.
- **Rationale**: migração na leitura já é o padrão (layout v1→v2); compatível para trás na leitura.
- **Alternatives considered**: remover `repoPath` (exigiria mexer em tarefas, raízes e diff de uma vez).

## R4. Snapshot das pastas na sessão

- **Decision**: a tarefa guarda, ao ser criada, a lista de pastas extras resolvida; relançar usa o
  snapshot. Mudanças no workspace valem para sessões novas (FR-011).
- **Rationale**: relançar não muda o que o agente enxerga sem o usuário pedir.
- **Alternatives considered**: ler o workspace a cada relançamento (contraria o FR-011).

## R5. Limite de linha de comando

- **Decision**: somar o tamanho dos argumentos de pastas extras ao cálculo já existente
  (`WINDOWS_CMDLINE_LIMIT`); se exceder, recusar com mensagem (FR-016). No Linux o limite prático é
  muito maior; a mesma checagem vale com o limite do sistema.
- **Rationale**: truncar em silêncio esconderia pastas do agente.

## R6. Diálogo de várias pastas

- **Decision**: canal `pickFolders` com `properties: ['openDirectory', 'multiSelections']`.
- **Rationale**: suportado pelo diálogo nativo do Electron em Windows e Linux; reduz cliques.
