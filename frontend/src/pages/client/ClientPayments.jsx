import { useEffect, useRef, useState } from "react";
import { api, formatErr, API_BASE } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { IndianRupee, Upload, Image as ImageIcon, QrCode } from "lucide-react";
import { toast } from "sonner";

const STATUS = {
  pending: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
  verified: "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export default function ClientPayments() {
  const [dealerUpi, setDealerUpi] = useState({});
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", upi_txn_id: "", notes: "", screenshot_url: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const [u, p] = await Promise.all([api.get("/client/my-dealer-upi"), api.get("/client/payments")]);
      setDealerUpi(u.data); setItems(p.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const uploadShot = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/payments/upload-screenshot", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm((f) => ({ ...f, screenshot_url: data.url }));
      toast.success("Screenshot uploaded");
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/client/payments", { ...form, amount: parseFloat(form.amount) });
      toast.success("Payment submitted — awaiting dealer verification");
      setOpen(false); setForm({ amount: "", upi_txn_id: "", notes: "", screenshot_url: "" }); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div data-testid="client-payments-page">
      <PageHeader overline="Client / Payments" title="Pay your dealer." subtitle="Submit your subscription payment with the UPI transaction ID and screenshot.">
        <Button onClick={() => setOpen(true)} disabled={!dealerUpi.upi_id} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="client-pay-btn"><IndianRupee className="w-4 h-4 mr-2" />Pay Dealer</Button>
      </PageHeader>

      <div className="bg-[#111827] text-white rounded-sm p-6 mb-8 max-w-xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-2">Pay to dealer</div>
        <h3 className="font-display text-2xl font-extrabold tracking-tight mb-4">{dealerUpi.dealer_name || "Your dealer"}</h3>
        {dealerUpi.upi_id ? (
          <div className="bg-white text-[#111827] rounded-sm p-4 font-mono text-sm flex items-center justify-between" data-testid="dealer-upi-display">
            <span>{dealerUpi.upi_id}</span>
            <button onClick={() => { navigator.clipboard.writeText(dealerUpi.upi_id); toast.success("Copied"); }} className="text-xs text-[#6B7280] hover:text-[#111827]">copy</button>
          </div>
        ) : <p className="text-sm text-white/60">Your dealer has not set a UPI ID yet. Contact them.</p>}
        {dealerUpi.upi_qr_url && <div className="mt-4 flex items-center gap-2"><QrCode className="w-4 h-4 text-white/60" /><a href={dealerUpi.upi_qr_url} target="_blank" rel="noreferrer" className="text-sm underline">View QR</a></div>}
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Notes</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Amount</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">UPI Txn</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Screenshot</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Date</TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-[#6B7280]">No payments yet.</TableCell></TableRow>}
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell><div className="font-semibold">{p.notes || "Subscription"}</div></TableCell>
                <TableCell className="text-right font-display font-extrabold">₹{Number(p.amount).toLocaleString()}</TableCell>
                <TableCell className="font-mono text-xs">{p.upi_txn_id}</TableCell>
                <TableCell>{p.screenshot_url ? <a href={`${API_BASE.replace('/api','')}${p.screenshot_url}`} target="_blank" rel="noreferrer" className="text-xs underline">View</a> : <span className="text-[10px] text-[#9CA3AF]">—</span>}</TableCell>
                <TableCell className="font-mono text-xs">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                <TableCell><span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold uppercase tracking-wider ${STATUS[p.status]}`}>{p.status}</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-md" data-testid="client-pay-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">Pay Dealer</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-sm p-3 font-mono text-sm">UPI: {dealerUpi.upi_id}</div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Amount (₹)</Label>
              <Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required className="rounded-sm" data-testid="c-pay-amount" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">UPI Transaction ID</Label>
              <Input value={form.upi_txn_id} onChange={(e) => setForm({ ...form, upi_txn_id: e.target.value })} required className="rounded-sm font-mono" data-testid="c-pay-txn" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="rounded-sm" data-testid="c-pay-notes" /></div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Payment screenshot</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadShot(e.target.files?.[0])} data-testid="c-pay-file" />
              {form.screenshot_url ? (
                <div className="border border-[#E5E7EB] rounded-sm p-2 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-[#10B981]" /><span className="text-xs flex-1 truncate">Uploaded</span>
                  <button type="button" onClick={() => setForm({ ...form, screenshot_url: "" })} className="text-red-600 text-xs">remove</button></div>
              ) : (
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-sm w-full" data-testid="c-pay-upload">
                  <Upload className="w-4 h-4 mr-2" /> {uploading ? "Uploading..." : "Upload screenshot"}
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="c-pay-submit">Submit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
