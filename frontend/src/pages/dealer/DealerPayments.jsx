import { useEffect, useRef, useState } from "react";
import { api, formatErr, API_BASE } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { CheckCircle, XCircle, IndianRupee, Save, Upload, Image as ImageIcon, QrCode } from "lucide-react";
import { toast } from "sonner";

const STATUS = {
  pending: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
  verified: "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export default function DealerPayments() {
  const [adminUpi, setAdminUpi] = useState({});
  const [me, setMe] = useState(null);
  const [plans, setPlans] = useState([]);
  const [payments, setPayments] = useState({ outgoing: [], incoming: [] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", upi_txn_id: "", notes: "", screenshot_url: "" });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const [u, m, p, pl] = await Promise.all([
        api.get("/admin/upi"), api.get("/dealer/me"), api.get("/dealer/payments"), api.get("/dealer/plans"),
      ]);
      setAdminUpi(u.data); setMe(m.data); setPayments(p.data); setPlans(pl.data || []);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const saveUpi = async () => {
    try { await api.put("/dealer/me", { upi_id: me.upi_id, upi_qr_url: me.upi_qr_url || "" }); toast.success("UPI saved"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

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
      await api.post("/dealer/payments", { ...form, amount: parseFloat(form.amount) });
      toast.success("Payment submitted — awaiting admin verification");
      setOpen(false); setForm({ amount: "", upi_txn_id: "", notes: "", screenshot_url: "" }); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const verifyIncoming = async (id, ok) => {
    try { await api.post(`/dealer/payments/${id}/verify`, { status: ok ? "active" : "pending" }); toast.success(ok ? "Verified — client activated" : "Rejected"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div data-testid="dealer-payments-page">
      <PageHeader overline="Dealer / Payments" title="Payments." subtitle="Pay your subscription to admin via UPI. Verify your clients' incoming payments.">
        <Button onClick={() => setOpen(true)} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="new-payment-btn"><IndianRupee className="w-4 h-4 mr-2" />Pay Admin</Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Admin UPI / Pay To */}
        <div className="bg-[#111827] text-white rounded-sm p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60 mb-2">Pay to admin</div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight mb-4">{adminUpi.upi_name || "Admin"}</h3>
          {adminUpi.upi_id ? (
            <div className="bg-white text-[#111827] rounded-sm p-4 font-mono text-sm flex items-center justify-between" data-testid="admin-upi">
              <span>{adminUpi.upi_id}</span>
              <button onClick={() => { navigator.clipboard.writeText(adminUpi.upi_id); toast.success("Copied"); }} className="text-xs text-[#6B7280] hover:text-[#111827]">copy</button>
            </div>
          ) : <p className="text-sm text-white/60">Admin has not set a UPI ID yet.</p>}
          {adminUpi.upi_qr_url && (
            <div className="mt-4 flex items-center gap-3">
              <QrCode className="w-4 h-4 text-white/60" />
              <a href={adminUpi.upi_qr_url} target="_blank" rel="noreferrer" className="text-sm underline">View QR</a>
            </div>
          )}
        </div>

        {/* Dealer's own UPI */}
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-2">Receive from clients</div>
          <h3 className="font-display text-2xl font-extrabold tracking-tight mb-4">Your UPI</h3>
          <div className="space-y-3">
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">UPI ID</Label>
              <Input value={me?.upi_id || ""} onChange={(e) => setMe({ ...me, upi_id: e.target.value })} placeholder="name@bank" className="rounded-sm font-mono" data-testid="dealer-upi-id" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">QR image URL (optional)</Label>
              <Input value={me?.upi_qr_url || ""} onChange={(e) => setMe({ ...me, upi_qr_url: e.target.value })} placeholder="https://..." className="rounded-sm" data-testid="dealer-upi-qr" /></div>
          </div>
          {me?.plan_expires_at && (
            <div className="mt-3 text-sm text-[#6B7280]">Plan expires: <span className="font-mono">{new Date(me.plan_expires_at).toLocaleDateString()}</span></div>
          )}
          <Button onClick={saveUpi} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white mt-3" data-testid="save-dealer-upi"><Save className="w-4 h-4 mr-2" /> Save</Button>
        </div>
      </div>

      <Tabs defaultValue="outgoing">
        <TabsList className="rounded-sm bg-[#F3F4F6] mb-4">
          <TabsTrigger value="outgoing" className="rounded-sm data-[state=active]:bg-[#111827] data-[state=active]:text-white" data-testid="tab-outgoing">Paid to admin <span className="ml-2 text-[10px] font-mono opacity-70">{payments.outgoing.length}</span></TabsTrigger>
          <TabsTrigger value="incoming" className="rounded-sm data-[state=active]:bg-[#111827] data-[state=active]:text-white" data-testid="tab-incoming">From clients <span className="ml-2 text-[10px] font-mono opacity-70">{payments.incoming.length}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="outgoing">
          <PaymentsTable items={payments.outgoing} kind="outgoing" />
        </TabsContent>
        <TabsContent value="incoming">
          <PaymentsTable items={payments.incoming} kind="incoming" onVerify={verifyIncoming} />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-md" data-testid="pay-admin-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl font-extrabold tracking-tight">Pay Admin</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {adminUpi.upi_id && <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-sm p-3 font-mono text-sm">UPI: {adminUpi.upi_id}</div>}
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Subscription plan (optional)</Label>
              <select value={form.plan_id || ""} onChange={(e) => {
                const pid = e.target.value || null;
                const sel = plans.find(p => p.id === pid);
                setForm({ ...form, plan_id: pid, amount: sel ? String(sel.price || sel.amount || "") : form.amount });
              }} className="w-full rounded-sm border px-2 py-2">
                <option value="">— Select plan —</option>
                {plans.map(p => (<option key={p.id} value={p.id}>{p.name || p.type} — ₹{p.price}</option>))}
              </select>
            </div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Amount (₹)</Label>
              <Input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required className="rounded-sm" data-testid="pay-amount" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">UPI Transaction ID</Label>
              <Input value={form.upi_txn_id} onChange={(e) => setForm({ ...form, upi_txn_id: e.target.value })} required className="rounded-sm font-mono" data-testid="pay-txn" /></div>
            <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="rounded-sm" data-testid="pay-notes" /></div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Payment screenshot</Label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadShot(e.target.files?.[0])} data-testid="pay-file" />
              {form.screenshot_url ? (
                <div className="border border-[#E5E7EB] rounded-sm p-2 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-[#10B981]" />
                  <span className="text-xs flex-1 truncate">Uploaded</span>
                  <button type="button" onClick={() => setForm({ ...form, screenshot_url: "" })} className="text-red-600 text-xs">remove</button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-sm w-full" data-testid="pay-upload">
                  <Upload className="w-4 h-4 mr-2" /> {uploading ? "Uploading..." : "Upload screenshot"}
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="pay-submit">Submit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsTable({ items, kind, onVerify }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
      <Table>
        <TableHeader><TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
          <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">{kind === "incoming" ? "Client" : "Notes"}</TableHead>
          <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Amount</TableHead>
          <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">UPI Txn</TableHead>
          <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Shot</TableHead>
          <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Date</TableHead>
          <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
          {onVerify && <TableHead></TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {items.length === 0 && <TableRow><TableCell colSpan={onVerify ? 7 : 6} className="text-center py-10 text-sm text-[#6B7280]">No payments.</TableCell></TableRow>}
          {items.map((p) => (
            <TableRow key={p.id}>
              <TableCell><div className="font-semibold">{kind === "incoming" ? p.payer_name : (p.notes || "Subscription")}</div></TableCell>
              <TableCell className="text-right font-display font-extrabold">₹{Number(p.amount).toLocaleString()}</TableCell>
              <TableCell className="font-mono text-xs">{p.upi_txn_id}</TableCell>
              <TableCell>{p.screenshot_url ? <a href={`${API_BASE.replace('/api','')}${p.screenshot_url}`} target="_blank" rel="noreferrer" className="text-xs underline">View</a> : <span className="text-[10px] text-[#9CA3AF]">—</span>}</TableCell>
              <TableCell className="font-mono text-xs">{new Date(p.created_at).toLocaleDateString()}</TableCell>
              <TableCell><span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold uppercase tracking-wider ${STATUS[p.status]}`}>{p.status}</span></TableCell>
              {onVerify && (
                <TableCell className="text-right">
                  {p.status === "pending" && (
                    <>
                      <Button size="sm" variant="outline" className="rounded-sm mr-1" onClick={() => onVerify(p.id, true)} data-testid={`d-verify-${p.id}`}><CheckCircle className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="outline" className="rounded-sm text-red-600" onClick={() => onVerify(p.id, false)} data-testid={`d-reject-${p.id}`}><XCircle className="w-3.5 h-3.5" /></Button>
                    </>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
