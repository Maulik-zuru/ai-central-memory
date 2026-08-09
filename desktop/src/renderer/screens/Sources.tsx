import { agent, type AgentStatus } from '../agent';
import { Button, Card, CardDescription, CardTitle, Toggle } from '../components/ui';

/**
 * Everything is off until the user turns it on, and the watched paths are shown as literal
 * absolute paths — not "your projects folder". A privacy control the user cannot read precisely is
 * not a control.
 */
export function Sources({ status }: { status: AgentStatus }) {
  async function setSource(platform: string, enabled: boolean, paths: string[]) {
    await agent.setSource(platform, { enabled, paths });
  }

  async function addFolder(platform: string, paths: string[]) {
    const chosen = await agent.chooseFolder();
    if (!chosen || paths.includes(chosen)) return;
    await setSource(platform, true, [...paths, chosen]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl">Sources</h1>
        <p className="text-sm text-muted-foreground">
          The agent reads these folders and nothing else. It does not watch your keyboard,
          clipboard, or screen.
        </p>
      </div>

      {status.sources.map((source) => {
        const paths = source.paths.length > 0 ? source.paths : source.defaultPaths;
        return (
          <Card key={source.platform}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{source.label}</CardTitle>
                <CardDescription>
                  {source.available
                    ? 'Reads session transcripts as you work. Both this switch and the platform toggle in your account settings have to be on.'
                    : source.unavailableReason}
                </CardDescription>
              </div>
              <Toggle
                label={`Capture from ${source.label}`}
                checked={source.enabled}
                disabled={!source.available}
                onChange={(next) => void setSource(source.platform, next, paths)}
              />
            </div>

            {source.available && (
              <div className="mt-4 flex flex-col gap-2">
                {paths.length === 0 && (
                  <p className="text-xs text-muted-foreground">No folders chosen yet.</p>
                )}
                {paths.map((watchPath) => (
                  <div key={watchPath} className="flex items-center justify-between gap-3">
                    <code className="mono-tag truncate text-xs text-muted-foreground">{watchPath}</code>
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        void setSource(
                          source.platform,
                          source.enabled,
                          paths.filter((p) => p !== watchPath),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button variant="outline" className="self-start" onClick={() => void addFolder(source.platform, paths)}>
                  Add a folder…
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
