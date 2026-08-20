import { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as authApi from "../services/authApi";

const AuthContext = createContext(null);
const TOKEN_KEY = "bazaar_sync_token";

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
    const [user, setUser] = useState(null);
    const [instituteAccess, setInstituteAccess] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!token) { setLoading(false); return; }
        authApi.fetchMe(token)
            .then((r) => { setUser(r.user); setInstituteAccess(!!r.instituteAccess); })
            .catch(() => { setToken(null); localStorage.removeItem(TOKEN_KEY); })
            .finally(() => setLoading(false));
    }, [token]);

    const applyAuth = useCallback((data) => {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setUser(data.user);
        setInstituteAccess(!!data.instituteAccess);
    }, []);

    const login = useCallback(async (email, password) => {
        const data = await authApi.login(email, password);
        applyAuth(data);
    }, [applyAuth]);

    const register = useCallback(async (name, email, password) => {
        const data = await authApi.register(name, email, password);
        applyAuth(data);
    }, [applyAuth]);

    const logout = useCallback(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
    }, []);

    // Re-fetches /me so `user`/`isPro` reflect a just-completed purchase
    // (e.g. Pro subscription) without forcing a re-login.
    const refreshUser = useCallback(async () => {
        if (!token) return;
        const r = await authApi.fetchMe(token);
        setUser(r.user);
        setInstituteAccess(!!r.instituteAccess);
    }, [token]);

    // instituteAccess (see instituteAccessService.js) grants Pro-equivalent
    // access from an allowlisted network without ever touching user.tier —
    // OR'd in here so the UI doesn't show "Get Pro" prompts to someone the
    // backend would let through anyway.
    const isPro = (user?.tier === "pro" && (!user.pro_expires_at || new Date(user.pro_expires_at) > new Date())) || instituteAccess;

    return (
        <AuthContext.Provider value={{ token, user, loading, isPro, instituteAccess, login, register, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
