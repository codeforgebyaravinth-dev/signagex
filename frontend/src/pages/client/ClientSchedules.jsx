import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Checkbox } from "../../components/ui/checkbox";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Plus, Pencil, Trash2, Calendar } from "lucide-react";
import { toast } from "sonner";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const empty = {
  name: "", playlist_id: "", device_ids: [],
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  start_time: "09:00", end_time: "21:00", is_active: true,
};

export default function ClientSchedules() {
  const [items, setItems] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [devices, setDevices] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    try {
      const [s, p, d] = await Promise.all([
        api.get("/client/schedules"), api.get("/client/playlists"), api.get("/client/devices"),
      ]);
      setItems(s.data); setPlaylists(p.data); setDevices(d.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ ...empty, ...s }); setOpen(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/client/schedules/${editing.id}`, form);
      else await api.post("/client/schedules", form);
      toast.success(editing ? "Schedule updated" : "Schedule created");
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this schedule?")) return;
    try { await api.delete(`/client/schedules/${id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const toggleDay = (d) => setForm((f) => ({ ...f, days_of_week: f.days_of_week.includes(d) ? f.days_of_week.filter((x) => x !== d) : [...f.days_of_week, d].sort() }));
  const toggleDevice = (id) => setForm((f) => ({ ...f, device_ids: f.device_ids.includes(id) ? f.device_ids.filter((x) => x !== id) : [...f.device_ids, id] }));
  const toggleActive = async (s) => {
    try { await api.put(`/client/schedules/${s.id}`, { is_active: !s.is_active }); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const plName = (id) => playlists.find((p) => p.id === id)?.name || "—";

  return (
    <div data-testid="client-schedules-page">
      <PageHeader overline="Client / Schedule" title="Schedules." subtitle="Decide which playlist runs on which screens, on which days and time windows.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-schedule-btn">
          <Plus className="w-4 h-4 mr-2" /> New Schedule
        </Button>
      </PageHeader>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Schedule</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Playlist</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Days</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Window</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-center">Devices</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Active</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-[#6B7280]">No schedules yet.</TableCell></TableRow>}
            {items.map((s) => (
              <TableRow key={s.id} data-testid={`schedule-row-${s.id}`}>
                <TableCell><div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[#6B7280]" /><span className="font-semibold">{s.name}</span></div></TableCell>
                <TableCell className="text-sm">{plName(s.playlist_id)}</TableCell>
                <TableCell>
                  <div className="flex gap-0.5">
                    {DAYS.map((d, i) => (
                      <span key={i} className={`inline-flex items-center justify-center w-6 h-6 text-[10px] font-mono font-semibold rounded-sm ${s.days_of_week?.includes(i) ? "bg-[#111827] text-white" : "bg-[#F3F4F6] text-[#9CA3AF]"}`}>{d[0]}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{s.start_time} → {s.end_time}</TableCell>
                <TableCell className="text-center font-mono">{s.device_ids?.length || 0}</TableCell>
                <TableCell><Switch checked={!!s.is_active} onCheckedChange={() => toggleActive(s)} data-testid={`toggle-${s.id}`} /></TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`edit-schedule-${s.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(s.id)} className="text-red-600" data-testid={`delete-schedule-${s.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg max-h-[90vh] overflow-y-auto" data-testid="schedule-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editing ? "Edit Schedule" : "New Schedule"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="sch-name" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Playlist</Label>
              <Select value={form.playlist_id} onValueChange={(v) => setForm({ ...form, playlist_id: v })}>
                <SelectTrigger className="rounded-sm" data-testid="sch-playlist"><SelectValue placeholder="Select playlist" /></SelectTrigger>
                <SelectContent>{playlists.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.zone})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Start time</Label>
                <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="rounded-sm font-mono" data-testid="sch-start" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">End time</Label>
                <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="rounded-sm font-mono" data-testid="sch-end" />
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280] mb-2 block">Days</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((d, i) => (
                  <button key={i} type="button" onClick={() => toggleDay(i)} className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm border ${form.days_of_week.includes(i) ? "bg-[#111827] text-white border-[#111827]" : "bg-white text-[#374151] border-[#E5E7EB] hover:bg-[#F3F4F6]"}`} data-testid={`day-${i}`}>{d}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280] mb-2 block">Devices</Label>
              <div className="border border-[#E5E7EB] rounded-sm max-h-40 overflow-y-auto p-2 space-y-1">
                {devices.length === 0 && <div className="text-xs text-[#9CA3AF] p-2">No devices yet. Pair one in Devices first.</div>}
                {devices.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#F9FAFB] rounded-sm cursor-pointer">
                    <Checkbox checked={form.device_ids.includes(d.id)} onCheckedChange={() => toggleDevice(d.id)} data-testid={`sch-dev-${d.id}`} />
                    <span className="text-sm flex-1">{d.name}</span>
                    <span className="text-[10px] text-[#9CA3AF] font-mono">{d.pair_code}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-4">
              <Label className="text-sm">Active</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} data-testid="sch-active" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="sch-submit">{editing ? "Save" : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
