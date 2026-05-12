import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Plus, MoreVertical, Pencil, Trash2, Monitor, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";

const empty = { name: "", location: "", pair_code: "", template_id: "" };

export default function ClientDevices() {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    try {
      const [d, t] = await Promise.all([api.get("/client/devices"), api.get("/client/templates")]);
      setItems(d.data); setTemplates(t.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (d) => { setEditing(d); setForm({ ...empty, ...d, template_id: d.template_id || "" }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, template_id: form.template_id || null };
      if (editing) await api.put(`/client/devices/${editing.id}`, payload);
      else await api.post("/client/devices", payload);
      toast.success(editing ? "Device updated" : "Device added");
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Remove this device?")) return;
    try { await api.delete(`/client/devices/${id}`); toast.success("Device removed"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const tplName = (id) => templates.find((t) => t.id === id)?.name || "—";

  return (
    <div data-testid="client-devices-page">
      <PageHeader overline="Client / Devices" title="Signage screens." subtitle="Pair your screens and assign a template to each.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-device-btn">
          <Plus className="w-4 h-4 mr-2" /> Pair Screen
        </Button>
      </PageHeader>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Device</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Pair Code</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Template</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No devices yet.</TableCell></TableRow>}
            {items.map((d) => (
              <TableRow key={d.id} data-testid={`device-row-${d.id}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-[#6B7280]" />
                    <div>
                      <div className="font-semibold">{d.name}</div>
                      {d.location && <div className="text-xs text-[#6B7280]">{d.location}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <span>{d.pair_code}</span>
                    <button onClick={() => { navigator.clipboard.writeText(d.pair_code); toast.success("Pair code copied"); }} className="text-[#6B7280] hover:text-[#111827]" data-testid={`copy-pair-${d.id}`}><Copy className="w-3 h-3" /></button>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{tplName(d.template_id)}</TableCell>
                <TableCell><span className="text-[11px] uppercase tracking-wider font-semibold text-[#374151]">{d.status}</span></TableCell>
                <TableCell>
                  <a href={`/play/${d.pair_code}`} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs px-2 py-1 border border-[#E5E7EB] rounded-sm hover:bg-[#F3F4F6] mr-1" data-testid={`open-player-${d.id}`}>
                    <ExternalLink className="w-3 h-3 mr-1" /> Player
                  </a>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-sm">
                      <DropdownMenuItem onClick={() => openEdit(d)} data-testid={`edit-device-${d.id}`}><Pencil className="w-3.5 h-3.5 mr-2" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => remove(d.id)} className="text-red-600" data-testid={`delete-device-${d.id}`}><Trash2 className="w-3.5 h-3.5 mr-2" /> Remove</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-md" data-testid="device-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editing ? "Edit Device" : "Pair New Screen"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Device Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="device-name" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Reception, Lobby..." className="rounded-sm" data-testid="device-location" />
            </div>
            {!editing && (
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Pair Code (optional)</Label>
                <Input value={form.pair_code} onChange={(e) => setForm({ ...form, pair_code: e.target.value })} placeholder="Auto-generate if blank" className="rounded-sm font-mono" data-testid="device-pair-code" />
              </div>
            )}
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Layout Template</Label>
              <Select value={form.template_id || "none"} onValueChange={(v) => setForm({ ...form, template_id: v === "none" ? "" : v })}>
                <SelectTrigger className="rounded-sm" data-testid="device-template"><SelectValue placeholder="No template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="device-submit">{editing ? "Save" : "Pair"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
