import { describe, expect, it } from 'vitest';
import { validateCatalog } from '../../../../src/core/catalog/validate';

function load(images: unknown) {
  return validateCatalog(
    {
      schemaVersion: 1,
      agents: [
        {
          id: 'claude',
          displayName: 'Claude Code',
          kind: 'agent',
          executable: { command: 'claude' },
          args: [],
          prompt: { delivery: 'argument', args: ['{prompt}'] },
          detect: { strategy: 'path' },
          ...(images === undefined ? {} : { images }),
        },
      ],
    },
    'user',
  );
}

describe('catalog images', () => {
  it('accepts an agent without images', () => {
    const r = load(undefined);
    expect(r.invalid).toEqual([]);
    expect(r.agents[0]?.images).toBeUndefined();
  });

  it.each([
    [{ template: '{path}', quote: 'when-needed' }],
    [{ template: '@{path}', quote: 'always' }],
    [{ template: '[img {path}]', quote: 'when-needed' }],
  ])('accepts %j', (images) => {
    const r = load(images);
    expect(r.invalid).toEqual([]);
    expect(r.agents[0]?.images).toEqual(images);
  });

  it.each([
    ['template without {path}', { template: '@arquivo', quote: 'always' }, '{path}'],
    ['template with {path} twice', { template: '{path} {path}', quote: 'always' }, '{path}'],
    ['missing template', { quote: 'always' }, 'template'],
    ['empty template', { template: '', quote: 'always' }, 'template'],
    ['non-text template', { template: 3, quote: 'always' }, 'template'],
    ['unknown quote', { template: '{path}', quote: 'never' }, 'quote'],
    ['missing quote', { template: '{path}' }, 'quote'],
    ['not an object', '{path}', 'images'],
  ])('refuses %s as a CatalogIssue', (_name, images, reason) => {
    const r = load(images);
    expect(r.agents).toEqual([]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]).toMatchObject({ source: 'user', id: 'claude' });
    expect(r.invalid[0]?.reason).toContain(reason);
  });
});
