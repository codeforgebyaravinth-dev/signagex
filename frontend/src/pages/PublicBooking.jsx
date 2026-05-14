import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Stethoscope, Clock, MapPin, Phone, CalendarCheck, IndianRupee, CircleSlash } from "lucide-react";
import { toast } from "sonner";
import { formatErr } from "../lib/api";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api/public`;

export default function PublicBooking() {
  const { clientId } = useParams();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(null);
  const [form, setForm] = useState({ patient_name: "", patient_phone: "", preferred_time: "", service_name: "", notes: "" });

  useEffect(() => {
    axios.get(`${BASE}/providers/${clientId}`).then((r) => setDoc(r.data)).catch(() => setDoc(false)).finally(() => setLoading(false));
  }, [clientId]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const { data } = await axios.post(`${BASE}/providers/${clientId}/book`, form);
      setConfirmed(data);
      toast.success(`Token #${data.token} confirmed`);
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-[#6B7280] font-mono uppercase tracking-widest">Loading...</div>;
  if (!doc) return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><CircleSlash className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" /><h2 className="font-display text-2xl font-extrabold">Provider not found</h2><p className="text-sm text-[#6B7280] mt-1">This booking link is invalid.</p></div></div>;

  const profile = doc.profile || {};
  const isOpen = profile.is_open !== false;
  const isSalon = doc.vertical === "salon";
  const providerLabel = isSalon ? "Salon" : "Clinic";
  const serviceLabel = isSalon ? "service" : "appointment";

  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] p-6">
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-10 max-w-md w-full text-center">
          <CalendarCheck className="w-12 h-12 text-[#10B981] mx-auto mb-4" />
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">Booking confirmed</div>
          <h2 className="font-display text-3xl font-extrabold tracking-tighter">Your token</h2>
          <div className="font-display text-7xl font-extrabold tracking-tighter my-6">#{confirmed.token}</div>
          <p className="text-sm text-[#6B7280]">Visit <strong>{doc.name}</strong> on <strong>{confirmed.date}</strong>. Show this token at the {providerLabel.toLowerCase()}.</p>
          <Button onClick={() => { setConfirmed(null); setForm({ patient_name: "", patient_phone: "", preferred_time: "", service_name: "", notes: "" }); }} variant="outline" className="rounded-sm mt-6" data-testid="book-another">Book another</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="bg-[#111827] text-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <div className="w-8 h-8 bg-white text-[#111827] flex items-center justify-center rounded-sm"><Stethoscope className="w-4 h-4" /></div>
          <div className="font-display font-extrabold text-lg tracking-tight">SIGNAGE OS · Storefront</div>
        </div>
      </header>
      <div className="max-w-3xl mx-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">{providerLabel}</div>
          <h1 className="font-display text-3xl font-extrabold tracking-tighter mb-2">{doc.name}</h1>
          {profile.image_url && <img src={profile.image_url} alt={doc.name} className="w-full h-36 object-cover rounded-sm mb-4 border border-[#E5E7EB]" />}
          {profile.specialty && <p className="text-sm text-[#374151] mb-4">{profile.specialty}</p>}
          {profile.description && <p className="text-sm text-[#374151] mb-4">{profile.description}</p>}
          <ul className="space-y-2 text-sm text-[#374151]">
            {profile.qualifications && <li className="flex items-center gap-2"><Stethoscope className="w-4 h-4 text-[#6B7280]" /> {profile.qualifications}</li>}
            {profile.hours && <li className="flex items-center gap-2"><Clock className="w-4 h-4 text-[#6B7280]" /> {profile.hours}</li>}
            {doc.address && <li className="flex items-center gap-2"><MapPin className="w-4 h-4 text-[#6B7280]" /> {doc.address}</li>}
            {doc.phone && <li className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#6B7280]" /> {doc.phone}</li>}
            {profile.fee > 0 && <li className="flex items-center gap-2"><IndianRupee className="w-4 h-4 text-[#6B7280]" /> Consultation ₹{profile.fee}</li>}
          </ul>
          <div className="mt-6 pt-6 border-t border-[#E5E7EB] flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280]">Today's queue</div>
              <div className="font-display text-3xl font-extrabold">{doc.queue_length} waiting</div>
            </div>
            <span className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded-sm border ${isOpen ? "badge-hybrid" : "badge-usb"}`}>{isOpen ? "Open" : "Closed"}</span>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white border border-[#E5E7EB] rounded-sm p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">Book {serviceLabel}</div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight mb-4">Get your token.</h2>
          <div className="space-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Your name</Label>
              <Input value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} required className="rounded-sm" data-testid="book-name" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Phone</Label>
              <Input value={form.patient_phone} onChange={(e) => setForm({ ...form, patient_phone: e.target.value })} required className="rounded-sm" data-testid="book-phone" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Preferred time</Label>
              <Input value={form.preferred_time} onChange={(e) => setForm({ ...form, preferred_time: e.target.value })} placeholder="10:30 AM" className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Service</Label>
              <Input value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} placeholder={isSalon ? "Haircut" : "General consultation"} className="rounded-sm" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Note (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="rounded-sm" data-testid="book-notes" /></div>
          </div>
          <Button type="submit" disabled={busy || !isOpen} className="w-full mt-6 rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="book-submit">
            {busy ? "Booking..." : isOpen ? "Confirm booking →" : "Currently closed"}
          </Button>
        </form>
      </div>
    </div>
  );
}
