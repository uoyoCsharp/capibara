// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { OrganizationRecord } from '@core/shared/types';

const org: OrganizationRecord = {
  id: 'org-1',
  name: 'Acme',
  description: '',
  customInstructions: '',
  status: 'active',
  autoStartOnCreate: true,
  orgTemplateId: null,
  planningRoleId: null,
  workspacePath: '/tmp',
  createdAt: '',
  updatedAt: '',
};

describe('<App /> (DOM smoke)', () => {
  let controller: MockCapibaraApiController;

  beforeEach(async () => {
    vi.resetModules();
    controller = installMockCapibaraApi();
    vi.mocked(controller.api.getOrganizations).mockResolvedValue({ ok: true, data: [org] });
    vi.mocked(controller.api.getSetting).mockResolvedValue({ ok: true, data: 'true' });
  });

  async function mount() {
    const { App } = await import('@renderer/App');
    return render(<App />);
  }

  it('renders the Dashboard by default once orgs load', async () => {
    const { findByText } = await mount();
    expect(await findByText('Where we are')).toBeInTheDocument();
  });

  it('Cmd/Ctrl+2 switches to the Tasks page', async () => {
    const user = userEvent.setup();
    const { findByText, queryByText } = await mount();
    await findByText('Where we are');

    await user.keyboard('{Control>}2{/Control}');

    await waitFor(() => {
      // Tasks page no longer shows the dashboard narrative section
      expect(queryByText('Where we are')).toBeNull();
    });
  });

  it('renders the sidebar with all current navigation items', async () => {
    const { findByText, getAllByText } = await mount();
    await findByText('Where we are');
    // "Dashboard" appears in both the page title AND the sidebar, so use
    // getAllByText and assert at least one occurrence.
    for (const label of ['Dashboard', 'Tasks', 'Inbox', 'Team', 'Settings']) {
      expect(getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});
