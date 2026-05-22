import { useEffect, useMemo, useState } from "react";
import { api, formatErr, API_BASE } from "../../lib/api";
import PageHeader from "../../components/PageHeader";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../../components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Plus, Pencil, Trash2, Film } from "lucide-react";
import { toast } from "sonner";

const FALLBACK_TEMPLATE = {
  id: "fallback",
  name: "Default Layout",
  layout: {
    zones: [
      { id: "main", name: "Main" },
      { id: "sidebar", name: "Sidebar" },
      { id: "ticker", name: "Ticker" },
    ],
  },
};

const emptyForm = { name: "", template_id: "", zone_items: {}, ticker_messages: [] };

const legacyZoneOrder = ["main", "sidebar", "ticker"];

// Extract and normalize zones from a template's layout
const extractZonesFromTemplate = (template) => {
  if (!template) return [];
  const layoutZones = template.layout?.zones || [];
  if (Array.isArray(layoutZones) && layoutZones.length > 0) {
    return layoutZones.map((z) => ({
      id: z.id || z.name?.toLowerCase().replace(/\s+/g, '_'),
      name: z.name || z.id,
      role: z.role || z.type || "",
    }));
  }
  const layout = template.layout || {};
  const legacyZones = [];
  if (layout.main) legacyZones.push({ id: "main", name: layout.main || "Main", role: "" });
  if (layout.sidebar) legacyZones.push({ id: "sidebar", name: layout.sidebar || "Sidebar", role: "" });
  if (layout.ticker) legacyZones.push({ id: "ticker", name: layout.ticker || "Ticker", role: "ticker" });
  return legacyZones.length > 0 ? legacyZones : [];
};

const normalizeZoneItems = (zoneItems = {}) => {
  if (!zoneItems || typeof zoneItems !== "object") return {};
  return Object.fromEntries(Object.entries(zoneItems).filter(([, items]) => Array.isArray(items)));
};

const remapLegacyItemsToZones = (zoneDefs, existingZoneItems = {}) => {
  const cleaned = normalizeZoneItems(existingZoneItems);
  const nextZoneItems = {};

  if (zoneDefs.length === 0) return nextZoneItems;

  const hasMatchingKeys = zoneDefs.some((zone) => cleaned[zone.id]);
  if (hasMatchingKeys) {
    zoneDefs.forEach((zone) => {
      nextZoneItems[zone.id] = cleaned[zone.id] || [];
    });
    return nextZoneItems;
  }

  const legacyBuckets = legacyZoneOrder.map((key) => cleaned[key] || []);
  zoneDefs.forEach((zone, index) => {
    nextZoneItems[zone.id] = legacyBuckets[index] || [];
  });

  return nextZoneItems;
};

const isTickerZone = (zone) => zone?.role === "ticker" || /ticker/i.test(`${zone?.id || ""} ${zone?.name || ""}`);
const isQueueZone = (zone) => zone?.role === "queue" || /queue|token/i.test(`${zone?.id || ""} ${zone?.name || ""}`);
const isLogoZone = (zone) => zone?.role === "logo" || /logo|brand/i.test(`${zone?.id || ""} ${zone?.name || ""}`);

const isAutoZone = (zone) => /^(header|weather|bookings)$/i.test(zone?.role || "") || isQueueZone(zone);

function ZonePicker({ media, items, setItems }) {
  const [addType, setAddType] = useState(""); // for managing add dialog
  const [textValue, setTextValue] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [newDuration, setNewDuration] = useState(10);

  const addMedia = (id) => {
    if (!items.some((i) => i.type === "media" && i.media_id === id)) {
      setItems([...items, { type: "media", media_id: id, fit: "cover", duration: 10 }]);
    }
  };

  const addText = () => {
    if (textValue.trim()) {
      setItems([...items, { type: "text", content: textValue, duration: newDuration }]);
      setTextValue("");
      setNewDuration(10);
      setAddType("");
    }
  };

  const addYoutube = () => {
    if (youtubeUrl.trim()) {
      setItems([...items, { type: "youtube", url: youtubeUrl, duration: newDuration }]);
      setYoutubeUrl("");
      setNewDuration(10);
      setAddType("");
    }
  };

  const addWidget = (type) => {
    const widgetDefaults = {
      clock: { type: "clock", title: "Today", duration: 10 },
      weather: { type: "weather", title: "Weather", location: "Local area", duration: 10 },
      bookings: { type: "bookings", title: "Today's bookings", duration: 14 },
      queue: { type: "queue", title: "Live queue", duration: 14 },
      notices: { type: "notices", title: "Notices", duration: 12 },
    };
    const next = widgetDefaults[type];
    if (!next) return;
    setItems([...items, next]);
    setAddType("");
  };

  const remove = (idx) => setItems(items.filter((_, i) => i !== idx));
  const setDur = (idx, d) => setItems(items.map((it, i) => (i === idx ? { ...it, duration: d } : it)));
  const setFit = (idx, fit) => setItems(items.map((it, i) => (i === idx ? { ...it, fit } : it)));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const c = [...items];
    [c[idx], c[j]] = [c[j], c[idx]];
    setItems(c);
  };
  const mediaById = (id) => media.find((m) => m.id === id);
  const getYoutubeId = (url) => {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">Add Content</div>
        <div className="border border-[#E5E7EB] rounded-sm max-h-80 overflow-y-auto p-3 bg-[#F9FAFB] space-y-3">
          <div>
            <div className="text-[9px] font-semibold uppercase text-[#6B7280] mb-2">⚡ Widgets</div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-sm text-xs justify-start" onClick={() => addWidget("clock")}>+ Date & Time</Button>
              <Button type="button" variant="outline" className="h-9 rounded-sm text-xs justify-start" onClick={() => addWidget("weather")}>+ Weather</Button>
              <Button type="button" variant="outline" className="h-9 rounded-sm text-xs justify-start" onClick={() => addWidget("bookings")}>+ Bookings</Button>
              <Button type="button" variant="outline" className="h-9 rounded-sm text-xs justify-start" onClick={() => addWidget("queue")}>+ Queue</Button>
              <Button type="button" variant="outline" className="h-9 rounded-sm text-xs justify-start col-span-2" onClick={() => addWidget("notices")}>+ Notices</Button>
            </div>
          </div>

          {/* Media Library Tab */}
          <div>
            <div className="text-[9px] font-semibold uppercase text-[#6B7280] mb-2">📁 Media Library</div>
            <div className="grid grid-cols-3 gap-2">
              {media.length === 0 && <div className="col-span-3 text-xs text-[#9CA3AF] text-center p-2">No media uploaded.</div>}
              {media.map((m) => (
                <button key={m.id} type="button" onClick={() => addMedia(m.id)} className="aspect-square bg-white border border-[#E5E7EB] rounded-sm overflow-hidden hover:border-[#111827] relative text-[9px]" data-testid={`pl-add-${m.id}`}>
                  {m.kind === "image" ? <img src={`${API_BASE}/media/serve/${m.id}`} className="w-full h-full object-cover" alt={m.name} /> : <div className="w-full h-full flex items-center justify-center bg-[#111827]"><Film className="w-4 h-4 text-white/50" /></div>}
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[8px] truncate px-1">{m.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Text Input */}
          <div>
            <div className="text-[9px] font-semibold uppercase text-[#6B7280] mb-2">📝 Text</div>
            <div className="space-y-1">
              <Input value={textValue} onChange={(e) => setTextValue(e.target.value)} placeholder="Enter text..." className="rounded-sm text-xs h-8" />
              <div className="flex gap-1">
                <Input type="number" min="1" max="60" value={newDuration} onChange={(e) => setNewDuration(parseInt(e.target.value || 10))} className="rounded-sm text-xs h-8 w-16" />
                <Button type="button" onClick={addText} className="rounded-sm bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 flex-1" disabled={!textValue.trim()}>Add Text</Button>
              </div>
            </div>
          </div>

          {/* YouTube URL Input */}
          <div>
            <div className="text-[9px] font-semibold uppercase text-[#6B7280] mb-2">🎥 YouTube</div>
            <div className="space-y-1">
              <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." className="rounded-sm text-xs h-8" />
              <div className="flex gap-1">
                <Input type="number" min="1" max="600" value={newDuration} onChange={(e) => setNewDuration(parseInt(e.target.value || 10))} className="rounded-sm text-xs h-8 w-16" />
                <Button type="button" onClick={addYoutube} className="rounded-sm bg-red-600 hover:bg-red-700 text-white text-xs h-8 flex-1" disabled={!youtubeUrl.trim()}>Add Video</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280] mb-2">Sequence ({items.length})</div>
        <div className="border border-[#E5E7EB] rounded-sm max-h-80 overflow-y-auto p-2 space-y-1 bg-[#F9FAFB]">
          {items.length === 0 && <div className="text-xs text-[#9CA3AF] text-center p-4">Add content on the left.</div>}
          {items.map((it, idx) => {
            const m = it.type === "media" ? mediaById(it.media_id) : null;
            const ytId = it.type === "youtube" ? getYoutubeId(it.url) : null;
            return (
              <div key={idx} className="flex items-center gap-2 bg-white border border-[#E5E7EB] rounded-sm p-1.5">
                <div className="flex flex-col">
                  <button type="button" onClick={() => move(idx, -1)} className="text-[8px] text-[#6B7280]">▲</button>
                  <button type="button" onClick={() => move(idx, 1)} className="text-[8px] text-[#6B7280]">▼</button>
                </div>
                <div className="w-10 h-10 bg-[#F3F4F6] rounded-sm overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {it.type === "media" && m?.kind === "image" && <img src={`${API_BASE}/media/serve/${m.id}`} className="w-full h-full object-cover" alt="" />}
                  {it.type === "media" && m?.kind === "video" && <div className="text-center"><Film className="w-3 h-3 text-white/50" /></div>}
                  {it.type === "text" && <div className="text-[8px] font-bold text-[#111827]">TXT</div>}
                  {it.type === "youtube" && ytId && <div className="text-[6px] font-bold text-red-600">YT</div>}
                  {it.type === "clock" && <div className="text-[8px] font-bold text-[#111827]">CLK</div>}
                  {it.type === "weather" && <div className="text-[8px] font-bold text-[#111827]">WTH</div>}
                  {it.type === "bookings" && <div className="text-[8px] font-bold text-[#111827]">BK</div>}
                  {it.type === "queue" && <div className="text-[8px] font-bold text-[#111827]">Q</div>}
                  {it.type === "notices" && <div className="text-[8px] font-bold text-[#111827]">N</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">
                    {it.type === "media" && (m?.name || "Missing media")}
                    {it.type === "text" && `"${it.content.substring(0, 20)}..."`}
                    {it.type === "youtube" && (ytId ? "YouTube video" : "Invalid YT URL")}
                    {it.type === "clock" && (it.title || "Date & Time")}
                    {it.type === "weather" && (it.title || "Weather")}
                    {it.type === "bookings" && (it.title || "Today's bookings")}
                    {it.type === "queue" && (it.title || "Queue")}
                    {it.type === "notices" && (it.title || "Notices")}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Input type="number" min="1" value={it.duration} onChange={(e) => setDur(idx, parseInt(e.target.value || 1))} className="h-6 w-16 text-xs rounded-sm" />
                    <span className="text-[10px] text-[#6B7280]">sec</span>
                  </div>
                  {it.type === "media" && (
                    <div className="mt-1">
                      <Select value={it.fit || "cover"} onValueChange={(value) => setFit(idx, value)}>
                        <SelectTrigger className="h-6 w-24 text-[10px] rounded-sm" data-testid={`media-fit-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cover">Cover</SelectItem>
                          <SelectItem value="contain">Contain</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {it.type === "clock" && (
                    <Input value={it.title || ""} onChange={(e) => setItems(items.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)))} placeholder="Header title" className="mt-1 h-6 rounded-sm text-xs" />
                  )}
                  {it.type === "weather" && (
                    <Input value={it.location || ""} onChange={(e) => setItems(items.map((item, i) => (i === idx ? { ...item, location: e.target.value } : item)))} placeholder="Weather label" className="mt-1 h-6 rounded-sm text-xs" />
                  )}
                  {it.type === "bookings" && (
                    <Input value={it.title || ""} onChange={(e) => setItems(items.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)))} placeholder="Bookings title" className="mt-1 h-6 rounded-sm text-xs" />
                  )}
                  {it.type === "queue" && (
                    <Input value={it.title || ""} onChange={(e) => setItems(items.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)))} placeholder="Queue title" className="mt-1 h-6 rounded-sm text-xs" />
                  )}
                  {it.type === "notices" && (
                    <Input value={it.title || ""} onChange={(e) => setItems(items.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)))} placeholder="Notices title" className="mt-1 h-6 rounded-sm text-xs" />
                  )}
                </div>
                <button type="button" onClick={() => remove(idx)} className="text-red-600 px-1">×</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TickerEditor({ items, setItems }) {
  const normalized = Array.isArray(items) ? items : [];
  const addItem = (type) => {
    const next = type === "rss"
      ? { type: "rss", title: "RSS Feed", url: "", duration: 6 }
      : { type: "text", text: "Ticker message", duration: 6 };
    setItems([...normalized, next]);
  };

  const updateItem = (index, patch) => {
    setItems(normalized.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index) => setItems(normalized.filter((_, itemIndex) => itemIndex !== index));

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280]">Ticker items</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => addItem("text")} className="rounded-sm">+ Text</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addItem("rss")} className="rounded-sm">+ RSS</Button>
          </div>
        </div>
        <div className="border border-[#E5E7EB] rounded-sm bg-[#F9FAFB] p-2 space-y-2 max-h-[420px] overflow-y-auto">
          {normalized.length === 0 && <div className="text-xs text-[#9CA3AF] text-center p-6">Add scrolling text or RSS feeds for this ticker zone.</div>}
          {normalized.map((item, index) => {
            const type = item?.type || item?.kind || "text";
            return (
              <div key={index} className="bg-white border border-[#E5E7EB] rounded-sm p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Select value={type} onValueChange={(v) => updateItem(index, v === "rss" ? { type: "rss", title: item.title || "RSS Feed", url: item.url || "" } : { type: "text", text: item.text || item.title || "Ticker message" })}>
                    <SelectTrigger className="h-8 w-28 rounded-sm text-xs" data-testid={`ticker-type-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="rss">RSS</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Input type="number" min="1" value={item.duration || 6} onChange={(e) => updateItem(index, { duration: parseInt(e.target.value || 6, 10) })} className="h-8 w-20 rounded-sm text-xs" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(index)} className="text-red-600 h-8 px-2">Remove</Button>
                  </div>
                </div>
                {type === "rss" ? (
                  <>
                    <Input value={item.title || ""} onChange={(e) => updateItem(index, { title: e.target.value })} placeholder="Feed label" className="rounded-sm" data-testid={`ticker-title-${index}`} />
                    <Input value={item.url || ""} onChange={(e) => updateItem(index, { url: e.target.value })} placeholder="https://example.com/feed.xml" className="rounded-sm font-mono" data-testid={`ticker-url-${index}`} />
                  </>
                ) : (
                  <Input value={item.text || item.title || ""} onChange={(e) => updateItem(index, { text: e.target.value, title: e.target.value })} placeholder="Scrolling message" className="rounded-sm" data-testid={`ticker-text-${index}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-sm border border-[#E5E7EB] bg-black text-white p-4 overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-white/50 mb-3">Ticker preview</div>
        <div className="h-20 flex items-center overflow-hidden border border-white/10 rounded-sm bg-black/80">
          <div className="whitespace-nowrap animate-marquee inline-flex gap-8 px-4 text-sm font-semibold text-white">
            {(normalized.length ? normalized : [{ type: "text", text: "Ticker message" }]).map((item, index) => (
              <span key={index} className="inline-flex items-center gap-2">
                <span className="text-white/40 uppercase text-[10px]">{(item.type || item.kind || "text").toUpperCase()}</span>
                <span>{item.text || item.title || item.url || "Message"}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ClientPlaylists() {
  const [playlists, setPlaylists] = useState([]);
  const [media, setMedia] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [activeZone, setActiveZone] = useState("");
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    try {
      const [p, m, t] = await Promise.all([api.get("/client/playlists"), api.get("/client/media"), api.get("/client/templates")]);
      setPlaylists(p.data);
      setMedia(m.data);
      setTemplates(t.data);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const activeTemplate = useMemo(() => templates.find((t) => t.id === form.template_id) || null, [templates, form.template_id]);
  const zoneDefs = useMemo(() => {
     if (!activeTemplate) return FALLBACK_TEMPLATE.layout.zones;
     const extracted = extractZonesFromTemplate(activeTemplate);
     return extracted.length > 0 ? extracted : FALLBACK_TEMPLATE.layout.zones;
  }, [activeTemplate]);

  useEffect(() => {
    if (!zoneDefs.length) return;
    if (!zoneDefs.some((zone) => zone.id === activeZone)) {
      setActiveZone(zoneDefs[0].id);
    }
  }, [zoneDefs, activeZone]);

  const applyTemplate = (templateId, existingZoneItems = {}) => {
    const tpl = templates.find((t) => t.id === templateId);
    const zones = tpl ? extractZonesFromTemplate(tpl) : FALLBACK_TEMPLATE.layout.zones;
    const { ticker_messages: existingTickerMessages, ...zoneSource } = existingZoneItems || {};
    const nextZoneItems = remapLegacyItemsToZones(zones, zoneSource);
    zones.forEach((zone) => {
      if (isAutoZone(zone)) nextZoneItems[zone.id] = [];
    });
    const nextTickerMessages = Array.isArray(existingTickerMessages) ? existingTickerMessages : Array.isArray(zoneSource.ticker) ? zoneSource.ticker : [];
    delete nextZoneItems.ticker;
    setForm((prev) => ({ ...prev, template_id: templateId, zone_items: nextZoneItems, ticker_messages: nextTickerMessages }));
  };

  const openCreate = () => {
    setEditing(null);
    const defaultTemplate = templates[0]?.id || "";
    setForm(defaultTemplate ? { ...emptyForm, template_id: defaultTemplate } : emptyForm);
    setOpen(true);
    if (defaultTemplate) applyTemplate(defaultTemplate, {});
    setActiveZone(zoneDefs[0]?.id || "main");
  };

  const openEdit = (playlist) => {
    setEditing(playlist);
    const templateId = playlist.template_id || templates[0]?.id || "";
    const mappedZoneItems = normalizeZoneItems(playlist.zone_items);
    const tickerMessages = Array.isArray(playlist.ticker_messages) ? playlist.ticker_messages : mappedZoneItems.ticker || [];
    delete mappedZoneItems.ticker;
    if (!Object.keys(mappedZoneItems).length) {
      if (playlist.main_items) mappedZoneItems.main = playlist.main_items;
      if (playlist.sidebar_items) mappedZoneItems.sidebar = playlist.sidebar_items;
    }
    setForm({ name: playlist.name, template_id: templateId, zone_items: mappedZoneItems, ticker_messages: tickerMessages });
    setOpen(true);
    if (templateId) applyTemplate(templateId, { ...mappedZoneItems, ticker_messages: tickerMessages });
    setActiveZone(zoneDefs[0]?.id || "main");
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        template_id: form.template_id || null,
        zone_items: form.zone_items,
        ticker_messages: form.ticker_messages || [],
      };
      if (editing) await api.put(`/client/playlists/${editing.id}`, payload);
      else await api.post("/client/playlists", payload);
      toast.success(editing ? "Playlist updated" : "Playlist created");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this playlist?")) return;
    try {
      await api.delete(`/client/playlists/${id}`);
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail));
    }
  };

  const mediaByFolder = (folder) => media.filter((m) => (m.folder || "default") === folder);
  const folders = Array.from(new Set(media.map((m) => m.folder || "default")));

  return (
    <div data-testid="client-playlists-page">
      <PageHeader overline="Client / Playlists" title="Playlists." subtitle="Select a template, then choose media for each zone in that screen layout.">
        <Button onClick={openCreate} className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="create-playlist-btn">
          <Plus className="w-4 h-4 mr-2" /> New Playlist
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {playlists.length === 0 && (
          <div className="col-span-full text-center py-12 text-sm text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-sm">No playlists yet.</div>
        )}
        {playlists.map((p) => {
          const zoneItems = p.zone_items || {};
          const total = Object.values(zoneItems).reduce((sum, list) => sum + (list?.length || 0), 0) + (p.ticker_messages?.length || 0);
          return (
            <div key={p.id} className="dense-card bg-white border border-[#E5E7EB] rounded-sm p-5" data-testid={`playlist-${p.id}`}>
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-display text-xl font-extrabold tracking-tight">{p.name}</h3>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)} data-testid={`edit-playlist-${p.id}`}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(p.id)} className="text-red-600" data-testid={`delete-playlist-${p.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div className="text-xs text-[#6B7280] mb-3">Template: <span className="font-semibold text-[#111827]">{templates.find((t) => t.id === p.template_id)?.name || "Default"}</span></div>
              <div className="text-xs text-[#6B7280] mb-3">{total} item(s) across {Object.keys(zoneItems).length || 0} zone(s){(p.ticker_messages?.length || 0) ? ` + ${p.ticker_messages.length} ticker item(s)` : ""}</div>
              <div className="space-y-2">
                {Object.entries(zoneItems).map(([zoneId, list]) => (
                  <div key={zoneId} className="bg-[#F9FAFB] rounded-sm p-2 border border-[#E5E7EB]">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-[#6B7280]">{zoneId}</div>
                    <div className="text-xs text-[#111827]">{(list || []).length} item(s)</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="playlist-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">{editing ? "Edit Playlist" : "New Playlist"}</DialogTitle>
            <DialogDescription>Select template and add media, text, or YouTube videos to zones</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="rounded-sm" data-testid="pl-name" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-[#6B7280]">Template</Label>
                <Select value={form.template_id || ""} onValueChange={(value) => applyTemplate(value, { ...form.zone_items, ticker_messages: form.ticker_messages })}>
                  <SelectTrigger className="rounded-sm" data-testid="playlist-template-select">
                    <SelectValue placeholder="Choose template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border border-[#E5E7EB] rounded-sm bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Template Preview</div>
              <div className="grid grid-cols-3 gap-2">
                {zoneDefs.map((zone) => (
                  <div key={zone.id} className="border border-[#111827] rounded-sm bg-[#F9FAFB] p-3 text-center text-xs font-semibold text-[#6B7280]">
                    {zone.name}
                  </div>
                ))}
              </div>
            </div>

            <Tabs value={activeZone} onValueChange={setActiveZone} className="space-y-4">
              <TabsList className="rounded-sm bg-[#F3F4F6] flex-wrap h-auto p-2 gap-2">
                {zoneDefs.map((zone) => (
                  <TabsTrigger key={zone.id} value={zone.id} className="rounded-sm data-[state=active]:bg-[#111827] data-[state=active]:text-white" data-testid={`zone-tab-${zone.id}`}>
                    {zone.name}
                      <span className="ml-2 text-[10px] font-mono opacity-70">{isTickerZone(zone) ? (form.ticker_messages || []).length : isAutoZone(zone) ? "auto" : (form.zone_items?.[zone.id] || []).length}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {zoneDefs.map((zone) => (
                <TabsContent key={zone.id} value={zone.id}>
                  {isTickerZone(zone) ? (
                    <TickerEditor
                      items={form.ticker_messages || []}
                      setItems={(nextItems) => setForm({ ...form, ticker_messages: nextItems })}
                    />
                  ) : isAutoZone(zone) ? (
                    <div className="rounded-sm border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-4 text-sm text-[#6B7280]">
                      <div className="font-semibold text-[#111827]">Automatic queue zone</div>
                      <p className="mt-1">
                        This zone is filled by the player using the live queue, showing the current token and the next tokens automatically.
                        No manual media items are needed here.
                      </p>
                    </div>
                  ) : (
                    <ZonePicker
                      media={media}
                      items={form.zone_items?.[zone.id] || []}
                      setItems={(nextItems) => setForm({ ...form, zone_items: { ...form.zone_items, [zone.id]: nextItems } })}
                    />
                  )}
                </TabsContent>
              ))}
            </Tabs>

            <div className="border border-[#E5E7EB] rounded-sm p-3 bg-[#F9FAFB] text-xs text-[#6B7280]">
              Media folders available: {folders.length ? folders.join(", ") : "default"}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-sm">Cancel</Button>
              <Button type="submit" className="rounded-sm bg-[#111827] hover:bg-[#374151] text-white" data-testid="pl-submit">{editing ? "Save" : "Create Playlist"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
