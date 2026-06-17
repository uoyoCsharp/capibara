import { useState, useCallback } from 'react';
import { X, ArrowClockwise, WifiHigh, WifiSlash, Spinner } from '@phosphor-icons/react';
import { useT } from '../../hooks/use-locale';
import { useAppStore } from '../../store/app.store';
import type { DiagnosticSnapshot, AgentDiagnostic, SessionDiagnostic } from '@core/shared/types';

const api = () => window.capibara;

export function DevPanel() {
  const t = useT();
  const devPanelOpen = useAppStore((s) => s.devPanelOpen);
  const toggleDevPanel = useAppStore((s) => s.toggleDevPanel);

  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [scanning, setScanning] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setActionStatus(null);
    const result = await api().devDiagnose();
    if (result.ok) setSnapshot(result.data);
    setScanning(false);
  }, []);

  if (!devPanelOpen) return null;

  const handleRestartAgent = async (agentId: string) => {
    const count = agentSessionCount(snapshot, agentId);
    if (!window.confirm(t.devPanel.agents.restartConfirm.replace('{n}', String(count)))) return;
    const result = await api().devRestartAgent(agentId);
    if (result.ok) {
      setActionStatus(t.devPanel.agents.restartSuccess.replace('{n}', String(result.data.expiredSessionCount)));
      void scan();
    } else {
      setActionStatus(t.devPanel.agents.restartError);
    }
  };

  const handleRestartMcp = async () => {
    const sessionCount = isError(snapshot?.sessions) ? 0 : (snapshot?.sessions.length ?? 0);
    if (!window.confirm(t.devPanel.mcp.reconnectConfirm.replace('{n}', String(sessionCount)))) return;
    const result = await api().devRestartMcp();
    if (result.ok) {
      setActionStatus(t.devPanel.mcp.reconnectSuccess.replace('{port}', String(result.data.newPort)));
      void scan();
    } else {
      setActionStatus(t.devPanel.mcp.reconnectError);
    }
  };

  const handleCloseSession = async (sessionId: string) => {
    if (!window.confirm(t.devPanel.sessions.closeConfirm)) return;
    const result = await api().devCloseSession(sessionId);
    if (result.ok) {
      setActionStatus(t.devPanel.sessions.closeSuccess);
      void scan();
    } else {
      setActionStatus(t.devPanel.sessions.closeError);
    }
  };

  return (
    <div className="fixed top-0 right-0 h-full w-[480px] z-50 bg-background border-l border-border shadow-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-sm">{t.devPanel.title}</h2>
        <button onClick={toggleDevPanel} className="p-1 rounded hover:bg-accent">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <button
          onClick={scan}
          disabled={scanning}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {scanning ? <Spinner size={16} className="animate-spin" /> : <WifiHigh size={16} />}
          {scanning ? t.devPanel.scanning : t.devPanel.checkConnections}
        </button>

        {actionStatus && (
          <p className="text-xs px-3 py-2 rounded-lg bg-muted/50">{actionStatus}</p>
        )}

        {!snapshot && !scanning && (
          <p className="text-sm text-muted-foreground text-center py-4">{t.devPanel.noData}</p>
        )}

        {snapshot && (
          <>
            <AgentSection snapshot={snapshot} onRestart={handleRestartAgent} />
            <McpSection snapshot={snapshot} onReconnect={handleRestartMcp} />
            <SessionSection snapshot={snapshot} onClose={handleCloseSession} />
          </>
        )}
      </div>
    </div>
  );
}

function isError<T>(val: T | { error: string } | undefined): val is { error: string } {
  return val !== undefined && val !== null && typeof val === 'object' && 'error' in val && !Array.isArray(val);
}

function agentSessionCount(snapshot: DiagnosticSnapshot | null, agentId: string): number {
  if (!snapshot || isError(snapshot.sessions)) return 0;
  return snapshot.sessions.filter(s => s.agentId === agentId).length;
}

function AgentSection({ snapshot, onRestart }: { snapshot: DiagnosticSnapshot; onRestart: (agentId: string) => void }) {
  const t = useT();
  if (isError(snapshot.agents)) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t.devPanel.agents.title}</h3>
        <p className="text-xs text-red-500">{t.devPanel.errorPrefix}{snapshot.agents.error}</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t.devPanel.agents.title}</h3>
      {snapshot.agents.map((agent) => (
        <div key={agent.agentId} className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">{agent.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${agent.processAlive ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
              {agent.processAlive ? t.devPanel.agents.processAlive : t.devPanel.agents.processDead}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>{t.devPanel.agents.pid}: {agent.pid ?? '-'}</span>
            <span>{agent.connectionEstablished ? t.devPanel.agents.connected : t.devPanel.agents.disconnected}</span>
            <span>{t.devPanel.agents.transport}: {agent.mcpTransportType}</span>
            <span>{t.devPanel.agents.sessions}: {agent.activeSessionCount}</span>
          </div>
          <button
            onClick={() => onRestart(agent.agentId)}
            className="flex items-center gap-1 mt-1 px-2 py-1 text-[11px] rounded border border-border hover:bg-accent transition-colors"
          >
            <ArrowClockwise size={12} />
            {t.devPanel.agents.restart}
          </button>
        </div>
      ))}
    </section>
  );
}

function McpSection({ snapshot, onReconnect }: { snapshot: DiagnosticSnapshot; onReconnect: () => void }) {
  const t = useT();
  if (isError(snapshot.mcpTransport)) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t.devPanel.mcp.title}</h3>
        <p className="text-xs text-red-500">{t.devPanel.errorPrefix}{snapshot.mcpTransport.error}</p>
      </section>
    );
  }

  const mcp = snapshot.mcpTransport;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t.devPanel.mcp.title}</h3>
      <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{mcp.listening ? t.devPanel.mcp.listening : t.devPanel.mcp.notListening}</span>
          {mcp.listening ? <WifiHigh size={14} className="text-green-600" /> : <WifiSlash size={14} className="text-red-600" />}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          <span>{t.devPanel.mcp.port}: {mcp.port}</span>
          <span>{mcp.sseClientConnected ? t.devPanel.mcp.sseConnected : t.devPanel.mcp.sseDisconnected}</span>
          <span>{mcp.httpTransportReady ? t.devPanel.mcp.httpReady : t.devPanel.mcp.httpNotReady}</span>
          <span>{t.devPanel.mcp.activeSessions}: {mcp.activeSessionCount}</span>
        </div>
        {mcp.lastError && (
          <p className="text-[11px] text-red-500 break-all" title={mcp.lastError}>
            {t.devPanel.mcp.lastErrorPrefix}{mcp.lastError}
          </p>
        )}
        <button
          onClick={onReconnect}
          className="flex items-center gap-1 mt-1 px-2 py-1 text-[11px] rounded border border-border hover:bg-accent transition-colors"
        >
          <ArrowClockwise size={12} />
          {t.devPanel.mcp.reconnect}
        </button>
      </div>
    </section>
  );
}

function SessionSection({ snapshot, onClose }: { snapshot: DiagnosticSnapshot; onClose: (sessionId: string) => void }) {
  const t = useT();
  if (isError(snapshot.sessions)) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t.devPanel.sessions.title}</h3>
        <p className="text-xs text-red-500">{t.devPanel.errorPrefix}{snapshot.sessions.error}</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t.devPanel.sessions.title}</h3>
      {snapshot.sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.devPanel.sessions.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="pb-1 pr-2 font-medium">{t.devPanel.sessions.agent}</th>
                <th className="pb-1 pr-2 font-medium">{t.devPanel.sessions.status}</th>
                <th className="pb-1 pr-2 font-medium">{t.devPanel.sessions.suspendReason}</th>
                <th className="pb-1 pr-2 font-medium">{t.devPanel.sessions.liveConnection}</th>
                <th className="pb-1 pr-2 font-medium">{t.devPanel.sessions.lastActivity}</th>
                <th className="pb-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sessions.map((session) => (
                <tr key={session.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2">{session.agentId}</td>
                  <td className="py-1.5 pr-2">{session.status}</td>
                  <td className="py-1.5 pr-2">{session.suspendReason ?? '-'}</td>
                  <td className="py-1.5 pr-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${session.hasLiveConnection ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(session.lastActivityAt).toLocaleTimeString()}</td>
                  <td className="py-1.5">
                    <button
                      onClick={() => onClose(session.id)}
                      className="px-1.5 py-0.5 rounded border border-border hover:bg-accent text-[10px]"
                    >
                      {t.devPanel.sessions.close}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
