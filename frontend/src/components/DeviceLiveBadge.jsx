import { useEffect, useMemo, useState } from "react";

const ONLINE_WINDOW_MS = 45 * 1000;

function parseSeen(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function DeviceLiveBadge({ status, lastSeen }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const live = useMemo(() => {
    const seenAt = parseSeen(lastSeen);
    const isEligible = String(status || "").toLowerCase() === "paired";
    if (!isEligible || !seenAt) return false;
    return now - seenAt.getTime() <= ONLINE_WINDOW_MS;
  }, [lastSeen, now, status]);

  const label = live ? "Online" : "Offline";
  const cls = live
    ? "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30"
    : "bg-red-50 text-red-700 border-red-200";

  return (
    <span
      data-testid={`device-live-${live ? "online" : "offline"}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}