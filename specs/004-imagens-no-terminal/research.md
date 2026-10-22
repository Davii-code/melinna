# Research: Imagens no chat do terminal

## R1. Como o agente recebe a imagem

- **Decision**: referência por caminho escrita no prompt, no formato declarado no catálogo
  (`images.template`). Claude Code: caminho do arquivo (aspas quando há espaço). Gemini: `@{path}`.
  Codex: conferir na versão instalada se aceita caminho no prompt interativo; sem confirmação, fica
  sem a capacidade. A conferência é uma task da implementação.
- **Pendência (T001)**: confirmar se cada agente lê imagem **fora da pasta do projeto** (anexos em
  `userData/attachments`). Contingência, nesta ordem, ambas com aprovação do dono: (1) incluir a pasta
  de anexos da sessão como pasta extra do agente (capacidade `extraDirs` da feature 003); (2) gravar
  os anexos em `.melinna/anexos` dentro do projeto (toca o Princípio II; exige aprovação explícita e
  `.gitignore` sugerido ao usuário, nunca escrito pelo app).
- **Forma de escrever**: digitação comum (texto simples no PTY), não colagem entre marcadores
  (bracketed paste): a referência é uma linha curta e alguns agentes tratam a colagem como bloco de
  texto, o que impediria reconhecer o caminho como imagem.
- **Rationale**: funciona igual em Windows e Linux e não depende de o agente ler a área de
  transferência do sistema (o que varia por versão e por plataforma).
- **Alternatives considered**: repassar a tecla de colar ao agente para ele ler a área de
  transferência (comportamento difere entre agentes, versões e plataformas; difícil de testar);
  colar a imagem em base64 no PTY (agentes não interpretam; polui o terminal).

## R2. Onde guardar a imagem colada

- **Decision**: `userData/attachments/<execId>/`, apagada ao remover a execução.
- **Rationale**: Princípio II (o app não escreve na pasta do projeto por conta própria) e privacidade
  (prints podem ter dados sensíveis e não devem ir para o git).
- **Alternatives considered**: `.melinna/anexos` no projeto (escrita do app na pasta do usuário).

## R3. Prévia no renderer

- **Decision**: o main devolve, junto com o caminho, uma miniatura pequena (PNG até 256 px, em base64,
  gerada com `nativeImage.resize`) para a prévia; o renderer não lê arquivos do disco.
- **Rationale**: a CSP do renderer (`default-src 'self'`) não carrega `file://`; manter o renderer sem
  acesso a disco.
- **Alternatives considered**: `file://` na `<img>` (bloqueado pela CSP; abriria brecha).

## R4. Detectar imagem na área de transferência

- **Decision**: no Ctrl+V, o renderer consulta o main (`clipboard.availableFormats()`): se há imagem e
  não há texto, abre o fluxo de imagem; senão deixa o xterm colar o texto.
- **Rationale**: a API de área de transferência do Electron no main é síncrona e confiável nas duas
  plataformas, sem pedir permissão ao usuário.

## R5. Validação

- **Decision**: assinatura dos bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `47 49 46 38`, WebP
  `RIFF....WEBP`) e limite de 20 MB, no núcleo.
- **Rationale**: extensão pode mentir; o limite evita gravar arquivos enormes.
