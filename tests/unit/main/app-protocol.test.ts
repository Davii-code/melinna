import { describe, expect, it } from 'vitest';
import { mimeOf } from '../../../src/main/app-protocol';

describe('mimeOf', () => {
  it('serves the background video and the other assets with their types', () => {
    expect(mimeOf('C:/app/out/renderer/assets/background-abc.mp4')).toBe('video/mp4');
    expect(mimeOf('/app/avatar.JPG')).toBe('image/jpeg');
    expect(mimeOf('/app/arquivo.desconhecido')).toBe('application/octet-stream');
  });
});
