import { useEffect, useState } from 'react';
import { Lightning, Plus, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { useOrganizationStore } from '../../store/organization.store';
import type { SkillRecord } from '@core/shared/types';

const CATEGORY_COLORS: Record<string, string> = {
  analysis: 'bg-blue-500/10 text-blue-600',
  design: 'bg-purple-500/10 text-purple-600',
  implementation: 'bg-green-500/10 text-green-600',
  review: 'bg-yellow-500/10 text-yellow-600',
  test: 'bg-red-500/10 text-red-600',
  general: 'bg-muted text-muted-foreground',
};

const SOURCE_COLORS: Record<string, string> = {
  builtin: 'bg-primary/10 text-primary',
  template: 'bg-accent text-accent-foreground',
  custom: 'bg-secondary text-secondary-foreground',
};

export function SkillsPage() {
  const skills = useOrganizationStore((s) => s.skills);
  const isLoading = useOrganizationStore((s) => s.isLoadingSkills);
  const loadSkills = useOrganizationStore((s) => s.loadSkills);
  const deleteSkill = useOrganizationStore((s) => s.deleteSkill);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const filtered = skills.filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.command.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && s.category !== filterCategory) return false;
    return true;
  });

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Lightning size={28} weight="duotone" />
            Skills & Knowledge
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{skills.length} skills available</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus size={16} weight="bold" />
          Add Custom Skill
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="">All Categories</option>
          <option value="analysis">Analysis</option>
          <option value="design">Design</option>
          <option value="implementation">Implementation</option>
          <option value="review">Review</option>
          <option value="test">Test</option>
          <option value="general">General</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Lightning size={48} weight="duotone" />
          <p>{search || filterCategory ? 'No skills match your filters' : 'No skills available'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((skill) => (
            <SkillCard key={skill.id} skill={skill} onDelete={deleteSkill} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, onDelete }: { skill: SkillRecord; onDelete: (id: string) => Promise<boolean> }) {
  return (
    <div className="p-4 rounded-lg border border-border hover:border-primary/30 transition-colors space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{skill.name}</h3>
          <code className="text-xs text-muted-foreground">{skill.command}</code>
        </div>
        {skill.source === 'custom' && (
          <button
            onClick={() => void onDelete(skill.id)}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash size={16} />
          </button>
        )}
      </div>
      {skill.description && (
        <p className="text-sm text-muted-foreground line-clamp-2">{skill.description}</p>
      )}
      <div className="flex items-center gap-2">
        <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.general}`}>
          {skill.category}
        </span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${SOURCE_COLORS[skill.source] ?? SOURCE_COLORS.custom}`}>
          {skill.source}
        </span>
      </div>
    </div>
  );
}
