# Data Model: Orquestrador de prompts (primeira fatia)

Arquivo `userData/prompts.json`:

```json
{ "version": 1, "prompts": [], "queues": {} }
```

## Prompt

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | gerado |
| `name` | string | 1–80 caracteres, sem quebra de linha |
| `body` | string | 1–100.000 caracteres, sem caracteres de controle (C0 e ESC) exceto `\n` e `\t` |
| `scope` | `'global' \| { groupId: string }` | `groupId` precisa existir ao salvar |
| `createdAt`, `updatedAt` | ISO 8601 | |

Variáveis não são persistidas: são extraídas do `body` (`{{nome}}`, nome `[A-Za-z0-9_]+`), únicas e
na ordem da primeira ocorrência (variável repetida é pedida uma vez). Automáticas, resolvidas **por
sessão de destino**: `pasta` (diretório de trabalho da sessão: a pasta principal ou, em sessão legada,
o worktree), `workspace` (nome do workspace), `data` (AAAA-MM-DD local).

Substituição em passada única: o valor inserido nunca é reexpandido (um valor com `{{x}}` fica
literal) e não interpreta `$&`/`$1`.

## QueueItem

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | gerado |
| `text` | string | texto já resolvido para a sessão, 1–100.000, sem caracteres de controle |
| `enqueuedAt` | ISO 8601 | |

`queues` é `Record<execId, QueueItem[]>` na ordem de chegada.

## Semântica da fila: no máximo uma vez

- Despacho: o primeiro item é **removido e o arquivo gravado antes** de escrever no PTY. Se o app cair
  depois da gravação, o item não é reenviado (pode ter chegado ou não); nunca é enviado duas vezes.
- Falha ao escrever (sessão parou no meio): o item já saiu da fila; a interface recebe
  `queueDiscarded { reason: 'write-failed', items: 1 }` e o log registra.
- Gatilhos de despacho: transição para ocioso **e** a abertura do app (para cada fila cuja sessão já
  está ociosa) **e** o próprio `enqueue` (sessão ociosa com fila vazia).
- Sessão termina ou é removida → fila descartada (`queueDiscarded { reason: 'ended' | 'removed' }`).
- Abertura do app → filas de execuções inexistentes são descartadas.
- A fila só é despachada com o app aberto; com o app fechado, os itens esperam.

## Versão

`version` diferente de 1 → somente-leitura: leitura funciona; gravar (salvar prompt, enfileirar)
falha com `IO_ERROR` e a mensagem de "versão mais nova".
