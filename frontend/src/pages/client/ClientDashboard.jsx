import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import KpiCard from "../../components/KpiCard";
import { Monitor, FileVideo, Wallet, CalendarCheck, Package, Building, HardDrive, ShieldCheck, CalendarClock } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { } from "../../lib/utils";

const VERTICAL_LABELS = { general: "General", doctor: "Doctor", salon: "Salon", retailer: "Retailer", society: "Society" };

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClientDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/client/stats"), api.get("/client/subscription")])
      .then(([statsRes, subRes]) => {
        setStats(statsRes.data);
        setSubscription(subRes.data);
      })
      .catch(() => {
        setStats({});
        setSubscription(null);
      });
  }, []);

  const subscriptionPlan = subscription?.plan || null;
  const subscriptionStartedAt = subscription?.started_at || subscription?.plan_started_at || subscriptionPlan?.started_at || subscriptionPlan?.plan_started_at || null;
  const subscriptionExpiresAt = subscription?.expires_at || subscription?.plan_expires_at || subscription?.subscription_expires_at || subscriptionPlan?.expires_at || subscriptionPlan?.valid_till || subscriptionPlan?.plan_expires_at || null;
  const subscriptionActive = subscription?.active ?? null;
  const subscriptionStatus = subscription?.suspended
    ? "Suspended"
    : subscription?.expired || subscriptionActive === false
      ? "Expired"
      : "Active";

  return (
    <div data-testid="client-dashboard">
      <PageHeader overline={`Client / ${VERTICAL_LABELS[stats?.vertical] || "General"}`} title={`Hi, ${user?.name}.`} subtitle="Manage your screens, templates and storefront in one place." />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <KpiCard label="Devices" value={stats?.devices ?? "—"} hint={`${stats?.paired ?? 0} paired`} Icon={Monitor} accent="#002FA7" testid="kpi-devices" />
        <KpiCard label="Templates" value={stats?.templates ?? "—"} hint="Available layouts" Icon={FileVideo} accent="#F59E0B" testid="kpi-templates" />
        <KpiCard label="Wallet" value={`₹ ${stats?.wallet_balance?.toLocaleString?.() ?? 0}`} hint="Balance available" Icon={Wallet} accent="#10B981" testid="kpi-wallet" />
        <KpiCard label="Storage" value={`${stats?.storage_used_gb ?? 0} / ${stats?.storage_limit_gb ?? 0} GB`} hint={`${stats?.storage_remaining_gb ?? 0} GB remaining`} Icon={HardDrive} accent="#7C3AED" testid="kpi-storage" />
        {(stats?.vertical === "doctor" || stats?.vertical === "salon") && (
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

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6 mb-10 items-start">
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Subscription</div>
              <h3 className="font-display text-2xl font-extrabold tracking-tight">Plan details and expiry</h3>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${subscriptionStatus === "Active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              <ShieldCheck className="w-3.5 h-3.5" />
              {subscriptionStatus}
            </div>
          </div>

          {!subscriptionPlan ? (
            <div className="rounded-sm border border-dashed border-[#E5E7EB] bg-[#F9FAFB] p-5 text-sm text-[#6B7280]">
              No subscription plan is attached yet. Ask your dealer to assign a plan from the Plans tab.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Plan name</div>
                <div className="mt-2 font-display text-2xl font-extrabold tracking-tight">{subscriptionPlan.name || subscriptionPlan.type || "Subscription"}</div>
                <div className="mt-1 text-sm text-[#6B7280]">{subscriptionPlan.type || "plan"}</div>
              </div>
              <div className="rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Start date</div>
                <div className="mt-2 font-display text-xl font-extrabold tracking-tight">{formatDateTime(subscriptionStartedAt)}</div>
                <div className="mt-1 text-sm text-[#6B7280]">Plan became active here</div>
              </div>
              <div className="rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Expiry</div>
                <div className="mt-2 font-display text-2xl font-extrabold tracking-tight">{formatDateTime(subscriptionExpiresAt)}</div>
                <div className="mt-1 text-sm text-[#6B7280]">{subscriptionExpiresAt ? "Plan validity ends here" : "No expiry on file"}</div>
              </div>
              <div className="rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Billing cycle</div>
                <div className="mt-2 font-display text-2xl font-extrabold tracking-tight">{subscriptionPlan.billing_cycle || "monthly"}</div>
                <div className="mt-1 text-sm text-[#6B7280]">₹{Number(subscriptionPlan.price || 0).toLocaleString()}</div>
              </div>
              <div className="rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                <div className="text-[11px] uppercase tracking-wider text-[#6B7280]">Storage limit</div>
                <div className="mt-2 font-display text-2xl font-extrabold tracking-tight">{Number(subscriptionPlan.storage_limit_gb || 0)} GB</div>
                <div className="mt-1 text-sm text-[#6B7280]">Plan storage allowance</div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-[#111827] text-white rounded-sm p-6 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.06]" style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "24px 24px"
          }} />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-4">Quick status</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2 text-sm">
                <span className="text-white/70">Subscription</span>
                <span className="font-semibold">{subscriptionStatus}</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2 text-sm">
                <span className="text-white/70">Plan</span>
                <span className="font-semibold">{subscriptionPlan?.name || subscriptionPlan?.type || "—"}</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2 text-sm">
                <span className="text-white/70">Started</span>
                <span className="font-semibold">{formatDateTime(subscriptionStartedAt)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-white/10 pb-2 text-sm">
                <span className="text-white/70">Expires</span>
                <span className="font-semibold">{formatDateTime(subscriptionExpiresAt)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Storage used</span>
                <span className="font-semibold">{stats?.storage_used_gb ?? 0} / {stats?.storage_limit_gb ?? 0} GB</span>
              </div>
            </div>
          </div>
        </div>
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
