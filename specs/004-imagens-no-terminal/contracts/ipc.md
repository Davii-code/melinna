# Contrato IPC: Imagens no chat do terminal

Novo grupo `attachments` na `MelinnaApi` (5 canais). Todos devolvem `Result<T>`. O main é a fonte única: detecta a imagem, valida, gera a miniatura e formata a referência.

```ts
interface ImageRef {
  path: string;
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  bytes: number;
  thumbnail: string; // data:image/png;base64,... (≤ 256 px)
  /** Referência já formatada para o agente da execução (aspas, @ etc.). */
  ref: string;
  source: 'clipboard' | 'file';
}

attachments: {
  /** Se a área de transferência tem imagem e não tem texto. */
  clipboardHasImage(): Promise<Result<boolean>>;
  /** Lê a imagem da área de transferência, grava como anexo da execução e devolve a referência. */
  pasteImage(execId: string): Promise<Result<ImageRef>>;
  /** Valida arquivos soltos ou escolhidos; recusados vêm em `rejected` com o motivo. */
  checkFiles(execId: string, paths: string[]): Promise<Result<{ accepted: ImageRef[]; rejected: { path: string; reason: string }[] }>>;
  /** Diálogo nativo com filtro de imagens (seleção múltipla) seguido de checkFiles. */
  pickImages(execId: string): Promise<Result<{ accepted: ImageRef[]; rejected: { path: string; reason: string }[] }>>;
  /** Revalida os arquivos e escreve as referências no PTY, separadas por espaço, sem Enter. */
  send(execId: string, paths: string[]): Promise<Result<void>>;
}
```

Preload: `webUtils.getPathForFile(file)` exposto como `files.pathOf(file)` para o drop.

## Validação (main)

| Campo | Regra |
|---|---|
| `execId` | execução existente e viva (`running`/`idle`); senão `EXECUTION_NOT_RUNNING` |
| agente da execução | precisa ter `images` no catálogo; senão `INPUT_INVALID` "Este agente não recebe imagens." |
| `paths` | array 1–20 de string 1–`LIMITS.path`, sem caracteres de controle; só arquivo regular (`lstat`), sem link simbólico para fora |

## Erros

| Situação | Código / mensagem |
|---|---|
| formato não aceito | `INPUT_INVALID` "Formato não aceito: use PNG, JPEG, GIF ou WebP." |
| acima de 20 MB | `INPUT_INVALID` "A imagem passa de 20 MB." |
| arquivo não existe | `INPUT_INVALID` "O arquivo X não existe." |
| falha ao gravar | `IO_ERROR` |
| área de transferência sem imagem no momento da leitura | `INPUT_INVALID` "Nenhuma imagem na área de transferência." |
| não é arquivo comum | `INPUT_INVALID` "X não é um arquivo de imagem." |
| mais de 20 arquivos | `INPUT_INVALID` "Envie até 20 imagens por vez." |
