/** As seis faixas da marca, na ordem fixa. */
export const BANDS = ['#ff3b30', '#ff9f0a', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'] as const;

export const THEME = {
  field: '#090b12',
  text: '#e7eaf6',
  core: '#f8f9ff',
  prism: '#a4aec7',
  accent: '#708bff',
  borderStrong: '#343b55',
  borderWeak: '#22283b',
  surface: '#0e121d',
  surfaceRaised: '#181e2e',
} as const;

export function bandColor(index: number): string {
  const i = ((Math.trunc(index) % BANDS.length) + BANDS.length) % BANDS.length;
  return BANDS[i] ?? BANDS[0];
}

/** Número exibido junto da cor a partir da 7ª execução (índice ≥ 6); antes disso, nenhum. */
export function bandLabel(index: number): string | null {
  return index >= BANDS.length ? String(index + 1) : null;
}
