import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Plus, Pencil, Trash2, Stethoscope, Package, Building, Copy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";

function DoctorPanel({ user }) {
  const [profile, setProfile] = useState({ specialty: "", qualifications: "", fee: 0, hours: "", is_open: true });
  const [apts, setApts] = useState([]);
  const [me, setMe] = useState(null);

  const load = async () => {
    try {
      const [m, a] = await Promise.all([api.get("/client/me"), api.get("/client/doctor/appointments")]);
      setMe(m.data); setApts(a.data);
      if (m.data.doctor_profile) setProfile({ specialty: "", qualifications: "", fee: 0, hours: "", is_open: true, ...m.data.doctor_profile });
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try { await api.put("/client/doctor/profile", profile); toast.success("Profile saved"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const setStatus = async (aid, status) => {
    try { await api.post(`/client/doctor/appointments/${aid}/status?status=${status}`); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const bookingUrl = me ? `${window.location.origin}/book/${me.id}` : "";
  const copyLink = () => { navigator.clipboard.writeText(bookingUrl); toast.success("Booking link copied!"); };

  return (
    <div className="space-y-8">
      <div className="bg-white border border-[#E5E7EB] rounded-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Clinic profile</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Public storefront</h3>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Accepting patients</Label>
            <Switch checked={!!profile.is_open} onCheckedChange={(v) => setProfile({ ...profile, is_open: v })} data-testid="toggle-open" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Specialty</Label>
            <Input value={profile.specialty} onChange={(e) => setProfile({ ...profile, specialty: e.target.value })} className="rounded-sm" data-testid="doc-specialty" /></div>
          <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Consultation fee (₹)</Label>
            <Input type="number" value={profile.fee} onChange={(e) => setProfile({ ...profile, fee: parseFloat(e.target.value || 0) })} className="rounded-sm" data-testid="doc-fee" /></div>
          <div className="md:col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Qualifications</Label>
            <Input value={profile.qualifications} onChange={(e) => setProfile({ ...profile, qualifications: e.target.value })} className="rounded-sm" data-testid="doc-quals" /></div>
          <div className="md:col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Working hours</Label>
            <Input value={profile.hours} onChange={(e) => setProfile({ ...profile, hours: e.target.value })} placeholder="Mon-Sat · 9 AM – 6 PM" className="rounded-sm" data-testid="doc-hours" /></div>
        </div>
        <div className="flex items-center justify-between mt-6 pt-6 border-t border-[#E5E7EB]">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280] mb-1">Public booking link</div>
            <div className="font-mono text-xs text-[#374151]">{bookingUrl}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copyLink} className="rounded-sm" data-testid="copy-booking"><Copy className="w-3.5 h-3.5 mr-2" /> Copy link</Button>
            <Button onClick={save} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="save-doc-profile">Save profile</Button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Live queue</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Appointments</h3>
          </div>
        </div>
        <Table>
          <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Token</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Patient</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Date</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
            <TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {apts.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No appointments yet. Share your booking link.</TableCell></TableRow>}
            {apts.map((a) => (
              <TableRow key={a.id}>
                <TableCell><span className="inline-flex items-center justify-center w-9 h-9 rounded-sm bg-[#111827] text-white font-mono font-bold">{a.token}</span></TableCell>
                <TableCell><div className="font-semibold">{a.patient_name}</div><div className="text-xs text-[#6B7280]">{a.patient_phone}</div></TableCell>
                <TableCell className="font-mono text-xs">{a.date}</TableCell>
                <TableCell><span className="text-[11px] uppercase tracking-wider font-semibold">{a.status}</span></TableCell>
                <TableCell className="text-right">
                  {a.status === "pending" && <Button size="sm" variant="outline" className="rounded-sm mr-2" onClick={() => setStatus(a.id, "called")} data-testid={`call-${a.id}`}>Call</Button>}
                  {a.status === "called" && <Button size="sm" variant="outline" className="rounded-sm mr-2" onClick={() => setStatus(a.id, "done")} data-testid={`done-${a.id}`}>Done</Button>}
                  {a.status !== "cancelled" && a.status !== "done" && <Button size="sm" variant="outline" className="rounded-sm text-red-600" onClick={() => setStatus(a.id, "cancelled")} data-testid={`cancel-${a.id}`}>Cancel</Button>}
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
  const load = async () => { try { setItems((await api.get("/client/products")).data); } catch {} };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/client/products/${editing.id}`, form);
      else await api.post("/client/products", form);
      toast.success(editing ? "Product updated" : "Product added");
      setOpen(false); load();
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
        <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-product-btn">
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
                <TableCell className="font-mono text-xs">{p.sku || "—"}</TableCell>
                <TableCell className="text-right font-mono">₹ {Number(p.price).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono">{p.stock}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setForm({ ...empty, ...p }); setOpen(true); }} data-testid={`edit-product-${p.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(p.id)} className="text-red-600" data-testid={`delete-product-${p.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
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
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="prod-name" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">SKU</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="rounded-sm font-mono" data-testid="prod-sku" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Price (₹)</Label>
              <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value || 0) })} className="rounded-sm" data-testid="prod-price" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Stock</Label>
              <Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value || 0) })} className="rounded-sm" data-testid="prod-stock" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Image URL</Label>
              <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." className="rounded-sm" data-testid="prod-image" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm" rows={2} data-testid="prod-desc" /></div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="prod-submit">{editing ? "Save" : "Add"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SocietyPanel() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { room_no: "", user_name: "", mobile: "", notes: "" };
  const [form, setForm] = useState(empty);
  const load = async () => { try { setItems((await api.get("/client/rooms")).data); } catch {} };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) await api.put(`/client/rooms/${editing.id}`, form);
      else await api.post("/client/rooms", form);
      toast.success(editing ? "Room updated" : "Room added");
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this room?")) return;
    try { await api.delete(`/client/rooms/${id}`); toast.success("Deleted"); load(); } catch {}
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Society directory</div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight">Rooms & residents</h3>
        </div>
        <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-room-btn">
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
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No rooms yet.</TableCell></TableRow>}
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-display font-bold">{r.room_no}</TableCell>
                <TableCell>{r.user_name}</TableCell>
                <TableCell className="font-mono text-xs">{r.mobile || "—"}</TableCell>
                <TableCell className="text-sm text-[#6B7280]">{r.notes}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setForm({ ...empty, ...r }); setOpen(true); }} data-testid={`edit-room-${r.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)} className="text-red-600" data-testid={`delete-room-${r.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editing ? "Edit Room" : "Add Room"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Room number</Label>
              <Input value={form.room_no} onChange={(e) => setForm({ ...form, room_no: e.target.value })} required className="rounded-sm" data-testid="room-no" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Resident name</Label>
              <Input value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} required className="rounded-sm" data-testid="room-user" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Mobile</Label>
              <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="rounded-sm" data-testid="room-mobile" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-sm" rows={2} data-testid="room-notes" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="room-submit">{editing ? "Save" : "Add"}</Button>
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
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  useEffect(() => { api.get("/client/me").then((r) => setMe(r.data)).catch(() => {}); }, []);

  const v = me?.vertical || "general";
  const VIcon = v === "doctor" ? Stethoscope : v === "retailer" ? Package : v === "society" ? Building : null;

  return (
    <div data-testid="client-storefront">
      <PageHeader
        overline={`Storefront / ${v.charAt(0).toUpperCase() + v.slice(1)}`}
        title={v === "doctor" ? "Clinic console." : v === "retailer" ? "Inventory & catalog." : v === "society" ? "Residence registry." : "Storefront."}
        subtitle={v === "doctor" ? "Manage profile, accept bookings and call tokens." : v === "retailer" ? "Add products with price and stock." : v === "society" ? "Track residents and rooms." : "Configure your content."}
      />
      {v === "doctor" && <DoctorPanel user={user} />}
      {v === "retailer" && <RetailerPanel />}
      {v === "society" && <SocietyPanel />}
      {v === "general" && <GeneralPanel />}
    </div>
  );
}
