/** As seis faixas da marca, na ordem fixa. */
export const BANDS = ['#ff3b30', '#ff9f0a', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'] as const;

export const THEME = {
  field: '#07080b',
  text: '#e6e9ef',
  core: '#ffffff',
  prism: '#8b95a5',
  accent: '#4f8cff',
  borderStrong: '#262c36',
  borderWeak: '#1b212b',
  surface: '#0b0d12',
  surfaceRaised: '#12151b',
} as const;

export function bandColor(index: number): string {
  const i = ((Math.trunc(index) % BANDS.length) + BANDS.length) % BANDS.length;
  return BANDS[i] ?? BANDS[0];
}

/** Número exibido junto da cor a partir da 7ª execução (índice ≥ 6); antes disso, nenhum. */
export function bandLabel(index: number): string | null {
  return index >= BANDS.length ? String(index + 1) : null;
}
