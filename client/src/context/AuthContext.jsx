import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as authApi from "../services/authApi";

const AuthContext = createContext(null);
const TOKEN_KEY = "bazaar_sync_token";

function getStoredToken() {
    try {
        return typeof window !== "undefined" && window.localStorage ? localStorage.getItem(TOKEN_KEY) : null;
    } catch {
        return null;
    }
}

function setStoredToken(val) {
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            if (val) localStorage.setItem(TOKEN_KEY, val);
            else localStorage.removeItem(TOKEN_KEY);
        }
    } catch {
        /* ignore */
    }
}

export function AuthProvider({ children }) {
    const [token, setToken] = useState(getStoredToken);
    const [user, setUser] = useState(null);
    const [instituteAccess, setInstituteAccess] = useState(false);
    const [loading, setLoading] = useState(true);
    const [sessionRevokedError, setSessionRevokedError] = useState(null);

    useEffect(() => {
        if (!token) { setLoading(false); return; }
        authApi.fetchMe(token)
            .then((r) => { 
                setUser(r.user); 
                setInstituteAccess(!!r.instituteAccess); 
                setSessionRevokedError(null);
            })
            .catch((err) => { 
                if (err.message && err.message.includes("SESSION_REVOKED")) {
                    setSessionRevokedError("Your account was logged in from another device. You have been logged out.");
                }
                setToken(null); 
                setStoredToken(null); 
                setUser(null);
            })
            .finally(() => setLoading(false));
    }, [token]);

    const applyAuth = useCallback((data) => {
        setStoredToken(data.token);
        setToken(data.token);
        setUser(data.user);
        setInstituteAccess(!!data.instituteAccess);
        setSessionRevokedError(null);
    }, []);

    const login = useCallback(async (email, password) => {
        const data = await authApi.login(email, password);
        applyAuth(data);
        return data;
    }, [applyAuth]);

    const loginWithGoogle = useCallback(async (credential, accessToken) => {
        const data = await authApi.googleAuth(credential, accessToken);
        applyAuth(data);
        return data;
    }, [applyAuth]);

    const register = useCallback(async (name, email, password) => {
        const data = await authApi.register(name, email, password);
        applyAuth(data);
        return data;
    }, [applyAuth]);

    const logout = useCallback(async () => {
        if (token) {
            authApi.logoutApi(token).catch(() => {});
        }
        setStoredToken(null);
        setToken(null);
        setUser(null);
    }, [token]);

    // Re-fetches /me so `user`/`isPro` reflect a just-completed purchase
    // (e.g. Pro subscription) without forcing a re-login.
    const refreshUser = useCallback(async () => {
        if (!token) return;
        try {
            const r = await authApi.fetchMe(token);
            setUser(r.user);
            setInstituteAccess(!!r.instituteAccess);
        } catch (err) {
            if (err.message && err.message.includes("SESSION_REVOKED")) {
                setSessionRevokedError("Your account was logged in from another device. You have been logged out.");
                setToken(null);
                setStoredToken(null);
                setUser(null);
            }
        }
    }, [token]);

    // instituteAccess grants Pro-equivalent access
    const isPro = (user?.tier === "pro" && (!user.pro_expires_at || new Date(user.pro_expires_at) > new Date())) || instituteAccess;

    return (
        <AuthContext.Provider value={{ 
            token, 
            user, 
            loading, 
            isPro, 
            instituteAccess, 
            sessionRevokedError,
            setSessionRevokedError,
            login, 
            loginWithGoogle,
            register, 
            logout, 
            refreshUser 
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
