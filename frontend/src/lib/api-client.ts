import { useAuthStore } from "./auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions extends RequestInit {
  skipAuthRetry?: boolean;
}

async function rawRequest(path: string, options: RequestInit = {}) {
  const accessToken = useAuthStore.getState().accessToken;
  const headers = new Headers(options.headers);
  // FormData sets its own multipart boundary — forcing JSON here would break image uploads.
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
}

async function parseOrThrow(res: Response) {
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? "Request failed", body?.error?.code);
  }
  return body;
}

// A 401 on a session-authenticated request gets exactly one silent refresh-and-retry — after
// that, the caller (React Query) surfaces the failure and the shell redirects to /login.
export async function apiRequest(path: string, options: RequestOptions = {}) {
  let res = await rawRequest(path, options);

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await rawRequest(path, options);
    }
  }

  return parseOrThrow(res);
}

/** Same auth-and-retry path as apiRequest, but returns the raw body — for file downloads (the
 * Phase 11 data-export archive) where the response is bytes, not a JSON envelope. */
export async function apiRequestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  let res = await rawRequest(path, options);

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawRequest(path, options);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error?.message ?? "Download failed", body?.error?.code);
  }
  return res.blob();
}

export async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      useAuthStore.getState().clear();
      return false;
    }
    const body = await res.json();
    useAuthStore.getState().setAuth(body.accessToken, body.user);
    return true;
  } catch {
    return false;
  }
}
