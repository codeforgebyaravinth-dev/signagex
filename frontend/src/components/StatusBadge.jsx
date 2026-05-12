const MAP = {
  active: "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30",
  pending: "bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30",
  suspended: "bg-red-50 text-red-700 border-red-200",
};

export default function StatusBadge({ status }) {
  const s = status || "active";
  return (
    <span data-testid={`status-${s}`} className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold uppercase tracking-wider ${MAP[s] || MAP.active}`}>
      {s}
    </span>
  );
}
