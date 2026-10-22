# Quickstart: validar o workspace multiprojeto

## Automático

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

O teste de integração `multi-folder` usa o agente falso, que imprime `argv` e `cwd`: o esperado é
cwd = pasta principal e um `--add-dir <pasta>` por pasta extra disponível.

## Roteiro manual (para o /testar-tela, no app)

Prepare três pastas: `front` e `back` (repositórios git com um arquivo alterado cada) e `lib` (pasta
comum).

1. **Criar** — barra lateral → "+" → "Novo workspace". Nome "Portal", adicionar as três pastas de uma
   vez pelo diálogo, marcar `back` como principal, criar.
   Esperado: "Portal" na árvore e nos recentes; tooltip lista as três pastas com `back` principal.
2. **Validações** — tentar criar sem nome e sem pastas; adicionar `front` duas vezes.
   Esperado: botão bloqueado / mensagem de pasta duplicada.
3. **Lançar com extras** — "+" do workspace → Claude Code.
   Esperado: terminal em `back`; `/add-dir` ou pergunta ao agente mostra `front` e `lib` acessíveis.
4. **Shell** — "+" do workspace → PowerShell/Bash.
   Esperado: terminal em `back` e selo "só a principal" na linha da execução.
5. **Editar com sessão viva** — "Editar workspace": remover `lib`, trocar a principal para `front`,
   renomear para "Portal 2".
   Esperado: aviso "vale para terminais novos"; terminais abertos continuam; novo terminal abre em
   `front` com `back` como extra.
6. **Última pasta** — remover pastas até sobrar uma e tentar remover a última.
   Esperado: recusado com mensagem.
7. **Arquivos** — aba Arquivos.
   Esperado: uma raiz por pasta, principal primeiro e marcada; marcas de git em `front` e `back`;
   `lib` sem marcas e sem erro.
8. **Pasta sumiu** — fechar o app, renomear `lib` no disco, reabrir.
   Esperado: `lib` indisponível; novo terminal abre com aviso de pasta omitida.
9. **Migração** — com um `state.json` da versão anterior (workspace de uma pasta), abrir o app.
   Esperado: workspaces e sessões preservados, cada um com uma pasta principal.
10. **Remover** — remover o workspace.
    Esperado: nenhuma pasta apagada do disco.
