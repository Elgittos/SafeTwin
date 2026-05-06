import type { SafeTwinApi } from '../shared/types';

declare global {
  interface Window {
    safetwin: SafeTwinApi;
  }
}

export {};
