import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Pencil, Trash2, Monitor, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";

export default function DealerScreens() {
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("all");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", location: "", template_id: "" });

  const load = async () => {
    try {
      const [d, c, t] = await Promise.all([api.get("/dealer/devices"), api.get("/dealer/clients"), api.get("/dealer/templates")]);
      setItems(d.data); setClients(c.data); setTemplates(t.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const clientTemplates = (clientId) => {
    const c = clients.find((cc) => cc.id === clientId);
    const ids = c?.assigned_template_ids || [];
    return templates.filter((t) => ids.includes(t.id));
  };

  const openEdit = (d) => { setEditing(d); setForm({ name: d.name, location: d.location || "", template_id: d.template_id || "" }); };

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/dealer/devices/${editing.id}`, { ...form, template_id: form.template_id || null });
      toast.success("Screen updated"); setEditing(null); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Remove this screen?")) return;
    try { await api.delete(`/dealer/devices/${id}`); toast.success("Screen removed"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const tplName = (id) => templates.find((t) => t.id === id)?.name || "—";

  const filtered = items.filter((d) => {
    const cm = filterClient === "all" || d.client_id === filterClient;
    const sm = !search || `${d.name} ${d.location} ${d.client_name} ${d.pair_code}`.toLowerCase().includes(search.toLowerCase());
    return cm && sm;
  });

  return (
    <div data-testid="dealer-screens-page">
      <PageHeader overline="Dealer / Screens" title="Client screens." subtitle="All signage screens registered by your clients. Edit name, location and assigned template." />

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search screens..." className="pl-9 rounded-sm border-[#E5E7EB]" data-testid="search-screen" />
        </div>
        <Select value={filterClient} onValueChange={setFilterClient}>
          <SelectTrigger className="w-56 rounded-sm border-[#E5E7EB]" data-testid="filter-client"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Screen</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Client</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Pair Code</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Template</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-[#6B7280]">No screens.</TableCell></TableRow>}
            {filtered.map((d) => (
              <TableRow key={d.id} data-testid={`screen-row-${d.id}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-[#6B7280]" />
                    <div>
                      <div className="font-semibold">{d.name}</div>
                      {d.location && <div className="text-xs text-[#6B7280]">{d.location}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{d.client_name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{d.pair_code}</TableCell>
                <TableCell className="text-sm">{tplName(d.template_id)}</TableCell>
                <TableCell><span className="text-[11px] uppercase tracking-wider font-semibold">{d.status}</span></TableCell>
                <TableCell className="text-right">
                  <a href={`/play/${d.pair_code}`} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs px-2 py-1 border border-[#E5E7EB] rounded-sm hover:bg-[#F3F4F6] mr-1" data-testid={`open-player-${d.id}`}>
                    <ExternalLink className="w-3 h-3 mr-1" /> Player
                  </a>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(d)} data-testid={`edit-screen-${d.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(d.id)} className="text-red-600" data-testid={`delete-screen-${d.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="rounded-sm max-w-md" data-testid="screen-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">Edit Screen</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="scr-name" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="rounded-sm" data-testid="scr-location" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Template</Label>
              <Select value={form.template_id || "none"} onValueChange={(v) => setForm({ ...form, template_id: v === "none" ? "" : v })}>
                <SelectTrigger className="rounded-sm" data-testid="scr-template"><SelectValue placeholder="No template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {clientTemplates(editing?.client_id).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="scr-save">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
