import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Monitor, CircleSlash, Maximize, Menu, X, Eye, EyeOff, RotateCcw, RefreshCw, Play, Smartphone, Tv, Wifi, CheckCircle, AlertCircle, ArrowRight } from "lucide-react";
import { API_BASE } from "../../lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

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
  if (item?.fit === "stretch" || item?.fit === "fill") return "object-fill";
  if (mediaMode === "fit") return "object-contain";
  if (mediaMode === "stretch") return "object-fill";
  return "object-cover";
}

function normalizeRotation(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const normalized = ((Math.round(num / 90) * 90) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
}

function isImageItem(item) {
  return item?.kind === "image" || (item?.content_type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(item?.url || item?.name || "");
}

function getDefaultZoneMediaMode(zone) {
  return /^(header|weather)$/i.test(zone?.role || "") ? "fill" : "fit";
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

function getYoutubeId(url) {
  if (!url) return "";
  try {
    const s = String(url);
    // common patterns: v=VIDEO, youtu.be/VIDEO, /embed/VIDEO
    const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|watch\?v=)([A-Za-z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    // fallback: last 11-char token
    const parts = s.split(/[\/?#&=\s]+/).filter(Boolean);
    for (let p of parts.reverse()) {
      if (/^[A-Za-z0-9_-]{11}$/.test(p)) return p;
    }
    return "";
  } catch (e) {
    return "";
  }
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

function buildQueueAnnouncement(entry) {
  if (!entry) return null;
  const token = String(entry.token || entry.token_no || entry.number || entry.queue_number || "").trim();
  if (!token) return null;

  const status = String(entry.status || "").toLowerCase();
  if (status !== "called") return null;

  const recallCount = Number(entry.recall_count || 0);
  const isRecall = recallCount > 0 || Boolean(entry.recalled_at);
  const key = `${token}:${status}:${recallCount}:${entry.recalled_at || ""}`;
  const text = isRecall
    ? `Recall for token ${token}. Please return to the counter.`
    : `Token ${token}, please proceed to the counter.`;

  return { key, text };
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

function MediaSlot({ items, label, queuePreview, weatherData, zone, canvasWidth, canvasHeight, mediaMode, viewportScale = 1, isMuted, isMutedRef }) {
  const [idx, setIdx] = useState(0);
  const [showFrame, setShowFrame] = useState(true);
  const timerRef = useRef(null);
  const youtubeRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const currentYoutubeIdRef = useRef(null);
  const videoElemRef = useRef(null);
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, /^(header|weather)$/i.test(zone?.role || ""), viewportScale);
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

  // Keep HTML5 video and YouTube player in sync with mute state
  useEffect(() => {
    try {
      if (videoElemRef.current) {
        videoElemRef.current.muted = Boolean(isMuted);
      }
    } catch (e) {}

    try {
      if (youtubePlayerRef.current) {
        if (isMuted) {
          try { youtubePlayerRef.current.mute(); } catch {}
        } else {
          try { youtubePlayerRef.current.unMute ? youtubePlayerRef.current.unMute() : youtubePlayerRef.current.unmute && youtubePlayerRef.current.unmute(); } catch {}
        }
      }
    } catch (e) {}
  }, [isMuted]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const cur = items[idx];
    if (!cur) return;

    const curType = String(cur.type || cur.kind || "").toLowerCase();
    const youtubeId = getYoutubeId(cur?.url);
    const isYoutube = Boolean(youtubeId) || curType === "youtube";
    const isHtml5Video = ((cur.type === "media" || cur.media_id) && !isImageItem(cur)) || curType === "video";

    // If this item is a video (HTML5 or YouTube) let the media's ended event drive progression
    if (isHtml5Video || isYoutube) return;

    timerRef.current = setTimeout(() => setIdx((i) => (i + 1) % items.length), (cur.duration || 10) * 1000);
    return () => clearTimeout(timerRef.current);
  }, [idx, items, handleMediaEnd]);

  useEffect(() => {
    const cur = items?.[idx];
    const youtubeId = getYoutubeId(cur?.url);
    const curType = String(cur?.type || cur?.kind || "").toLowerCase();
    const isYoutube = Boolean(youtubeId) || curType === "youtube";

    // If there's no YouTube item active, destroy any existing player and exit
    if (!cur || !isYoutube) {
      if (youtubePlayerRef.current) {
        try { youtubePlayerRef.current.destroy(); } catch {};
        youtubePlayerRef.current = null;
        currentYoutubeIdRef.current = null;
      }
      return;
    }

    let cancelled = false;
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !YT?.Player || !youtubeRef.current) return;
      const videoId = youtubeId;
      if (!videoId) {
        handleMediaEnd();
        return;
      }

      // If same video already loaded, ensure it's playing and do nothing else
      if (youtubePlayerRef.current && currentYoutubeIdRef.current === videoId) {
        try { youtubePlayerRef.current.playVideo && youtubePlayerRef.current.playVideo(); } catch {}
        return;
      }

      // Different video: destroy existing and create new
      if (youtubePlayerRef.current) {
        try { youtubePlayerRef.current.destroy(); } catch {};
        youtubePlayerRef.current = null;
        currentYoutubeIdRef.current = null;
      }

      youtubePlayerRef.current = new YT.Player(youtubeRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          fs: 1,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: (event) => {
            try {
              if (isMutedRef.current) event.target.mute(); else event.target.unMute();
            } catch (e) {}
            try { event.target.playVideo(); } catch (e) {}
            currentYoutubeIdRef.current = videoId;
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
    };
  }, [idx, items, handleMediaEnd]);

  // Destroy YouTube player on component unmount
  useEffect(() => {
    return () => {
      if (youtubePlayerRef.current) {
        try { youtubePlayerRef.current.destroy(); } catch {};
        youtubePlayerRef.current = null;
        currentYoutubeIdRef.current = null;
      }
    };
  }, []);

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
    const zoneScaleBoosted = Math.max(0.95, getZoneScale(zone, canvasWidth, canvasHeight, true, viewportScale));
    return (
      <ResponsiveZoneShell scale={zoneScaleBoosted}>
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
      </ResponsiveZoneShell>
    );
  }

  if (itemType === "weather") {
    const weather = weatherData || {};
    const condition = getWeatherConditionLabel(weather, cur.condition || cur.summary || "");
    const locationLabel = weather.location || "Current conditions";
    const emoji = getWeatherEmoji(weather, condition);
    const zoneScaleBoosted = Math.max(0.95, getZoneScale(zone, canvasWidth, canvasHeight, true, viewportScale));
    return (
      <ResponsiveZoneShell scale={zoneScaleBoosted}>
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
      </ResponsiveZoneShell>
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
      status: item.status || "pending",
    }));
    const queueScale = Math.min(2.2, Math.max(1.05, zoneScale * 1.45));
    return (
      <ResponsiveZoneShell scale={queueScale}>
        <div className="w-full h-full bg-white p-5 text-[#111827] flex flex-col overflow-hidden">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.45em] text-[#6B7280]">Queue</div>
              <div className="mt-2 font-display text-3xl font-black tracking-tight">{cur.title || "Today's bookings"}</div>
            </div>
            <div className="text-right text-xs text-[#6B7280] uppercase tracking-[0.25em]">Live board</div>
          </div>
          <div className="flex-1 overflow-hidden rounded-[1.5rem] border border-[#E5E7EB] bg-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.3)]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Token</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Name</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Service</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Time</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No bookings yet.</TableCell>
                  </TableRow>
                ) : entries.map((entry, index) => (
                  <TableRow key={`${entry.token || entry.name}-${index}`}>
                    <TableCell>
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-sm bg-[#111827] text-white font-mono font-bold">
                        {entry.token || index + 1}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-[#0F172A] truncate">{entry.name}</div>
                    </TableCell>
                    <TableCell className="text-xs text-[#6B7280] truncate">{entry.service || "Appointment"}</TableCell>
                    <TableCell className="font-mono text-xs text-[#0F172A]">{entry.time}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] uppercase tracking-wider font-semibold ${String(entry.status).toLowerCase() === "called" ? "bg-emerald-50 text-emerald-700" : String(entry.status).toLowerCase() === "completed" ? "bg-slate-50 text-slate-600" : "bg-[#F9FAFB] text-[#64748B]"}`}>
                        {entry.status === "called" ? "Currently serving" : entry.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </ResponsiveZoneShell>
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

  const youtubeId = getYoutubeId(cur?.url);
  const isYoutubeSource = Boolean(youtubeId) || String(cur.type || cur.kind || "").toLowerCase() === "youtube";

  const content = 
    (cur.type === "text" || cur.kind === "text") ? (
      <div className="w-full h-full flex items-center justify-center bg-black p-6 text-center overflow-hidden">
        <div className="max-w-[90%] text-white font-display text-2xl font-bold leading-tight">{cur.content || cur.text}</div>
      </div>
    ) : isYoutubeSource ? (
      <div className="w-full h-full flex items-center justify-center bg-black overflow-hidden">
        <div ref={youtubeRef} className="w-full h-full" />
      </div>
    ) : (cur.type === "media" || cur.media_id) ? (
      isImageItem(cur) ? (
        <img src={resolveSrc(cur)} alt={cur.name} className={`w-full h-full ${getMediaFit(cur, mediaMode)} object-center bg-black`} onError={(e) => { console.error('Media load error', resolveSrc(cur), e); handleMediaEnd(); }} />
      ) : (
        <video
          ref={videoElemRef}
          src={resolveSrc(cur)}
          autoPlay
          muted={isMuted}
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
        ref={videoElemRef}
        src={resolveSrc(cur)}
        autoPlay
        muted={isMuted}
        playsInline
        controls
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

function TickerSlot({ items, label, zone, canvasWidth, canvasHeight, viewportScale = 1 }) {
  const [feedEntries, setFeedEntries] = useState([]);
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, false, viewportScale);

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

function QueueBoard({ deviceName, queuePreview, notices, zone, canvasWidth, canvasHeight, viewportScale = 1 }) {
  const currentToken = queuePreview?.[0] || null;
  const nextTokens = queuePreview?.slice(1, 3) || [];

  if (!currentToken) return null;

  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, false, viewportScale);
  const zoneScaleBoosted = Math.min(1.8, zoneScale * 1.6);

  return (
    <ResponsiveZoneShell scale={zoneScaleBoosted}>
      <div 
        className="w-full h-full flex flex-col text-white"
        style={{
          background: 'linear-gradient(135deg, #ec4899, #fb7185, #f97316)',
        }}
      >
        {/* Top Status Bar - Bold */}
        <div className="bg-white/15 py-4 text-center border-b-2 border-white/30">
          <div 
            className="text-white font-black uppercase tracking-[0.3em]"
            style={{ fontSize: 'clamp(13px, 2vw, 18px)', letterSpacing: '0.3em' }}
          >
            🔴 LIVE QUEUE STATUS
          </div>
        </div>

        {/* Main Content - Current Token */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          {/* Currently Serving Label - Bold */}
          <div 
            className="text-white/90 font-bold uppercase tracking-[0.25em] mb-4 text-center"
            style={{ fontSize: 'clamp(13px, 1.8vw, 16px)', letterSpacing: '0.25em' }}
          >
            ⚡ CURRENTLY SERVING
          </div>
          
          {/* Current Token Number - Extra Large & Bold */}
          <div 
            className="font-black text-center leading-none tracking-tighter"
            style={{ 
              fontSize: 'clamp(100px, 22vw, 220px)',
              textShadow: '4px 4px 0 rgba(0,0,0,0.2)',
              fontWeight: 900
            }}
          >
            {currentToken.token || "—"}
          </div>
          
          {/* Current Token Name - Bold */}
          <div 
            className="font-extrabold text-center mt-6 px-4"
            style={{ fontSize: 'clamp(22px, 4vw, 38px)' }}
          >
            {currentToken.patient_name || currentToken.service_name || "GUEST"}
          </div>
          
          {/* Current Token Service - Bold */}
          <div 
            className="text-white/80 font-semibold text-center mt-3 uppercase tracking-wide"
            style={{ fontSize: 'clamp(13px, 2vw, 16px)' }}
          >
            {currentToken.service_type || currentToken.service_name || "→ PLEASE PROCEED TO COUNTER ←"}
          </div>
        </div>

        {/* Next Tokens Section */}
        {nextTokens.length > 0 && (
          <div className="border-t-2 border-white/30 bg-black/30">
            <div className="max-w-7xl mx-auto px-6 py-5">
              {/* Next Up Label - Bold */}
              <div 
                className="text-white/70 font-bold uppercase tracking-[0.25em] mb-5 text-center"
                style={{ fontSize: 'clamp(11px, 1.5vw, 14px)', letterSpacing: '0.25em' }}
              >
                ⏩ NEXT IN QUEUE
              </div>
              
              {/* Next Tokens Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {nextTokens.map((token, index) => (
                  <div 
                    key={token.token || index}
                    className="bg-white/15 border-2 border-white/30 p-4"
                    style={{ backdropFilter: 'blur(10px)' }}
                  >
                    <div className="flex items-center gap-4">
                      {/* Token Number - Bold */}
                      <div 
                        className="font-black text-white"
                        style={{ fontSize: 'clamp(28px, 5vw, 44px)' }}
                      >
                        {token.token || "—"}
                      </div>
                      {/* Divider */}
                      <div className="w-px h-10 bg-white/40" />
                      {/* Token Info */}
                      <div className="flex-1 min-w-0">
                        <div 
                          className="font-bold truncate"
                          style={{ fontSize: 'clamp(16px, 2.5vw, 18px)' }}
                        >
                          {token.patient_name || token.service_name || "GUEST"}
                        </div>
                        <div 
                          className="text-white/60 font-medium truncate text-xs uppercase tracking-wide mt-1"
                          style={{ fontSize: 'clamp(11px, 1.5vw, 12px)' }}
                        >
                          {token.service_type || token.service_name || "QUEUE"}
                        </div>
                      </div>
                      {/* Estimated Wait */}
                      {token.wait_after_mins && (
                        <div className="text-right">
                          <div className="text-white font-black text-lg">
                            {token.wait_after_mins}m
                          </div>
                          <div className="text-white/50 text-[10px] font-bold uppercase">wait</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        
        {/* Notice Banner - Bold */}
        {notices && notices.length > 0 && notices[0] && (
          <div className="bg-black/40 border-t-2 border-white/30 py-4 px-6 text-center">
            <div 
              className="text-white/90 font-bold"
              style={{ fontSize: 'clamp(13px, 2vw, 16px)' }}
            >
              📢 {notices[0].title || notices[0].body || "QUEUE UPDATES AVAILABLE"}
            </div>
          </div>
        )}
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

function AutoWidgetZone({ zone, queuePreview, payload, providerData, weatherData, canvasWidth, canvasHeight, viewportScale = 1 }) {
  const role = String(zone?.role || "").toLowerCase();
  const zoneScale = getZoneScale(zone, canvasWidth, canvasHeight, /^(header|weather)$/i.test(zone?.role || ""), viewportScale);

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
    const rawEntries = Array.isArray(providerData?.today_bookings_preview) && providerData.today_bookings_preview.length > 0
      ? providerData.today_bookings_preview
      : (Array.isArray(providerData?.queue_preview) && providerData.queue_preview.length > 0
        ? providerData.queue_preview
        : (Array.isArray(queuePreview) ? queuePreview : []));
    const entries = rawEntries.map((item) => ({
      token: item.token,
      name: item.patient_name || item.service_name || "Booking",
      phone: item.patient_phone || item.phone || "—",
      time: item.assigned_time || item.preferred_time || `${item.wait_after_mins || 0} min`,
      service: item.service_type || item.service_name || "Appointment",
      location: item.routed_location || item.booking_location || "Default location",
      status: item.status || "pending",
      waitAfterMins: Number(item.wait_after_mins || 0),
    }));

    return (
      <ResponsiveZoneShell scale={zoneScale}>
        <div className="w-full h-full bg-white p-5 text-[#111827] flex flex-col">
          <div className="h-full flex flex-col rounded-[2rem] border border-[#E5E7EB] bg-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.3)] overflow-hidden">
            <div className="flex items-end justify-between gap-3 px-5 py-4 border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <div>
                <div className="text-[10px] uppercase tracking-[0.4em] text-[#94A3B8]">Bookings</div>
                <div className="mt-1 font-display text-[clamp(1.6rem,3vw,2.4rem)] font-black tracking-tight text-[#0F172A]">Today’s bookings</div>
              </div>
              <div className="text-[10px] uppercase tracking-[0.35em] text-[#94A3B8]">Live board</div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-[#F9FAFB] hover:bg-[#F9FAFB]">
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Token</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Name</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Phone</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Time</TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wider text-[#6B7280]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-sm text-[#6B7280]">No bookings yet.</TableCell>
                  </TableRow>
                ) : entries.slice(0, 8).map((entry, index) => (
                  <TableRow key={`${entry.token || entry.name}-${index}`}>
                    <TableCell>
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-sm bg-[#111827] text-white font-mono font-bold">
                        {entry.token || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold truncate text-[#0F172A]">{entry.name}</div>
                      <div className="text-xs text-[#6B7280] truncate">{entry.service || "Appointment"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#0F172A]">{entry.phone || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-[#0F172A]">{entry.time}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] uppercase tracking-wider font-semibold ${String(entry.status).toLowerCase() === "called" ? "bg-emerald-50 text-emerald-700" : String(entry.status).toLowerCase() === "completed" ? "bg-slate-50 text-slate-600" : "bg-[#F9FAFB] text-[#64748B]"}`}>
                        {entry.status === "called" ? "Currently serving" : entry.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

function getZoneScale(zone, canvasWidth, canvasHeight, preferCover = false, viewportScale = 1) {
  const zoneWidth = Number(zone?.width_px ?? canvasWidth) || canvasWidth || 1920;
  const zoneHeight = Number(zone?.height_px ?? canvasHeight) || canvasHeight || 1080;
  const baseWidth = Number(canvasWidth) || 1920;
  const baseHeight = Number(canvasHeight) || 1080;
  const widthScale = zoneWidth / baseWidth;
  const heightScale = zoneHeight / baseHeight;
  const rawScale = preferCover
    ? Math.max(widthScale, heightScale) * 0.98
    : Math.min(widthScale, heightScale) * 0.94;
  const withViewport = (Number.isFinite(rawScale) ? rawScale : 1) * (Number.isFinite(viewportScale) ? viewportScale : 1);
  return Math.max(0.35, Math.min(2.5, withViewport));
}

function ResponsiveZoneShell({ scale = 1, className = "", children }) {
  const safeScale = Math.max(0.35, Math.min(2.5, Number(scale) || 1));
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

// Splash Screen Component
function ModernSplashScreen({ onComplete }) {
  const [progress, setProgress] = useState(0);
  const [dots, setDots] = useState("");
  
  useEffect(() => {
    // Animated dots for loading text
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? "" : prev + ".");
    }, 500);
    
    // Simulate loading progress
    const timer = setTimeout(() => {
      onComplete();
    }, 2500);
    
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 2, 100));
    }, 50);
    
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
      clearInterval(progressInterval);
    };
  }, [onComplete]);
  
  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-purple-900 via-pink-800 to-orange-700 flex items-center justify-center overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-white/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-white/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/5 rounded-full blur-3xl animate-ping" />
      </div>
      
      {/* Main content */}
      <div className="relative z-10 text-center">
        {/* Logo animation */}
        <div className="mb-8 animate-bounce">
          <div className="text-8xl md:text-9xl font-black text-white tracking-tighter animate-pulse">
            RP
          </div>
          <div className="text-sm text-white/70 uppercase tracking-[0.5em] mt-2">
            SIGNAGE
          </div>
        </div>
        
        {/* Loading bar */}
        <div className="w-64 md:w-96 h-1 bg-white/20 rounded-full overflow-hidden mb-4">
          <div 
            className="h-full bg-white rounded-full transition-all duration-100 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        {/* Loading text */}
        <div className="text-white/60 text-xs uppercase tracking-wider">
          Loading{dots}
        </div>
        
        {/* Feature tags */}
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <Smartphone className="w-3 h-3 text-white/60" />
            <span className="text-[10px] text-white/60 uppercase">Multi-Device</span>
          </div>
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <Tv className="w-3 h-3 text-white/60" />
            <span className="text-[10px] text-white/60 uppercase">4K Ready</span>
          </div>
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <Wifi className="w-3 h-3 text-white/60" />
            <span className="text-[10px] text-white/60 uppercase">Cloud Sync</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Pairing Screen Component
function PairingScreen({ onPair, error: externalError, initialCode = "" }) {
  const [pairCode, setPairCode] = useState(initialCode || "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pairCode.trim()) {
      setError("Please enter a pairing code");
      return;
    }
    
    setIsLoading(true);
    setIsConnecting(true);
    setError("");
    
    // Simulate connection check
    setTimeout(() => {
      setIsLoading(false);
      onPair(pairCode.trim().toUpperCase());
    }, 1500);
  };

  useEffect(() => {
    if (initialCode && initialCode !== pairCode) setPairCode(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);
  
  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-20" />
      </div>
      
      {/* Floating orbs */}
      <div className="absolute top-20 left-10 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-20 right-10 w-64 h-64 bg-pink-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
      
      {/* Card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 shadow-2xl p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="text-5xl font-black text-white mb-2">RP</div>
            <div className="text-xs text-white/50 uppercase tracking-[0.3em]">Signage Player</div>
            <div className="h-px w-12 bg-gradient-to-r from-transparent via-white/30 to-transparent mx-auto mt-4" />
          </div>
          
          {/* Title */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">Pair Your Device</h2>
            <p className="text-white/50 text-sm">
              Enter the pairing code from your client dashboard to start displaying content
            </p>
          </div>
          
          {/* Form or generated-code display */}
          {initialCode ? (
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-6xl font-mono tracking-widest text-white font-bold">{String(initialCode).slice(0,6)}</div>
                <p className="text-white/40 mt-3">Show this code in the client portal to pair the device.</p>
                <div className="mt-6">
                  <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2">
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="text-white/50 text-sm">Waiting for client confirmation</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-white/70 text-sm font-medium mb-2">
                  Pairing Code
                </label>
                <input
                  type="text"
                  value={pairCode}
                  onChange={(e) => {
                    setPairCode(e.target.value.toUpperCase());
                    setError("");
                  }}
                  placeholder="e.g., 123456"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-center text-2xl font-mono tracking-wider focus:outline-none focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 transition-all"
                  autoFocus
                  maxLength={10}
                />
                <p className="text-white/30 text-xs mt-2 text-center">Find this code in your client portal under "Devices"</p>
              </div>

              {(error || externalError) && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <p className="text-red-400 text-sm">{error || externalError}</p>
                </div>
              )}

              {isConnecting && (
                <div className="bg-cyan-500/20 border border-cyan-500/30 rounded-xl p-3 flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-cyan-400 text-sm">Connecting to server...</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
                  isLoading ? "opacity-70 cursor-not-allowed" : ""
                }`}>
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    Connect Now
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
          
          {/* Help text */}
          <div className="mt-6 text-center">
            <p className="text-white/30 text-xs">
              Need help? Contact your system administrator
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-white/20 text-[10px] uppercase tracking-wider">
            Secure connection • End-to-end encrypted
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignagePlayer() {
  const { pairCode: urlPairCode } = useParams();
  const navigate = useNavigate();
  const [showSplash, setShowSplash] = useState(true);
  const [showPairing, setShowPairing] = useState(!urlPairCode);
  const [currentPairCode, setCurrentPairCode] = useState(urlPairCode || null);
  const [pairingError, setPairingError] = useState("");
  const [generatedPairCode, setGeneratedPairCode] = useState(null);
  const [isRequestingPair, setIsRequestingPair] = useState(false);

  const getOrCreateFingerprint = () => {
    try {
      const key = 'device_fingerprint';
      let fp = window.localStorage.getItem(key);
      if (fp && String(fp).trim()) return fp;
      fp = `web-${Date.now()}-${Math.floor(Math.random()*0x7fffffff)}`;
      window.localStorage.setItem(key, fp);
      return fp;
    } catch (e) {
      return `web-${Date.now()}-${Math.floor(Math.random()*0x7fffffff)}`;
    }
  };

  const requestPairCodeAndWait = async () => {
    if (!showPairing) return;
    setIsRequestingPair(true);
    try {
      const fp = getOrCreateFingerprint();
      const resp = await axios.post(`${BASE}/api/public/pair/request`, { device_fingerprint: fp, device_name: 'Web Signage Player' });
      const code = resp?.data?.pair_code;
      if (!code) throw new Error('No pair code from server');
      setGeneratedPairCode(code);
      // poll status
      while (showPairing && !currentPairCode) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const st = await axios.get(`${BASE}/api/public/pair/status/${code}`);
          if (st?.data?.used) {
            // bound by client
            setIsRequestingPair(false);
            setGeneratedPairCode(null);
            setCurrentPairCode(code);
            setShowPairing(false);
            navigate(`/play/${code}`, { replace: true });
            return;
          }
        } catch (e) {
          // ignore transient
        }
      }
    } catch (e) {
      setPairingError(e.response?.data?.detail || e.message || 'Pair request failed');
      setIsRequestingPair(false);
      setGeneratedPairCode(null);
      setShowPairing(true);
    }
  };
  
  const [payload, setPayload] = useState(null);
  const [providerData, setProviderData] = useState(null);
  const [liveWeather, setLiveWeather] = useState(null);
  const [weatherState, setWeatherState] = useState("idle");
  const [err, setErr] = useState("");
  const lastGreetSpokenRef = useRef(0);
  const wrapRef = useRef(null);
  // Container refs for absolute layout measurements
  const absoluteContainerRef = useRef(null);
  const zoneRefs = useRef({});
  const [zoneInspections, setZoneInspections] = useState({});
  const recogRef = useRef(null);
  const [overlay, setOverlay] = useState(null);
  const overlayTimer = useRef(null);
  const overlayKeyRef = useRef("");
  const genericProductCursorRef = useRef(0);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const voiceGreetingPlayedRef = useRef(false);
  const queueSocketRef = useRef(null);
  const queueSocketAttemptRef = useRef(0);
  const queueSocketRetryRef = useRef(null);
  const queueAnnouncementReadyRef = useRef(false);
  const lastQueueAnnouncementKeyRef = useRef("");
  const offlineBeaconSentRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [orientationOverride, setOrientationOverride] = useState("auto");
  const [hiddenZoneIds, setHiddenZoneIds] = useState([]);
  const [fillBlankSpaces, setFillBlankSpaces] = useState(true);
  const [customPlacementEnabled, setCustomPlacementEnabled] = useState(false);
  const [zonePlacements, setZonePlacements] = useState({});
  const [zoneMediaModes, setZoneMediaModes] = useState({});
  const [viewportSize, setViewportSize] = useState(() => {
    if (typeof window === "undefined") return { width: 1920, height: 1080 };
    return { width: Math.max(1, window.innerWidth || 1920), height: Math.max(1, window.innerHeight || 1080) };
  });

  // Feature flag: set to false to completely disable voice features
  const ENABLE_VOICE = false;

  const isMutedRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const zonePrefsKey = useMemo(() => `signage-player-zone-prefs:${currentPairCode || "default"}`, [currentPairCode]);
  const orientationPrefsKey = useMemo(() => `signage-player-orientation:${currentPairCode || "default"}`, [currentPairCode]);

  const queuePreview = useMemo(() => {
    return Array.isArray(providerData?.queue_preview)
      ? providerData.queue_preview
      : (Array.isArray(payload?.queue_preview) ? payload.queue_preview : []);
  }, [providerData?.queue_preview, payload?.queue_preview]);

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
  const setPlayerOrientation = useCallback((mode) => {
    setOrientationOverride(["auto", "landscape", "portrait"].includes(mode) ? mode : "auto");
  }, []);

  const sendOfflineBeacon = useCallback(() => {
    if (!currentPairCode || offlineBeaconSentRef.current) return;
    offlineBeaconSentRef.current = true;

    try {
      const fingerprint = getOrCreateFingerprint();
      const target = `${BASE}/api/public/player/${encodeURIComponent(currentPairCode)}/offline?device_fingerprint=${encodeURIComponent(fingerprint)}`;

      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(target, new Blob([""], { type: "text/plain" }));
        return;
      }

      fetch(target, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_fingerprint: fingerprint }),
      }).catch(() => {});
    } catch {
      // ignore offline beacon failures
    }
  }, [currentPairCode]);

  const queueSocketUrl = useCallback(() => {
    const baseUrl = new URL(`${BASE}/api/ws/queue/${encodeURIComponent(currentPairCode)}`);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    return baseUrl.toString();
  }, [currentPairCode]);

  // Handle pairing
  const handlePair = (code) => {
    setCurrentPairCode(code);
    setShowPairing(false);
    // Update URL without reload
    // Navigate to the player route so the app URL matches the player entry
    navigate(`/play/${code}`, { replace: true });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateViewport = () => {
      setViewportSize({ width: Math.max(1, window.innerWidth || 1), height: Math.max(1, window.innerHeight || 1) });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    offlineBeaconSentRef.current = false;
    queueAnnouncementReadyRef.current = false;
    lastQueueAnnouncementKeyRef.current = "";
  }, [currentPairCode]);

  useEffect(() => {
    if (showPairing && !currentPairCode) requestPairCodeAndWait();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPairing, currentPairCode]);

  const poll = useCallback(async () => {
    if (!currentPairCode) return;
    try {
      const fp = getOrCreateFingerprint();
      const { data } = await axios.get(`${BASE}/api/public/player/${currentPairCode}`, { headers: { 'X-Device-Fingerprint': fp } });
      setPayload(data);
      try { console.debug("player-payload", data); } catch (e) {}
      setErr("");
      setPairingError("");
    } catch (e) {
      if (e.response?.status === 404) {
        setPairingError("Invalid pairing code. Please check and try again.");
        setShowPairing(true);
        setCurrentPairCode(null);
      } else {
        setErr(e.response?.data?.detail || "Could not load");
      }
    }
  }, [currentPairCode]);

  useEffect(() => {
    if (currentPairCode && !showPairing && !showSplash) {
      poll();
      const connectSocket = () => {
        if (!currentPairCode || showPairing || showSplash || typeof window === "undefined" || typeof WebSocket === "undefined") return;

        const clearRetryTimer = () => {
          if (queueSocketRetryRef.current) {
            window.clearTimeout(queueSocketRetryRef.current);
            queueSocketRetryRef.current = null;
          }
        };

        const closeSocket = () => {
          if (queueSocketRef.current) {
            try {
              queueSocketRef.current.onopen = null;
              queueSocketRef.current.onmessage = null;
              queueSocketRef.current.onerror = null;
              queueSocketRef.current.onclose = null;
              queueSocketRef.current.close();
            } catch {
              // ignore socket close failures
            }
            queueSocketRef.current = null;
          }
        };

        const scheduleReconnect = () => {
          clearRetryTimer();
          const attempt = Math.min((queueSocketAttemptRef.current || 0) + 1, 6);
          queueSocketAttemptRef.current = attempt;
          const delay = Math.min(30_000, 1000 * (2 ** Math.max(0, attempt - 1)));
          queueSocketRetryRef.current = window.setTimeout(connectSocket, delay);
        };

        clearRetryTimer();
        closeSocket();

        try {
          const socket = new WebSocket(queueSocketUrl());
          queueSocketRef.current = socket;

          socket.onopen = () => {
            queueSocketAttemptRef.current = 0;
            try {
              socket.send(JSON.stringify({ type: "subscribe", client_id: currentPairCode }));
            } catch {
              // ignore subscribe failures
            }
            poll();
          };

          socket.onmessage = () => {
            poll();
          };

          socket.onerror = () => {
            // reconnect handled by onclose
          };

          socket.onclose = () => {
            if (!currentPairCode || showPairing || showSplash) return;
            scheduleReconnect();
          };
        } catch {
          scheduleReconnect();
        }
      };

      connectSocket();

      const id = setInterval(poll, 15_000);
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") poll();
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("pagehide", sendOfflineBeacon);
      window.addEventListener("beforeunload", sendOfflineBeacon);

      return () => {
        clearInterval(id);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("pagehide", sendOfflineBeacon);
        window.removeEventListener("beforeunload", sendOfflineBeacon);
        if (queueSocketRetryRef.current) {
          window.clearTimeout(queueSocketRetryRef.current);
          queueSocketRetryRef.current = null;
        }
        if (queueSocketRef.current) {
          try {
            queueSocketRef.current.close();
          } catch {
            // ignore socket close failures
          }
          queueSocketRef.current = null;
        }
      };
    }
  }, [poll, currentPairCode, queueSocketUrl, sendOfflineBeacon, showPairing, showSplash]);

  useEffect(() => {
    if (!currentPairCode || showPairing || showSplash) return;
    const lead = queuePreview?.find((item) => String(item?.status || "").toLowerCase() === "called") || queuePreview?.[0] || null;
    const announcement = buildQueueAnnouncement(lead);

    if (!announcement) {
      queueAnnouncementReadyRef.current = true;
      lastQueueAnnouncementKeyRef.current = "";
      return;
    }

    if (!queueAnnouncementReadyRef.current) {
      queueAnnouncementReadyRef.current = true;
      lastQueueAnnouncementKeyRef.current = announcement.key;
      return;
    }

    if (lastQueueAnnouncementKeyRef.current === announcement.key) return;
    lastQueueAnnouncementKeyRef.current = announcement.key;

    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(announcement.text);
        utter.lang = navigator.language || "en-US";
        utter.rate = 0.95;
        utter.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // ignore speech synthesis failures
    }
  }, [currentPairCode, queuePreview, showPairing, showSplash]);

  // Load preferences after pairing
  useEffect(() => {
    if (!currentPairCode || showPairing || showSplash) return;
    
    try {
      const raw = window.localStorage.getItem(zonePrefsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.hiddenZoneIds)) setHiddenZoneIds(parsed.hiddenZoneIds);
      if (typeof parsed?.fillBlankSpaces === "boolean") setFillBlankSpaces(parsed.fillBlankSpaces);
      if (typeof parsed?.customPlacementEnabled === "boolean") setCustomPlacementEnabled(parsed.customPlacementEnabled);
      if (parsed?.zonePlacements && typeof parsed.zonePlacements === "object") setZonePlacements(parsed.zonePlacements);
      if (parsed?.zoneMediaModes && typeof parsed.zoneMediaModes === "object") setZoneMediaModes(parsed.zoneMediaModes);
    } catch {}
  }, [zonePrefsKey, currentPairCode, showPairing, showSplash]);

  useEffect(() => {
    if (!currentPairCode || showPairing || showSplash) return;
    try {
      const raw = window.localStorage.getItem(orientationPrefsKey);
      if (!raw) return;
      const parsed = String(raw || "").toLowerCase();
      if (["auto", "landscape", "portrait"].includes(parsed)) setOrientationOverride(parsed);
    } catch {}
  }, [orientationPrefsKey, currentPairCode, showPairing, showSplash]);

  useEffect(() => {
    if (!currentPairCode || showPairing || showSplash) return;
    try {
      window.localStorage.setItem(zonePrefsKey, JSON.stringify({ hiddenZoneIds, fillBlankSpaces, customPlacementEnabled, zonePlacements, zoneMediaModes }));
    } catch {}
  }, [zonePrefsKey, hiddenZoneIds, fillBlankSpaces, customPlacementEnabled, zonePlacements, zoneMediaModes, currentPairCode, showPairing, showSplash]);

  useEffect(() => {
    if (!currentPairCode || showPairing || showSplash) return;
    try {
      window.localStorage.setItem(orientationPrefsKey, orientationOverride);
    } catch {}
  }, [orientationOverride, orientationPrefsKey, currentPairCode, showPairing, showSplash]);

  // Fetch provider data
  useEffect(() => {
    if (!payload?.client_id || !currentPairCode || showPairing || showSplash) return;
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
  }, [payload?.client_id, currentPairCode, showPairing, showSplash]);

  // Voice recognition
  useEffect(() => {
    if (!currentPairCode || showPairing || showSplash) return;
    if (!ENABLE_VOICE) {
      setVoiceState("disabled");
      setVoiceError("");
      return;
    }
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
        if (source?.products && Array.isArray(source.products)) {
          for (const p of source.products) {
            const rawTags = Array.isArray(p.tags) ? p.tags : (p.tags ? String(p.tags).split(/[,;|]/).map((t) => t.trim()) : []);
            const tags = rawTags.map((t) => normalize(t)).filter(Boolean);
            const nameNorm = normalize(p.name || "");
            const keywords = Array.from(new Set([...(nameNorm.split(/\s+/).filter(Boolean)), ...tags]));
            catalog.push({ type: "product", id: p.id, name: nameNorm, image: p.image_url || "", desc: p.description || "", meta: p, tags, keywords });
          }
        }
        if (source?.profile?.services && Array.isArray(source.profile.services)) {
          for (const s of source.profile.services) {
            const rawTags = Array.isArray(s.tags) ? s.tags : (s.tags ? String(s.tags).split(/[,;|]/).map((t) => t.trim()) : []);
            const tags = rawTags.map((t) => normalize(t)).filter(Boolean);
            const nameNorm = normalize(s.name || "");
            const keywords = Array.from(new Set([...(nameNorm.split(/\s+/).filter(Boolean)), ...tags]));
            catalog.push({ type: "service", id: s.id, name: nameNorm, image: s.image_url || "", desc: s.description || "", meta: s, tags, keywords });
          }
        }
        if (source?.name) catalog.push({ type: "provider", id: source.id || "provider", name: normalize(source.name || ""), image: source.profile?.image_url || "", desc: source.profile?.description || "", meta: source });
        if (source?.profile?.specialty) catalog.push({ type: "provider_keyword", id: `spec-${source.id || ''}`, name: normalize(source.profile.specialty || ""), image: source.profile.image_url || "", desc: source.profile.description || "", meta: source.profile });
        if (payload?.zones) {
          for (const k of Object.keys(payload.zones || {})) {
            for (const it of payload.zones[k] || []) {
              if (it?.name) catalog.push({ type: "media", id: it.id || it.media_id || `${k}-${it.name}`, name: normalize(it.name || ""), image: it.image_url || it.url || "", desc: it.description || it.content || "", meta: it });
            }
          }
        }
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
      } catch (e) {}

      const normTranscript = normalize(transcript);
      const productCatalog = catalog.filter((c) => c.type === "product");
      
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

      const scored = catalog.map((c) => {
        const n = (c.name || "").toLowerCase();
        let score = 0;
        if (n && normTranscript === n) score += 200;
        if (n && wordBoundaryIncludes(normTranscript, n)) score += 120;
        if (c.type === "room_resident" && c.name && wordBoundaryIncludes(normTranscript, (c.name || "").toLowerCase())) score += 220;
        if (c.type === "room_no") {
          const normRoom = normalizeRoomToken(c.name || "");
          const normTranscriptToken = normalizeRoomToken(normTranscript);
          if (normRoom && normTranscriptToken && normRoom === normTranscriptToken) score += 240;
          if (normRoom && normTranscriptToken && normTranscript.includes((c.name || "").toLowerCase())) score += 80;
        }
        if (c.type === "product") {
          if (n && normTranscript === n) score += 220;
          const sku = (c.meta?.sku || "").toLowerCase();
          if (sku && normTranscript.includes(sku)) score += 300;
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
      if (match && match.type === "product" && best.score < 55) {
        match = null;
      }
      const second = scored[1];
      if (best && second && best.item && second.item && best.item.type === "product" && second.item.type === "product") {
        const scoreDelta = (best.score || 0) - (second.score || 0);
        if (scoreDelta < 40) {
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
        if (overlayKeyRef.current && overlayKeyRef.current === resolvedKey) {
          return;
        }

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
      } catch (e) {}
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
  }, [ENABLE_VOICE, payload, providerData, currentPairCode, showPairing, showSplash]);

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
  const orientationMode = String(orientationOverride || payload?.orientation || "auto").toLowerCase();
  const explicitRotation = normalizeRotation(payload?.rotation ?? payload?.rotation_degrees ?? payload?.rotation_angle ?? payload?.rotate);
  const baseRotation = orientationMode === "portrait"
    ? 90
    : orientationMode === "landscape"
      ? 0
      : (viewportSize.height > viewportSize.width ? 90 : 0);
  const rotationDeg = normalizeRotation(baseRotation + explicitRotation);
  const rotatedQuarterTurn = rotationDeg === 90 || rotationDeg === 270;
  const effectiveOrientation = rotatedQuarterTurn ? "portrait" : "landscape";
  const renderSurfaceWidth = rotatedQuarterTurn ? viewportSize.height : viewportSize.width;
  const renderSurfaceHeight = rotatedQuarterTurn ? viewportSize.width : viewportSize.height;
  const viewportScale = Math.max(0.55, Math.min(2.5, Math.min(renderSurfaceWidth / canvasWidth, renderSurfaceHeight / canvasHeight)));
  const visibleZoneDefs = useMemo(
    () => zoneDefs.filter((zone) => !hiddenZoneIds.includes(zone.id)),
    [hiddenZoneIds, zoneDefs]
  );
  const hasWeatherZone = zoneDefs.some((zone) => /weather/i.test(`${zone?.role || ""} ${zone?.id || ""} ${zone?.name || ""}`));
  const contentStyle = (() => {
    if (rotationDeg === 90) {
      return {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100vh",
        height: "100vw",
        transform: "rotate(90deg) translateY(-100%)",
        transformOrigin: "top left",
        filter: `brightness(${brightness}%)`,
      };
    }
    if (rotationDeg === 180) {
      return {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        transform: "rotate(180deg) translate(-100%,-100%)",
        transformOrigin: "top left",
        filter: `brightness(${brightness}%)`,
      };
    }
    if (rotationDeg === 270) {
      return {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100vh",
        height: "100vw",
        transform: "rotate(270deg) translateX(-100%)",
        transformOrigin: "top left",
        filter: `brightness(${brightness}%)`,
      };
    }
    return { filter: `brightness(${brightness}%)` };
  })();
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

  // Weather initialization
  useEffect(() => {
    if (!hasWeatherZone || !currentPairCode || showPairing || showSplash) return;
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
  }, [hasWeatherZone, liveWeather, payload?.weather, providerData?.weather, weatherState, currentPairCode, showPairing, showSplash]);

  // Show splash screen first
  if (showSplash) {
    return <ModernSplashScreen onComplete={() => setShowSplash(false)} />;
  }
  
  // Show pairing screen if no pair code
  if (showPairing) {
    return <PairingScreen onPair={handlePair} error={pairingError} initialCode={generatedPairCode} />;
  }

  // Error state
  if (err) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <CircleSlash className="w-12 h-12 text-white/40 mx-auto mb-3" />
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40 mb-2">Pair code</div>
          <div className="font-mono text-xl mb-3">{currentPairCode}</div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{err}</h1>
          <button
            onClick={() => setShowPairing(true)}
            className="mt-6 px-4 py-2 bg-white/10 rounded-lg text-sm hover:bg-white/20 transition"
          >
            Re-pair Device
          </button>
        </div>
      </div>
    );
  }

  const shouldCompactLayout = fillBlankSpaces && hiddenZoneIds.length > 0;
  const zoneEntries = visibleZoneDefs.map((zone) => ({ zone, items: payload?.zones?.[zone.id] || [] }));
  const hasContent = zoneEntries.some(({ items }) => items.length > 0);
  const subscriptionActive = payload?.subscription_active !== false;
  const subscriptionReason = payload?.subscription_reason || payload?.message || "Subscription expired";
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
    if (effectiveOrientation === "portrait" || !hasAbsoluteLayout) return null;
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
      <div className="flex-1 relative min-h-0 bg-black overflow-hidden">
        <div className={`absolute ${effectiveOrientation === "portrait" ? "" : "inset-0"}`} style={contentStyle}>
          {!subscriptionActive ? (
            <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.18),_transparent_38%),linear-gradient(180deg,#111827,#0B1120)] p-8 text-center">
              <div className="max-w-xl rounded-[2rem] border border-white/10 bg-white/5 px-8 py-10 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.5)]">
                <div className="text-[10px] uppercase tracking-[0.45em] text-red-200/70">Playback blocked</div>
                <h1 className="mt-3 font-display text-4xl font-black tracking-tight">{subscriptionReason}</h1>
                <p className="mt-4 text-sm leading-6 text-white/70">
                  This signage player is inactive until the subscription is renewed or the account is reactivated. Your client panel remains accessible for account management.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-red-300/20 bg-red-500/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-red-100">
                  <span className="h-2 w-2 rounded-full bg-red-400" /> Subscription required
                </div>
              </div>
            </div>
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

          {subscriptionActive && !hasContent ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center max-w-md p-8">
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 mb-3">No content scheduled</div>
                <h1 className="font-display text-3xl font-extrabold tracking-tighter mb-3">{payload?.device_name || "Digital Signage"}</h1>
                <p className="text-sm text-white/60">Ask your client account to upload media, build a playlist, and schedule it for this device.</p>
                <button
                  onClick={() => setShowPairing(true)}
                  className="mt-6 px-4 py-2 bg-white/10 rounded-lg text-sm hover:bg-white/20 transition"
                >
                  Change Device
                </button>
              </div>
            </div>
          ) : (renderAsAbsolute && !shouldCompactLayout ? (
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

                  if (!customPlacementEnabled && effectiveOrientation !== "portrait" && queueZone) {
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

                  if (!customPlacementEnabled && effectiveOrientation !== "portrait" && queueSidebarLeft != null && !queueZone && !isTickerZone) {
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
                      {queueZone && items.length === 0 ? (
                        <QueueBoard deviceName={payload?.device_name} queuePreview={queuePreview} notices={notices} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} viewportScale={viewportScale} />
                      ) : autoWidgetZone && items.length === 0 ? (
                        <AutoWidgetZone zone={zone} queuePreview={queuePreview} payload={payload} providerData={providerData} weatherData={weatherData} canvasWidth={canvasWidth} canvasHeight={canvasHeight} viewportScale={viewportScale} />
                      ) : isTickerZone ? (
                        <TickerSlot items={items} label={zone.name} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} viewportScale={viewportScale} />
                      ) : logoZone && items.length === 0 && clientLogoUrl ? (
                        <div className="w-full h-full flex items-center justify-center bg-black p-4">
                          <div className="w-full h-full rounded-[1.5rem] border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                            <img src={clientLogoUrl} alt={`${payload?.device_name || "client"} logo`} className="max-h-[75%] max-w-[75%] object-contain" />
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
                          viewportScale={viewportScale}
                          isMuted={isMuted}
                          isMutedRef={isMutedRef}
                          mediaMode={zoneMediaModes?.[zone.id] || getDefaultZoneMediaMode(zone)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid gap-0 w-full h-full min-h-0" style={gridStyle}>
              {zoneEntries.map(({ zone, items }) => (
                <div key={zone.id} className="bg-black overflow-hidden relative min-h-[160px]">
                  {isQueueZone(zone) && items.length === 0 ? (
                    <QueueBoard deviceName={payload?.device_name} queuePreview={queuePreview} notices={notices} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} viewportScale={viewportScale} />
                  ) : isAutoWidgetZone(zone) && items.length === 0 ? (
                    <AutoWidgetZone zone={zone} queuePreview={queuePreview} payload={payload} providerData={providerData} weatherData={weatherData} canvasWidth={canvasWidth} canvasHeight={canvasHeight} viewportScale={viewportScale} />
                  ) : /ticker/i.test(`${zone.id} ${zone.name}`) ? (
                    <TickerSlot items={items} label={zone.name} zone={zone} canvasWidth={canvasWidth} canvasHeight={canvasHeight} viewportScale={viewportScale} />
                  ) : isLogoZone(zone) && items.length === 0 && clientLogoUrl ? (
                    <div className="w-full h-full flex items-center justify-center bg-black p-4">
                      <div className="w-full h-full rounded-[1.5rem] border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden">
                        <img src={clientLogoUrl} alt={`${payload?.device_name || "client"} logo`} className="max-h-[75%] max-w-[75%] object-contain" />
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
                      viewportScale={viewportScale}
                      isMuted={isMuted}
                      isMutedRef={isMutedRef}
                      mediaMode={zoneMediaModes?.[zone.id] || getDefaultZoneMediaMode(zone)}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}

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
                <div className="absolute right-0 mt-3 w-[min(92vw,400px)] max-h-[85vh] overflow-y-auto rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] text-white shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
                  <div className="sticky top-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] backdrop-blur-xl z-10">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.35em] text-white/45">Player menu</div>
                        <div className="text-sm font-semibold text-white">Controls and zones</div>
                      </div>
                      <button type="button" onClick={() => setMenuOpen(false)} className="rounded-full border border-white/10 p-2 text-white/70 hover:text-white">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
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
                        onClick={() => setShowPairing(true)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10 col-span-2"
                      >
                        <Smartphone className="h-4 w-4" /> Change Device
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsMuted((m) => !m)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10"
                      >
                        {isMuted ? "Unmute" : "Mute"}
                      </button>
                      <button
                        type="button"
                        onClick={resetZoneVisibility}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white hover:bg-white/10 col-span-2"
                      >
                        <RotateCcw className="h-4 w-4" /> Restore all zones
                      </button>
                    </div>

                    <div className="mt-3">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.35em] text-white/45">Orientation</div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: "auto", label: "Auto" },
                          { value: "landscape", label: "Landscape" },
                          { value: "portrait", label: "Portrait" },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setPlayerOrientation(option.value)}
                            className={`rounded-xl border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${orientationMode === option.value ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
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
                    <div className="flex items-center justify-between mb-3 sticky top-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] py-2 -mt-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.35em] text-white/45">Zone settings</div>
                        <div className="text-sm font-semibold text-white">Hide, restore, or place zones</div>
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">{visibleZoneDefs.length}/{zoneDefs.length}</div>
                    </div>

                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {zoneDefs.map((zone) => {
                        const hidden = hiddenZoneIds.includes(zone.id);
                        const placement = zonePlacements?.[zone.id] || "auto";
                        const mediaMode = zoneMediaModes?.[zone.id] || getDefaultZoneMediaMode(zone);
                        return (
                          <div key={zone.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
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
                              <div className="grid grid-cols-3 gap-2">
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
                                <button
                                  type="button"
                                  onClick={() => setZoneMediaMode(zone.id, "stretch")}
                                  className={`rounded-xl border px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${mediaMode === "stretch" ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-100" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
                                >
                                  Stretch
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
        </div>
      </div>

      <style>{`
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { animation: marquee 28s linear infinite; }
      `}</style>
    </div>
  );
}