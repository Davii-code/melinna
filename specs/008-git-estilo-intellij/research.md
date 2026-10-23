# Research: Interface de git no estilo do IntelliJ

## R1. Onde guardar o painel lateral e o workspace ativo

- **Decision**: `localStorage` do renderer, chaves `melinna.sidebarPanel` e `melinna.activeWorkspace`,
  lidas com `try/catch` e valor padrão, no mesmo padrão de `storedSidebarWidth`.
- **Rationale**: são preferências de interface; o app já guarda largura e recolhimento da barra lateral
  assim. Evita mudar o `LayoutState` e o esquema do estado em disco (Princípio VII).
- **Alternatives considered**: campo novo no `LayoutState` (exige migração e aprovação de contrato).

## R2. Commit em vários repositórios

- **Decision**: sequência de `git.commit` por repositório, com a mesma mensagem, parando no primeiro
  erro; os commits já feitos ficam e o resultado é mostrado por repositório.
- **Rationale**: o git não tem commit atômico entre repositórios; parar no primeiro erro (hook,
  identidade, lock) deixa o usuário corrigir antes de continuar, sem commits pela metade em ordem
  imprevisível. Nenhum canal novo.
- **Alternatives considered**: continuar nos demais após uma falha (o usuário perde a noção do que entrou);
  canal `commitMany` no principal (contrato novo sem ganho).

## R3. Onde mostrar o diff

- **Decision**: `DiffPane` sobre a grade de painéis, na área principal, sem persistir.
- **Rationale**: é o comportamento do IntelliJ (o diff abre ao lado da janela Commit) sem tocar no
  `LayoutState`. Fechar o diff volta à grade como estava.
- **Alternatives considered**: tipo novo de painel na grade (muda o estado persistido).

## R4. Árvore com milhares de arquivos

- **Decision**: lista plana derivada da árvore (só nós visíveis), com janela de linhas renderizadas
  pela rolagem; a seleção é um `Set` por repositório e o estado parcial é calculado por contagem em mapa.
- **Rationale**: atende SC-004 sem dependência nova.

## R5. Atalhos dos painéis

- **Decision**: Alt+0 (Commit), Alt+1 (Workspaces), Alt+2 (Arquivos), no listener de janela já usado
  para Ctrl+P.
- **Rationale**: Alt+0 e Alt+1 são os do IntelliJ; Alt+número não é usado pelos agentes de terminal.
  A 007 transformará os atalhos do app em mapa escolhível.
