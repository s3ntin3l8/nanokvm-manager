import { ExternalLink, Hand, Power, RotateCcw, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchLogs, sendPower, snapshotUrl } from '../lib/api';
import { useStore } from '../store';
import type { HostStatus, PowerAction } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardFooter, CardHeader } from './ui/card';

const SNAPSHOT_INTERVAL = 5000;

function StatusBadge({ online, power }: { online: boolean | null; power: boolean | null }) {
  if (online !== true) return <Badge className="bg-zinc-700/40 text-zinc-400">offline</Badge>;
  return power ? (
    <Badge className="bg-emerald-500/15 text-emerald-300">on</Badge>
  ) : (
    <Badge className="bg-zinc-600/30 text-zinc-300">standby</Badge>
  );
}

export function HostCard({ host }: { host: HostStatus }) {
  const watts = useStore((s) => s.watts[host.id]);
  const logs = useStore((s) => s.logs[host.id]);
  const prependLogs = useStore((s) => s.prependLogs);
  const [bust, setBust] = useState(() => Date.now());
  const [showLogs, setShowLogs] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const online = host.online === true;

  useEffect(() => {
    if (!online) return;
    const iv = setInterval(() => setBust(Date.now()), SNAPSHOT_INTERVAL);
    return () => clearInterval(iv);
  }, [online]);

  useEffect(() => {
    if (showLogs && host.hasLoki && !logs) {
      void fetchLogs(host.id)
        .then((lines) => prependLogs(host.id, lines))
        .catch(() => {});
    }
  }, [showLogs, host.hasLoki, host.id, logs, prependLogs]);

  async function doPower(action: PowerAction): Promise<void> {
    setActionError(undefined);
    try {
      await sendPower(host.id, action);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'action failed');
    }
  }

  function openNative(): void {
    window.open(host.kvmUrl, '_blank', 'noopener');
  }

  return (
    <Card>
      <CardHeader className="items-center justify-between">
        <div className="min-w-0">
          <div className="truncate font-semibold text-zinc-100">{host.name}</div>
          <div className="text-xs text-zinc-500">{host.id}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge online={host.online} power={host.power} />
          {watts?.watts != null && (
            <Badge className="bg-amber-500/15 text-amber-300">
              {Math.round(watts.watts)} {watts.unit}
            </Badge>
          )}
        </div>
      </CardHeader>

      <button
        type="button"
        onClick={openNative}
        className="group relative block aspect-video w-full bg-black"
        title="Open native NanoKVM UI"
      >
        {online ? (
          <img
            src={snapshotUrl(host.id, bust)}
            alt={`${host.name} screen`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            offline
          </div>
        )}
        <span className="absolute right-2 top-2 hidden items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-zinc-200 group-hover:flex">
          <ExternalLink className="h-3 w-3" /> open
        </span>
      </button>

      <CardFooter className="flex flex-col gap-2">
        {actionError && <div className="w-full text-xs text-red-400">{actionError}</div>}
        <div className="flex w-full gap-2">
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary" disabled={!online} className="flex-1">
                <Power className="h-4 w-4" /> Power
              </Button>
            }
            title={`Power ${host.name}?`}
            description="Short-press the ATX power button."
            confirmLabel="Power"
            onConfirm={() => doPower('power')}
          />
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary" disabled={!online} className="flex-1">
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            }
            title={`Reset ${host.name}?`}
            description="Press the ATX reset button — the machine reboots immediately."
            destructive
            confirmLabel="Reset"
            onConfirm={() => doPower('reset')}
          />
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="secondary" disabled={!online} className="flex-1">
                <Hand className="h-4 w-4" /> Hold
              </Button>
            }
            title={`Force power-off ${host.name}?`}
            description="Long-press power (8s) — forces a hard power-off."
            destructive
            confirmLabel="Force off"
            onConfirm={() => doPower('longpress')}
          />
        </div>

        {host.hasLoki && (
          <div className="w-full">
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setShowLogs((v) => !v)}
            >
              <ScrollText className="h-4 w-4" /> Logs
            </Button>
            {showLogs && (
              <div className="mt-1 max-h-48 overflow-auto rounded bg-black/50 p-2 text-[11px] leading-snug text-zinc-300">
                {(logs ?? []).map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {line.line}
                  </div>
                ))}
                {(logs ?? []).length === 0 && <div className="text-zinc-600">no logs</div>}
              </div>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
