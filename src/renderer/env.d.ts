import type { MelinnaApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    melinna: MelinnaApi;
  }
}

export {};
