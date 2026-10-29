import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext(null);
const THEME_KEY = "bazaar_sync_theme";
const THEMES = ["light", "ocean", "dark"];

// The inline script in index.html already applies the "dark" class (and the
// "ocean" data-theme attribute) before first paint (avoids a flash of the
// wrong theme) — this just reads the same storage key so React's state
// agrees with what's already on <html>.
function getInitialTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return THEMES.includes(saved) ? saved : "light";
    } catch {
        return "light";
    }
}

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(getInitialTheme);

    useEffect(() => {
        // "ocean" is a teal-tinted variant of dark mode, not a fourth
        // independent palette — it carries the `dark` class so every
        // existing `dark:` Tailwind utility across the app still applies,
        // and `data-theme="ocean"` on top retints only the token-based
        // surfaces (bg-surface, text-fg, …) defined in index.css.
        document.documentElement.classList.toggle("dark", theme === "dark" || theme === "ocean");
        if (theme === "ocean") {
            document.documentElement.setAttribute("data-theme", "ocean");
        } else {
            document.documentElement.removeAttribute("data-theme");
        }
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch {
            /* localStorage unavailable (private mode, etc) — theme just won't persist across reloads */
        }
    }, [theme]);

    // Cycles Light -> Ocean -> Dark -> Light. Kept as the single toggle
    // entrypoint (TopNav's button) rather than a 3-way picker, matching the
    // existing single-click toggle UX.
    const toggleTheme = useCallback(() => {
        setTheme((prev) => THEMES[(THEMES.indexOf(prev) + 1) % THEMES.length]);
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === "dark" || theme === "ocean" }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
    return ctx;
}
