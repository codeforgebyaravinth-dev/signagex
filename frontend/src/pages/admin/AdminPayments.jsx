import { useEffect, useState } from "react";
import { api, formatErr, API_BASE } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Wallet, CheckCircle, XCircle, IndianRupee, Save, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

const STATUS = {
  pending: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
  verified: "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export default function AdminPayments() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({ upi_id: "", upi_name: "", upi_qr_url: "" });

  const load = async () => {
    try {
      const [p, s] = await Promise.all([api.get("/admin/payments"), api.get("/admin/settings")]);
      setItems(p.data); setSettings(s.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    try { await api.put("/admin/settings", settings); toast.success("UPI settings saved"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const verify = async (id, ok) => {
    try {
      await api.post(`/admin/payments/${id}/verify`, { status: ok ? "active" : "pending" });
      toast.success(ok ? "Verified — dealer activated" : "Marked as rejected");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div data-testid="admin-payments-page">
      <PageHeader overline="Admin / Payments" title="Payments." subtitle="Configure UPI and verify dealer subscription payments." />

      <div className="bg-white border border-[#E5E7EB] rounded-sm p-6 mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280] mb-3">My UPI (admin)</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">UPI ID</Label>
            <Input value={settings.upi_id || ""} onChange={(e) => setSettings({ ...settings, upi_id: e.target.value })} placeholder="name@bank" className="rounded-sm font-mono" data-testid="upi-id" /></div>
          <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">Display name</Label>
            <Input value={settings.upi_name || ""} onChange={(e) => setSettings({ ...settings, upi_name: e.target.value })} className="rounded-sm" data-testid="upi-name" /></div>
          <div><Label className="text-xs uppercase tracking-wider text-[#6B7280]">QR image URL (optional)</Label>
            <Input value={settings.upi_qr_url || ""} onChange={(e) => setSettings({ ...settings, upi_qr_url: e.target.value })} placeholder="https://..." className="rounded-sm" data-testid="upi-qr" /></div>
        </div>
        <Button onClick={saveSettings} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="save-upi"><Save className="w-4 h-4 mr-2" /> Save</Button>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Dealer</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280] text-right">Amount</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">UPI Txn</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Screenshot</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Date</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-[#6B7280]">No payments received yet.</TableCell></TableRow>}
            {items.map((p) => (
              <TableRow key={p.id} data-testid={`payment-row-${p.id}`}>
                <TableCell><div className="font-semibold">{p.payer_display}</div><div className="text-xs text-[#6B7280]">{p.notes}</div></TableCell>
                <TableCell className="text-right"><span className="font-display font-extrabold inline-flex items-center"><IndianRupee className="w-3.5 h-3.5" />{Number(p.amount).toLocaleString()}</span></TableCell>
                <TableCell className="font-mono text-xs">{p.upi_txn_id}</TableCell>
                <TableCell>
                  {p.screenshot_url ? <a href={`${API_BASE.replace('/api', '')}${p.screenshot_url}`} target="_blank" rel="noreferrer" className="text-[#111827] hover:underline inline-flex items-center text-xs"><ImageIcon className="w-3 h-3 mr-1" />View</a> : <span className="text-[10px] text-[#9CA3AF] uppercase tracking-wider">none</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                <TableCell><span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold uppercase tracking-wider ${STATUS[p.status]}`}>{p.status}</span></TableCell>
                <TableCell className="text-right">
                  {p.status === "pending" && (
                    <>
                      <Button size="sm" variant="outline" className="rounded-sm mr-1" onClick={() => verify(p.id, true)} data-testid={`verify-${p.id}`}><CheckCircle className="w-3.5 h-3.5 mr-1" />Verify</Button>
                      <Button size="sm" variant="outline" className="rounded-sm text-red-600" onClick={() => verify(p.id, false)} data-testid={`reject-${p.id}`}><XCircle className="w-3.5 h-3.5" /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
