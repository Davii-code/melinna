import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'key'
  | 'selector'
  | 'element'
  | 'heading';

/** Um item da estrutura do arquivo: funções, classes, métodos, chaves, seletores, elementos com id ou títulos. */
export interface FileSymbol {
  name: string;
  kind: SymbolKind;
  /** Quem contém o símbolo (a classe de um método, a chave pai no JSON); `null` no primeiro nível. */
  container: string | null;
  /** Posição do início do símbolo no documento. */
  from: number;
  /** Linha do símbolo, a partir de 1. */
  line: number;
  /** Nível de aninhamento, a partir de 0 (recuo na lista). */
  depth: number;
}

type Node = ReturnType<typeof syntaxTree>['topNode'];

export const NO_SYMBOLS = 'Nenhum símbolo neste arquivo';

function children(node: Node): Node[] {
  const list: Node[] = [];
  for (let c = node.firstChild; c !== null; c = c.nextSibling) list.push(c);
  return list;
}

function childNamed(node: Node, ...names: string[]): Node | null {
  return children(node).find((c) => names.includes(c.name)) ?? null;
}

const DEFINITIONS = ['VariableDefinition', 'TypeDefinition', 'PropertyDefinition', 'DefinitionClassName'];

function stripQuotes(text: string): string {
  return text.replace(/^["'`]|["'`]$/g, '');
}

class Collector {
  readonly symbols: FileSymbol[] = [];

  constructor(private readonly state: EditorState) {}

  text(node: Node): string {
    return this.state.doc.sliceString(node.from, node.to);
  }

  slice(from: number, to: number): string {
    return this.state.doc.sliceString(from, to);
  }

  add(name: string, kind: SymbolKind, at: number, container: string | null, depth: number): void {
    const trimmed = name.trim();
    if (trimmed === '') return;
    this.symbols.push({
      name: trimmed,
      kind,
      container,
      from: at,
      line: this.state.doc.lineAt(at).number,
      depth,
    });
  }

  nameOf(node: Node): string | null {
    const def = childNamed(node, ...DEFINITIONS);
    return def === null ? null : this.text(def);
  }
}

function isFunctionValue(node: Node): boolean {
  return childNamed(node, 'ArrowFunction', 'FunctionExpression') !== null;
}

function collectScript(out: Collector, node: Node, container: string | null, depth: number): void {
  for (const child of children(node)) {
    switch (child.name) {
      case 'ExportDeclaration':
        collectScript(out, child, container, depth);
        break;
      case 'FunctionDeclaration': {
        const name = out.nameOf(child);
        if (name !== null) out.add(name, 'function', child.from, container, depth);
        break;
      }
      case 'ClassDeclaration': {
        const name = out.nameOf(child);
        if (name === null) break;
        out.add(name, 'class', child.from, container, depth);
        const body = childNamed(child, 'ClassBody');
        if (body !== null) {
          for (const member of children(body)) {
            const isMethod =
              member.name === 'MethodDeclaration' ||
              (member.name === 'PropertyDeclaration' && isFunctionValue(member));
            const memberName = isMethod ? out.nameOf(member) : null;
            if (memberName !== null) out.add(memberName, 'method', member.from, name, depth + 1);
          }
        }
        break;
      }
      case 'VariableDeclaration': {
        if (isFunctionValue(child)) {
          const name = out.nameOf(child);
          if (name !== null) out.add(name, 'function', child.from, container, depth);
        }
        break;
      }
      case 'InterfaceDeclaration':
      case 'TypeAliasDeclaration':
      case 'EnumDeclaration': {
        const name = out.nameOf(child);
        const kind =
          child.name === 'InterfaceDeclaration'
            ? 'interface'
            : child.name === 'EnumDeclaration'
              ? 'enum'
              : 'type';
        if (name !== null) out.add(name, kind, child.from, container, depth);
        break;
      }
      default:
    }
  }
}

function collectJson(out: Collector, object: Node | null, container: string | null, depth: number): void {
  if (object === null || depth > 1) return;
  for (const property of children(object)) {
    if (property.name !== 'Property') continue;
    const key = childNamed(property, 'PropertyName');
    if (key === null) continue;
    const name = stripQuotes(out.text(key));
    out.add(name, 'key', property.from, container, depth);
    collectJson(out, childNamed(property, 'Object'), name, depth + 1);
  }
}

function collectCss(out: Collector, node: Node): void {
  for (const child of children(node)) {
    if (child.name === 'RuleSet') {
      const block = childNamed(child, 'Block');
      const selector = out.slice(child.from, block === null ? child.to : block.from);
      out.add(selector.replace(/\s+/g, ' '), 'selector', child.from, null, 0);
    }
    collectCss(out, child);
  }
}

function collectHtml(out: Collector, node: Node): void {
  for (const child of children(node)) {
    if (child.name === 'Element') {
      const open = childNamed(child, 'OpenTag', 'SelfClosingTag');
      const tag = open === null ? null : childNamed(open, 'TagName');
      for (const attr of open === null ? [] : children(open)) {
        if (attr.name !== 'Attribute') continue;
        const attrName = childNamed(attr, 'AttributeName');
        const value = childNamed(attr, 'AttributeValue');
        if (attrName !== null && value !== null && out.text(attrName).toLowerCase() === 'id') {
          const id = stripQuotes(out.text(value));
          out.add(`${tag === null ? '' : out.text(tag)}#${id}`, 'element', child.from, null, 0);
        }
      }
    }
    collectHtml(out, child);
  }
}

const HEADING = /^(ATXHeading|SetextHeading)([1-6])$/;

function collectMarkdown(out: Collector, node: Node): void {
  for (const child of children(node)) {
    const match = HEADING.exec(child.name);
    if (match) {
      const raw = out.text(child);
      const text =
        match[1] === 'ATXHeading'
          ? raw.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '')
          : (raw.split(/\r?\n/)[0] ?? '');
      out.add(text, 'heading', child.from, null, Number(match[2]) - 1);
    } else {
      collectMarkdown(out, child);
    }
  }
}

/**
 * Estrutura do arquivo a partir da árvore de sintaxe que a linguagem do editor já monta: funções, classes e
 * métodos (JavaScript/TypeScript), chaves de primeiro e segundo nível (JSON), seletores (CSS), elementos com
 * `id` (HTML) e títulos (Markdown). Texto puro não tem árvore e devolve lista vazia.
 */
export function extractSymbols(state: EditorState): FileSymbol[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state);
  const out = new Collector(state);
  const top = tree.topNode;
  switch (top.name) {
    case 'Script':
      collectScript(out, top, null, 0);
      break;
    case 'JsonText':
      collectJson(out, childNamed(top, 'Object'), null, 0);
      break;
    case 'StyleSheet':
      collectCss(out, top);
      break;
    case 'Document':
      collectHtml(out, top);
      collectMarkdown(out, top);
      break;
    default:
  }
  return out.symbols.sort((a, b) => a.from - b.from);
}

/** Texto mostrado na lista: o nome, com o contêiner na frente quando há. */
export function symbolLabel(symbol: FileSymbol): string {
  return symbol.container === null ? symbol.name : `${symbol.container}.${symbol.name}`;
}

/** Itens cujo texto contém o que foi digitado (sem diferenciar maiúsculas); vazio = todos. */
export function filterSymbols(symbols: readonly FileSymbol[], query: string): FileSymbol[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return [...symbols];
  return symbols.filter((s) => symbolLabel(s).toLowerCase().includes(wanted));
}
