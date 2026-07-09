import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Auth() {
    const [mode, setMode] = useState("login"); // 'login' | 'register'
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const { login, register } = useAuth();
    const navigate = useNavigate();

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (mode === "login") await login(email, password);
            else await register(name, email, password);
            navigate("/option-chain");
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="mx-auto max-w-sm px-4 py-16">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h1 className="mb-4 text-lg font-semibold text-gray-900">
                    {mode === "login" ? "Log in" : "Create an account"}
                </h1>

                <form onSubmit={handleSubmit} className="space-y-3">
                    {mode === "register" && (
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                            <input
                                type="text" required value={name} onChange={(e) => setName(e.target.value)}
                                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                            />
                        </div>
                    )}
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-500">Email</label>
                        <input
                            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-500">Password</label>
                        <input
                            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                        />
                    </div>

                    {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}

                    <button
                        type="submit" disabled={loading}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
                    </button>
                </form>

                <button
                    onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
                    className="mt-4 w-full text-center text-xs text-gray-500 hover:text-gray-700"
                >
                    {mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
                </button>
            </div>
        </div>
    );
}
