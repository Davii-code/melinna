# Contrato: protocolo principal ↔ hospedeiro (protocolVersion 1)

Transporte: `\\.\pipe\melinna-desk-<hash>` no Windows; `<userData>/host/sock` (diretório `0700`) no POSIX. `<hash>` = sha256 do nome do usuário e de `userData`, 16 hex.

## Quadro

```text
uint32 BE  headerLength
uint32 BE  payloadLength
bytes      header (JSON UTF-8)
bytes      payload (binário, opcional)
```

`headerLength + payloadLength` ≤ 1.048.576. Quadro maior ou JSON inválido: o hospedeiro responde `error { code: 'HOST_PROTOCOL' }` e fecha a conexão.

## Handshake

1. Cliente envia `{ "t": "hello", "protocolVersion": 1, "token": "<hex 64>" }` em até 2 s.
2. Hospedeiro compara o token em tempo constante; responde `{ "t": "welcome", "protocolVersion": 1, "hostPid": n }` ou `{ "t": "error", "code": "HOST_AUTH" }` e fecha.
3. Versão diferente: `error { code: 'HOST_VERSION', supported: 1 }`; o principal encerra o hospedeiro antigo e inicia um novo se não houver execução viva, ou avisa o usuário se houver.

## Requisições (cliente → hospedeiro), cada uma com `id` numérico

| `t` | Campos | Resposta |
|-----|--------|----------|
| `spawn` | `execId`, `file` (absoluto; nunca `.cmd`/`.bat`), `args[]`, `cwd`, `env{}`, `cols`, `rows`, `separator?` (texto do separador de relançamento) | `ok { pid }` / `error` (`UNSAFE_LAUNCHER`, `EXECUTABLE_NOT_FOUND`, `INPUT_INVALID`) |
| `write` | `execId`; payload = bytes | sem resposta (erros chegam como evento `error`) |
| `ack` | `execId`, `offset` (último byte processado pelo consumidor) | sem resposta |
| `resize` | `execId`, `cols` (20–1000), `rows` (5–500) | sem resposta |
| `kill` | `execId`, `graceMs` | `ok` após o término. Sequência: escreve `\x03` (Ctrl+C) no PTY; se o processo não sair em `graceMs`, encerra à força a árvore (Windows: `taskkill /PID <pid> /T /F`; POSIX: `SIGTERM` ao grupo e `SIGKILL` após 1 s). Só age sobre pids de processos filhos do próprio hospedeiro |
| `attach` | `execId`, `fromOffset` | `ok { firstAvailableOffset, totalBytes }`, depois eventos `output` |
| `detach` | `execId` | `ok` |
| `list` | — | `ok { processes: HostProcessInfo[] }` |
| `shutdown` | `graceMs` | `ok`; encerra todos e sai |

## Eventos (hospedeiro → cliente)

| `t` | Campos |
|-----|--------|
| `output` | `execId`, `offset` (do primeiro byte); payload = bytes. Só para execuções anexadas por esta conexão |
| `marker` | `execId`, `kind: 'replay-start' \| 'replay-end' \| 'discarded' \| 'gap' \| 'separator'`, `lostBytes?` — `replay-start`/`replay-end` delimitam a reprodução do scrollback no `attach` |
| `exit` | `execId`, `exitCode`, `signal`, `endedAt` |
| `activity` | `execId`, `lastOutputAt` — no máximo 1 a cada 250 ms por execução, para todas as execuções |
| `scrollback-status` | `execId`, `persisting: boolean`, `reason?: 'DISK_FULL' \| 'IO_ERROR'` |
| `error` | `id?`, `execId?`, `code`, `message` |

## Controle de fluxo

- Por execução anexada, o hospedeiro mantém `unacked = último offset enviado − último ack`.
- Com `unacked` acima de 1 MB (marca alta), o hospedeiro chama `pty.pause()`; com `unacked` abaixo de 256 KB (marca baixa), chama `pty.resume()`.
- Sem conexão anexada, o PTY nunca fica pausado: a saída vai só para o scrollback (fila de até 4 MB, ver Garantias).
- Ao desanexar ou cair a conexão, o hospedeiro zera `unacked` e chama `resume()`.
- O principal repassa o `ack` recebido da página (ver ipc.md) sem acumular bytes além da marca alta.

## Respostas a consultas do terminal

Agentes e o ConPTY enviam consultas que exigem resposta. Quando nenhuma conexão está anexada à execução, ou durante uma reprodução de scrollback, o hospedeiro responde sozinho a:

| Consulta | Resposta |
|----------|----------|
| DA1 `ESC [ c` / `ESC [ 0 c` | `ESC [ ? 1 ; 2 c` |
| DA2 `ESC [ > c` | `ESC [ > 0 ; 0 ; 0 c` |
| DSR status `ESC [ 5 n` | `ESC [ 0 n` |
| CPR `ESC [ 6 n` | `ESC [ <rows> ; 1 R` (posição aproximada: última linha, coluna 1) |
| OSC 10/11 `?` (cor de texto/fundo) | cores do tema (`#e6e9ef` / `#07080b`) no formato `rgb:RRRR/GGGG/BBBB`, com o mesmo terminador da consulta |

Com conexão anexada e fora da reprodução, quem responde é o xterm da interface, e o hospedeiro não responde (para não duplicar). A CPR aproximada é uma limitação conhecida: um emulador sem cabeça exato (`@xterm/headless`) exigiria dependência nova e aprovação.

## Garantias

- Saída entregue a uma conexão é contígua: o `offset` de cada `output` é igual ao `offset + length` do anterior, exceto quando precedido de `marker`.
- `attach` serializa com a escrita do scrollback daquela execução; não há lacuna nem duplicação entre a reprodução e o ao vivo.
- Escrita em disco nunca bloqueia a leitura do PTY: fila por execução de até 4 MB; excedente descarta o mais antigo e gera `gap`.
- Um hospedeiro novo nunca adota processos de um registro anterior: execuções sem processo vivo no hospedeiro atual são reportadas como ausentes. Ao gravar scrollback de uma execução já existente em disco (relançamento), o hospedeiro continua do `totalBytes` de `meta.json`, sem reiniciar deslocamentos.
- Se a conexão cai, os processos continuam; o hospedeiro sai sozinho só após `shutdown`, ou quando não há processos vivos nem conexão por 60 s.
