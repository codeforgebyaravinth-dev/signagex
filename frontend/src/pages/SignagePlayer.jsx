import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Monitor, CircleSlash, Maximize } from "lucide-react";

const RAW_BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const BASE = RAW_BASE.replace(/\/api$/, "");

function getMediaFit(item) {
  return item?.fit === "contain" ? "object-contain" : "object-cover";
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundaryIncludes(haystack, needle) {
  if (!needle) return false;
  try {
    const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
    return re.test(haystack);
  } catch (e) {
    return haystack.includes(needle);
  }
}

function normalizeRoomToken(s) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarityScore(a, b) {
  if (!a || !b) return 0;
  const la = a.length, lb = b.length;
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / Math.max(la, lb));
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

  const resolveSrc = (it) => {
    const candidate = it?.url || it?.image_url || it?.public_url || it?.media_url || (it?.media_id ? `/api/media/${it.media_id}` : "");
    if (!candidate) return "";
    // if it's already absolute, return as-is
    if (/^https?:\/\//i.test(candidate) || /^data:/i.test(candidate)) return candidate;
    // ensure leading slash
    const pref = BASE || "";
    if (candidate.startsWith("/")) return `${pref}${candidate}`;
    return `${pref}/${candidate}`;
  };

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
        <img src={resolveSrc(cur)} alt={cur.name} className={`w-full h-full ${getMediaFit(cur)} object-center bg-black`} onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }} />
      ) : (
        <video
          src={resolveSrc(cur)}
          autoPlay
          muted
          playsInline
          className={`w-full h-full ${getMediaFit(cur)} object-center bg-black`}
          onEnded={handleMediaEnd}
          onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }}
        />
      )
    ) : isImageItem(cur) ? (
      <img src={resolveSrc(cur)} alt={cur.name} className={`w-full h-full ${getMediaFit(cur)} object-center bg-black`} onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }} />
    ) : (
      <video
        src={resolveSrc(cur)}
        autoPlay
        muted
        playsInline
        className={`w-full h-full ${getMediaFit(cur)} object-center bg-black`}
        onEnded={handleMediaEnd}
        onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }}
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

function QueueBoard({ deviceName, queuePreview, notices }) {
  const currentToken = queuePreview?.[0] || null;
  const upNext = Array.isArray(queuePreview) ? queuePreview.slice(1, 4) : [];
  const highlightNotice = Array.isArray(notices) && notices.length > 0 ? notices[0] : null;
  const queueCount = Array.isArray(queuePreview) ? queuePreview.length : 0;

  if (!currentToken && upNext.length === 0 && !highlightNotice) return null;

  return (
    <div className="pointer-events-auto w-full max-w-full overflow-hidden rounded-none border border-white/10 bg-[#080608]/92 text-white shadow-none backdrop-blur-[1px]">
      <div className="flex flex-col gap-2">
      <div className="relative shrink-0 border-b border-white/10 px-3 pt-2 pb-2 text-center">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500 via-rose-500 to-fuchsia-500" />
        <div className="mx-auto mb-1.5 flex h-10 w-10 items-center justify-center rounded-none border border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200">
          <span className="text-[10px] font-bold uppercase tracking-[0.35em]">RP</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.5em] text-white/55">{deviceName || "Token Display"}</div>
        <div className="mt-1 text-xl font-black uppercase tracking-[0.22em] text-white">Now Serving</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.35em] text-white/40">Live queue {queueCount ? `· ${queueCount} waiting` : ""}</div>
      </div>

      <div className="px-3 pb-3 space-y-2.5">
        {currentToken ? (
          <div className="rounded-none border border-fuchsia-400/25 bg-[radial-gradient(circle_at_top,rgba(236,72,153,0.24),transparent_60%),linear-gradient(180deg,rgba(236,72,153,0.16),rgba(8,6,8,0.98))] px-3 py-4 text-center shadow-none">
            <div className="text-[10px] uppercase tracking-[0.4em] text-fuchsia-200/85">Current token</div>
            <div className="mt-2 font-display text-[clamp(3rem,8vw,5rem)] font-black leading-none tracking-tight text-white">
              {currentToken.token}
            </div>
            <div className="mt-2 text-[clamp(0.95rem,2.2vw,1.35rem)] font-semibold text-white/90">
              {currentToken.service_name || currentToken.patient_name || "Queue item"}
            </div>
            <div className="mt-1.5 text-[10px] uppercase tracking-[0.4em] text-white/45">
              {currentToken.service_duration_mins ? `${currentToken.service_duration_mins} min` : "Live queue"}
            </div>
          </div>
        ) : null}

        {upNext.length > 0 ? (
          <div className="rounded-none border border-white/10 bg-white/5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.35em] text-white/55">Up next</div>
              <div className="text-[10px] uppercase tracking-[0.35em] text-white/35">Preview</div>
            </div>
            <div className="mt-2 space-y-1.5">
              {upNext.map((item, index) => (
                <div key={`${item.token}-${index}`} className="flex items-center justify-between rounded-none border border-white/10 bg-black/45 px-2.5 py-2">
                  <div className="flex items-baseline gap-3 min-w-0">
                    <div className="text-lg font-black leading-none text-white">{item.token}</div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-white truncate">{item.service_name || "Service"}</div>
                      <div className="text-[9px] uppercase tracking-[0.3em] text-white/35">
                        {item.status || "pending"}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-[9px] uppercase tracking-[0.3em] text-white/40">
                    {item.wait_after_mins ? `${item.wait_after_mins}m wait` : "Queued"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {highlightNotice ? (
          <div className="max-h-[96px] overflow-hidden rounded-none border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/90 via-rose-500/80 to-pink-400/85 p-2.5 text-white shadow-none">
            <div className="text-[10px] uppercase tracking-[0.4em] text-white/75">Special offer</div>
            <div className="mt-0.5 text-base font-black uppercase leading-tight">Live notice</div>
            <div className="mt-1 text-[11px] font-semibold text-white/90 line-clamp-2">
              {highlightNotice.title || highlightNotice.body || "Queue updates available"}
            </div>
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}

function isQueueZone(zone) {
  return zone?.role === "queue" || /queue|token/i.test(`${zone?.id || ""} ${zone?.name || ""}`);
}

function isLogoZone(zone) {
  return zone?.role === "logo" || /logo|brand/i.test(`${zone?.id || ""} ${zone?.name || ""}`);
}

function getClientLogoUrl(providerData, payload) {
  return providerData?.profile?.image_url || providerData?.image_url || payload?.client_logo_url || "";
}

export default function SignagePlayer() {
  const { pairCode } = useParams();
  const [payload, setPayload] = useState(null);
  const [providerData, setProviderData] = useState(null);
  const [err, setErr] = useState("");
  const lastGreetSpokenRef = useRef(0);
  const wrapRef = useRef(null);
  const recogRef = useRef(null);
  const [overlay, setOverlay] = useState(null); // single: {title,image,description,meta,type} | multi: {title,type,items[]}
  const overlayTimer = useRef(null);
  const overlayKeyRef = useRef("");
  const genericProductCursorRef = useRef(0);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const voiceGreetingPlayedRef = useRef(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showHud, setShowHud] = useState(false);
  const hudTimerRef = useRef(null);

  const revealHud = useCallback(() => {
    setShowHud(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setShowHud(false), 3000);
  }, []);

  const poll = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE}/api/public/player/${pairCode}`);
      setPayload(data);
      try { console.debug("player-payload", data); } catch (e) {}
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

  useEffect(() => () => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
  }, []);

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

  // show subscription-required overlay if provider subscription inactive
  useEffect(() => {
    if (!providerData) return;
    try {
      const sub = providerData.subscription;
      if (sub && sub.active === false) {
        if (!overlayKeyRef.current) {
          setOverlay({ title: "Subscription required", description: "This signage requires an active subscription to run.", type: "subscription_required", takeover: true });
          overlayKeyRef.current = "subscription_required";
        }
      } else {
        if (overlayKeyRef.current === "subscription_required") {
          overlayKeyRef.current = "";
          setOverlay(null);
        }
      }
    } catch (e) {}
  }, [providerData]);

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

      const productCatalog = catalog.filter((c) => c.type === "product");
      // If user greets the player (hello/hi), respond via TTS and show a small product group
      try {
        const greetingRE = /\b(hello|hi|hey)\b/i;
        const isGreeting = greetingRE.test(normTranscript);
        if (isGreeting && productCatalog.length > 0 && (Date.now() - (lastGreetSpokenRef.current || 0) > 30_000)) {
          lastGreetSpokenRef.current = Date.now();
          try {
            if (typeof window !== "undefined" && window.speechSynthesis) {
              const u = new SpeechSynthesisUtterance("Hello — I'll fetch some products for you");
              u.lang = navigator.language || "en-US";
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(u);
            }
          } catch (e) {}
          // show up to 5 products (rotate cursor)
          const start = genericProductCursorRef.current % productCatalog.length;
          const count = Math.min(5, productCatalog.length);
          const items = new Array(count).fill(0).map((_, i) => {
            const p = productCatalog[(start + i) % productCatalog.length];
            return { id: p.id, name: p.meta?.name || p.name, image: p.image || p.meta?.image_url || "", description: p.desc || p.meta?.description || "", price: p.meta?.price };
          });
          genericProductCursorRef.current = (genericProductCursorRef.current + count) % Math.max(1, productCatalog.length);
          const groupKey = `greet:products:${items.map((p) => p.id || p.name).join("|")}`;
          setOverlay({ title: "Products", type: "product_group", items });
          overlayKeyRef.current = groupKey;
          if (overlayTimer.current) clearTimeout(overlayTimer.current);
          overlayTimer.current = setTimeout(() => { overlayKeyRef.current = ""; setOverlay(null); }, 30_000);
          return;
        }
      } catch (e) {}
      const queryTerms = normTranscript
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w && w.length > 2 && !["show", "shows", "any", "all", "the", "please", "product", "products", "item", "items", "browse", "display", "list", "me"].includes(w));
      const singular = (w) => (w.endsWith("s") ? w.slice(0, -1) : w);
      const groupedProducts = productCatalog.filter((p) => {
        const nameTokens = (p.name || "").split(/\s+/).map((t) => singular(t));
        const tagTokens = Array.isArray(p.tags) ? p.tags.map((t) => singular(normalize(t))) : [];
        const keywordTokens = Array.isArray(p.keywords) ? p.keywords.map((t) => singular(t)) : [];
        const pTokens = Array.from(new Set([...(nameTokens || []), ...tagTokens, ...keywordTokens]));
        return queryTerms.some((q) => pTokens.includes(singular(q)));
      });
      const wantsCollection = groupedProducts.length > 0 && /\b(show|shows|all|list|display|browse)\b/.test(normTranscript);

      // If the user said a category (like "maxi") and multiple products match, show the full product group takeover.
      if (groupedProducts.length > 1 && queryTerms.length > 0) {
        const qtSet = new Set(queryTerms.map((q) => singular(q)));
        const groupMatch = groupedProducts.filter((p) => {
          const tokens = (p.name || "").split(/\s+/).map((t) => singular(t));
          return tokens.some((t) => qtSet.has(t));
        });
        if (groupMatch.length > 0) {
          const items = groupMatch.map((p) => ({ id: p.id, name: p.meta?.name || p.name, image: p.image || p.meta?.image_url || "", description: p.desc || p.meta?.description || "", price: p.meta?.price }));
          const groupKey = `group:product:${queryTerms.join("-")}:${items.map((p) => p.id || p.name).join("|")}`;
          if (overlayKeyRef.current === groupKey) return;
          setOverlay({ title: queryTerms.length ? `Showing ${queryTerms.join(" ")}` : "Products", type: "product_group", items, takeover: true });
          overlayKeyRef.current = groupKey;
          if (overlayTimer.current) clearTimeout(overlayTimer.current);
          overlayTimer.current = setTimeout(() => { overlayKeyRef.current = ""; setOverlay(null); }, 30_000);
          return;
        }
      }

      // Scored matching with word-boundary checks and fuzzy fallback to avoid accidental substring matches (eg A 01 vs A 201)
      const scored = catalog.map((c) => {
        const n = (c.name || "").toLowerCase();
        let score = 0;
        if (n && normTranscript === n) score += 200;
        if (n && wordBoundaryIncludes(normTranscript, n)) score += 120;
        // boost resident name exact matches strongly
        if (c.type === "room_resident" && c.name && wordBoundaryIncludes(normTranscript, (c.name || "").toLowerCase())) score += 220;
        // normalize room numbers and prefer exact normalized match (A01 vs A201)
        if (c.type === "room_no") {
          const normRoom = normalizeRoomToken(c.name || "");
          const normTranscriptToken = normalizeRoomToken(normTranscript);
          if (normRoom && normTranscriptToken && normRoom === normTranscriptToken) score += 240;
          // if transcript contains the room token as word-boundary
          if (normRoom && normTranscriptToken && normTranscript.includes((c.name || "").toLowerCase())) score += 80;
        }
        // product-specific boosts to avoid mis-mapping
        if (c.type === "product") {
          // exact name
          if (n && normTranscript === n) score += 220;
          // sku exact match if available
          const sku = (c.meta?.sku || "").toLowerCase();
          if (sku && normTranscript.includes(sku)) score += 300;
          // tag matches
          const tagMatches = (c.tags || []).reduce((s, t) => s + (wordBoundaryIncludes(normTranscript, normalize(t)) ? 1 : 0), 0);
          score += tagMatches * 40;
        }
        const tokens = n.split(/\s+/).filter(Boolean);
        const tokenMatches = tokens.reduce((s, t) => s + (wordBoundaryIncludes(normTranscript, t) ? 1 : 0), 0);
        score += tokenMatches * 20;
        const kwMatches = (c.keywords || []).reduce((s, k) => s + (wordBoundaryIncludes(normTranscript, k) ? 1 : 0), 0);
        score += kwMatches * 15;
        const sim = similarityScore(normTranscript, n);
        score += sim * 50;
        return { item: c, score };
      }).sort((a, b) => b.score - a.score);

      const best = scored[0];
      let match = best && best.score > 40 ? best.item : null;
      // require a slightly stronger score for product matches to avoid accidental cross-products
      if (match && match.type === "product" && best.score < 55) {
        match = null;
      }
      // If top two product matches have close scores, show a product group overlay instead of picking one
      const second = scored[1];
      if (best && second && best.item && second.item && best.item.type === "product" && second.item.type === "product") {
        const scoreDelta = (best.score || 0) - (second.score || 0);
        if (scoreDelta < 40) {
          // collect top similar product items
          const topProducts = scored.filter(s => s.item && s.item.type === "product" && s.score > 30).slice(0, 6).map(s => s.item);
          if (topProducts.length > 1) {
            const items = topProducts.map((p) => ({ id: p.id, name: p.meta?.name || p.name, image: p.image || p.meta?.image_url || "", description: p.desc || p.meta?.description || "", price: p.meta?.price }));
            const groupKey = `tiebreak:products:${items.map((p) => p.id || p.name).join("|")}`;
            if (overlayKeyRef.current !== groupKey) {
              setOverlay({ title: "Multiple products", type: "product_group", items, takeover: true });
              overlayKeyRef.current = groupKey;
              if (overlayTimer.current) clearTimeout(overlayTimer.current);
              overlayTimer.current = setTimeout(() => { overlayKeyRef.current = ""; setOverlay(null); }, 30_000);
            }
            match = null;
          }
        }
      }

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
        try {
          // speak owner/room name for accessibility and convenience
          if (typeof window !== "undefined" && window.speechSynthesis) {
            const spokenKey = `spoken:${resolvedKey}`;
            if (!window[spokenKey]) {
              let speakText = "";
              if (resolved.type === "room_resident") speakText = `${resolved.meta.user_name || resolved.name}`;
              else if (resolved.type === "room_no") speakText = `Room ${resolved.meta.room_no || resolved.meta.room || resolved.name}`;
              else if (resolved.type === "provider") speakText = `${resolved.meta?.name || resolved.name}`;
              if (speakText) {
                const u = new SpeechSynthesisUtterance(speakText);
                u.lang = navigator.language || "en-US";
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(u);
                window[spokenKey] = true;
                // clear spoken flag after overlay timeout
                setTimeout(() => { try { window[spokenKey] = false; } catch (e) {} }, 31000);
              }
            }
          }
        } catch (e) {}
      }
    };

    recognition.onstart = () => {
      setVoiceState("listening");
      setVoiceError("");
      try {
        if (!voiceGreetingPlayedRef.current && typeof window !== "undefined" && window.speechSynthesis) {
          const clientName = payload?.client_name || payload?.client?.name || "";
          const greetText = clientName ? `Hello, welcome to ${clientName}` : "Hello";
          const utter = new SpeechSynthesisUtterance(greetText);
          utter.lang = navigator.language || "en-US";
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
          voiceGreetingPlayedRef.current = true;
        }
      } catch (e) {
        // ignore TTS failures (browser restrictions)
      }
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
  const clientLogoUrl = getClientLogoUrl(providerData, payload);
  const colCount = Math.max(1, zoneEntries.length);
  const gridStyle = {
    gridTemplateColumns: colCount === 1 ? "1fr" : colCount === 2 ? "repeat(2, minmax(0, 1fr))" : colCount === 4 ? "repeat(2, minmax(0, 1fr))" : `repeat(${colCount}, minmax(0, 1fr))`,
  };
  const queueSidebarLeft = (() => {
    if (orientation === "portrait" || !hasAbsoluteLayout) return null;
    const queueEntry = zoneEntries.find(({ zone }) => isQueueZone(zone));
    if (!queueEntry?.zone) return null;
    const zone = queueEntry.zone;
    const rawLeft = ((Number(zone.x) || 0) / canvasWidth) * 100;
    const rawWidth = ((Number(zone.width_px) || canvasWidth) / canvasWidth) * 100;
    const clampedLeft = Math.max(0, Math.min(100, rawLeft));
    const clampedWidth = Math.max(0, Math.min(100, rawWidth, 100 - clampedLeft));
    const rightEdge = Math.min(100, clampedLeft + clampedWidth);
    const targetWidth = Math.min(36, Math.max(28, clampedWidth));
    return Math.max(0, Math.min(99 - targetWidth, rightEdge - targetWidth));
  })();

  return (
    <div ref={wrapRef} className="min-h-screen bg-black text-white flex flex-col" data-testid="signage-player" onPointerDown={revealHud} onTouchStart={revealHud}>
      {showHud ? (
        <div className="flex items-center justify-between px-4 py-2 bg-black/80 border-b border-white/10 text-[10px] uppercase tracking-wider font-mono">
          <div className="flex items-center gap-2"><Monitor className="w-3.5 h-3.5" /> {payload.device_name}</div>
          <div className="flex items-center gap-4">
            <button onClick={goFullscreen} className="hover:text-white/80" data-testid="fullscreen-btn"><Maximize className="w-3.5 h-3.5" /></button>
            <span className={`px-2 py-1 rounded-full border ${voiceState === "listening" ? "border-emerald-400/40 text-emerald-300" : voiceState === "unsupported" || voiceState === "error" ? "border-red-400/40 text-red-300" : "border-white/15 text-white/50"}`}>
              voice {voiceState === "listening" ? "listening" : voiceState === "restarting" ? "restarting" : voiceState === "unsupported" ? "unsupported" : voiceState === "error" ? "error" : "idle"}
            </span>
            <span className="text-white/40 text-[11px] ml-2">dbg P:{(providerData?.products || payload?.products || []).length} M:{(overlay?.items?.length) || (overlay ? 1 : 0)}</span>
            <span className="text-white/50">code <span className="text-white">{pairCode}</span></span>
            <span className="text-white/50">{orientation}</span>
          </div>
        </div>
      ) : null}

      

      {voiceError ? (
        <div className="px-4 py-2 border-b border-white/10 bg-red-500/10 text-[11px] text-red-200 font-mono uppercase tracking-wider">
          {voiceError}
        </div>
      ) : null}

      {voiceTranscript ? (
        null
      ) : null}

      {overlay ? (
        overlay.takeover ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-auto">
            <div className="w-[min(96vw,1200px)] max-h-[92vh] overflow-auto rounded-2xl border border-white/15 bg-black/95 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[12px] uppercase tracking-[0.2em] text-emerald-300/80">Voice result</div>
                <div className="text-white font-semibold text-lg leading-tight">{overlay.title || "Result"}</div>
              </div>
              {Array.isArray(overlay.items) && overlay.items.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {overlay.items.map((item) => (
                    <div key={item.id || item.name} className="rounded-lg border border-white/10 bg-white/3 p-4 flex gap-4">
                      <div className="w-40 h-40 rounded overflow-hidden bg-white/10 flex-shrink-0">
                        {item.image ? <img src={item.image} alt={item.name || "product"} className="w-full h-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-bold text-white truncate">{item.name}</div>
                        <div className="text-sm text-white/70 mt-2">{item.description}</div>
                        {item.price != null ? <div className="text-[13px] text-white/60 mt-3">Rs {Number(item.price || 0).toLocaleString()}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-white">{overlay.description || "Matched from spoken command"}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="absolute z-30 w-[min(92vw,380px)] pointer-events-none bottom-6 left-1/2 -translate-x-1/2 sm:top-20 sm:right-4 sm:left-auto sm:translate-x-0 sm:bottom-auto">
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
        )
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
          <div className={`absolute ${orientation === "portrait" ? "" : "inset-0"}`} style={contentStyle}>
            {hasAbsoluteLayout ? (
              <div className="relative w-full h-full overflow-hidden bg-black">
                {zoneEntries.map(({ zone, items }) => {
                  const queueZone = isQueueZone(zone);
                  const isTickerZone = /ticker/i.test(`${zone.id} ${zone.name}`);
                  const logoZone = isLogoZone(zone);
                  const rawLeft = ((Number(zone.x) || 0) / canvasWidth) * 100;
                  const rawTop = ((Number(zone.y) || 0) / canvasHeight) * 100;
                  const rawWidth = ((Number(zone.width_px) || canvasWidth) / canvasWidth) * 100;
                  const rawHeight = ((Number(zone.height_px) || canvasHeight) / canvasHeight) * 100;
                  // Clamp values to viewport and apply queue safe-area guardrails for cleaner signage composition.
                  const clampedLeft = Math.max(0, Math.min(100, rawLeft));
                  const clampedTop = Math.max(0, Math.min(100, rawTop));
                  const clampedWidth = Math.max(0, Math.min(100, rawWidth, 100 - clampedLeft));
                  const clampedHeight = Math.max(0, Math.min(100, rawHeight, 100 - clampedTop));

                  let left = clampedLeft;
                  let top = clampedTop;
                  let width = clampedWidth;
                  let height = clampedHeight;

                  if (orientation !== "portrait" && queueZone) {
                    const rightEdge = Math.min(100, clampedLeft + clampedWidth);
                    const targetWidth = Math.min(36, Math.max(28, clampedWidth));
                    const targetHeight = Math.min(78, Math.max(44, clampedHeight));
                    width = Math.min(targetWidth, rightEdge);
                    height = Math.min(targetHeight, 99 - clampedTop);
                    left = queueSidebarLeft != null
                      ? queueSidebarLeft
                      : Math.max(0, Math.min(99 - width, rightEdge - width));
                    top = Math.max(1, Math.min(clampedTop, 99 - height));
                  }

                  if (orientation !== "portrait" && queueSidebarLeft != null && !queueZone && !isTickerZone) {
                    const safeRightEdge = Math.max(0, queueSidebarLeft - 0.8);
                    const zoneRight = left + width;
                    if (zoneRight > safeRightEdge) {
                      width = Math.max(0, safeRightEdge - left);
                    }
                  }

                  const zoneZIndex = Number.isFinite(Number(zone?.z_index))
                    ? Number(zone.z_index)
                    : (isTickerZone ? 60 : queueZone ? 45 : 20);
                  return (
                    <div
                      key={zone.id}
                      className={`absolute overflow-hidden ${queueZone ? "bg-transparent" : "bg-black"}`}
                      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, zIndex: zoneZIndex }}
                    >
                      {queueZone ? (
                        <QueueBoard deviceName={payload.device_name} queuePreview={queuePreview} notices={notices} />
                      ) : isTickerZone ? (
                        <TickerSlot items={items} label={zone.name} />
                      ) : logoZone && items.length === 0 && clientLogoUrl ? (
                        <div className="w-full h-full flex items-center justify-center bg-black p-4">
                          <div className="w-full h-full rounded-[1.5rem] border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                            <img src={clientLogoUrl} alt={`${payload.device_name || "client"} logo`} className="max-h-[75%] max-w-[75%] object-contain" />
                          </div>
                        </div>
                      ) : (
                        <MediaSlot items={items} label={zone.name} />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-0 w-full h-full min-h-0" style={gridStyle}>
                {zoneEntries.map(({ zone, items }) => (
                  <div key={zone.id} className="bg-black overflow-hidden relative min-h-[160px]">
                    {isQueueZone(zone) ? (
                      <QueueBoard deviceName={payload.device_name} queuePreview={queuePreview} notices={notices} />
                    ) : /ticker/i.test(`${zone.id} ${zone.name}`) ? (
                      <TickerSlot items={items} label={zone.name} />
                    ) : isLogoZone(zone) && items.length === 0 && clientLogoUrl ? (
                      <div className="w-full h-full flex items-center justify-center bg-black p-4">
                        <div className="w-full h-full rounded-[1.5rem] border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                          <img src={clientLogoUrl} alt={`${payload.device_name || "client"} logo`} className="max-h-[75%] max-w-[75%] object-contain" />
                        </div>
                      </div>
                    ) : <MediaSlot items={items} label={zone.name} />}
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

