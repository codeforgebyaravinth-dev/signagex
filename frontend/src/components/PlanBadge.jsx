import { Cloud, Usb, GitMerge } from "lucide-react";

const MAP = {
  cloud: { label: "Cloud Signage", cls: "badge-cloud", Icon: Cloud },
  usb: { label: "USB Signage", cls: "badge-usb", Icon: Usb },
  hybrid: { label: "Hybrid Signage", cls: "badge-hybrid", Icon: GitMerge },
};

export default function PlanBadge({ plan, compact = false, testid }) {
  const info = MAP[plan] || MAP.cloud;
  const { Icon } = info;
  return (
    <span
      data-testid={testid || `plan-badge-${plan}`}
      className={`inline-flex items-center gap-1.5 ${info.cls} rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider`}
    >
      <Icon className="w-3 h-3" />
      {compact ? plan.toUpperCase() : info.label}
    </span>
  );
}

export const PLANS = [
  { value: "cloud", label: "Cloud Signage" },
  { value: "usb", label: "USB Signage" },
  { value: "hybrid", label: "Hybrid Signage" },
];
