import type { ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { LocaleProvider } from '@renderer/hooks/use-locale';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';

export interface RenderWithProvidersResult extends RenderResult {
  user: UserEvent;
  controller: MockCapibaraApiController;
}

/**
 * Render a component under the renderer's usual providers (LocaleProvider).
 * Stubs `window.capibara` via installMockCapibaraApi so the rendered tree
 * can safely call IPC methods — tests customize the mock via the returned
 * controller.
 *
 *   const { user, controller, getByText } = renderWithProviders(<MyPage />);
 *   vi.mocked(controller.api.getOrganizations).mockResolvedValue(...);
 *   await user.click(getByText('Save'));
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { controller?: MockCapibaraApiController },
): RenderWithProvidersResult {
  const controller = options?.controller ?? installMockCapibaraApi();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <LocaleProvider>{children}</LocaleProvider>
  );

  const result = render(ui, { wrapper, ...options });

  return {
    ...result,
    user: userEvent.setup(),
    controller,
  };
}

/**
 * Reset store singletons between tests. Zustand stores are module-scoped so
 * a fresh `vi.resetModules()` before each test is required for isolation.
 */
export function resetRendererModules(): void {
  vi.resetModules();
}
