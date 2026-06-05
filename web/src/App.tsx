import { ServerCog } from 'lucide-react';
import { useEffect } from 'react';
import { HostGrid } from './components/HostGrid';
import { subscribeEvents } from './lib/api';
import { useStore } from './store';

const REFRESH_INTERVAL = 15000;

export default function App() {
  const load = useStore((s) => s.load);
  const applyEvent = useStore((s) => s.applyEvent);
  const error = useStore((s) => s.error);

  useEffect(() => {
    void load();
    const off = subscribeEvents(applyEvent);
    const iv = setInterval(() => void load(), REFRESH_INTERVAL);
    return () => {
      off();
      clearInterval(iv);
    };
  }, [load, applyEvent]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-6 py-4">
        <ServerCog className="h-5 w-5 text-zinc-400" />
        <h1 className="text-lg font-semibold">NanoKVM Manager</h1>
      </header>
      <main className="p-6">
        {error && (
          <div className="mb-4 rounded border border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <HostGrid />
      </main>
    </div>
  );
}
