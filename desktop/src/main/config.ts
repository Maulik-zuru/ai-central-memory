import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Build-time origins and on-disk agent settings.
 *
 * Two explicit env vars with production defaults, exactly as the extension does
 * (extension/src/lib/config.ts) and for the same reason that was learned the hard way there: a
 * single origin cannot be derived from the other, and inferring "am I in dev" from the bundler is
 * wrong for every build artifact.
 */
export const API_BASE_URL = process.env.VITE_API_BASE_URL ?? 'https://api.aimemory.example';
export const DASHBOARD_URL = process.env.VITE_DASHBOARD_URL ?? 'https://app.aimemory.example';
/** Unset means update checks never run. See the phase plan §9.4. */
export const UPDATE_FEED_URL = process.env.DESKTOP_UPDATE_FEED_URL ?? '';

export interface SourceSettings {
  /** Off until the user turns it on. There is no opt-out default anywhere in this app. */
  enabled: boolean;
  /** Absolute paths, shown literally in the UI. */
  paths: string[];
}

export interface AgentSettings {
  deviceName: string;
  captureEnabled: boolean;
  sources: Record<string, SourceSettings>;
  /** Per-file read offsets, so a restart does not re-read whole transcripts. */
  offsets: Record<string, number>;
}

function defaults(): AgentSettings {
  return {
    deviceName: '',
    captureEnabled: false,
    sources: {},
    offsets: {},
  };
}

export class AgentConfig {
  private readonly file: string;
  private readonly keyFile: string;
  private data: AgentSettings;

  constructor(userDataDir: string = app.getPath('userData')) {
    this.file = path.join(userDataDir, 'settings.json');
    this.keyFile = path.join(userDataDir, 'device-key.bin');
    this.data = defaults();
    this.load();
  }

  private load() {
    try {
      this.data = { ...defaults(), ...(JSON.parse(fs.readFileSync(this.file, 'utf8')) as AgentSettings) };
    } catch {
      // No settings yet, or a corrupt file. Starting from defaults means capture is off, which is
      // the safe direction to fail in.
      this.data = defaults();
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get(): AgentSettings {
    return this.data;
  }

  update(patch: Partial<AgentSettings>) {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  setSource(platform: string, settings: SourceSettings) {
    this.data.sources[platform] = settings;
    this.save();
  }

  setOffset(filePath: string, byte: number) {
    this.data.offsets[filePath] = byte;
    this.save();
  }

  offsetFor(filePath: string): number {
    return this.data.offsets[filePath] ?? 0;
  }

  // --- device key -------------------------------------------------------------------------
  // The key is encrypted at rest with the OS keystore (Keychain on macOS, DPAPI on Windows) and
  // never crosses into the renderer. If encryption is unavailable the key is simply not persisted:
  // asking the user to pair again is better than writing a live credential in plaintext.

  readKey(): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(fs.readFileSync(this.keyFile));
    } catch {
      return null;
    }
  }

  writeKey(key: string): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    fs.writeFileSync(this.keyFile, safeStorage.encryptString(key));
    return true;
  }

  clearKey() {
    fs.rmSync(this.keyFile, { force: true });
  }
}
