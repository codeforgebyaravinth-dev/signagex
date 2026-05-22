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
  const emptyProfile = useMemo(() => ({ specialty: "", qualifications: "", fee: 0, hours: "", is_open: true, image_url: "", description: "", slot_minutes: 15, services: [] }), []);
  const [profile, setProfile] = useState(emptyProfile);
  const [apts, setApts] = useState([]);
  const [me, setMe] = useState(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceIndex, setServiceIndex] = useState(null);
  const [serviceForm, setServiceForm] = useState({ id: "", name: "", price: 0, duration_mins: 30, description: "", image_url: "", active: true });
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({ patient_name: "", patient_phone: "", preferred_time: "", service_id: "", notes: "" });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showPastBookings, setShowPastBookings] = useState(false);

  const title = label === "Salon" ? "Salon profile" : "Clinic profile";
  const bookingCta = label === "Salon" ? "Book service" : "Book appointment";
  const services = Array.isArray(profile.services) ? profile.services : [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const visibleAppointments = useMemo(() => {
    if (showPastBookings) return apts;
    return apts.filter((item) => String(item.date || "") === todayIso);
  }, [apts, showPastBookings, todayIso]);
  const pastCount = Math.max(0, apts.length - visibleAppointments.length);

  const sortAppointments = useCallback((appointments = []) => {
    const rank = (status) => ({ called: 0, pending: 1, done: 2, cancelled: 3 }[status || ""] ?? 9);
    return [...appointments].sort((a, b) => {
      const statusDelta = rank(a.status) - rank(b.status);
      if (statusDelta !== 0) return statusDelta;
      const tokenDelta = Number(a.token || 0) - Number(b.token || 0);
      if (tokenDelta !== 0) return tokenDelta;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([api.get("/client/me"), api.get(`/client/${vertical}/appointments`)]);
      setMe(m.data);
      setApts(sortAppointments(a.data));
      if (m.data[profileKey]) setProfile({ ...emptyProfile, ...m.data[profileKey], services: Array.isArray(m.data[profileKey].services) ? m.data[profileKey].services : [] });
    } catch {}
  }, [profileKey, vertical, emptyProfile, sortAppointments]);
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

  const openServiceEditor = (item = null, index = null) => {
    setServiceIndex(index);
    setServiceForm(item ? { id: item.id || `svc-${Date.now()}`, name: item.name || "", price: item.price || 0, duration_mins: item.duration_mins || 30, description: item.description || "", image_url: item.image_url || "", active: item.active !== false, tags: Array.isArray(item.tags) ? item.tags.join(", ") : (item.tags || "") } : { id: `svc-${Date.now()}`, name: "", price: 0, duration_mins: 30, description: "", image_url: "", active: true, tags: "" });
    setServiceOpen(true);
  };

  const saveService = (e) => {
    e.preventDefault();
    const next = [...services];
    const payload = { ...serviceForm, price: Number(serviceForm.price || 0), duration_mins: Math.max(5, parseInt(serviceForm.duration_mins || 30, 10)), active: !!serviceForm.active };
    // normalize tags to array on save
    if (typeof payload.tags === "string") payload.tags = payload.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
    if (serviceIndex === null) next.push(payload);
    else next[serviceIndex] = { ...(next[serviceIndex] || {}), ...payload, id: next[serviceIndex]?.id || payload.id };
    const nextProfile = { ...profile, services: next };
    setProfile(nextProfile);
    setServiceOpen(false);
    api.put(`/client/${vertical}/profile`, nextProfile)
      .then(() => {
        toast.success(serviceIndex === null ? `${label} service added` : `${label} service updated`);
        load();
      })
      .catch((e) => {
        toast.error(formatErr(e.response?.data?.detail));
      });
  };

  const removeService = (index) => {
    const next = services.filter((_, i) => i !== index);
    const nextProfile = { ...profile, services: next };
    setProfile(nextProfile);
    api.put(`/client/${vertical}/profile`, nextProfile)
      .then(() => {
        toast.success(`${label} service removed`);
        load();
      })
      .catch((e) => {
        toast.error(formatErr(e.response?.data?.detail));
      });
  };

  const uploadServiceImage = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "storefront");
      fd.append("zone", "main");
      fd.append("name", file.name);
      const { data } = await api.post("/client/media", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setServiceForm((prev) => ({ ...prev, image_url: data.public_url || `${API_BASE}${data.url || ""}` }));
      toast.success("Service image uploaded");
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    } finally {
      setUploadingImage(false);
    }
  };

  const openManualBooking = () => {
    setManualForm({ patient_name: "", patient_phone: "", preferred_time: "", service_id: services[0]?.id || "", notes: "" });
    setManualOpen(true);
  };

  const submitManualBooking = async (e) => {
    e.preventDefault();
    try {
      const selected = services.find((item) => item.id === manualForm.service_id) || services[0] || {};
      await api.post(`/client/${vertical}/appointments`, {
        patient_name: manualForm.patient_name,
        patient_phone: manualForm.patient_phone,
        preferred_time: manualForm.preferred_time,
        notes: manualForm.notes,
        service_id: selected.id || manualForm.service_id || "",
        service_name: selected.name || "Walk-in booking",
        service_price: Number(selected.price || 0),
        source: "manual",
      });
      toast.success("Walk-in booking added");
      setManualOpen(false);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const bookingSlug = useMemo(() => {
    if (!me) return "";
    const base = String(me.public_booking_slug || me.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return base || me.id;
  }, [me]);
  const bookingUrl = me ? `${window.location.origin}/book/${encodeURIComponent(me.id || bookingSlug)}` : "";
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
      <div className="bg-gradient-to-br from-[#111827] via-[#1F2937] to-[#0F172A] text-white rounded-2xl p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.9)] border border-white/10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60 mb-2">{title}</div>
            <h3 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight">Public storefront</h3>
            <p className="mt-3 text-sm text-white/70 max-w-xl">Add multiple services with prices, images and duration. The same data powers the premium public booking page and your walk-in queue.</p>
          </div>
          <div className="flex items-center gap-3 bg-white/10 rounded-2xl px-4 py-3 border border-white/10">
            <Label className="text-xs text-white/70">Accepting bookings</Label>
            <Switch checked={!!profile.is_open} onCheckedChange={(v) => setProfile({ ...profile, is_open: v })} data-testid="toggle-open" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Headline</Label>
            <Input value={profile.specialty} onChange={(e) => setProfile({ ...profile, specialty: e.target.value })} className="rounded-lg bg-white/95 text-[#111827]" placeholder={label === "Salon" ? "Premium haircuts, styling, beard trim" : "General medicine, dental, diagnostics"} />
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Featured price</Label>
            <Input type="number" value={profile.fee} onChange={(e) => setProfile({ ...profile, fee: parseFloat(e.target.value || 0) })} className="rounded-lg bg-white/95 text-[#111827]" />
          </div>
          <div className="md:col-span-2 bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Details</Label>
            <Input value={profile.qualifications} onChange={(e) => setProfile({ ...profile, qualifications: e.target.value })} className="rounded-lg bg-white/95 text-[#111827]" placeholder={label === "Salon" ? "Senior stylist, bridal specialist" : "MBBS, MD"} />
          </div>
          <div className="md:col-span-2 bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Description</Label>
            <Textarea value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} className="rounded-lg bg-white/95 text-[#111827]" rows={3} placeholder="Write a premium description for end users." />
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Working hours</Label>
            <Input value={profile.hours} onChange={(e) => setProfile({ ...profile, hours: e.target.value })} placeholder="Mon-Sat · 9 AM - 7 PM" className="rounded-lg bg-white/95 text-[#111827]" />
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Slot minutes</Label>
            <Input type="number" min={5} value={profile.slot_minutes} onChange={(e) => setProfile({ ...profile, slot_minutes: Math.max(5, parseInt(e.target.value || 15, 10)) })} className="rounded-lg bg-white/95 text-[#111827]" />
          </div>
          <div className="md:col-span-2 bg-white/5 border border-white/10 rounded-xl p-4">
            <Label className="text-xs uppercase tracking-wider text-white/60">Cover image URL</Label>
            <Input value={profile.image_url} onChange={(e) => setProfile({ ...profile, image_url: e.target.value })} className="rounded-lg bg-white/95 text-[#111827]" placeholder="https://..." />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-6 border-t border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-white/60 mb-1">Public booking link</div>
            <div className="font-mono text-xs text-white/80 break-all">{bookingUrl}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copyLink} className="rounded-xl bg-white/10 text-white border-white/15 hover:bg-white/20"><Copy className="w-3.5 h-3.5 mr-2" /> Copy link</Button>
            <Button onClick={save} className="rounded-xl bg-white text-[#111827] hover:bg-white/90">Save profile</Button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-[0_24px_60px_-36px_rgba(15,23,42,0.35)]">
        <div className="px-6 py-5 border-b border-[#E5E7EB] flex flex-wrap items-center justify-between gap-3 bg-[#F9FAFB]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Catalog</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Services and pricing</h3>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl" onClick={openManualBooking}>Add walk-in</Button>
            <Button className="rounded-xl bg-[#111827] hover:bg-[#374151] text-white" onClick={() => openServiceEditor()}>Add service</Button>
          </div>
        </div>
        <div className="p-6">
          {services.length === 0 ? (
            <div className="border border-dashed border-[#D1D5DB] rounded-2xl p-8 text-center text-sm text-[#6B7280]">No services yet. Add one premium service card for your storefront.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {services.map((service, index) => (
                <div key={service.id || index} className="rounded-2xl border border-[#E5E7EB] overflow-hidden bg-white shadow-[0_20px_40px_-30px_rgba(15,23,42,0.35)]">
                  <div className="h-44 bg-[#111827] relative">
                    {service.image_url ? (
                      <img src={service.image_url} alt={service.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.2),transparent_55%),linear-gradient(135deg,#111827,#334155)]" />
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                      <div className="flex items-center justify-between gap-3 text-white">
                        <div>
                          <div className="font-display text-xl font-extrabold tracking-tight">{service.name || "Service"}</div>
                          <div className="text-xs text-white/70">{service.duration_mins || 30} mins</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wider text-white/60">Price</div>
                          <div className="font-display text-2xl font-extrabold">₹{Number(service.price || 0).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-sm text-[#374151] min-h-[40px]">{service.description || "Premium service item for your storefront."}</p>
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wider font-semibold text-[#6B7280]">
                      <span>{service.active === false ? "Hidden" : "Visible"}</span>
                      <span>{service.image_url ? "Image added" : "No image"}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="rounded-xl flex-1" onClick={() => openServiceEditor(service, index)}><Pencil className="w-3.5 h-3.5 mr-2" /> Edit</Button>
                      <Button variant="outline" className="rounded-xl text-red-600 border-red-200 hover:bg-red-50" onClick={() => removeService(index)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Live queue</div>
            <h3 className="font-display text-2xl font-extrabold tracking-tight">Bookings and tokens</h3>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              variant="outline"
              className="rounded-sm"
              onClick={() => setShowPastBookings((value) => !value)}
            >
              {showPastBookings ? "Show today only" : `Show past bookings${pastCount ? ` (${pastCount})` : ""}`}
            </Button>
            <Button variant="outline" className="rounded-sm" onClick={openManualBooking}>Add walk-in</Button>
          </div>
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
            {apts.length > 0 && visibleAppointments.length === 0 && !showPastBookings && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-sm text-[#6B7280]">
                  No bookings for today. Toggle past bookings to view older queue items.
                </TableCell>
              </TableRow>
            )}
            {visibleAppointments.map((a) => (
              <TableRow key={a.id}>
                <TableCell><span className="inline-flex items-center justify-center w-9 h-9 rounded-sm bg-[#111827] text-white font-mono font-bold">{a.token}</span></TableCell>
                <TableCell>
                  <div className="font-semibold">{a.patient_name}</div>
                  <div className="text-xs text-[#6B7280]">{a.service_name || bookingCta}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{a.patient_phone}</TableCell>
                <TableCell className="font-mono text-xs">{a.assigned_time || a.preferred_time || "ASAP"}</TableCell>
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

      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent className="rounded-2xl max-w-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{serviceIndex === null ? "Add service" : "Edit service"}</DialogTitle></DialogHeader>
          <form onSubmit={saveService} className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Service name</Label>
              <Input value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Price (₹)</Label>
              <Input type="number" value={serviceForm.price} onChange={(e) => setServiceForm({ ...serviceForm, price: parseFloat(e.target.value || 0) })} className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Duration (mins)</Label>
              <Input type="number" min="5" value={serviceForm.duration_mins} onChange={(e) => setServiceForm({ ...serviceForm, duration_mins: parseInt(e.target.value || 30, 10) })} className="rounded-sm" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={serviceForm.description} onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })} className="rounded-sm" rows={3} /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Tags (comma separated)</Label>
              <Input value={serviceForm.tags || ""} onChange={(e) => setServiceForm({ ...serviceForm, tags: e.target.value })} className="rounded-sm" placeholder="pillows, bedding, cotton" /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Service image</Label>
              <Input type="file" accept="image/*" onChange={(e) => uploadServiceImage(e.target.files?.[0])} className="rounded-sm" />
              <div className="mt-2 text-xs text-[#6B7280]">Uploads into your storefront folder in media.</div>
            </div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Image URL</Label>
              <Input value={serviceForm.image_url} onChange={(e) => setServiceForm({ ...serviceForm, image_url: e.target.value })} className="rounded-sm" placeholder="https://..." /></div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch checked={!!serviceForm.active} onCheckedChange={(v) => setServiceForm({ ...serviceForm, active: v })} />
              <Label className="text-sm">Visible on public storefront</Label>
            </div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="outline" onClick={() => setServiceOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="rounded-2xl max-w-xl">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">Add walk-in booking</DialogTitle></DialogHeader>
          <form onSubmit={submitManualBooking} className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Customer name</Label>
              <Input value={manualForm.patient_name} onChange={(e) => setManualForm({ ...manualForm, patient_name: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Phone</Label>
              <Input value={manualForm.patient_phone} onChange={(e) => setManualForm({ ...manualForm, patient_phone: e.target.value })} required className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Preferred time</Label>
              <Input value={manualForm.preferred_time} onChange={(e) => setManualForm({ ...manualForm, preferred_time: e.target.value })} placeholder="ASAP" className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Service</Label>
              <select value={manualForm.service_id} onChange={(e) => setManualForm({ ...manualForm, service_id: e.target.value })} className="w-full h-10 rounded-sm border border-[#D1D5DB] bg-white px-3 text-sm">
                {services.length === 0 && <option value="">No services added</option>}
                {services.map((service) => <option key={service.id} value={service.id}>{service.name} - ₹{Number(service.price || 0).toLocaleString()}</option>)}
              </select>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Notes</Label>
              <Textarea value={manualForm.notes} onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })} rows={3} className="rounded-sm" /></div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setManualOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white">Add booking</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RetailerPanel() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const empty = { name: "", price: 0, sku: "", description: "", image_url: "", stock: 0, tags: "" };
  const [form, setForm] = useState(empty);
  const [uploadingImage, setUploadingImage] = useState(false);

  const uploadProductImage = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "storefront");
      fd.append("zone", "main");
      fd.append("name", file.name);
      const { data } = await api.post("/client/media", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((prev) => ({ ...prev, image_url: data.public_url || data.url || "" }));
      toast.success("Product image uploaded");
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    } finally {
      setUploadingImage(false);
    }
  };
  const load = useCallback(async () => { try { setItems((await api.get("/client/products")).data); } catch {} }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      // ensure tags saved as array when provided as comma separated string
      const payload = { ...form };
      if (typeof payload.tags === "string") payload.tags = payload.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
      if (editing) await api.put(`/client/products/${editing.id}`, payload);
      else await api.post("/client/products", payload);
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
            <div className="col-span-2">
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Product image</Label>
              <Input type="file" accept="image/*" onChange={(e) => uploadProductImage(e.target.files?.[0])} className="rounded-sm" />
              <div className="mt-2 text-xs text-[#6B7280]">Uploads into your storefront folder in media.</div>
              <div className="mt-2">
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Image URL</Label>
                <Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." className="rounded-sm" />
              </div>
            </div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm" rows={2} /></div>
            <div className="col-span-2"><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Tags (comma separated)</Label>
              <Input value={form.tags || ""} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="rounded-sm" placeholder="pillows, bedding, cotton" /></div>
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
  const [uploadingNotice, setUploadingNotice] = useState(false);

  const uploadNoticeImage = async (file) => {
    if (!file) return;
    setUploadingNotice(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "storefront");
      fd.append("zone", "main");
      fd.append("name", file.name);
      const { data } = await api.post("/client/media", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setNoticeForm((prev) => ({ ...prev, image_url: data.public_url || data.url || "" }));
      toast.success("Notice image uploaded");
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    } finally {
      setUploadingNotice(false);
    }
  };

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
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Notice image</Label>
              <Input type="file" accept="image/*" onChange={(e) => uploadNoticeImage(e.target.files?.[0])} className="rounded-sm" />
              <div className="mt-2 text-xs text-[#6B7280]">Uploads into your storefront folder in media.</div>
              <div className="mt-2">
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Image URL</Label>
                <Input value={noticeForm.image_url} onChange={(e) => setNoticeForm({ ...noticeForm, image_url: e.target.value })} className="rounded-sm" placeholder="https://..." />
              </div>
            </div>
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
