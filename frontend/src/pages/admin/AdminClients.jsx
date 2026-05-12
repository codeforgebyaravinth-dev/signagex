import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge, { PLANS } from "../../components/PlanBadge";
import StatusBadge from "../../components/StatusBadge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Search, MoreVertical, Pause, Play, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [moveOpen, setMoveOpen] = useState(null);
  const [newDealer, setNewDealer] = useState("");

  const load = async () => {
    try {
      const [c, d] = await Promise.all([api.get("/admin/clients"), api.get("/admin/dealers")]);
      setClients(c.data); setDealers(d.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const setStatus = async (c, status) => {
    try { await api.put(`/admin/clients/${c.id}/status`, { status }); toast.success(`Status: ${status}`); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const move = async () => {
    try { await api.put(`/admin/clients/${moveOpen.id}/move`, { new_dealer_id: newDealer }); toast.success("Client moved"); setMoveOpen(null); setNewDealer(""); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const filtered = clients.filter((c) => {
    const m = filter === "all" || c.plan === filter;
    const s = !search || `${c.name} ${c.email} ${c.gst_number} ${c.dealer_name}`.toLowerCase().includes(search.toLowerCase());
    return m && s;
  });

  return (
    <div data-testid="admin-clients-page">
      <PageHeader overline="Admin / Clients" title="All clients." subtitle="View every client. Suspend, activate or move them between dealers." />

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." className="pl-9 rounded-sm border-[#E5E7EB]" data-testid="search-client" />
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
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Dealer</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">GST</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Plan</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Wallet</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-[#6B7280]">No clients found.</TableCell></TableRow>}
            {filtered.map((c) => (
              <TableRow key={c.id} data-testid={`admin-client-row-${c.id}`}>
                <TableCell>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-[#6B7280]">{c.email}</div>
                </TableCell>
                <TableCell className="text-sm">{c.dealer_name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{c.gst_number || "—"}</TableCell>
                <TableCell><PlanBadge plan={c.plan} /></TableCell>
                <TableCell><StatusBadge status={c.status} /></TableCell>
                <TableCell className="text-right font-mono">₹ {Number(c.wallet_balance || 0).toLocaleString()}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid={`client-menu-${c.id}`}><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-sm">
                      {c.status === "active" ? (
                        <DropdownMenuItem onClick={() => setStatus(c, "suspended")} data-testid={`suspend-${c.id}`}><Pause className="w-3.5 h-3.5 mr-2" />Suspend</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setStatus(c, "active")} data-testid={`activate-${c.id}`}><Play className="w-3.5 h-3.5 mr-2" />Activate</DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => { setMoveOpen(c); setNewDealer(""); }} data-testid={`move-${c.id}`}><ArrowRightLeft className="w-3.5 h-3.5 mr-2" />Move to dealer</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!moveOpen} onOpenChange={(o) => !o && setMoveOpen(null)}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">Move client</DialogTitle></DialogHeader>
          <p className="text-sm text-[#6B7280]">Move <strong>{moveOpen?.name}</strong> from <strong>{moveOpen?.dealer_name}</strong> to another dealer. Assigned templates will be cleared.</p>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">New dealer</Label>
            <Select value={newDealer} onValueChange={setNewDealer}>
              <SelectTrigger className="rounded-sm" data-testid="new-dealer-select"><SelectValue placeholder="Select dealer" /></SelectTrigger>
              <SelectContent>
                {dealers.filter((d) => d.id !== moveOpen?.dealer_id).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(null)} className="rounded-sm">Cancel</Button>
            <Button onClick={move} disabled={!newDealer} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="move-submit">Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
