import type { AgentBridge } from '../preload';
import { useCallback, useEffect, useState } from 'react';

declare global {
  interface Window {
    agent: AgentBridge;
  }
}

export const agent = window.agent;

export type AgentStatus = Awaited<ReturnType<AgentBridge['getStatus']>>;
export type ActivityEntry = Awaited<ReturnType<AgentBridge['getActivity']>>[number];

/**
 * The renderer holds no state of its own beyond what it just read.
 *
 * The main process is the single source of truth for whether the agent is paired, what is queued,
 * and which sources are on — so the UI re-reads on every change event rather than keeping a
 * parallel copy that could disagree with the process actually doing the work.
 */
export function useAgentStatus() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const refresh = useCallback(async () => {
    const [nextStatus, nextActivity] = await Promise.all([agent.getStatus(), agent.getActivity()]);
    setStatus(nextStatus);
    setActivity(nextActivity);
  }, []);

  useEffect(() => {
    void refresh();
    return agent.onChanged(() => void refresh());
  }, [refresh]);

  return { status, activity, refresh };
}
