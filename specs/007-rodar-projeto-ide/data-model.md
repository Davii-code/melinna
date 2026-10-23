# Data Model: Configurações de execução e mapas de atalhos

## RunCommand (configuração de execução)

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | detectada: `sha256(groupId\|pasta\|origem\|nome)` 16 hex; personalizada: `newId()` |
| `groupId` | string | workspace dono |
| `source` | `'npm' \| 'maven' \| 'gradle' \| 'compose' \| 'custom'` | tipo (ícone no seletor) |
| `tool` | `'npm' \| 'pnpm' \| 'yarn' \| 'maven' \| 'gradle' \| 'compose' \| 'custom'` | ícone/rótulo do tipo; npm/pnpm/yarn pelo lock |
| `label` | string | 1–80, sem quebra de linha; único (sem diferenciar maiúsculas) entre as personalizadas do workspace |
| `program` | string | nome ou caminho; 1–`LIMITS.path`, sem caracteres de controle; resolvido no lançamento |
| `args` | string[] | 0–64 itens, cada um 0–4.096, sem caracteres de controle |
| `folder` | string | pasta do workspace (absoluta) |
| `available` | boolean | calculado: programa encontrado e pasta ainda no workspace |
| `unavailableReason` | `'not-found' \| 'folder-outside' \| null` | calculado |
| `searched` | string | calculado: nome procurado quando `not-found` |

Persistidas só as `custom`, em `Group.commands?: StoredCommand[]` (sem `groupId`, `tool`,
`available`, `unavailableReason`, `searched`). Detectadas são só leitura.

## Task / Execution (campos opcionais — já em `state-schema.ts`, T004)

| Campo | Tipo | Regra |
|---|---|---|
| `Task.kind` | `'agent' \| 'command'` | ausente = `agent` |
| `Execution.command` | `{ commandId, label, file, args }` | só em execuções de comando; `file` = caminho já resolvido; `agentId = 'command'` (marcador) |

Sem subir `STATE_SCHEMA_VERSION`.

## Preferences (`userData/preferences.json`, versão 1)

```json
{ "version": 1, "keymap": "windows", "activeRun": { "groupId": "g1", "commandId": "a1b2…" } }
```

| Campo | Tipo | Regra |
|---|---|---|
| `keymap` | `'windows' \| 'intellij' \| 'eclipse' \| 'vscode'` | ausente/inválido = `windows` |
| `activeRun` | `{ groupId, commandId } \| null` | id que não existe mais → o seletor mostra "Nenhuma configuração ativa" (o arquivo não é corrigido em silêncio) |

Ausente → padrões. JSON inválido → padrões, aviso no log, e o arquivo não é sobrescrito até a próxima
escolha explícita. Versão maior → somente leitura (escolhas valem só na sessão).

## Keymap (renderer, constante)

`Record<KeymapId, Record<AppAction, KeyChord | null>>`, com `AppAction` = `goToFile`, `save`,
`closeTab`, `toggleSidebar`, `promptLibrary`, `runActive`, `stop`. Tabela em research R8.

## Detecção

| Arquivo | Configurações |
|---|---|
| `package.json` (`scripts`) | `<pm> run <script>`; `pm` = pnpm (`pnpm-lock.yaml`), yarn (`yarn.lock`), npm |
| `pom.xml` | `mvnw`/`mvn` `compile`, `test`, `package` |
| `build.gradle`/`.kts` | `gradlew`/`gradle` `build`, `test`; `run` (plugin `application`); `bootRun` (`org.springframework.boot`) |
| `docker-compose.yml`/`compose.yaml` | `docker compose up` / `down` ("subir"/"derrubar"); `docker-compose up/down` se só existir o legado |

Leitura limitada a 1 MB por arquivo; maior → ignorado com aviso.
