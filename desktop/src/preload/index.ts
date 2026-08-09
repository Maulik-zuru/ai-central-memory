import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only channel between the main process and the renderer.
 *
 * Note what is absent: the API key. The renderer can ask for pairing to start and can read status,
 * but it never receives the credential — that lives in the main process, encrypted at rest with
 * the OS keystore. The surface below is verbs, not secrets, which is what makes a compromised
 * renderer a nuisance rather than a credential leak.
 */

export interface AgentStatus {
  paired: boolean;
  deviceName: string;
  captureEnabled: boolean;
  queueDepth: number;
  droppedCount: number;
  paused: boolean;
  appVersion: string;
  sources: Array<{
    platform: string;
    label: string;
    available: boolean;
    unavailableReason: string;
    enabled: boolean;
    paths: string[];
    defaultPaths: string[];
  }>;
}

export interface ActivityEntry {
  platform: string;
  snippet: string;
  at: string;
  state: 'queued' | 'sent' | 'failed';
}

const api = {
  getStatus: (): Promise<AgentStatus> => ipcRenderer.invoke('agent:status'),
  getActivity: (): Promise<ActivityEntry[]> => ipcRenderer.invoke('agent:activity'),

  startPairing: (deviceName: string): Promise<{ code: string; expiresAt: string }> =>
    ipcRenderer.invoke('agent:pair:start', deviceName),
  cancelPairing: (): Promise<void> => ipcRenderer.invoke('agent:pair:cancel'),
  disconnect: (): Promise<void> => ipcRenderer.invoke('agent:disconnect'),

  setCaptureEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('agent:capture:set', enabled),
  setSource: (platform: string, settings: { enabled: boolean; paths: string[] }): Promise<void> =>
    ipcRenderer.invoke('agent:source:set', platform, settings),
  setDeviceName: (name: string): Promise<void> => ipcRenderer.invoke('agent:device-name:set', name),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('agent:choose-folder'),
  openDashboard: (path?: string): Promise<void> => ipcRenderer.invoke('agent:open-dashboard', path),
  previewRedaction: (text: string): Promise<string> => ipcRenderer.invoke('agent:redact-preview', text),

  onChanged: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on('agent:changed', listener);
    // Returns void, not the IpcRenderer that removeListener hands back — this is used directly as
    // a React effect cleanup, and an effect that returns a non-void value is a type error.
    return () => {
      ipcRenderer.removeListener('agent:changed', listener);
    };
  },
};

contextBridge.exposeInMainWorld('agent', api);

export type AgentBridge = typeof api;
