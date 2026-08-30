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
import {
  clearCachedUser,
  clearToken,
  loadCachedUser,
  loadToken,
  saveCachedUser,
  saveToken,
} from "./storage";

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
      if (!token) {
        // 无 token：清掉可能残留的身份缓存，直接进登录页
        await clearCachedUser();
        setLoading(false);
        return;
      }
      setAuthToken(token);
      const cached = await loadCachedUser();
      if (cached) {
        // 离线优先：先用缓存身份立即进入 App（不再卡启动转圈），
        // /auth/me 移到后台校验：成功则刷新身份；401（token 失效/用户被删）
        // 才登出；断网/超时保留缓存会话，离线仍可开单。
        setUser(cached);
        setLoading(false);
        try {
          const me = await apiMe();
          setUser(me);
          await saveCachedUser(me);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            setAuthToken(null);
            await clearToken();
            await clearCachedUser();
            setUser(null);
          }
        }
        return;
      }
      // 无缓存（升级后首次启动）：在线校验拿到身份并写入缓存，
      // 之后每次启动都走上面的离线优先路径。
      try {
        const me = await apiMe();
        setUser(me);
        await saveCachedUser(me);
      } catch (e) {
        // 仅在服务端明确拒绝（401 token 失效/用户被删）时才登出；
        // 断网/超时/5xx 保留本地会话，保证离线打开 App 仍可开单（离线优先）。
        if (e instanceof ApiError && e.status === 401) {
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
    await saveCachedUser(res.user);
    setUser(res.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await apiRegister(input);
    setAuthToken(res.token);
    await saveToken(res.token);
    await saveCachedUser(res.user);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    await clearToken();
    await clearCachedUser();
    setUser(null);
  }, []);

  const updateUser = useCallback((u: AuthUser) => {
    setUser(u);
    void saveCachedUser(u);
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
