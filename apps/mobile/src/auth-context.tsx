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
import { apiLogin, apiMe, apiRegister, ApiError, setAuthToken } from "./api";
import { clearToken, loadToken, saveToken } from "./storage";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** 用服务端返回的最新用户信息刷新会话（改名/改店名后调用） */
  updateUser: (user: AuthUser) => void;
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
        } catch (e) {
          // 仅在服务端明确拒绝（401 token 失效/用户被删）时才登出；
          // 断网/超时/5xx 保留本地会话，保证离线打开 App 仍可开单（离线优先）。
          if (e instanceof ApiError && e.status === 401) {
            setAuthToken(null);
            await clearToken();
          }
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

  const updateUser = useCallback((u: AuthUser) => {
    setUser(u);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, updateUser }),
    [user, loading, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
