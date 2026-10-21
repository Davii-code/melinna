# Handoff — 2026-10-21 11:55
## Objetivo
Melinna Desk: app desktop (Electron) que roda agentes de CLI em PTYs paralelos, num git worktree por execução — agora com editor de arquivos e terminais na mesma grade.

## Feito nesta sessão
- **Baseline**: `tsc` ✅, `lint` ✅, unit **438/438** ✅ (node + renderer), arch 2/2 ✅, integration **63–66/67** (só `launch.test.ts`, por crash nativo `0xC0000005` do node-pty).
- `bacc611` — trabalho pendente pós-`b030a14` (workspaces, enunciado opcional, home, ícone) + correções de lint e da infraestrutura de teste no Windows.
- `5808388` — constituição **v1.2.0**: Princípio IX autoriza ler a referência para analisar comportamento (segue proibido copiar código/marca); Princípio II ganha exceção estreita para o usuário salvar pelo editor.
- `9e70c19` — **fatia 1**: explorador somente leitura (`files.list/read`), raízes = repositório do workspace + worktree de cada execução, contenção por `realpath`, limites de 5.000 entradas / 5 MB.
- `d386366` — **fatia 2**: esquema de layout **v1 → v2** com painéis tipados (`Pane`), abas de execução por painel, editor CodeMirror 6 (abas, marca de não salvo, `Ctrl+S`), `files.write` com hash e `FILE_CONFLICT`, e `Ctrl+P` (índice de arquivos + modal).
- `bc35e6a` — decoração de git na árvore (`files.status`, letras A/M/D/R/U por arquivo e por pasta).

## Pendente (próxima task primeiro)
1. Investigar o crash `0xC0000005` do `launch.test.ts` (node-pty no Electron desta máquina) — é o último item vermelho da suíte.
2. Rascunho em disco para abas sujas (recuperação após queda) — previsto e não feito.
3. Busca por conteúdo (`rg`) e LSP/autocomplete no editor.
4. Assistente de primeira abertura (detectar/ligar agentes) — pendente desde o handoff anterior.
5. Apagar `software-clone/` (já no `.gitignore`, análise concluída).

## Decisões tomadas (1 linha cada)
- Painel de terminal usa `id === execId` da primeira execução: migração v1 fica literal e as células da grade continuam válidas.
- Um xterm por aba ativa: trocar de aba desanexa e reanexa com replay; muitos PTYs custam disco, não memória.
- `Pane` mora em `src/core/layout/panes.ts` (não em `persistence`): a fronteira de arquitetura deixa o renderer importar só `core/layout`.
- Escrita exige hash: conflito é recusado, nunca sobrescrito em silêncio (Princípio II).
- CodeMirror 6 em vez de Monaco: dez pacotes MIT pinados, barato com vários painéis.
- `Ctrl+P` sem IPC novo: índice montado no renderer com a própria `files.list`, teto de 2.000 arquivos e poda de `node_modules/.git/out/dist/coverage`.

## Arquivos-chave (caminho — papel)
- `src/core/layout/panes.ts` — tipo `Pane`, abas e remoção de aba.
- `src/core/persistence/state-schema.ts` — esquema 2 e migração de v1 na leitura.
- `src/renderer/store/layout-store.ts` — abrir/fechar/focar/reordenar painéis, `openDoc`, `closeTab`.
- `src/core/files/files-service.ts` — listar, ler e gravar com `realpath` e hash.
- `src/core/files/file-status.ts` + `git-status.ts` — decoração de git.
- `src/renderer/components/Editor/{CodeEditor,EditorPane}.tsx` — editor e abas.
- `src/renderer/components/QuickOpen/QuickOpen.tsx` + `src/renderer/files/index.ts` — `Ctrl+P`.
- `specs/002-explorador-arquivos/` — spec da fatia 1, spec-fatia-2 e plan (dependências fechadas).

## Problemas abertos / riscos
- `launch.test.ts` derruba o worker com `0xC0000005`; os testes do arquivo caem junto (não é regressão de código).
- O perfil do usuário desta máquina é um repositório git, então `%TEMP%` está "dentro de um repo"; testes usam `GIT_CEILING_DIRECTORIES` quando precisam do caso oposto.
- O ConPTY responde sozinho a consulta de posição do cursor: o teste de integração verifica "o agente não trava", não "quem respondeu".
- Processo: a spec da fatia 1 foi escrita **depois** do código e a fatia 2 teve spec/plan antes do código, mas os testes foram escritos junto da implementação, não antes — desvio do Princípio V registrado aqui.

## Próximo passo exato
Reproduzir e isolar o crash do node-pty em `tests/integration/core/execution/launch.test.ts` (rodar com `--test-threads=1` e coletar o dump do worker).
