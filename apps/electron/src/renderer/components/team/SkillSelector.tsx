import { useEffect, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import type { SkillRecord } from '@core/shared/types';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Card } from '../ui/card';
import { useT } from '../../hooks/use-locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => window.capibara as any;

interface SkillSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  analysis: 'bg-purple-100 text-purple-700',
  design: 'bg-blue-100 text-blue-700',
  implementation: 'bg-green-100 text-green-700',
  review: 'bg-orange-100 text-orange-700',
  test: 'bg-pink-100 text-pink-700',
  general: 'bg-secondary text-secondary-foreground',
};

export function SkillSelector({ selectedIds, onChange }: SkillSelectorProps) {
  const t = useT();
  const [allSkills, setAllSkills] = useState<SkillRecord[]>([]);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await api().getSkills();
        if (result.ok) {
          setAllSkills(result.data);
        }
      } catch {
        // IPC may fail
      }
    })();
  }, []);

  const selectedSkills = allSkills.filter((s) => selectedIds.includes(s.id));
  const filteredSkills = allSkills.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div>
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedSkills.map((skill) => (
            <Badge
              key={skill.id}
              variant="secondary"
              className={cn(
                'gap-1 rounded-full',
                CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.general,
              )}
            >
              {skill.name}
              <button
                className="hover:opacity-70"
                onClick={() => toggle(skill.id)}
              >
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full justify-start text-muted-foreground font-normal"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen
          ? (t.skillSelector?.closeSelector ?? 'Close')
          : `${t.skillSelector?.selectSkills ?? 'Select Skills'} (${selectedIds.length})`}
      </Button>

      {isOpen && (
        <Card className="mt-2 max-h-48 overflow-auto p-0">
          <div className="sticky top-0 bg-card border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <MagnifyingGlass size={14} className="text-muted-foreground" />
              <input
                type="text"
                className="flex-1 text-xs text-foreground bg-transparent focus:outline-none placeholder:text-muted-foreground"
                placeholder={t.skillSelector?.searchPlaceholder ?? 'Search skills...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="p-2">
            {filteredSkills.map((skill) => (
              <label
                key={skill.id}
                className="flex items-center gap-2 px-2 py-2 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selectedIds.includes(skill.id)}
                  onCheckedChange={() => toggle(skill.id)}
                />
                <span className="flex-1 text-xs text-muted-foreground">{skill.name}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.general,
                  )}
                >
                  {skill.category}
                </span>
              </label>
            ))}
            {filteredSkills.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-2">{t.skillSelector?.noSkillsFound ?? 'No skills found'}</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
