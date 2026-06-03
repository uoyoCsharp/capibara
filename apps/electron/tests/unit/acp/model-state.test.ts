import { describe, it, expect } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { normalizeModelState } from '@core/infrastructure/acp-protocol/model-state';

function response(overrides: Partial<acp.NewSessionResponse> = {}): acp.NewSessionResponse {
  return { sessionId: 'sess-1', ...overrides } as acp.NewSessionResponse;
}

describe('normalizeModelState', () => {
  it('prefers a configOptions entry with category=model and type=select', () => {
    const state = normalizeModelState(response({
      configOptions: [
        {
          id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'opus',
          options: [
            { value: 'opus', name: 'Opus 4.8', description: 'most capable' },
            { value: 'sonnet', name: 'Sonnet 4.6' },
          ],
        },
      ],
    } as Partial<acp.NewSessionResponse>));

    expect(state.mechanism).toBe('config_option');
    expect(state.configId).toBe('model');
    expect(state.currentModelId).toBe('opus');
    expect(state.models).toEqual([
      { id: 'opus', name: 'Opus 4.8', description: 'most capable' },
      { id: 'sonnet', name: 'Sonnet 4.6' },
    ]);
  });

  it('flattens grouped select options into a single model list', () => {
    const state = normalizeModelState(response({
      configOptions: [
        {
          id: 'model', name: 'Model', type: 'select', category: 'model', currentValue: 'a1',
          options: [
            { groupName: 'Anthropic', options: [{ value: 'a1', name: 'A1' }, { value: 'a2', name: 'A2' }] },
            { groupName: 'OpenAI', options: [{ value: 'o1', name: 'O1' }] },
          ],
        },
      ],
    } as unknown as Partial<acp.NewSessionResponse>));

    expect(state.mechanism).toBe('config_option');
    expect(state.models.map(m => m.id)).toEqual(['a1', 'a2', 'o1']);
  });

  it('falls back to the dedicated models field when no model configOption is present', () => {
    const state = normalizeModelState(response({
      models: {
        currentModelId: 'm2',
        availableModels: [
          { modelId: 'm1', name: 'Model 1' },
          { modelId: 'm2', name: 'Model 2', description: 'newer' },
        ],
      },
    } as Partial<acp.NewSessionResponse>));

    expect(state.mechanism).toBe('set_model');
    expect(state.configId).toBeUndefined();
    expect(state.currentModelId).toBe('m2');
    expect(state.models).toEqual([
      { id: 'm1', name: 'Model 1' },
      { id: 'm2', name: 'Model 2', description: 'newer' },
    ]);
  });

  it('ignores non-model configOptions and a non-select model option', () => {
    const state = normalizeModelState(response({
      configOptions: [
        { id: 'thought', name: 'Thinking', type: 'select', category: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }] },
      ],
    } as Partial<acp.NewSessionResponse>));

    expect(state.mechanism).toBeNull();
    expect(state.models).toEqual([]);
  });

  it('returns an empty unsupported state when neither configOptions nor models are advertised', () => {
    const state = normalizeModelState(response());
    expect(state).toEqual({ models: [], currentModelId: null, mechanism: null });
  });

  it('treats an empty availableModels list as unsupported', () => {
    const state = normalizeModelState(response({
      models: { currentModelId: '', availableModels: [] },
    } as Partial<acp.NewSessionResponse>));
    expect(state.mechanism).toBeNull();
    expect(state.models).toEqual([]);
  });
});
