import { EditorState } from '@codemirror/state';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { languageFor } from '../../../src/renderer/components/Editor/CodeEditor';
import { StructurePopup } from '../../../src/renderer/components/Editor/StructurePopup';
import {
  extractSymbols,
  filterSymbols,
  NO_SYMBOLS,
  symbolLabel,
  type FileSymbol,
} from '../../../src/renderer/components/Editor/extensions/structure';

function symbolsOf(path: string, doc: string): FileSymbol[] {
  return extractSymbols(EditorState.create({ doc, extensions: [languageFor(path)] }));
}

const summary = (list: FileSymbol[]) => list.map((s) => [symbolLabel(s), s.kind, s.line]);

describe('extractSymbols — TypeScript', () => {
  const source = [
    'export class Servico {',
    '  iniciar() {}',
    '  parar = () => 1;',
    '  static criar() {}',
    '}',
    'function soma(a: number) { return a; }',
    'const dobro = (n: number) => n * 2;',
    'export function exportada() {}',
    'export default class Padrao {}',
    'interface Forma { x: number }',
    'type Id = string;',
    'enum Cor { A }',
    'const valor = 3;',
  ].join('\n');

  it('lists functions, classes and methods in document order, with their lines', () => {
    expect(summary(symbolsOf('a.ts', source))).toEqual([
      ['Servico', 'class', 1],
      ['Servico.iniciar', 'method', 2],
      ['Servico.parar', 'method', 3],
      ['Servico.criar', 'method', 4],
      ['soma', 'function', 6],
      ['dobro', 'function', 7],
      ['exportada', 'function', 8],
      ['Padrao', 'class', 9],
      ['Forma', 'interface', 10],
      ['Id', 'type', 11],
      ['Cor', 'enum', 12],
    ]);
  });

  it('puts methods one level inside their class', () => {
    const list = symbolsOf('a.ts', source);
    expect(list.find((s) => s.name === 'Servico')?.depth).toBe(0);
    expect(list.find((s) => s.name === 'iniciar')?.depth).toBe(1);
  });

  it('does not list plain constants nor locals of a function', () => {
    const list = symbolsOf('a.ts', 'function f() { const g = () => 1; function h() {} }\nconst k = 1;');
    expect(summary(list)).toEqual([['f', 'function', 1]]);
  });

  it('works for JavaScript and JSX files too', () => {
    expect(summary(symbolsOf('a.js', 'function a() {}'))).toEqual([['a', 'function', 1]]);
    expect(summary(symbolsOf('a.jsx', 'const C = () => <div />;'))).toEqual([['C', 'function', 1]]);
  });

  it('returns the position of the start of the symbol', () => {
    const list = symbolsOf('a.ts', 'let x = 1;\nfunction soma() {}');
    expect(list[0]?.from).toBe('let x = 1;\n'.length);
  });
});

describe('extractSymbols — other languages', () => {
  it('JSON: keys of the first and second level only', () => {
    const doc =
      '{\n  "name": "x",\n  "scripts": { "dev": "a", "test": "b", "deep": { "no": 1 } },\n  "list": [1]\n}';
    expect(summary(symbolsOf('package.json', doc))).toEqual([
      ['name', 'key', 2],
      ['scripts', 'key', 3],
      ['scripts.dev', 'key', 3],
      ['scripts.test', 'key', 3],
      ['scripts.deep', 'key', 3],
      ['list', 'key', 4],
    ]);
  });

  it('CSS: the selectors of the rules, including the ones inside @media', () => {
    const doc = '.a, b > c { color: red }\n@media (x) {\n  .m { top: 0 }\n}\n#id   .x{ y: 1 }';
    expect(summary(symbolsOf('a.css', doc))).toEqual([
      ['.a, b > c', 'selector', 1],
      ['.m', 'selector', 3],
      ['#id .x', 'selector', 5],
    ]);
  });

  it('HTML: the elements that have an id', () => {
    const doc =
      '<div id="raiz">\n  <span id=\'a\'>x</span>\n  <p>sem id</p>\n  <img id="logo" src="x">\n</div>';
    expect(summary(symbolsOf('a.html', doc))).toEqual([
      ['div#raiz', 'element', 1],
      ['span#a', 'element', 2],
      ['img#logo', 'element', 4],
    ]);
  });

  it('Markdown: the headings, with the level as depth', () => {
    const doc = '# Título\n\ntexto\n\n## Sub **forte**\n\nSetext\n======\n\n### Fim ###\n';
    const list = symbolsOf('LEIAME.md', doc);
    expect(summary(list)).toEqual([
      ['Título', 'heading', 1],
      ['Sub **forte**', 'heading', 5],
      ['Setext', 'heading', 7],
      ['Fim', 'heading', 10],
    ]);
    expect(list.map((s) => s.depth)).toEqual([0, 1, 0, 2]);
  });

  it('plain text and unknown extensions have no symbols', () => {
    expect(symbolsOf('notas.txt', 'function a() {}')).toEqual([]);
    expect(symbolsOf('Main.java', 'class A {}')).toEqual([]);
  });

  it('an empty file has no symbols in any language', () => {
    for (const path of ['a.ts', 'a.json', 'a.css', 'a.html', 'a.md'])
      expect(symbolsOf(path, ''), path).toEqual([]);
  });
});

describe('filterSymbols', () => {
  const list = symbolsOf('a.ts', 'function Alfa() {}\nfunction beta() {}\nclass Gama { alfinete() {} }');

  it('keeps all without a query', () => {
    expect(filterSymbols(list, '  ')).toHaveLength(4);
  });

  it('filters by the label regardless of case, including the container', () => {
    expect(filterSymbols(list, 'ALF').map((s) => s.name)).toEqual(['Alfa', 'alfinete']);
    expect(filterSymbols(list, 'gama.al').map((s) => s.name)).toEqual(['alfinete']);
    expect(filterSymbols(list, 'zzz')).toEqual([]);
  });
});

describe('StructurePopup', () => {
  const list = symbolsOf('a.ts', 'function alfa() {}\nfunction beta() {}\nfunction alto() {}');

  function setup(symbols: FileSymbol[] = list) {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(createElement(StructurePopup, { symbols, onPick, onClose }));
    return { onPick, onClose };
  }
  const filter = () => screen.getByLabelText('Filtrar símbolos') as HTMLInputElement;
  const names = () =>
    screen.getAllByRole('option').map((o) => o.querySelector('.structure-name')?.textContent);

  it('opens with the filter focused and all the symbols listed', () => {
    setup();
    expect(document.activeElement).toBe(filter());
    expect(names()).toEqual(['alfa', 'beta', 'alto']);
  });

  it('filters while typing', () => {
    setup();
    fireEvent.change(filter(), { target: { value: 'al' } });
    expect(names()).toEqual(['alfa', 'alto']);
    fireEvent.change(filter(), { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum resultado')).toBeTruthy();
  });

  it('moves with the arrows and goes to the chosen one on Enter', () => {
    const { onPick, onClose } = setup();
    fireEvent.keyDown(filter(), { key: 'ArrowDown' });
    fireEvent.keyDown(filter(), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[2]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(filter(), { key: 'ArrowUp' });
    fireEvent.keyDown(filter(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'beta' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('goes to the symbol that was clicked', () => {
    const { onPick } = setup();
    fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option')[2] as HTMLElement);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'alto' }));
  });

  it('says there are no symbols in a file without structure', () => {
    setup([]);
    expect(screen.getByText(NO_SYMBOLS)).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does nothing on Enter without a match, and closes on Esc', () => {
    const { onPick, onClose } = setup();
    fireEvent.change(filter(), { target: { value: 'zzz' } });
    fireEvent.keyDown(filter(), { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(filter(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
