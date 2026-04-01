import { Card, CardContent } from '../ui/card';

export function OrganizationPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-foreground mb-2">Organization</h1>
      <p className="text-muted-foreground mb-8">
        Manage your AI organization tree. Create roles, configure personas, and assign skills.
      </p>

      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Organization tree visualization will be implemented in Epic 2.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
