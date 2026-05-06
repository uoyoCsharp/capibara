// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderWithProviders } from './render-with-providers';
import { SettingsPage } from '@renderer/components/settings/SettingsPage';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import { waitFor } from '@testing-library/react';

describe('<SettingsPage /> (DOM smoke)', () => {
  let controller: MockCapibaraApiController;

  beforeEach(() => {
    vi.resetModules();
    controller = installMockCapibaraApi();
  });

  it('renders language section and log management', async () => {
    const { getByText, queryByText } = renderWithProviders(<SettingsPage />, { controller });
    expect(getByText('Language')).toBeInTheDocument();
    expect(getByText('Execution Logs')).toBeInTheDocument();
    // "System" section was removed as it had no practical purpose.
    expect(queryByText('System')).not.toBeInTheDocument();
  });

  it('loads persisted locale on mount', async () => {
    vi.mocked(controller.api.getSetting).mockResolvedValue({ ok: true, data: 'zh-CN' });
    const { container } = renderWithProviders(<SettingsPage />, { controller });

    await waitFor(() => {
      const select = container.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('zh-CN');
    });
  });

  it('changing the language dropdown and clicking Save triggers setSetting', async () => {
    const { container, getByText, user } = renderWithProviders(<SettingsPage />, { controller });

    // Wait for initial load to settle
    await waitFor(() => expect(controller.api.getSetting).toHaveBeenCalled());

    const select = container.querySelector('select') as HTMLSelectElement;
    await user.selectOptions(select, 'zh-CN');

    await user.click(getByText('Save Settings'));

    expect(controller.api.setSetting).toHaveBeenCalledWith('locale', 'zh-CN');
  });

  it('renders log stats when available', async () => {
    vi.mocked(controller.api.getLogStats).mockResolvedValue({
      ok: true,
      data: { totalSizeMB: 42, fileCount: 17, oldestMonth: '2026-01', newestMonth: '2026-04' },
    });

    const { findByText } = renderWithProviders(<SettingsPage />, { controller });

    expect(await findByText('42 MB')).toBeInTheDocument();
    expect(await findByText('17')).toBeInTheDocument();
    expect(await findByText('2026-01')).toBeInTheDocument();
  });

  it('clear-all button is disabled when file count is 0', async () => {
    vi.mocked(controller.api.getLogStats).mockResolvedValue({
      ok: true,
      data: { totalSizeMB: 0, fileCount: 0, oldestMonth: null, newestMonth: null },
    });

    const { findByText } = renderWithProviders(<SettingsPage />, { controller });
    const clearAll = (await findByText('Clear All Logs')).closest('button') as HTMLButtonElement;

    expect(clearAll.disabled).toBe(true);
  });
});
