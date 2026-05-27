import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge from "../../components/PlanBadge";
import { Button } from "../../components/ui/button";
import { RefreshCw, ShieldCheck, CalendarClock, IndianRupee, HardDrive, ListChecks } from "lucide-react";
import { toast } from "sonner";

function formatCycle(value) {
  return value === "yearly" ? "Yearly" : "Monthly";
}

export default function DealerPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/dealer/plans");
      setPlans(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div data-testid="dealer-plans-page">
      <PageHeader overline="Dealer / Plans" title="Available plans." subtitle="Review every subscription plan created by admin.">
        <Button onClick={load} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" disabled={loading} data-testid="reload-plans-btn">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {plans.length === 0 && !loading && (
          <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm bg-white">
            No plans available yet.
          </div>
        )}
        {plans.map((plan) => (
          <div key={plan.id} className="bg-white border border-[#E5E7EB] rounded-sm p-6 shadow-sm" data-testid={`dealer-plan-${plan.id}`}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <PlanBadge plan={plan.type} />
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E7EB] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                <ShieldCheck className="w-3.5 h-3.5" /> {formatCycle(plan.billing_cycle)}
              </div>
            </div>

            <div className="font-display text-2xl font-extrabold tracking-tight">{plan.name}</div>
            <div className="mt-3 flex items-baseline gap-2">
              <IndianRupee className="w-4 h-4 text-[#111827]" />
              <span className="font-display text-4xl font-extrabold tracking-tighter">{Number(plan.price || 0).toLocaleString()}</span>
              <span className="text-sm text-[#6B7280]">/ {plan.billing_cycle === "yearly" ? "yr" : "mo"}</span>
            </div>
            <div className="mt-2 text-xs text-[#6B7280]">
              Duration: <span className="font-semibold text-[#111827]">{Number(plan.duration_days || (plan.billing_cycle === "yearly" ? 365 : 30))} days</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-sm bg-[#F9FAFB] border border-[#E5E7EB] p-3">
                <div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Storage</div>
                <div className="mt-1 font-semibold flex items-center gap-2"><HardDrive className="w-4 h-4" /> {Number(plan.storage_limit_gb || 0)} GB</div>
              </div>
              <div className="rounded-sm bg-[#F9FAFB] border border-[#E5E7EB] p-3">
                <div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Cycle</div>
                <div className="mt-1 font-semibold flex items-center gap-2"><CalendarClock className="w-4 h-4" /> {formatCycle(plan.billing_cycle)}</div>
              </div>
            </div>

            {plan.description && <p className="mt-4 text-sm text-[#6B7280] leading-6">{plan.description}</p>}

            {Array.isArray(plan.features) && plan.features.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#E5E7EB]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">Features</div>
                <ul className="space-y-2 text-sm text-[#374151]">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <ListChecks className="w-4 h-4 mt-0.5 text-[#10B981] flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}