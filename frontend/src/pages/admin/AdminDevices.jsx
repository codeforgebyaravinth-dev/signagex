import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Search, Monitor } from "lucide-react";

const STATUS = {
  paired: { label: "Paired", cls: "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30" },
  unpaired: { label: "Unpaired", cls: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30" },
  offline: { label: "Offline", cls: "bg-red-50 text-red-700 border-red-200" },
};

export default function AdminDevices() {
  const [devices, setDevices] = useState([]);
  const [search, setSearch] = useState("");
  useEffect(() => { api.get("/admin/devices").then((r) => setDevices(r.data)).catch(() => {}); }, []);

  const filtered = devices.filter((d) => !search || `${d.name} ${d.client_name} ${d.dealer_name} ${d.pair_code}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div data-testid="admin-devices-page">
      <PageHeader overline="Admin / Devices" title="Paired devices." subtitle="All signage screens registered by clients across the network." />
      <div className="relative max-w-md mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search devices..." className="pl-9 rounded-sm border-[#E5E7EB]" data-testid="search-device" />
      </div>
      <div className="bg-white border border-[#E5E7EB] rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Device</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Client</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Dealer</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Pair Code</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No devices paired yet.</TableCell></TableRow>}
            {filtered.map((d) => {
              const s = STATUS[d.status] || STATUS.unpaired;
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-[#6B7280]" />
                      <div>
                        <div className="font-semibold">{d.name}</div>
                        {d.location && <div className="text-xs text-[#6B7280]">{d.location}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{d.client_name || "—"}</TableCell>
                  <TableCell>{d.dealer_name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{d.pair_code}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold uppercase tracking-wider ${s.cls}`}>{s.label}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
