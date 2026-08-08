import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  user: { id: string; email: string; planId: string } | null;
  setAuth: (accessToken: string, user: AuthState["user"]) => void;
  clear: () => void;
}

// Access token lives in memory only (never localStorage) — a refresh happens on page load via
// the httpOnly refresh cookie instead. This keeps the token out of reach of a stored-XSS payload.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clear: () => set({ accessToken: null, user: null }),
}));
