import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Plus, Pencil, Trash2, Stethoscope, Package, Building, Copy, Scissors, Megaphone } from "lucide-react";
import { toast } from "sonner";

function ServicePanel({ vertical, label, icon: Icon }) {
  const profileKey = `${vertical}_profile`;
  const [profile, setProfile] = useState({ specialty: "", qualifications: "", fee: 0, hours: "", is_open: true, image_url: "", description: "", slot_minutes: 15 });
  const [apts, setApts] = useState([]);
  const [me, setMe] = useState(null);

  const title = label === "Salon" ? "Salon profile" : "Clinic profile";
  const bookingCta = label === "Salon" ? "Book service" : "Book appointment";

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([api.get("/client/me"), api.get(`/client/${vertical}/appointments`)]);
      setMe(m.data);
      setApts(a.data);
      if (m.data[profileKey]) setProfile({ specialty: "", qualifications: "", fee: 0, hours: "", is_open: true, image_url: "", description: "", slot_minutes: 15, ...m.data[profileKey] });
    } catch {}
  }, [profileKey, vertical]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await api.put(`/client/${vertical}/profile`, profile);
      toast.success(`${label} profile saved`);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const setStatus = async (aid, status) => {
    try {
      await api.post(`/client/${vertical}/appointments/${aid}/status?status=${status}`);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const bookingUrl = me ? `${window.location.origin}/book/${me.id}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      toast.success("Booking link copied");
    } catch {
      toast.error("Unable to copy link");
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-white border border-[#E5E7EB] rounded-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">{title}</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Public storefront</h3>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Accepting bookings</Label>
            <Switch checked={!!profile.is_open} onCheckedChange={(v) => setProfile({ ...profile, is_open: v })} data-testid="toggle-open" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Service title</Label>
            <Input value={profile.specialty} onChange={(e) => setProfile({ ...profile, specialty: e.target.value })} className="rounded-sm" placeholder={label === "Salon" ? "Haircuts, Styling" : "Cardiology, Dental"} />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Fee (₹)</Label>
            <Input type="number" value={profile.fee} onChange={(e) => setProfile({ ...profile, fee: parseFloat(e.target.value || 0) })} className="rounded-sm" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Details</Label>
            <Input value={profile.qualifications} onChange={(e) => setProfile({ ...profile, qualifications: e.target.value })} className="rounded-sm" placeholder={label === "Salon" ? "Senior stylist, bridal specialist" : "MBBS, MD"} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
            <Textarea value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} className="rounded-sm" rows={2} placeholder="Write about your services for end users." />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Working hours</Label>
            <Input value={profile.hours} onChange={(e) => setProfile({ ...profile, hours: e.target.value })} placeholder="Mon-Sat · 9 AM - 7 PM" className="rounded-sm" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Slot minutes</Label>
            <Input type="number" min={5} value={profile.slot_minutes} onChange={(e) => setProfile({ ...profile, slot_minutes: Math.max(5, parseInt(e.target.value || 15, 10)) })} className="rounded-sm" />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Cover image URL</Label>
            <Input value={profile.image_url} onChange={(e) => setProfile({ ...profile, image_url: e.target.value })} className="rounded-sm" placeholder="https://..." />
          </div>
        </div>
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#E5E7EB]">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280] mb-1">Public booking link</div>
            <div className="font-mono text-xs text-[#374151]">{bookingUrl}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyLink} className="rounded-sm"><Copy className="w-3.5 h-3.5 mr-2" /> Copy link</Button>
            <Button onClick={save} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">Save profile</Button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Live queue</div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight">Bookings and tokens</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Token</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Name</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Phone</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Time</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apts.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-[#6B7280]">No bookings yet. Share your link to start receiving tokens.</TableCell></TableRow>}
            {apts.map((a) => (
              <TableRow key={a.id}>
                <TableCell><span className="inline-flex items-center justify-center w-9 h-9 rounded-sm bg-[#111827] text-white font-mono font-bold">{a.token}</span></TableCell>
                <TableCell>
                  <div className="font-semibold">{a.patient_name}</div>
                  <div className="text-xs text-[#6B7280]">{a.service_name || bookingCta}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{a.patient_phone}</TableCell>
                <TableCell className="font-mono text-xs">{a.preferred_time || "ASAP"}</TableCell>
                <TableCell><span className="text-[11px] uppercase tracking-wider font-semibold">{a.status}</span></TableCell>
                <TableCell className="text-right">
                  {a.status === "pending" && <Button size="sm" variant="outline" className="rounded-sm mr-2" onClick={() => setStatus(a.id, "called")}>Call</Button>}
                  {a.status === "called" && <Button size="sm" variant="outline" className="rounded-sm mr-2" onClick={() => setStatus(a.id, "done")}>Done</Button>}
                  {a.status !== "cancelled" && a.status !== "done" && <Button size="sm" variant="outline" className="rounded-sm text-red-600" onClick={() => setStatus(a.id, "cancelled")}>Cancel</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RetailerPanel() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { name: "", price: 0, sku: "", description: "", image_url: "", stock: 0 };
  const [form, setForm] = useState(empty);
  const load = useCallback(async () => { try { setItems((await api.get("/client/products")).data); } catch {} }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/client/products/${editing.id}`, form);
      else await api.post("/client/products", form);
      toast.success(editing ? "Product updated" : "Product added");
      setOpen(false);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this product?")) return;
    try { await api.delete(`/client/products/${id}`); toast.success("Deleted"); load(); } catch {}
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Inventory</div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight">Products</h3>
        </div>
        <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">
          <Plus className="w-4 h-4 mr-2" /> New Product
        </Button>
      </div>
      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Product</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">SKU</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Price</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Stock</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No products yet.</TableCell></TableRow>}
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell><div className="font-semibold">{p.name}</div><div className="text-xs text-[#6B7280] line-clamp-1">{p.description}</div></TableCell>
                <TableCell className="font-mono text-xs">{p.sku || "-"}</TableCell>
                <TableCell className="text-right font-mono">Rs {Number(p.price).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">{p.stock}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setForm({ ...empty, ...p }); setOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p.id)} className="text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editing ? "Edit Product" : "New Product"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">SKU</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-sm font-mono" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Price</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value || 0) })} className="rounded-sm" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Stock</Label>
              <Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value || 0, 10) })} className="rounded-sm" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Image URL</Label>
              <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." className="rounded-sm" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm" rows={2} /></div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">{editing ? "Save" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SocietyPanel() {
  const [rooms, setRooms] = useState([]);
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const emptyRoom = { room_no: "", user_name: "", mobile: "", notes: "" };
  const [roomForm, setRoomForm] = useState(emptyRoom);

  const [notices, setNotices] = useState([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [editingNotice, setEditingNotice] = useState(null);
  const emptyNotice = { title: "", body: "", image_url: "" };
  const [noticeForm, setNoticeForm] = useState(emptyNotice);

  const load = useCallback(async () => {
    try {
      const [r, n] = await Promise.all([api.get("/client/rooms"), api.get("/client/notices")]);
      setRooms(r.data);
      setNotices(n.data);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const submitRoom = async (e) => {
    e.preventDefault();
    try {
      if (editingRoom) await api.put(`/client/rooms/${editingRoom.id}`, roomForm);
      else await api.post("/client/rooms", roomForm);
      toast.success(editingRoom ? "Room updated" : "Room added");
      setRoomOpen(false);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const removeRoom = async (id) => {
    if (!window.confirm("Delete this room?")) return;
    try { await api.delete(`/client/rooms/${id}`); toast.success("Deleted"); load(); } catch {}
  };

  const submitNotice = async (e) => {
    e.preventDefault();
    try {
      if (editingNotice) await api.put(`/client/notices/${editingNotice.id}`, noticeForm);
      else await api.post("/client/notices", noticeForm);
      toast.success(editingNotice ? "Notice updated" : "Notice uploaded");
      setNoticeOpen(false);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const removeNotice = async (id) => {
    if (!window.confirm("Delete this notice?")) return;
    try { await api.delete(`/client/notices/${id}`); toast.success("Deleted"); load(); } catch {}
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Society directory</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Rooms and residents</h3>
          </div>
          <Button onClick={() => { setEditingRoom(null); setRoomForm(emptyRoom); setRoomOpen(true); }} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">
            <Plus className="w-4 h-4 mr-2" /> Add Room
          </Button>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
          <Table>
            <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Room</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Resident</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Mobile</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Notes</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rooms.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No rooms yet.</TableCell></TableRow>}
              {rooms.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-display font-bold">{r.room_no}</TableCell>
                  <TableCell>{r.user_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.mobile || "-"}</TableCell>
                  <TableCell className="text-sm text-[#6B7280]">{r.notes}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => { setEditingRoom(r); setRoomForm({ ...emptyRoom, ...r }); setRoomOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => removeRoom(r.id)} className="text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Notice upload</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Society announcements</h3>
          </div>
          <Button onClick={() => { setEditingNotice(null); setNoticeForm(emptyNotice); setNoticeOpen(true); }} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">
            <Megaphone className="w-4 h-4 mr-2" /> Add Notice
          </Button>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
          <Table>
            <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Title</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Message</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Image</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {notices.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-10 text-sm text-[#6B7280]">No notices yet.</TableCell></TableRow>}
              {notices.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-semibold">{n.title}</TableCell>
                  <TableCell className="text-sm text-[#6B7280] max-w-[420px] truncate">{n.body}</TableCell>
                  <TableCell className="text-xs font-mono">{n.image_url ? "Added" : "-"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => { setEditingNotice(n); setNoticeForm({ ...emptyNotice, ...n }); setNoticeOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => removeNotice(n.id)} className="text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={roomOpen} onOpenChange={setRoomOpen}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editingRoom ? "Edit Room" : "Add Room"}</DialogTitle></DialogHeader>
          <form onSubmit={submitRoom} className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Room number</Label>
              <Input value={roomForm.room_no} onChange={(e) => setRoomForm({ ...roomForm, room_no: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Resident name</Label>
              <Input value={roomForm.user_name} onChange={(e) => setRoomForm({ ...roomForm, user_name: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Mobile</Label>
              <Input value={roomForm.mobile} onChange={(e) => setRoomForm({ ...roomForm, mobile: e.target.value })} className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Notes</Label>
              <Textarea value={roomForm.notes} onChange={(e) => setRoomForm({ ...roomForm, notes: e.target.value })} className="rounded-sm" rows={2} /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRoomOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">{editingRoom ? "Save" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}>
        <DialogContent className="rounded-sm max-w-lg">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editingNotice ? "Edit Notice" : "Upload Notice"}</DialogTitle></DialogHeader>
          <form onSubmit={submitNotice} className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Title</Label>
              <Input value={noticeForm.title} onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Message</Label>
              <Textarea value={noticeForm.body} onChange={(e) => setNoticeForm({ ...noticeForm, body: e.target.value })} className="rounded-sm" rows={3} /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Image URL</Label>
              <Input value={noticeForm.image_url} onChange={(e) => setNoticeForm({ ...noticeForm, image_url: e.target.value })} className="rounded-sm" placeholder="https://..." /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNoticeOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">{editingNotice ? "Save" : "Upload"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GeneralPanel() {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-sm p-12 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">No vertical content</div>
      <h3 className="font-display text-2xl font-extrabold tracking-tight mb-2">General signage account.</h3>
      <p className="text-sm text-[#6B7280]">Your storefront is configured for standard signage display. Use Devices and Templates to publish content.</p>
    </div>
  );
}

export default function ClientStorefront() {
  const [me, setMe] = useState(null);
  useEffect(() => { api.get("/client/me").then((r) => setMe(r.data)).catch(() => {}); }, []);

  const v = me?.vertical || "general";
  const config = useMemo(() => ({
    doctor: {
      overline: "Storefront / Doctor",
      title: "Clinic console.",
      subtitle: "Manage profile, accept bookings and call tokens.",
      icon: Stethoscope,
      panel: <ServicePanel vertical="doctor" label="Doctor" icon={Stethoscope} />,
    },
    salon: {
      overline: "Storefront / Salon",
      title: "Salon console.",
      subtitle: "Publish services, collect bookings and run live token queue.",
      icon: Scissors,
      panel: <ServicePanel vertical="salon" label="Salon" icon={Scissors} />,
    },
    retailer: {
      overline: "Storefront / Retailer",
      title: "Inventory and catalog.",
      subtitle: "Add products with price and stock.",
      icon: Package,
      panel: <RetailerPanel />,
    },
    society: {
      overline: "Storefront / Society",
      title: "Residence registry.",
      subtitle: "Manage directory entries and upload resident notices.",
      icon: Building,
      panel: <SocietyPanel />,
    },
    general: {
      overline: "Storefront / General",
      title: "Storefront.",
      subtitle: "Configure your content.",
      icon: null,
      panel: <GeneralPanel />,
    },
  }), []);

  const screen = config[v] || config.general;

  return (
    <div data-testid="client-storefront">
      <PageHeader overline={screen.overline} title={screen.title} subtitle={screen.subtitle} />
      {screen.panel}
    </div>
  );
}
