# Data Model: Rodar o projeto e abrir na IDE externa

## RunCommand

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | detectado: hash estável de pasta+origem+nome; personalizado: gerado |
| `source` | `'npm' \| 'maven' \| 'gradle' \| 'compose' \| 'custom'` | |
| `label` | string | 1–80 |
| `program` | string | nome ou caminho; resolvido no lançamento |
| `args` | string[] | até 64, cada um até 4.096, sem caracteres de controle |
| `folder` | string | pasta do workspace (absoluta) |
| `available` | boolean | calculado (não persistido) |
| `searched` | string | calculado: nome procurado quando ausente |

Persistidos só os `custom`, em `Group.commands?: RunCommand[]` (sem `available`/`searched`).

## Task / Execution (campos opcionais)

| Campo | Tipo | Regra |
|---|---|---|
| `Task.kind` | `'agent' \| 'command'` | ausente = `agent` |
| `Execution.command` | `{ commandId: string; label: string; file: string; args: string[] }` | presente só em execuções de comando; `file` = caminho **já resolvido** do programa; `agentId` = `'command'` (marcador, não existe no catálogo) |

Sem subir `STATE_SCHEMA_VERSION`: campos opcionais preservados por versões que não os conhecem.

## tools.json (versão 1)

```json
{ "version": 1, "ides": { "vscode": "C:/…/Code.exe", "intellij": null } }
```

Versão maior → somente leitura. Caminho que não existe mais → ignorado com aviso e nova busca.

## Detecção

| Arquivo | Comandos |
|---|---|
| `package.json` (`scripts`) | `<pm> run <script>`; `pm` = pnpm (`pnpm-lock.yaml`), yarn (`yarn.lock`), npm |
| `pom.xml` | `mvnw`/`mvn` `compile`, `test`, `package` |
| `build.gradle`/`.kts` | `gradlew`/`gradle` `build`, `test`; `run` (plugin `application`); `bootRun` (`org.springframework.boot`) |
| `docker-compose.yml`/`compose.yaml` | `docker compose up`, `docker compose down` |
