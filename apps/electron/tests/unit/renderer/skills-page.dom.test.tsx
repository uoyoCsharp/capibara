// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders } from './render-with-providers';
import { installMockCapibaraApi, type MockCapibaraApiController } from './mock-capibara-api';
import type { SkillRecord } from '@core/shared/types';

const seededSkills: SkillRecord[] = [
  {
    id: 'builtin-review',
    name: 'Quick Review',
    command: '/review',
    description: 'Peer review the code',
    category: 'review',
    source: 'builtin',
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: '',
  },
  {
    id: 'custom-debug',
    name: 'Deep Debug',
    command: '/debug',
    description: 'Diagnose tricky issues',
    category: 'analysis',
    source: 'custom',
    orgTemplateId: null,
    customPromptContent: null,
    createdAt: '',
  },
];

describe('<SkillsPage /> (DOM smoke)', () => {
  let controller: MockCapibaraApiController;

  beforeEach(async () => {
    vi.resetModules();
    controller = installMockCapibaraApi();
    vi.mocked(controller.api.getSkills).mockResolvedValue({ ok: true, data: seededSkills });
  });

  async function mount() {
    const { SkillsPage } = await import('@renderer/components/skills/SkillsPage');
    return renderWithProviders(<SkillsPage />, { controller });
  }

  it('renders the header with skill count', async () => {
    const { findByText } = await mount();
    expect(await findByText(/2 skills available/)).toBeInTheDocument();
  });

  it('lists every seeded skill card', async () => {
    const { findByText } = await mount();
    expect(await findByText('Quick Review')).toBeInTheDocument();
    expect(await findByText('Deep Debug')).toBeInTheDocument();
  });

  it('shows delete button only for custom-source skills', async () => {
    const { findByLabelText, queryByLabelText } = await mount();
    await findByLabelText('Delete Deep Debug');
    expect(queryByLabelText('Delete Quick Review')).toBeNull();
  });

  it('opens the create dialog when Add Custom Skill is clicked', async () => {
    const { findByText, user } = await mount();
    await user.click(await findByText('Add Custom Skill'));
    expect(await findByText('Create')).toBeInTheDocument();
  });

  it('filters skills by search query', async () => {
    const { findByText, queryByText, container, user } = await mount();
    await findByText('Quick Review');

    const searchInput = container.querySelector('input[placeholder="Search skills..."]') as HTMLInputElement;
    await user.type(searchInput, 'debug');

    await waitFor(() => {
      expect(queryByText('Quick Review')).toBeNull();
    });
    expect(await findByText('Deep Debug')).toBeInTheDocument();
  });
});
