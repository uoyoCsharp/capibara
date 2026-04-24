import type { CapibaraApi } from '@core/shared/api';

declare global {
  interface Window {
    capibara: CapibaraApi;
  }
}
