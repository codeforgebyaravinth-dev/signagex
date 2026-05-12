import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge from "../../components/PlanBadge";

const FALLBACK_THUMB = "https://images.unsplash.com/photo-1686362060774-1786ef7bf4db?w=400&q=80";

export default function ClientTemplates() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/client/templates").then((r) => setItems(r.data)).catch(() => {}); }, []);

  return (
    <div data-testid="client-templates-page">
      <PageHeader overline="Client / Templates" title="Your layouts." subtitle="Templates assigned by your dealer — pick one for each screen in Devices." />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm">
            No layouts available yet. Contact your dealer to get access to templates.
          </div>
        )}
        {items.map((t) => (
          <div key={t.id} className="dense-card bg-white border border-[#E5E7EB] rounded-sm overflow-hidden" data-testid={`ctpl-${t.id}`}>
            <div className="aspect-video bg-[#F3F4F6] overflow-hidden">
              <img src={t.thumbnail_url || FALLBACK_THUMB} alt={t.name} className="w-full h-full object-cover" onError={(e) => { e.target.src = FALLBACK_THUMB; }} />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <PlanBadge plan={t.plan} compact />
                <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">{t.category}</span>
              </div>
              <div className="font-display font-bold text-base text-[#111827] truncate">{t.name}</div>
              {t.layout && (t.layout.main || t.layout.sidebar || t.layout.ticker) && (
                <div className="mt-3 pt-3 border-t border-[#E5E7EB] grid grid-cols-3 gap-1 text-[10px] uppercase tracking-wider font-semibold text-[#6B7280]">
                  <div className="bg-[#F3F4F6] px-2 py-1 rounded-sm truncate" title={t.layout.main}>Main</div>
                  <div className="bg-[#F3F4F6] px-2 py-1 rounded-sm truncate" title={t.layout.sidebar}>Sidebar</div>
                  <div className="bg-[#F3F4F6] px-2 py-1 rounded-sm truncate" title={t.layout.ticker}>Ticker</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
