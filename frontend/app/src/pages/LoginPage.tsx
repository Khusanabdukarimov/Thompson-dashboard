import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/Button";
import {
  getAuthStatus,
  login,
  setStoredToken,
  getStoredToken,
  type DashboardRole,
} from "@/lib/auth";

export default function LoginPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ["auth/status"],
    queryFn: getAuthStatus,
    staleTime: Infinity,
  });

  // If auth is disabled OR user is already logged in, redirect to dashboard
  useEffect(() => {
    if (!statusQ.data) return;
    if (!statusQ.data.enabled || getStoredToken()) {
      nav("/payroll/dashboard", { replace: true });
    }
    if (statusQ.data.admin_username) setUsername(statusQ.data.admin_username);
  }, [statusQ.data, nav]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Parol kiritish majburiy");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await login(password, username);
      setStoredToken(
        r.access_token,
        r.username,
        (r.role as DashboardRole) ?? "admin",
      );
      nav("/payroll/dashboard", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-2 rounded-xl flex items-center justify-center font-bold text-[20px] text-white mx-auto mb-3">
            M
          </div>
          <div className="text-[18px] font-semibold mb-1">
            Mountain Dashboard
          </div>
          <div className="text-[12px] text-text3">
            Kirish uchun parolni kiriting
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg2 border border-border rounded-xl shadow-lg p-6"
        >
          <div className="mb-4">
            <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">
              Login
            </label>
            <input
              className="w-full px-3 py-2 rounded-md border border-border bg-bg text-text text-[13px] focus:outline-none focus:border-blue focus:bg-bg2 focus:shadow-[0_0_0_3px_rgba(34,102,245,0.1)]"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="mb-4">
            <label className="block text-[10px] text-text3 mb-1 uppercase tracking-wider font-medium">
              Parol
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text3" />
              <input
                type="password"
                className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-bg text-text text-[13px] focus:outline-none focus:border-blue focus:bg-bg2 focus:shadow-[0_0_0_3px_rgba(34,102,245,0.1)]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-bg border border-red-bd rounded-md text-[12px] text-red flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            variant="primary"
            disabled={submitting}
            className="w-full justify-center"
          >
            {submitting ? "Tekshirilmoqda…" : "Kirish"}
          </Button>

          {statusQ.data && !statusQ.data.enabled && (
            <div className="mt-4 text-[11px] text-text3 text-center">
              ℹ Auth o'chirilgan (`AUTH_ENABLED=false`). Avtomatik ravishda
              ichkariga o'tkaziladi.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
