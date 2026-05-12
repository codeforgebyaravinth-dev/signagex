import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge, { PLANS } from "../../components/PlanBadge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Plus, Pencil, Trash2, Search, Grid2X2, Grid3X3, Columns2, X } from "lucide-react";
import { toast } from "sonner";

const FALLBACK_THUMB = "https://images.unsplash.com/photo-1686362060774-1786ef7bf4db?w=400&q=80";

const empty = {
  name: "", category: "", description: "", thumbnail_url: "", plan: "cloud", assigned_dealer_ids: [],
  layout: { zones: [], main: "", sidebar: "", ticker: "" },
};

const LAYOUT_PRESETS = [
  {
    name: "Single Zone",
    icon: Grid2X2,
    zones: [{ id: `zone-${Date.now()}`, name: "Main Screen", width: "100%", height: "100%", position: "" }],
  },
  {
    name: "2-Zone Horizontal",
    icon: Columns2,
    zones: [
      { id: `zone-${Date.now()}-1`, name: "Screen 1", width: "50%", height: "100%", position: "" },
      { id: `zone-${Date.now()}-2`, name: "Screen 2", width: "50%", height: "100%", position: "" },
    ],
  },
  {
    name: "4-Zone Grid",
    icon: Grid3X3,
    zones: [
      { id: `zone-${Date.now()}-1`, name: "Top Left", width: "50%", height: "50%", position: "" },
      { id: `zone-${Date.now()}-2`, name: "Top Right", width: "50%", height: "50%", position: "" },
      { id: `zone-${Date.now()}-3`, name: "Bottom Left", width: "50%", height: "50%", position: "" },
      { id: `zone-${Date.now()}-4`, name: "Bottom Right", width: "50%", height: "50%", position: "" },
    ],
  },
];

export default function AdminTemplates() {
  const [items, setItems] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");
  const [newZoneName, setNewZoneName] = useState("");

  const load = async () => {
    try {
      const [t, d] = await Promise.all([api.get("/admin/templates"), api.get("/admin/dealers")]);
      setItems(t.data); setDealers(d.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ ...empty, ...t, layout: { ...empty.layout, ...(t.layout || {}) } });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/admin/templates/${editing.id}`, form);
        toast.success("Template updated");
      } else {
        await api.post("/admin/templates", form);
        toast.success("Template created");
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this template?")) return;
    try { await api.delete(`/admin/templates/${id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const toggleDealer = (did) => {
    setForm((f) => {
      const has = f.assigned_dealer_ids.includes(did);
      return { ...f, assigned_dealer_ids: has ? f.assigned_dealer_ids.filter((x) => x !== did) : [...f.assigned_dealer_ids, did] };
    });
  };

  const applyPreset = (preset) => {
    const zones = preset.zones.map((z, idx) => ({ ...z, id: `zone-${Date.now()}-${idx}` }));
    setForm({ ...form, layout: { ...form.layout, zones } });
    toast.success(`Applied "${preset.name}" layout`);
  };

  const addZone = () => {
    if (!newZoneName.trim()) { toast.error("Zone name required"); return; }
    const zones = (form.layout?.zones || []);
    if (zones.find((z) => z.name.toLowerCase() === newZoneName.toLowerCase())) {
      toast.error("Zone name must be unique");
      return;
    }
    const newZone = { id: `zone-${Date.now()}`, name: newZoneName.trim(), width: "", height: "", position: "" };
    setForm({ ...form, layout: { ...form.layout, zones: [...zones, newZone] } });
    setNewZoneName("");
    toast.success("Zone added");
  };

  const updateZone = (zoneId, field, value) => {
    const zones = form.layout?.zones || [];
    const idx = zones.findIndex((z) => z.id === zoneId);
    if (idx >= 0) {
      const updated = [...zones];
      updated[idx] = { ...updated[idx], [field]: value };
      setForm({ ...form, layout: { ...form.layout, zones: updated } });
    }
  };

  const removeZone = (zoneId) => {
    const zones = (form.layout?.zones || []).filter((z) => z.id !== zoneId);
    setForm({ ...form, layout: { ...form.layout, zones } });
    toast.success("Zone removed");
  };

  const renderZonePreview = () => {
    const zones = form.layout?.zones || [];
    if (!zones.length) return null;

    const isGrid = zones.length === 4;
    const is2Col = zones.length === 2;

    if (isGrid) {
      return (
        <div className="grid grid-cols-2 gap-2 h-40 bg-[#F3F4F6] rounded-sm p-2 border border-[#E5E7EB]">
          {zones.map((z) => (
            <div key={z.id} className="bg-white border-2 border-[#111827] rounded-sm flex items-center justify-center text-[9px] font-bold text-center p-2 text-[#6B7280]">
              {z.name}
            </div>
          ))}
        </div>
      );
    } else if (is2Col) {
      return (
        <div className="flex gap-2 h-32 bg-[#F3F4F6] rounded-sm p-2 border border-[#E5E7EB]">
          {zones.map((z) => (
            <div key={z.id} className="flex-1 bg-white border-2 border-[#111827] rounded-sm flex items-center justify-center text-xs font-bold text-center p-2 text-[#6B7280]">
              {z.name}
            </div>
          ))}
        </div>
      );
    } else {
      return (
        <div className="w-full h-24 bg-white border-2 border-[#111827] rounded-sm flex items-center justify-center text-sm font-bold text-[#6B7280]">
          {zones[0]?.name || "Main"}
        </div>
      );
    }
  };

  const filtered = items.filter((t) => !search || `${t.name} ${t.category}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div data-testid="admin-templates-page">
      <PageHeader overline="Admin / Templates" title="Signage templates." subtitle="Manage templates and assign them to dealers.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-template-btn">
          <Plus className="w-4 h-4 mr-2" /> New Template
        </Button>
      </PageHeader>

      <div className="relative max-w-md mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates..."
          className="pl-9 rounded-sm border-[#E5E7EB]" data-testid="search-template" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm">
            No templates yet. Click "New Template" to create one.
          </div>
        )}
        {filtered.map((t) => (
          <div key={t.id} className="dense-card bg-white border border-[#E5E7EB] rounded-sm overflow-hidden" data-testid={`template-card-${t.id}`}>
            <div className="aspect-video bg-[#F3F4F6] overflow-hidden">
              <img
                src={t.thumbnail_url || FALLBACK_THUMB} alt={t.name}
                className="w-full h-full object-cover"
                onError={(e) => { e.target.src = FALLBACK_THUMB; }}
              />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between mb-2">
                <PlanBadge plan={t.plan} compact />
                <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">{t.assigned_dealer_ids?.length || 0} dealers</span>
              </div>
              <div className="font-display font-bold text-base text-[#111827] truncate">{t.name}</div>
              <div className="text-xs text-[#6B7280] mb-3">{t.category}</div>
              {t.description && <p className="text-xs text-[#6B7280] line-clamp-2 mb-3">{t.description}</p>}
              <div className="flex gap-2 pt-3 border-t border-[#E5E7EB]">
                <Button variant="outline" size="sm" className="flex-1 rounded-sm" onClick={() => openEdit(t)} data-testid={`edit-template-${t.id}`}>
                  <Pencil className="w-3 h-3 mr-1" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="rounded-sm text-red-600 hover:text-red-700" onClick={() => remove(t.id)} data-testid={`delete-template-${t.id}`}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="template-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {editing ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g., Restaurant 2-Screen" className="rounded-sm" data-testid="template-name" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Category *</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required placeholder="Restaurant, Retail, Bank..." className="rounded-sm" data-testid="template-category" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Plan</Label>
                <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                  <SelectTrigger className="rounded-sm" data-testid="template-plan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Thumbnail URL</Label>
                <Input value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} placeholder="https://..." className="rounded-sm" data-testid="template-thumb" />
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm" rows={2} placeholder="What will this template display?" data-testid="template-description" />
            </div>

            {/* LAYOUT BUILDER */}
            <div className="border-2 border-[#111827] rounded-sm p-4 bg-[#F9FAFB]">
              <div className="text-sm font-bold uppercase tracking-widest text-[#111827] mb-4">📐 Design Your Layout</div>

              {/* Step 1: Choose a preset */}
              <div className="mb-6">
                <p className="text-xs font-semibold text-[#6B7280] mb-3">Step 1: Pick a layout type</p>
                <div className="grid grid-cols-3 gap-3">
                  {LAYOUT_PRESETS.map((preset, idx) => {
                    const Icon = preset.icon;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="flex flex-col items-center gap-2 p-3 border-2 border-[#E5E7EB] rounded-sm hover:border-[#111827] hover:bg-[#F3F4F6] transition"
                        data-testid={`layout-preset-${idx}`}
                      >
                        <Icon className="w-6 h-6 text-[#111827]" />
                        <span className="text-[10px] font-bold text-[#6B7280] text-center">{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Live preview */}
              {(form.layout?.zones || []).length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-semibold text-[#6B7280] mb-3">Step 2: Preview</p>
                  {renderZonePreview()}
                </div>
              )}

              {/* Step 3: Customize zone names */}
              {(form.layout?.zones || []).length > 0 && (
                <div className="mb-6 p-3 bg-white rounded-sm border border-[#E5E7EB]">
                  <p className="text-xs font-semibold text-[#6B7280] mb-3">Step 3: Name your zones</p>
                  <div className="space-y-2">
                    {form.layout.zones.map((zone, idx) => (
                      <div key={zone.id} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#9CA3AF] min-w-6">Zone {idx + 1}:</span>
                        <Input
                          value={zone.name}
                          onChange={(e) => updateZone(zone.id, "name", e.target.value)}
                          placeholder={`e.g., Main Screen, Sidebar, Info Panel...`}
                          className="rounded-sm text-xs flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeZone(zone.id)}
                          className="p-1.5 hover:bg-red-50 rounded-sm text-red-600"
                          title="Remove this zone"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add custom zone */}
              <div className="flex gap-2">
                <Input
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addZone()}
                  placeholder="Or add a custom zone..."
                  className="rounded-sm text-xs flex-1"
                  data-testid="new-zone-name"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={addZone}
                  className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white"
                  data-testid="add-zone-btn"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Assign to dealers */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280] mb-2 block">Assign to dealers</Label>
              <div className="border border-[#E5E7EB] rounded-sm max-h-40 overflow-y-auto p-2 space-y-1">
                {dealers.length === 0 && <p className="text-xs text-[#9CA3AF] p-2">No dealers yet.</p>}
                {dealers.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#F9FAFB] rounded-sm cursor-pointer">
                    <Checkbox
                      checked={form.assigned_dealer_ids.includes(d.id)}
                      onCheckedChange={() => toggleDealer(d.id)}
                      data-testid={`assign-dealer-${d.id}`}
                    />
                    <span className="text-sm">{d.name}</span>
                    <span className="text-xs text-[#9CA3AF]">· {d.email}</span>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="template-submit">
                {editing ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
