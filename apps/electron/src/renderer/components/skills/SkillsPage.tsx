import { useEffect, useState, useCallback } from 'react';
import { MagnifyingGlass, Plus, Pencil, Trash, Funnel } from '@phosphor-icons/react';
import type { SkillRecord, SkillCategory, SkillSource } from '@shared/contracts';
import { clsx } from 'clsx';
import { SkillFormModal } from './SkillFormModal';

const CATEGORIES: Array<{ value: SkillCategory; label: string }> = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'design', label: 'Design' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'review', label: 'Review' },
  { value: 'test', label: 'Test' },
  { value: 'general', label: 'General' },
];

const SOURCES: Array<{ value: SkillSource; label: string }> = [
  { value: 'builtin', label: 'Built-in' },
  { value: 'template', label: 'Template' },
  { value: 'custom', label: 'Custom' },
];

const CATEGORY_COLORS: Record<string, string> = {
  analysis: 'bg-purple-100 text-purple-700',
  design: 'bg-blue-100 text-blue-700',
  implementation: 'bg-green-100 text-green-700',
  review: 'bg-orange-100 text-orange-700',
  test: 'bg-pink-100 text-pink-700',
  general: 'bg-neutral-subtle text-neutral-text',
};

const SOURCE_COLORS: Record<string, string> = {
  builtin: 'bg-success-subtle text-success-text',
  template: 'bg-info-subtle text-info-text',
  custom: 'bg-warning-subtle text-warning-text',
};

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<SkillCategory | ''>('');
  const [filterSource, setFilterSource] = useState<SkillSource | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSkills = useCallback(async (q: string, cat: SkillCategory | '', src: SkillSource | '') => {
    try {
      const result = await window.capibara.searchSkills({
        query: q,
        category: cat || null,
        source: src || null,
      });
      if (result.ok) {
        setSkills(result.data);
      }
    } catch {
      // IPC may fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadSkills(search, filterCategory, filterSource);
  }, [search, filterCategory, filterSource, loadSkills]);

  const handleDelete = async (id: string) => {
    try {
      const result = await window.capibara.deleteSkill(id);
      if (result.ok) {
        await loadSkills(search, filterCategory, filterSource);
      }
    } catch { /* IPC may fail */ }
  };

  const handleSaved = async () => {
    setShowForm(false);
    setEditingSkill(null);
    await loadSkills(search, filterCategory, filterSource);
  };

  return (
    <div className="p-[var(--page-padding)]">
      <div className="flex items-center justify-between mb-[var(--section-gap)]">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Skills & Knowledge</h1>
          <p className="text-text-secondary text-sm mt-1">
            Browse, search, and manage skills. Upload custom prompt templates.
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-hover transition-colors"
          onClick={() => { setEditingSkill(null); setShowForm(true); }}
        >
          <Plus size={16} />
          Custom Skill
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-[var(--section-gap)]">
        <div className="flex-1 relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            className="w-full rounded-lg border border-border-default bg-surface-card pl-9 pr-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent placeholder-text-muted"
            placeholder="Search by name, command, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Funnel size={16} className="text-text-muted" />
          <select
            className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as SkillCategory | '')}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as SkillSource | '')}
          >
            <option value="">All Sources</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Skills Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-sm text-text-muted">Loading skills...</p>
        </div>
      ) : skills.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-dashed border-border-strong bg-surface-card p-12 text-center">
          <p className="text-sm text-text-muted">
            {search || filterCategory || filterSource
              ? 'No skills match your filters.'
              : 'No skills found. They will be seeded on next app restart.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[var(--element-gap)]">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="rounded-[var(--card-radius)] border border-border-default bg-surface-card p-[var(--card-padding)] hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-text-primary truncate">
                    {skill.name}
                  </h3>
                  <code className="text-xs text-accent-text font-mono">{skill.command}</code>
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <span
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      SOURCE_COLORS[skill.source] ?? SOURCE_COLORS.custom,
                    )}
                  >
                    {skill.source}
                  </span>
                  <span
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.general,
                    )}
                  >
                    {skill.category}
                  </span>
                </div>
              </div>
              <p className="text-xs text-text-tertiary line-clamp-2 mb-3">
                {skill.description}
              </p>
              {skill.source === 'custom' && (
                <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
                  <button
                    className="flex items-center gap-1 text-xs text-text-tertiary hover:text-accent"
                    onClick={() => { setEditingSkill(skill); setShowForm(true); }}
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                  <button
                    className="flex items-center gap-1 text-xs text-text-tertiary hover:text-danger"
                    onClick={() => handleDelete(skill.id)}
                  >
                    <Trash size={12} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Skill Form Modal */}
      {showForm && (
        <SkillFormModal
          skill={editingSkill}
          onClose={() => { setShowForm(false); setEditingSkill(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
