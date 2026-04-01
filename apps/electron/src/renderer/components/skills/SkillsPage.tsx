import { useEffect, useState, useCallback } from 'react';
import { MagnifyingGlass, Plus, Pencil, Trash, Funnel } from '@phosphor-icons/react';
import type { SkillRecord, SkillCategory, SkillSource } from '@shared/contracts';
import { cn } from '../../lib/utils';
import { SkillFormModal } from './SkillFormModal';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { toast } from '../../store/toast.store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';

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
  analysis: 'bg-blue-500/10 text-blue-600',
  design: 'bg-primary/10 text-primary',
  implementation: 'bg-green-500/10 text-green-600',
  review: 'bg-yellow-500/10 text-yellow-600',
  test: 'bg-destructive/10 text-destructive',
  general: 'bg-muted text-muted-foreground',
};

const SOURCE_COLORS: Record<string, string> = {
  builtin: 'bg-green-500/10 text-green-600',
  template: 'bg-blue-500/10 text-blue-600',
  custom: 'bg-yellow-500/10 text-yellow-600',
};

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<SkillCategory | ''>('');
  const [filterSource, setFilterSource] = useState<SkillSource | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
      toast.error('Failed to load skills');
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
    } catch {
      toast.error('Failed to delete skill');
    }
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
          <h1 className="text-3xl font-semibold text-foreground font-[family-name:var(--font-display)]">Skills & Knowledge</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Browse, search, and manage skills. Upload custom prompt templates.
          </p>
        </div>
        <Button
          onClick={() => { setEditingSkill(null); setShowForm(true); }}
        >
          <Plus size={16} />
          Custom Skill
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-[var(--section-gap)]">
        <div className="flex-1 relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            className="pl-9"
            placeholder="Search by name, command, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Funnel size={16} className="text-muted-foreground" />
          <Select
            value={filterCategory || '_all'}
            onValueChange={(value) => setFilterCategory(value === '_all' ? '' : value as SkillCategory)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filterSource || '_all'}
            onValueChange={(value) => setFilterSource(value === '_all' ? '' : value as SkillSource)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Sources</SelectItem>
              {SOURCES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Skills Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Loading skills...</p>
        </div>
      ) : skills.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <p className="text-sm text-muted-foreground">
              {search || filterCategory || filterSource
                ? 'No skills match your current filters. Try adjusting your search or category selection.'
                : 'Skills are prompt templates that give AI agents specialized abilities. They\'ll be loaded on the next app restart.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {skills.map((skill) => (
            <Card
              key={skill.id}
              className="hover:border-l-primary hover:border-l-2 transition-colors"
            >
              <CardContent className="p-[var(--card-padding)]">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {skill.name}
                    </h3>
                    <code className="text-xs text-primary font-mono">{skill.command}</code>
                  </div>
                  <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] font-medium',
                        SOURCE_COLORS[skill.source] ?? SOURCE_COLORS.custom,
                      )}
                    >
                      {skill.source}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] font-medium',
                        CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.general,
                      )}
                    >
                      {skill.category}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-4">
                  {skill.description}
                </p>
                {skill.source === 'custom' && (
                  <div className="flex items-center gap-2 pt-4 border-t border-border">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto py-1 px-2 text-xs text-muted-foreground"
                      onClick={() => { setEditingSkill(skill); setShowForm(true); }}
                    >
                      <Pencil size={12} />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirmDeleteId(skill.id)}
                    >
                      <Trash size={12} />
                      Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
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

      {/* Delete Confirmation */}
      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete Skill?"
          message="This will permanently remove this custom skill. Any roles using it will lose access."
          confirmLabel="Delete"
          onConfirm={() => {
            handleDelete(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
