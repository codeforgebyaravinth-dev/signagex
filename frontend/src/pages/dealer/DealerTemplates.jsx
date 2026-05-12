import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge from "../../components/PlanBadge";
import { Input } from "../../components/ui/input";
import { Search } from "lucide-react";

const FALLBACK_THUMB = "https://images.unsplash.com/photo-1686362060774-1786ef7bf4db?w=400&q=80";

export default function DealerTemplates() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/dealer/templates").then((r) => setItems(r.data)).catch(() => {});
  }, []);

  const filtered = items.filter((t) => !search || `${t.name} ${t.category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div data-testid="dealer-templates-page">
      <PageHeader overline="Dealer / Templates" title="Available templates." subtitle="Signage templates assigned to you by admin." />

      <div className="relative max-w-md mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..."
          className="pl-9 rounded-sm border-[#E5E7EB]" data-testid="search-template" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm">
            No templates assigned to you yet. Contact admin to get access.
          </div>
        )}
        {filtered.map((t) => (
          <div key={t.id} className="dense-card bg-white border border-[#E5E7EB] rounded-sm overflow-hidden" data-testid={`tpl-${t.id}`}>
            <div className="aspect-video bg-[#F3F4F6] overflow-hidden">
              <img src={t.thumbnail_url || FALLBACK_THUMB} alt={t.name} className="w-full h-full object-cover"
                onError={(e) => { e.target.src = FALLBACK_THUMB; }} />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <PlanBadge plan={t.plan} compact />
                <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">{t.category}</span>
              </div>
              <div className="font-display font-bold text-base text-[#111827] truncate">{t.name}</div>
              {t.description && <p className="text-xs text-[#6B7280] line-clamp-2 mt-1">{t.description}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
