export default function KpiCard({ label, value, hint, Icon, accent = "#111827", testid }) {
  return (
    <div
      data-testid={testid}
      className="dense-card bg-white border border-[#E5E7EB] rounded-sm p-6"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6B7280]">
          {label}
        </div>
        {Icon && (
          <div className="w-8 h-8 flex items-center justify-center rounded-sm" style={{ background: `${accent}10`, color: accent }}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <div className="font-display text-4xl font-extrabold tracking-tighter text-[#111827] leading-none">{value}</div>
      {hint && <div className="text-xs text-[#6B7280] mt-3">{hint}</div>}
    </div>
  );
}
