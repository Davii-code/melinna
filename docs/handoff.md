# Handoff — 2026-10-21 11:20
## Objetivo
Melinna Desk: app desktop (Electron) que roda agentes de CLI em PTYs paralelos, um git worktree por execução. Fase atual: virar "editor + terminais na mesma janela" (diferencial sobre VS Code/IntelliJ e sobre o projeto de referência).

## Feito nesta sessão
- **Suítes rodadas pela primeira vez no Windows** e baseline recuperado: `tsc` ✅, `lint` ✅, unit 274/274 ✅, arch 2/2 ✅, integration 64/67 (só `launch.test.ts` falha, por crash nativo `0xC0000005` dentro do node-pty ao abrir vários PTYs).
- Commit `bacc611`: workspaces/enunciado opcional/home/ícone que estavam soltos + correções de lint e da infraestrutura de teste (limpeza de temporário no Windows, separadores de caminho, sequências de init do ConPTY).
- Commit `5808388`: constituição **v1.2.0** — Princípio IX autoriza ler a referência para analisar comportamento (segue proibido copiar código/marca) + higiene do clone; Princípio II ganha exceção estreita para o usuário salvar pelo editor.
- Commit `9e70c19`: **Feature 002 fatia 1** — explorador de arquivos somente leitura (`files.roots/list/read`), raízes = repositórios de workspace + worktrees de execução, contenção por `realpath`, limites de 5.000 entradas / 5 MB, árvore com carga sob demanda e pré-visualização em modal. Spec em `specs/002-explorador-arquivos/spec.md`.
- Documentos de análise: `docs/analise-referencia-alethe.md` e `docs/plano-explorador-e-multiterminal.md`.

## Pendente (próxima task primeiro)
1. **Feature 002 fatia 2** — painel unificado: `Pane` como união (execuções em abas, editor, diff, preview), migração `STATE_SCHEMA_VERSION` 1 → 2, e então editor CodeMirror 6 com abas, salvar (respeitando a exceção do Princípio II) e `Ctrl+P`.
2. Decoração de git na árvore do explorador (adicionado/modificado/ignorado por arquivo).
3. Investigar o crash `0xC0000005` do `launch.test.ts` (node-pty/Electron desta máquina; não é regressão do código).
4. Apagar `software-clone/` (já no `.gitignore`; análise concluída).
5. Assistente de primeira abertura (detectar/ligar agentes) — segue pendente desde o handoff anterior.

## Decisões tomadas (e o porquê, 1 linha cada)
- Reimplementação limpa, sem fork AGPL: o que a referência tem de bom já existe aqui, e o que falta (editor explorador de verdade) não existe lá.
- Explorador por **worktree**, não só por repositório: é o diferencial que nem VS Code nem a referência entregam.
- CodeMirror 6 em vez de Monaco: várias instâncias na grade custam pouco; Monaco é 3–5 MB e ~80 MB de heap por instância.
- Leitura antes de escrita: a fatia 1 não tem nenhum caminho de escrita, então a exceção do Princípio II ainda não foi exercitada em código.
- Raízes vêm de `navigationRoots` (função pura, testada) para não duplicar regra entre main e renderer.

## Arquivos-chave (caminho — papel)
- `src/core/files/tree.ts` — regras puras: contenção, ordem natural, detecção de binário, limites.
- `src/core/files/files-service.ts` — listar/ler com `realpath` e lotes de `stat`.
- `src/core/files/roots.ts` — quais pastas o explorador pode abrir.
- `src/main/ipc/register-files.ts` + `validate-files.ts` — canais `files:*`.
- `src/renderer/components/Files/FileExplorer.tsx` — árvore, seletor de raiz, modal de leitura.
- `src/renderer/App.tsx` — alternância Workspaces | Arquivos na barra lateral.
- `.specify/memory/constitution.md` — v1.2.0 (Princípios II e IX).
- `tests/support/temp-dirs.ts` — limpeza de temporário que sobrevive a arquivo read-only no Windows.

## Problemas abertos / riscos
- `launch.test.ts` derruba o worker com `0xC0000005`; os 3 testes do arquivo caem junto. Rodar isolado não reproduz sempre.
- `C:\Users\<usuário>` desta máquina **é um repositório git**, então qualquer pasta em `%TEMP%` está "dentro de um repo"; o teste `inspectRepo` usa `GIT_CEILING_DIRECTORIES` para exercitar o caso "não é repositório".
- O ConPTY responde a consulta de posição do cursor sozinho; por isso o teste de integração verifica "o agente não trava", não "quem respondeu".
- A spec 002 foi escrita **depois** do código (desvio do Fluxo de desenvolvimento; registrado no fim da própria spec).

## Próximo passo exato
Escrever `specs/002-explorador-arquivos/` fatia 2 (modelo `Pane` + migração v2) **antes** do código, conforme o Fluxo de desenvolvimento.
