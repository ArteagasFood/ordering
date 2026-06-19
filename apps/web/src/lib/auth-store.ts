import { create } from 'zustand';
import type { LoginRequest, MeResponse, SessionUser } from '@panaderia/shared';
import { api, ApiError } from './api-client';

/**
 * Global auth state (Zustand). Holds the current principal and a coarse status used to
 * gate routing: `loading` while we resolve the session on startup, then `authed` or
 * `anon`. The session itself lives in the httpOnly cookie; this store only mirrors the
 * principal for the UI (which controls what is shown — never the real boundary, §2.3).
 */
export type AuthStatus = 'loading' | 'authed' | 'anon';

interface AuthState {
  user: SessionUser | null;
  status: AuthStatus;
  /** Resolve the current session once on app startup. */
  bootstrap: () => Promise<void>;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  bootstrap: async () => {
    try {
      const { user } = await api.get<MeResponse>('/auth/me');
      set({ user, status: 'authed' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        set({ user: null, status: 'anon' });
      } else {
        // Network or unexpected error: treat as anonymous but don't crash the app.
        set({ user: null, status: 'anon' });
      }
    }
  },

  login: async (credentials) => {
    const { user } = await api.post<MeResponse>('/auth/login', credentials);
    set({ user, status: 'authed' });
  },

  logout: async () => {
    await api.post<void>('/auth/logout');
    set({ user: null, status: 'anon' });
  },
}));
