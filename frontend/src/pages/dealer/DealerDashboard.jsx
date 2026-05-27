import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import KpiCard from "../../components/KpiCard";
import PlanBadge from "../../components/PlanBadge";
import { Users, FileVideo, Wallet, Cloud, Usb, GitMerge } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { formatDateTime } from "../../lib/utils";

export default function DealerDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/dealer/stats").then((r) => setStats(r.data)).catch(() => setStats({}));
  }, []);

  const planDist = stats?.plan_distribution || { cloud: 0, usb: 0, hybrid: 0 };
  const subscriptionPlan = stats?.subscription_plan || null;
  const subscriptionStartedAt = stats?.subscription_started_at || subscriptionPlan?.plan_started_at || null;
  const subscriptionExpiresAt = stats?.subscription_expires_at || subscriptionPlan?.expires_at || null;

  return (
    <div data-testid="dealer-dashboard">
      <PageHeader overline={`Dealer / ${user?.name}`} title="Your operations." subtitle="Quick view of clients, available templates and wallet." />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <KpiCard label="My Clients" value={stats?.clients ?? "—"} hint="Active subscriptions" Icon={Users} accent="#002FA7" testid="kpi-my-clients" />
        <KpiCard label="Templates" value={stats?.templates ?? "—"} hint="Assigned by admin" Icon={FileVideo} accent="#F59E0B" testid="kpi-my-templates" />
        <KpiCard label="My Wallet" value={`₹ ${stats?.wallet_balance?.toLocaleString?.() ?? 0}`} hint="Available to credit clients" Icon={Wallet} accent="#10B981" testid="kpi-my-wallet" />
        <KpiCard label="Clients Wallet" value={`₹ ${stats?.clients_wallet_total?.toLocaleString?.() ?? 0}`} hint="Funds deployed" Icon={Wallet} testid="kpi-clients-wallet" />
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm p-6 max-w-2xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-4">
          Your clients by plan
        </div>
        <div className="space-y-4">
          {[
            { plan: "cloud", count: planDist.cloud, color: "#002FA7" },
            { plan: "usb", count: planDist.usb, color: "#F59E0B" },
            { plan: "hybrid", count: planDist.hybrid, color: "#10B981" },
          ].map(({ plan, count, color }) => {
            const total = (planDist.cloud + planDist.usb + planDist.hybrid) || 1;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={plan}>
                <div className="flex items-center justify-between mb-1.5">
                  <PlanBadge plan={plan} />
                  <span className="font-mono text-sm">{count} <span className="text-[#9CA3AF]">/ {pct}%</span></span>
                </div>
                <div className="h-1.5 bg-[#F3F4F6] rounded-sm overflow-hidden">
                  <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 bg-white border border-[#E5E7EB] rounded-sm p-6 max-w-2xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-4">
          Subscription
        </div>
        {subscriptionPlan ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-sm bg-[#F9FAFB] border border-[#E5E7EB] p-4">
              <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Plan name</div>
              <div className="mt-2 font-display text-2xl font-extrabold tracking-tight">{subscriptionPlan.name || subscriptionPlan.type || "Subscription"}</div>
              <div className="mt-1 text-sm text-[#6B7280]">{subscriptionPlan.billing_cycle || "monthly"}</div>
            </div>
            <div className="rounded-sm bg-[#F9FAFB] border border-[#E5E7EB] p-4">
              <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Start date</div>
              <div className="mt-2 font-display text-xl font-extrabold tracking-tight">{formatDateTime(subscriptionStartedAt)}</div>
            </div>
            <div className="rounded-sm bg-[#F9FAFB] border border-[#E5E7EB] p-4">
              <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">End date</div>
              <div className="mt-2 font-display text-xl font-extrabold tracking-tight">{formatDateTime(subscriptionExpiresAt)}</div>
            </div>
            <div className="rounded-sm bg-[#F9FAFB] border border-[#E5E7EB] p-4">
              <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Duration</div>
              <div className="mt-2 font-display text-xl font-extrabold tracking-tight">{Number(subscriptionPlan.duration_days || 0)} days</div>
            </div>
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-5 text-sm text-[#6B7280]">No dealer subscription is attached yet.</div>
        )}
      </div>
    </div>
  );
}
