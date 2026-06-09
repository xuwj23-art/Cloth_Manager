import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser, LoginInput, RegisterInput } from "@cloth-scan/shared";
import { apiLogin, apiMe, apiRegister, setAuthToken } from "./api";
import { clearToken, loadToken, saveToken } from "./storage";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (token) {
        setAuthToken(token);
        try {
          const me = await apiMe();
          setUser(me);
        } catch {
          setAuthToken(null);
          await clearToken();
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const res = await apiLogin(input);
    setAuthToken(res.token);
    await saveToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await apiRegister(input);
    setAuthToken(res.token);
    await saveToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    await clearToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
