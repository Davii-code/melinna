# Contrato IPC: Orquestrador de prompts

Novo grupo `prompts` na `MelinnaApi`; todos devolvem `Result<T>`.

```ts
type PromptScope = 'global' | { groupId: string };
interface Prompt { id: string; name: string; body: string; scope: PromptScope; createdAt: string; updatedAt: string; variables: string[] }
interface QueueItem { id: string; text: string; enqueuedAt: string }
type SendStatus = 'sent' | 'not-running' | 'not-ready' | 'not-found' | 'failed';
interface SendResult { execId: string; status: SendStatus }
/** Texto a enviar: corpo com variáveis, resolvido no núcleo **por destino** (pasta e workspace de cada sessão). */
interface SendInput { body: string; values: Record<string, string>; allowEmpty: string[]; execIds: string[] }

prompts: {
  list(groupId?: string): Promise<Result<Prompt[]>>;             // globais + do workspace
  save(input: { id?: string; name: string; body: string; scope: PromptScope }): Promise<Result<Prompt>>;
  duplicate(id: string): Promise<Result<Prompt>>;
  remove(id: string): Promise<Result<void>>;
  /** Quantos prompts têm o escopo do workspace (para a confirmação de remoção do workspace). */
  countForGroup(groupId: string): Promise<Result<number>>;
  /** Prévia do texto final para uma sessão (não envia). */
  preview(input: Omit<SendInput, 'execIds'> & { execId: string }): Promise<Result<string>>;
  send(input: SendInput): Promise<Result<SendResult[]>>;
  queue: {
    get(execId: string): Promise<Result<QueueItem[]>>;
    /** Resolve para a sessão e enfileira; sessão ociosa com fila vazia envia na hora. */
    enqueue(input: Omit<SendInput, 'execIds'> & { execId: string }): Promise<Result<QueueItem[]>>;
    remove(execId: string, itemId: string): Promise<Result<QueueItem[]>>;
    clear(execId: string): Promise<Result<void>>;
  };
  onChange(fn: () => void): Unsubscribe;                                          // promptsChanged
  onQueueDiscarded(fn: (e: { execId: string; items: number; reason: 'ended' | 'removed' | 'write-failed' }) => void): Unsubscribe;
}
```

## Validação (main e núcleo)

| Campo | Regra |
|---|---|
| `name` | 1–80, sem quebra de linha |
| `body`, valores de `values` | `body` 1–100.000; valores ≤ 10.000; **sem caracteres de controle** (faixa C0 e ESC `\x1b`), exceto `\n` e `\t`; o texto final é validado de novo no núcleo antes de escrever no PTY |
| `scope.groupId` | grupo existente |
| `execIds` | array 1–12 de execuções existentes |
| `values` | chaves `[A-Za-z0-9_]+` |

## Resultado por destino

| Status | Quando |
|---|---|
| `sent` | escrito no PTY |
| `not-ready` | execução em `preparing`/`starting` |
| `not-running` | execução encerrada |
| `not-found` | execução removida |
| `failed` | erro ao escrever |

`enqueue` em sessão que não está viva → `EXECUTION_NOT_RUNNING`.

## Erros (userMessage)

| Situação | Mensagem |
|---|---|
| nome inválido | "O nome do prompt deve ter de 1 a 80 caracteres, sem quebra de linha." |
| texto grande demais | "O prompt deve ter até 100.000 caracteres." |
| caractere de controle | "O prompt contém caracteres de controle; remova-os." |
| variável faltando | "Preencha a variável {{x}} ou marque para deixar vazia." |
| prompt inexistente | "Prompt não encontrado." |
| workspace inexistente no escopo | "Workspace não encontrado." |
| biblioteca de versão mais nova | `IO_ERROR` "A biblioteca de prompts foi gravada por uma versão mais nova do Melinna; atualize o app para editar." |
| falha ao gravar | `IO_ERROR` |
