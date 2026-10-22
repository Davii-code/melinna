# Data Model: Imagens no chat do terminal

## Anexo de imagem (arquivo, sem registro no estado)

| Atributo | Regra |
|---|---|
| local | `userData/attachments/<execId>/<timestamp>-<n>.<ext>` |
| formato | PNG, JPEG, GIF ou WebP, detectado pela assinatura dos bytes |
| tamanho | 1 byte a 20 MB (`MAX_IMAGE_BYTES`) |
| ciclo de vida | criado ao colar; apagado com a pasta da execução ao remover a execução |

Arquivos do usuário (soltos ou anexados pelo diálogo) não viram anexo: são referenciados no lugar.

## AgentDefinition.images (catálogo)

| Campo | Tipo | Regra |
|---|---|---|
| `template` | string | contém `{path}` exatamente uma vez; ex.: `"{path}"`, `"@{path}"` |
| `quote` | `'always' \| 'when-needed'` | `when-needed`: aspas só se o caminho tem espaço |

Ausente = agente não recebe imagens.

## ImageRef (em memória, prévia)

| Campo | Tipo |
|---|---|
| `path` | string absoluto |
| `type` | `'png' \| 'jpeg' \| 'gif' \| 'webp'` |
| `bytes` | number |
| `thumbnail` | data URL PNG ≤ 256 px |
| `source` | `'clipboard' \| 'file'` |
