import type { CapibaraApi } from '@shared/contracts';

declare global {
  interface Window {
    capibara: CapibaraApi;
  }
}
