import type * as acp from '@agentclientprotocol/sdk';
import type { AvailableModel, ModelState } from '../types/acp.types';

/** Empty (unsupported) model state — the agent advertised neither configOptions(model) nor models. */
const UNSUPPORTED: ModelState = { models: [], currentModelId: null, mechanism: null };

/**
 * Derive a normalized {@link ModelState} from a `session/new` response (ADR-1).
 *
 * Precedence: a `configOptions` entry with `category: 'model'` and `type: 'select'` (the preferred,
 * stable mechanism) wins over the dedicated, experimental `models` field. When neither is present
 * the agent does not support model selection and an empty state is returned. `configOptions` select
 * values may be flat or grouped (`SessionConfigSelectGroup`); both are flattened to a single list.
 */
export function normalizeModelState(response: acp.NewSessionResponse): ModelState {
  const configModel = response.configOptions?.find(
    (opt): opt is acp.SessionConfigOption & { type: 'select' } =>
      opt.type === 'select' && opt.category === 'model',
  );
  if (configModel) {
    return {
      models: flattenSelectOptions(configModel.options).map(toAvailableModel),
      currentModelId: configModel.currentValue,
      mechanism: 'config_option',
      configId: configModel.id,
    };
  }

  if (response.models && response.models.availableModels.length > 0) {
    return {
      models: response.models.availableModels.map(modelInfoToAvailable),
      currentModelId: response.models.currentModelId,
      mechanism: 'set_model',
    };
  }

  return UNSUPPORTED;
}

/** Flatten select options that may be either a flat list or a list of groups into a flat option list. */
function flattenSelectOptions(options: acp.SessionConfigSelectOptions): acp.SessionConfigSelectOption[] {
  return options.flatMap((entry) =>
    'options' in entry ? entry.options : [entry],
  );
}

function toAvailableModel(opt: acp.SessionConfigSelectOption): AvailableModel {
  return { id: opt.value, name: opt.name, ...(opt.description ? { description: opt.description } : {}) };
}

function modelInfoToAvailable(info: acp.ModelInfo): AvailableModel {
  return { id: info.modelId, name: info.name, ...(info.description ? { description: info.description } : {}) };
}
