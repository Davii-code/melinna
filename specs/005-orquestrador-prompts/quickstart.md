# Quickstart: validar o orquestrador de prompts

## Automático

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Roteiro manual (para o /testar-tela, no app)

1. **Criar** — abrir a biblioteca (botão no topo ou Ctrl+Shift+P); criar "Revisar" com
   "Revise {{arquivo}} em {{pasta}} e aponte riscos", escopo global. Esperado: variável `arquivo`
   listada; `pasta` marcada como automática.
2. **Usar** — com um Claude Code em foco, usar "Revisar", preencher `arquivo=src/app.ts`, enviar.
   Esperado: o agente recebe o texto com a pasta preenchida e começa a responder.
3. **Validação** — tentar enviar sem preencher `arquivo`. Esperado: bloqueado com a mensagem.
4. **Escopo** — criar um prompt no escopo do workspace A; abrir o workspace B. Esperado: não aparece.
5. **Várias sessões** — com três terminais vivos, "Enviar para várias", marcar dois. Esperado:
   confirmação listando os dois; só eles recebem; resultado por sessão.
6. **Shell** — incluir um PowerShell no destino. Esperado: aviso de que o texto vira comando.
7. **Fila** — com o agente ocupado, enfileirar dois prompts. Esperado: "2 na fila"; ao ficar ocioso,
   o primeiro vai; na próxima ociosidade, o segundo.
8. **Fila e fechar** — enfileirar, fechar o app mantendo os terminais, reabrir. Esperado: fila mantida
   e despachada na ociosidade.
9. **Descarte** — enfileirar e parar a sessão. Esperado: aviso "N itens descartados".
10. **Persistência** — reabrir o app. Esperado: biblioteca intacta.
