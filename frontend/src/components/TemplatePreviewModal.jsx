import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";

// Comprehensive demo content with real Unsplash images - paired with SignagePlayer rendering
const DEMO_CONTENT = {
  "menu-board": {
    zones: {
      "zone-1": [
        { kind: "image", url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=600&fit=crop", name: "Pasta", duration: 6 },
        { kind: "image", url: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&h=600&fit=crop", name: "Salad", duration: 6 },
      ],
      "zone-2": [{ kind: "text", text: "SPECIALS TODAY\n\n🍝 Pasta Carbonara\n$16.99\n\n🍷 Wine Pairing\n$12.00", duration: 12 }],
      "zone-3": [{ kind: "text", text: "🔥 HAPPY HOUR 4-6PM • Order online at restaurant.com", duration: 12 }],
    }
  },
  "news-wall": {
    zones: {
      "zone-1": [{ kind: "image", url: "https://images.unsplash.com/photo-1585647343925-4d0e22867cff?w=1000&h=600&fit=crop", name: "Breaking", duration: 8 }],
      "zone-2": [{ kind: "image", url: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=500&h=400&fit=crop", name: "News 2", duration: 8 }],
      "zone-3": [{ kind: "image", url: "https://images.unsplash.com/photo-1504681869696-d977211a0519?w=500&h=400&fit=crop", name: "News 3", duration: 8 }],
      "zone-4": [{ kind: "image", url: "https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=500&h=400&fit=crop", name: "News 4", duration: 8 }],
    }
  },
  "retail-promo": {
    zones: {
      "zone-1": [
        { kind: "image", url: "https://images.unsplash.com/photo-1505228395891-9a51e7e86e81?w=1200&h=800&fit=crop", name: "Fashion", duration: 7 },
        { kind: "image", url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1200&h=800&fit=crop", name: "Accessories", duration: 7 },
      ],
      "zone-2": [
        { kind: "image", url: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=500&h=400&fit=crop", name: "Product", duration: 6 },
      ],
      "zone-3": [{ kind: "text", text: "🎉 SUMMER SALE\n50% OFF ALL ITEMS\nFree Shipping • Limited Time", duration: 12 }],
    }
  },
  "corporate-dashboard": {
    zones: {
      "zone-1": [{ kind: "text", text: "Q2 2025\nRevenue\n$2.3M", duration: 10 }],
      "zone-2": [
        { kind: "image", url: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=400&fit=crop", name: "Team", duration: 10 },
      ],
      "zone-3": [{ kind: "text", text: "📈 Growth\n+15%\nYoY", duration: 10 }],
      "zone-4": [{ kind: "text", text: "✅ On Track\nAll Targets Met\nQuarter Strong", duration: 10 }],
    }
  },
  "sports": {
    zones: {
      "zone-1": [{ kind: "image", url: "https://images.unsplash.com/photo-1517836357463-d25ddfcbf042?w=1200&h=800&fit=crop", name: "Stadium", duration: 10 }],
      "zone-2": [{ kind: "text", text: "HOME 3\nAWAY 2\n\n🏆 FINAL\nWIN!", duration: 10 }],
    }
  },
  "hotel-welcome": {
    zones: {
      "zone-1": [
        { kind: "image", url: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1000&h=800&fit=crop", name: "Lobby", duration: 10 },
      ],
      "zone-2": [{ kind: "text", text: "WELCOME!\nCheck-in 3PM\nCheck-out 11AM", duration: 10 }],
      "zone-3": [{ kind: "text", text: "🎁 Loyalty Rewards\nFree Breakfast\nRoom Upgrade", duration: 10 }],
    }
  },
  "healthcare": {
    zones: {
      "zone-1": [{ kind: "text", text: "NOW SERVING\n👉 A-23", duration: 8 }],
      "zone-2": [
        { kind: "image", url: "https://images.unsplash.com/photo-1576091160550-112173e7d871?w=600&h=500&fit=crop", name: "Health", duration: 10 },
      ],
      "zone-3": [{ kind: "text", text: "⏱️ Wait Time\n15 minutes", duration: 10 }],
    }
  },
  "hero-ticker": {
    zones: {
      "zone-1": [
        { kind: "image", url: "https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=1200&h=800&fit=crop", name: "Hero", duration: 10 },
      ],
      "zone-2": [{ kind: "text", text: "📢 TRENDING • New Product Launch Today • Special Offer Inside • Shop Now →", duration: 12 }],
    }
  },
  "default": {
    zones: {
      "zone-1": [
        { kind: "image", url: "https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=1200&h=800&fit=crop", name: "Content", duration: 8 },
      ],
    }
  }
};

// MediaSlot component - similar to SignagePlayer's MediaSlot
function MediaSlot({ items, label }) {
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => { 
    setIdx(0); 
  }, [items?.length]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const cur = items[idx];
    if (!cur) return;
    if (cur.kind === "video") return;
    timerRef.current = setTimeout(() => setIdx((i) => (i + 1) % items.length), (cur.duration || 10) * 1000);
    return () => clearTimeout(timerRef.current);
  }, [idx, items]);

  if (!items || items.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-white/50 text-xs font-mono uppercase tracking-widest">{label}</div>;
  }

  const cur = items[idx];
  if (!cur) return null;

  if (cur.kind === "text") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1E293B] to-[#0F172A] p-6 text-center">
        <div className="text-white font-bold text-lg leading-relaxed whitespace-pre-wrap">{cur.text}</div>
      </div>
    );
  }

  return cur.kind === "image" ? (
    <img 
      src={cur.url} 
      alt={cur.name} 
      className="w-full h-full object-cover" 
      onError={(e) => { e.target.src = "https://images.unsplash.com/photo-1552820728-8ac41f1ce891?w=800&q=80"; }} 
    />
  ) : (
    <video 
      src={cur.url} 
      autoPlay 
      muted 
      playsInline 
      className="w-full h-full object-cover" 
      onEnded={() => setIdx((i) => (i + 1) % items.length)} 
      onError={() => setIdx((i) => (i + 1) % items.length)} 
    />
  );
}

export default function TemplatePreviewModal({ open, onOpenChange, template, layout }) {
  if (!open || !template) return null;

  // Detect template type from ID
  const demoKey = template.id?.includes("menu") ? "menu-board"
    : template.id?.includes("news") ? "news-wall"
    : template.id?.includes("retail") ? "retail-promo"
    : template.id?.includes("corporate") || template.id?.includes("dashboard") ? "corporate-dashboard"
    : template.id?.includes("sports") ? "sports"
    : template.id?.includes("ticker") || template.id?.includes("hero-ticker") ? "hero-ticker"
    : template.id?.includes("hotel") ? "hotel-welcome"
    : template.id?.includes("hospital") || template.id?.includes("clinic") ? "healthcare"
    : "default";

  const demoContent = DEMO_CONTENT[demoKey] || DEMO_CONTENT.default;
  const normalized = layout || template.layout || {};
  const zones = normalized.zones || [];
  const canvasWidth = normalized.canvas_width || 1920;
  const canvasHeight = normalized.canvas_height || 1080;

  // Map demo content to zones
  const zoneContent = zones.reduce((acc, zone) => {
    acc[zone.id] = demoContent.zones[zone.id] || demoContent.zones[Object.keys(demoContent.zones)[0]] || [];
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0 overflow-hidden rounded-2xl">
        <DialogHeader className="border-b border-[#E5E7EB] px-6 py-4 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="font-display text-lg font-bold text-[#111827]">{template.name}</DialogTitle>
              <p className="text-sm text-[#6B7280] mt-1">{template.description}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 overflow-y-auto bg-[#F9FAFB]" style={{ maxHeight: "calc(90vh - 140px)" }}>
          {/* Live Preview - SignagePlayer style rendering */}
          <div
            className="mx-auto rounded-lg overflow-hidden bg-black shadow-xl border-4 border-gray-300"
            style={{
              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
              maxWidth: "100%",
              width: "100%",
              maxHeight: "70vh",
            }}
          >
            {zones.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-white/40 text-sm font-mono">Empty Template</div>
            ) : (
              <div className="w-full h-full relative" style={{ display: "grid" }}>
                {zones.map((zone) => {
                  const items = zoneContent[zone.id] || [];
                  const left = ((Number(zone.x) || 0) / canvasWidth) * 100;
                  const top = ((Number(zone.y) || 0) / canvasHeight) * 100;
                  const width = ((Number(zone.width_px) || canvasWidth) / canvasWidth) * 100;
                  const height = ((Number(zone.height_px) || canvasHeight) / canvasHeight) * 100;

                  return (
                    <div
                      key={zone.id}
                      className="absolute overflow-hidden"
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                      }}
                    >
                      <MediaSlot items={items} label={zone.name} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info Cards */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="p-4 bg-white rounded-lg border border-[#E5E7EB]">
              <div className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-1">Canvas Size</div>
              <div className="text-2xl font-bold text-[#111827]">{canvasWidth}×{canvasHeight}px</div>
            </div>
            <div className="p-4 bg-white rounded-lg border border-[#E5E7EB]">
              <div className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-1">Zones</div>
              <div className="text-2xl font-bold text-[#111827]">{zones.length}</div>
            </div>
            <div className="p-4 bg-white rounded-lg border border-[#E5E7EB]">
              <div className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-1">Content Type</div>
              <div className="text-sm font-bold text-[#111827]">{template.category}</div>
            </div>
          </div>

          {/* Zone Details */}
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold text-[#111827]">Zone Layout</h3>
            <div className="grid grid-cols-2 gap-3">
              {zones.map((zone) => (
                <div key={zone.id} className="p-3 bg-white rounded-lg border border-[#E5E7EB] text-xs">
                  <div className="font-semibold text-[#111827]">{zone.name}</div>
                  <div className="text-[#6B7280] mt-1">
                    {zone.width_px}×{zone.height_px}px @ ({zone.x}, {zone.y})
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[#E5E7EB] px-6 py-4 bg-white flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-lg">
            Close Preview
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
