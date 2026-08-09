import { beforeEach, describe, expect, it, vi } from "vitest";

// This is the exact class of bug the fix addresses: an async flow that looks right and is
// silently wrong under the one condition (the popup closing) that always happens in production.
// `chrome.tabs.create` steals focus from the action popup, which Chrome then closes — a plain
// `setInterval` in a popup-owned React component never survives that. These tests exercise the
// background module the fix moved that responsibility into, with `chrome.*` and the API client
// both faked so the assertions are about state transitions, not the network or the browser.

const pollPairing = vi.fn();
const startPairingApi = vi.fn();

vi.mock("../src/background/api", () => ({
  backgroundApi: {
    startPairing: (...args: unknown[]) => startPairingApi(...args),
    pollPairing: (...args: unknown[]) => pollPairing(...args),
  },
}));

function installChromeMock() {
  const store = new Map<string, unknown>();
  const alarms = new Map<string, unknown>();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (key: string) => {
          store.delete(key);
        },
      },
    },
    alarms: {
      create: vi.fn((name: string, info: unknown) => alarms.set(name, info)),
      clear: vi.fn(async (name: string) => alarms.delete(name)),
    },
  };
  return { alarms };
}

const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

describe("background pairing (extension bug fix)", () => {
  let alarms: Map<string, unknown>;
  // Fresh module registry per test: pairing.ts and storage.ts hold no module-level state of their
  // own (everything lives in the faked chrome.storage), but re-importing keeps each test's chrome
  // mock from leaking into the next via any accidental caching.
  let pairing: typeof import("../src/background/pairing");
  let storage: typeof import("../src/lib/storage");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ alarms } = installChromeMock());
    pairing = await import("../src/background/pairing");
    storage = await import("../src/lib/storage");
  });

  it("persists the pending code and schedules a repeating alarm on start", async () => {
    startPairingApi.mockResolvedValue({ code: "ABC12345", expiresAt: future() });

    const result = await pairing.startPairing();

    expect(result.code).toBe("ABC12345");
    expect(await storage.getPendingPairing()).toEqual({ code: "ABC12345", expiresAt: result.expiresAt });
    expect(alarms.has(pairing.PAIRING_ALARM_NAME)).toBe(true);
  });

  it("reports 'none' and clears a stray alarm when nothing is pending", async () => {
    alarms.set(pairing.PAIRING_ALARM_NAME, {}); // an alarm left over after e.g. a browser restart
    const result = await pairing.checkPendingPairing();
    expect(result).toEqual({ status: "none" });
    expect(alarms.has(pairing.PAIRING_ALARM_NAME)).toBe(false);
  });

  it("stores the key and clears pending state the moment the server reports claimed", async () => {
    startPairingApi.mockResolvedValue({ code: "CODE0001", expiresAt: future() });
    await pairing.startPairing();

    pollPairing.mockResolvedValue({ status: "claimed", key: "mp_live_abc" });
    const result = await pairing.checkPendingPairing();

    expect(result).toEqual({ status: "claimed" });
    expect(await storage.getApiKey()).toBe("mp_live_abc");
    expect(await storage.getPendingPairing()).toBeNull();
    expect(alarms.has(pairing.PAIRING_ALARM_NAME)).toBe(false);
  });

  it("leaves pending state and the alarm alone while the server still reports pending", async () => {
    startPairingApi.mockResolvedValue({ code: "CODE0002", expiresAt: future() });
    await pairing.startPairing();

    pollPairing.mockResolvedValue({ status: "pending" });
    const result = await pairing.checkPendingPairing();

    expect(result).toEqual({ status: "pending" });
    expect(await storage.getPendingPairing()).not.toBeNull();
    expect(alarms.has(pairing.PAIRING_ALARM_NAME)).toBe(true);
  });

  it("clears state and stops the alarm once the server reports expired", async () => {
    startPairingApi.mockResolvedValue({ code: "CODE0003", expiresAt: future() });
    await pairing.startPairing();

    pollPairing.mockResolvedValue({ status: "expired" });
    const result = await pairing.checkPendingPairing();

    expect(result).toEqual({ status: "expired" });
    expect(await storage.getPendingPairing()).toBeNull();
    expect(alarms.has(pairing.PAIRING_ALARM_NAME)).toBe(false);
  });

  it("expires locally, without a network call, once the stored expiry has passed", async () => {
    startPairingApi.mockResolvedValue({ code: "CODE0004", expiresAt: past() });
    await pairing.startPairing();

    const result = await pairing.checkPendingPairing();

    expect(result).toEqual({ status: "expired" });
    expect(pollPairing).not.toHaveBeenCalled();
  });

  it("only ever delivers the key once — a second check after claiming reports 'none'", async () => {
    startPairingApi.mockResolvedValue({ code: "CODE0005", expiresAt: future() });
    await pairing.startPairing();
    pollPairing.mockResolvedValue({ status: "claimed", key: "mp_live_xyz" });

    await pairing.checkPendingPairing();
    const second = await pairing.checkPendingPairing();

    expect(second).toEqual({ status: "none" });
    expect(pollPairing).toHaveBeenCalledTimes(1);
  });
});
