import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import KpiCard from "../../components/KpiCard";
import { Monitor, FileVideo, Wallet, CalendarCheck, Package, Building } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const VERTICAL_LABELS = { general: "General", doctor: "Doctor", retailer: "Retailer", society: "Society" };

export default function ClientDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get("/client/stats").then((r) => setStats(r.data)).catch(() => setStats({})); }, []);

  return (
    <div data-testid="client-dashboard">
      <PageHeader overline={`Client / ${VERTICAL_LABELS[stats?.vertical] || "General"}`} title={`Hi, ${user?.name}.`} subtitle="Manage your screens, templates and storefront in one place." />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <KpiCard label="Devices" value={stats?.devices ?? "—"} hint={`${stats?.paired ?? 0} paired`} Icon={Monitor} accent="#002FA7" testid="kpi-devices" />
        <KpiCard label="Templates" value={stats?.templates ?? "—"} hint="Available layouts" Icon={FileVideo} accent="#F59E0B" testid="kpi-templates" />
        <KpiCard label="Wallet" value={`₹ ${stats?.wallet_balance?.toLocaleString?.() ?? 0}`} hint="Balance available" Icon={Wallet} accent="#10B981" testid="kpi-wallet" />
        {stats?.vertical === "doctor" && (
          <KpiCard label="Appointments today" value={stats?.appointments_today ?? 0} hint="Live queue" Icon={CalendarCheck} testid="kpi-apts" />
        )}
        {stats?.vertical === "retailer" && (
          <KpiCard label="Products" value={stats?.products ?? 0} hint="In your catalog" Icon={Package} testid="kpi-products" />
        )}
        {stats?.vertical === "society" && (
          <KpiCard label="Rooms" value={stats?.rooms ?? 0} hint="Registered units" Icon={Building} testid="kpi-rooms" />
        )}
        {stats?.vertical === "general" && (
          <KpiCard label="Account type" value="General" hint="Standard signage" Icon={FileVideo} testid="kpi-acct" />
        )}
      </div>

      <div className="bg-[#111827] text-white rounded-sm p-6 max-w-2xl relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "24px 24px"
        }} />
        <div className="relative">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-4">Quick start</div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight mb-3">Get your screens online.</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between border-b border-white/10 pb-2">
              <span>1. Pair a signage screen</span><a href="/client/devices" className="text-white/70 hover:text-white">/devices</a>
            </li>
            <li className="flex items-center justify-between border-b border-white/10 pb-2">
              <span>2. Pick a layout template</span><a href="/client/templates" className="text-white/70 hover:text-white">/templates</a>
            </li>
            <li className="flex items-center justify-between">
              <span>3. Manage your storefront content</span><a href="/client/storefront" className="text-white/70 hover:text-white">/storefront</a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
