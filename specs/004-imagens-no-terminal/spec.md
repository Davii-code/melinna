# Feature Specification: Imagens no chat do terminal

**Feature Branch**: `004-imagens-no-terminal`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Imagens no chat do terminal (bloco 4 de docs/ideias-proximas-versoes.md): colar (Ctrl+V, inclusive print de tela), arrastar ou anexar imagens no terminal do agente, como no Claude Code rodando num terminal comum."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Colar uma imagem da área de transferência (Priority: P1)

O usuário tira um print de tela (PrtSc ou Win+Shift+S no Windows, a captura do sistema no Linux), clica no painel do agente e aperta Ctrl+V. A imagem chega ao agente, que passa a enxergá-la na conversa.

**Why this priority**: é o uso diário: mostrar ao agente um erro, uma tela ou um mockup.

**Independent Test**: colocar uma imagem na área de transferência, colar no painel de um agente que aceita imagens e conferir que o agente recebeu a referência da imagem no prompt.

**Acceptance Scenarios**:

1. **Given** uma imagem na área de transferência e o painel de um agente que aceita imagens em foco, **When** o usuário aperta Ctrl+V, **Then** aparece uma prévia da imagem com "Enviar" e "Cancelar".
2. **Given** a prévia aberta, **When** o usuário escolhe "Enviar", **Then** o agente recebe a referência da imagem no ponto do cursor do prompt, sem apertar Enter por ele.
3. **Given** a prévia aberta, **When** o usuário escolhe "Cancelar" ou aperta Esc, **Then** nada é enviado ao agente.
4. **Given** texto na área de transferência, **When** o usuário aperta Ctrl+V, **Then** o texto é colado como hoje, sem prévia.

---

### User Story 2 - Arrastar ou anexar arquivos de imagem (Priority: P2)

O usuário arrasta um arquivo de imagem do explorador do sistema para o painel do agente, ou usa o botão de anexar e escolhe o arquivo.

**Why this priority**: cobre imagens que já estão em arquivo; menos frequente que colar.

**Independent Test**: arrastar um PNG para o painel e conferir que, após "Enviar", o agente recebe o caminho do arquivo.

**Acceptance Scenarios**:

1. **Given** o painel de um agente que aceita imagens, **When** o usuário solta um arquivo de imagem nele, **Then** aparece a prévia e, ao enviar, o agente recebe a referência daquele arquivo.
2. **Given** o painel, **When** o usuário usa "Anexar imagem" e escolhe um ou mais arquivos, **Then** cada um aparece na prévia e todos vão juntos ao enviar.
3. **Given** um arquivo que não é imagem aceita, **When** o usuário o solta ou escolhe, **Then** ele é recusado com mensagem e nada é enviado.

---

### User Story 3 - Agentes sem suporte a imagem (Priority: P3)

O usuário cola uma imagem no painel de um shell ou de um agente que não aceita imagens. O app avisa em vez de escrever lixo no terminal.

**Why this priority**: evita confusão; o fluxo principal não depende disso.

**Independent Test**: colar uma imagem no painel de um shell e ver o aviso, sem nada escrito no terminal.

**Acceptance Scenarios**:

1. **Given** o painel de um agente sem suporte a imagem, **When** o usuário cola ou solta uma imagem, **Then** aparece o aviso "Este agente não recebe imagens" e nada é escrito no terminal.

---

### User Story 4 - Anexos limpos junto com a sessão (Priority: P3)

Imagens coladas viram arquivos guardados pelo app; quando a sessão é removida, esses arquivos saem junto.

**Why this priority**: evita acumular imagens (que podem ter dados sensíveis) no disco.

**Independent Test**: colar duas imagens numa sessão, remover a sessão e conferir que os anexos dela sumiram.

**Acceptance Scenarios**:

1. **Given** uma sessão com imagens coladas, **When** a sessão é removida, **Then** os anexos dela são apagados.
2. **Given** imagens arrastadas ou anexadas a partir de um arquivo do usuário, **When** a sessão é removida, **Then** o arquivo original do usuário não é apagado.

### Edge Cases

- Área de transferência com imagem e texto ao mesmo tempo: o texto prevalece (comportamento atual).
- Imagem maior que o limite (20 MB): recusada com mensagem dizendo o limite.
- Formato não aceito (aceitos: PNG, JPEG, GIF, WebP): recusado com mensagem.
- Execução encerrada ou ainda iniciando: colar imagem é recusado com mensagem; nada é gravado.
- Caminho com espaços: a referência é enviada entre aspas, no formato que o agente aceita.
- Vários arquivos soltos de uma vez: todos na mesma prévia; os que não forem imagem aceita são listados como recusados.
- Falha ao gravar o anexo (disco cheio, sem permissão): mensagem de erro; nada é enviado.
- Arquivo arrastado é removido do disco antes de enviar: recusado com mensagem ao enviar.
- Sessão termina com a prévia aberta: a prévia fecha com aviso e nada é enviado.
- Área de transferência muda ou fica vazia entre o Ctrl+V e a leitura da imagem: nada é colado e aparece "Nenhuma imagem na área de transferência".
- Prévia aberta em dois painéis ao mesmo tempo: cada painel tem a sua prévia e envia só ao próprio agente.
- Atalho (link simbólico) ou pasta solta no painel: recusado com mensagem.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Com o painel de um agente em foco, Ctrl+V com imagem (e sem texto) na área de transferência MUST abrir a prévia da imagem.
- **FR-002**: Soltar arquivos no painel e o botão "Anexar imagem" MUST abrir a prévia com os arquivos de imagem aceitos.
- **FR-003**: A prévia MUST mostrar miniatura e nome de cada imagem, com "Enviar" e "Cancelar"; Esc cancela.
- **FR-004**: "Enviar" MUST escrever no prompt do agente a referência de cada imagem, no formato declarado para aquele agente, separadas por espaço, sem enviar Enter.
- **FR-005**: O suporte a imagens MUST ser uma capacidade opcional declarada por agente, incluindo a forma de referência que ele entende; acrescentar suporte a um agente não exige mudar o motor.
- **FR-006**: Para agente sem a capacidade, colar ou soltar imagem MUST mostrar "Este agente não recebe imagens" e não escrever nada no terminal.
- **FR-007**: Imagem vinda da área de transferência MUST ser gravada pelo app num arquivo de anexo da sessão, fora das pastas do projeto; arquivo arrastado ou anexado MUST ser referenciado no lugar original, sem cópia.
- **FR-008**: Formatos aceitos MUST ser PNG, JPEG, GIF e WebP, até 20 MB por imagem e até 20 imagens por envio; só arquivos comuns (não pastas nem atalhos que apontam para fora); fora disso, recusa com mensagem.
- **FR-013**: Ao enviar, o sistema MUST conferir de novo cada arquivo; arquivo removido ou alterado para um formato não aceito desde a prévia MUST ser recusado com mensagem.
- **FR-014**: Anexos de sessões que não existem mais (por exemplo, após o app fechar de forma inesperada) MUST ser apagados na próxima abertura do app.
- **FR-009**: Remover a sessão MUST apagar os anexos gravados pelo app para ela e MUST NOT apagar arquivos originais do usuário.
- **FR-010**: Colar texto MUST continuar funcionando como hoje.
- **FR-011**: Colar imagem em execução que não está rodando MUST ser recusado com mensagem, sem gravar nada.
- **FR-012**: Cada anexo gravado MUST registrar no log a sessão, o tamanho e o formato, sem o conteúdo da imagem.

### Key Entities

- **Sessão (execução)**: um terminal de agente; "sessão" na interface corresponde a uma execução no sistema.
- **Anexo de imagem**: arquivo gravado pelo app para uma sessão, com formato, tamanho e data; apagado com a sessão.
- **Capacidade de imagem do agente**: se o agente recebe imagens e a forma de referência que ele entende (detalhada no plano).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Do print de tela à imagem no prompt do agente em no máximo 3 ações do usuário (capturar, colar, enviar).
- **SC-002**: A prévia aparece em menos de 1 segundo para imagens de até 5 MB.
- **SC-003**: Após remover uma sessão, 0 anexos dela permanecem no disco.
- **SC-004**: 0 ocorrências de texto ilegível escrito no terminal ao colar imagem num agente sem suporte.

## Assumptions

- O agente lê a imagem a partir da referência ao caminho no prompt: Claude Code aceita o caminho do arquivo; Gemini aceita `@caminho`; o formato exato de cada um é conferido na versão instalada antes de entrar no catálogo.
- Anexos ficam na pasta de dados do app (privada do usuário), não no projeto, para não irem para o git sem querer.
- Atalho de colar é Ctrl+V no Windows e no Linux; Ctrl+Shift+V continua colando só texto.
- Fora de escopo: editar a imagem (recortar, marcar), colar imagem em agente que só aceita imagem no lançamento, imagens em vídeo ou PDF.
