import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { formatErr } from "../lib/api";
import { FileVideo, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@demo.com");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (user && user !== false) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/dealer"} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const u = await login(email, password);
      toast.success(`Welcome, ${u.name}`);
      nav(u.role === "admin" ? "/admin" : "/dealer");
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  const seed = (role) => {
    if (role === "admin") { setEmail("admin@demo.com"); setPassword("admin123"); }
    else { setEmail("dealer@demo.com"); setPassword("dealer123"); }
  };

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-1/2 bg-[#111827] text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "32px 32px"
        }} />
        <div className="relative">
          <div className="flex items-center gap-2 mb-16">
            <div className="w-9 h-9 bg-white text-[#111827] flex items-center justify-center rounded-sm">
              <FileVideo className="w-5 h-5" />
            </div>
            <div className="font-display font-extrabold text-xl tracking-tight">SIGNAGE OS</div>
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60 mb-4">
            B2B / Control Panel · v1.0
          </div>
          <h1 className="font-display text-5xl xl:text-6xl font-extrabold tracking-tighter leading-[0.95]">
            One pane <br/> of glass for <br/> every screen.
          </h1>
          <p className="text-white/70 mt-6 text-sm max-w-md">
            Manage dealers, clients, signage templates and wallets across Cloud, USB and Hybrid plans.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-3 text-[11px] font-semibold uppercase tracking-[0.2em]">
          <div className="border border-white/20 px-3 py-3 rounded-sm">
            <div className="text-white/50 mb-2 text-[10px]">Plan 01</div>
            <div>Cloud</div>
          </div>
          <div className="border border-white/20 px-3 py-3 rounded-sm">
            <div className="text-white/50 mb-2 text-[10px]">Plan 02</div>
            <div>USB</div>
          </div>
          <div className="border border-white/20 px-3 py-3 rounded-sm">
            <div className="text-white/50 mb-2 text-[10px]">Plan 03</div>
            <div>Hybrid</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#6B7280] mb-3">Sign in</div>
          <h2 className="font-display text-4xl font-extrabold tracking-tighter mb-2">Access the panel.</h2>
          <p className="text-sm text-[#6B7280] mb-8">Enter your credentials to continue.</p>

          {err && (
            <div data-testid="login-error" className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-sm">
              {err}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Email</Label>
              <Input
                id="email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 rounded-sm border-[#E5E7EB] focus-visible:ring-[#111827]"
                data-testid="login-email"
                required
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Password</Label>
              <Input
                id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 rounded-sm border-[#E5E7EB] focus-visible:ring-[#111827]"
                data-testid="login-password"
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={busy}
            className="w-full mt-6 rounded-sm bg-[#111827] hover:bg-[#374151] text-white"
            data-testid="login-submit"
          >
            {busy ? "Signing in..." : "Sign in →"}
          </Button>

          <div className="mt-6 pt-6 border-t border-[#E5E7EB]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-3">Demo accounts</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => seed("admin")} data-testid="seed-admin"
                className="flex items-center gap-2 px-3 py-2 border border-[#E5E7EB] rounded-sm text-xs hover:bg-[#F3F4F6] transition-colors">
                <ShieldCheck className="w-3.5 h-3.5" /> Admin
              </button>
              <button type="button" onClick={() => seed("dealer")} data-testid="seed-dealer"
                className="flex items-center gap-2 px-3 py-2 border border-[#E5E7EB] rounded-sm text-xs hover:bg-[#F3F4F6] transition-colors">
                <FileVideo className="w-3.5 h-3.5" /> Dealer
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
