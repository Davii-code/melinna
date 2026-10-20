export type Cancel = () => void;

export interface Clock {
  now(): Date;
  setTimeout(fn: () => void, ms: number): Cancel;
}
