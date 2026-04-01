import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Dashboard</h1>
      <p className="text-muted-foreground mb-8">
        Your project overview and narrative status will appear here.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard label="Active Organizations" value="--" />
        <StatCard label="Tasks In Progress" value="--" />
        <StatCard label="Budget Used" value="--" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Project Narrative</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            No active project yet. Create an organization and start an epic to see the narrative engine in action.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
