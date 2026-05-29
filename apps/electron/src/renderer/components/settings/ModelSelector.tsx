import { useState, useEffect, useCallback } from 'react';
import { Cube } from '@phosphor-icons/react';
import type { ModelStateSummary } from '@core/shared/types';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/use-locale';

const api = () => window.capibara;

export function ModelSelector() {
  const t = useT();
  const ms = t.settings.modelSelector;
  const [state, setState] = useState<ModelStateSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api().getModelState().then((result) => {
      if (result.ok) setState(result.data);
    });
  }, []);

  const handleChange = useCallback(async (modelId: string) => {
    setSaving(true);
    setError(null);
    const result = await api().setSelectedModel(modelId);
    if (result.ok) {
      setState(result.data);
    } else {
      setError(ms.saveError);
    }
    setSaving(false);
  }, [ms.saveError]);

  if (!state) return null;

  if (!state.supported) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Cube size={14} />
          {ms.title}
        </h3>
        <Select disabled>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={ms.unsupported} />
          </SelectTrigger>
        </Select>
        <p className="text-xs text-muted-foreground">{ms.unsupportedHint}</p>
      </div>
    );
  }

  const value = state.selectedModelId ?? state.currentModelId ?? undefined;

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <Cube size={14} />
        {ms.title}
      </h3>
      <Select value={value} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={ms.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {state.models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              <span className="flex items-center gap-2">
                {model.name}
                {model.id === state.currentModelId && (
                  <Badge variant="secondary" className="text-xs">{ms.active}</Badge>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{ms.hint}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
