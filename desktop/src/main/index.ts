import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import path from 'node:path';
import { AgentConfig, API_BASE_URL, DASHBOARD_URL } from './config';
import { CaptureQueue } from './queue';
import { Uploader } from './uploader';
import { SessionWatcher, type CaptureEvent } from './watcher';
import { defaultDeviceName, sendHeartbeat, startPairing, type PairingHandle } from './pairing';
import { redact } from './redact';
import { SOURCES } from './sources';
import { initAutoUpdate } from './updater';

/**
 * Main process: lifecycle, the tray, the secure window, and the IPC surface.
 *
 * Electron's defaults are not the safe ones, so every window is created with contextIsolation on,
 * nodeIntegration off, and the sandbox enabled, and navigation/window-opening are denied outright.
 * See docs/Phase13_DesktopAgent_Implementation_Plan.md §7.2.
 */

const SMOKE_TEST = process.argv.includes('--smoke-test');
const FLUSH_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const ACTIVITY_LIMIT = 200;

let config: AgentConfig;
let queue: CaptureQueue;
let uploader: Uploader;
let watcher: SessionWatcher;
let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let pairing: PairingHandle | null = null;
const activity: Array<CaptureEvent & { state: 'queued' | 'sent' | 'failed' }> = [];

function notifyRenderer() {
  window?.webContents.send('agent:changed');
  refreshTray();
}

function createWindow() {
  window = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    show: !SMOKE_TEST,
    // Native title bar on purpose: a custom one buys nothing here and breaks OS conventions the
    // user already knows (§7.5).
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  window.on('closed', () => {
    window = null;
  });
}

function showWindow() {
  if (window) {
    window.show();
    window.focus();
  } else {
    createWindow();
  }
}

function trayIcon() {
  // A 1×1 transparent template image keeps the tray working without shipping a binary asset in
  // this repo; electron-builder replaces it with resources/trayTemplate.png in a packaged build.
  const image = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  );
  image.setTemplateImage(true);
  return image;
}

function refreshTray() {
  if (!tray) return;
  const settings = config.get();
  const depth = queue.pending().length;
  tray.setToolTip(settings.captureEnabled ? `MemoryOS — ${depth} queued` : 'MemoryOS — capture paused');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Queue: ${depth}`, enabled: false },
      { type: 'separator' },
      {
        // Pause is one click from anywhere, always (§7.4).
        label: settings.captureEnabled ? 'Pause capture' : 'Resume capture',
        click: () => setCaptureEnabled(!settings.captureEnabled),
      },
      { label: 'Open activity…', click: showWindow },
      { label: 'Open dashboard…', click: () => void shell.openExternal(`${DASHBOARD_URL}/dashboard`) },
      { type: 'separator' },
      { label: 'Quit MemoryOS Agent', click: () => app.quit() },
    ]),
  );
}

function setCaptureEnabled(enabled: boolean) {
  config.update({ captureEnabled: enabled });
  if (enabled) watcher.start();
  else watcher.stop();
  notifyRenderer();
}

function sourceStatus() {
  const settings = config.get();
  return SOURCES.map((source) => ({
    platform: source.platform,
    label: source.label,
    available: source.available,
    unavailableReason: source.unavailableReason,
    enabled: settings.sources[source.platform]?.enabled ?? false,
    paths: settings.sources[source.platform]?.paths ?? [],
    defaultPaths: source.defaultPaths(),
  }));
}

function registerIpc() {
  ipcMain.handle('agent:status', () => {
    const settings = config.get();
    return {
      paired: config.readKey() !== null,
      deviceName: settings.deviceName || defaultDeviceName(),
      captureEnabled: settings.captureEnabled,
      queueDepth: queue.pending().length,
      droppedCount: queue.droppedCount(),
      paused: uploader.isPaused(),
      appVersion: app.getVersion(),
      sources: sourceStatus(),
    };
  });

  ipcMain.handle('agent:activity', () => activity.slice(-ACTIVITY_LIMIT).reverse());

  ipcMain.handle('agent:pair:start', async (_event, deviceName: string) => {
    const name = deviceName.trim() || defaultDeviceName();
    config.update({ deviceName: name });
    pairing = await startPairing(app.getVersion(), name);

    void pairing.completed.then((key) => {
      if (!key) return;
      if (!config.writeKey(key)) {
        // Without OS-level encryption we refuse to persist the credential at all. Pairing again
        // is a smaller cost than a plaintext key on disk.
        void dialog.showMessageBox({
          type: 'error',
          message: 'Could not store the connection securely',
          detail:
            'This system does not offer an encrypted credential store, so the connection key was not saved. The agent will stay disconnected.',
        });
        return;
      }
      uploader.resume();
      notifyRenderer();
      void sendHeartbeat(key, app.getVersion());
    });

    return { code: pairing.code, expiresAt: pairing.expiresAt };
  });

  ipcMain.handle('agent:pair:cancel', () => {
    pairing?.cancel();
    pairing = null;
  });

  ipcMain.handle('agent:disconnect', () => {
    config.clearKey();
    setCaptureEnabled(false);
    notifyRenderer();
  });

  ipcMain.handle('agent:capture:set', (_event, enabled: boolean) => setCaptureEnabled(enabled));

  ipcMain.handle('agent:source:set', (_event, platform: string, settings: { enabled: boolean; paths: string[] }) => {
    config.setSource(platform, settings);
    watcher.start();
    notifyRenderer();
  });

  ipcMain.handle('agent:device-name:set', (_event, name: string) => {
    config.update({ deviceName: name });
    notifyRenderer();
  });

  ipcMain.handle('agent:choose-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // Only ever the configured dashboard origin — never an arbitrary URL from the renderer.
  ipcMain.handle('agent:open-dashboard', async (_event, subPath?: string) => {
    const safePath = typeof subPath === 'string' && subPath.startsWith('/') ? subPath : '/dashboard';
    await shell.openExternal(`${DASHBOARD_URL}${safePath}`);
  });

  ipcMain.handle('agent:redact-preview', (_event, text: string) => redact(String(text ?? '')));
}

function hardenNavigation() {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      const allowed = process.env.ELECTRON_RENDERER_URL;
      if (!allowed || !url.startsWith(allowed)) event.preventDefault();
    });
  });
}

function bootstrap() {
  config = new AgentConfig();
  queue = new CaptureQueue({ filePath: path.join(app.getPath('userData'), 'queue.jsonl') });
  uploader = new Uploader({
    queue,
    apiBaseUrl: API_BASE_URL,
    getKey: () => config.readKey(),
    onUnauthorized: () => {
      // Revoked from the dashboard. Stop watching, stop retrying, and say so in the UI.
      config.clearKey();
      setCaptureEnabled(false);
    },
  });
  watcher = new SessionWatcher({
    config,
    queue,
    onCaptured: (event) => {
      activity.push({ ...event, state: 'queued' });
      if (activity.length > ACTIVITY_LIMIT * 2) activity.splice(0, activity.length - ACTIVITY_LIMIT);
      notifyRenderer();
    },
  });

  registerIpc();
  hardenNavigation();
  tray = new Tray(trayIcon());
  refreshTray();
  createWindow();

  if (config.get().captureEnabled) watcher.start();
  void initAutoUpdate();

  setInterval(() => {
    void uploader.flush().then(notifyRenderer);
  }, FLUSH_INTERVAL_MS);

  setInterval(() => {
    const key = config.readKey();
    if (key) void sendHeartbeat(key, app.getVersion());
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Boots the app headlessly and asserts the trust boundary is intact: the renderer sees exactly the
 * bridge we published and nothing else — no `require`, no `process`, no Node. This is the cheap
 * test that catches a contextIsolation or sandbox regression, which is otherwise invisible until
 * someone reads the diff carefully.
 */
async function runSmokeTest() {
  const failures: string[] = [];
  try {
    const target = BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error('no window was created');
    await new Promise<void>((resolve) => target.webContents.once('did-finish-load', () => resolve()));

    const exposed = (await target.webContents.executeJavaScript(
      'Object.keys(window.agent ?? {}).sort().join(",")',
    )) as string;
    for (const method of ['getStatus', 'getActivity', 'startPairing', 'setCaptureEnabled', 'setSource', 'onChanged']) {
      if (!exposed.split(',').includes(method)) failures.push(`bridge is missing ${method}`);
    }

    const leaked = (await target.webContents.executeJavaScript(
      "[typeof window.require, typeof window.process, typeof window.module].join(',')",
    )) as string;
    if (leaked !== 'undefined,undefined,undefined') failures.push(`node leaked into the renderer: ${leaked}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (failures.length === 0) console.log('smoke: ok');
  else console.error(`smoke: failed — ${failures.join('; ')}`);
  app.exit(failures.length === 0 ? 0 : 1);
}

// Two agents watching the same files would double-post every capture.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  void app.whenReady().then(() => {
    bootstrap();
    // The smoke test exists to catch a contextIsolation/preload regression in CI, where there is
    // no display and no user. Boot, assert the window exists, exit.
    if (SMOKE_TEST) void runSmokeTest();
  });

  // The agent is a background utility: closing the window leaves it running in the tray, which is
  // what a capture agent has to do to be useful at all.
  app.on('window-all-closed', () => {
    if (SMOKE_TEST) app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    watcher?.stop();
  });
}
