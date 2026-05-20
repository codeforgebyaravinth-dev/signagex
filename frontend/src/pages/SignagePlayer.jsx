import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Monitor, CircleSlash, Maximize } from "lucide-react";

const RAW_BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const BASE = RAW_BASE.replace(/\/api$/, "");

function getMediaFit(item) {
  return item?.fit === "contain" ? "object-contain" : "object-cover";
}

function isImageItem(item) {
  return item?.kind === "image" || (item?.content_type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(item?.url || item?.name || "");
}

function MediaSlot({ items, label }) {
  const [idx, setIdx] = useState(0);
  const [showFrame, setShowFrame] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => { setIdx(0); }, [items?.length]);

  useEffect(() => {
    setShowFrame(false);
    const frame = setTimeout(() => setShowFrame(true), 30);
    return () => clearTimeout(frame);
  }, [idx, items]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const cur = items[idx];
    if (!cur) return;
    // Skip timer for videos - let them play to end
    if (cur.kind === "video" || cur.type === "youtube") return;
    timerRef.current = setTimeout(() => setIdx((i) => (i + 1) % items.length), (cur.duration || 10) * 1000);
    return () => clearTimeout(timerRef.current);
  }, [idx, items]);

  if (!items || items.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-white/30 text-xs font-mono uppercase tracking-widest">{label}</div>;
  }

  const cur = items[idx];
  if (!cur) return null;

  const getYoutubeId = (url) => {
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;
    const match = url?.match(regex);
    return match ? match[1] : null;
  };

  const handleMediaEnd = () => setIdx((i) => (i + 1) % items.length);

  const content = 
    (cur.type === "text" || cur.kind === "text") ? (
      <div className="w-full h-full flex items-center justify-center bg-black p-6 text-center">
        <div className="max-w-[90%] text-white font-display text-2xl font-bold leading-tight">{cur.content || cur.text}</div>
      </div>
    ) : (cur.type === "youtube") ? (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <iframe
          width="100%"
          height="100%"
          src={`https://www.youtube.com/embed/${getYoutubeId(cur.url)}?autoplay=1&modestbranding=1&rel=0&fs=0`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onEnded={handleMediaEnd}
          style={{ border: "none" }}
        />
      </div>
    ) : (cur.type === "media" || cur.media_id) ? (
      isImageItem(cur) ? (
        <img src={`${BASE}${cur.url}`} alt={cur.name} className={`w-full h-full ${getMediaFit(cur)}`} onError={handleMediaEnd} />
      ) : (
        <video
          src={`${BASE}${cur.url}`}
          autoPlay
          muted
          playsInline
          className={`w-full h-full ${getMediaFit(cur)}`}
          onEnded={handleMediaEnd}
          onError={handleMediaEnd}
        />
      )
    ) : isImageItem(cur) ? (
      <img src={`${BASE}${cur.url}`} alt={cur.name} className={`w-full h-full ${getMediaFit(cur)}`} onError={handleMediaEnd} />
    ) : (
      <video
        src={`${BASE}${cur.url}`}
        autoPlay
        muted
        playsInline
        className={`w-full h-full ${getMediaFit(cur)}`}
        onEnded={handleMediaEnd}
        onError={handleMediaEnd}
      />
    );

  return <div className={`w-full h-full transition-all duration-500 ${showFrame ? "opacity-100 scale-100" : "opacity-0 scale-[1.01]"}`}>{content}</div>;
}

function TickerSlot({ items, label }) {
  const [feedEntries, setFeedEntries] = useState([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const staticEntries = [];
      const rssItems = [];
      for (const item of items || []) {
        const type = (item?.kind || item?.type || "text").toLowerCase();
        if (type === "rss" && item?.url) {
          rssItems.push(item);
        } else {
          const text = item?.text || item?.title || item?.message || "";
          if (text) staticEntries.push({ text, link: item?.link || "" });
        }
      }

      const fetched = await Promise.all(rssItems.map(async (item) => {
        try {
          const { data } = await axios.get(`${BASE}/api/public/rss`, { params: { url: item.url } });
          return (data?.items || []).map((entry) => ({ text: entry.title, link: entry.link || item.url }));
        } catch {
          return [{ text: item.title || item.url || "RSS Feed", link: item.url }];
        }
      }));

      const merged = [...staticEntries, ...fetched.flat()].filter((entry) => entry?.text);
      if (mounted) setFeedEntries(merged);
    };

    load();
    return () => { mounted = false; };
  }, [items]);

  if (!feedEntries.length) {
    return <div className="w-full h-full flex items-center justify-center text-white/30 text-xs font-mono uppercase tracking-widest">{label}</div>;
  }

  const repeated = [...feedEntries, ...feedEntries];
  return (
    <div className="w-full h-full overflow-hidden bg-black text-white flex items-center px-4">
      <div className="animate-marquee flex items-center gap-10 whitespace-nowrap text-sm font-semibold">
        {repeated.map((entry, index) => (
          <span key={`${entry.text}-${index}`} className="inline-flex items-center gap-3">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-white/50" />
            <span>{entry.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SignagePlayer() {
  const { pairCode } = useParams();
  const [payload, setPayload] = useState(null);
  const [providerData, setProviderData] = useState(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef(null);
  const recogRef = useRef(null);
  const [overlay, setOverlay] = useState(null); // single: {title,image,description,meta,type} | multi: {title,type,items[]}
  const overlayTimer = useRef(null);
  const overlayKeyRef = useRef("");
  const genericProductCursorRef = useRef(0);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [showSplash, setShowSplash] = useState(true);

  const poll = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE}/api/public/player/${pairCode}`);
      setPayload(data);
      setErr("");
    } catch (e) {
      setErr(e.response?.data?.detail || "Could not load");
    }
  }, [pairCode]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, [poll]);

  // hide splash when initial payload has arrived (keep min display time)
  useEffect(() => {
    if (!showSplash) return;
    if (!payload) return;
    const minMs = 700;
    const t = setTimeout(() => setShowSplash(false), minMs);
    return () => clearTimeout(t);
  }, [payload, showSplash]);

  // fetch vertical-specific public data (products/services/queue/notices/rooms)
  useEffect(() => {
    if (!payload?.client_id) return;
    let mounted = true;

    const loadProvider = async () => {
      try {
        const { data } = await axios.get(`${BASE}/api/public/providers/${payload.client_id}`);
        if (mounted) setProviderData(data);
      } catch {
        if (mounted) setProviderData(null);
      }
    };

    loadProvider();
    const id = setInterval(loadProvider, 20_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [payload?.client_id]);

  // continuous voice listening and matching across verticals
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceState("unsupported");
      setVoiceError("Voice search is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;
    recogRef.current = recognition;

    const normalize = (s) => (s || "").toLowerCase().replace(/[\.\,\-\_]/g, " ").replace(/\s+/g, " ").trim();

    recognition.onresult = (ev) => {
      if (!ev.results || ev.results.length === 0) return;
      const last = ev.results[ev.results.length - 1];
      const transcript = (last[0].transcript || "").trim().toLowerCase();
      if (!transcript) return;
      setVoiceTranscript(transcript);

      const source = providerData || payload || {};
      const catalog = [];
      try {
        // products — include tag/keyword support for better matching
        if (source?.products && Array.isArray(source.products)) {
          for (const p of source.products) {
            const rawTags = Array.isArray(p.tags) ? p.tags : (p.tags ? String(p.tags).split(/[,;|]/).map((t) => t.trim()) : []);
            const tags = rawTags.map((t) => normalize(t)).filter(Boolean);
            const nameNorm = normalize(p.name || "");
            const keywords = Array.from(new Set([...(nameNorm.split(/\s+/).filter(Boolean)), ...tags]));
            catalog.push({ type: "product", id: p.id, name: nameNorm, image: p.image_url || "", desc: p.description || "", meta: p, tags, keywords });
          }
        }
        // services
        if (source?.profile?.services && Array.isArray(source.profile.services)) {
          for (const s of source.profile.services) {
            const rawTags = Array.isArray(s.tags) ? s.tags : (s.tags ? String(s.tags).split(/[,;|]/).map((t) => t.trim()) : []);
            const tags = rawTags.map((t) => normalize(t)).filter(Boolean);
            const nameNorm = normalize(s.name || "");
            const keywords = Array.from(new Set([...(nameNorm.split(/\s+/).filter(Boolean)), ...tags]));
            catalog.push({ type: "service", id: s.id, name: nameNorm, image: s.image_url || "", desc: s.description || "", meta: s, tags, keywords });
          }
        }
        // provider name and specialty
        if (source?.name) catalog.push({ type: "provider", id: source.id || "provider", name: normalize(source.name || ""), image: source.profile?.image_url || "", desc: source.profile?.description || "", meta: source });
        if (source?.profile?.specialty) catalog.push({ type: "provider_keyword", id: `spec-${source.id || ''}`, name: normalize(source.profile.specialty || ""), image: source.profile.image_url || "", desc: source.profile.description || "", meta: source.profile });
        // media names
        if (payload?.zones) {
          for (const k of Object.keys(payload.zones || {})) {
            for (const it of payload.zones[k] || []) {
              if (it?.name) catalog.push({ type: "media", id: it.id || it.media_id || `${k}-${it.name}`, name: normalize(it.name || ""), image: it.image_url || it.url || "", desc: it.description || it.content || "", meta: it });
            }
          }
        }
        // society rooms & notices
        if (source?.rooms && Array.isArray(source.rooms)) {
          for (const r of source.rooms) {
            const resident = normalize(r.user_name || "");
            const roomLabel = normalize(String(r.room_no || ""));
            if (resident) catalog.push({ type: "room_resident", id: r.id || `${r.room_no}-${resident}`, name: resident, image: r.image_url || "", desc: `Room ${r.room_no || ""}`, meta: r });
            if (roomLabel) catalog.push({ type: "room_no", id: r.id || `${r.room_no}`, name: roomLabel, image: r.image_url || "", desc: `Room ${r.room_no || ""}`, meta: r });
          }
        }
        if (source?.notices && Array.isArray(source.notices)) {
          for (const n of source.notices) catalog.push({ type: "notice", id: n.id, name: normalize(n.title || n.body || ""), image: n.image_url || "", desc: n.body || n.title || "", meta: n });
        }
      } catch (e) {
        // ignore
      }

      const normTranscript = normalize(transcript);
      const match = catalog.find((c) => {
        const n = c.name || "";
        const keywords = Array.isArray(c.keywords) ? c.keywords : (n ? n.split(/\s+/).filter(Boolean) : []);
        if (!n && keywords.length === 0) return false;
        // direct name include
        if (n && normTranscript.includes(n)) return true;
        // keywords/tags include
        if (keywords.some((k) => k && normTranscript.includes(k))) return true;
        // fallback to token-by-token match against name
        const tokens = n.split(/\s+/).filter(Boolean);
        return tokens.some((t) => t && normTranscript.includes(t));
      });

      const productCatalog = catalog.filter((c) => c.type === "product");
      const queryTerms = normTranscript
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w && w.length > 2 && !["show", "shows", "any", "all", "the", "please", "product", "products", "item", "items", "browse", "display", "list", "me"].includes(w));
      const singular = (w) => (w.endsWith("s") ? w.slice(0, -1) : w);
      const groupedProducts = productCatalog.filter((p) => {
        const nameTokens = (p.name || "").split(/\s+/).map((t) => singular(t));
        const tagTokens = Array.isArray(p.tags) ? p.tags.map((t) => singular(normalize(t))) : [];
        const keywordTokens = Array.isArray(p.keywords) ? p.keywords.map((t) => singular(t)) : [];
        const pTokens = Array.from(new Set([...nameTokens, ...tagTokens, ...keywordTokens]));
        return queryTerms.some((q) => pTokens.includes(singular(q)));
      });
      const wantsCollection = groupedProducts.length > 0 && /\b(show|shows|all|list|display|browse)\b/.test(normTranscript);

      // debug information for voice matching
      try {
        console.debug("voice-debug", {
          transcript: normTranscript,
          catalogSize: catalog.length,
          productCount: productCatalog.length,
          queryTerms,
          groupedProductsCount: groupedProducts.length,
          groupedProductsNames: groupedProducts.map((p) => p.meta?.name || p.name),
          wantsCollection,
          matchFound: !!match,
        });
      } catch (e) {}

      const genericProductRequest = /\b(product|products|item|items|catalog|collection)\b/.test(normTranscript) && /\b(show|any|next|another|browse)\b/.test(normTranscript);

      // If user asked to show a collection or used a category/tag term, show up to 5 related products
      if (!match && (wantsCollection || (genericProductRequest && groupedProducts.length > 0))) {
        const items = groupedProducts.slice(0, 5).map((p) => ({
          id: p.id,
          name: p.meta?.name || p.name,
          image: p.image || p.meta?.image_url || "",
          description: p.desc || p.meta?.description || "",
          price: p.meta?.price,
        }));
        const groupKey = `group:product:${queryTerms.join("-")}:${items.map((p) => p.id || p.name).join("|")}`;
        if (overlayKeyRef.current === groupKey) return;
        setOverlay({ title: queryTerms.length ? `Showing ${queryTerms.join(" ")}` : "Products", type: "product_group", items });
        overlayKeyRef.current = groupKey;
        if (overlayTimer.current) clearTimeout(overlayTimer.current);
        overlayTimer.current = setTimeout(() => { overlayKeyRef.current = ""; setOverlay(null); }, 30_000);
        return;
      }

      // For generic requests with no category, rotate and show 5 products
      if (!match && genericProductRequest && productCatalog.length > 0) {
        const start = genericProductCursorRef.current % productCatalog.length;
        const count = Math.min(5, productCatalog.length);
        const items = new Array(count).fill(0).map((_, i) => {
          const p = productCatalog[(start + i) % productCatalog.length];
          return { id: p.id, name: p.meta?.name || p.name, image: p.image || p.meta?.image_url || "", description: p.desc || p.meta?.description || "", price: p.meta?.price };
        });
        genericProductCursorRef.current = (genericProductCursorRef.current + count) % Math.max(1, productCatalog.length);
        const groupKey = `generic:products:${items.map((p) => p.id || p.name).join("|")}`;
        if (overlayKeyRef.current === groupKey) return;
        setOverlay({ title: "Products", type: "product_group", items });
        overlayKeyRef.current = groupKey;
        if (overlayTimer.current) clearTimeout(overlayTimer.current);
        overlayTimer.current = setTimeout(() => { overlayKeyRef.current = ""; setOverlay(null); }, 30_000);
        return;
      }

      const fallbackProduct = null;
      const resolved = match || fallbackProduct;

      if (resolved) {
        const resolvedKey = `${resolved.type || "item"}:${resolved.id || resolved.meta?.id || resolved.name || ""}`;
        // Ignore repeated detections of the same item while overlay is visible.
        if (overlayKeyRef.current && overlayKeyRef.current === resolvedKey) {
          return;
        }

        // prepare overlay content depending on type
        let title = resolved.meta?.name || resolved.meta?.user_name || resolved.meta?.title || resolved.name || "";
        let image = resolved.image || resolved.meta?.image_url || resolved.meta?.public_url || "";
        let desc = resolved.desc || "";
        if (resolved.type === "room_resident") {
          title = resolved.meta.user_name || title;
          desc = `Room ${resolved.meta.room_no || resolved.meta.room || ""}`;
          image = resolved.meta.image_url || image;
        }
        if (resolved.type === "room_no") {
          title = `Room ${resolved.meta.room_no || resolved.meta.room || resolved.name}`;
          desc = resolved.meta.user_name ? `${resolved.meta.user_name}` : desc;
        }

        setOverlay({ title, image, description: desc, meta: resolved.meta, type: resolved.type });
        overlayKeyRef.current = resolvedKey;
        if (overlayTimer.current) clearTimeout(overlayTimer.current);
        overlayTimer.current = setTimeout(() => {
          overlayKeyRef.current = "";
          setOverlay(null);
        }, 30_000);
      }
    };

    recognition.onstart = () => {
      setVoiceState("listening");
      setVoiceError("");
    };
    recognition.onerror = (event) => {
      setVoiceState("error");
      setVoiceError(event?.error ? `Voice error: ${event.error}` : "Voice recognition stopped.");
    };
    recognition.onend = () => {
      setVoiceState("restarting");
      try { recognition.start(); } catch {
        setVoiceState("error");
        setVoiceError("Voice recognition could not restart.");
      }
    };
    try {
      recognition.start();
    } catch {
      setVoiceState("error");
      setVoiceError("Voice recognition could not start.");
    }

    return () => {
      try { recognition.onend = null; recognition.onstart = null; recognition.onerror = null; recognition.stop(); } catch (e) {}
    };
  }, [payload, providerData]);

  const goFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };

  const zoneDefs = useMemo(() => {
    const zones = payload?.template?.layout?.zones || [];
    if (zones.length > 0) return zones;
    const layout = payload?.template?.layout || {};
    const legacy = [];
    if (layout.main) legacy.push({ id: "main", name: layout.main || "Main" });
    if (layout.sidebar) legacy.push({ id: "sidebar", name: layout.sidebar || "Sidebar" });
    if (layout.ticker) legacy.push({ id: "ticker", name: layout.ticker || "Ticker" });
    if (legacy.length > 0) return legacy;
    return [
      { id: "main", name: "Main" },
      { id: "sidebar", name: "Sidebar" },
      { id: "ticker", name: "Ticker" },
    ];
  }, [payload]);

  const layout = payload?.template?.layout || {};
  const canvasWidth = Number(layout.canvas_width) || 1920;
  const canvasHeight = Number(layout.canvas_height) || 1080;
  const brightness = Number(payload?.brightness || 100);
  const orientation = payload?.orientation || "auto";
  const contentStyle = orientation === "portrait"
    ? { position: "absolute", left: 0, top: 0, width: "100vh", height: "100vw", transform: "rotate(90deg) translateY(-100%)", transformOrigin: "top left", filter: `brightness(${brightness}%)` }
    : { filter: `brightness(${brightness}%)` };
  const hasAbsoluteLayout = zoneDefs.some((zone) =>
    zone && (
      zone.x != null ||
      zone.y != null ||
      zone.width_px != null ||
      zone.height_px != null
    )
  );

  if (err) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <CircleSlash className="w-12 h-12 text-white/40 mx-auto mb-3" />
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40 mb-2">Pair code</div>
          <div className="font-mono text-xl mb-3">{pairCode}</div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{err}</h1>
        </div>
      </div>
    );
  }

  if (showSplash) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="mb-6">
            <div className="text-6xl font-extrabold text-white">RP</div>
            <div className="text-sm text-white/60 uppercase tracking-widest mt-1">Signage</div>
          </div>
          <div className="text-white/50">Loading content…</div>
        </div>
      </div>
    );
  }

  const zoneEntries = zoneDefs.map((zone) => ({ zone, items: payload.zones?.[zone.id] || [] }));
  const hasContent = zoneEntries.some(({ items }) => items.length > 0);
  const queuePreview = Array.isArray(providerData?.queue_preview)
    ? providerData.queue_preview
    : (Array.isArray(payload?.queue_preview) ? payload.queue_preview : []);
  const notices = Array.isArray(providerData?.notices)
    ? providerData.notices
    : (Array.isArray(payload?.notices) ? payload.notices : []);
  const currentToken = queuePreview[0] || null;
  const colCount = Math.max(1, zoneEntries.length);
  const gridStyle = {
    gridTemplateColumns: colCount === 1 ? "1fr" : colCount === 2 ? "repeat(2, minmax(0, 1fr))" : colCount === 4 ? "repeat(2, minmax(0, 1fr))" : `repeat(${colCount}, minmax(0, 1fr))`,
  };

  return (
    <div ref={wrapRef} className="min-h-screen bg-black text-white flex flex-col" data-testid="signage-player">
      <div className="flex items-center justify-between px-4 py-2 bg-black/80 border-b border-white/10 text-[10px] uppercase tracking-wider font-mono">
        <div className="flex items-center gap-2"><Monitor className="w-3.5 h-3.5" /> {payload.device_name}</div>
        <div className="flex items-center gap-4">
          <span className={`px-2 py-1 rounded-full border ${voiceState === "listening" ? "border-emerald-400/40 text-emerald-300" : voiceState === "unsupported" || voiceState === "error" ? "border-red-400/40 text-red-300" : "border-white/15 text-white/50"}`}>
            voice {voiceState === "listening" ? "listening" : voiceState === "restarting" ? "restarting" : voiceState === "unsupported" ? "unsupported" : voiceState === "error" ? "error" : "idle"}
          </span>
          <span className="text-white/40 text-[11px] ml-2">dbg P:{(providerData?.products || payload?.products || []).length} M:{(overlay?.items?.length) || (overlay ? 1 : 0)}</span>
          <span className="text-white/50">code <span className="text-white">{pairCode}</span></span>
          <span className="text-white/50">{orientation}</span>
          <button onClick={goFullscreen} className="hover:text-white/80" data-testid="fullscreen-btn"><Maximize className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {voiceError ? (
        <div className="px-4 py-2 border-b border-white/10 bg-red-500/10 text-[11px] text-red-200 font-mono uppercase tracking-wider">
          {voiceError}
        </div>
      ) : null}

      {voiceTranscript ? (
        <div className="px-4 py-2 border-b border-white/10 bg-white/5 text-[11px] text-white/60 font-mono uppercase tracking-wider truncate">
          heard: {voiceTranscript}
        </div>
      ) : null}

      {(currentToken || queuePreview.length > 0 || notices.length > 0) ? (
        <div className="absolute inset-x-3 bottom-3 z-20 pointer-events-none">
          <div className="grid gap-3 md:grid-cols-2">
            {(currentToken || queuePreview.length > 0) ? (
              <div className="pointer-events-auto rounded-2xl border border-emerald-400/20 bg-black/70 backdrop-blur-md shadow-[0_16px_60px_-30px_rgba(0,0,0,0.75)] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-300/80">Live queue</div>
                    <div className="text-white font-semibold text-sm">Current token processing</div>
                  </div>
                  <div className="text-[11px] text-white/50 uppercase tracking-wider">{queuePreview.length} waiting</div>
                </div>
                {currentToken ? (
                  <div className="mb-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/80">Now processing</div>
                      <div className="font-display text-2xl font-extrabold tracking-tight text-white">Token #{currentToken.token}</div>
                      <div className="text-xs text-white/70 mt-1">{currentToken.service_name || currentToken.patient_name || "Queue item"}</div>
                    </div>
                    <div className="text-right text-xs text-white/60">
                      <div>{currentToken.service_duration_mins || 0} min</div>
                      <div className="mt-1">+{currentToken.wait_after_mins || 0}m wait</div>
                    </div>
                  </div>
                ) : null}
                {queuePreview.length > 1 ? (
                  <div className="grid gap-2 max-h-32 overflow-auto pr-1">
                    {queuePreview.slice(1, 6).map((item) => (
                      <div key={`${item.token}-${item.wait_after_mins}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center justify-between text-xs text-white/75">
                        <span className="font-semibold">Token #{item.token}</span>
                        <span className="text-white/50">{item.service_name || "Service"} · {item.wait_after_mins || 0}m</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {notices.length > 0 ? (
              <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/70 backdrop-blur-md shadow-[0_16px_60px_-30px_rgba(0,0,0,0.75)] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-white/50">Notices</div>
                    <div className="text-white font-semibold text-sm">Resident announcements</div>
                  </div>
                  <div className="text-[11px] text-white/50 uppercase tracking-wider">{notices.length} active</div>
                </div>
                <div className="grid gap-2 max-h-40 overflow-auto pr-1">
                  {notices.slice(0, 5).map((n) => (
                    <div key={n.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75">
                      <div className="font-semibold text-white">{n.title || "Notice"}</div>
                      <div className="text-white/60 mt-1 line-clamp-2">{n.body || ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {overlay ? (
        <div className="absolute top-20 right-4 z-30 w-[min(92vw,380px)] pointer-events-none">
          <div className="rounded-2xl border border-white/15 bg-black/80 backdrop-blur-md shadow-[0_20px_80px_-30px_rgba(0,0,0,0.85)] p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/80 mb-1">Voice result</div>
            <div className="text-white font-semibold text-base leading-tight truncate">{overlay.title || "Result"}</div>

            {Array.isArray(overlay.items) && overlay.items.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2 max-h-[56vh] overflow-auto pr-1">
                {overlay.items.map((item) => (
                  <div key={item.id || item.name} className="rounded-xl border border-white/10 bg-white/5 p-2">
                    <div className="w-full h-20 rounded-lg overflow-hidden bg-white/10 mb-2">
                      {item.image ? <img src={item.image} alt={item.name || "product"} className="w-full h-full object-cover" /> : null}
                    </div>
                    <div className="text-xs text-white font-semibold truncate">{item.name || "Product"}</div>
                    {item.price != null ? <div className="text-[11px] text-white/60">Rs {Number(item.price || 0).toLocaleString()}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 flex gap-3">
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-white/10 shrink-0">
                  {overlay.image ? (
                    <img src={overlay.image} alt={overlay.title || "match"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-white/50 uppercase tracking-wider">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white/65 mt-1 line-clamp-3">{overlay.description || "Matched from spoken command"}</div>
                  <div className="text-[10px] text-white/45 uppercase tracking-wider mt-2">{overlay.type || "item"}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {!hasContent ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 mb-3">No content scheduled</div>
            <h1 className="font-display text-3xl font-extrabold tracking-tighter mb-3">{payload.device_name}</h1>
            <p className="text-sm text-white/60">Ask your client account to upload media, build a playlist, and schedule it for this device.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative min-h-0 bg-black overflow-hidden">
          <div className={`absolute ${orientation === "portrait" ? "" : "inset-0 p-1"}`} style={contentStyle}>
            {hasAbsoluteLayout ? (
              <div className="relative w-full h-full overflow-hidden bg-black">
                {zoneEntries.map(({ zone, items }) => {
                  // Use swapped canvas dimensions when in portrait mode so
                  // absolute zone coordinates map correctly after rotation.
                  const rawLeft = ((Number(zone.x) || 0) / canvasWidth) * 100;
                  const rawTop = ((Number(zone.y) || 0) / canvasHeight) * 100;
                  const rawWidth = ((Number(zone.width_px) || canvasWidth) / canvasWidth) * 100;
                  const rawHeight = ((Number(zone.height_px) || canvasHeight) / canvasHeight) * 100;
                  // clamp values to viewport to avoid zones overflowing
                  const left = Math.max(0, Math.min(100, rawLeft));
                  const top = Math.max(0, Math.min(100, rawTop));
                  const width = Math.max(0, Math.min(100, rawWidth, 100 - left));
                  const height = Math.max(0, Math.min(100, rawHeight, 100 - top));
                  const isTickerZone = /ticker/i.test(`${zone.id} ${zone.name}`);
                  return (
                    <div
                      key={zone.id}
                      className="absolute overflow-hidden bg-black"
                      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                    >
                      {isTickerZone ? <TickerSlot items={items} label={zone.name} /> : <MediaSlot items={items} label={zone.name} />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-1 w-full h-full min-h-0" style={gridStyle}>
                {zoneEntries.map(({ zone, items }) => (
                  <div key={zone.id} className="bg-black overflow-hidden relative min-h-[160px]">
                    {/ticker/i.test(`${zone.id} ${zone.name}`) ? <TickerSlot items={items} label={zone.name} /> : <MediaSlot items={items} label={zone.name} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { animation: marquee 28s linear infinite; }
      `}</style>
    </div>
  );
}

