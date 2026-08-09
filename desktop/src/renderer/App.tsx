import { useState } from 'react';
import { useAgentStatus } from './agent';
import { Connect } from './screens/Connect';
import { Activity } from './screens/Activity';
import { Sources } from './screens/Sources';
import { Settings } from './screens/Settings';

const TABS = [
  { key: 'activity', label: 'Activity' },
  { key: 'sources', label: 'Sources' },
  { key: 'settings', label: 'Settings' },
] as const;

type Tab = (typeof TABS)[number]['key'];

export function App() {
  const { status, activity } = useAgentStatus();
  const [tab, setTab] = useState<Tab>('activity');

  if (!status) return null;

  // An unpaired agent has exactly one thing to offer, so it shows exactly one screen. No tabs to
  // wander into, no settings for a connection that does not exist yet.
  if (!status.paired) {
    return (
      <main className="min-h-[100dvh] bg-background px-6 text-foreground">
        <Connect status={status} />
      </main>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <nav className="flex gap-1 border-b border-border px-6 pt-4">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === item.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 px-6 py-6">
        {tab === 'activity' && <Activity status={status} activity={activity} />}
        {tab === 'sources' && <Sources status={status} />}
        {tab === 'settings' && <Settings status={status} />}
      </main>
    </div>
  );
}
