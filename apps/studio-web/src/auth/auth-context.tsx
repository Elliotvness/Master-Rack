import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  signIn as apiSignIn,
  signOut as apiSignOut,
  type SignInInput,
} from './auth-client.js';

export interface AuthUser {
  readonly email: string;
  readonly name?: string;
  readonly role?: 'CLIENT_USER' | 'CLIENT_ADMIN' | 'INTERNAL_ENGINEER' | 'INTERNAL_ADMIN' | string;
  readonly organizationId?: string;
}

export interface AuthContextValue {
  readonly isAuthenticated: boolean;
  readonly user: AuthUser | null;
  readonly signIn: (
    credentials: SignInInput,
    fetchImpl?: typeof fetch,
  ) => Promise<{ ok: boolean; message?: string }>;
  readonly signOut: (fetchImpl?: typeof fetch) => Promise<void>;
  readonly setUser: (user: AuthUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'rms_auth_user';

function getStoredUser(): AuthUser | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as AuthUser;
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return null;
}

function storeUser(user: AuthUser | null): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (user) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage quota / access errors
  }
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  readonly children: ReactNode;
  readonly initialUser?: AuthUser | null;
}): React.JSX.Element {
  const [user, setUserState] = useState<AuthUser | null>(
    () => initialUser ?? getStoredUser(),
  );

  const setUser = useCallback((nextUser: AuthUser | null) => {
    setUserState(nextUser);
    storeUser(nextUser);
  }, []);

  const signIn = useCallback(
    async (
      credentials: SignInInput,
      fetchImpl?: typeof fetch,
    ): Promise<{ ok: boolean; message?: string }> => {
      const result = await apiSignIn(credentials, fetchImpl);
      if (result.ok) {
        const authedUser: AuthUser = {
          email: credentials.email.trim().toLowerCase(),
          role: 'CLIENT_USER',
        };
        setUser(authedUser);
        return { ok: true };
      }
      return { ok: false, message: result.message };
    },
    [setUser],
  );

  const signOut = useCallback(
    async (fetchImpl?: typeof fetch): Promise<void> => {
      await apiSignOut(fetchImpl);
      setUser(null);
    },
    [setUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: user !== null,
      user,
      signIn,
      signOut,
      setUser,
    }),
    [user, signIn, signOut, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  isAuthenticated: false,
  user: null,
  signIn: async () => ({ ok: false, message: 'No AuthProvider mounted' }),
  signOut: async () => {},
  setUser: () => {},
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  return ctx ?? DEFAULT_AUTH_CONTEXT;
}
