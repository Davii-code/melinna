import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PIXEL_COLUMNS, PixelBackdrop, pixelRows } from '../../../src/renderer/components/Home/PixelBackdrop';

describe('pixelRows', () => {
  it('keeps the video aspect ratio on the reduced grid', () => {
    expect(pixelRows(1280, 720)).toBe(90);
    expect(pixelRows(720, 1280)).toBe(284);
    expect(pixelRows(1280, 720, 64)).toBe(36);
    expect(pixelRows(0, 0)).toBe(PIXEL_COLUMNS);
  });
});

describe('PixelBackdrop', () => {
  it('plays the video muted and in a loop behind a pixel canvas, hidden from assistive tech', () => {
    render(<PixelBackdrop src="/fundo.mp4" />);
    const root = screen.getByTestId('pixel-backdrop');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const video = root.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/fundo.mp4');
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(root.querySelector('canvas')?.width).toBe(PIXEL_COLUMNS);
  });
});
