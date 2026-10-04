import { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as authApi from "../services/authApi";

const AdminAuthContext = createContext(null);
// Deliberately a DIFFERENT localStorage key than client/'s
// "bazaar_sync_token" — these are two separate apps/origins so there's no
// real collision risk, but a distinct key makes that separation explicit
// rather than accidental.
const TOKEN_KEY = "bazaar_sync_admin_token";

export function AdminAuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    // Distinguishes "checked and this account isn't an admin" from "still
    // loading" / "not logged in" — the login screen uses this to show a
    // specific error instead of silently bouncing back to itself.
    const [notAdminError, setNotAdminError] = useState(false);
    const [sessionRevokedError, setSessionRevokedError] = useState(null);

    useEffect(() => {
        if (!token) { setLoading(false); return; }
        authApi.fetchMe(token)
            .then((r) => {
                if (r.user.role !== "admin") {
                    setNotAdminError(true);
                    setToken(null);
                    localStorage.removeItem(TOKEN_KEY);
                } else {
                    setUser(r.user);
                    setSessionRevokedError(null);
                }
            })
            .catch((err) => { 
                if (err.message && err.message.includes("SESSION_REVOKED")) {
                    setSessionRevokedError("Your admin session was terminated because your account logged in on another device.");
                }
                setToken(null); 
                localStorage.removeItem(TOKEN_KEY); 
                setUser(null);
            })
            .finally(() => setLoading(false));
    }, [token]);

    const login = useCallback(async (email, password) => {
        setNotAdminError(false);
        setSessionRevokedError(null);
        const data = await authApi.login(email, password);
        if (data.user.role !== "admin") {
            setNotAdminError(true);
            throw new Error("This account doesn't have admin access.");
        }
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setUser(data.user);
    }, []);

    const logout = useCallback(() => {
        if (token) {
            authApi.logoutApi(token).catch(() => {});
        }
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
    }, [token]);

    return (
        <AdminAuthContext.Provider value={{ token, user, loading, notAdminError, sessionRevokedError, setSessionRevokedError, login, logout }}>
            {children}
        </AdminAuthContext.Provider>
    );
}

export function useAdminAuth() {
    const ctx = useContext(AdminAuthContext);
    if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
    return ctx;
}
