# Contrato: catálogo de agentes (schemaVersion 1)

Arquivos: `catalog/agents.json` (embutido) e `<userData>/catalog.json` (opcional, do usuário). Mesclagem por `id`: a entrada do usuário substitui a embutida inteira.

## Esquema

```ts
interface CatalogFile {
  schemaVersion: 1;
  agents: AgentDefinition[];
}

interface AgentDefinition {
  id: string;                         // ^[a-z0-9][a-z0-9-]{0,31}$
  displayName: string;                // 1–40
  kind: 'agent' | 'shell';
  platforms?: Array<'win32' | 'darwin' | 'linux'>; // ausente = todas
  verifiedWith?: string;              // versão do CLI contra a qual as flags foram conferidas
  executable: {
    command: string;                  // nome no PATH ou caminho absoluto
    windows?: {
      command?: string;               // substitui command no Windows
      npmShim?: { package: string; bin: string }; // resolução segura de .cmd
    };
  };
  args: string[];                     // fixos, antes dos demais
  prompt:
    | { delivery: 'argument'; args: string[] }    // ex.: ["{prompt}"] ou ["--prompt-interactive", "{prompt}"]
    | { delivery: 'pty' }                         // escrito no PTY após a primeira saída
    | { delivery: 'none' };                       // shells
  model?: {
    options: Array<{ id: string; label: string }>;
    default: string;
    allowCustom: boolean;
    args: string[];                   // ex.: ["--model", "{model}"]
    switch: SwitchStrategy;
  };
  permission?: {
    options: Array<{ id: string; label: string; args: string[]; dangerous?: boolean }>;
    default: string;
    switch: SwitchStrategy;
  };
  resume?: { args: string[] };        // usado por restart-resume
  detect: { strategy: 'path' };       // instalado = command resolvido (PATH + PATHEXT ou caminho absoluto)
}

type SwitchStrategy =
  | { strategy: 'pty-command'; template: string } // ex.: "/model {model}\r"
  | { strategy: 'restart-resume' }                // encerra e relança com resume.args
  | { strategy: 'unsupported' };                  // relança sem contexto, com aviso
```

## Regras de montagem do lançamento

Ordem dos argumentos: `args` + `permission.options[sel].args` + `model.args` + (`resume.args` se relançamento com retomada) + `prompt.args`.

- Placeholders válidos: `{model}`, `{prompt}`, `{permission}`. Só substituem quando o elemento do array é exatamente o placeholder; elemento com placeholder parcial é erro de validação do catálogo.
- `template` de `pty-command` aceita `{model}` ou `{permission}` e é escrito como bytes UTF-8 no PTY.
- `restart-resume` sem `resume` é erro de validação.
- `dangerous: true` exige confirmação explícita na interface.
- Entrada com `kind: 'shell'` não pode ter `model`, `permission` nem `prompt.delivery` diferente de `none`.

## Exemplo (formato, não valores finais)

```json
{
  "schemaVersion": 1,
  "agents": [
    {
      "id": "claude",
      "displayName": "Claude Code",
      "kind": "agent",
      "executable": { "command": "claude", "windows": { "npmShim": { "package": "@anthropic-ai/claude-code", "bin": "claude" } } },
      "args": [],
      "prompt": { "delivery": "argument", "args": ["{prompt}"] },
      "model": {
        "options": [{ "id": "sonnet", "label": "Sonnet" }, { "id": "opus", "label": "Opus" }, { "id": "haiku", "label": "Haiku" }],
        "default": "sonnet",
        "allowCustom": true,
        "args": ["--model", "{model}"],
        "switch": { "strategy": "pty-command", "template": "/model {model}\r" }
      },
      "permission": {
        "options": [
          { "id": "default", "label": "Perguntar", "args": ["--permission-mode", "default"] },
          { "id": "acceptEdits", "label": "Aceitar edições", "args": ["--permission-mode", "acceptEdits"] },
          { "id": "plan", "label": "Planejar", "args": ["--permission-mode", "plan"] },
          { "id": "bypassPermissions", "label": "Sem confirmações", "args": ["--permission-mode", "bypassPermissions"], "dangerous": true }
        ],
        "default": "default",
        "switch": { "strategy": "restart-resume" }
      },
      "resume": { "args": ["--continue"] },
      "detect": { "strategy": "path" }
    }
  ]
}
```
