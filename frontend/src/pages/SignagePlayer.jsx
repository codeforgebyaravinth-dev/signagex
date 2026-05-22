import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Monitor, CircleSlash, Maximize, Menu, X, Eye, EyeOff, RotateCcw, RefreshCw } from "lucide-react";
import { API_BASE } from "../lib/api";

const RAW_BASE = (process.env.REACT_APP_BACKEND_URL || "https://rpsignage.com").replace(/\/$/, "");
const BASE = RAW_BASE.replace(/\/api$/, "");

const ZONE_PLACEMENT_PRESETS = [
  { id: "auto", label: "Auto" },
  { id: "full", label: "Full" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "center", label: "Center" },
];

function getMediaFit(item, mediaMode = "fill") {
  if (item?.fit === "contain") return "object-contain";
  if (item?.fit === "cover") return "object-cover";
  return mediaMode === "fit" ? "object-contain" : "object-cover";
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

function getPlacementRect(placement) {
  switch (placement) {
    case "full":
      return { left: 0, top: 0, width: 100, height: 100 };
    case "left":
      return { left: 0, top: 0, width: 35, height: 100 };
    case "right":
      return { left: 65, top: 0, width: 35, height: 100 };
    case "top":
      return { left: 0, top: 0, width: 100, height: 35 };
    case "bottom":
      return { left: 0, top: 65, width: 100, height: 35 };
    case "center":
      return { left: 15, top: 15, width: 70, height: 70 };
    case "auto":
    default:
      return null;
  }
}

function getZoneRect(zone, canvasWidth, canvasHeight, placement = "auto") {
  const baseLeft = ((Number(zone?.x) || 0) / canvasWidth) * 100;
  const baseTop = ((Number(zone?.y) || 0) / canvasHeight) * 100;
  const baseWidth = ((Number(zone?.width_px) || canvasWidth) / canvasWidth) * 100;
  const baseHeight = ((Number(zone?.height_px) || canvasHeight) / canvasHeight) * 100;

  const clampedLeft = Math.max(0, Math.min(100, baseLeft));
  const clampedTop = Math.max(0, Math.min(100, baseTop));
  const clampedWidth = Math.max(0, Math.min(100, baseWidth, 100 - clampedLeft));
  const clampedHeight = Math.max(0, Math.min(100, baseHeight, 100 - clampedTop));

  const preset = getPlacementRect(placement);
  if (!preset) return { left: clampedLeft, top: clampedTop, width: clampedWidth, height: clampedHeight };
  return preset;
}

let youtubeApiPromise = null;

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === "function") previousReady();
      resolve(window.YT);
    };

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      if (window.YT?.Player) resolve(window.YT);
    }, 2000);
  });

  return youtubeApiPromise;
}

function getWeatherEmoji(weather = {}, conditionText = "") {
  const code = Number(weather?.weather_code);
  if (Number.isFinite(code)) {
    if (code === 0) return "☀️";
    if ([1, 2].includes(code)) return "🌤️";
    if (code === 3) return "☁️";
    if ([45, 48].includes(code)) return "🌫️";
    if ([51, 53, 55].includes(code)) return "🌦️";
    if ([61, 63, 65, 80, 81, 82].includes(code)) return "🌧️";
    if ([71, 73, 75].includes(code)) return "❄️";
    if (code === 95) return "⛈️";
  }

  const text = String(conditionText || weather?.condition || weather?.summary || "").toLowerCase();
  if (/(sun|clear|bright|hot)/.test(text)) return "☀️";
  if (/(partly|mostly clear|cloud|overcast)/.test(text)) return "⛅";
  if (/(fog|mist|haze)/.test(text)) return "🌫️";
  if (/(drizzle|rain|shower)/.test(text)) return "🌧️";
  if (/(snow|sleet|hail)/.test(text)) return "❄️";
  if (/(storm|thunder)/.test(text)) return "⛈️";
  return "🌡️";
}

function getWeatherConditionLabel(weather = {}, conditionText = "") {
  const code = Number(weather?.weather_code);
  const codeMap = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Heavy showers",
    82: "Violent showers",
    95: "Thunderstorm",
  };
  if (Number.isFinite(code) && codeMap[code]) return codeMap[code];
  const text = String(conditionText || weather?.condition || weather?.summary || "").trim();
  return text || "Clear skies";
}

async function fetchWeatherFromCoords(latitude, longitude) {
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,weather_code,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min&timezone=auto`
  );
  if (!response.ok) {
    throw new Error("Weather lookup failed");
  }
  const data = await response.json();
  const current = data?.current || {};
  const daily = data?.daily || {};
  return {
    location: "Current location",
    temperature: current.temperature_2m,
    condition: current.weather_code != null ? `Weather code ${current.weather_code}` : null,
    high: Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null,
    low: Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null,
    humidity: current.relative_humidity_2m,
    weather_code: current.weather_code,
  };
}

function MediaSlot({ items, label, queuePreview, weatherData, zone, canvasWidth, canvasHeight, mediaMode }) {
  const [idx, setIdx] = useState(0);
  const [showFrame, setShowFrame] = useState(true);
  const timerRef = useRef(null);
  const youtubeRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, /^(header|weather)$/i.test(zone?.role || ""));
  const itemCount = Math.max(1, items?.length || 0);
  const handleMediaEnd = useCallback(() => {
    setIdx((i) => (i + 1) % itemCount);
  }, [itemCount]);

  useEffect(() => { setIdx(0); }, [items?.length]);

  useEffect(() => {
    setShowFrame(false);
    const frame = setTimeout(() => setShowFrame(true), 30);
    return () => clearTimeout(frame);
  }, [idx, items, handleMediaEnd]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const cur = items[idx];
    if (!cur) return;
    // Skip timer for videos and YouTube clips - they advance through their own end handlers.
    if (cur.kind === "video") return;
    timerRef.current = setTimeout(() => setIdx((i) => (i + 1) % items.length), (cur.duration || 10) * 1000);
    return () => clearTimeout(timerRef.current);
  }, [idx, items, handleMediaEnd]);

  useEffect(() => {
    const cur = items?.[idx];
    if (!cur || String(cur.type || cur.kind || "").toLowerCase() !== "youtube") {
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !YT?.Player || !youtubeRef.current) return;
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }

      const videoId = getYoutubeId(cur.url);
      if (!videoId) {
        handleMediaEnd();
        return;
      }

      youtubePlayerRef.current = new YT.Player(youtubeRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          fs: 0,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: (event) => {
            event.target.playVideo();
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED) {
              handleMediaEnd();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }
    };
  }, [idx, items, handleMediaEnd]);

  if (!items || items.length === 0) {
    return (
      <ResponsiveZoneShell scale={zoneScale}>
        <div className="w-full h-full flex items-center justify-center text-white/30 text-xs font-mono uppercase tracking-widest">{label}</div>
      </ResponsiveZoneShell>
    );
  }

  const cur = items[idx];
  if (!cur) return null;
  const itemType = String(cur.kind || cur.type || "").toLowerCase();

  if (itemType === "clock") {
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    return (
      <div className="w-full h-full bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.14),_transparent_35%),linear-gradient(180deg,#111827,#0B1120)] p-5 text-white flex flex-col justify-between overflow-hidden">
        <div>
          <div className="text-[10px] uppercase tracking-[0.45em] text-white/45">{cur.title || "Today"}</div>
          <div className="mt-2 text-sm text-white/70">{cur.location || "Local time"}</div>
        </div>
        <div>
          <div className="font-display text-6xl font-black tracking-tight leading-none">{time}</div>
          <div className="mt-2 text-lg text-white/80">{date}</div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-white/60">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Live
          </div>
        </div>
      </div>
    );
  }

  if (itemType === "weather") {
    const weather = weatherData || {};
    const condition = getWeatherConditionLabel(weather, cur.condition || cur.summary || "");
    const locationLabel = weather.location || "Current conditions";
    const emoji = getWeatherEmoji(weather, condition);
    return (
      <div className="w-full h-full bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_40%),linear-gradient(180deg,#0F172A,#111827)] p-5 text-white flex flex-col justify-between overflow-hidden">
        <div>
          <div className="text-[10px] uppercase tracking-[0.45em] text-cyan-200/70 flex items-center gap-2">Weather <span className="text-base leading-none">{emoji}</span></div>
          <div className="mt-2 text-sm text-white/70">{locationLabel}</div>
        </div>
        <div className="space-y-3">
          <div className="font-display text-7xl font-black tracking-tight leading-none">{weather.temperature ?? cur.temperature ?? "--"}°</div>
          <div className="text-lg font-semibold text-white/90 flex items-center gap-2"><span>{emoji}</span><span>{condition}</span></div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em] text-white/60">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">H {weather.high ?? cur.high ?? "--"}°</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">L {weather.low ?? cur.low ?? "--"}°</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Humidity {weather.humidity ?? cur.humidity ?? "--"}%</span>
          </div>
        </div>
      </div>
    );
  }

  if (itemType === "bookings" || itemType === "queue") {
    const sourceEntries = Array.isArray(cur.entries) && cur.entries.length > 0
      ? cur.entries
      : Array.isArray(queuePreview)
        ? queuePreview
        : [];
    const entries = sourceEntries.map((item) => ({
      token: item.token,
      name: item.patient_name || item.service_name || "Booking",
      time: item.assigned_time || item.preferred_time || `${item.wait_after_mins || 0} min`,
      service: item.service_type || item.service_name || item.patient_name || "Appointment",
    }));
    return (
      <div className="w-full h-full bg-[linear-gradient(180deg,#F8FAFC,#EEF2FF)] p-5 text-[#111827] flex flex-col overflow-hidden">
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.45em] text-[#6B7280]">Queue</div>
            <div className="mt-2 font-display text-3xl font-black tracking-tight">{cur.title || "Today's bookings"}</div>
          </div>
          <div className="text-right text-xs text-[#6B7280] uppercase tracking-[0.25em]">Live board</div>
        </div>
        <div className="space-y-3 overflow-hidden">
          {entries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#CBD5E1] bg-white p-4 text-sm text-[#6B7280]">No bookings yet.</div>
          ) : entries.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="rounded-2xl border border-white bg-white/90 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.5)] px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-[#94A3B8]">
                  <span>Token {entry.token || index + 1}</span>
                </div>
                <div className="font-semibold text-lg truncate">{entry.name}</div>
                <div className="text-sm text-[#6B7280] truncate">{entry.service || "Appointment"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-2xl font-black tracking-tight">{entry.time}</div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-[#94A3B8]">{entry.service || "Booking"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (itemType === "notices") {
    const notices = Array.isArray(cur.items) ? cur.items : Array.isArray(cur.notices) ? cur.notices : [];
    return (
      <div className="w-full h-full bg-[linear-gradient(180deg,#111827,#0F172A)] p-5 text-white flex flex-col justify-between overflow-hidden">
        <div>
          <div className="text-[10px] uppercase tracking-[0.45em] text-white/45">{cur.title || "Notices"}</div>
          <div className="mt-2 text-sm text-white/70">Announcements and updates</div>
        </div>
        <div className="space-y-2 overflow-hidden">
          {notices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-white/60">No notices yet.</div>
          ) : notices.slice(0, 4).map((notice, index) => (
            <div key={`${notice.title || notice.body || index}`} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="font-semibold text-base truncate">{notice.title || "Notice"}</div>
              <div className="text-sm text-white/70 line-clamp-2 mt-1">{notice.body || notice.text || ""}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

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

  const content = 
    (cur.type === "text" || cur.kind === "text") ? (
      <div className="w-full h-full flex items-center justify-center bg-black p-6 text-center overflow-hidden">
        <div className="max-w-[90%] text-white font-display text-2xl font-bold leading-tight">{cur.content || cur.text}</div>
      </div>
    ) : (cur.type === "youtube") ? (
      <div className="w-full h-full flex items-center justify-center bg-black overflow-hidden">
        <div ref={youtubeRef} className="w-full h-full" />
      </div>
    ) : (cur.type === "media" || cur.media_id) ? (
      isImageItem(cur) ? (
        <img src={resolveSrc(cur)} alt={cur.name} className={`w-full h-full ${getMediaFit(cur, mediaMode)} object-center bg-black`} onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }} />
      ) : (
        <video
          src={resolveSrc(cur)}
          autoPlay
          muted
          playsInline
          className={`w-full h-full ${getMediaFit(cur, mediaMode)} object-center bg-black`}
          onEnded={handleMediaEnd}
          onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }}
        />
      )
    ) : isImageItem(cur) ? (
      <img src={resolveSrc(cur)} alt={cur.name} className={`w-full h-full ${getMediaFit(cur, mediaMode)} object-center bg-black`} onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }} />
    ) : (
      <video
        src={resolveSrc(cur)}
        autoPlay
        muted
        playsInline
        className={`w-full h-full ${getMediaFit(cur, mediaMode)} object-center bg-black`}
        onEnded={handleMediaEnd}
        onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }}
      />
    );

  return (
    <ResponsiveZoneShell scale={zoneScale}>
      <div className={`w-full h-full overflow-hidden transition-all duration-500 ${showFrame ? "opacity-100 scale-100" : "opacity-0 scale-[1.01]"}`}>
        {content}
      </div>
    </ResponsiveZoneShell>
  );
}

function TickerSlot({ items, label, zone, canvasWidth, canvasHeight }) {
  const [feedEntries, setFeedEntries] = useState([]);
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, false);

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
    return (
      <ResponsiveZoneShell scale={zoneScale}>
        <div className="w-full h-full flex items-center justify-center text-white/30 text-xs font-mono uppercase tracking-widest">{label}</div>
      </ResponsiveZoneShell>
    );
  }

  const repeated = [...feedEntries, ...feedEntries];
  return (
    <ResponsiveZoneShell scale={zoneScale}>
      <div className="w-full h-full overflow-hidden bg-black text-white flex items-center px-4">
        <div className="animate-marquee flex items-center gap-10 whitespace-nowrap font-semibold" style={{ fontSize: `${Math.max(12, Math.round(14 / Math.max(zoneScale, 0.45)))}px` }}>
          {repeated.map((entry, index) => (
            <span key={`${entry.text}-${index}`} className="inline-flex items-center gap-3">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-white/50" />
              <span>{entry.text}</span>
            </span>
          ))}
        </div>
      </div>
    </ResponsiveZoneShell>
  );
}

function QueueBoard({ deviceName, queuePreview, notices, zone, canvasWidth, canvasHeight }) {
  const currentToken = queuePreview?.[0] || null;
  const upNext = Array.isArray(queuePreview) ? queuePreview.slice(1, 4) : [];
  const highlightNotice = Array.isArray(notices) && notices.length > 0 ? notices[0] : null;
  const queueCount = Array.isArray(queuePreview) ? queuePreview.length : 0;
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, false);
  // boost queue visuals so current token is readable when zones are small
  const zoneScaleBoosted = (() => {
    if (!Number.isFinite(zoneScale)) return 1;
    if (zoneScale < 0.7) return Math.min(1, zoneScale * 1.45);
    if (zoneScale < 0.9) return Math.min(1, zoneScale * 1.22);
    return Math.min(1, zoneScale * 1.06);
  })();
  const isCompact = zoneScaleBoosted < 0.8;

  if (!currentToken && upNext.length === 0 && !highlightNotice) return null;

  return (
    <ResponsiveZoneShell scale={zoneScaleBoosted}>
      <div className="pointer-events-auto w-full h-full overflow-hidden rounded-[2.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(2,6,23,0.98),rgba(15,23,42,0.96))] text-white shadow-[0_30px_100px_-34px_rgba(0,0,0,0.85)] backdrop-blur-xl">
        <div className="relative h-full">
        <div className={`absolute -right-16 -top-16 ${isCompact ? "h-28 w-28" : "h-44 w-44"} rounded-full bg-fuchsia-500/18 blur-3xl`} />
        <div className={`absolute -left-10 bottom-0 ${isCompact ? "h-20 w-20" : "h-32 w-32"} rounded-full bg-cyan-400/12 blur-3xl`} />

        <div className={`flex flex-col h-full ${isCompact ? "gap-2" : "gap-4"}`}>
          <div className={`rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.24),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] ${isCompact ? "p-2" : "p-3"} shadow-[0_20px_60px_-36px_rgba(236,72,153,0.45)]`}>
            {currentToken ? (
              <div className={`grid ${isCompact ? "gap-1" : "gap-2"} rounded-[1.75rem] border border-fuchsia-400/18 bg-white/5 ${isCompact ? "p-2" : "p-3"} md:grid-cols-[1fr_0.8fr] md:items-start`}>
                <div className={`flex items-center ${isCompact ? "gap-3" : "gap-4"}`}>
                  <div className={`flex ${isCompact ? "h-18 w-18 text-[1.9rem]" : "h-24 w-24 text-[2.5rem]"} shrink-0 items-center justify-center rounded-[1.75rem] bg-[linear-gradient(135deg,#ec4899,#fb7185,#f97316)] font-black tracking-tight text-white shadow-[0_24px_50px_-16px_rgba(236,72,153,0.9)]`}>
                    {currentToken.token}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.4em] text-fuchsia-100/70">Current token</div>
                    <div className={`mt-2 ${isCompact ? "text-[clamp(0.95rem,1.6vw,1.4rem)]" : "text-[clamp(1.1rem,2vw,1.8rem)]"} font-semibold text-white truncate`}>{currentToken.patient_name || currentToken.service_name || "Queue item"}</div>
                    <div className={`mt-1 ${isCompact ? "text-[0.7rem] tracking-[0.22em]" : "text-sm tracking-[0.28em]"} uppercase text-white/55 truncate`}>{currentToken.service_type || currentToken.service_name || "Appointment"}</div>
                    <div className={`${isCompact ? "mt-0.5 text-[0.75rem]" : "mt-1 text-sm"} text-white/70`}>Live front desk callout</div>
                  </div>
                </div>
                <div className={`grid ${isCompact ? "gap-1.5" : "gap-2"} self-stretch`}>
                  <div className={`rounded-2xl border border-white/10 bg-black/20 ${isCompact ? "px-3 py-2" : "px-4 py-3"}`}>
                    <div className="text-[10px] uppercase tracking-[0.35em] text-white/45">Status</div>
                    <div className={`mt-1 ${isCompact ? "text-xs" : "text-sm"} font-semibold text-white`}>{currentToken.status || "pending"}</div>
                  </div>
                  <div className={`rounded-2xl border border-white/10 bg-black/20 ${isCompact ? "px-3 py-2" : "px-4 py-3"}`}>
                    <div className="text-[10px] uppercase tracking-[0.35em] text-white/45">Time</div>
                    <div className={`mt-1 ${isCompact ? "text-xs" : "text-sm"} font-semibold text-white`}>{currentToken.assigned_time || currentToken.preferred_time || "Live queue"}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className={`mt-2 grid ${isCompact ? "gap-1" : "gap-2"}`}>
            {upNext.length > 0 ? (
              <div className={`rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] ${isCompact ? "p-3" : "p-4"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.35em] text-white/55">Next wave</div>
                    <div className={`mt-1 ${isCompact ? "text-xs" : "text-sm"} text-white/75`}>Upcoming tokens</div>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.35em] text-white/35">{upNext.length} entries</div>
                </div>
                <div className={`mt-2 grid ${isCompact ? "gap-1" : "gap-2"}`}>
                  {upNext.map((item, index) => (
                    <div key={`${item.token}-${index}`} className={`rounded-[1.35rem] border border-white/10 bg-black/30 ${isCompact ? "px-3 py-2.5" : "px-4 py-3.5"}`}>
                      <div className={`flex items-center ${isCompact ? "gap-2.5" : "gap-3"}`}>
                        <div className={`flex ${isCompact ? "h-10 w-10 text-base" : "h-12 w-12 text-lg"} shrink-0 items-center justify-center rounded-2xl bg-white/10 font-black text-white`}>
                          {item.token}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`font-semibold text-white truncate ${isCompact ? "text-xs" : "text-sm"}`}>{item.patient_name || item.service_name || "Service"}</div>
                          <div className={`mt-1 uppercase tracking-[0.32em] text-white/50 truncate ${isCompact ? "text-[9px]" : "text-[10px]"}`}>{item.service_type || item.service_name || "Appointment"}</div>
                          <div className={`mt-1 flex items-center gap-2 uppercase tracking-[0.32em] text-white/40 ${isCompact ? "text-[9px]" : "text-[10px]"}`}>
                            <span>{item.status || "pending"}</span>
                            <span className="h-1 w-1 rounded-full bg-white/20" />
                            <span>{item.assigned_time || item.preferred_time || (item.wait_after_mins ? `${item.wait_after_mins}m wait` : "Queued")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {highlightNotice ? (
              <div className={`overflow-hidden rounded-[2rem] border border-fuchsia-400/20 bg-[linear-gradient(135deg,rgba(217,70,239,0.95),rgba(244,63,94,0.92),rgba(251,146,60,0.9))] ${isCompact ? "p-3" : "p-4"} text-white shadow-[0_18px_50px_-24px_rgba(244,63,94,0.8)]`}>
                <div className="text-[10px] uppercase tracking-[0.4em] text-white/75">Priority notice</div>
                <div className={`mt-1 font-black uppercase leading-tight ${isCompact ? "text-base" : "text-xl"}`}>Live update</div>
                <div className={`mt-2 font-medium text-white/92 line-clamp-3 ${isCompact ? "text-xs" : "text-sm"}`}>
                  {highlightNotice.title || highlightNotice.body || "Queue updates available"}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </ResponsiveZoneShell>
  );
}

function isQueueZone(zone) {
  return zone?.role === "queue" || /queue|token/i.test(`${zone?.id || ""} ${zone?.name || ""}`);
}

function isLogoZone(zone) {
  return zone?.role === "logo" || /logo|brand/i.test(`${zone?.id || ""} ${zone?.name || ""}`);
}

function isAutoWidgetZone(zone) {
  return /^(header|weather|bookings)$/i.test(zone?.role || "");
}

function AutoWidgetZone({ zone, queuePreview, payload, providerData, weatherData, canvasWidth, canvasHeight }) {
  const role = String(zone?.role || "").toLowerCase();
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, false);

  if (role === "header") {
    return (
      <ResponsiveZoneShell scale={zoneScale}>
        <div className="w-full h-full bg-[linear-gradient(90deg,#111827,#0F172A)] p-4 text-white flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.45em] text-white/45">Today</div>
            <div className="mt-1 font-display text-3xl font-black tracking-tight">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.45em] text-white/45">Local time</div>
            <div className="mt-1 font-display text-4xl font-black tracking-tight">
              {new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </ResponsiveZoneShell>
    );
  }

  if (role === "weather") {
    const weather = weatherData || payload?.weather || providerData?.weather || {};
    const temperature = weather.temperature ?? weather.temp ?? "--";
    const condition = getWeatherConditionLabel(weather, weather.condition || weather.summary || "Weather sync pending");
    const high = weather.high ?? weather.max ?? "--";
    const low = weather.low ?? weather.min ?? "--";
    const emoji = getWeatherEmoji(weather, condition);
    return (
      <ResponsiveZoneShell scale={zoneScale}>
        <div className="w-full h-full bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_40%),linear-gradient(180deg,#0F172A,#111827)] p-5 text-white flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.45em] text-cyan-200/70 flex items-center gap-2">Weather <span className="text-base leading-none">{emoji}</span></div>
            <div className="mt-2 text-sm text-white/70">{weather.location || zone?.name || "Current conditions"}</div>
          </div>
          <div className="space-y-3">
            <div className="font-display text-7xl font-black tracking-tight leading-none">{temperature}°</div>
            <div className="text-lg font-semibold text-white/90 flex items-center gap-2"><span>{emoji}</span><span>{condition}</span></div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em] text-white/60">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">H {high}°</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">L {low}°</span>
            </div>
          </div>
        </div>
      </ResponsiveZoneShell>
    );
  }

  if (role === "bookings") {
    const rawEntries = Array.isArray(providerData?.queue_preview) && providerData.queue_preview.length > 0
      ? providerData.queue_preview
      : (Array.isArray(queuePreview) ? queuePreview : []);
    const entries = rawEntries.map((item) => ({
      token: item.token,
      name: item.patient_name || item.service_name || "Booking",
      time: item.assigned_time || item.preferred_time || `${item.wait_after_mins || 0} min`,
      service: item.service_type || item.service_name || "Appointment",
    }));

    return (
      <ResponsiveZoneShell scale={zoneScale}>
        <div className="w-full h-full bg-[linear-gradient(180deg,#F8FAFC,#EEF2FF)] p-5 text-[#111827] flex flex-col">
          <div className="grid h-full gap-4 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="relative overflow-hidden rounded-[2rem] border border-[#DBE4F0] bg-[linear-gradient(180deg,#0F172A,#111827)] p-5 text-white shadow-[0_20px_60px_-36px_rgba(15,23,42,0.65)]">
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-fuchsia-400/20 blur-3xl" />
            <div className="absolute -left-8 bottom-0 h-20 w-20 rounded-full bg-cyan-400/12 blur-3xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-white/65">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Front desk
              </div>
              <div className="mt-4 text-[10px] uppercase tracking-[0.4em] text-white/45">{zone?.name || "Today's bookings"}</div>
              <div className="mt-2 font-display text-[clamp(2.25rem,4vw,3.5rem)] font-black uppercase tracking-[0.08em] text-white">Booking Lane</div>
              <div className="mt-3 text-sm text-white/70 max-w-xs">A premium guest list for appointments and walk-ins, designed for lobby screens.</div>

              <div className="mt-8 rounded-[1.75rem] border border-white/10 bg-white/6 p-4">
                <div className="text-[10px] uppercase tracking-[0.4em] text-white/50">Visible entries</div>
                <div className="mt-2 font-display text-[clamp(3rem,6vw,4.5rem)] font-black tracking-tight text-white">{String(entries.length).padStart(2, "0")}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.35em] text-white/40">Auto refreshed</div>
              </div>
            </div>
          </div>

            <div className="rounded-[2rem] border border-white/80 bg-white/90 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.3)] p-4 md:p-5 overflow-hidden">
            <div className="flex items-end justify-between gap-3 pb-4 border-b border-[#E2E8F0]">
              <div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-[#94A3B8]">Queue</div>
                <div className="mt-1 font-display text-[clamp(1.6rem,3vw,2.4rem)] font-black tracking-tight text-[#0F172A]">Today’s bookings</div>
              </div>
              <div className="text-[10px] uppercase tracking-[0.35em] text-[#94A3B8]">Live board</div>
            </div>

            <div className="mt-4 grid gap-3 overflow-hidden">
              {entries.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-5 text-sm text-[#64748B]">
                  No bookings yet.
                </div>
              ) : entries.slice(0, 4).map((entry, index) => (
                <div key={`${entry.name}-${index}`} className="rounded-[1.5rem] border border-[#E2E8F0] bg-white px-4 py-4 shadow-[0_14px_30px_-22px_rgba(15,23,42,0.25)] flex items-center justify-between gap-4">
                  <div className="min-w-0 flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.25rem] bg-[linear-gradient(135deg,#111827,#334155)] text-white font-display text-base font-black tracking-tight shadow-lg">
                      {entry.token || String(entry.name || "B").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.32em] text-[#94A3B8]">Token {entry.token || index + 1}</div>
                      <div className="font-semibold text-lg truncate text-[#0F172A]">{entry.name}</div>
                      <div className="mt-1 text-sm text-[#64748B] truncate">{entry.service || "Appointment"}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-[#64748B]">Scheduled</div>
                    <div className="mt-2 font-display text-[clamp(1.4rem,2.5vw,2rem)] font-black tracking-tight text-[#0F172A]">{entry.time}</div>
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>
        </div>
      </ResponsiveZoneShell>
    );
  }

  return null;
}

function getClientLogoUrl(providerData, payload) {
  return providerData?.profile?.image_url || providerData?.image_url || payload?.client_logo_url || "";
}

function getZoneScale(zone, canvasWidth, canvasHeight, preferCover = false) {
  const zoneWidth = Number(zone?.width_px ?? canvasWidth) || canvasWidth || 1920;
  const zoneHeight = Number(zone?.height_px ?? canvasHeight) || canvasHeight || 1080;
  const baseWidth = Number(canvasWidth) || 1920;
  const baseHeight = Number(canvasHeight) || 1080;
  const widthScale = zoneWidth / baseWidth;
  const heightScale = zoneHeight / baseHeight;
  // preferCover: use cover (fill) scaling so the component fills the zone.
  // Otherwise use contain scaling to avoid overflowing content.
  const rawScale = preferCover
    ? Math.max(widthScale, heightScale) * 0.98
    : Math.min(widthScale, heightScale) * 0.94;
  return Math.max(0.35, Math.min(1, Number.isFinite(rawScale) ? rawScale : 1));
}

function ResponsiveZoneShell({ scale = 1, className = "", children }) {
  const safeScale = Math.max(0.35, Math.min(1, Number(scale) || 1));
  const inverseScale = 1 / safeScale;
  return (
    <div className="w-full h-full overflow-hidden" style={{ contain: "layout paint size" }}>
      <div
        className={className}
        style={{
          transform: `scale(${safeScale})`,
          transformOrigin: "top left",
          width: `${inverseScale * 100}%`,
          height: `${inverseScale * 100}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function SignagePlayer() {
  const { pairCode } = useParams();
  const [payload, setPayload] = useState(null);
  const [providerData, setProviderData] = useState(null);
  const [liveWeather, setLiveWeather] = useState(null);
  const [weatherState, setWeatherState] = useState("idle");
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiddenZoneIds, setHiddenZoneIds] = useState([]);
  const [fillBlankSpaces, setFillBlankSpaces] = useState(true);
  const [customPlacementEnabled, setCustomPlacementEnabled] = useState(false);
  const [zonePlacements, setZonePlacements] = useState({});
  const [zoneMediaModes, setZoneMediaModes] = useState({});

  const zonePrefsKey = useMemo(() => `signage-player-zone-prefs:${pairCode || "default"}`, [pairCode]);

  const toggleZoneVisibility = useCallback((zoneId) => {
    setHiddenZoneIds((current) => (
      current.includes(zoneId)
        ? current.filter((id) => id !== zoneId)
        : [...current, zoneId]
    ));
  }, []);

  const setZonePlacement = useCallback((zoneId, placement) => {
    setZonePlacements((current) => ({
      ...current,
      [zoneId]: placement,
    }));
  }, []);

  const setZoneMediaMode = useCallback((zoneId, mode) => {
    setZoneMediaModes((current) => ({
      ...current,
      [zoneId]: mode,
    }));
  }, []);

  const resetZoneVisibility = useCallback(() => {
    setHiddenZoneIds([]);
    setFillBlankSpaces(true);
    setCustomPlacementEnabled(false);
    setZonePlacements({});
    setZoneMediaModes({});
  }, []);

  const toggleMenu = useCallback(() => setMenuOpen((current) => !current), []);

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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(zonePrefsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.hiddenZoneIds)) setHiddenZoneIds(parsed.hiddenZoneIds);
      if (typeof parsed?.fillBlankSpaces === "boolean") setFillBlankSpaces(parsed.fillBlankSpaces);
      if (typeof parsed?.customPlacementEnabled === "boolean") setCustomPlacementEnabled(parsed.customPlacementEnabled);
      if (parsed?.zonePlacements && typeof parsed.zonePlacements === "object") setZonePlacements(parsed.zonePlacements);
      if (parsed?.zoneMediaModes && typeof parsed.zoneMediaModes === "object") setZoneMediaModes(parsed.zoneMediaModes);
    } catch {
      // Ignore malformed local preferences.
    }
  }, [zonePrefsKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(zonePrefsKey, JSON.stringify({ hiddenZoneIds, fillBlankSpaces, customPlacementEnabled, zonePlacements, zoneMediaModes }));
    } catch {
      // Ignore storage failures in restricted webviews.
    }
  }, [zonePrefsKey, hiddenZoneIds, fillBlankSpaces, customPlacementEnabled, zonePlacements, zoneMediaModes]);

  // debug overlays
  const debugZones = typeof window !== "undefined" && window.location.search.includes("debug_zones");
  const inspectZones = typeof window !== "undefined" && window.location.search.includes("inspect_zones");
  const absoluteContainerRef = useRef(null);
  const zoneRefs = useRef({});
  const [zoneInspections, setZoneInspections] = useState({});

  useEffect(() => {
    if (!inspectZones) return;
    let mounted = true;
    const measure = () => {
      const container = absoluteContainerRef.current || wrapRef.current;
      if (!container) return;
      const cb = container.getBoundingClientRect();
      const cw = container.clientWidth || Math.max(1, cb.width);
      const ch = container.clientHeight || Math.max(1, cb.height);
      // When orientation is portrait the content is rotated: canvas width maps to DOM height and vice versa
      const renderWidth = orientation === "portrait" ? ch : cw;
      const renderHeight = orientation === "portrait" ? cw : ch;
      const next = {};
      Object.keys(zoneRefs.current || {}).forEach((id) => {
        try {
          const el = zoneRefs.current[id];
          if (!el) return;
          const r = el.getBoundingClientRect();

          // find zone definition to compute expected size from configured px values
          const entry = zoneEntries.find((ze) => (ze.zone?.id || String(ze.zone)) === id);
          const cfgWpx = Number(entry?.zone?.width_px ?? canvasWidth) || canvasWidth || 1920;
          const cfgHpx = Number(entry?.zone?.height_px ?? canvasHeight) || canvasHeight || 1080;

          const expectedW = Math.round((cfgWpx / (canvasWidth || 1)) * renderWidth);
          const expectedH = Math.round((cfgHpx / (canvasHeight || 1)) * renderHeight);

          next[id] = {
            width: Math.round(r.width),
            height: Math.round(r.height),
            expectedWidth: expectedW,
            expectedHeight: expectedH,
            left: Math.round(r.left - cb.left),
            top: Math.round(r.top - cb.top),
          };
        } catch (e) {
          // ignore per-zone failures
        }
      });
      if (mounted) setZoneInspections(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    const container = absoluteContainerRef.current || wrapRef.current;
    if (container) ro.observe(container);
    const id = setInterval(measure, 900);
    window.addEventListener("resize", measure);
    return () => { mounted = false; try { ro.disconnect(); } catch {} clearInterval(id); window.removeEventListener("resize", measure); };
  }, [inspectZones, payload]);

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
  const visibleZoneDefs = useMemo(
    () => zoneDefs.filter((zone) => !hiddenZoneIds.includes(zone.id)),
    [hiddenZoneIds, zoneDefs]
  );
  const hasWeatherZone = zoneDefs.some((zone) => /weather/i.test(`${zone?.role || ""} ${zone?.id || ""} ${zone?.name || ""}`));
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
  const hasCustomPlacements = customPlacementEnabled && Object.keys(zonePlacements || {}).length > 0;
  const renderAsAbsolute = hasAbsoluteLayout || hasCustomPlacements;

  useEffect(() => {
    if (!hasWeatherZone) return;
    if (payload?.weather || providerData?.weather || liveWeather) return;
    if (weatherState === "denied" || weatherState === "error") return;
    if (typeof window === "undefined" || !navigator.geolocation) {
      setWeatherState("unsupported");
      return;
    }

    let cancelled = false;
    setWeatherState("requesting");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (cancelled) return;
        try {
          const weather = await fetchWeatherFromCoords(position.coords.latitude, position.coords.longitude);
          if (cancelled) return;
          setLiveWeather(weather);
          setWeatherState("ready");
        } catch {
          if (!cancelled) setWeatherState("error");
        }
      },
      (error) => {
        if (cancelled) return;
        setWeatherState(error?.code === 1 ? "denied" : "error");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );

    return () => {
      cancelled = true;
    };
  }, [hasWeatherZone, liveWeather, payload?.weather, providerData?.weather, weatherState]);

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

  const shouldCompactLayout = fillBlankSpaces && hiddenZoneIds.length > 0;
  const zoneEntries = visibleZoneDefs.map((zone) => ({ zone, items: payload.zones?.[zone.id] || [] }));
  const hasContent = zoneEntries.some(({ items }) => items.length > 0);
  const queuePreview = Array.isArray(providerData?.queue_preview)
    ? providerData.queue_preview
    : (Array.isArray(payload?.queue_preview) ? payload.queue_preview : []);
  const notices = Array.isArray(providerData?.notices)
    ? providerData.notices
    : (Array.isArray(payload?.notices) ? payload.notices : []);
  const weatherData = liveWeather || payload?.weather || providerData?.weather || null;
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
    <div ref={wrapRef} className="min-h-screen bg-black text-white flex flex-col" data-testid="signage-player">
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
            {renderAsAbsolute && !shouldCompactLayout ? (
              <>
              <div ref={absoluteContainerRef} className="relative w-full h-full overflow-hidden bg-black">
                {zoneEntries.map(({ zone, items }) => {
                  const queueZone = isQueueZone(zone);
                  const autoWidgetZone = isAutoWidgetZone(zone);
                  const isTickerZone = /ticker/i.test(`${zone.id} ${zone.name}`);
                  const logoZone = isLogoZone(zone);
                  const placement = customPlacementEnabled ? (zonePlacements?.[zone.id] || "auto") : "auto";
                  const zoneRect = getZoneRect(zone, canvasWidth, canvasHeight, placement);

                  let left = zoneRect.left;
                  let top = zoneRect.top;
                  let width = zoneRect.width;
                  let height = zoneRect.height;

                  if (!customPlacementEnabled && orientation !== "portrait" && queueZone) {
                    const rightEdge = Math.min(100, left + width);
                    const targetWidth = Math.min(36, Math.max(28, width));
                    const targetHeight = Math.min(78, Math.max(44, height));
                    width = Math.min(targetWidth, rightEdge);
                    height = Math.min(targetHeight, 99 - top);
                    left = queueSidebarLeft != null
                      ? queueSidebarLeft
                      : Math.max(0, Math.min(99 - width, rightEdge - width));
                    top = Math.max(1, Math.min(top, 99 - height));
                  }

                  if (!customPlacementEnabled && orientation !== "portrait" && queueSidebarLeft != null && !queueZone && !isTickerZone) {
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
                      ref={(el) => { if (el) zoneRefs.current[zone.id] = el; else delete zoneRefs.current[zone.id]; }}
                      className={`absolute overflow-hidden ${queueZone ? "bg-transparent" : "bg-black"}`}
                      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`, zIndex: zoneZIndex }}
                    >
                      {/* per-zone overlay removed here; using top-level viewport overlay for inspect_zones */}
                      {queueZone && items.length === 0 ? (
                        <QueueBoard deviceName={payload.device_name} queuePreview={queuePreview} notices={notices} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                        ) : autoWidgetZone && items.length === 0 ? (
                          <AutoWidgetZone zone={zone} queuePreview={queuePreview} payload={payload} providerData={providerData} weatherData={weatherData} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                      ) : isTickerZone ? (
                        <TickerSlot items={items} label={zone.name} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                      ) : logoZone && items.length === 0 && clientLogoUrl ? (
                        <div className="w-full h-full flex items-center justify-center bg-black p-4">
                          <div className="w-full h-full rounded-[1.5rem] border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                            <img src={clientLogoUrl} alt={`${payload.device_name || "client"} logo`} className="max-h-[75%] max-w-[75%] object-contain" />
                          </div>
                        </div>
                      ) : (
                        <MediaSlot
                          items={items}
                          label={zone.name}
                          queuePreview={queuePreview}
                          weatherData={weatherData}
                          zone={zone}
                          canvasWidth={canvasWidth}
                          canvasHeight={canvasHeight}
                          mediaMode={zoneMediaModes?.[zone.id] || (/^(header|weather)$/i.test(zone?.role || "") ? "fill" : "fit")}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {inspectZones && Object.keys(zoneInspections || {}).length > 0 ? (
                <div className="absolute inset-0 pointer-events-none z-50">
                  {zoneEntries.map(({ zone }) => {
                    const info = zoneInspections?.[zone.id];
                    if (!info) return null;
                    return (
                      <div
                        key={`inspect-${zone.id}`}
                        className="absolute pointer-events-none text-xs text-white/90 bg-black/60 px-2 py-1 rounded"
                        style={{ left: `${info.left}px`, top: `${info.top}px`, transform: "translate(-4px,-4px)" }}
                      >
                        <div className="font-semibold">{zone.id}{zone.name ? ` · ${String(zone.name).slice(0,12)}` : ""}</div>
                        <div className="text-[11px]">cfg: {Math.round(Number(zone.width_px||0))}x{Math.round(Number(zone.height_px||0))}</div>
                        <div className="text-[11px]">act: {info.width}x{info.height}px</div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              </>
            ) : (
              <div className="grid gap-0 w-full h-full min-h-0" style={gridStyle}>
                {zoneEntries.map(({ zone, items }) => (
                  <div key={zone.id} className="bg-black overflow-hidden relative min-h-[160px]">
                    {isQueueZone(zone) && items.length === 0 ? (
                      <QueueBoard deviceName={payload.device_name} queuePreview={queuePreview} notices={notices} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                    ) : isAutoWidgetZone(zone) && items.length === 0 ? (
                      <AutoWidgetZone zone={zone} queuePreview={queuePreview} payload={payload} providerData={providerData} weatherData={weatherData} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                    ) : /ticker/i.test(`${zone.id} ${zone.name}`) ? (
                      <TickerSlot items={items} label={zone.name} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} />
                    ) : isLogoZone(zone) && items.length === 0 && clientLogoUrl ? (
                      <div className="w-full h-full flex items-center justify-center bg-black p-4">
                        <div className="w-full h-full rounded-[1.5rem] border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                          <img src={clientLogoUrl} alt={`${payload.device_name || "client"} logo`} className="max-h-[75%] max-w-[75%] object-contain" />
                        </div>
                      </div>
                    ) : (
                      <MediaSlot
                        items={items}
                        label={zone.name}
                        queuePreview={queuePreview}
                        weatherData={weatherData}
                        zone={zone}
                        canvasWidth={canvasWidth}
                        canvasHeight={canvasHeight}
                        mediaMode={zoneMediaModes?.[zone.id] || (/^(header|weather)$/i.test(zone?.role || "") ? "fill" : "fit")}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 z-50 pointer-events-none">
        <div className="pointer-events-auto relative">
          <button
            type="button"
            onClick={toggleMenu}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[0_14px_40px_-24px_rgba(0,0,0,0.8)] backdrop-blur-md"
            aria-expanded={menuOpen}
            aria-label="Open player menu"
          >
            <Menu className="h-4 w-4" />
            Menu
          </button>

          {menuOpen ? (
            <div className="absolute right-0 mt-3 w-[min(92vw,360px)] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] text-white shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.35em] text-white/45">Player menu</div>
                  <div className="text-sm font-semibold text-white">Controls and zones</div>
                </div>
                <button type="button" onClick={() => setMenuOpen(false)} className="rounded-full border border-white/10 p-2 text-white/70 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-white/10 p-4">
                <div className="text-[10px] uppercase tracking-[0.35em] text-white/45 mb-3">Controls</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={goFullscreen}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10"
                  >
                    <Maximize className="h-4 w-4" /> Fullscreen
                  </button>
                  <button
                    type="button"
                    onClick={poll}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10"
                  >
                    <RefreshCw className="h-4 w-4" /> Reload
                  </button>
                  <button
                    type="button"
                    onClick={resetZoneVisibility}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10 col-span-2"
                  >
                    <RotateCcw className="h-4 w-4" /> Restore all zones
                  </button>
                </div>

                <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-medium text-white">Fill blank space</span>
                    <span className="block text-[11px] text-white/45">Compact the layout when zones are removed</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFillBlankSpaces((current) => !current)}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${fillBlankSpaces ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/55"}`}
                  >
                    {fillBlankSpaces ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {fillBlankSpaces ? "On" : "Off"}
                  </button>
                </label>

                <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-medium text-white">Custom placement</span>
                    <span className="block text-[11px] text-white/45">Choose a preset area for each zone</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setCustomPlacementEnabled((current) => !current)}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${customPlacementEnabled ? "bg-cyan-500/20 text-cyan-200" : "bg-white/10 text-white/55"}`}
                  >
                    {customPlacementEnabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {customPlacementEnabled ? "On" : "Off"}
                  </button>
                </label>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.35em] text-white/45">Zone settings</div>
                    <div className="text-sm font-semibold text-white">Hide, restore, or place zones</div>
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">{visibleZoneDefs.length}/{zoneDefs.length}</div>
                </div>

                <div className="max-h-[48vh] space-y-2 overflow-auto pr-1">
                  {zoneDefs.map((zone) => {
                    const hidden = hiddenZoneIds.includes(zone.id);
                    const placement = zonePlacements?.[zone.id] || "auto";
                    const mediaMode = zoneMediaModes?.[zone.id] || "fill";
                    return (
                      <div key={zone.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{zone.name || zone.id}</div>
                            <div className="truncate text-[11px] uppercase tracking-[0.25em] text-white/40">{zone.role || "zone"} · {Math.round(Number(zone.width_px || 0))}x{Math.round(Number(zone.height_px || 0))}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleZoneVisibility(zone.id)}
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${hidden ? "bg-white/10 text-white/70" : "bg-rose-500/15 text-rose-200"}`}
                          >
                            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            {hidden ? "Show" : "Hide"}
                          </button>
                        </div>

                        {customPlacementEnabled ? (
                          <div className="mt-3">
                            <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/40">Placement</div>
                            <div className="grid grid-cols-3 gap-2">
                              {ZONE_PLACEMENT_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => setZonePlacement(zone.id, preset.id)}
                                  className={`rounded-xl border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${placement === preset.id ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => setZonePlacement(zone.id, "auto")}
                              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65 hover:bg-white/10"
                            >
                              Reset to auto
                            </button>
                          </div>
                        ) : null}

                        <div className="mt-3">
                          <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/40">Media fit</div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setZoneMediaMode(zone.id, "fill")}
                              className={`rounded-xl border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${mediaMode === "fill" ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
                            >
                              Fill
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoneMediaMode(zone.id, "fit")}
                              className={`rounded-xl border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${mediaMode === "fit" ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
                            >
                              Fit
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { animation: marquee 28s linear infinite; }
      `}</style>
    </div>
  );
}

