export default function PageHeader({ overline, title, subtitle, children }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8 pb-6 border-b border-[#E5E7EB]">
      <div>
        {overline && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#6B7280] mb-2">
            {overline}
          </div>
        )}
        <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tighter text-[#111827] leading-none">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-[#6B7280] mt-2">{subtitle}</p>}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
