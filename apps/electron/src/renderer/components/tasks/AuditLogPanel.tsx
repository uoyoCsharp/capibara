import { useState, useEffect } from 'react';
import { CircleNotch, ShieldCheck, ShieldWarning, FileText, Wrench } from '@phosphor-icons/react';
import { Badge } from '../ui/badge';
import { useT } from '../../hooks/use-locale';
import type { ToolCallLogRecord, FileAccessLogRecord } from '@core/shared/types';

const api = () => window.capibara;

interface AuditLogPanelProps {
  runId?: string | null;
  orgId?: string | null;
}

type Tab = 'toolCalls' | 'fileAccess';

export function AuditLogPanel({ runId, orgId }: AuditLogPanelProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<Tab>('toolCalls');
  const [toolCalls, setToolCalls] = useState<ToolCallLogRecord[]>([]);
  const [fileAccess, setFileAccess] = useState<FileAccessLogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!runId && !orgId) return;
    setIsLoading(true);

    const loadData = async () => {
      try {
        if (runId) {
          const [tcResult, faResult] = await Promise.all([
            api().getToolCallsByRunId(runId),
            api().getFileAccessByRunId(runId),
          ]);
          if (tcResult.ok) setToolCalls(tcResult.data);
          if (faResult.ok) setFileAccess(faResult.data);
        } else if (orgId) {
          const [tcResult, faResult] = await Promise.all([
            api().getToolCallsByOrgId(orgId, 50),
            api().getFileAccessByOrgId(orgId, 50),
          ]);
          if (tcResult.ok) setToolCalls(tcResult.data);
          if (faResult.ok) setFileAccess(faResult.data);
        }
      } catch { /* ignore */ }
      setIsLoading(false);
    };

    void loadData();
  }, [runId, orgId]);

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <ShieldCheck size={12} />
        {t.auditLog.title}
      </p>

      {/* Tab buttons */}
      <div className="flex gap-1">
        <TabButton
          active={activeTab === 'toolCalls'}
          onClick={() => setActiveTab('toolCalls')}
          icon={<Wrench size={12} />}
          label={t.auditLog.tabs.toolCalls}
          count={toolCalls.length}
        />
        <TabButton
          active={activeTab === 'fileAccess'}
          onClick={() => setActiveTab('fileAccess')}
          icon={<FileText size={12} />}
          label={t.auditLog.tabs.fileAccess}
          count={fileAccess.length}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-3 text-xs">
          <CircleNotch size={12} className="animate-spin" />
        </div>
      ) : activeTab === 'toolCalls' ? (
        <ToolCallTable entries={toolCalls} t={t} />
      ) : (
        <FileAccessTable entries={fileAccess} t={t} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        active
          ? 'bg-primary/10 text-primary border border-primary/30'
          : 'bg-muted text-muted-foreground hover:bg-accent'
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <Badge variant="secondary" className="text-[10px] ml-1">{count}</Badge>
      )}
    </button>
  );
}

function ToolCallTable({ entries, t }: { entries: ToolCallLogRecord[]; t: ReturnType<typeof useT> }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">{t.auditLog.noEntries}</p>;
  }

  return (
    <div className="rounded-lg border border-border overflow-auto max-h-[250px]">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.time}</th>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.tool}</th>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.permission}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map(entry => (
            <tr key={entry.id} className="hover:bg-muted/30">
              <td className="px-2 py-1 text-muted-foreground tabular-nums whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleTimeString()}
              </td>
              <td className="px-2 py-1 font-medium truncate max-w-[200px]" title={entry.title}>
                {entry.title}
              </td>
              <td className="px-2 py-1">
                <PermissionBadge permission={entry.permission} t={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileAccessTable({ entries, t }: { entries: FileAccessLogRecord[]; t: ReturnType<typeof useT> }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">{t.auditLog.noEntries}</p>;
  }

  return (
    <div className="rounded-lg border border-border overflow-auto max-h-[250px]">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.time}</th>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.path}</th>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.operation}</th>
            <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">{t.auditLog.columns.allowed}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map(entry => (
            <tr key={entry.id} className="hover:bg-muted/30">
              <td className="px-2 py-1 text-muted-foreground tabular-nums whitespace-nowrap">
                {new Date(entry.createdAt).toLocaleTimeString()}
              </td>
              <td className="px-2 py-1 font-mono truncate max-w-[250px]" title={entry.path}>
                {entry.path}
              </td>
              <td className="px-2 py-1">
                <Badge variant="outline" className="text-[10px]">{entry.operation}</Badge>
              </td>
              <td className="px-2 py-1">
                {entry.allowed ? (
                  <ShieldCheck size={14} className="text-green-500" weight="fill" />
                ) : (
                  <ShieldWarning size={14} className="text-red-500" weight="fill" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PermissionBadge({ permission, t }: { permission: string; t: ReturnType<typeof useT> }) {
  switch (permission) {
    case 'allowed':
      return <Badge variant="secondary" className="text-[10px] text-green-600">{t.toolCalls.permission.allowed}</Badge>;
    case 'rejected':
      return <Badge variant="secondary" className="text-[10px] text-red-600">{t.toolCalls.permission.rejected}</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{t.toolCalls.permission.notRequested}</Badge>;
  }
}
