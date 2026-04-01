import type { CapibaraApi } from '@shared/contracts';

declare module '*.png' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    capibara: CapibaraApi;
  }
}
