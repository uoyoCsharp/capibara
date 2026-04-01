import { Card, CardContent } from '../ui/card';

export function SkillsPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Skills & Knowledge</h1>
      <p className="text-muted-foreground mb-8">
        Browse, search, and manage skills. Upload custom prompt templates.
      </p>

      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Skill library will be implemented in Epic 3.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
