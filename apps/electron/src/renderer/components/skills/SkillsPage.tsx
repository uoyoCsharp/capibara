import { useEffect, useState } from 'react';
import { Lightning, Plus, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { useOrganizationStore } from '../../store/organization.store';
import type { SkillRecord } from '@core/shared/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

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

const CATEGORIES = ['analysis', 'design', 'implementation', 'review', 'test', 'general'] as const;
type Category = typeof CATEGORIES[number];

export function SkillsPage() {
  const skills = useOrganizationStore((s) => s.skills);
  const isLoading = useOrganizationStore((s) => s.isLoadingSkills);
  const loadSkills = useOrganizationStore((s) => s.loadSkills);
  const createSkill = useOrganizationStore((s) => s.createSkill);
  const deleteSkill = useOrganizationStore((s) => s.deleteSkill);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<Category | ''>('');
  const [isCreateOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const filtered = filterSkills(skills, search, filterCategory);

  return (
    <div className="p-[var(--page-padding)] space-y-[var(--section-gap)]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Lightning size={28} weight="duotone" />
            Skills & Knowledge
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{skills.length} skills available</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} weight="bold" className="mr-1.5" />
          Add Custom Skill
        </Button>
      </header>

      <FilterBar
        search={search}
        setSearch={setSearch}
        filterCategory={filterCategory}
        setFilterCategory={setFilterCategory}
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={Boolean(search || filterCategory)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((skill) => (
            <SkillCard key={skill.id} skill={skill} onDelete={deleteSkill} />
          ))}
        </div>
      )}

      <CreateSkillDialog
        open={isCreateOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          const created = await createSkill(input);
          if (created) setCreateOpen(false);
        }}
      />
    </div>
  );
}

// Pure function for testability.
export function filterSkills(
  skills: SkillRecord[],
  search: string,
  category: Category | '',
): SkillRecord[] {
  const q = search.toLowerCase().trim();
  return skills.filter((s) => {
    if (category && s.category !== category) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q);
  });
}

function FilterBar({
  search, setSearch, filterCategory, setFilterCategory,
}: {
  search: string;
  setSearch: (v: string) => void;
  filterCategory: Category | '';
  setFilterCategory: (v: Category | '') => void;
}) {
  return (
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
        onChange={(e) => setFilterCategory(e.target.value as Category | '')}
        className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
      >
        <option value="">All Categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
        ))}
      </select>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Lightning size={48} weight="duotone" />
      <p>{hasFilters ? 'No skills match your filters' : 'No skills available'}</p>
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
            aria-label={`Delete ${skill.name}`}
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

interface CreateSkillInput {
  name: string;
  command: string;
  description: string;
  category: Category;
  source: 'custom';
  orgTemplateId: null;
  customPromptContent: string | null;
}

function CreateSkillDialog({
  open, onClose, onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateSkillInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('general');
  const [saving, setSaving] = useState(false);

  const canSubmit = name.trim().length > 0 && command.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        command: command.trim(),
        description: description.trim(),
        category,
        source: 'custom',
        orgTemplateId: null,
        customPromptContent: null,
      });
      setName(''); setCommand(''); setDescription(''); setCategory('general');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Custom Skill</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Quick Review" />
          </div>
          <div>
            <label className="text-sm font-medium">Command</label>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="/quick-review" />
            <p className="text-xs text-muted-foreground mt-1">Slash command used by AI agents to invoke this skill.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this skill do?"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
