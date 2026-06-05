import { ExternalLink } from 'lucide-react';
import { useStore } from '../store';
import { HostCard } from './HostCard';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardHeader } from './ui/card';

export function HostGrid() {
  const hosts = useStore((s) => s.hosts);
  const discovered = useStore((s) => s.discovered);
  const loading = useStore((s) => s.loading);

  if (loading) return <p className="text-zinc-500">Loading…</p>;

  if (hosts.length === 0 && discovered.length === 0) {
    return (
      <p className="text-zinc-500">
        No hosts configured. Add them to <code className="text-zinc-300">config/hosts.json</code>.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {hosts.map((host) => (
        <HostCard key={host.id} host={host} />
      ))}
      {discovered.map((unit) => (
        <Card key={unit.id}>
          <CardHeader className="items-center justify-between">
            <div>
              <div className="font-semibold text-zinc-100">{unit.name}</div>
              <div className="text-xs text-zinc-500">{unit.id}</div>
            </div>
            <Badge className="bg-sky-500/15 text-sky-300">discovered</Badge>
          </CardHeader>
          <div className="p-3 pt-0">
            <p className="mb-2 text-xs text-zinc-500">Found via mDNS, not in config.</p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => window.open(unit.kvmUrl, '_blank', 'noopener')}
            >
              <ExternalLink className="h-4 w-4" /> Open
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
