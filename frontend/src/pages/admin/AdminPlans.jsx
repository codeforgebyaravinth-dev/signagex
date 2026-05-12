import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge, { PLANS } from "../../components/PlanBadge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Plus, Pencil, Trash2, IndianRupee, Check } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", type: "cloud", price: 0, description: "", features: [] };

export default function AdminPlans() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [featInput, setFeatInput] = useState("");

  const load = async () => {
    try { const { data } = await api.get("/admin/plans"); setItems(data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...empty, ...p }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/admin/plans/${editing.id}`, form); toast.success("Plan updated"); }
      else { await api.post("/admin/plans", form); toast.success("Plan created"); }
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this plan?")) return;
    try { await api.delete(`/admin/plans/${id}`); toast.success("Plan deleted"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const addFeature = () => {
    if (!featInput.trim()) return;
    setForm((f) => ({ ...f, features: [...f.features, featInput.trim()] }));
    setFeatInput("");
  };

  return (
    <div data-testid="admin-plans-page">
      <PageHeader overline="Admin / Plans" title="Subscription plans." subtitle="Define pricing tiers for Cloud, USB and Hybrid signage.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-plan-btn">
          <Plus className="w-4 h-4 mr-2" /> New Plan
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm">
            No plans yet. Create one to start assigning to dealers.
          </div>
        )}
        {items.map((p) => (
          <div key={p.id} className="dense-card bg-white border border-[#E5E7EB] rounded-sm p-6" data-testid={`plan-card-${p.id}`}>
            <div className="flex items-start justify-between mb-4">
              <PlanBadge plan={p.type} />
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(p)} data-testid={`edit-plan-${p.id}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(p.id)} className="text-red-600" data-testid={`delete-plan-${p.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="font-display text-2xl font-extrabold tracking-tighter">{p.name}</div>
            <div className="flex items-baseline gap-1 mt-2 mb-4">
              <IndianRupee className="w-5 h-5 text-[#111827]" />
              <span className="font-display text-4xl font-extrabold tracking-tighter">{p.price?.toLocaleString?.()}</span>
              <span className="text-sm text-[#6B7280]">/ mo</span>
            </div>
            {p.description && <p className="text-sm text-[#6B7280] mb-4">{p.description}</p>}
            {p.features?.length > 0 && (
              <ul className="space-y-1.5 pt-4 border-t border-[#E5E7EB]">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#374151]">
                    <Check className="w-3.5 h-3.5 mt-0.5 text-[#10B981] flex-shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg max-h-[90vh] overflow-y-auto" data-testid="plan-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editing ? "Edit Plan" : "New Plan"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="plan-name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="rounded-sm" data-testid="plan-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Price (₹)</Label>
                <Input type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value || 0) })} className="rounded-sm" data-testid="plan-price" />
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm" rows={2} data-testid="plan-description" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Features</Label>
              <div className="flex gap-2">
                <Input value={featInput} onChange={(e) => setFeatInput(e.target.value)} placeholder="Add a feature..." className="rounded-sm" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addFeature())} data-testid="plan-feat-input" />
                <Button type="button" onClick={addFeature} variant="outline" className="rounded-sm">Add</Button>
              </div>
              {form.features?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {form.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm px-2 py-1 bg-[#F9FAFB] rounded-sm">
                      <Check className="w-3 h-3 text-[#10B981]" />
                      <span className="flex-1">{f}</span>
                      <button type="button" onClick={() => setForm((s) => ({ ...s, features: s.features.filter((_, idx) => idx !== i) }))} className="text-red-600 text-xs">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="plan-submit">{editing ? "Save" : "Create Plan"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
