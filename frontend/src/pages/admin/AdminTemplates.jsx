import { useEffect, useRef, useState } from "react";
import { api, formatErr } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import PlanBadge, { PLANS } from "../../components/PlanBadge";
import TemplatePreviewModal from "../../components/TemplatePreviewModal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "../../components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Plus, Pencil, Trash2, Search, Grid2X2, Grid3X3, Columns2, Monitor, Eye } from "lucide-react";
import { toast } from "sonner";

const FALLBACK_THUMB = "https://images.unsplash.com/photo-1686362060774-1786ef7bf4db?w=400&q=80";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

const presetZone = (id, name, x, y, width_px, height_px, role = "") => ({ id, name, x, y, width_px, height_px, role });

const parseNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
};

const parseDimension = (value, total) => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (trimmed.endsWith("%")) {
      const pct = Number.parseFloat(trimmed);
      if (Number.isFinite(pct)) return Math.max(1, Math.round((pct / 100) * total));
    }
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) return Math.max(1, Math.round(parsed));
  }
  return null;
};

const normalizeZone = (zone, index, canvasWidth, canvasHeight, totalZones) => {
  const legacyPosition = typeof zone?.position === "string" ? zone.position.split(",").map((part) => Number.parseFloat(part.trim())) : [];
  const x = Number.isFinite(Number(zone?.x))
    ? parseNumber(zone.x)
    : Number.isFinite(legacyPosition[0])
      ? parseNumber(legacyPosition[0])
      : null;
  const y = Number.isFinite(Number(zone?.y))
    ? parseNumber(zone.y)
    : Number.isFinite(legacyPosition[1])
      ? parseNumber(legacyPosition[1])
      : null;
  const width_px = parseDimension(zone?.width_px ?? zone?.width, canvasWidth);
  const height_px = parseDimension(zone?.height_px ?? zone?.height, canvasHeight);

  return {
    id: zone?.id || `zone-${Date.now()}-${index}`,
    name: zone?.name || `Zone ${index + 1}`,
    role: zone?.role || zone?.type || "",
    x,
    y,
    width_px: width_px ?? Math.max(1, Math.round(canvasWidth / Math.max(1, totalZones || 1))),
    height_px: height_px ?? Math.max(1, Math.round(canvasHeight / Math.max(1, totalZones || 1))),
    width: zone?.width ?? "",
    height: zone?.height ?? "",
    position: zone?.position ?? "",
  };
};

const legacyGridLayout = (zones, canvasWidth, canvasHeight) => {
  if (zones.length === 1) {
    return [{ ...zones[0], x: 0, y: 0, width_px: canvasWidth, height_px: canvasHeight }];
  }

  if (zones.length === 2) {
    const width = Math.round(canvasWidth / 2);
    return zones.map((zone, index) => ({
      ...zone,
      x: index * width,
      y: 0,
      width_px: width,
      height_px: canvasHeight,
    }));
  }

  if (zones.length === 4) {
    const width = Math.round(canvasWidth / 2);
    const height = Math.round(canvasHeight / 2);
    return zones.map((zone, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      return {
        ...zone,
        x: col * width,
        y: row * height,
        width_px: width,
        height_px: height,
      };
    });
  }

  const height = Math.max(1, Math.round(canvasHeight / Math.max(1, zones.length)));
  return zones.map((zone, index) => ({
    ...zone,
    x: 0,
    y: index * height,
    width_px: canvasWidth,
    height_px: height,
  }));
};

const normalizeLayout = (layout = {}) => {
  const canvasWidth = parseNumber(layout.canvas_width, DEFAULT_CANVAS.width);
  const canvasHeight = parseNumber(layout.canvas_height, DEFAULT_CANVAS.height);
  const rawZones = Array.isArray(layout.zones) ? layout.zones : [];
  const normalized = rawZones.map((zone, index) => normalizeZone(zone, index, canvasWidth, canvasHeight, rawZones.length));
  const hasExplicitGeometry = rawZones.some((zone) =>
    zone && (
      zone.x != null ||
      zone.y != null ||
      zone.width_px != null ||
      zone.height_px != null ||
      (typeof zone.position === "string" && zone.position.includes(","))
    )
  );

  return {
    canvas_width: canvasWidth,
    canvas_height: canvasHeight,
    use_grid: layout.use_grid ?? true,
    zones: rawZones.length === 0 ? [] : (hasExplicitGeometry ? normalized : legacyGridLayout(normalized, canvasWidth, canvasHeight)),
    main: layout.main || "",
    sidebar: layout.sidebar || "",
    ticker: layout.ticker || "",
  };
};

const detectPresetKey = (layout = {}) => {
  const normalized = normalizeLayout(layout);
  const match = LAYOUT_PRESETS.find((preset) =>
    preset.canvas_width === normalized.canvas_width &&
    preset.canvas_height === normalized.canvas_height &&
    preset.use_grid === normalized.use_grid &&
    preset.zones.length === normalized.zones.length
  );
  return match ? match.key : "custom";
};

const empty = {
  name: "", category: "", description: "", thumbnail_url: "", plan: "cloud", assigned_dealer_ids: [],
  layout: { canvas_width: 1920, canvas_height: 1080, use_grid: true, zones: [], main: "", sidebar: "", ticker: "" },
};

const LAYOUT_PRESETS = [
  {
    key: "landscape",
    name: "Landscape - 1920x1080",
    icon: Monitor,
    canvas_width: 1920,
    canvas_height: 1080,
    use_grid: true,
    zones: [presetZone("zone-1", "Zone 1", 0, 0, 528, 270)],
  },
  {
    key: "split",
    name: "2-Zone Split",
    icon: Columns2,
    canvas_width: 1920,
    canvas_height: 1080,
    use_grid: true,
    zones: [
      presetZone("zone-1", "Screen 1", 0, 0, 960, 1080),
      presetZone("zone-2", "Screen 2", 960, 0, 960, 1080),
    ],
  },
  {
    key: "grid",
    name: "4-Zone Grid",
    icon: Grid3X3,
    canvas_width: 1920,
    canvas_height: 1080,
    use_grid: true,
    zones: [
      presetZone("zone-1", "Top Left", 0, 0, 960, 540),
      presetZone("zone-2", "Top Right", 960, 0, 960, 540),
      presetZone("zone-3", "Bottom Left", 0, 540, 960, 540),
      presetZone("zone-4", "Bottom Right", 960, 540, 960, 540),
    ],
  },
  {
    key: "portrait",
    name: "Portrait - 1080x1920",
    icon: Grid2X2,
    canvas_width: 1080,
    canvas_height: 1920,
    use_grid: true,
    zones: [presetZone("zone-1", "Main Zone", 0, 0, 1080, 1920)],
  },
  {
    key: "square",
    name: "Square - 1080x1080",
    icon: Grid2X2,
    canvas_width: 1080,
    canvas_height: 1080,
    use_grid: true,
    zones: [presetZone("zone-1", "Main Zone", 0, 0, 1080, 1080)],
  },
];

const starterTemplate = (id, name, subtitle, canvas_width, canvas_height, zones, category = "General") => ({
  id,
  name,
  category,
  description: subtitle,
  plan: "cloud",
  assigned_dealer_ids: [],
  thumbnail_url: "",
  layout: {
    canvas_width,
    canvas_height,
    use_grid: true,
    zones,
    main: "",
    sidebar: "",
    ticker: "",
  },
});

const DEFAULT_LAYOUT_LIBRARY = [
  starterTemplate("blank-canvas", "Blank canvas", "Start from scratch with a fully empty layout.", 1920, 1080, []),
  starterTemplate("full-screen", "Single full screen", "One zone for a hero visual, video, or announcement.", 1920, 1080, [presetZone("zone-1", "Main", 0, 0, 1920, 1080)]),
  starterTemplate("portrait-full", "Portrait full screen", "Vertical signage for kiosks and tall displays.", 1080, 1920, [presetZone("zone-1", "Main", 0, 0, 1080, 1920)]),
  starterTemplate("split-vertical", "Two zone vertical split", "Left and right panels for promo + message.", 1920, 1080, [presetZone("zone-1", "Left", 0, 0, 960, 1080), presetZone("zone-2", "Right", 960, 0, 960, 1080)]),
  starterTemplate("split-horizontal", "Two zone horizontal split", "Top and bottom panes for mixed content.", 1920, 1080, [presetZone("zone-1", "Top", 0, 0, 1920, 540), presetZone("zone-2", "Bottom", 0, 540, 1920, 540)]),
  starterTemplate("hero-ticker", "Hero with ticker", "Main hero panel with a rolling ticker strip.", 1920, 1080, [presetZone("zone-1", "Hero", 0, 0, 1920, 870), presetZone("zone-2", "Ticker", 0, 870, 1920, 210)], "Ticker"),
  starterTemplate("hero-sidebar-ticker", "Hero + sidebar + ticker", "Classic broadcast layout with side info and ticker.", 1920, 1080, [presetZone("zone-1", "Hero", 0, 0, 1320, 870), presetZone("zone-2", "Sidebar", 1320, 0, 600, 870), presetZone("zone-3", "Ticker", 0, 870, 1920, 210)], "Broadcast"),
  starterTemplate("news-wall", "News wall", "Four content tiles for headlines, clips, or ad blocks.", 1920, 1080, [presetZone("zone-1", "Top Left", 0, 0, 960, 540), presetZone("zone-2", "Top Right", 960, 0, 960, 540), presetZone("zone-3", "Bottom Left", 0, 540, 960, 540), presetZone("zone-4", "Bottom Right", 960, 540, 960, 540)], "News"),
  starterTemplate("menu-board", "Digital menu board", "Restaurant-style board with menu zones and promo panel.", 1920, 1080, [presetZone("zone-1", "Menu Left", 0, 0, 1240, 1080), presetZone("zone-2", "Promo Right", 1240, 0, 680, 780), presetZone("zone-3", "Ticker", 1240, 780, 680, 300)], "Restaurant"),
  starterTemplate("menu-board-wide", "Menu board wide", "Long horizontal menu with pricing and specials.", 1920, 1080, [presetZone("zone-1", "Menu", 0, 0, 1920, 810), presetZone("zone-2", "Ticker", 0, 810, 1920, 270)], "Restaurant"),
  starterTemplate("retail-promo", "Retail promo", "Promo hero, product list, and call-to-action footer.", 1920, 1080, [presetZone("zone-1", "Hero", 0, 0, 1200, 1080), presetZone("zone-2", "Products", 1200, 0, 720, 810), presetZone("zone-3", "CTA", 1200, 810, 720, 270)], "Retail"),
  starterTemplate("corporate-dashboard", "Corporate dashboard", "Dashboard-style update board for internal messaging.", 1920, 1080, [presetZone("zone-1", "Stats", 0, 0, 640, 540), presetZone("zone-2", "News", 640, 0, 640, 540), presetZone("zone-3", "Alerts", 1280, 0, 640, 540), presetZone("zone-4", "Footer", 0, 540, 1920, 540)], "Corporate"),
  starterTemplate("meeting-room", "Meeting room", "Agenda, room schedule, and live announcement zones.", 1920, 1080, [presetZone("zone-1", "Agenda", 0, 0, 1260, 1080), presetZone("zone-2", "Room Info", 1260, 0, 660, 540), presetZone("zone-3", "Ticker", 1260, 540, 660, 540)], "Corporate"),
  starterTemplate("modern-booking-board", "Modern booking board", "Date, time, weather, and today's bookings in a premium lobby layout.", 1920, 1080, [presetZone("zone-1", "Date & Time", 0, 0, 1920, 150, "header"), presetZone("zone-2", "Weather", 0, 150, 560, 930, "weather"), presetZone("zone-3", "Today's bookings", 560, 150, 980, 930, "bookings"), presetZone("zone-4", "Welcome", 1540, 150, 380, 930, "hero")], "Hospitality"),
  starterTemplate("hospital-waiting", "Hospital waiting room", "Patient queue, announcements, and calm ambient panel.", 1920, 1080, [presetZone("zone-1", "Queue", 0, 0, 760, 1080, "queue"), presetZone("zone-2", "Announcements", 760, 0, 1160, 780), presetZone("zone-3", "Ticker", 760, 780, 1160, 300, "ticker")], "Healthcare"),
  starterTemplate("clinic-portrait", "Clinic portrait", "Tall queue board for check-in and token display.", 1080, 1920, [presetZone("zone-1", "Queue", 0, 0, 1080, 1280, "queue"), presetZone("zone-2", "Info", 0, 1280, 1080, 420), presetZone("zone-3", "Ticker", 0, 1700, 1080, 220, "ticker")], "Healthcare"),
  starterTemplate("clinic-portrait-logo", "Clinic portrait with logo", "Full portrait queue board with a dedicated logo zone and ticker.", 1080, 1920, [presetZone("zone-1", "Logo", 0, 0, 1080, 260, "logo"), presetZone("zone-2", "Queue", 0, 260, 1080, 1360, "queue"), presetZone("zone-3", "Ticker", 0, 1620, 1080, 300, "ticker")], "Healthcare"),
  starterTemplate("school-board", "School announcement board", "Timetable, notices, and campus ticker layout.", 1920, 1080, [presetZone("zone-1", "Notices", 0, 0, 1240, 1080), presetZone("zone-2", "Timetable", 1240, 0, 680, 780), presetZone("zone-3", "Ticker", 1240, 780, 680, 300)], "Education"),
  starterTemplate("transport-board", "Transport board", "Departure board with side update panel and ticker.", 1920, 1080, [presetZone("zone-1", "Departures", 0, 0, 1380, 870), presetZone("zone-2", "Service Info", 1380, 0, 540, 870), presetZone("zone-3", "Ticker", 0, 870, 1920, 210)], "Transportation"),
  starterTemplate("hotel-welcome", "Hotel welcome", "Lobby welcome screen with offers and scrolling news.", 1920, 1080, [presetZone("zone-1", "Welcome", 0, 0, 1240, 1080), presetZone("zone-2", "Offers", 1240, 0, 680, 780), presetZone("zone-3", "Ticker", 1240, 780, 680, 300)], "Hospitality"),
  starterTemplate("event-stage", "Event stage screen", "Stage slides, sponsor strip, and live ticker area.", 1920, 1080, [presetZone("zone-1", "Main Stage", 0, 0, 1500, 870), presetZone("zone-2", "Sponsors", 1500, 0, 420, 870), presetZone("zone-3", "Ticker", 0, 870, 1920, 210)], "Events"),
  starterTemplate("lobby-social", "Lobby social wall", "Social feed, hero panel, and ticker for live updates.", 1920, 1080, [presetZone("zone-1", "Feed", 0, 0, 1080, 1080), presetZone("zone-2", "Hero", 1080, 0, 840, 780), presetZone("zone-3", "Ticker", 1080, 780, 840, 300)], "Social"),
  starterTemplate("kiosk-portrait", "Portrait kiosk", "Tall kiosk with CTA, QR, and supporting ticker.", 1080, 1920, [presetZone("zone-1", "Hero", 0, 0, 1080, 980), presetZone("zone-2", "CTA", 0, 980, 1080, 360), presetZone("zone-3", "Ticker", 0, 1340, 1080, 580)], "Kiosk"),
  starterTemplate("digital-signage-rss", "RSS ticker screen", "News panel with dedicated RSS ticker band.", 1920, 1080, [presetZone("zone-1", "News", 0, 0, 1920, 780), presetZone("zone-2", "RSS Ticker", 0, 780, 1920, 300)], "Ticker"),
  starterTemplate("sports-scoreboard", "Sports scoreboard", "Scores, sponsor area, and live ticker for updates.", 1920, 1080, [presetZone("zone-1", "Scores", 0, 0, 1280, 810), presetZone("zone-2", "Sponsor", 1280, 0, 640, 810), presetZone("zone-3", "Ticker", 0, 810, 1920, 270)], "Sports"),
  starterTemplate("finance-board", "Finance board", "Market data wall with ticker for live prices.", 1920, 1080, [presetZone("zone-1", "Charts", 0, 0, 1280, 1080), presetZone("zone-2", "Quotes", 1280, 0, 640, 780), presetZone("zone-3", "Ticker", 1280, 780, 640, 300)], "Finance"),
  starterTemplate("feed-and-ticker", "Feed and ticker", "Vertical feed with slim ticker for headlines.", 1920, 1080, [presetZone("zone-1", "Feed", 0, 0, 1440, 1080), presetZone("zone-2", "Ticker", 1440, 0, 480, 1080)], "News"),
  starterTemplate("quad-ads", "Quad ad wall", "Four equal promotional spots for looping campaigns.", 1920, 1080, [presetZone("zone-1", "Ad 1", 0, 0, 960, 540), presetZone("zone-2", "Ad 2", 960, 0, 960, 540), presetZone("zone-3", "Ad 3", 0, 540, 960, 540), presetZone("zone-4", "Ad 4", 960, 540, 960, 540)], "Advertising"),
  starterTemplate("portrait-promo-wall", "Portrait promo wall", "Tall promo layout for narrow digital displays.", 1080, 1920, [presetZone("zone-1", "Promo", 0, 0, 1080, 1320), presetZone("zone-2", "Offer", 0, 1320, 1080, 360), presetZone("zone-3", "Ticker", 0, 1680, 1080, 240)], "Advertising"),
  starterTemplate("welcome-double", "Welcome + info", "Welcome hero with support info and ticker strip.", 1920, 1080, [presetZone("zone-1", "Welcome", 0, 0, 1240, 1080), presetZone("zone-2", "Info", 1240, 0, 680, 780), presetZone("zone-3", "Ticker", 1240, 780, 680, 300)], "General"),
];

export default function AdminTemplates() {
  const [items, setItems] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");
  const [layoutTab, setLayoutTab] = useState("all");
  const [newZoneName, setNewZoneName] = useState("");
  const [selectedPresetKey, setSelectedPresetKey] = useState(LAYOUT_PRESETS[0].key);
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const canvasRef = useRef(null);

  const load = async () => {
    try {
      const [t, d] = await Promise.all([api.get("/admin/templates"), api.get("/admin/dealers")]);
      setItems(t.data); setDealers(d.data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...empty, layout: normalizeLayout(empty.layout) });
    setSelectedPresetKey(LAYOUT_PRESETS[0].key);
    setSelectedZoneId("");
    setOpen(true);
  };
  const openEdit = (t) => {
    const normalizedLayout = normalizeLayout(t.layout || {});
    setEditing(t);
    setForm({ ...empty, ...t, layout: normalizedLayout });
    setSelectedPresetKey(detectPresetKey(normalizedLayout));
    setSelectedZoneId(normalizedLayout.zones[0]?.id || "");
    setOpen(true);
  };

  const openClone = (t) => {
    const normalizedLayout = normalizeLayout(t.layout || {});
    setEditing(null);
    setForm({
      ...empty,
      name: t.name ? `${t.name} copy` : "",
      category: t.category || "",
      description: t.description || "",
      thumbnail_url: t.thumbnail_url || "",
      plan: t.plan || "cloud",
      assigned_dealer_ids: [...(t.assigned_dealer_ids || [])],
      layout: normalizedLayout,
    });
    setSelectedPresetKey(detectPresetKey(normalizedLayout));
    setSelectedZoneId(normalizedLayout.zones[0]?.id || "");
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/admin/templates/${editing.id}`, form);
        toast.success("Template updated");
      } else {
        await api.post("/admin/templates", form);
        toast.success("Template created");
      }
      setOpen(false); load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this template?")) return;
    try { await api.delete(`/admin/templates/${id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const toggleDealer = (did) => {
    setForm((f) => {
      const has = f.assigned_dealer_ids.includes(did);
      return { ...f, assigned_dealer_ids: has ? f.assigned_dealer_ids.filter((x) => x !== did) : [...f.assigned_dealer_ids, did] };
    });
  };

  const applyPreset = (preset) => {
    const zones = preset.zones.map((zone, idx) => ({ ...zone, id: `zone-${Date.now()}-${idx}` }));
    setForm((current) => ({
      ...current,
      layout: {
        canvas_width: preset.canvas_width,
        canvas_height: preset.canvas_height,
        use_grid: preset.use_grid ?? true,
        zones,
        main: "",
        sidebar: "",
        ticker: "",
      },
    }));
    setSelectedPresetKey(preset.key);
    setSelectedZoneId(zones[0]?.id || "");
    setNewZoneName("");
    toast.success(`Applied "${preset.name}" layout`);
  };

  const addZone = (point = null) => {
    const layout = normalizeLayout(form.layout);
    const zones = layout.zones || [];
    const name = newZoneName.trim() || `Zone ${zones.length + 1}`;
    if (zones.find((z) => z.name.toLowerCase() === name.toLowerCase())) {
      toast.error("Zone name must be unique");
      return;
    }

    const width_px = Math.max(240, Math.round(layout.canvas_width * 0.22));
    const height_px = Math.max(180, Math.round(layout.canvas_height * 0.2));
    const maxX = Math.max(0, layout.canvas_width - width_px);
    const maxY = Math.max(0, layout.canvas_height - height_px);
    const x = point?.x != null ? Math.max(0, Math.min(maxX, Math.round(point.x - width_px / 2))) : Math.round(Math.min(maxX, layout.canvas_width * 0.1));
    const y = point?.y != null ? Math.max(0, Math.min(maxY, Math.round(point.y - height_px / 2))) : Math.round(Math.min(maxY, layout.canvas_height * 0.1));
    const newZone = { id: `zone-${Date.now()}`, name, x, y, width_px, height_px, width: "", height: "", position: "" };

    setForm((current) => ({
      ...current,
      layout: { ...layout, zones: [...zones, newZone] },
    }));
    setSelectedPresetKey("custom");
    setSelectedZoneId(newZone.id);
    setNewZoneName("");
    toast.success("Zone added");
  };

  const handleCanvasClick = (e) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const layout = normalizeLayout(form.layout);
    const x = ((e.clientX - rect.left) / rect.width) * layout.canvas_width;
    const y = ((e.clientY - rect.top) / rect.height) * layout.canvas_height;
    addZone({ x, y });
  };

  const updateZone = (zoneId, field, value) => {
    const layout = normalizeLayout(form.layout);
    const zones = layout.zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const nextValue = ["x", "y", "width_px", "height_px"].includes(field) ? parseNumber(value, 0) : value;
      return { ...zone, [field]: nextValue };
    });
    setForm((current) => ({ ...current, layout: { ...layout, zones } }));
    setSelectedPresetKey("custom");
  };

  const removeZone = (zoneId) => {
    const layout = normalizeLayout(form.layout);
    const zones = layout.zones.filter((zone) => zone.id !== zoneId);
    setForm((current) => ({ ...current, layout: { ...layout, zones } }));
    setSelectedZoneId((current) => (current === zoneId ? (zones[0]?.id || "") : current));
    setSelectedPresetKey("custom");
    toast.success("Zone removed");
  };

  const renderLayoutEditor = () => {
    const layout = normalizeLayout(form.layout);
    const zones = layout.zones || [];
    const selectedZone = zones.find((zone) => zone.id === selectedZoneId) || zones[0] || null;
    const selectedKey = selectedPresetKey || detectPresetKey(layout);
    const gridStyle = layout.use_grid
      ? {
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(17,24,39,0.06) 0, rgba(17,24,39,0.06) 1px, transparent 1px, transparent 22px), repeating-linear-gradient(90deg, rgba(17,24,39,0.06) 0, rgba(17,24,39,0.06) 1px, transparent 1px, transparent 22px)",
        }
      : { backgroundColor: "#F8FAFC" };

    return (
      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[#6B7280]">Preview canvas</p>
              <p className="text-[11px] text-[#9CA3AF]">Click the canvas to add a zone, or select a zone to edit its geometry.</p>
            </div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6B7280]">{layout.canvas_width} x {layout.canvas_height}</div>
          </div>
          <div
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="relative w-full overflow-hidden rounded-2xl border-2 border-[#111827] bg-white shadow-sm"
            style={{ aspectRatio: `${layout.canvas_width} / ${layout.canvas_height}` }}
            data-testid="layout-canvas"
          >
            <div className="absolute inset-0" style={gridStyle} />
            {zones.map((zone, index) => {
              const left = (zone.x / layout.canvas_width) * 100;
              const top = (zone.y / layout.canvas_height) * 100;
              const width = (zone.width_px / layout.canvas_width) * 100;
              const height = (zone.height_px / layout.canvas_height) * 100;
              const isSelected = zone.id === selectedZone?.id;
              return (
                <button
                  key={zone.id}
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setSelectedZoneId(zone.id); }}
                  className={`absolute flex items-center justify-center border-2 text-center transition ${isSelected ? "border-[#7C3AED] bg-[#EDE9FE]/80 text-[#4C1D95]" : "border-[#111827] bg-white/70 text-[#6B7280]"}`}
                  style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                  data-testid={`canvas-zone-${zone.id}`}
                >
                  <span className="pointer-events-none px-2 text-[11px] font-semibold leading-tight">{zone.name}</span>
                  <span className="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-[#7C3AED]" />
                  <span className="pointer-events-none absolute left-1 bottom-1 text-[9px] uppercase tracking-[0.18em] text-inherit/70">{index + 1}</span>
                </button>
              );
            })}
            {zones.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[#6B7280]">
                Click anywhere to add your first zone.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-white p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7280]">Layout type</p>
                <p className="text-[11px] text-[#9CA3AF]">Start with a preset, then fine tune each zone.</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-[#111827]">
                <Checkbox
                  checked={layout.use_grid}
                  onCheckedChange={(checked) => {
                    setSelectedPresetKey("custom");
                    setForm((current) => ({ ...current, layout: { ...layout, use_grid: checked === true } }));
                  }}
                />
                <span>Grid</span>
              </div>
            </div>
            <Select
              value={selectedKey}
              onValueChange={(value) => {
                if (value === "custom") return;
                const preset = LAYOUT_PRESETS.find((item) => item.key === value);
                if (preset) applyPreset(preset);
              }}
            >
              <SelectTrigger className="rounded-xl border-[#E5E7EB]" data-testid="layout-type-select">
                <SelectValue placeholder="Choose a layout" />
              </SelectTrigger>
              <SelectContent>
                {LAYOUT_PRESETS.map((preset) => (
                  <SelectItem key={preset.key} value={preset.key}>{preset.name}</SelectItem>
                ))}
                <SelectItem value="custom" disabled>Custom canvas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7280]">Zone(s)</p>
                <p className="text-[11px] text-[#9CA3AF]">Click to add a zone.</p>
              </div>
              <Button type="button" size="sm" onClick={() => addZone()} className="rounded-full bg-[#111827] text-white hover:bg-[#374151]" data-testid="add-zone-btn">
                + Add Zone
              </Button>
            </div>

            <div className="space-y-3">
              {zones.length === 0 && <div className="rounded-xl border border-dashed border-[#E5E7EB] p-4 text-sm text-[#6B7280]">No zones yet. Add one from the button or click the canvas.</div>}
              {zones.map((zone, idx) => {
                const isSelected = selectedZone?.id === zone.id;
                return (
                  <div
                    key={zone.id}
                    className={`rounded-xl border p-3 transition ${isSelected ? "border-[#7C3AED] bg-[#F5F3FF]" : "border-[#E5E7EB] bg-[#FAFAFA]"}`}
                    onClick={() => setSelectedZoneId(zone.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] text-[#6B7280]">{idx + 1}</span>
                        {zone.name || `Zone ${idx + 1}`}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); removeZone(zone.id); }}
                        className="rounded-md p-1.5 text-[#9CA3AF] hover:bg-red-50 hover:text-red-600"
                        title="Remove this zone"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Name</Label>
                        <Input value={zone.name} onChange={(e) => updateZone(zone.id, "name", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">X</Label>
                          <Input type="number" min="0" value={zone.x ?? 0} onChange={(e) => updateZone(zone.id, "x", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Y</Label>
                          <Input type="number" min="0" value={zone.y ?? 0} onChange={(e) => updateZone(zone.id, "y", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Width</Label>
                          <Input type="number" min="1" value={zone.width_px ?? 0} onChange={(e) => updateZone(zone.id, "width_px", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                        </div>
                        <div>
                          <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Height</Label>
                          <Input type="number" min="1" value={zone.height_px ?? 0} onChange={(e) => updateZone(zone.id, "height_px", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7280]">Quick add</p>
                <p className="text-[11px] text-[#9CA3AF]">Optional name. New zones are placed near the pointer or canvas edge.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addZone()}
                placeholder="Zone name"
                className="rounded-xl border-[#E5E7EB] text-xs flex-1"
                data-testid="new-zone-name"
              />
              <Button type="button" size="sm" onClick={() => addZone()} className="rounded-xl bg-[#111827] hover:bg-[#374151] text-white">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {selectedZone && (
            <div className="rounded-xl border border-[#E5E7EB] bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[#6B7280]">Selected zone</p>
                  <p className="text-[11px] text-[#9CA3AF]">Edit the highlighted zone without leaving the canvas.</p>
                </div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#6B7280]">{selectedZone.name}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">X</Label>
                  <Input type="number" min="0" value={selectedZone.x ?? 0} onChange={(e) => updateZone(selectedZone.id, "x", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Y</Label>
                  <Input type="number" min="0" value={selectedZone.y ?? 0} onChange={(e) => updateZone(selectedZone.id, "y", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Width</Label>
                  <Input type="number" min="1" value={selectedZone.width_px ?? 0} onChange={(e) => updateZone(selectedZone.id, "width_px", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-[#6B7280]">Height</Label>
                  <Input type="number" min="1" value={selectedZone.height_px ?? 0} onChange={(e) => updateZone(selectedZone.id, "height_px", e.target.value)} className="mt-1 rounded-xl border-[#E5E7EB]" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const filtered = items.filter((t) => !search || `${t.name} ${t.category}`.toLowerCase().includes(search.toLowerCase()));
  const filteredStarterLayouts = DEFAULT_LAYOUT_LIBRARY.filter((t) => {
    const haystack = `${t.name} ${t.category} ${t.description}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    const layout = normalizeLayout(t.layout || {});
    const isPortrait = layout.canvas_height > layout.canvas_width;
    const isLandscape = layout.canvas_width >= layout.canvas_height;
    const isCustom = detectPresetKey(layout) === "custom";
    if (layoutTab === "portrait") return isPortrait;
    if (layoutTab === "landscape") return isLandscape;
    if (layoutTab === "custom") return isCustom;
    return true;
  });
  const filteredLayouts = filtered.filter((t) => {
    const layout = normalizeLayout(t.layout || {});
    const isPortrait = layout.canvas_height > layout.canvas_width;
    const isLandscape = layout.canvas_width >= layout.canvas_height;
    const isCustom = detectPresetKey(layout) === "custom";
    if (layoutTab === "portrait") return isPortrait;
    if (layoutTab === "landscape") return isLandscape;
    if (layoutTab === "custom") return isCustom;
    return true;
  });

  const renderCardPreview = (layout = {}) => {
    const normalized = normalizeLayout(layout);
    const zones = normalized.zones || [];
    const width = normalized.canvas_width;
    const height = normalized.canvas_height;
    return (
      <div className="relative h-full w-full overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-[#F8F8F8] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <div className="absolute inset-3 rounded-[14px] border border-[#D8D8D8] bg-white/60" />
        {zones.length === 0 ? (
          <div className="relative z-10 flex h-full items-center justify-center text-[11px] uppercase tracking-[0.18em] text-[#A1A1AA]">No zones</div>
        ) : (
          zones.map((zone) => {
            const left = ((Number(zone.x) || 0) / width) * 100;
            const top = ((Number(zone.y) || 0) / height) * 100;
            const zoneWidth = ((Number(zone.width_px) || width) / width) * 100;
            const zoneHeight = ((Number(zone.height_px) || height) / height) * 100;
            return (
              <div
                key={zone.id}
                className="absolute z-10 border border-[#BDBDBD] bg-white"
                style={{ left: `${left}%`, top: `${top}%`, width: `${zoneWidth}%`, height: `${zoneHeight}%` }}
              />
            );
          })
        )}
      </div>
    );
  };

  return (
    <div data-testid="admin-templates-page" className="min-h-[calc(100vh-80px)] bg-[#FAFAFA] -m-6 p-6">
      <div className="rounded-[28px] border border-[#E7E5E4] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
        <div className="border-b border-[#E7E5E4] px-6 pt-5 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[#6B7280]">
              <span>All Compositions</span>
              <span>/</span>
              <span className="text-[#111827] font-medium">Create Composition</span>
            </div>
            <Button onClick={() => { openCreate(); }} variant="outline" className="rounded-xl border-[#D4D4D8] bg-white text-[#111827] hover:bg-[#FAFAFA]" data-testid="create-template-btn">
              <Plus className="w-4 h-4 mr-2" /> Create Blank Layout
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-2xl font-semibold tracking-tight text-[#111827]">Create Composition</div>
            </div>
            <div className="hidden md:flex items-center gap-6 text-sm text-[#9CA3AF]">
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4F46E5] text-white text-xs font-semibold">1</span>Choose Layout</div>
              <div className="h-px w-16 bg-[#E5E7EB]" />
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E5E7EB] text-[#6B7280] text-xs font-semibold">2</span>Select Media</div>
              <div className="h-px w-16 bg-[#E5E7EB]" />
              <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E5E7EB] text-[#6B7280] text-xs font-semibold">3</span>Save Composition</div>
            </div>
          </div>
        </div>

        <div className="px-6 pt-10 pb-6 text-center">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#111827]">Choose your layout</h1>
          <p className="mt-2 text-[#6B7280]">Select a layout template that matches your screen structure. Choose between landscape and portrait orientations.</p>
        </div>

        <div className="px-6 pb-6 flex flex-col items-center gap-4">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { key: "all", label: "All" },
              { key: "portrait", label: "Portrait" },
              { key: "landscape", label: "Landscape" },
              { key: "custom", label: "Custom" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setLayoutTab(tab.key)}
                className={`rounded-xl border px-5 py-2 text-sm transition ${layoutTab === tab.key ? "border-[#111827] bg-[#111827] text-white" : "border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#FAFAFA]"}`}
              >
                {tab.label}
              </button>
            ))}
            <div className="relative min-w-[320px] max-w-[420px] flex-1">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search layout by name" className="h-11 rounded-xl border-[#E5E7EB] pl-11" data-testid="search-template" />
            </div>
          </div>
        </div>

        <div className="px-6 pb-8">
          <div className="mb-6">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-[#111827]">Starter templates</div>
                <p className="text-sm text-[#6B7280]">Use a prebuilt template or start with a blank canvas.</p>
              </div>
              <Button type="button" variant="outline" className="rounded-xl border-[#E5E7EB] bg-white" onClick={() => openCreate()}>
                Start blank
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {filteredStarterLayouts.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] py-14 text-center text-sm text-[#6B7280]">
                  No starter templates match this filter.
                </div>
              )}
              {filteredStarterLayouts.map((t) => {
                const layout = normalizeLayout(t.layout || {});
                const zoneCount = layout.zones.length || (layout.main || layout.sidebar || layout.ticker ? 3 : 1);
                const isPortrait = layout.canvas_height > layout.canvas_width;
                return (
                  <div key={t.id} className="rounded-[22px] border border-[#E7E5E4] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]" data-testid={`starter-template-${t.id}`}>
                    <div className="rounded-[18px] bg-[#F7F7F7] p-4">
                      <div className="h-[184px]">{renderCardPreview(layout)}</div>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div>
                        <div className="text-lg font-semibold text-[#111827]">{t.name}</div>
                        <div className="text-sm text-[#6B7280]">{t.description}</div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${isPortrait ? "bg-[#E8FFF7] text-[#0F766E]" : "bg-[#FFF4E6] text-[#C2410C]"}`}>{isPortrait ? "Portrait" : "Landscape"}</span>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-sm text-[#6B7280]">
                      <span className="rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">{zoneCount} Zone(s)</span>
                      <span className="flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">{layout.canvas_width} x {layout.canvas_height}</span>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button type="button" className="h-11 flex-1 rounded-xl border border-[#111827] bg-white text-[#111827] hover:bg-[#111827] hover:text-white" onClick={() => openClone(t)}>
                        Use this layout
                      </Button>
                      <Button type="button" variant="outline" className="h-11 rounded-xl border-[#E5E7EB] bg-white" onClick={() => { setPreviewTemplate(t); setPreviewOpen(true); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-10 border-t border-[#E7E5E4] pt-8">
            <div className="mb-4">
              <div className="text-lg font-semibold text-[#111827]">Your templates</div>
              <p className="text-sm text-[#6B7280]">Templates saved by admins. You can edit or duplicate these too.</p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
              {filteredLayouts.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-[#E5E7EB] bg-[#FAFAFA] py-14 text-center text-sm text-[#6B7280]">
                  No saved templates match this filter.
                </div>
              )}
              {filteredLayouts.map((t) => {
                const layout = normalizeLayout(t.layout || {});
                const zoneCount = layout.zones.length || (layout.main || layout.sidebar || layout.ticker ? 3 : 1);
                const isPortrait = layout.canvas_height > layout.canvas_width;
                return (
                  <div key={t.id} className="rounded-[22px] border border-[#E7E5E4] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]" data-testid={`template-card-${t.id}`}>
                    <div className="rounded-[18px] bg-[#F7F7F7] p-4">
                      <div className="h-[184px]">{renderCardPreview(layout)}</div>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div>
                        <div className="text-lg font-semibold text-[#111827]">{t.name}</div>
                        <div className="text-sm text-[#6B7280]">This layout can display media items in {zoneCount} zone(s)</div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${isPortrait ? "bg-[#E8FFF7] text-[#0F766E]" : "bg-[#FFF4E6] text-[#C2410C]"}`}>{isPortrait ? "Portrait" : "Landscape"}</span>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-sm text-[#6B7280]">
                      <span className="rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">{zoneCount} Zone(s)</span>
                      <span className="flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-xs">{layout.canvas_width} x {layout.canvas_height}</span>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button type="button" className="h-11 flex-1 rounded-xl border border-[#111827] bg-white text-[#111827] hover:bg-[#111827] hover:text-white" onClick={() => openClone(t)}>
                        Use this layout
                      </Button>
                      <Button type="button" variant="outline" className="h-11 rounded-xl border-[#E5E7EB] bg-white" onClick={() => { setPreviewTemplate(t); setPreviewOpen(true); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button type="button" variant="outline" className="h-11 rounded-xl border-[#E5E7EB] bg-white" onClick={() => openEdit(t)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 pb-8 text-xs text-[#9CA3AF]">Use this layout to create a new composition template, then fine tune it in the editor.</div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl max-w-6xl max-h-[90vh] overflow-y-auto" data-testid="template-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              {editing ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g., Restaurant 2-Screen" className="rounded-sm" data-testid="template-name" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Category *</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required placeholder="Restaurant, Retail, Bank..." className="rounded-sm" data-testid="template-category" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Plan</Label>
                <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                  <SelectTrigger className="rounded-sm" data-testid="template-plan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Thumbnail URL</Label>
                <Input value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} placeholder="https://..." className="rounded-sm" data-testid="template-thumb" />
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm" rows={2} placeholder="What will this template display?" data-testid="template-description" />
            </div>

            {/* LAYOUT BUILDER */}
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold uppercase tracking-widest text-[#111827]">Design Your Layout</div>
                  <p className="text-xs text-[#6B7280]">Admins can create a template layout similar to a composition editor.</p>
                </div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#6B7280]">{(form.layout?.zones || []).length} zones</div>
              </div>
              {renderLayoutEditor()}
            </div>

            {/* Assign to dealers */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-[#6B7280] mb-2 block">Assign to dealers</Label>
              <div className="border border-[#E5E7EB] rounded-sm max-h-40 overflow-y-auto p-2 space-y-1">
                {dealers.length === 0 && <p className="text-xs text-[#9CA3AF] p-2">No dealers yet.</p>}
                {dealers.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#F9FAFB] rounded-sm cursor-pointer">
                    <Checkbox
                      checked={form.assigned_dealer_ids.includes(d.id)}
                      onCheckedChange={() => toggleDealer(d.id)}
                      data-testid={`assign-dealer-${d.id}`}
                    />
                    <span className="text-sm">{d.name}</span>
                    <span className="text-xs text-[#9CA3AF]">· {d.email}</span>
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="template-submit">
                {editing ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TemplatePreviewModal 
        open={previewOpen} 
        onOpenChange={setPreviewOpen} 
        template={previewTemplate}
        layout={previewTemplate?.layout}
      />
    </div>
  );
}
