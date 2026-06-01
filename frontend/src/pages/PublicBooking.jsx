import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Stethoscope, Clock, MapPin, Phone, CalendarCheck, IndianRupee, CircleSlash, ArrowLeft, ShoppingBag, Tag } from "lucide-react";
import { toast } from "sonner";
import { formatErr } from "../lib/api";

const BASE = `${(process.env.REACT_APP_BACKEND_URL || "https://rpsignage.com").replace(/\/$/, "")}/api/public`;

function parseTimeToMinutes(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const period = match[3];
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (period) {
    const upper = String(period).toUpperCase();
    hours = hours % 12 + (upper === "PM" ? 12 : 0);
  }
  return hours * 60 + minutes;
}

function formatMinutesToTime(minutes) {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, Number(minutes) || 0));
  const hours24 = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function getTimeMinutesInZone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timeZone || "Asia/Kolkata",
    }).formatToParts(new Date());
    const hours = Number(parts.find((part) => part.type === "hour")?.value || 0);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value || 0);
    return hours * 60 + minutes;
  } catch {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

export default function PublicBooking() {
  const { clientId } = useParams();
  const branchId = useMemo(() => new URLSearchParams(window.location.search).get("branch_id") || "", []);
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [form, setForm] = useState({ patient_name: "", patient_phone: "", preferred_time: "", booking_location: "", booking_device_id: "", service_name: "", service_id: "", service_ids: [], service_price: 0, notes: "" });

  useEffect(() => {
    let mounted = true;
    const loadDoc = async () => {
      try {
        const url = branchId ? `${BASE}/providers/${clientId}/branches/${encodeURIComponent(branchId)}` : `${BASE}/providers/${clientId}`;
        const { data } = await axios.get(url);
        if (mounted) setDoc(data);
      } catch {
        if (mounted) setDoc(false);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadDoc();
    const timer = setInterval(loadDoc, 20000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [clientId, branchId]);

  const profile = doc?.profile || {};
  const services = useMemo(() => {
    const raw = Array.isArray(profile.services) ? profile.services : [];
    const visible = raw.filter((item) => item?.active !== false);
    if (visible.length > 0) return visible;
    if (!profile.specialty && !profile.fee) return [];
    return [{ id: "featured", name: profile.specialty || (doc?.vertical === "salon" ? "Premium haircut" : "Consultation"), price: Number(profile.fee || 0), duration_mins: Number(profile.slot_minutes || 15), description: profile.description || "", image_url: profile.image_url || "", active: true }];
  }, [profile.description, profile.fee, profile.image_url, profile.services, profile.slot_minutes, profile.specialty, doc?.vertical]);

  useEffect(() => {
    if (services.length && !form.service_ids.length && !form.service_id) {
      const first = services[0];
      setForm((prev) => ({ ...prev, service_id: first.id || "", service_ids: first.id ? [first.id] : [], service_name: first.name || prev.service_name, service_price: Number(first.price || 0) }));
    }
  }, [services, form.service_id, form.service_ids.length]);

  const selectedServices = useMemo(() => {
    const selected = services.filter((service) => form.service_ids.includes(service.id));
    if (selected.length) return selected;
    const fallback = services.find((service) => service.id === form.service_id);
    return fallback ? [fallback] : services.slice(0, 1);
  }, [form.service_id, form.service_ids, services]);
  const selectedService = selectedServices[0] || null;
  const selectedServiceDuration = selectedServices.reduce((sum, item) => sum + Math.max(5, Number(item.duration_mins || profile.slot_minutes || 15)), 0) || Math.max(5, Number(profile.slot_minutes || 15));
  const queuePreview = useMemo(() => (Array.isArray(doc?.queue_preview) ? doc.queue_preview : []), [doc?.queue_preview]);
  const bookingDevices = useMemo(() => (Array.isArray(doc?.booking_devices) ? doc.booking_devices : []), [doc?.booking_devices]);
  const bookingLocations = useMemo(() => {
    const fromDoc = Array.isArray(doc?.booking_locations) ? doc.booking_locations : [];
    const fromDevices = bookingDevices.map((item) => String(item.location || "").trim()).filter(Boolean);
    return [...new Set([...fromDoc, ...fromDevices])];
  }, [bookingDevices, doc?.booking_locations]);

  useEffect(() => {
    if (!bookingLocations.length) return;
    if (!form.booking_location) {
      setForm((prev) => ({ ...prev, booking_location: bookingLocations[0] }));
    }
  }, [bookingLocations, form.booking_location]);

  const filteredQueuePreview = useMemo(() => {
    if (!form.booking_location && !form.booking_device_id) return queuePreview;
    return queuePreview.filter((item) => {
      const byDevice = form.booking_device_id ? String(item?.routed_device_id || "") === String(form.booking_device_id) : true;
      const byLocation = form.booking_location ? String(item?.routed_location || "").trim().toLowerCase() === String(form.booking_location || "").trim().toLowerCase() : true;
      return byDevice && byLocation;
    });
  }, [form.booking_device_id, form.booking_location, queuePreview]);

  const currentlyServingToken = useMemo(() => {
    const serving = filteredQueuePreview.find((item) => String(item?.status || "").toLowerCase() === "called") || filteredQueuePreview[0] || null;
    const token = String(serving?.token || "").trim();
    return token || null;
  }, [filteredQueuePreview]);

  const approxWaitMinutes = filteredQueuePreview.reduce((sum, item) => sum + Math.max(5, Number(item?.service_duration_mins || profile.slot_minutes || 15)), 0) + Number(selectedServiceDuration || 15);
  const availableSlots = useMemo(() => {
    const slotMinutes = Math.max(5, Number(selectedServiceDuration || profile.slot_minutes || 15));
    const dayEndMinutes = 24 * 60;
    const occupied = filteredQueuePreview
      .map((item) => {
        const start = parseTimeToMinutes(item.assigned_time || item.preferred_time);
        if (start == null) return null;
        const duration = Math.max(5, Number(item.service_duration_mins || slotMinutes));
        return { start, end: start + duration };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);

    const options = [];
    const seen = new Set();
    const zoneNow = getTimeMinutesInZone(doc?.timezone);
    let cursor = Math.ceil(zoneNow / slotMinutes) * slotMinutes;
    cursor = Math.max(cursor, zoneNow);

    while (options.length < 12 && cursor < dayEndMinutes) {
      const conflict = occupied.find((slot) => cursor < slot.end && cursor + slotMinutes > slot.start);
      if (conflict) {
        cursor = conflict.end;
        continue;
      }
      const label = formatMinutesToTime(cursor);
      if (!seen.has(label)) {
        seen.add(label);
        options.push(label);
      }
      cursor += slotMinutes;
    }

    return options;
  }, [doc?.timezone, filteredQueuePreview, profile.slot_minutes, selectedServiceDuration]);

  useEffect(() => {
    if (!availableSlots.length) {
      if (form.preferred_time) setForm((prev) => ({ ...prev, preferred_time: "" }));
      return;
    }
    if (!form.preferred_time || !availableSlots.includes(form.preferred_time)) {
      setForm((prev) => ({ ...prev, preferred_time: availableSlots[0] }));
    }
  }, [availableSlots, form.preferred_time]);

  const openServiceDetail = (service) => {
    setDetailItem({
      kind: "service",
      id: service.id,
      name: service.name || "Service",
      price: Number(service.price || 0),
      description: service.description || "Premium service details are available here.",
      image_url: service.image_url || profile.image_url || "",
      duration_mins: Number(service.duration_mins || profile.slot_minutes || 15),
      stock: null,
    });
  };

  const openProductDetail = (product) => {
    setDetailItem({
      kind: "product",
      id: product.id,
      name: product.name || "Product",
      price: Number(product.price || 0),
      description: product.description || "Product details are available here.",
      image_url: product.image_url || "",
      stock: Number(product.stock || 0),
    });
  };

  const closeDetail = () => setDetailItem(null);

  const validateForm = () => {
    if (!String(form.patient_name || "").trim() || String(form.patient_name || "").trim().length < 2) {
      return "Enter a valid name (minimum 2 characters).";
    }
    const phone = normalizePhone(form.patient_phone);
    if (phone.length < 10 || phone.length > 15) {
      return "Enter a valid phone number (10 to 15 digits).";
    }
    if (!form.preferred_time) {
      return "Please select an available slot.";
    }
    if (services.length > 0 && selectedServices.length === 0) {
      return "Please select at least one service.";
    }
    return "";
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const errMsg = validateForm();
      if (errMsg) {
        toast.error(errMsg);
        return;
      }
      const totalPrice = selectedServices.reduce((sum, item) => sum + Number(item?.price || 0), 0);
      const serviceNames = selectedServices.map((item) => item.name).filter(Boolean);
      const payload = {
        ...form,
        service_id: selectedService?.id || form.service_id || "",
        booking_location: form.booking_location || "",
        booking_device_id: form.booking_device_id || "",
        service_ids: selectedServices.map((item) => item.id).filter(Boolean),
        service_name: serviceNames.join(" + ") || form.service_name,
        service_price: Number(totalPrice || form.service_price || 0),
      };
      const url = branchId ? `${BASE}/providers/${clientId}/branches/${encodeURIComponent(branchId)}/book` : `${BASE}/providers/${clientId}/book`;
      const { data } = await axios.post(url, payload);
      setConfirmed(data);
      toast.success(`Token #${data.token} confirmed`);
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-[#6B7280] font-mono uppercase tracking-widest">Loading...</div>;
  if (!doc) return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><CircleSlash className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" /><h2 className="font-display text-2xl font-extrabold">Provider not found</h2><p className="text-sm text-[#6B7280] mt-1">This booking link is invalid.</p></div></div>;

  const isOpen = profile.is_open !== false;
  const isSalon = doc.vertical === "salon";
  const providerLabel = isSalon ? "Salon" : "Clinic";
  const serviceLabel = isSalon ? "service" : "appointment";

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(17,24,39,0.18),_transparent_40%),linear-gradient(180deg,#F8FAFC,#EEF2FF)] p-6">
        <div className="bg-white/90 backdrop-blur border border-white shadow-[0_30px_80px_-40px_rgba(15,23,42,0.45)] rounded-3xl p-10 max-w-md w-full text-center">
          <CalendarCheck className="w-12 h-12 text-[#10B981] mx-auto mb-4" />
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">Booking confirmed</div>
          <h2 className="font-display text-3xl font-extrabold tracking-tighter">Your token</h2>
          <div className="font-display text-7xl font-extrabold tracking-tighter my-6">#{confirmed.token}</div>
          <p className="text-sm text-[#6B7280]">Visit <strong>{doc.name}</strong> on <strong>{confirmed.date}</strong>. Your time is <strong>{confirmed.assigned_time || confirmed.preferred_time || "ASAP"}</strong>.</p>
          <Button onClick={() => { setConfirmed(null); setForm({ patient_name: "", patient_phone: "", preferred_time: "", booking_location: "", booking_device_id: "", service_name: "", service_id: "", service_ids: [], service_price: 0, notes: "" }); }} variant="outline" className="rounded-sm mt-6" data-testid="book-another">Book another</Button>
        </div>
      </div>
    );
  }

  if (detailItem && detailItem.kind === "product" && doc.vertical === "retailer") {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(17,24,39,0.12),_transparent_42%),linear-gradient(180deg,#F8FAFC,#EEF2FF)] text-[#111827]">
        <header className="px-4 sm:px-6 py-4 sm:py-5">
          <div className="max-w-6xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-[#111827] text-white px-4 sm:px-5 py-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.7)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white text-[#111827] flex items-center justify-center rounded-xl"><ShoppingBag className="w-5 h-5" /></div>
              <div>
                <div className="font-display font-extrabold text-lg tracking-tight">SIGNAGE OS · Storefront</div>
                <div className="text-xs text-white/60 uppercase tracking-[0.2em]">Product details</div>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={closeDetail} className="rounded-xl bg-white/10 text-white border-white/15 hover:bg-white/20">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to products
            </Button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] items-start">
            <div className="rounded-[2rem] overflow-hidden border border-white/60 bg-white shadow-[0_30px_80px_-50px_rgba(15,23,42,0.45)]">
              <div className="relative min-h-[420px] bg-[#0F172A]">
                {detailItem.image_url ? <img src={detailItem.image_url} alt={detailItem.name} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.15),transparent_35%),linear-gradient(135deg,#0F172A,#334155)]" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-white/70">
                    <Tag className="w-3.5 h-3.5" /> Product
                  </div>
                  <h1 className="mt-3 font-display text-4xl md:text-5xl font-extrabold tracking-tighter max-w-2xl">{detailItem.name}</h1>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.25)] lg:sticky lg:top-6">
              <div className="text-[10px] uppercase tracking-[0.4em] text-[#6B7280]">Ecommerce details</div>
              <div className="mt-2 font-display text-3xl font-extrabold tracking-tight text-[#0F172A]">{detailItem.name}</div>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.35em] text-[#6B7280]">Price</div>
                  <div className="mt-1 font-display text-3xl font-black text-[#111827]">₹{Number(detailItem.price || 0).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.35em] text-[#6B7280]">Stock</div>
                  <div className="mt-1 font-semibold text-[#111827]">{detailItem.stock ?? "—"}</div>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm text-[#374151] leading-6">
                <p>{detailItem.description || "Product details are available here."}</p>
              </div>
              <div className="mt-6 flex gap-3">
                <a href={doc.phone ? `tel:${doc.phone}` : "#"} className="flex-1 text-center rounded-2xl py-3 bg-[#111827] text-white font-semibold">Contact seller</a>
                <Button type="button" variant="outline" className="rounded-2xl" onClick={closeDetail}>Close</Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (detailItem && detailItem.kind === "service") {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(17,24,39,0.12),_transparent_42%),linear-gradient(180deg,#F8FAFC,#EEF2FF)] text-[#111827]">
        <header className="px-4 sm:px-6 py-4 sm:py-5">
          <div className="max-w-6xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-[#111827] text-white px-4 sm:px-5 py-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.7)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white text-[#111827] flex items-center justify-center rounded-xl"><Stethoscope className="w-5 h-5" /></div>
              <div>
                <div className="font-display font-extrabold text-lg tracking-tight">SIGNAGE OS · Storefront</div>
                <div className="text-xs text-white/60 uppercase tracking-[0.2em]">Service details</div>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={closeDetail} className="rounded-xl bg-white/10 text-white border-white/15 hover:bg-white/20">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to services
            </Button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] items-start">
            <div className="rounded-[2rem] overflow-hidden border border-white/60 bg-white shadow-[0_30px_80px_-50px_rgba(15,23,42,0.45)]">
              <div className="relative min-h-[420px] bg-[#0F172A]">
                {detailItem.image_url ? <img src={detailItem.image_url} alt={detailItem.name} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.15),transparent_35%),linear-gradient(135deg,#0F172A,#334155)]" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-white/70">
                    <Clock className="w-3.5 h-3.5" /> Service
                  </div>
                  <h1 className="mt-3 font-display text-4xl md:text-5xl font-extrabold tracking-tighter max-w-2xl">{detailItem.name}</h1>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-[#E5E7EB] bg-white p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.25)] lg:sticky lg:top-6">
              <div className="text-[10px] uppercase tracking-[0.4em] text-[#6B7280]">Service details</div>
              <div className="mt-2 font-display text-3xl font-extrabold tracking-tight text-[#0F172A]">{detailItem.name}</div>
              <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.35em] text-[#6B7280]">Price</div>
                  <div className="mt-1 font-display text-3xl font-black text-[#111827]">₹{Number(detailItem.price || 0).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.35em] text-[#6B7280]">Duration</div>
                  <div className="mt-1 font-semibold text-[#111827]">{detailItem.duration_mins || profile.slot_minutes || 15} min</div>
                </div>
              </div>
              <div className="mt-5 space-y-3 text-sm text-[#374151] leading-6">
                <p>{detailItem.description || "Service details are available here."}</p>
              </div>
              <div className="mt-6 flex gap-3">
                <Button type="button" className="flex-1 rounded-2xl bg-[#111827] hover:bg-[#374151] text-white" onClick={() => {
                  setForm((prev) => ({
                    ...prev,
                    service_id: detailItem.id,
                    service_ids: detailItem.id ? [detailItem.id] : prev.service_ids,
                    service_name: detailItem.name,
                    service_price: detailItem.price,
                  }));
                  closeDetail();
                }}>
                  Book this service
                </Button>
                <Button type="button" variant="outline" className="rounded-2xl" onClick={closeDetail}>Close</Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }
  // Retailer storefront: render product catalog instead of booking form
  if (doc.vertical === "retailer") {
    const products = Array.isArray(doc.products) ? doc.products : [];
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(17,24,39,0.12),_transparent_42%),linear-gradient(180deg,#F8FAFC,#EEF2FF)] text-[#111827]">
        <header className="px-4 sm:px-6 py-4 sm:py-5">
          <div className="max-w-6xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-[#111827] text-white px-4 sm:px-5 py-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.7)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white text-[#111827] flex items-center justify-center rounded-xl"><Stethoscope className="w-5 h-5" /></div>
              <div>
                <div className="font-display font-extrabold text-lg tracking-tight">SIGNAGE OS · Storefront</div>
                <div className="text-xs text-white/60 uppercase tracking-[0.2em]">Premium storefront</div>
              </div>
            </div>
            <span className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border ${doc?.profile?.is_open !== false ? "bg-emerald-400/15 border-emerald-300/30 text-emerald-100" : "bg-white/10 border-white/20 text-white/70"}`}>{doc?.profile?.is_open !== false ? "Open" : "Closed"}</span>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
          <div className="space-y-6">
            <div className="rounded-[2rem] overflow-hidden border border-white/60 bg-white shadow-[0_30px_80px_-50px_rgba(15,23,42,0.45)]">
              <div className="relative min-h-[220px] bg-[#0F172A]">
                {doc.profile?.image_url ? <img src={doc.profile.image_url} alt={doc.name} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.15),transparent_35%),linear-gradient(135deg,#0F172A,#334155)]" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/65 mb-2">Store</div>
                  <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tighter max-w-2xl">{doc.name}</h1>
                  <p className="mt-3 max-w-2xl text-sm md:text-base text-white/80">{doc.profile?.description || "Beautiful product storefront."}</p>
                </div>
              </div>
            </div>

            <section>
              <div className="flex items-end justify-between mb-6">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Products</div>
                  <h2 className="font-display text-2xl font-extrabold tracking-tight">Shop</h2>
                </div>
                <div className="text-sm text-[#6B7280]">{products.length} items</div>
              </div>
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {products.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openProductDetail(p)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openProductDetail(p)}
                    className="cursor-pointer text-left rounded-2xl bg-white border border-[#E5E7EB] overflow-hidden shadow-sm hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#111827]"
                  >
                    <div className="h-44 bg-[#F8FAFC] relative">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300" />}
                    </div>
                    <div className="p-4">
                      <div className="font-semibold text-lg">{p.name}</div>
                      <div className="text-sm text-[#6B7280] mt-1 line-clamp-2">{p.description}</div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="font-display text-2xl font-extrabold">Rs {Number(p.price || 0).toLocaleString()}</div>
                        <div className="text-sm text-[#6B7280]">{p.stock} in stock</div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <a href={doc.phone ? `tel:${doc.phone}` : "#"} onClick={(e) => e.stopPropagation()} className="flex-1 text-center rounded-xl py-2 bg-[#111827] text-white">Contact seller</a>
                        <span className="px-3 py-2 rounded-xl border border-[#E5E7EB] bg-white">Details</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(17,24,39,0.12),_transparent_42%),linear-gradient(180deg,#F8FAFC,#EEF2FF)] text-[#111827]">
      <header className="px-4 sm:px-6 py-4 sm:py-5">
        <div className="max-w-6xl mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-[#111827] text-white px-4 sm:px-5 py-4 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.7)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white text-[#111827] flex items-center justify-center rounded-xl"><Stethoscope className="w-5 h-5" /></div>
            <div>
              <div className="font-display font-extrabold text-lg tracking-tight">SIGNAGE OS · Storefront</div>
              <div className="text-xs text-white/60 uppercase tracking-[0.2em]">Premium booking experience</div>
            </div>
          </div>
          <span className={`text-[11px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border ${isOpen ? "bg-emerald-400/15 border-emerald-300/30 text-emerald-100" : "bg-white/10 border-white/20 text-white/70"}`}>{isOpen ? "Open today" : "Closed"}</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-10">
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] items-start">
          <div className="space-y-6">
            <div className="rounded-[2rem] overflow-hidden border border-white/60 bg-white shadow-[0_30px_80px_-50px_rgba(15,23,42,0.45)]">
              <div className="relative min-h-[280px] bg-[#0F172A]">
                {profile.image_url ? <img src={profile.image_url} alt={doc.name} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.15),transparent_35%),linear-gradient(135deg,#0F172A,#334155)]" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/65 mb-2">{providerLabel}</div>
                  <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tighter max-w-2xl">{doc.name}</h1>
                  {profile.specialty ? (
                    <p className="mt-2 max-w-2xl text-sm md:text-base font-semibold text-white/90">{profile.specialty}</p>
                  ) : null}
                  <p className="mt-3 max-w-2xl text-sm md:text-base text-white/80">{profile.description || (isSalon ? "Curated cuts, styling, and premium grooming appointments." : "Elegant appointments, trusted care, and quick booking.")}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 p-4 sm:p-6">
                <div className="rounded-2xl bg-[#F8FAFC] p-4 border border-[#E5E7EB]"><div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Currently serving token</div><div className="font-display text-3xl font-extrabold mt-1">{currentlyServingToken || "—"}</div><div className="text-xs text-[#6B7280]">The token being served right now</div></div>
                <div className="rounded-2xl bg-[#F8FAFC] p-4 border border-[#E5E7EB]"><div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Live wait</div><div className="font-display text-3xl font-extrabold mt-1">~{approxWaitMinutes}m</div><div className="text-xs text-[#6B7280]">Updated every 20 sec</div></div>
                <div className="rounded-2xl bg-[#F8FAFC] p-4 border border-[#E5E7EB]"><div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Hours</div><div className="font-semibold mt-1">{profile.hours || "Open daily"}</div><div className="text-xs text-[#6B7280]">Plan your visit</div></div>
                <div className="rounded-2xl bg-[#F8FAFC] p-4 border border-[#E5E7EB]"><div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Starting from</div><div className="font-display text-3xl font-extrabold mt-1">₹{Number(selectedService?.price ?? profile.fee ?? 0).toLocaleString()}</div><div className="text-xs text-[#6B7280]">Selected service</div></div>
              </div>
              <div className="px-6 pb-6">
                <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Currently serving token</div>
                      <div className="font-display text-xl font-extrabold tracking-tight">Now serving</div>
                    </div>
                    <div className="text-xs text-[#6B7280]">{currentlyServingToken ? `Token #${currentlyServingToken}` : "No token serving"}</div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {currentlyServingToken ? (
                      <div className="min-w-[220px] rounded-xl bg-white border border-[#E5E7EB] p-4 shadow-sm">
                        <div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Currently serving</div>
                        <div className="font-display text-4xl font-extrabold tracking-tight text-[#111827] mt-1">Token #{currentlyServingToken}</div>
                        <div className="text-xs text-[#6B7280] mt-2">This is the token being served on screen right now.</div>
                      </div>
                    ) : (
                      <div className="text-sm text-[#6B7280]">The queue is empty right now.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {services.length > 0 && (
              <div>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-1">Services</div>
                    <h2 className="font-display text-2xl font-extrabold tracking-tight">Choose your service</h2>
                  </div>
                  <div className="text-sm text-[#6B7280]">Tap a service row to prefill the booking form</div>
                </div>
                <div className="space-y-3">
                  {services.map((service) => {
                    const active = service.id === selectedService?.id;
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => openServiceDetail(service)}
                        className={`w-full text-left rounded-[1.25rem] overflow-hidden border transition bg-white shadow-[0_12px_30px_-24px_rgba(15,23,42,0.32)] ${active ? "border-[#111827] ring-2 ring-[#111827]" : "border-[#E5E7EB] hover:border-[#94A3B8]"}`}
                      >
                        <div className="flex items-stretch">
                          <div className="w-28 sm:w-36 h-28 sm:h-32 shrink-0 bg-[#0F172A] relative">
                            {service.image_url ? <img src={service.image_url} alt={service.name} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 bg-[linear-gradient(135deg,#0F172A,#475569)]" />}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                          </div>
                          <div className="flex-1 p-4 sm:p-5 flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#111827] truncate">{service.name}</div>
                              <div className="mt-1 text-xs uppercase tracking-wider text-[#6B7280]">{service.duration_mins || 30} mins</div>
                              <p className="mt-2 text-sm text-[#374151] line-clamp-2">{service.description || (isSalon ? "A polished service designed for a premium salon experience." : "A premium appointment option for your customers.")}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[10px] uppercase tracking-wider text-[#6B7280]">Price</div>
                              <div className="font-display text-2xl sm:text-3xl font-extrabold text-[#111827]">₹{Number(service.price || 0).toLocaleString()}</div>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <form onSubmit={submit} className="lg:sticky lg:top-6 bg-white/92 backdrop-blur border border-white shadow-[0_30px_80px_-42px_rgba(15,23,42,0.45)] rounded-[2rem] p-4 sm:p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">Book {serviceLabel}</div>
            <h2 className="font-display text-3xl font-extrabold tracking-tighter mb-2">Get your token.</h2>
            <p className="text-sm text-[#6B7280] mb-6">Walk-ins and online bookings use the same queue, so your staff can manage everything in one place.</p>
            <div className="space-y-4">
              <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Your name</Label>
                <Input value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} required className="rounded-2xl" data-testid="book-name" /></div>
              <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Phone</Label>
                <Input value={form.patient_phone} onChange={(e) => setForm({ ...form, patient_phone: e.target.value })} required className="rounded-2xl" data-testid="book-phone" />
                <div className="mt-1 text-xs text-[#6B7280]">Used as your booking reference.</div>
              </div>
              {bookingLocations.length > 0 ? (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Location</Label>
                  <select
                    value={form.booking_location || ""}
                    onChange={(e) => setForm({ ...form, booking_location: e.target.value, booking_device_id: "" })}
                    className="w-full h-11 rounded-2xl border border-[#D1D5DB] bg-white px-4 text-sm"
                  >
                    <option value="">Default location</option>
                    {bookingLocations.map((location) => <option key={location} value={location}>{location}</option>)}
                  </select>
                </div>
              ) : null}
              {bookingDevices.length > 0 ? (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Screen (optional)</Label>
                  <select
                    value={form.booking_device_id || ""}
                    onChange={(e) => setForm({ ...form, booking_device_id: e.target.value })}
                    className="w-full h-11 rounded-2xl border border-[#D1D5DB] bg-white px-4 text-sm"
                  >
                    <option value="">Auto route by location</option>
                    {bookingDevices
                      .filter((item) => !form.booking_location || String(item.location || "") === String(form.booking_location || ""))
                      .map((item) => (
                        <option key={item.id} value={item.id}>{item.name}{item.location ? ` · ${item.location}` : ""}</option>
                      ))}
                  </select>
                </div>
              ) : null}
              <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Available slot</Label>
                <select
                  value={form.preferred_time}
                  onChange={(e) => setForm({ ...form, preferred_time: e.target.value })}
                  className="w-full h-11 rounded-2xl border border-[#D1D5DB] bg-white px-4 text-sm"
                >
                  {availableSlots.length === 0 ? <option value="">No slots available</option> : null}
                  {availableSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                </select>
                <div className="mt-2 text-xs text-[#6B7280]">Choose a free slot. If it gets taken before confirmation, we’ll move you to the next available time. Timezone: {doc?.timezone || "Asia/Kolkata"}.</div></div>
              {services.length > 0 ? (
                <div>
                  <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Services</Label>
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-2xl border border-[#D1D5DB] bg-white p-2 space-y-1.5">
                    {services.map((service) => {
                      const checked = form.service_ids.includes(service.id);
                      return (
                        <label key={service.id} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 cursor-pointer border ${checked ? "border-[#111827] bg-[#F9FAFB]" : "border-transparent hover:bg-[#F9FAFB]"}`}>
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...new Set([...form.service_ids, service.id])]
                                  : form.service_ids.filter((sid) => sid !== service.id);
                                const selectedItems = services.filter((item) => next.includes(item.id));
                                setForm((prev) => ({
                                  ...prev,
                                  service_ids: next,
                                  service_id: next[0] || "",
                                  service_name: selectedItems.map((item) => item.name).join(" + "),
                                  service_price: selectedItems.reduce((sum, item) => sum + Number(item.price || 0), 0),
                                }));
                              }}
                            />
                            <span className="text-sm truncate">{service.name}</span>
                          </span>
                          <span className="text-sm font-semibold">₹{Number(service.price || 0).toLocaleString()}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-xs text-[#6B7280]">Select one or more services. Total duration affects your suggested slot.</div>
                </div>
              ) : (
                <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Service</Label>
                  <Input value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} placeholder={isSalon ? "Haircut" : "General consultation"} className="rounded-2xl" /></div>
              )}
              <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Note (optional)</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="rounded-2xl" data-testid="book-notes" /></div>
            </div>
            <Button type="submit" disabled={busy || !isOpen} className="w-full mt-6 rounded-2xl bg-[#111827] hover:bg-[#374151] text-white shadow-lg shadow-[#111827]/20" data-testid="book-submit">
              {busy ? "Booking..." : isOpen ? "Confirm booking →" : "Currently closed"}
            </Button>
            <div className="mt-4 text-xs text-[#6B7280] text-center">You’ll receive a token after confirmation.</div>
          </form>
        </section>
      </main>
    </div>
  );
}
