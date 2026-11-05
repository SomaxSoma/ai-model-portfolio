import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api';
import type { User } from '../types';

interface Session {
  user: User | null;
  /** True until a stored token has been checked against the server. */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  /** Signs in with a token issued elsewhere (demo, password reset, Google/GitHub). */
  adopt: (token: string, user?: User) => Promise<User>;
  /** Replaces the cached account after a profile change. */
  setUser: (user: User) => void;
  logout: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => !!getToken());

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    // The role always comes from the server, never from storage.
    api<User>('/me')
      .then(setUser)
      .catch(logout)
      .finally(() => setLoading(false));
  }, [logout]);

  const value = useMemo<Session>(
    () => ({
      user,
      loading,
      logout,
      login: async (email, password) => {
        const r = await api<{ user: User; token: string }>('/auth/login', { method: 'POST', body: { email, password } });
        setToken(r.token);
        setUser(r.user);
        return r.user;
      },
      setUser,
      adopt: async (token, known) => {
        setToken(token);
        const u = known ?? (await api<User>('/me'));
        setUser(u);
        return u;
      },
      register: async (name, email, password) => {
        const r = await api<{ user: User; token: string }>('/auth/register', { method: 'POST', body: { name, email, password } });
        setToken(r.token);
        setUser(r.user);
        return r.user;
      },
    }),
    [user, loading, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
