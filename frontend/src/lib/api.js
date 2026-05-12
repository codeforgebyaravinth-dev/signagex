import axios from "axios";

const RAW_BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const BASE = RAW_BASE.replace(/\/api$/, "");
export const API_BASE = `${BASE}/api`;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// attach token from localStorage as Bearer fallback (works if cookies blocked)
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("access_token");
  if (t) cfg.headers["Authorization"] = `Bearer ${t}`;
  return cfg;
});

export function formatErr(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
