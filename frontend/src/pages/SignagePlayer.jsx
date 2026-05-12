import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Monitor, CircleSlash, Maximize } from "lucide-react";

const RAW_BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const BASE = RAW_BASE.replace(/\/api$/, "");

function MediaSlot({ items, label }) {
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => { setIdx(0); }, [items?.length]);

  useEffect(() => {
    if (!items || items.length === 0) return;
    const cur = items[idx];
    if (!cur) return;
    if (cur.kind === "video") return;
    timerRef.current = setTimeout(() => setIdx((i) => (i + 1) % items.length), (cur.duration || 10) * 1000);
    return () => clearTimeout(timerRef.current);
  }, [idx, items]);

  if (!items || items.length === 0) {
    return <div className="w-full h-full flex items-center justify-center text-white/30 text-xs font-mono uppercase tracking-widest">{label}</div>;
  }

  const cur = items[idx];
  if (!cur) return null;

  if (cur.kind === "text") {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black p-6 text-center">
        <div className="max-w-[90%] text-white font-display text-2xl font-bold leading-tight">{cur.text}</div>
      </div>
    );
  }

  return cur.kind === "image" ? (
    <img src={`${BASE}${cur.url}`} alt={cur.name} className="w-full h-full object-cover" />
  ) : (
    <video
      src={`${BASE}${cur.url}`}
      autoPlay
      muted
      playsInline
      className="w-full h-full object-cover"
      onEnded={() => setIdx((i) => (i + 1) % items.length)}
      onError={() => setIdx((i) => (i + 1) % items.length)}
    />
  );
}

export default function SignagePlayer() {
  const { pairCode } = useParams();
  const [payload, setPayload] = useState(null);
  const [err, setErr] = useState("");
  const wrapRef = useRef(null);

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

  if (!payload) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-white/40 text-xs font-mono uppercase tracking-widest">Connecting...</div>;
  }

  const zoneEntries = zoneDefs.map((zone) => ({ zone, items: payload.zones?.[zone.id] || [] }));
  const hasContent = zoneEntries.some(({ items }) => items.length > 0);
  const colCount = Math.max(1, zoneEntries.length);
  const gridStyle = {
    gridTemplateColumns: colCount === 1 ? "1fr" : colCount === 2 ? "repeat(2, minmax(0, 1fr))" : colCount === 4 ? "repeat(2, minmax(0, 1fr))" : `repeat(${colCount}, minmax(0, 1fr))`,
  };

  return (
    <div ref={wrapRef} className="min-h-screen bg-black text-white flex flex-col" data-testid="signage-player">
      <div className="flex items-center justify-between px-4 py-2 bg-black/80 border-b border-white/10 text-[10px] uppercase tracking-wider font-mono">
        <div className="flex items-center gap-2"><Monitor className="w-3.5 h-3.5" /> {payload.device_name}</div>
        <div className="flex items-center gap-4">
          <span className="text-white/50">code <span className="text-white">{pairCode}</span></span>
          <button onClick={goFullscreen} className="hover:text-white/80" data-testid="fullscreen-btn"><Maximize className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {!hasContent ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/40 mb-3">No content scheduled</div>
            <h1 className="font-display text-3xl font-extrabold tracking-tighter mb-3">{payload.device_name}</h1>
            <p className="text-sm text-white/60">Ask your client account to upload media, build a playlist, and schedule it for this device.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid gap-1 p-1 min-h-0" style={gridStyle}>
          {zoneEntries.map(({ zone, items }) => (
            <div key={zone.id} className="bg-black overflow-hidden relative min-h-[160px]">
              <MediaSlot items={items} label={zone.name} />
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-marquee { animation: marquee 30s linear infinite; }
      `}</style>
    </div>
  );
}
