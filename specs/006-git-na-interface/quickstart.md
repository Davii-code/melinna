# Quickstart: validar o git na interface

## Automático

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Os testes de integração criam um repositório e um remoto `--bare` em pasta temporária; não usam rede.

## Roteiro manual (para o /testar-tela, no app)

Prepare um repositório com remoto (pode ser um `--bare` local) e abra-o como workspace.

1. **Barra** — Esperado: branch atual, ↑0 ↓0 e "último fetch".
2. **Commit parcial** — alterar três arquivos, abrir a janela de commit, desmarcar um, ver o diff de
   outro, escrever a mensagem, "Commit". Esperado: commit com dois arquivos; o terceiro continua
   alterado; ↑1.
3. **Bloqueios** — sem arquivo marcado ou sem mensagem. Esperado: botão bloqueado.
4. **Push** — em uma branch de feature, push. Esperado: ↑0. Na main, push pede confirmação.
5. **Pull** — criar um commit no remoto por outro clone e clicar em pull. Esperado: ↓ some.
6. **Rejeitado** — commitar localmente e no remoto o mesmo arquivo, push. Esperado: mensagem
   sugerindo pull; nada forçado.
7. **Conflito** — pull com conflito. Esperado: lista de conflitos; abrir no editor, resolver, marcar
   resolvido; concluir abre a janela de commit com a mensagem de merge.
8. **Branches** — criar `feature/x`, trocar com arquivo alterado. Esperado: confirmação listando o
   arquivo.
9. **Credencial** — remoto HTTPS sem credencial. Esperado: erro com orientação, sem travar.
10. **Agente vivo** — abrir a janela de commit com um terminal de agente rodando no workspace.
    Esperado: aviso.
11. **Histórico** — abrir o histórico, escolher um commit e um arquivo. Esperado: diff do arquivo.
