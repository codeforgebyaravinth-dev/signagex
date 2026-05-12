import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import KpiCard from "../../components/KpiCard";
import { Building2, Users, FileVideo, Wallet, Cloud, Usb, GitMerge } from "lucide-react";
import PlanBadge from "../../components/PlanBadge";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/admin/stats").then((r) => setStats(r.data)).catch(() => setStats({}));
  }, []);

  const planDist = stats?.plan_distribution || { cloud: 0, usb: 0, hybrid: 0 };

  return (
    <div data-testid="admin-dashboard">
      <PageHeader overline="Admin / Overview" title="Operations dashboard." subtitle="Snapshot of dealers, clients, templates and wallet movements." />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <KpiCard label="Total Dealers" value={stats?.dealers ?? "—"} hint="Active partner accounts" Icon={Building2} testid="kpi-dealers" />
        <KpiCard label="Total Clients" value={stats?.clients ?? "—"} hint="Across all dealers" Icon={Users} testid="kpi-clients" accent="#002FA7" />
        <KpiCard label="Templates" value={stats?.templates ?? "—"} hint="Signage assets" Icon={FileVideo} testid="kpi-templates" accent="#F59E0B" />
        <KpiCard label="Wallet Volume" value={`₹ ${stats?.total_wallet?.toLocaleString?.() ?? 0}`} hint="Aggregate balances" Icon={Wallet} testid="kpi-wallet" accent="#10B981" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-4">
            Dealer Plan Distribution
          </div>
          <div className="space-y-4">
            {[
              { plan: "cloud", count: planDist.cloud, Icon: Cloud, color: "#002FA7" },
              { plan: "usb", count: planDist.usb, Icon: Usb, color: "#F59E0B" },
              { plan: "hybrid", count: planDist.hybrid, Icon: GitMerge, color: "#10B981" },
            ].map(({ plan, count, color }) => {
              const total = (planDist.cloud + planDist.usb + planDist.hybrid) || 1;
              const pct = Math.round((count / total) * 100);
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between mb-1.5">
                    <PlanBadge plan={plan} />
                    <span className="font-mono text-sm text-[#111827]">{count} <span className="text-[#9CA3AF]">/ {pct}%</span></span>
                  </div>
                  <div className="h-1.5 bg-[#F3F4F6] rounded-sm overflow-hidden">
                    <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#111827] text-white rounded-sm p-6 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.06]" style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }} />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-4">Quick actions</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight mb-4">Manage your network →</h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between border-b border-white/10 pb-2">
                <span>Create a new dealer account</span>
                <a href="/admin/dealers" className="text-white/70 hover:text-white">/dealers</a>
              </li>
              <li className="flex items-center justify-between border-b border-white/10 pb-2">
                <span>Publish a signage template</span>
                <a href="/admin/templates" className="text-white/70 hover:text-white">/templates</a>
              </li>
              <li className="flex items-center justify-between">
                <span>Review all clients</span>
                <a href="/admin/clients" className="text-white/70 hover:text-white">/clients</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
