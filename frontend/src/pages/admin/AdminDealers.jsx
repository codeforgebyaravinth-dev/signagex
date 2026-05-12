import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge, { PLANS } from "../../components/PlanBadge";
import StatusBadge from "../../components/StatusBadge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Plus, MoreVertical, Pencil, Trash2, Wallet, Search, Pause, Play } from "lucide-react";
import { toast } from "sonner";

const empty = {
  name: "", email: "", password: "", gst_number: "", address: "", phone: "",
  plan: "cloud", wallet_balance: 0,
};

export default function AdminDealers() {
  const [dealers, setDealers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [creditOpen, setCreditOpen] = useState(null);
  const [creditAmt, setCreditAmt] = useState("");

  const load = async () => {
    try { const { data } = await api.get("/admin/dealers"); setDealers(data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (d) => {
    setEditing(d);
    setForm({ ...empty, ...d, password: "" });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        delete payload.email;
        delete payload.wallet_balance;
        await api.put(`/admin/dealers/${editing.id}`, payload);
        toast.success("Dealer updated");
      } else {
        await api.post("/admin/dealers", form);
        toast.success("Dealer created");
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this dealer and all their clients?")) return;
    try { await api.delete(`/admin/dealers/${id}`); toast.success("Dealer deleted"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const credit = async () => {
    try {
      await api.post(`/admin/dealers/${creditOpen.id}/credit`, { amount: parseFloat(creditAmt) });
      toast.success(`₹${creditAmt} credited to ${creditOpen.name}`);
      setCreditOpen(null); setCreditAmt(""); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const setStatus = async (d, status) => {
    try {
      await api.put(`/admin/dealers/${d.id}/status`, { status });
      toast.success(status === "active" ? "Dealer activated" : status === "suspended" ? "Dealer suspended" : "Status updated");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const filtered = dealers.filter((d) => {
    const m = filter === "all" || d.plan === filter;
    const s = !search || `${d.name} ${d.email} ${d.gst_number}`.toLowerCase().includes(search.toLowerCase());
    return m && s;
  });

  return (
    <div data-testid="admin-dealers-page">
      <PageHeader overline="Admin / Dealers" title="Dealer accounts." subtitle="Create dealers, set plans and manage wallet balances.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-dealer-btn">
          <Plus className="w-4 h-4 mr-2" /> New Dealer
        </Button>
      </PageHeader>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <Input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, GST..."
            className="pl-9 rounded-sm border-[#E5E7EB]"
            data-testid="search-dealer"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-44 rounded-sm border-[#E5E7EB]" data-testid="filter-plan">
            <SelectValue placeholder="All plans" />
          </SelectTrigger>
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
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Dealer</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">GST</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Plan</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Wallet</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-[#6B7280]">No dealers found.</TableCell></TableRow>
            )}
            {filtered.map((d) => (
              <TableRow key={d.id} data-testid={`dealer-row-${d.id}`}>
                <TableCell>
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-xs text-[#6B7280]">{d.email}</div>
                  {d.address && <div className="text-xs text-[#9CA3AF] mt-1">{d.address}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">{d.gst_number || "—"}</TableCell>
                <TableCell><PlanBadge plan={d.plan} /></TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
                <TableCell className="text-right font-mono">₹ {Number(d.wallet_balance || 0).toLocaleString()}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" data-testid={`dealer-menu-${d.id}`}>
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-sm">
                      <DropdownMenuItem onClick={() => openEdit(d)} data-testid={`edit-dealer-${d.id}`}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setCreditOpen(d); setCreditAmt(""); }} data-testid={`credit-dealer-${d.id}`}>
                        <Wallet className="w-3.5 h-3.5 mr-2" /> Credit Wallet
                      </DropdownMenuItem>
                      {d.status === "active" ? (
                        <DropdownMenuItem onClick={() => setStatus(d, "suspended")} data-testid={`suspend-dealer-${d.id}`}>
                          <Pause className="w-3.5 h-3.5 mr-2" /> Suspend
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setStatus(d, "active")} data-testid={`activate-dealer-${d.id}`}>
                          <Play className="w-3.5 h-3.5 mr-2" /> Activate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => remove(d.id)} className="text-red-600" data-testid={`delete-dealer-${d.id}`}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg" data-testid="dealer-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {editing ? "Edit Dealer" : "New Dealer"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="dealer-name" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={!!editing} className="rounded-sm" data-testid="dealer-email" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Password {editing && "(leave blank to keep)"}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} className="rounded-sm" data-testid="dealer-password" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">GST Number</Label>
              <Input value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} className="rounded-sm font-mono" data-testid="dealer-gst" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-sm" data-testid="dealer-phone" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Address</Label>
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-sm" data-testid="dealer-address" rows={2} />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Plan</Label>
              <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                <SelectTrigger className="rounded-sm" data-testid="dealer-plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!editing && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Initial Wallet ₹</Label>
                <Input type="number" min="0" value={form.wallet_balance} onChange={(e) => setForm({ ...form, wallet_balance: parseFloat(e.target.value || 0) })} className="rounded-sm" data-testid="dealer-wallet" />
              </div>
            )}
            <DialogFooter className="col-span-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="dealer-submit">
                {editing ? "Save Changes" : "Create Dealer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!creditOpen} onOpenChange={(o) => !o && setCreditOpen(null)}>
        <DialogContent className="rounded-sm max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold tracking-tight">Credit Wallet</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#6B7280]">Add funds to <strong>{creditOpen?.name}</strong>'s wallet. Current balance: ₹ {Number(creditOpen?.wallet_balance || 0).toLocaleString()}</p>
          <Input type="number" min="1" placeholder="Amount in ₹" value={creditAmt} onChange={(e) => setCreditAmt(e.target.value)} className="rounded-sm" data-testid="credit-amount" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={credit} disabled={!creditAmt} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="credit-submit">Credit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
