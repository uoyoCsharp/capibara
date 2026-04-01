import { Card, CardContent } from '../ui/card';

export function TasksPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Tasks & Epics</h1>
      <p className="text-muted-foreground mb-8">
        View and manage your task tree. Create epics, stories, and track execution progress.
      </p>

      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Task tree visualization will be implemented in Epic 4.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
