import { agent, type ActivityEntry, type AgentStatus } from '../agent';
import { Badge, Button, Card, CardDescription, CardTitle } from '../components/ui';

/**
 * "The user can see what the agent has captured before it's finalized as a memory" — US-INT-07's
 * second acceptance criterion, and the reason this screen is the app's home rather than a settings
 * afterthought. Nothing here is a memory yet; each row is a suggestion waiting for review.
 */
export function Activity({ status, activity }: { status: AgentStatus; activity: ActivityEntry[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Activity</h1>
          <p className="text-sm text-muted-foreground">
            What this computer has sent for your review. Approve or dismiss each one in the
            dashboard.
          </p>
        </div>
        <Button variant="outline" onClick={() => void agent.openDashboard('/dashboard/memories/suggestions')}>
          Review in dashboard
        </Button>
      </div>

      {status.paused && (
        <Card className="border-tape/50 bg-tape/10">
          <CardTitle>Capture is paused</CardTitle>
          <CardDescription>
            This device was disconnected from your account. Connect it again to resume — nothing is
            being sent in the meantime.
          </CardDescription>
        </Card>
      )}

      {status.droppedCount > 0 && (
        <Card className="border-tape/50 bg-tape/10">
          <CardTitle>{status.droppedCount} captures were dropped</CardTitle>
          <CardDescription>
            The offline queue filled up while this computer could not reach MemoryOS. The oldest
            items were discarded to make room for new ones.
          </CardDescription>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Recent captures</CardTitle>
          <Badge tone={status.queueDepth > 0 ? 'warning' : 'muted'}>{status.queueDepth} queued</Badge>
        </div>
        {activity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing captured yet. Turn on a source and keep working — anything worth remembering
            shows up here first.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {activity.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex flex-col gap-1 py-3">
                <p className="line-clamp-3 text-sm">{entry.snippet}</p>
                <p className="mono-tag text-xs text-muted-foreground">
                  {entry.platform} · {new Date(entry.at).toLocaleString()} · {entry.state}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
