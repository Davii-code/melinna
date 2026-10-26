import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// O jsdom não mede texto: o CodeMirror pede retângulos de `Range` ao rolar e ao posicionar o cursor.
// Sem layout real, devolver retângulos vazios basta para os testes de estado e de comandos do editor.
if (typeof Range !== 'undefined') {
  const emptyRect = (): DOMRect => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  });
  const emptyRects = (): DOMRectList => {
    const list: DOMRect[] = [];
    return Object.assign(list, { item: () => null }) as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect ??= emptyRect;
  Range.prototype.getClientRects ??= emptyRects;
}
