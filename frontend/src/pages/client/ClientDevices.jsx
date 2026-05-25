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

const empty = { name: "", location: "", pair_code: "", template_id: "", brightness: 100 };

export default function ClientDevices() {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    try {
      const [d, t, p] = await Promise.all([api.get("/client/devices"), api.get("/client/templates"), api.get("/client/playlists")]);
      setItems(d.data); setTemplates(t.data); setPlaylists(p.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (d) => { setEditing(d); setForm({ ...empty, ...d, template_id: d.template_id || "", playlist_id: d.playlist_id || "", orientation: d.orientation || "auto", brightness: Number(d.brightness ?? 100) }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, template_id: form.template_id || null, playlist_id: form.playlist_id || null, orientation: form.orientation || "auto", brightness: Number(form.brightness ?? 100) };
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
  const playlistName = (id) => playlists.find((p) => p.id === id)?.name || "—";

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
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">ID</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Device</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Pair Code</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Template</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Playlist</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Orientation</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Brightness</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-10 text-sm text-[#6B7280]">No devices yet.</TableCell></TableRow>}
            {items.map((d) => (
              <TableRow key={d.id} data-testid={`device-row-${d.id}`}>
                <TableCell className="font-mono text-[11px] text-[#6B7280]">{d.id}</TableCell>
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
                <TableCell className="text-sm">{playlistName(d.playlist_id)}</TableCell>
                <TableCell className="text-sm capitalize">{d.orientation || "auto"}</TableCell>
                <TableCell className="text-right font-mono text-xs">{Number(d.brightness ?? 100)}%</TableCell>
                <TableCell><span className="text-[11px] uppercase tracking-wider font-semibold text-[#374151]">{d.status}</span></TableCell>
                <TableCell>
                  <a href={`/play/${d.pair_code}`} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs px-2 py-1 border border-[#E5E7EB] rounded-sm hover:bg-[#F3F4F6] mr-1" data-testid={`open-player-${d.id}`}>
                    <ExternalLink className="w-3 h-3 mr-1" /> Player
                  </a>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-sm">
                        <DropdownMenuItem onClick={() => openEdit(d)} data-testid={`edit-device-${d.id}`}><Pencil className="w-3.5 h-3.5 mr-2" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => {
                          const code = window.prompt('Enter device-generated pair code to complete pairing:');
                          if (!code) return;
                          try {
                            await api.post('/client/pair/complete', { pair_code: code.trim(), device_id: d.id });
                            toast.success('Device paired successfully');
                            load();
                          } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
                        }} data-testid={`complete-pair-${d.id}`}><Copy className="w-3.5 h-3.5 mr-2" /> Complete Pairing</DropdownMenuItem>
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
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Playlist</Label>
              <Select value={form.playlist_id || "none"} onValueChange={(v) => setForm({ ...form, playlist_id: v === "none" ? "" : v })}>
                <SelectTrigger className="rounded-sm" data-testid="device-playlist"><SelectValue placeholder="No playlist" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No playlist</SelectItem>
                  {playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Orientation</Label>
              <Select value={form.orientation || "auto"} onValueChange={(v) => setForm({ ...form, orientation: v })}>
                <SelectTrigger className="rounded-sm" data-testid="device-orientation"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                  <SelectItem value="portrait">Portrait</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Brightness</Label>
              <Input type="number" min="0" max="100" value={form.brightness} onChange={(e) => setForm({ ...form, brightness: Number(e.target.value || 100) })} className="rounded-sm" data-testid="device-brightness" />
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
