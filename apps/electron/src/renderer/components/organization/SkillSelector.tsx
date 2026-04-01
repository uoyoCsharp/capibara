import { useEffect, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import type { SkillRecord } from '@shared/contracts';
import { clsx } from 'clsx';

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
  general: 'bg-gray-100 text-gray-700',
};

export function SkillSelector({ selectedIds, onChange }: SkillSelectorProps) {
  const [allSkills, setAllSkills] = useState<SkillRecord[]>([]);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.capibara.getSkills();
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
      {/* Selected skill tags */}
      {selectedSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedSkills.map((skill) => (
            <span
              key={skill.id}
              className={clsx(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
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
            </span>
          ))}
        </div>
      )}

      {/* Toggle dropdown */}
      <button
        type="button"
        className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:border-gray-300"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? 'Close skill selector' : `Select skills (${selectedIds.length} selected)`}
      </button>

      {isOpen && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white shadow-sm max-h-48 overflow-auto">
          {/* Search */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <MagnifyingGlass size={14} className="text-gray-400" />
              <input
                type="text"
                className="flex-1 text-xs focus:outline-none"
                placeholder="Search skills..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Skill list grouped by category */}
          <div className="p-1">
            {filteredSkills.map((skill) => (
              <label
                key={skill.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  checked={selectedIds.includes(skill.id)}
                  onChange={() => toggle(skill.id)}
                />
                <span className="flex-1 text-xs text-gray-700">{skill.name}</span>
                <span
                  className={clsx(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.general,
                  )}
                >
                  {skill.category}
                </span>
              </label>
            ))}
            {filteredSkills.length === 0 && (
              <p className="text-xs text-gray-400 px-2 py-2">No skills found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
