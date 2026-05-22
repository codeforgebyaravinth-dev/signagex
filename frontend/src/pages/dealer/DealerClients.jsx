import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge, { PLANS } from "../../components/PlanBadge";
import StatusBadge from "../../components/StatusBadge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Plus, MoreVertical, Pencil, Trash2, Wallet, Search, FileVideo, Pause, Play } from "lucide-react";
import { toast } from "sonner";

const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

function isValidPhone(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const extMatch = text.match(/(?:\s*(?:ext\.?|x)\s*(\d{1,6}))$/i);
  const base = extMatch ? text.slice(0, extMatch.index).trim() : text;
  if (/[A-Za-z]/.test(base)) return false;
  const digits = base.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isValidGst(value) {
  const text = String(value || "").trim().toUpperCase();
  return !text || GST_RE.test(text);
}

const empty = {
  name: "", email: "", password: "", phone: "", gst_number: "", address: "",
  plan: "cloud", vertical: "general", wallet_balance: 0, assigned_template_ids: [],
};

const VERTICALS = [
  { value: "general", label: "General signage" },
  { value: "doctor", label: "Doctor / Clinic" },
  { value: "salon", label: "Salon / Spa" },
  { value: "retailer", label: "Retailer" },
  { value: "society", label: "Society / Apartment" },
];

export default function DealerClients() {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [creditOpen, setCreditOpen] = useState(null);
  const [creditAmt, setCreditAmt] = useState("");
  const [assignOpen, setAssignOpen] = useState(null);
  const [assignIds, setAssignIds] = useState([]);
  const [errors, setErrors] = useState({});

  const load = async () => {
    try {
      const [c, t] = await Promise.all([api.get("/dealer/clients"), api.get("/dealer/templates")]);
      setItems(c.data); setTemplates(t.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({ ...empty, ...c, password: "" });
    setOpen(true);
  };
  const openAssign = (c) => { setAssignOpen(c); setAssignIds(c.assigned_template_ids || []); };

  const submit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!isValidGst(form.gst_number)) nextErrors.gst_number = "Use a valid 15-character GST number, like 29ABCDE1234F1Z5.";
    if (!isValidPhone(form.phone)) nextErrors.phone = "Phone must be 10-15 digits, with optional ext 123.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    try {
      if (editing) {
        const payload = { ...form };
        delete payload.wallet_balance;
        if (!payload.password) delete payload.password;
        delete payload.email;
        await api.put(`/dealer/clients/${editing.id}`, payload);
        toast.success("Client updated");
      } else {
        await api.post("/dealer/clients", form);
        toast.success("Client created");
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this client?")) return;
    try { await api.delete(`/dealer/clients/${id}`); toast.success("Client deleted"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const credit = async () => {
    try {
      await api.post(`/dealer/clients/${creditOpen.id}/credit`, { amount: parseFloat(creditAmt) });
      toast.success(`₹${creditAmt} credited`);
      setCreditOpen(null); setCreditAmt(""); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const saveAssign = async () => {
    try {
      await api.put(`/dealer/clients/${assignOpen.id}`, { assigned_template_ids: assignIds });
      toast.success("Templates assigned");
      setAssignOpen(null); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const setStatus = async (c, status) => {
    try { await api.put(`/dealer/clients/${c.id}`, { status }); toast.success(`Status: ${status}`); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const toggleTemplate = (id) => {
    setForm((f) => {
      const has = f.assigned_template_ids.includes(id);
      return { ...f, assigned_template_ids: has ? f.assigned_template_ids.filter((x) => x !== id) : [...f.assigned_template_ids, id] };
    });
  };

  const toggleAssignId = (id) => {
    setAssignIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  };

  const filtered = items.filter((c) => {
    const m = filter === "all" || c.plan === filter;
    const s = !search || `${c.name} ${c.email} ${c.gst_number}`.toLowerCase().includes(search.toLowerCase());
    return m && s;
  });

  return (
    <div data-testid="dealer-clients-page">
      <PageHeader overline="Dealer / Clients" title="Manage clients." subtitle="Create clients, assign templates and credit wallet from your balance.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-client-btn">
          <Plus className="w-4 h-4 mr-2" /> New Client
        </Button>
      </PageHeader>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..."
            className="pl-9 rounded-sm border-[#E5E7EB]" data-testid="search-client" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44 rounded-sm border-[#E5E7EB]" data-testid="filter-client-plan"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Client</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">GST</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Plan</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-center">Templates</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Wallet</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-[#6B7280]">No clients yet.</TableCell></TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.id} data-testid={`client-row-${c.id}`}>
                <TableCell>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-[#6B7280]">{c.email}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.gst_number || "—"}</TableCell>
                <TableCell><PlanBadge plan={c.plan} /></TableCell>
                <TableCell><StatusBadge status={c.status} /></TableCell>
                <TableCell className="text-center font-mono text-sm">{c.assigned_template_ids?.length || 0}</TableCell>
                <TableCell className="text-right font-mono">₹ {Number(c.wallet_balance || 0).toLocaleString()}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" data-testid={`client-menu-${c.id}`}>
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-sm">
                      <DropdownMenuItem onClick={() => openEdit(c)} data-testid={`edit-client-${c.id}`}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openAssign(c)} data-testid={`assign-templates-${c.id}`}>
                        <FileVideo className="w-3.5 h-3.5 mr-2" /> Assign Templates
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setCreditOpen(c); setCreditAmt(""); }} data-testid={`credit-client-${c.id}`}>
                        <Wallet className="w-3.5 h-3.5 mr-2" /> Credit Wallet
                      </DropdownMenuItem>
                      {c.status === "active" ? (
                        <DropdownMenuItem onClick={() => setStatus(c, "suspended")} data-testid={`suspend-client-${c.id}`}>
                          <Pause className="w-3.5 h-3.5 mr-2" /> Suspend
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setStatus(c, "active")} data-testid={`activate-client-${c.id}`}>
                          <Play className="w-3.5 h-3.5 mr-2" /> Activate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => remove(c.id)} className="text-red-600" data-testid={`delete-client-${c.id}`}>
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Client */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg max-h-[90vh] overflow-y-auto" data-testid="client-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {editing ? "Edit Client" : "New Client"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="client-name" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={!!editing} className="rounded-sm" data-testid="client-email" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Mobile</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                onBlur={() => setErrors((prev) => ({ ...prev, phone: isValidPhone(form.phone) ? "" : "Phone must be 10-15 digits, with optional ext 123." }))}
                className="rounded-sm"
                data-testid="client-phone"
                placeholder="+91 9876543210 ext 123"
                inputMode="tel"
              />
              {errors.phone && <div className="mt-1 text-xs text-red-600">{errors.phone}</div>}
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Password {editing && "(leave blank to keep)"}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} className="rounded-sm" data-testid="client-password" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">GST Number</Label>
              <Input
                value={form.gst_number}
                onChange={(e) => setForm({ ...form, gst_number: e.target.value.toUpperCase() })}
                onBlur={() => setErrors((prev) => ({ ...prev, gst_number: isValidGst(form.gst_number) ? "" : "Use a valid 15-character GST number, like 29ABCDE1234F1Z5." }))}
                className="rounded-sm font-mono"
                data-testid="client-gst"
                placeholder="29ABCDE1234F1Z5"
                maxLength={15}
              />
              {errors.gst_number && <div className="mt-1 text-xs text-red-600">{errors.gst_number}</div>}
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Plan</Label>
              <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                <SelectTrigger className="rounded-sm" data-testid="client-plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Business vertical</Label>
              <Select value={form.vertical} onValueChange={(v) => setForm({ ...form, vertical: v })}>
                <SelectTrigger className="rounded-sm" data-testid="client-vertical"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VERTICALS.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Address</Label>
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-sm" rows={2} data-testid="client-address" />
            </div>
            {!editing && (
              <div className="col-span-2">
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Initial Wallet ₹</Label>
                <Input type="number" min="0" value={form.wallet_balance} onChange={(e) => setForm({ ...form, wallet_balance: parseFloat(e.target.value || 0) })} className="rounded-sm" data-testid="client-wallet" />
              </div>
            )}
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280] mb-2 block">Assign templates</Label>
              <div className="border border-[#E5E7EB] rounded-sm max-h-40 overflow-y-auto p-2 space-y-1">
                {templates.length === 0 && <p className="text-xs text-[#9CA3AF] p-2">No templates assigned to you by admin yet.</p>}
                {templates.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#F9FAFB] rounded-sm cursor-pointer">
                    <Checkbox checked={form.assigned_template_ids.includes(t.id)} onCheckedChange={() => toggleTemplate(t.id)} data-testid={`form-assign-tpl-${t.id}`} />
                    <span className="text-sm flex-1">{t.name}</span>
                    <PlanBadge plan={t.plan} compact />
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter className="col-span-2 mt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="client-submit">
                {editing ? "Save" : "Create Client"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credit */}
      <Dialog open={!!creditOpen} onOpenChange={(o) => !o && setCreditOpen(null)}>
        <DialogContent className="rounded-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold tracking-tight">Credit Client Wallet</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#6B7280]">Transfer funds from your wallet to <strong>{creditOpen?.name}</strong>.</p>
          <Input type="number" min="1" placeholder="Amount in ₹" value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} className="rounded-sm" data-testid="credit-amount" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={credit} disabled={!creditAmt} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="credit-submit">Credit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign templates */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold tracking-tight">Assign Templates</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#6B7280]">Select templates for <strong>{assignOpen?.name}</strong>.</p>
          <div className="border border-[#E5E7EB] rounded-sm max-h-64 overflow-y-auto p-2 space-y-1">
            {templates.length === 0 && <p className="text-xs text-[#9CA3AF] p-2">No templates available.</p>}
            {templates.map((t) => (
              <label key={t.id} className="flex items-center gap-2 px-2 py-2 hover:bg-[#F9FAFB] rounded-sm cursor-pointer">
                <Checkbox checked={assignIds.includes(t.id)} onCheckedChange={() => toggleAssignId(t.id)} data-testid={`assign-tpl-${t.id}`} />
                <span className="text-sm flex-1">{t.name}</span>
                <PlanBadge plan={t.plan} compact />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={saveAssign} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="assign-save">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
