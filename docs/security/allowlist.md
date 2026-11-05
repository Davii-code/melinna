# Melinna — Solicitação de allowlist e ficha técnica para a equipe de segurança

Documento para subsidiar a análise da equipe de segurança corporativa (Zscaler / EDR)
e a liberação (allowlist) do aplicativo Melinna. O objetivo é tornar o aplicativo
verificável, não ocultar sua execução. Preencha os campos marcados com `<...>` antes de enviar.

## 1. Identificação do aplicativo

| Campo | Valor |
|-------|-------|
| Nome do produto | Melinna |
| Identificador (appId) | `io.github.davii-code.melinna` |
| Executável | `melinna-desk.exe` |
| Fabricante | Davii-code |
| Responsável técnico | `<nome e e-mail>` |
| Versão | `<ex.: 0.1.0>` |
| Plataforma | Windows 10/11 x64 |
| Tipo | Aplicativo desktop Electron (instalador NSIS por usuário, sem privilégio de administrador) |

## 2. Hash e assinatura (preencher após gerar o build)

A liberação deve ser feita, de preferência, por **assinatura digital** (vale para versões futuras)
e não apenas por hash (que muda a cada build).

| Campo | Valor |
|-------|-------|
| SHA-256 do instalador | `<hash do melinna.exe>` |
| SHA-256 do executável principal | `<hash do melinna-desk.exe desempacotado>` |
| Assinado digitalmente | `<Sim / Não>` |
| Emissor do certificado (CA) | `<ex.: DigiCert>` |
| Titular (Subject) do certificado | `<nome da organização no certificado>` |
| Thumbprint do certificado | `<thumbprint>` |

Para gerar os hashes no Windows:

```powershell
Get-FileHash .\dist\melinna.exe -Algorithm SHA256
```

## 3. Comportamento de rede

O código do aplicativo **não faz conexões de saída para a internet**. Toda a comunicação
interna acontece localmente no computador do usuário.

| Item | Detalhe |
|------|---------|
| Conexões de saída para internet (domínios/APIs) | Nenhuma originada pelo código do aplicativo |
| Comunicação local (Windows) | Named pipe `\\.\pipe\melinna-desk-<hash>` entre a interface e o processo host |
| Porta TCP em produção | Nenhuma |
| Uso em modo desenvolvimento apenas | WebSocket em `ws://localhost` / `ws://127.0.0.1` (servidor do Vite; não presente no build de produção) |
| Depuração Java (opcional, acionada pelo usuário) | Anexa `-agentlib:jdwp` em `127.0.0.1:5005` a programas Java que o próprio usuário executa |
| Abertura de links | `shell.openExternal` abre links no navegador padrão quando o usuário clica |

Observação: o Melinna executa ferramentas de linha de comando que o próprio usuário instala
e configura (ver seção 4). Essas ferramentas podem acessar a internet por conta própria; esse
tráfego é da ferramenta, não do Melinna.

## 4. Processos e binários executados

O Melinna é um ambiente que orquestra terminais e ferramentas de desenvolvimento. Por isso ele
inicia processos — essa é a função principal do aplicativo, não um comportamento oculto.

| Processo / binário | Finalidade | Observação para EDR |
|--------------------|-----------|---------------------|
| `node-pty` (`pty.node`) | Cria terminais (PTY) para rodar shells e ferramentas | Módulo nativo N-API; principal candidato a falso positivo de antivírus/EDR |
| `melinna-desk.exe` (próprio Electron como Node) | Processo "host" de terminais, iniciado em segundo plano (`detached`, `windowsHide`) | Depende da fuse `runAsNode` do Electron estar ativa |
| `taskkill /T /F` | Encerra árvores de processos de terminais ao fechar | Comando padrão do Windows |
| `git` | Operações de versionamento e checkpoints nas pastas de projeto do usuário | Via `execFile`, sem shell |
| Shells configurados pelo usuário | `pwsh`, `powershell`, `cmd`, `bash` (Git Bash), `zsh` | Abertos sob demanda pelo usuário |
| CLIs de agentes de IA (opcionais, instaladas pelo usuário) | `claude`, `codex`, `gemini` | Shims npm; só rodam se o usuário instalar e acionar |

## 5. Dependências nativas e framework

| Componente | Versão | Nota |
|-----------|--------|------|
| Electron | 44.9.2 | Framework base |
| electron-builder | 26.15.3 | Empacotamento |
| node-pty | 1.1.0 | Nativo (N-API); binário pré-compilado, desempacotado do asar |
| @electron/fuses | 1.8.0 | Controle de fuses do Electron |

Configuração de segurança da janela principal (reduz superfície de ataque):

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`

Fuse `runAsNode: true` está ativa por necessidade do processo host (executar o próprio
binário como Node para subir os terminais).

## 6. Resumo para análise de risco

- O aplicativo não envia dados para a internet por conta própria; comunicação interna é por named pipe local.
- Os comportamentos que mais chamam a atenção de um EDR — módulo nativo `node-pty`, uso de `taskkill`,
  e o próprio executável rodando como Node para iniciar terminais — são inerentes à função do produto
  (um orquestrador de terminais/ferramentas de desenvolvimento), e não técnicas de evasão.
- O instalador é NSIS por usuário, sem elevação de administrador.
- Recomenda-se liberação por assinatura digital após a aplicação do certificado da organização.

## 7. Próximos passos sugeridos

1. Obter com a TI/segurança um certificado de assinatura de código da organização (OV ou EV).
2. Assinar o instalador e o executável (configuração já preparada em `electron-builder.yml`, bloco `win.signtoolOptions`).
3. Enviar a este time: instalador assinado, hashes SHA-256, dados do certificado e esta ficha técnica.
4. Solicitar a allowlist por assinatura (publisher), para que futuras versões assinadas também sejam cobertas.
