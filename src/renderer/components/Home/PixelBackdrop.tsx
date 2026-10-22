import { useEffect, useRef } from 'react';

/** Colunas da versão reduzida do vídeo: ampliada pelo CSS, cada pixel vira um bloco visível. */
export const PIXEL_COLUMNS = 160;

/** Linhas da grade, mantendo a proporção do vídeo (quadrada enquanto o vídeo não informa o tamanho). */
export function pixelRows(videoWidth: number, videoHeight: number, columns = PIXEL_COLUMNS): number {
  if (videoWidth <= 0 || videoHeight <= 0) return columns;
  return Math.max(1, Math.round((columns * videoHeight) / videoWidth));
}

/**
 * Fundo da tela inicial: o vídeo, mudo e em loop, redesenhado quadro a quadro numa grade pequena e
 * ampliado sem suavização. Com `prefers-reduced-motion`, fica parado no primeiro quadro.
 */
export function PixelBackdrop({ src }: { src: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const v = video.current;
    const ctx = el?.getContext('2d');
    if (!el || !v || !ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let frame = 0;

    const draw = () => {
      if (v.readyState < 2) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(v, 0, 0, el.width, el.height);
    };
    const loop = () => {
      draw();
      frame = requestAnimationFrame(loop);
    };
    const onMeta = () => {
      el.width = PIXEL_COLUMNS;
      el.height = pixelRows(v.videoWidth, v.videoHeight);
      if (still) {
        v.pause();
        draw();
      } else {
        void v.play().catch(() => undefined);
        frame = requestAnimationFrame(loop);
      }
    };
    v.addEventListener('loadeddata', onMeta);
    if (v.readyState >= 2) onMeta();
    return () => {
      v.removeEventListener('loadeddata', onMeta);
      cancelAnimationFrame(frame);
      v.pause();
    };
  }, [src]);

  return (
    <div className="pixel-backdrop" aria-hidden="true" data-testid="pixel-backdrop">
      <video ref={video} src={src} muted loop playsInline preload="auto" />
      <canvas ref={canvas} width={PIXEL_COLUMNS} height={PIXEL_COLUMNS} />
    </div>
  );
}
