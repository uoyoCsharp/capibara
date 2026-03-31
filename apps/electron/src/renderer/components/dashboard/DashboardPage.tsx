export function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Dashboard</h1>
      <p className="text-gray-500 mb-8">
        Your project overview and narrative status will appear here.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard label="Active Organizations" value="—" />
        <StatCard label="Tasks In Progress" value="—" />
        <StatCard label="Budget Used" value="—" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-medium text-gray-800 mb-3">Project Narrative</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          No active project yet. Create an organization and start an epic to see the narrative engine in action.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}
