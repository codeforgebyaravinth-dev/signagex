from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
if (ROOT_DIR / ".env.docker").exists():
    load_dotenv(ROOT_DIR / ".env.docker")
elif (ROOT_DIR / ".env").exists():
    load_dotenv(ROOT_DIR / ".env")

import os
import logging
import uuid
import re
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Dict, Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import bcrypt
import boto3
import jwt
import json
import requests
import xml.etree.ElementTree as ET
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form, WebSocket, WebSocketDisconnect
import asyncio
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from botocore.exceptions import ClientError, BotoCoreError
import io
import base64

try:
    import redis.asyncio as redis
except Exception:
    redis = None

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'signage')]
DB_READY = False

# In-memory recent announcement cache to surface immediate broadcasts to polling players
# Structure: { client_id: { "payload": {...}, "expires_at": datetime } }
RECENT_ANNOUNCEMENTS: Dict[str, Dict[str, Any]] = {}

app = FastAPI()
api = APIRouter(prefix="/api")
public_api = APIRouter(prefix="/api/public")

JWT_ALGO = "HS256"
PLAN_TYPES = ("cloud", "usb", "hybrid")
VERTICALS = ("general", "doctor", "salon", "retailer", "society")
WEATHER_CACHE: Dict[str, Dict[str, Any]] = {}
APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "Asia/Kolkata")
REDIS_URL = os.environ.get("REDIS_URL", "").strip()
REDIS_CLIENT = None
REDIS_SUBSCRIBER_TASK = None


class QueueConnectionManager:
    def __init__(self):
        self._connections: Dict[str, set] = {}
        self._last_accept_info: Dict[str, Dict[str, Any]] = {}

    async def connect(self, client_id: str, websocket: WebSocket, branch_id: Optional[str] = None):
        await websocket.accept()
        self._connections.setdefault(_scope_key(client_id, branch_id), set()).add(websocket)

    def register(self, client_id: str, websocket: WebSocket, branch_id: Optional[str] = None):
        """Register an already-accepted websocket for broadcasts.

        Use this when the endpoint performs an explicit subscribe handshake before registration.
        """
        try:
            self._connections.setdefault(_scope_key(client_id, branch_id), set()).add(websocket)
        except Exception:
            pass

    def disconnect(self, client_id: str, websocket: WebSocket, branch_id: Optional[str] = None):
        key = _scope_key(client_id, branch_id)
        sockets = self._connections.get(key)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(key, None)

    async def broadcast(self, client_id: str, payload: dict, branch_id: Optional[str] = None):
        key = _scope_key(client_id, branch_id)
        sockets = list(self._connections.get(key, set()))
        for websocket in sockets:
            try:
                logging.getLogger('uvicorn.error').debug(f"broadcast -> sending to client {client_id} branch={branch_id}: keys={list(payload.keys())}")
                await websocket.send_json(payload)
                logging.getLogger('uvicorn.error').debug(f"broadcast -> sent to client {client_id} branch={branch_id}")
            except Exception:
                logging.getLogger('uvicorn.error').exception(f"broadcast -> send failed for client {client_id} branch={branch_id}")
                self.disconnect(client_id, websocket, branch_id=branch_id)


def _scope_key(client_id: str, branch_id: Optional[str] = None) -> str:
    return f"{client_id}:{branch_id or 'global'}"


def _redis_channel(kind: str, client_id: str, branch_id: Optional[str] = None) -> str:
    return f"signage:{kind}:{client_id}:{branch_id or 'global'}"


async def _redis_publish(kind: str, client_id: str, payload: Dict[str, Any], branch_id: Optional[str] = None):
    if not REDIS_CLIENT:
        return
    try:
        message = {"kind": kind, "client_id": client_id, "branch_id": branch_id or "", "payload": payload}
        await REDIS_CLIENT.publish(_redis_channel(kind, client_id, branch_id), json.dumps(message, default=str))
    except Exception:
        logging.getLogger('uvicorn.error').debug(f"redis publish failed kind={kind} client={client_id} branch={branch_id}")


async def _redis_event_dispatcher():
    if not REDIS_CLIENT:
        return
    pubsub = REDIS_CLIENT.pubsub(ignore_subscribe_messages=True)
    try:
        await pubsub.psubscribe("signage:*")
        async for message in pubsub.listen():
            if not message:
                continue
            if message.get("type") not in {"pmessage", "message"}:
                continue
            try:
                raw = message.get("data")
                if isinstance(raw, (bytes, bytearray)):
                    raw = raw.decode("utf-8", errors="ignore")
                data = json.loads(raw or "{}")
            except Exception:
                continue

            kind = str(data.get("kind") or "")
            client_id = str(data.get("client_id") or "")
            branch_id = str(data.get("branch_id") or "") or None
            payload = data.get("payload") or {}
            if not client_id:
                continue

            if kind == "queue_refresh":
                try:
                    if payload.get("announcement"):
                        RECENT_ANNOUNCEMENTS[_scope_key(client_id, branch_id)] = {
                            "payload": payload,
                            "expires_at": datetime.now(timezone.utc) + timedelta(seconds=30),
                        }
                except Exception:
                    pass
                await queue_ws_manager.broadcast(client_id, payload, branch_id=branch_id)
            elif kind == "content_refresh":
                await content_ws_manager.broadcast(client_id, payload, branch_id=branch_id)
    finally:
        try:
            await pubsub.close()
        except Exception:
            pass


queue_ws_manager = QueueConnectionManager()
content_ws_manager = QueueConnectionManager()


def _app_now() -> datetime:
    try:
        return datetime.now(ZoneInfo(APP_TIMEZONE))
    except Exception:
        return datetime.now(timezone.utc)


async def _broadcast_queue_refresh(client_id: str, reason: str = "update", branch_id: Optional[str] = None):
    if client_id:
        payload = {"type": "queue_refresh", "client_id": client_id, "reason": reason, "timestamp": now_iso(), "branch_id": branch_id or ""}
        queue_snapshot = await _build_queue_announcement_snapshot(client_id, branch_id=branch_id)
        if queue_snapshot:
            payload.update(queue_snapshot)
        # add server-sent timestamp for client-side latency measurement
        payload["sent_at"] = now_iso()
        # cache recent announcement payload for short time so polling players can pick it up
        try:
            RECENT_ANNOUNCEMENTS[_scope_key(client_id, branch_id)] = {"payload": payload, "expires_at": datetime.now(timezone.utc) + timedelta(seconds=30)}
        except Exception:
            pass

        try:
            asyncio.create_task(queue_ws_manager.broadcast(client_id, payload, branch_id=branch_id))
            logging.getLogger('uvicorn.error').info(
                f"queue_refresh broadcast client={client_id} branch={branch_id} reason={reason} announcement={(payload.get('announcement') or {}).get('text', '')}"
            )
        except Exception:
            # fallback to awaiting if scheduling fails
            await queue_ws_manager.broadcast(client_id, payload, branch_id=branch_id)

        await _redis_publish("queue_refresh", client_id, payload, branch_id=branch_id)


async def _broadcast_content_refresh(client_id: str, reason: str = "update", branch_id: Optional[str] = None):
    if client_id:
        payload = {"type": "content_refresh", "client_id": client_id, "reason": reason, "timestamp": now_iso(), "sent_at": now_iso(), "branch_id": branch_id or ""}
        try:
            asyncio.create_task(content_ws_manager.broadcast(client_id, payload, branch_id=branch_id))
            logging.getLogger('uvicorn.error').info(f"content_refresh broadcast client={client_id} branch={branch_id} reason={reason}")
        except Exception:
            await content_ws_manager.broadcast(client_id, payload, branch_id=branch_id)

        await _redis_publish("content_refresh", client_id, payload, branch_id=branch_id)


async def _build_queue_announcement_snapshot(client_id: str, branch_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    profile = await _public_service_profile(client_id, branch_id=branch_id)
    if not profile:
        return None

    queue_preview = profile.get("queue_preview") or []
    queue_length = int(profile.get("queue_length") or len(queue_preview) or 0)
    queue_minutes = int(profile.get("queue_total_minutes") or 0)

    lead = next((item for item in queue_preview if (item.get("status") or "").lower() == "called"), queue_preview[0] if queue_preview else None)
    announcement = None
    if lead:
        token = str(lead.get("token") or "").strip()
        if token:
            recall_count = int(lead.get("recall_count") or 0)
            is_recall = recall_count > 0 or bool(lead.get("recalled_at"))
            key = f"{token}:{lead.get('status', '')}:{recall_count}:{lead.get('recalled_at', '')}"
            text = f"Recall for token {token}. Please return to the counter." if is_recall else f"Token {token}, please proceed to the counter."
            announcement = {"key": key, "text": text}

    return {
        "queue_length": queue_length,
        "queue_total_minutes": queue_minutes,
        "queue_preview": queue_preview[:8],
        "announcement": announcement,
    }


async def _resolve_appointment_scope_branch(client_id: str, appointment: Dict[str, Any]) -> Optional[str]:
    branch_id = str(appointment.get("branch_id") or "").strip()
    if branch_id:
        return branch_id

    candidate_device_ids = [
        str(appointment.get("booking_device_id") or "").strip(),
        str(appointment.get("routed_device_id") or "").strip(),
    ]
    for device_id in candidate_device_ids:
        if not device_id:
            continue
        device = await db.devices.find_one({"id": device_id, "client_id": client_id}, {"_id": 0, "branch_id": 1})
        if device and str(device.get("branch_id") or "").strip():
            return str(device.get("branch_id") or "").strip()

    return None


def _weather_description(code: Optional[Any]) -> str:
    mapping = {
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
    }
    try:
        return mapping.get(int(code), "Current conditions")
    except Exception:
        return "Current conditions"


def _resolve_weather_snapshot(address: Optional[str]) -> Optional[Dict[str, Any]]:
    if not address or not str(address).strip():
        return None

    cache_key = str(address).strip().lower()
    cached = WEATHER_CACHE.get(cache_key)
    if cached and cached.get("expires_at") and cached["expires_at"] > datetime.now(timezone.utc):
        return cached.get("weather")

    try:
        geo_resp = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": address, "count": 1, "language": "en", "format": "json"},
            timeout=4,
        )
        geo_resp.raise_for_status()
        geo_data = geo_resp.json() or {}
        result = (geo_data.get("results") or [None])[0]
        if not result:
            return None

        latitude = result.get("latitude")
        longitude = result.get("longitude")
        if latitude is None or longitude is None:
            return None

        wx_resp = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "current": "temperature_2m,weather_code,relative_humidity_2m",
                "daily": "temperature_2m_max,temperature_2m_min",
                "timezone": "auto",
            },
            timeout=4,
        )
        wx_resp.raise_for_status()
        wx_data = wx_resp.json() or {}
        current = wx_data.get("current") or {}
        daily = wx_data.get("daily") or {}

        weather = {
            "location": result.get("name") or address,
            "temperature": current.get("temperature_2m"),
            "condition": _weather_description(current.get("weather_code")),
            "high": (daily.get("temperature_2m_max") or [None])[0],
            "low": (daily.get("temperature_2m_min") or [None])[0],
            "humidity": current.get("relative_humidity_2m"),
            "weather_code": current.get("weather_code"),
        }
        WEATHER_CACHE[cache_key] = {"expires_at": datetime.now(timezone.utc) + timedelta(minutes=30), "weather": weather}
        return weather
    except Exception:
        return None

# ---------------- Auth ----------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(pw: str, hashed: str) -> bool:
    try: return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception: return False

def jwt_secret() -> str: return os.environ["JWT_SECRET"]

def create_access_token(uid: str, email: str, role: str) -> str:
    return jwt.encode({"sub": uid, "email": email, "role": role, "type": "access",
                       "exp": datetime.now(timezone.utc) + timedelta(hours=12)},
                      jwt_secret(), algorithm=JWT_ALGO)

def create_refresh_token(uid: str) -> str:
    return jwt.encode({"sub": uid, "type": "refresh",
                       "exp": datetime.now(timezone.utc) + timedelta(days=7)},
                      jwt_secret(), algorithm=JWT_ALGO)

def set_auth_cookies(resp: Response, access: str, refresh: str):
    resp.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=12*3600, path="/")
    resp.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=7*24*3600, path="/")

def clear_auth_cookies(resp: Response):
    resp.delete_cookie("access_token", path="/"); resp.delete_cookie("refresh_token", path="/")

def offline_user_for(email: str, password: str) -> Optional[dict]:
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@admin.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    if email == admin_email and password == admin_password:
        return {
            "id": "offline-admin",
            "email": admin_email,
            "name": "Administrator",
            "role": "admin",
            "status": "active",
        }
    if email == "dealer@demo.com" and password == "dealer123":
        return {
            "id": "offline-dealer",
            "email": "dealer@demo.com",
            "name": "Demo Dealer",
            "role": "dealer",
            "status": "active",
        }
    return None

def offline_user_from_token(payload: dict) -> dict:
    role = payload.get("role", "client")
    return {
        "id": payload.get("sub", "offline-user"),
        "email": payload.get("email", ""),
        "name": payload.get("email", "Administrator" if role == "admin" else "Demo Dealer"),
        "role": role,
        "status": "active",
    }

async def find_user_any(uid: str) -> Optional[dict]:
    """Search users (admin/dealer) and clients collection (client role)."""
    if not DB_READY:
        return None
    u = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if u: return u
    c = await db.clients.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if c:
        c["role"] = "client"
        c = await _sync_client_wallet_status(c)
    return c

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "): token = h[7:]
    if not token: raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALGO])
        if payload.get("type") != "access": raise HTTPException(status_code=401, detail="Invalid token type")
        if not DB_READY:
            return offline_user_from_token(payload)
        u = await find_user_any(payload["sub"])
        if not u: raise HTTPException(status_code=401, detail="User not found")
        return u
    except jwt.ExpiredSignatureError: raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError: raise HTTPException(status_code=401, detail="Invalid token")

def require_role(*roles, allow_pending: bool = False):
    async def _w(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles: raise HTTPException(status_code=403, detail="Forbidden")
        status = user.get("status", "active")
        if status == "suspended":
            raise HTTPException(status_code=403, detail="Account suspended. Contact your administrator.")
        if status == "pending" and not allow_pending:
            raise HTTPException(status_code=403, detail="Account pending verification. Complete payment to activate.")
        return user
    return _w

# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr; password: str

class PlanIn(BaseModel):
    name: str
    type: Literal["cloud", "usb", "hybrid"]
    billing_cycle: Literal["monthly", "yearly", "custom"] = "monthly"
    price: float = 0.0
    storage_limit_gb: float = 0.0
    duration_days: Optional[int] = None
    description: str = ""
    features: List[str] = []

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["cloud", "usb", "hybrid"]] = None
    billing_cycle: Optional[Literal["monthly", "yearly", "custom"]] = None
    price: Optional[float] = None
    storage_limit_gb: Optional[float] = None
    duration_days: Optional[int] = None
    description: Optional[str] = None
    features: Optional[List[str]] = None

class DealerCreate(BaseModel):
    name: str; email: EmailStr; password: str
    phone: str = ""; gst_number: str = ""; address: str = ""
    plan: Literal["cloud", "usb", "hybrid"] = "cloud"
    plan_id: Optional[str] = None
    wallet_balance: float = 0.0

class DealerUpdate(BaseModel):
    name: Optional[str] = None; phone: Optional[str] = None
    gst_number: Optional[str] = None; address: Optional[str] = None
    plan: Optional[Literal["cloud", "usb", "hybrid"]] = None
    plan_id: Optional[str] = None; password: Optional[str] = None
    upi_id: Optional[str] = None
    status: Optional[Literal["active", "suspended", "pending"]] = None

class TemplateZone(BaseModel):
    """Represents a single zone in a template layout."""
    id: str  # unique zone identifier
    name: str  # e.g., "Main Screen 1", "Main Screen 2", "Sidebar"
    x: Optional[int] = None  # left offset in pixels for composition layouts
    y: Optional[int] = None  # top offset in pixels for composition layouts
    width_px: Optional[int] = None  # pixel width for composition layouts
    height_px: Optional[int] = None  # pixel height for composition layouts
    width: Optional[str] = None  # CSS width or grid column span
    height: Optional[str] = None  # CSS height or grid row span
    position: Optional[str] = None  # CSS grid position or flex order

class TemplateLayout(BaseModel):
    # New: dynamic zones array plus composition metadata
    canvas_width: int = 1920
    canvas_height: int = 1080
    use_grid: bool = True
    zones: List[TemplateZone] = Field(default_factory=list)
    # Legacy (kept for backward compatibility): old string fields
    main: str = ""
    sidebar: str = ""
    ticker: str = ""

class TemplateIn(BaseModel):
    name: str; category: str; description: str = ""
    thumbnail_url: str = ""
    plan: Literal["cloud", "usb", "hybrid"] = "cloud"
    assigned_dealer_ids: List[str] = []
    layout: TemplateLayout = Field(default_factory=TemplateLayout)

class TemplateUpdate(BaseModel):
    name: Optional[str] = None; category: Optional[str] = None
    description: Optional[str] = None; thumbnail_url: Optional[str] = None
    plan: Optional[Literal["cloud", "usb", "hybrid"]] = None
    assigned_dealer_ids: Optional[List[str]] = None
    layout: Optional[TemplateLayout] = None

class ClientCreate(BaseModel):
    name: str; email: EmailStr; password: str
    phone: str = ""; gst_number: str = ""; address: str = ""
    plan: Literal["cloud", "usb", "hybrid"] = "cloud"
    plan_id: Optional[str] = None
    vertical: Literal["general", "doctor", "salon", "retailer", "society"] = "general"
    wallet_balance: float = 0.0
    assigned_template_ids: List[str] = []

class ClientUpdate(BaseModel):
    name: Optional[str] = None; email: Optional[EmailStr] = None
    password: Optional[str] = None
    phone: Optional[str] = None; gst_number: Optional[str] = None
    address: Optional[str] = None
    plan: Optional[Literal["cloud", "usb", "hybrid"]] = None
    plan_id: Optional[str] = None
    vertical: Optional[Literal["general", "doctor", "salon", "retailer", "society"]] = None
    assigned_template_ids: Optional[List[str]] = None
    status: Optional[Literal["active", "suspended", "pending"]] = None
    dealer_id: Optional[str] = None

class CreditIn(BaseModel):
    amount: float

class DeviceCreate(BaseModel):
    name: str
    location: str = ""
    pair_code: Optional[str] = None
    template_id: Optional[str] = None
    branch_id: Optional[str] = None
    playlist_id: Optional[str] = None
    orientation: Optional[Literal["auto", "landscape", "portrait"]] = "auto"
    brightness: Optional[int] = 100


class PairRequestIn(BaseModel):
    device_fingerprint: str
    device_name: Optional[str] = None


class PairCompleteIn(BaseModel):
    pair_code: str
    device_id: str


class BranchIn(BaseModel):
    name: str
    # optional: branch id to clone data from (empty => clone global storefront)
    clone_from_branch_id: Optional[str] = None


async def _complete_device_pairing(device_filter: dict, pair_code: str, device_id: str):
    pairing = await db.pairings.find_one({"code": pair_code, "used": False})
    if not pairing:
        raise HTTPException(status_code=404, detail="Pair code not found or already used")

    try:
        exp_dt = datetime.fromisoformat(str(pairing.get("expires_at"))) if pairing.get("expires_at") else None
        if exp_dt and exp_dt < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Pair code expired")
    except HTTPException:
        raise
    except Exception:
        pass

    device = await db.devices.find_one(device_filter)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    await db.devices.update_one(
        {"id": device_id},
        {"$set": {"pair_code": pairing["code"], "fingerprint": pairing["device_fingerprint"], "status": "paired", "paired_at": now_iso()}},
    )
    await db.pairings.update_one({"_id": pairing["_id"]}, {"$set": {"used": True, "paired_device_id": device_id}})
    return {"ok": True, "device_id": device_id, "pair_code": pairing["code"]}


GST_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")
PHONE_EXT_RE = re.compile(r"(?:\s*(?:ext\.?|x)\s*(\d{1,6}))$", re.IGNORECASE)


def _clean_phone_value(value: Optional[str]) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    ext_match = PHONE_EXT_RE.search(text)
    if ext_match:
        text = text[:ext_match.start()].strip()

    digits_only = re.sub(r"\D", "", text)
    if not (10 <= len(digits_only) <= 15):
        raise HTTPException(status_code=400, detail="Phone number must contain 10 to 15 digits. Use an optional extension like 'ext 123'.")

    if re.search(r"[A-Za-z]", text):
        raise HTTPException(status_code=400, detail="Phone number can only include digits, spaces, +, -, parentheses, and an optional extension.")

    normalized = re.sub(r"\s+", " ", text).strip()
    if ext_match:
        normalized = f"{normalized} ext {ext_match.group(1)}"
    return normalized


def _clean_gst_value(value: Optional[str]) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    if not GST_RE.fullmatch(text):
        raise HTTPException(status_code=400, detail="GST number must be 15 characters in the standard format, like 29ABCDE1234F1Z5.")
    return text


def _plan_duration_days(plan: Optional[dict]) -> int:
    if not plan:
        return 30
    billing_cycle = str(plan.get("billing_cycle") or "monthly").lower()
    if billing_cycle == "yearly":
        return max(1, int(plan.get("duration_days") or 365))
    if billing_cycle == "custom":
        return max(1, int(plan.get("duration_days") or 0))
    return max(1, int(plan.get("duration_days") or 30))


def _subscription_window_for_plan(plan: Optional[dict], start_at: Optional[datetime] = None) -> tuple[Optional[str], Optional[str]]:
    if not plan:
        return None, None
    started = (start_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    expires = started + timedelta(days=_plan_duration_days(plan))
    return started.isoformat(), expires.isoformat()


def _subscription_fields_for_plan(plan: Optional[dict], start_at: Optional[datetime] = None) -> dict:
    started_at, expires_at = _subscription_window_for_plan(plan, start_at=start_at)
    return {
        "plan_started_at": started_at,
        "plan_expires_at": expires_at,
    }

class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[Literal["paired", "unpaired", "offline"]] = None
    template_id: Optional[str] = None
    playlist_id: Optional[str] = None
    branch_id: Optional[str] = None
    orientation: Optional[Literal["auto", "landscape", "portrait"]] = None
    brightness: Optional[int] = None

# Doctor models
class ServiceItem(BaseModel):
    id: Optional[str] = None
    name: str = ""
    price: float = 0.0
    duration_mins: int = 30
    description: str = ""
    image_url: str = ""
    active: bool = True
    tags: List[str] = Field(default_factory=list)


class DoctorProfile(BaseModel):
    specialty: str = ""
    qualifications: str = ""
    fee: float = 0.0
    hours: str = ""
    is_open: bool = True
    image_url: str = ""
    description: str = ""
    slot_minutes: int = 15
    services: List[ServiceItem] = Field(default_factory=list)

class AppointmentCreate(BaseModel):
    patient_name: str
    patient_phone: str
    notes: str = ""
    preferred_time: str = ""
    booking_location: str = ""
    booking_device_id: Optional[str] = None
    service_name: str = ""
    service_id: Optional[str] = None
    service_ids: List[str] = Field(default_factory=list)
    service_price: float = 0.0
    source: Literal["public", "manual"] = "public"


class ClinicMedicineItem(BaseModel):
    name: str
    dosage: str = ""
    schedule: str = ""
    duration_days: Optional[int] = None
    notes: str = ""


class ClinicVisitCreate(BaseModel):
    patient_name: Optional[str] = ""
    diagnosis: str = ""
    symptoms: str = ""
    notes: str = ""
    medicines: List[ClinicMedicineItem] = Field(default_factory=list)
    follow_up_on: Optional[str] = None

# Retailer
class ProductIn(BaseModel):
    name: str; price: float; sku: str = ""; description: str = ""; image_url: str = ""; stock: int = 0

class ProductUpdate(BaseModel):
    name: Optional[str] = None; price: Optional[float] = None; sku: Optional[str] = None
    description: Optional[str] = None; image_url: Optional[str] = None; stock: Optional[int] = None

# Society
class RoomIn(BaseModel):
    room_no: str; user_name: str; mobile: str = ""; notes: str = ""

class RoomUpdate(BaseModel):
    room_no: Optional[str] = None; user_name: Optional[str] = None
    mobile: Optional[str] = None; notes: Optional[str] = None

class NoticeIn(BaseModel):
    title: str
    body: str = ""
    image_url: str = ""

class NoticeUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    image_url: Optional[str] = None

# ---------------- Helpers ----------------
def now_iso(): return datetime.now(timezone.utc).isoformat()
def clean(d): d.pop("_id", None); d.pop("password_hash", None); return d
def gen_pair_code(): return str(uuid.uuid4().int)[:6]

def normalize_room_no(r):
    if not r: return ""
    s = re.sub(r"[^A-Za-z0-9]", "", str(r))
    return s.upper()

def _appointment_status_rank(status: str) -> int:
    return {"called": 0, "pending": 1, "done": 2, "cancelled": 3}.get(status or "", 9)


def _normalize_patient_phone_key(phone: Optional[str]) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) < 10:
        raise HTTPException(status_code=400, detail="Patient contact number must include at least 10 digits")
    # Keep last 10 digits as canonical key to avoid country-code format mismatches.
    return digits[-10:]


async def _upsert_clinic_patient(client_id: str, patient_phone: str, patient_name: Optional[str] = "") -> dict:
    phone_key = _normalize_patient_phone_key(patient_phone)
    now = now_iso()
    base_set = {
        "client_id": client_id,
        "phone_key": phone_key,
        "username": phone_key,
        "contact_number": str(patient_phone or "").strip(),
        "updated_at": now,
    }
    if patient_name and str(patient_name).strip():
        base_set["name"] = str(patient_name).strip()

    result = await db.clinic_patients.find_one_and_update(
        {"client_id": client_id, "phone_key": phone_key},
        {
            "$set": base_set,
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
                "history_count": 0,
            },
        },
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    return result

async def gen_dealer_code() -> str:
    """Generate next dealer code like RP-D101, RP-D102, etc."""
    counter = await db.counters.find_one_and_update(
        {"_id": "dealer_code"},
        {"$inc": {"next": 1}},
        upsert=True,
        return_document=True
    )
    num = counter["next"]
    return f"RP-D{num:03d}"

async def gen_client_code() -> str:
    """Generate next client code like RP-C101, RP-C102, etc."""
    counter = await db.counters.find_one_and_update(
        {"_id": "client_code"},
        {"$inc": {"next": 1}},
        upsert=True,
        return_document=True
    )
    num = counter["next"]
    return f"RP-C{num:03d}"

async def hydrate_client(c: dict) -> dict:
    if not c: return c
    c.pop("_id", None); c.pop("password_hash", None)
    if c.get("dealer_id"):
        d = await db.users.find_one({"id": c["dealer_id"]}, {"_id": 0, "name": 1})
        c["dealer_name"] = d["name"] if d else ""
    c["public_booking_slug"] = _slugify_public_ref(c.get("name", ""))
    c.setdefault("doctor_profile", {"services": []})
    c.setdefault("salon_profile", {"services": []})
    return c


def _service_profile_field(vertical: str) -> str:
    return f"{vertical}_profile"


def _service_label(vertical: str) -> str:
    return "Doctor" if vertical == "doctor" else "Salon" if vertical == "salon" else vertical.title()


def _slugify_public_ref(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:48]


async def _resolve_public_client_ref(ref: str) -> dict:
    if not ref:
        raise HTTPException(status_code=404, detail="Provider not found")

    direct = await db.clients.find_one({"id": ref}, {"id": 1, "name": 1, "public_booking_slug": 1, "vertical": 1})
    if direct:
        return direct

    slug = _slugify_public_ref(ref)
    if not slug:
        raise HTTPException(status_code=404, detail="Provider not found")
    # First try explicit stored slug on the client document
    candidate = await db.clients.find_one({"public_booking_slug": slug}, {"id": 1, "name": 1, "public_booking_slug": 1, "vertical": 1})
    if candidate:
        return candidate

    # Fall back to slugifying the name and scanning all clients for a match
    # Fetch only required fields (use inclusion-only projection to avoid MongoDB projection errors)
    candidates = await db.clients.find({}, {"id": 1, "name": 1, "public_booking_slug": 1, "vertical": 1}).to_list(2000)
    for candidate in candidates:
        if _slugify_public_ref(candidate.get("name", "")) == slug:
            return candidate

    raise HTTPException(status_code=404, detail="Provider not found")


def _normalize_service_catalog(profile: dict, vertical: str) -> dict:
    normalized = dict(profile or {})
    services = normalized.get("services") or []
    if not isinstance(services, list):
        services = []
    if not services:
        fallback_name = normalized.get("specialty") or f"{_service_label(vertical)} service"
        services = [{
            "id": "featured",
            "name": fallback_name,
            "price": float(normalized.get("fee", 0) or 0),
            "duration_mins": int(normalized.get("slot_minutes", 15) or 15),
            "description": normalized.get("description", ""),
            "image_url": normalized.get("image_url", ""),
            "active": True,
        }]
    normalized["services"] = services
    return normalized

# ---------------- Auth Endpoints ----------------
@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower()
    user = None
    role = None
    if DB_READY:
        user = await db.users.find_one({"email": email})
        if user:
            if not verify_password(body.password, user.get("password_hash", "")):
                raise HTTPException(status_code=401, detail="Invalid email or password")
            uid = user["id"]; name = user["name"]; role = user["role"]
        else:
            cl = await db.clients.find_one({"email": email})
            if not cl or not verify_password(body.password, cl.get("password_hash", "")):
                raise HTTPException(status_code=401, detail="Invalid email or password")
            uid = cl["id"]; name = cl["name"]; role = "client"
    else:
        offline = offline_user_for(email, body.password)
        if not offline:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        uid = offline["id"]; name = offline["name"]; role = offline["role"]
    access = create_access_token(uid, email, role)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    return {"user": {"id": uid, "email": email, "name": name, "role": role}, "access_token": access}

@api.post("/auth/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    clear_auth_cookies(response); return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}

# ---------------- Admin: Plans ----------------
@api.get("/admin/plans")
async def list_plans(_: dict = Depends(require_role("admin"))):
    return await db.plans.find({}, {"_id": 0}).to_list(1000)

@api.post("/admin/plans")
async def create_plan(body: PlanIn, _: dict = Depends(require_role("admin"))):
    duration_days = body.duration_days
    billing_cycle = (body.billing_cycle or "monthly").lower()
    if billing_cycle == "custom":
        if not duration_days or int(duration_days) <= 0:
            raise HTTPException(status_code=400, detail="Custom plans need a duration in days")
    elif duration_days is None:
        duration_days = 365 if billing_cycle == "yearly" else 30
    doc = {"id": str(uuid.uuid4()), **body.model_dump(exclude_none=True), "duration_days": int(duration_days or 0), "created_at": now_iso()}
    await db.plans.insert_one(doc); return clean(doc)

@api.put("/admin/plans/{pid}")
async def update_plan(pid: str, body: PlanUpdate, _: dict = Depends(require_role("admin"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "billing_cycle" in upd:
        upd["billing_cycle"] = str(upd["billing_cycle"]).lower()
    if upd.get("billing_cycle") == "custom" and int(upd.get("duration_days") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Custom plans need a duration in days")
    if "duration_days" in upd:
        upd["duration_days"] = max(1, int(upd["duration_days"] or 0))
    elif upd.get("billing_cycle") == "monthly":
        upd.setdefault("duration_days", 30)
    elif upd.get("billing_cycle") == "yearly":
        upd.setdefault("duration_days", 365)
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.plans.find_one_and_update({"id": pid}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Plan not found")
    return r

@api.delete("/admin/plans/{pid}")
async def delete_plan(pid: str, _: dict = Depends(require_role("admin"))):
    r = await db.plans.delete_one({"id": pid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Plan not found")
    await db.users.update_many({"plan_id": pid}, {"$unset": {"plan_id": ""}})
    return {"ok": True}

# ---------------- Admin: Dealers ----------------
@api.get("/admin/dealers")
async def list_dealers(_: dict = Depends(require_role("admin"))):
    return await db.users.find({"role": "dealer"}, {"_id": 0, "password_hash": 0}).to_list(1000)

@api.post("/admin/dealers")
async def create_dealer(body: DealerCreate, _: dict = Depends(require_role("admin"))):
    email = body.email.lower()
    if await db.users.find_one({"email": email}): raise HTTPException(status_code=400, detail="Email already exists")
    dealer_code = await gen_dealer_code()
    phone = _clean_phone_value(body.phone)
    gst_number = _clean_gst_value(body.gst_number)
    doc = {"id": str(uuid.uuid4()), "email": email, "name": body.name, "role": "dealer",
           "password_hash": hash_password(body.password),
        "gst_number": gst_number, "address": body.address, "phone": phone,
           "plan": body.plan, "plan_id": body.plan_id, "wallet_balance": float(body.wallet_balance),
           "dealer_code": dealer_code,
           "created_at": now_iso()}
    if body.plan_id:
        plan_doc = await db.plans.find_one({"id": body.plan_id}, {"_id": 0})
        if not plan_doc:
            raise HTTPException(status_code=400, detail="Invalid subscription plan selected")
        doc.update(_subscription_fields_for_plan(plan_doc))
    await db.users.insert_one(doc); return clean(doc)

@api.put("/admin/dealers/{did}")
async def update_dealer(did: str, body: DealerUpdate, _: dict = Depends(require_role("admin"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items() if k != "password"}
    if body.password: upd["password_hash"] = hash_password(body.password)
    if "phone" in upd:
        upd["phone"] = _clean_phone_value(upd["phone"])
    if "gst_number" in upd:
        upd["gst_number"] = _clean_gst_value(upd["gst_number"])
    if "plan_id" in upd:
        if upd["plan_id"]:
            plan_doc = await db.plans.find_one({"id": upd["plan_id"]}, {"_id": 0})
            if not plan_doc:
                raise HTTPException(status_code=400, detail="Invalid subscription plan selected")
            upd["plan"] = plan_doc.get("type", upd.get("plan", "cloud"))
            upd.update(_subscription_fields_for_plan(plan_doc))
        else:
            upd.pop("plan_started_at", None)
            upd.pop("plan_expires_at", None)
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.users.find_one_and_update({"id": did, "role": "dealer"}, {"$set": upd}, return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Dealer not found")
    return r

@api.delete("/admin/dealers/{did}")
async def delete_dealer(did: str, _: dict = Depends(require_role("admin"))):
    r = await db.users.delete_one({"id": did, "role": "dealer"})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Dealer not found")
    client_ids = [c["id"] for c in await db.clients.find({"dealer_id": did}, {"_id": 0, "id": 1}).to_list(1000)]
    await db.clients.delete_many({"dealer_id": did})
    await db.devices.delete_many({"client_id": {"$in": client_ids}})
    await db.templates.update_many({}, {"$pull": {"assigned_dealer_ids": did}})
    return {"ok": True}

@api.post("/admin/dealers/{did}/credit")
async def credit_dealer(did: str, body: CreditIn, _: dict = Depends(require_role("admin"))):
    r = await db.users.find_one_and_update({"id": did, "role": "dealer"}, {"$inc": {"wallet_balance": float(body.amount)}}, return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Dealer not found")
    return r

# ---------------- Admin: Templates ----------------
@api.get("/admin/templates")
async def list_templates_admin(_: dict = Depends(require_role("admin"))):
    return await db.templates.find({}, {"_id": 0}).to_list(1000)

@api.post("/admin/templates")
async def create_template(body: TemplateIn, _: dict = Depends(require_role("admin"))):
    doc = {"id": str(uuid.uuid4()), "name": body.name, "category": body.category,
           "description": body.description, "thumbnail_url": body.thumbnail_url,
           "plan": body.plan, "assigned_dealer_ids": body.assigned_dealer_ids,
           "layout": body.layout.model_dump(), "created_at": now_iso()}
    await db.templates.insert_one(doc); return clean(doc)

@api.put("/admin/templates/{tid}")
async def update_template(tid: str, body: TemplateUpdate, _: dict = Depends(require_role("admin"))):
    upd: Dict[str, Any] = {k: v for k, v in body.model_dump(exclude_none=True).items() if k != "layout"}
    if body.layout is not None: upd["layout"] = body.layout.model_dump()
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.templates.find_one_and_update({"id": tid}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Template not found")
    return r

@api.delete("/admin/templates/{tid}")
async def delete_template(tid: str, _: dict = Depends(require_role("admin"))):
    r = await db.templates.delete_one({"id": tid})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Template not found")
    await db.clients.update_many({}, {"$pull": {"assigned_template_ids": tid}})
    await db.devices.update_many({"template_id": tid}, {"$unset": {"template_id": ""}})
    return {"ok": True}

# ---------------- Admin: Clients (read-only) ----------------
@api.get("/admin/clients")
async def list_all_clients(_: dict = Depends(require_role("admin"))):
    docs = await db.clients.find({}, {"_id": 0, "password_hash": 0}).to_list(2000)
    dealers = {d["id"]: d["name"] for d in await db.users.find({"role": "dealer"}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    for c in docs:
        c["dealer_name"] = dealers.get(c.get("dealer_id", ""), "")
        await _sync_client_wallet_status(c)
    return docs

# ---------------- Admin: Devices ----------------
@api.get("/admin/devices")
async def list_all_devices(_: dict = Depends(require_role("admin"))):
    docs = await db.devices.find({}, {"_id": 0}).to_list(2000)
    clients = {c["id"]: c["name"] for c in await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)}
    dealers = {d["id"]: d["name"] for d in await db.users.find({"role": "dealer"}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    for d in docs:
        d["client_name"] = clients.get(d.get("client_id", ""), "")
        d["dealer_name"] = dealers.get(d.get("dealer_id", ""), "")
    return docs

# ---------------- Admin: Stats ----------------
@api.get("/admin/stats")
async def admin_stats(_: dict = Depends(require_role("admin"))):
    dealers_count = await db.users.count_documents({"role": "dealer"})
    clients_count = await db.clients.count_documents({})
    templates_count = await db.templates.count_documents({})
    devices_count = await db.devices.count_documents({})
    plans_count = await db.plans.count_documents({})
    p = [{"$group": {"_id": None, "total": {"$sum": "$wallet_balance"}}}]
    w1 = await db.users.aggregate(p).to_list(1)
    w2 = await db.clients.aggregate(p).to_list(1)
    total_wallet = (w1[0]["total"] if w1 else 0) + (w2[0]["total"] if w2 else 0)
    plan_counts = {t: 0 for t in PLAN_TYPES}
    async for d in db.users.find({"role": "dealer"}, {"_id": 0, "plan": 1}):
        plan_counts[d.get("plan", "cloud")] = plan_counts.get(d.get("plan", "cloud"), 0) + 1
    return {"dealers": dealers_count, "clients": clients_count, "templates": templates_count,
            "devices": devices_count, "plans": plans_count,
            "total_wallet": round(total_wallet, 2), "plan_distribution": plan_counts}

# ---------------- Dealer: Clients ----------------
@api.get("/dealer/clients")
async def list_my_clients(user: dict = Depends(require_role("dealer"))):
    docs = await db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "password_hash": 0}).to_list(2000)
    for d in docs:
        d["dealer_name"] = user["name"]
        await _sync_client_wallet_status(d)
    return docs

@api.post("/dealer/clients")
async def create_client(body: ClientCreate, user: dict = Depends(require_role("dealer"))):
    email = body.email.lower()
    if await db.clients.find_one({"email": email}) or await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    # allow templates explicitly assigned to the dealer OR unassigned (global starter templates)
    dealer_tpl_filter = {"$or": [{"assigned_dealer_ids": user["id"]}, {"assigned_dealer_ids": {"$exists": True, "$size": 0}}, {"assigned_dealer_ids": {"$exists": False}}]}
    valid = set([t["id"] for t in await db.templates.find(dealer_tpl_filter, {"_id": 0, "id": 1}).to_list(1000)])
    safe = [t for t in body.assigned_template_ids if t in valid]
    # validate optional plan_id and resolve plan metadata
    plan_doc = None
    if body.plan_id:
        plan_doc = await db.plans.find_one({"id": body.plan_id}, {"_id": 0})
        if not plan_doc:
            raise HTTPException(status_code=400, detail="Invalid subscription plan selected")

    client_code = await gen_client_code()
    phone = _clean_phone_value(body.phone)
    gst_number = _clean_gst_value(body.gst_number)
    # If a specific subscription plan is chosen, set plan and plan_id accordingly.
    status = "pending"
    plan_value = body.plan
    if plan_doc:
        plan_value = plan_doc.get("type", plan_value)
        try:
            required = float(plan_doc.get("price", 0) or 0)
            wallet_balance = float(body.wallet_balance or 0)
            if required <= 0 or wallet_balance >= required:
                status = "active"
        except Exception:
            status = "pending"
    subscription_fields = _subscription_fields_for_plan(plan_doc) if plan_doc else {"plan_started_at": None, "plan_expires_at": None}

    doc = {"id": str(uuid.uuid4()), "name": body.name, "email": email,
           "password_hash": hash_password(body.password),
           "phone": phone, "gst_number": gst_number, "address": body.address,
           "plan": plan_value, "plan_id": body.plan_id, "vertical": body.vertical, "wallet_balance": float(body.wallet_balance),
           "dealer_id": user["id"], "dealer_name": user["name"],
           "client_code": client_code,
            "assigned_template_ids": safe, "doctor_profile": {}, "salon_profile": {},
           "status": status, "created_at": now_iso(), **subscription_fields}
    await db.clients.insert_one(doc); return clean(doc)

@api.put("/dealer/clients/{cid}")
async def update_client(cid: str, body: ClientUpdate, user: dict = Depends(require_role("dealer", allow_pending=True))):
    # dealer cannot transfer client to other dealer or change status via this endpoint
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items() if k not in ("password", "dealer_id")}
    if body.password: upd["password_hash"] = hash_password(body.password)
    # only allow specific status transitions by dealer
    if body.status and body.status not in ("active", "suspended"): upd.pop("status", None)
    if "phone" in upd:
        upd["phone"] = _clean_phone_value(upd["phone"])
    if "gst_number" in upd:
        upd["gst_number"] = _clean_gst_value(upd["gst_number"])
    plan_doc = None
    if "plan_id" in upd:
        if upd["plan_id"]:
            plan_doc = await db.plans.find_one({"id": upd["plan_id"]}, {"_id": 0})
            if not plan_doc:
                raise HTTPException(status_code=400, detail="Invalid subscription plan selected")
            upd["plan"] = plan_doc.get("type", upd.get("plan", "cloud"))
            upd.update(_subscription_fields_for_plan(plan_doc))
        else:
            upd["plan"] = body.plan or upd.get("plan", "cloud")
            upd.pop("plan_started_at", None)
            upd.pop("plan_expires_at", None)
    if body.assigned_template_ids is not None:
        dealer_tpl_filter = {"$or": [{"assigned_dealer_ids": user["id"]}, {"assigned_dealer_ids": {"$exists": True, "$size": 0}}, {"assigned_dealer_ids": {"$exists": False}}]}
        valid = set([t["id"] for t in await db.templates.find(dealer_tpl_filter, {"_id": 0, "id": 1}).to_list(1000)])
        upd["assigned_template_ids"] = [t for t in body.assigned_template_ids if t in valid]
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.clients.find_one_and_update({"id": cid, "dealer_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Client not found")
    if plan_doc:
        r["plan"] = plan_doc.get("type", r.get("plan", "cloud"))
    await _sync_client_wallet_status(r)
    r["dealer_name"] = user["name"]; return r

@api.delete("/dealer/clients/{cid}")
async def delete_client(cid: str, user: dict = Depends(require_role("dealer"))):
    r = await db.clients.delete_one({"id": cid, "dealer_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Client not found")
    await db.devices.delete_many({"client_id": cid})
    return {"ok": True}

@api.post("/dealer/clients/{cid}/credit")
async def credit_client(cid: str, body: CreditIn, user: dict = Depends(require_role("dealer"))):
    dealer = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not dealer or dealer.get("wallet_balance", 0) < float(body.amount):
        raise HTTPException(status_code=400, detail="Insufficient dealer wallet balance")
    r = await db.clients.find_one_and_update({"id": cid, "dealer_id": user["id"]}, {"$inc": {"wallet_balance": float(body.amount)}}, return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Client not found")
    await db.users.update_one({"id": user["id"]}, {"$inc": {"wallet_balance": -float(body.amount)}})
    await _sync_client_wallet_status(r)
    r["dealer_name"] = user["name"]; return r

@api.get("/dealer/templates")
async def list_my_templates(user: dict = Depends(require_role("dealer"))):
    # return templates assigned to this dealer, plus any unassigned (global) starter templates
    dealer_tpl_filter = {"$or": [{"assigned_dealer_ids": user["id"]}, {"assigned_dealer_ids": {"$exists": True, "$size": 0}}, {"assigned_dealer_ids": {"$exists": False}}]}
    return await db.templates.find(dealer_tpl_filter, {"_id": 0}).to_list(1000)

@api.get("/dealer/devices")
async def list_dealer_devices(user: dict = Depends(require_role("dealer"))):
    ids = [c["id"] for c in await db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "id": 1}).to_list(2000)]
    docs = await db.devices.find({"client_id": {"$in": ids}}, {"_id": 0}).to_list(2000)
    clients = {c["id"]: c["name"] for c in await db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(2000)}
    for d in docs: d["client_name"] = clients.get(d.get("client_id", ""), "")
    return docs

@api.get("/dealer/stats")
async def dealer_stats(user: dict = Depends(require_role("dealer"))):
    clients_count = await db.clients.count_documents({"dealer_id": user["id"]})
    # count templates assigned to dealer or unassigned (global)
    dealer_tpl_filter = {"$or": [{"assigned_dealer_ids": user["id"]}, {"assigned_dealer_ids": {"$exists": True, "$size": 0}}, {"assigned_dealer_ids": {"$exists": False}}]}
    templates_count = await db.templates.count_documents(dealer_tpl_filter)
    client_ids = [c["id"] for c in await db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "id": 1}).to_list(2000)]
    devices_count = await db.devices.count_documents({"client_id": {"$in": client_ids}})
    p = [{"$match": {"dealer_id": user["id"]}}, {"$group": {"_id": None, "total": {"$sum": "$wallet_balance"}}}]
    cw = await db.clients.aggregate(p).to_list(1)
    dealer = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1, "plan_id": 1, "plan": 1, "plan_started_at": 1, "plan_expires_at": 1})
    subscription_plan = None
    if dealer and dealer.get("plan_id"):
        subscription_plan = await db.plans.find_one({"id": dealer["plan_id"]}, {"_id": 0})
    plan_counts = {t: 0 for t in PLAN_TYPES}
    async for c in db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "plan": 1}):
        plan_counts[c.get("plan", "cloud")] = plan_counts.get(c.get("plan", "cloud"), 0) + 1
    return {"clients": clients_count, "templates": templates_count, "devices": devices_count,
            "wallet_balance": round(dealer.get("wallet_balance", 0) if dealer else 0, 2),
            "clients_wallet_total": round(cw[0]["total"] if cw else 0, 2),
            "plan_distribution": plan_counts,
            "subscription_plan": subscription_plan,
            "subscription_started_at": dealer.get("plan_started_at") if dealer else None,
            "subscription_expires_at": dealer.get("plan_expires_at") if dealer else None}

# ---------------- Client: Self / Devices / Templates / Storefront ----------------
@api.get("/client/me")
async def client_me(user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    if not c: raise HTTPException(status_code=404, detail="Client not found")
    return await hydrate_client(c)

@api.get("/client/stats")
async def client_stats(user: dict = Depends(require_role("client", allow_pending=True))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0})
    devices = await db.devices.count_documents({"client_id": user["id"]})
    paired = await db.devices.count_documents({"client_id": user["id"], "status": "paired"})
    tpls = len(c.get("assigned_template_ids", [])) if c else 0
    extras = {}
    if c and c.get("vertical") in ("doctor", "salon"):
        extras["appointments_today"] = await db.appointments.count_documents({"client_id": user["id"], "date": datetime.now(timezone.utc).date().isoformat()})
    elif c and c.get("vertical") == "retailer":
        extras["products"] = await db.products.count_documents({"client_id": user["id"]})
    elif c and c.get("vertical") == "society":
        extras["rooms"] = await db.rooms.count_documents({"client_id": user["id"]})

    limit_bytes, limit_gb, plan = await _get_client_storage_quota(c or {})
    used_bytes = await _get_media_usage_bytes(user["id"])
    used_gb = used_bytes / (1024 * 1024 * 1024)
    remaining_gb = max(0.0, limit_gb - used_gb) if limit_gb > 0 else 0.0
    state = await _client_funding_state(c or {})

    return {"devices": devices, "paired": paired, "templates": tpls,
            "wallet_balance": round(c.get("wallet_balance", 0) if c else 0, 2),
            "vertical": c.get("vertical", "general") if c else "general",
            "storage_used_gb": round(used_gb, 2),
            "storage_limit_gb": round(limit_gb, 2),
            "storage_remaining_gb": round(remaining_gb, 2),
            "storage_usage_pct": round((used_gb / limit_gb) * 100, 2) if limit_gb > 0 else 0,
            "plan_name": plan.get("name") if plan else "",
            "subscription_active": state["active"],
            "subscription_required_amount": state["required_amount"],
            "subscription_expires_at": state["expires"],
            **extras}

@api.get("/client/templates")
async def client_templates(user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "assigned_template_ids": 1})
    ids = c.get("assigned_template_ids", []) if c else []
    return await db.templates.find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)

@api.get("/client/devices")
async def list_client_devices(user: dict = Depends(require_role("client")), branch_id: Optional[str] = None):
    q = {"client_id": user["id"]}
    if branch_id:
        q["branch_id"] = branch_id
    devices = await db.devices.find(q, {"_id": 0}).to_list(2000)
    branch_ids = {str(device.get("branch_id") or "").strip() for device in devices if str(device.get("branch_id") or "").strip()}
    branch_map = {}
    if branch_ids:
        branches = await db.branches.find({"client_id": user["id"], "id": {"$in": list(branch_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        branch_map = {str(branch.get("id") or ""): branch.get("name") or branch.get("id") or "" for branch in branches}
    for device in devices:
        device["branch_name"] = branch_map.get(str(device.get("branch_id") or ""), "")
    return devices

@api.post("/client/devices")
async def create_device(body: DeviceCreate, user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "dealer_id": 1})
    branch_name = ""
    if body.branch_id:
        branch = await db.branches.find_one({"id": body.branch_id, "client_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
        if not branch:
            raise HTTPException(status_code=400, detail="Branch not assigned to you")
        branch_name = branch.get("name") or branch.get("id") or ""
    if body.playlist_id:
        playlist = await db.playlists.find_one({"id": body.playlist_id, "client_id": user["id"]}, {"_id": 0, "id": 1})
        if not playlist:
            raise HTTPException(status_code=400, detail="Playlist not assigned to you")
    pair_code = body.pair_code or gen_pair_code()
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "location": body.location,
        "pair_code": pair_code,
        "status": "unpaired",
        "client_id": user["id"],
        "dealer_id": c.get("dealer_id", ""),
        "template_id": body.template_id,
        "paired_at": None,
        "playlist_id": body.playlist_id or "",
        "orientation": body.orientation or "auto",
        "brightness": int(body.brightness or 100),
        "created_at": now_iso(),
        "branch_id": body.branch_id or "",
        "branch_name": branch_name,
    }
    await db.devices.insert_one(doc)
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="device_created", branch_id=doc.get("branch_id") or None))
    return clean(doc)


async def _unpair_device(device_filter: dict):
    device = await db.devices.find_one(device_filter, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.devices.update_one(
        {"id": device["id"]},
        {"$set": {"status": "unpaired", "last_seen": None}, "$unset": {"fingerprint": "", "paired_at": ""}},
    )
    return {"ok": True, "device_id": device["id"], "status": "unpaired"}

# Public: device requests a short-lived pairing code that must be entered in the client panel
@public_api.post("/pair/request")
async def pair_request(body: PairRequestIn):
    code = gen_pair_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    doc = {
        "code": code,
        "device_fingerprint": body.device_fingerprint,
        "device_name": body.device_name or "",
        "created_at": now_iso(),
        "expires_at": expires_at,
        "used": False,
    }
    await db.pairings.insert_one(doc)
    return {"pair_code": code, "expires_in_seconds": 15 * 60}


@public_api.get("/pair/status/{pair_code}")
async def pair_status(pair_code: str):
    pairing = await db.pairings.find_one({"code": pair_code})
    if not pairing:
        raise HTTPException(status_code=404, detail="Pair code not found")
    # return pairing status (used==true means client completed binding)
    return {
        "pair_code": pairing["code"],
        "used": bool(pairing.get("used", False)),
        "paired_device_id": pairing.get("paired_device_id", ""),
        "expires_at": pairing.get("expires_at"),
    }


# Client: complete pairing by supplying the code and selecting a device to bind
@api.post("/client/pair/complete")
async def client_pair_complete(body: PairCompleteIn, user: dict = Depends(require_role("client"))):
    return await _complete_device_pairing({"id": body.device_id, "client_id": user["id"]}, body.pair_code, body.device_id)


@api.post("/client/devices/{did}/unpair")
async def client_unpair_device(did: str, user: dict = Depends(require_role("client"))):
    return await _unpair_device({"id": did, "client_id": user["id"]})


@api.post("/dealer/pair/complete")
async def dealer_pair_complete(body: PairCompleteIn, user: dict = Depends(require_role("dealer"))):
    client_ids = [c["id"] for c in await db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "id": 1}).to_list(2000)]
    return await _complete_device_pairing({"id": body.device_id, "client_id": {"$in": client_ids}}, body.pair_code, body.device_id)


@api.post("/dealer/devices/{did}/unpair")
async def dealer_unpair_device(did: str, user: dict = Depends(require_role("dealer"))):
    return await _unpair_device({"id": did, "dealer_id": user["id"]})

@api.put("/client/devices/{did}")
async def update_device(did: str, body: DeviceUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "branch_id" in upd:
        if upd["branch_id"]:
            branch = await db.branches.find_one({"id": upd["branch_id"], "client_id": user["id"]}, {"_id": 0, "id": 1})
            if not branch:
                raise HTTPException(status_code=400, detail="Branch not assigned to you")
        else:
            upd["branch_id"] = ""
    if "template_id" in upd and upd["template_id"]:
        c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "assigned_template_ids": 1})
        if upd["template_id"] not in (c.get("assigned_template_ids") or []):
            raise HTTPException(status_code=400, detail="Template not assigned to you")
    if "playlist_id" in upd:
        if upd["playlist_id"]:
            playlist = await db.playlists.find_one({"id": upd["playlist_id"], "client_id": user["id"]}, {"_id": 0, "id": 1})
            if not playlist:
                raise HTTPException(status_code=400, detail="Playlist not assigned to you")
        else:
            upd["playlist_id"] = ""
    if "brightness" in upd:
        try:
            upd["brightness"] = max(0, min(100, int(upd["brightness"])))
        except Exception:
            upd.pop("brightness", None)
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    if "branch_id" in upd:
        upd["branch_name"] = ""
        if upd["branch_id"]:
            branch = await db.branches.find_one({"id": upd["branch_id"], "client_id": user["id"]}, {"_id": 0, "name": 1, "id": 1})
            upd["branch_name"] = branch.get("name") or branch.get("id") or ""
    r = await db.devices.find_one_and_update({"id": did, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Device not found")
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="device_updated", branch_id=r.get("branch_id") or None))
    return r

@api.delete("/client/devices/{did}")
async def delete_device(did: str, user: dict = Depends(require_role("client"))):
    r = await db.devices.delete_one({"id": did, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Device not found")
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="device_deleted"))
    return {"ok": True}

@api.get("/client/devices/{did}/zones")
async def get_device_zones(did: str, user: dict = Depends(require_role("client"))):
    """Get template zones for a specific device."""
    device = await db.devices.find_one({"id": did, "client_id": user["id"]}, {"_id": 0, "template_id": 1})
    if not device: raise HTTPException(status_code=404, detail="Device not found")
    
    template_id = device.get("template_id")
    if not template_id:
        # If no template assigned, return empty zones (fall back to legacy zones)
        return {"zones": [], "legacy_zones": ["main", "sidebar", "ticker"]}
    
    template = await db.templates.find_one({"id": template_id}, {"_id": 0, "layout": 1})
    if not template:
        return {"zones": [], "legacy_zones": ["main", "sidebar", "ticker"]}
    
    layout = template.get("layout", {})
    zones = layout.get("zones", [])
    
    # If no zones defined in template, fall back to legacy zones
    if not zones:
        legacy = []
        if layout.get("main"): legacy.append({"id": "main", "name": layout.get("main", "Main")})
        if layout.get("sidebar"): legacy.append({"id": "sidebar", "name": layout.get("sidebar", "Sidebar")})
        if layout.get("ticker"): legacy.append({"id": "ticker", "name": layout.get("ticker", "Ticker")})
        if not legacy:
            # Default fallback
            legacy = [
                {"id": "main", "name": "Main"},
                {"id": "sidebar", "name": "Sidebar"},
                {"id": "ticker", "name": "Ticker"}
            ]
        return {"zones": [], "legacy_zones": [z["id"] for z in legacy], "legacy_zone_names": {z["id"]: z["name"] for z in legacy}}

    return {"zones": zones, "legacy_zones": []}


@public_api.get("/rss")
async def public_rss(url: str):
    """Proxy an RSS/Atom feed so the player can render ticker headlines without CORS issues."""
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        r = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0 SignageOS"})
        r.raise_for_status()
        root = ET.fromstring(r.text)
        items = []
        for node in root.findall(".//item"):
            title = (node.findtext("title") or "").strip()
            link = (node.findtext("link") or "").strip()
            if title:
                items.append({"title": title, "link": link})
        if not items:
            for entry in root.findall(".//{http://www.w3.org/2005/Atom}entry"):
                title = (entry.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
                link_node = entry.find("{http://www.w3.org/2005/Atom}link")
                link = (link_node.attrib.get("href") if link_node is not None else "") or ""
                if title:
                    items.append({"title": title, "link": link})
        return {"items": items[:50]}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"RSS fetch failed: {exc}")

# ----------- Doctor / Salon vertical -----------
async def _update_service_profile(vertical: str, body: DoctorProfile, user: dict):
    field = _service_profile_field(vertical)
    existing = await db.clients.find_one({"id": user["id"], "vertical": vertical}, {"_id": 0, field: 1})
    current = existing.get(field, {}) if existing else {}
    merged = {**(current or {}), **body.model_dump()}
    r = await db.clients.find_one_and_update(
        {"id": user["id"], "vertical": vertical},
        {"$set": {field: merged}},
        return_document=True,
        projection={"_id": 0, "password_hash": 0},
    )
    if not r:
        raise HTTPException(status_code=403, detail=f"Not a {_service_label(vertical).lower()} account")
    return r.get(field, {})


async def _update_branch_service_profile(vertical: str, body: DoctorProfile, user: dict, branch_id: str):
    field = _service_profile_field(vertical)
    branch = await db.branches.find_one({"id": branch_id, "client_id": user["id"]}, {"_id": 0, "profile": 1})
    if not branch:
        # If the branch exists in memory/state but not in this collection yet, create a minimal record.
        branch = {"id": branch_id, "client_id": user["id"], "profile": {}}
        await db.branches.insert_one({"id": branch_id, "client_id": user["id"], "name": branch_id, "created_at": now_iso(), "profile": {}})
    current = branch.get("profile", {}) or {}
    merged = {**current, **body.model_dump()}
    await db.branches.update_one({"id": branch_id, "client_id": user["id"]}, {"$set": {"profile": merged, "profile_type": field}})
    return merged


async def _list_service_appointments(user: dict):
    appointments = await db.appointments.find({"client_id": user["id"]}, {"_id": 0}).to_list(500)
    return sorted(
        appointments,
        key=lambda item: (
            _appointment_status_rank(item.get("status")),
            int(item.get("token") or 0),
            item.get("created_at") or "",
        ),
    )


async def _build_service_appointment_board(client_id: str, recent_limit: int = 500, branch_id: Optional[str] = None) -> Dict[str, Any]:
    today = _app_now().date().isoformat()
    base_query = {"client_id": client_id}
    if branch_id:
        base_query["branch_id"] = branch_id
    branches = await db.branches.find({"client_id": client_id}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    branch_name_map = {str(item.get("id") or ""): str(item.get("name") or "").strip() for item in branches if item.get("id")}
    if branch_id and branch_id not in branch_name_map:
        branch_name_map[branch_id] = "Branch"
    today_items = await db.appointments.find({**base_query, "date": today}, {"_id": 0}).to_list(1000)
    recent_items = await db.appointments.find(base_query, {"_id": 0}).sort("created_at", -1).to_list(max(20, recent_limit))

    def _decorate(item: Dict[str, Any]) -> Dict[str, Any]:
        branch_label = str(item.get("branch_id") or "").strip()
        return {**item, "branch_name": branch_name_map.get(branch_label, "Global" if not branch_label else branch_label)}

    def _queue_time_value(value: Any) -> float:
        if not value:
            return 0.0
        text = str(value)
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    def _queue_sort_key(item: Dict[str, Any]):
        status_rank = _appointment_status_rank(item.get("status"))
        if str(item.get("status") or "").lower() == "called":
            timestamp = item.get("recalled_at") or item.get("called_at") or item.get("updated_at") or item.get("created_at")
            return (status_rank, -_queue_time_value(timestamp), int(item.get("token") or 0))
        return (status_rank, int(item.get("token") or 0), item.get("created_at") or "")

    live_queue = sorted(
        [_decorate(item) for item in today_items if item.get("status") in ("called", "pending")],
        key=_queue_sort_key,
    )

    today_bookings = sorted(
        [_decorate(item) for item in today_items],
        key=lambda item: (
            int(item.get("token") or 0),
            _appointment_status_rank(item.get("status")),
            item.get("created_at") or "",
        ),
    )

    today_counts: Dict[str, int] = {"pending": 0, "called": 0, "done": 0, "cancelled": 0}
    for item in today_bookings:
        key = str(item.get("status") or "").lower()
        if key in today_counts:
            today_counts[key] += 1

    return {
        "date": today,
        "live_queue": live_queue,
        "today_bookings": today_bookings,
        "recent_bookings": [_decorate(item) for item in recent_items],
        "summary": {
            "live_queue_count": len(live_queue),
            "today_bookings_count": len(today_bookings),
            "today_status": today_counts,
        },
    }


async def _resolve_booking_route(client_id: str, booking_location: Optional[str], booking_device_id: Optional[str], branch_id: Optional[str] = None) -> Dict[str, str]:
    device_query: Dict[str, Any] = {"client_id": client_id}
    if branch_id:
        device_query["branch_id"] = branch_id
    devices = await db.devices.find(
        device_query,
        {"_id": 0, "id": 1, "name": 1, "location": 1, "status": 1},
    ).to_list(1000)

    active_devices = [d for d in devices if str(d.get("status") or "").lower() != "unpaired"] or devices
    requested_location = str(booking_location or "").strip()
    requested_device_id = str(booking_device_id or "").strip()

    if requested_device_id:
        matched_device = next((d for d in active_devices if str(d.get("id")) == requested_device_id), None)
        if not matched_device:
            raise HTTPException(status_code=400, detail="Invalid booking device for this provider")
        return {
            "route_strategy": "device_id",
            "requested_booking_location": requested_location,
            "requested_booking_device_id": requested_device_id,
            "routed_device_id": str(matched_device.get("id") or ""),
            "routed_device_name": str(matched_device.get("name") or ""),
            "routed_location": str(matched_device.get("location") or requested_location or ""),
        }

    if requested_location:
        needle = requested_location.lower()
        exact = next((d for d in active_devices if str(d.get("location") or "").strip().lower() == needle), None)
        contains = next(
            (
                d for d in active_devices
                if needle in str(d.get("location") or "").strip().lower()
                or str(d.get("location") or "").strip().lower() in needle
            ),
            None,
        )
        matched_device = exact or contains
        if matched_device:
            return {
                "route_strategy": "location_match",
                "requested_booking_location": requested_location,
                "requested_booking_device_id": requested_device_id,
                "routed_device_id": str(matched_device.get("id") or ""),
                "routed_device_name": str(matched_device.get("name") or ""),
                "routed_location": str(matched_device.get("location") or requested_location or ""),
            }

    default_device = active_devices[0] if active_devices else None
    if default_device:
        return {
            "route_strategy": "default_device",
            "requested_booking_location": requested_location,
            "requested_booking_device_id": requested_device_id,
            "routed_device_id": str(default_device.get("id") or ""),
            "routed_device_name": str(default_device.get("name") or ""),
            "routed_location": str(default_device.get("location") or requested_location or ""),
        }

    return {
        "route_strategy": "unrouted",
        "requested_booking_location": requested_location,
        "requested_booking_device_id": requested_device_id,
        "routed_device_id": "",
        "routed_device_name": "",
        "routed_location": requested_location,
    }


async def _set_service_appointment_status(aid: str, status: str, user: dict):
    current = await db.appointments.find_one({"id": aid, "client_id": user["id"]}, {"_id": 0, "status": 1, "recall_count": 1, "branch_id": 1})
    if not current:
        raise HTTPException(status_code=404, detail="Appointment not found")

    update: Dict[str, Any] = {"status": status, "updated_at": now_iso()}
    if status == "called" and current.get("status") == "called":
        update["recalled_at"] = now_iso()
        update["recall_count"] = int(current.get("recall_count") or 0) + 1
    elif status == "called":
        update["called_at"] = now_iso()

    r = await db.appointments.find_one_and_update(
        {"id": aid, "client_id": user["id"]},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not r:
        raise HTTPException(status_code=404, detail="Appointment not found")
    # Broadcast immediately with an announcement when called, avoid expensive snapshot building
    try:
        payload = {"type": "queue_signal", "client_id": user["id"], "reason": f"status:{status}", "timestamp": now_iso(), "transient": True}
        if status == "called":
            token = str(r.get("token") or "").strip()
            recall_count = int(r.get("recall_count") or 0)
            is_recall = recall_count > 0 or bool(r.get("recalled_at"))
            if token:
                key = f"{token}:called:{recall_count}:{r.get('recalled_at','') }"
                text = (
                    f"Recall for token {token}. Please return to the counter." if is_recall
                    else f"Token {token}, please proceed to the counter."
                )
                payload["announcement"] = {"key": key, "text": text}
                logging.getLogger('uvicorn.error').info(
                    f"queue announcement prepared client={user['id']} branch={await _resolve_appointment_scope_branch(user['id'], r)} token={token} recall={is_recall} text={text}"
                )
        payload["sent_at"] = now_iso()
        try:
            branch_id = await _resolve_appointment_scope_branch(user["id"], r)
            asyncio.create_task(queue_ws_manager.broadcast(user["id"], payload, branch_id=branch_id))
            logging.getLogger('uvicorn.error').info(f"queue announcement broadcast scheduled client={user['id']} branch={branch_id} token={token if status == 'called' else ''}")
        except Exception:
            branch_id = await _resolve_appointment_scope_branch(user["id"], r)
            await queue_ws_manager.broadcast(user["id"], payload, branch_id=branch_id)
        # Follow up with a normal refresh so the player eventually syncs the full queue snapshot.
        asyncio.create_task(_broadcast_queue_refresh(user["id"], reason=f"status:{status}", branch_id=await _resolve_appointment_scope_branch(user["id"], r)))
    except Exception:
        # Fallback to existing broadcast path if direct send fails
        await _broadcast_queue_refresh(user["id"], reason=f"status:{status}", branch_id=await _resolve_appointment_scope_branch(user["id"], r))
    return r


@api.put("/client/doctor/profile")
async def update_doc_profile(body: DoctorProfile, user: dict = Depends(require_role("client")), branch_id: Optional[str] = None):
    if branch_id:
        return await _update_branch_service_profile("doctor", body, user, branch_id)
    return await _update_service_profile("doctor", body, user)


@api.put("/client/salon/profile")
async def update_salon_profile(body: DoctorProfile, user: dict = Depends(require_role("client")), branch_id: Optional[str] = None):
    if branch_id:
        return await _update_branch_service_profile("salon", body, user, branch_id)
    return await _update_service_profile("salon", body, user)


@api.get("/client/doctor/appointments")
async def list_appointments(user: dict = Depends(require_role("client"))):
    return await _list_service_appointments(user)


@api.get("/client/salon/appointments")
async def list_salon_appointments(user: dict = Depends(require_role("client"))):
    return await _list_service_appointments(user)


@api.get("/client/{vertical}/appointments/board")
async def get_service_appointment_board(vertical: Literal["doctor", "salon"], user: dict = Depends(require_role("client")), branch_id: Optional[str] = None):
    c = await db.clients.find_one({"id": user["id"], "vertical": vertical}, {"_id": 0, "id": 1})
    if not c:
        raise HTTPException(status_code=403, detail=f"Not a {_service_label(vertical).lower()} account")
    return await _build_service_appointment_board(user["id"], branch_id=branch_id)


@api.post("/client/doctor/appointments/{aid}/status")
async def set_apt_status(aid: str, status: Literal["pending", "called", "done", "cancelled"], user: dict = Depends(require_role("client"))):
    return await _set_service_appointment_status(aid, status, user)


@api.post("/client/salon/appointments/{aid}/status")
async def set_salon_apt_status(aid: str, status: Literal["pending", "called", "done", "cancelled"], user: dict = Depends(require_role("client"))):
    return await _set_service_appointment_status(aid, status, user)

# ----------- Retailer vertical -----------
@api.get("/client/products")
async def list_products(user: dict = Depends(require_role("client"))):
    return await db.products.find({"client_id": user["id"]}, {"_id": 0}).to_list(1000)

@api.post("/client/products")
async def create_product(body: ProductIn, user: dict = Depends(require_role("client"))):
    doc = {"id": str(uuid.uuid4()), "client_id": user["id"], **body.model_dump(), "created_at": now_iso()}
    await db.products.insert_one(doc); return clean(doc)

@api.put("/client/products/{pid}")
async def update_product(pid: str, body: ProductUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.products.find_one_and_update({"id": pid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Product not found")
    return r

@api.delete("/client/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_role("client"))):
    r = await db.products.delete_one({"id": pid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}

# ----------- Society vertical -----------
@api.get("/client/rooms")
async def list_rooms(user: dict = Depends(require_role("client"))):
    return await db.rooms.find({"client_id": user["id"]}, {"_id": 0}).sort("room_no", 1).to_list(1000)

@api.post("/client/rooms")
async def create_room(body: RoomIn, user: dict = Depends(require_role("client"))):
    room_no_norm = normalize_room_no(body.room_no)
    # prevent duplicates for same client
    exists = await db.rooms.find_one({"client_id": user["id"], "room_no_norm": room_no_norm})
    if exists:
        raise HTTPException(status_code=400, detail="Room/Flat number already exists")
    doc = {"id": str(uuid.uuid4()), "client_id": user["id"], **body.model_dump(), "room_no_norm": room_no_norm, "created_at": now_iso()}
    await db.rooms.insert_one(doc); return clean(doc)

@api.put("/client/rooms/{rid}")
async def update_room(rid: str, body: RoomUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    if upd.get("room_no"):
        room_no_norm = normalize_room_no(upd.get("room_no"))
        exists = await db.rooms.find_one({"client_id": user["id"], "room_no_norm": room_no_norm, "id": {"$ne": rid}})
        if exists:
            raise HTTPException(status_code=400, detail="Room/Flat number already exists")
        upd["room_no_norm"] = room_no_norm
    r = await db.rooms.find_one_and_update({"id": rid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Room not found")
    return r

@api.delete("/client/rooms/{rid}")
async def delete_room(rid: str, user: dict = Depends(require_role("client"))):
    r = await db.rooms.delete_one({"id": rid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Room not found")
    return {"ok": True}


@api.get("/client/notices")
async def list_notices(user: dict = Depends(require_role("client"))):
    return await db.notices.find({"client_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/client/notices")
async def create_notice(body: NoticeIn, user: dict = Depends(require_role("client"))):
    doc = {"id": str(uuid.uuid4()), "client_id": user["id"], **body.model_dump(), "created_at": now_iso()}
    await db.notices.insert_one(doc)
    return clean(doc)


@api.put("/client/notices/{nid}")
async def update_notice(nid: str, body: NoticeUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.notices.find_one_and_update({"id": nid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Notice not found")
    return r


@api.delete("/client/notices/{nid}")
async def delete_notice(nid: str, user: dict = Depends(require_role("client"))):
    r = await db.notices.delete_one({"id": nid, "client_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notice not found")
    return {"ok": True}

# ---------------- Public: Doctor / Salon booking ----------------
async def _public_service_profile(cid: str, branch_id: Optional[str] = None):
    c = await db.clients.find_one({"id": cid}, {"_id": 0, "password_hash": 0, "wallet_balance": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Provider not found")
    vertical = c.get("vertical", "general")
    branch_profile = {}
    if branch_id:
        branch = await db.branches.find_one({"id": branch_id, "client_id": cid}, {"_id": 0})
        if branch:
            branch_profile = branch.get("profile") or {}
    empty_profile = {
        "specialty": "",
        "qualifications": "",
        "fee": 0,
        "hours": "",
        "is_open": True,
        "image_url": "",
        "description": "",
        "slot_minutes": 15,
        "services": [],
    }
    base = {
        "id": c["id"],
        "name": c["name"],
        "vertical": vertical,
        "timezone": APP_TIMEZONE,
        "phone": c.get("phone", ""),
        "address": c.get("address", ""),
        "weather": _resolve_weather_snapshot(c.get("address", "")),
    }

    # Doctor / Salon: include profile and live queue
    if vertical in ("doctor", "salon"):
        profile_field = _service_profile_field(vertical)
        if branch_id:
            profile = _normalize_service_catalog(branch_profile or empty_profile, vertical)
        else:
            profile = _normalize_service_catalog(c.get(profile_field, {}) or empty_profile, vertical)
        board = await _build_service_appointment_board(cid, recent_limit=200, branch_id=branch_id)
        active = board.get("live_queue") or []
        today_bookings = board.get("today_bookings") or []
        dev_q = {"client_id": cid}
        if branch_id:
            dev_q["branch_id"] = branch_id
        devices = await db.devices.find(dev_q, {"_id": 0, "id": 1, "name": 1, "location": 1, "status": 1}).to_list(200)
        booking_devices = [
            {
                "id": str(item.get("id") or ""),
                "name": item.get("name") or "",
                "location": item.get("location") or "",
                "status": item.get("status") or "",
            }
            for item in devices
            if item.get("id")
        ]
        booking_locations = sorted({str(item.get("location") or "").strip() for item in devices if str(item.get("location") or "").strip()})
        queue_minutes = 0
        queue_preview = []
        for item in active:
            duration = int(item.get("service_duration_mins") or profile.get("slot_minutes", 15) or 15)
            display_time = item.get("assigned_time") or item.get("preferred_time") or ""
            queue_preview.append({
                "token": item.get("token"),
                "patient_name": item.get("patient_name", ""),
                "patient_phone": item.get("patient_phone", ""),
                "service_name": item.get("service_name", ""),
                "service_type": item.get("service_name", ""),
                "service_duration_mins": duration,
                "preferred_time": item.get("preferred_time", ""),
                "assigned_time": display_time,
                "source": item.get("source", "public"),
                "status": item.get("status", "pending"),
                "recall_count": item.get("recall_count", 0),
                "called_at": item.get("called_at", ""),
                "recalled_at": item.get("recalled_at", ""),
                "updated_at": item.get("updated_at", ""),
                "routed_location": item.get("routed_location", ""),
                "routed_device_name": item.get("routed_device_name", ""),
                "wait_after_mins": queue_minutes,
            })
            queue_minutes += max(5, duration)
        return {
            **base,
            "profile": profile,
            "queue_length": len(active),
            "queue_total_minutes": queue_minutes,
            "queue_preview": queue_preview[:8],
            "live_queue": active,
            "today_bookings_count": len(today_bookings),
            "today_bookings_preview": today_bookings[:8],
            "today_bookings": today_bookings,
            "booking_locations": booking_locations,
            "booking_devices": booking_devices,
            "subscription": await _resolve_storage_plan_for_client(c) or None,
        }

    # Retailer: include product catalog
    if vertical == "retailer":
        products = await db.products.find({"client_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return {**base, "products": products}

    # Society: include notices and rooms
    if vertical == "society":
        notices = await db.notices.find({"client_id": cid, "is_deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(500)
        rooms = await db.rooms.find({"client_id": cid}, {"_id": 0}).sort("room_no", 1).to_list(1000)
        return {**base, "notices": notices, "rooms": rooms}

    # Default generic provider
    return base


async def _resolve_service_snapshot(profile: dict, body: AppointmentCreate):
    services = profile.get("services") or []
    chosen = None
    if body.service_id:
      chosen = next((s for s in services if str(s.get("id", "")) == str(body.service_id)), None)
    if not chosen and body.service_name:
      chosen = next((s for s in services if (s.get("name") or "").strip().lower() == body.service_name.strip().lower()), None)
    if not chosen and services:
      chosen = services[0]
    return chosen or {}


async def _resolve_service_snapshots(profile: dict, body: AppointmentCreate) -> List[dict]:
    services = profile.get("services") or []
    selected: List[dict] = []

    if body.service_ids:
        for sid in [str(sid) for sid in body.service_ids if sid]:
            found = next((s for s in services if str(s.get("id", "")) == sid), None)
            if found:
                selected.append(found)

    if not selected:
        single = await _resolve_service_snapshot(profile, body)
        if single:
            selected = [single]

    if not selected:
        selected = [{
            "id": body.service_id or "",
            "name": body.service_name or "Service",
            "price": float(body.service_price or 0),
            "duration_mins": int(profile.get("slot_minutes", 15) or 15),
            "image_url": "",
        }]

    return selected


async def _book_service(cid: str, body: AppointmentCreate, source: Optional[str] = None, branch_id: Optional[str] = None):
    patient_name = str(body.patient_name or "").strip()
    if len(patient_name) < 2:
        raise HTTPException(status_code=400, detail="Patient name must be at least 2 characters")
    phone_digits = re.sub(r"\D", "", str(body.patient_phone or ""))
    if len(phone_digits) < 10 or len(phone_digits) > 15:
        raise HTTPException(status_code=400, detail="Patient phone must be 10 to 15 digits")

    c = await db.clients.find_one({"id": cid, "vertical": {"$in": ["doctor", "salon"]}}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Service provider not found")
    profile = _normalize_service_catalog(c.get(_service_profile_field(c.get("vertical", "doctor")), {}), c.get("vertical", "doctor"))
    service_items = await _resolve_service_snapshots(profile, body)
    primary_service = service_items[0] if service_items else {}
    combined_duration = sum(max(5, int(item.get("duration_mins") or profile.get("slot_minutes", 15) or 15)) for item in service_items)
    combined_price = float(sum(float(item.get("price") or 0) for item in service_items))
    dedup_names: List[str] = []
    for item in service_items:
        name = str(item.get("name") or "").strip()
        if name and name.lower() not in {n.lower() for n in dedup_names}:
            dedup_names.append(name)
    service_name_label = " + ".join(dedup_names) if dedup_names else (body.service_name or "Service")

    today = _app_now().date().isoformat()
    slot_info = await _assign_next_available_time(
        cid,
        today,
        body.preferred_time,
        int(combined_duration or c.get(_service_profile_field(c.get("vertical", "doctor")), {}).get("slot_minutes", 15) or 15),
        branch_id=branch_id,
    )
    counter = await db.counters.find_one_and_update(
        {"_id": f"appointment_token:{cid}:{branch_id or 'global'}:{today}"},
        {"$inc": {"next": 1}},
        upsert=True,
        return_document=True,
    )
    token = int(counter.get("next", 1))
    patient_phone_key = _normalize_patient_phone_key(body.patient_phone)
    route_info = await _resolve_booking_route(cid, body.booking_location, body.booking_device_id, branch_id=branch_id)
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": cid,
        "branch_id": branch_id or "",
        "date": today,
        "token": token,
        "patient_name": patient_name,
        "patient_phone": body.patient_phone,
        "patient_phone_key": patient_phone_key,
        "notes": body.notes,
        "preferred_time": body.preferred_time,
        "requested_time": slot_info["requested_time"],
        "assigned_time": slot_info["assigned_time"],
        "assigned_time_minutes": slot_info["assigned_time_minutes"],
        "service_id": primary_service.get("id", body.service_id or ""),
        "service_ids": [str(item.get("id", "")) for item in service_items if item.get("id")],
        "service_name": service_name_label,
        "service_items": [
            {
                "id": str(item.get("id", "")),
                "name": item.get("name", ""),
                "price": float(item.get("price") or 0),
                "duration_mins": int(item.get("duration_mins") or 0),
                "image_url": item.get("image_url", ""),
            }
            for item in service_items
        ],
        "service_price": combined_price,
        "service_duration_mins": int(combined_duration or c.get(_service_profile_field(c.get("vertical", "doctor")), {}).get("slot_minutes", 15) or 15),
        "service_image_url": primary_service.get("image_url", ""),
        "booking_location": route_info.get("requested_booking_location", ""),
        "booking_device_id": route_info.get("requested_booking_device_id", ""),
        "routed_location": route_info.get("routed_location", ""),
        "routed_device_id": route_info.get("routed_device_id", ""),
        "routed_device_name": route_info.get("routed_device_name", ""),
        "route_strategy": route_info.get("route_strategy", "unrouted"),
        "source": source or body.source,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.appointments.insert_one(doc)
    if c.get("vertical") == "doctor":
        await _upsert_clinic_patient(cid, body.patient_phone, body.patient_name)
    await _broadcast_queue_refresh(cid, reason="booked")
    return clean(doc)


@public_api.get("/providers/{cid}")
async def public_provider_profile(cid: str):
    client = await _resolve_public_client_ref(cid)
    return await _public_service_profile(client["id"])


@public_api.get("/providers/{cid}/branches/{bid}")
async def public_provider_branch_profile(cid: str, bid: str):
    client = await _resolve_public_client_ref(cid)
    return await _public_service_profile(client["id"], branch_id=bid)


@public_api.post("/providers/{cid}/book")
async def public_provider_book(cid: str, body: AppointmentCreate):
    client = await _resolve_public_client_ref(cid)
    return await _book_service(client["id"], body, source="public")


@public_api.post("/providers/{cid}/branches/{bid}/book")
async def public_provider_branch_book(cid: str, bid: str, body: AppointmentCreate):
    client = await _resolve_public_client_ref(cid)
    return await _book_service(client["id"], body, source="public", branch_id=bid)


@public_api.get("/doctors/{cid}")
async def public_doctor_profile(cid: str):
    return await _public_service_profile(cid)


@public_api.get("/doctors/{cid}/branches/{bid}")
async def public_doctor_branch_profile(cid: str, bid: str):
    return await _public_service_profile(cid, branch_id=bid)


@public_api.post("/doctors/{cid}/book")
async def public_doctor_book(cid: str, body: AppointmentCreate):
    return await _book_service(cid, body, source="public")


@public_api.post("/doctors/{cid}/branches/{bid}/book")
async def public_doctor_branch_book(cid: str, bid: str, body: AppointmentCreate):
    return await _book_service(cid, body, source="public", branch_id=bid)


@api.post("/client/{vertical}/appointments")
async def create_service_appointment(vertical: Literal["doctor", "salon"], body: AppointmentCreate, user: dict = Depends(require_role("client")), branch_id: Optional[str] = None):
    c = await db.clients.find_one({"id": user["id"], "vertical": vertical}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=403, detail=f"Not a {_service_label(vertical).lower()} account")
    body.source = "manual"
    return await _book_service(user["id"], body, source="manual", branch_id=branch_id)


@api.websocket("/ws/queue/{pair_code}")
async def queue_updates_socket(websocket: WebSocket, pair_code: str):
    # Accept first so handshake failures don't surface as HTTP 404s through proxies.
    try:
        await websocket.accept()
    except Exception:
        return

    device = await db.devices.find_one({"pair_code": pair_code}, {"_id": 0, "client_id": 1, "branch_id": 1})
    client_id = str(device.get("client_id") or "") if device else ""
    branch_id = str(device.get("branch_id") or "") if device else ""
    if not client_id:
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return

    # Perform a small subscribe handshake before registering to avoid
    # storing transient connections that immediately close.

    # log remote for diagnostics
    try:
        client_info = getattr(websocket, 'client', None)
        logging.getLogger('uvicorn.error').debug(f"queue socket accept for pair={pair_code} client={client_info}")
    except Exception:
        pass

    subscribed = False
    # limit concurrent registered sockets per client to avoid churn
    try:
        existing = len(queue_ws_manager._connections.get(_scope_key(client_id, branch_id), set()))
        MAX_ALLOWED = 2
        if existing >= MAX_ALLOWED:
            try:
                await websocket.close(code=1013)
            except Exception:
                pass
            logging.getLogger('uvicorn.error').warning(f"queue socket rejected: too many connections for client {client_id} branch={branch_id} (existing={existing})")
            return
    except Exception:
        pass
    try:
        # wait briefly for a subscribe message from client; if none arrives, still register
        try:
            msg = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            try:
                import json
                parsed = json.loads(msg or "{}")
                if parsed.get("type") == "subscribe":
                    queue_ws_manager.register(client_id, websocket, branch_id=branch_id)
                    subscribed = True
            except Exception:
                # ignore parse errors
                pass
        except asyncio.TimeoutError:
            # no handshake received; register anyway
            queue_ws_manager.register(client_id, websocket, branch_id=branch_id)
            subscribed = True

        # send an initial snapshot if available
        initial_snapshot = await _build_queue_announcement_snapshot(client_id, branch_id=branch_id)
        if initial_snapshot:
            try:
                await websocket.send_json({"type": "queue_snapshot", "client_id": client_id, "branch_id": branch_id, "timestamp": now_iso(), **initial_snapshot})
            except Exception:
                pass

        # keep receiving until disconnect; ignore payloads
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if subscribed:
            queue_ws_manager.disconnect(client_id, websocket, branch_id=branch_id)
    except Exception:
        if subscribed:
            queue_ws_manager.disconnect(client_id, websocket, branch_id=branch_id)


@api.websocket("/ws/content/{pair_code}")
async def content_updates_socket(websocket: WebSocket, pair_code: str):
    try:
        await websocket.accept()
    except Exception:
        return

    device = await db.devices.find_one({"pair_code": pair_code}, {"_id": 0, "client_id": 1, "branch_id": 1})
    client_id = str(device.get("client_id") or "") if device else ""
    branch_id = str(device.get("branch_id") or "") if device else ""
    if not client_id:
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return

    try:
        existing = len(content_ws_manager._connections.get(_scope_key(client_id, branch_id), set()))
        MAX_ALLOWED = 2
        if existing >= MAX_ALLOWED:
            try:
                await websocket.close(code=1013)
            except Exception:
                pass
            logging.getLogger('uvicorn.error').warning(f"content socket rejected: too many connections for client {client_id} branch={branch_id} (existing={existing})")
            return
    except Exception:
        pass

    subscribed = False
    try:
        try:
            msg = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            try:
                import json
                parsed = json.loads(msg or "{}")
                if parsed.get("type") == "subscribe":
                    content_ws_manager.register(client_id, websocket, branch_id=branch_id)
                    subscribed = True
            except Exception:
                pass
        except asyncio.TimeoutError:
            content_ws_manager.register(client_id, websocket, branch_id=branch_id)
            subscribed = True

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if subscribed:
            content_ws_manager.disconnect(client_id, websocket, branch_id=branch_id)
    except Exception:
        if subscribed:
            content_ws_manager.disconnect(client_id, websocket, branch_id=branch_id)


@api.get("/client/doctor/patients")
async def list_doctor_patients(search: Optional[str] = None, user: dict = Depends(require_role("client"))):
    client_doc = await db.clients.find_one({"id": user["id"], "vertical": "doctor"}, {"_id": 0, "id": 1})
    if not client_doc:
        raise HTTPException(status_code=403, detail="Not a doctor account")

    query: Dict[str, Any] = {"client_id": user["id"]}
    if search and str(search).strip():
        token = str(search).strip()
        digits = re.sub(r"\D", "", token)
        clauses = [{"name": {"$regex": re.escape(token), "$options": "i"}}]
        if digits:
            clauses.append({"phone_key": {"$regex": re.escape(digits[-10:])}})
            clauses.append({"contact_number": {"$regex": re.escape(digits)}})
        query["$or"] = clauses

    docs = await db.clinic_patients.find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return docs


@api.get("/client/doctor/patients/{contact_number}")
async def get_doctor_patient(contact_number: str, user: dict = Depends(require_role("client"))):
    client_doc = await db.clients.find_one({"id": user["id"], "vertical": "doctor"}, {"_id": 0, "id": 1})
    if not client_doc:
        raise HTTPException(status_code=403, detail="Not a doctor account")

    phone_key = _normalize_patient_phone_key(contact_number)
    patient = await db.clinic_patients.find_one({"client_id": user["id"], "phone_key": phone_key}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient


@api.get("/client/doctor/patients/{contact_number}/history")
async def get_doctor_patient_history(contact_number: str, user: dict = Depends(require_role("client"))):
    client_doc = await db.clients.find_one({"id": user["id"], "vertical": "doctor"}, {"_id": 0, "id": 1})
    if not client_doc:
        raise HTTPException(status_code=403, detail="Not a doctor account")

    phone_key = _normalize_patient_phone_key(contact_number)
    patient = await db.clinic_patients.find_one({"client_id": user["id"], "phone_key": phone_key}, {"_id": 0})
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    visits = await db.clinic_visits.find(
        {"client_id": user["id"], "patient_phone_key": phone_key},
        {"_id": 0},
    ).sort("visit_at", -1).to_list(1000)
    appointments = await db.appointments.find(
        {"client_id": user["id"], "patient_phone_key": phone_key},
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)
    return {
        "patient": patient,
        "appointments": appointments,
        "history": visits,
    }


@api.post("/client/doctor/patients/{contact_number}/visits")
async def create_doctor_patient_visit(contact_number: str, body: ClinicVisitCreate, user: dict = Depends(require_role("client"))):
    client_doc = await db.clients.find_one({"id": user["id"], "vertical": "doctor"}, {"_id": 0, "id": 1})
    if not client_doc:
        raise HTTPException(status_code=403, detail="Not a doctor account")

    phone_key = _normalize_patient_phone_key(contact_number)
    patient = await _upsert_clinic_patient(user["id"], contact_number, body.patient_name or "")
    visit = {
        "id": str(uuid.uuid4()),
        "client_id": user["id"],
        "patient_id": patient.get("id"),
        "patient_phone_key": phone_key,
        "patient_name": body.patient_name or patient.get("name", ""),
        "diagnosis": body.diagnosis,
        "symptoms": body.symptoms,
        "notes": body.notes,
        "medicines": [m.model_dump() for m in body.medicines],
        "follow_up_on": body.follow_up_on,
        "visit_at": now_iso(),
        "created_at": now_iso(),
    }
    await db.clinic_visits.insert_one(visit)
    await db.clinic_patients.update_one(
        {"client_id": user["id"], "phone_key": phone_key},
        {
            "$inc": {"history_count": 1},
            "$set": {"last_visit_at": visit["visit_at"], "updated_at": now_iso()},
        },
    )
    return clean(visit)


# ==================== Object Storage ====================
S3_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("S3_ACCESS_KEY_ID", "")
S3_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY") or os.environ.get("S3_SECRET_ACCESS_KEY", "")
S3_REGION = os.environ.get("AWS_REGION") or os.environ.get("S3_REGION", "ap-southeast-2")
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL", "https://xztrjsqymgyltfivpgdj.storage.supabase.co/storage/v1/s3")
SUPABASE_PROJECT_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://xztrjsqymgyltfivpgdj.supabase.co")
PUBLIC_APP_URL = os.environ.get("PUBLIC_APP_URL") or os.environ.get("FRONTEND_URL", "")
S3_BUCKET = os.environ.get("S3_BUCKET", "bucket")
APP_NAME = "signageos"
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"}
MAX_UPLOAD_MB = 50

_s3_client = None

def init_storage() -> Optional[str]:
    global _s3_client
    if not S3_ACCESS_KEY_ID or not S3_SECRET_ACCESS_KEY:
        logger.warning("S3 credentials missing; uploads disabled.")
        return None
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            aws_access_key_id=S3_ACCESS_KEY_ID,
            aws_secret_access_key=S3_SECRET_ACCESS_KEY,
            region_name=S3_REGION,
            endpoint_url=S3_ENDPOINT_URL,
            config=boto3.session.Config(s3={"addressing_style": "path"}),
        )
    try:
        _s3_client.head_bucket(Bucket=S3_BUCKET)
    except ClientError as e:
        status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status in (400, 404):
            create_args = {"Bucket": S3_BUCKET}
            if S3_REGION and S3_REGION != "us-east-1":
                create_args["CreateBucketConfiguration"] = {"LocationConstraint": S3_REGION}
            _s3_client.create_bucket(**create_args)
        else:
            raise
    return S3_BUCKET

def put_object(path: str, data: bytes, content_type: str) -> dict:
    client = _s3_client or init_storage()
    if not client:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    try:
        client.put_object(Bucket=S3_BUCKET, Key=path, Body=data, ContentType=content_type)
        return {"path": path, "public_url": f"{SUPABASE_PROJECT_URL}/storage/v1/object/public/{S3_BUCKET}/{path}"}
    except (ClientError, BotoCoreError) as e:
        raise HTTPException(status_code=503, detail=f"S3 upload failed: {e}")

def get_object(path: str):
    client = _s3_client or init_storage()
    if not client:
        raise HTTPException(status_code=503, detail="Storage unavailable")
    try:
        obj = client.get_object(Bucket=S3_BUCKET, Key=path)
        return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")
    except (ClientError, BotoCoreError) as e:
        raise HTTPException(status_code=503, detail=f"S3 read failed: {e}")

# ==================== Media ====================
async def _resolve_storage_plan_for_client(client: dict) -> Optional[dict]:
    """Resolve the effective subscription plan used for client storage quota checks."""
    if not client:
        return None

    candidate_ids = []
    if client.get("plan_id"):
        candidate_ids.append(client["plan_id"])
    dealer = None
    if client.get("dealer_id"):
        dealer = await db.users.find_one({"id": client["dealer_id"]}, {"_id": 0, "plan_id": 1, "plan": 1, "plan_expires_at": 1})
        if dealer:
            if dealer.get("plan_id"):
                candidate_ids.append(dealer["plan_id"])
            if dealer.get("plan"):
                candidate_ids.append(dealer["plan"])
    if client.get("plan"):
        candidate_ids.append(client["plan"])

    for candidate in candidate_ids:
        plan = await db.plans.find_one({"$or": [{"id": candidate}, {"type": candidate}]}, {"_id": 0})
        if plan:
            # if this plan comes from dealer assignment and dealer has an expiry, include it
            try:
                if dealer and dealer.get("plan_id") and candidate == dealer.get("plan_id") and dealer.get("plan_expires_at"):
                    plan = dict(plan)
                    plan["expires_at"] = dealer.get("plan_expires_at")
            except Exception:
                pass
            return plan
    return None


async def _get_media_usage_bytes(client_id: str) -> int:
    agg = await db.media.aggregate([
        {"$match": {"client_id": client_id, "is_deleted": False}},
        {"$group": {"_id": None, "total": {"$sum": "$size"}}},
    ]).to_list(1)
    return int(agg[0]["total"] if agg else 0)


async def _get_client_storage_quota(client: dict) -> tuple[int, float, Optional[dict]]:
    plan = await _resolve_storage_plan_for_client(client)
    limit_gb = float((plan or {}).get("storage_limit_gb", 0) or 0)
    return int(limit_gb * 1024 * 1024 * 1024), limit_gb, plan


async def _client_funding_state(client: dict) -> dict:
    plan = await _resolve_storage_plan_for_client(client or {})
    wallet_balance = float((client or {}).get("wallet_balance", 0) or 0)
    required_amount = float((plan or {}).get("price", 0) or 0)
    client_status = str((client or {}).get("status") or "").lower()
    expires = (plan or {}).get("expires_at") or (plan or {}).get("valid_till") or None
    expired = False
    if expires:
        try:
            exp_dt = datetime.fromisoformat(str(expires)) if isinstance(expires, str) else None
            expired = bool(exp_dt and exp_dt < datetime.now(timezone.utc))
        except Exception:
            expired = False
    funded = required_amount <= 0 or wallet_balance >= required_amount
    suspended = client_status == "suspended"
    active = funded and not expired and not suspended
    return {
        "plan": plan,
        "wallet_balance": wallet_balance,
        "required_amount": required_amount,
        "expires": expires,
        "expired": expired,
        "suspended": suspended,
        "client_status": client_status or None,
        "funded": funded,
        "active": active,
    }


async def _sync_client_wallet_status(client: dict) -> dict:
    if not client:
        return client
    if client.get("status") == "suspended":
        return client
    state = await _client_funding_state(client)
    desired_status = "active" if state["active"] else "pending"
    if client.get("status") != desired_status:
        await db.clients.update_one({"id": client["id"]}, {"$set": {"status": desired_status}})
        client["status"] = desired_status
    return client


@api.get("/client/subscription")
async def get_client_subscription(user: dict = Depends(require_role("client", allow_pending=True))):
    client = await db.clients.find_one({"id": user["id"]}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    state = await _client_funding_state(client)
    expires_at = (
        client.get("plan_expires_at")
        or state["expires"]
        or (state["plan"] or {}).get("expires_at")
        or (state["plan"] or {}).get("valid_till")
    )
    return {
        "active": state["active"],
        "plan": state["plan"],
        "wallet_balance": state["wallet_balance"],
        "required_amount": state["required_amount"],
        "started_at": client.get("plan_started_at"),
        "expires_at": expires_at,
        "plan_started_at": client.get("plan_started_at"),
        "plan_expires_at": expires_at,
        "expired": state["expired"],
        "suspended": state["suspended"],
        "client_status": state["client_status"],
        "funded": state["funded"],
    }

# ==================== Media ====================
class MediaUpdate(BaseModel):
    name: Optional[str] = None
    zone: Optional[str] = None
    folder: Optional[str] = None

@api.post("/client/media")
async def upload_media(
    file: UploadFile = File(...),
    zone: str = Form("main"),
    folder: str = Form("default"),
    name: str = Form(""),
    user: dict = Depends(require_role("client")),
):
    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File exceeds {MAX_UPLOAD_MB}MB limit")

    client_doc = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "dealer_id": 1, "plan": 1, "plan_id": 1})
    limit_bytes, limit_gb, _plan = await _get_client_storage_quota(client_doc or {})
    if limit_bytes > 0:
        used_bytes = await _get_media_usage_bytes(user["id"])
        if used_bytes + len(data) > limit_bytes:
            remaining_gb = max(0.0, (limit_bytes - used_bytes) / (1024 * 1024 * 1024))
            raise HTTPException(status_code=413, detail=f"Storage limit exceeded. Remaining {remaining_gb:.2f} GB on your plan.")

    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    file_id = str(uuid.uuid4())
    path = f"{APP_NAME}/{user['id']}/{file_id}.{ext}"
    result = put_object(path, data, content_type)
    kind = "video" if content_type.startswith("video/") else "image"
    public_url = f"{PUBLIC_APP_URL.rstrip('/')}/api/media/serve/{file_id}" if PUBLIC_APP_URL else f"/api/media/serve/{file_id}"
    doc = {
        "id": file_id,
        "client_id": user["id"],
        "zone": zone,
        "folder": folder or "default",
        "name": name or file.filename or "untitled",
        "original_filename": file.filename,
        "kind": kind,
        "content_type": content_type,
        "storage_path": result.get("path", path),
        "public_url": public_url,
        "size": len(data),
        "is_deleted": False,
        "created_at": now_iso(),
    }
    await db.media.insert_one(doc)
    asyncio.create_task(_broadcast_queue_refresh(user["id"], reason="media_uploaded"))
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="media_uploaded"))
    return clean(doc)

@api.get("/client/media")
async def list_client_media(zone: Optional[str] = None, folder: Optional[str] = None, user: dict = Depends(require_role("client"))):
    q = {"client_id": user["id"], "is_deleted": False}
    if zone: q["zone"] = zone
    if folder: q["folder"] = folder
    return await db.media.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.put("/client/media/{mid}")
async def update_media(mid: str, body: MediaUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.media.find_one_and_update({"id": mid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Media not found")
    asyncio.create_task(_broadcast_queue_refresh(user["id"], reason="media_updated"))
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="media_updated"))
    return r

@api.delete("/client/media/{mid}")
async def delete_media(mid: str, user: dict = Depends(require_role("client"))):
    r = await db.media.update_one({"id": mid, "client_id": user["id"]}, {"$set": {"is_deleted": True}})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Media not found")
    asyncio.create_task(_broadcast_queue_refresh(user["id"], reason="media_deleted"))
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="media_deleted"))
    return {"ok": True}

@api.get("/media/serve/{mid}")
async def serve_media(mid: str, request: Request):
    """Public-readable media stream — signage players read this without auth."""
    rec = await db.media.find_one({"id": mid, "is_deleted": False}, {"_id": 0})
    if not rec: raise HTTPException(status_code=404, detail="Media not found")

    def _build_range_response(data: bytes, content_type: str, filename: str = ""):
        range_header = request.headers.get("range") or request.headers.get("Range")
        total = len(data)
        headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
        }

        if not range_header:
            headers["Content-Length"] = str(total)
            return Response(content=data, media_type=content_type, headers=headers)

        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if not match:
            headers["Content-Length"] = str(total)
            return Response(content=data, media_type=content_type, headers=headers)

        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else total - 1
        start = max(0, min(start, total - 1))
        end = max(start, min(end, total - 1))
        chunk = data[start:end + 1]

        headers.update({
            "Content-Range": f"bytes {start}-{end}/{total}",
            "Content-Length": str(len(chunk)),
        })
        return Response(content=chunk, status_code=206, media_type=content_type, headers=headers)

    try:
        data, ctype = get_object(rec["storage_path"])
        return _build_range_response(data, rec.get("content_type") or ctype)
    except HTTPException as e:
        logger.warning(f"Media serve via S3 client failed for {mid}: {e.detail}")

    # Fallback path for dev/local where S3 credentials may be missing:
    # fetch from public object URL if available.
    public_url = rec.get("public_url") or ""
    if not public_url and rec.get("storage_path"):
        public_url = f"{SUPABASE_PROJECT_URL}/storage/v1/object/public/{S3_BUCKET}/{quote(rec['storage_path'], safe='/')}"

    if public_url:
        try:
            r = requests.get(public_url, timeout=15)
            if r.ok:
                return _build_range_response(r.content, rec.get("content_type") or r.headers.get("Content-Type", "application/octet-stream"))
            logger.warning(f"Media serve public URL failed for {mid}: HTTP {r.status_code}")
        except Exception as ex:
            logger.warning(f"Media serve public URL exception for {mid}: {ex}")

    raise HTTPException(status_code=503, detail="Storage unavailable")


@api.get("/debug/media/{mid}")
async def debug_media(mid: str, _: dict = Depends(get_current_user)):
    """Diagnose why a media asset may be returning 503 on /media/serve/{mid}."""
    rec = await db.media.find_one({"id": mid}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Media not found")

    result = {
        "id": rec.get("id"),
        "is_deleted": rec.get("is_deleted", False),
        "content_type": rec.get("content_type", ""),
        "storage_path": rec.get("storage_path", ""),
        "public_url_stored": rec.get("public_url", ""),
        "s3_credentials_present": bool(S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY),
        "s3_endpoint": S3_ENDPOINT_URL,
        "bucket": S3_BUCKET,
        "checks": {},
    }

    # Check S3 SDK path
    try:
        data, ctype = get_object(rec.get("storage_path", ""))
        result["checks"]["s3_get_object"] = {
            "ok": True,
            "bytes": len(data),
            "content_type": ctype,
        }
    except HTTPException as e:
        result["checks"]["s3_get_object"] = {
            "ok": False,
            "status": e.status_code,
            "detail": str(e.detail),
        }
    except Exception as ex:
        result["checks"]["s3_get_object"] = {
            "ok": False,
            "status": 500,
            "detail": str(ex),
        }

    # Check public URL path
    public_url = rec.get("public_url") or ""
    if not public_url and rec.get("storage_path"):
        public_url = f"{SUPABASE_PROJECT_URL}/storage/v1/object/public/{S3_BUCKET}/{quote(rec['storage_path'], safe='/')}"
    result["computed_public_url"] = public_url

    if public_url:
        try:
            r = requests.get(public_url, timeout=15)
            result["checks"]["public_url_get"] = {
                "ok": bool(r.ok),
                "status": r.status_code,
                "content_type": r.headers.get("Content-Type", ""),
                "bytes": len(r.content or b""),
            }
        except Exception as ex:
            result["checks"]["public_url_get"] = {
                "ok": False,
                "status": 500,
                "detail": str(ex),
            }
    else:
        result["checks"]["public_url_get"] = {
            "ok": False,
            "status": 404,
            "detail": "No public URL available",
        }

    return result

# ==================== Playlists (template-driven zones) ====================
class PlaylistItem(BaseModel):
    # Support multiple item types: media (old), text (new), youtube (new)
    type: Optional[str] = None  # "media", "text", "youtube", "clock", "weather", "bookings", "queue", "notices"
    media_id: Optional[str] = None  # for media items
    content: Optional[str] = None  # for text items
    url: Optional[str] = None  # for youtube items
    fit: Optional[Literal["cover", "contain"]] = "cover"  # for media items
    duration: int = 10  # seconds
    title: Optional[str] = None
    location: Optional[str] = None
    temperature: Optional[float] = None
    condition: Optional[str] = None
    high: Optional[float] = None
    low: Optional[float] = None
    humidity: Optional[float] = None
    entries: Optional[List[dict]] = None
    notices: Optional[List[dict]] = None

class PlaylistIn(BaseModel):
    name: str
    branch_id: Optional[str] = None
    template_id: Optional[str] = None
    zone_items: Dict[str, List[PlaylistItem]] = Field(default_factory=dict)
    # legacy single-zone fallback (kept for backward compatibility)
    main_items: Optional[List[PlaylistItem]] = None
    sidebar_items: Optional[List[PlaylistItem]] = None
    ticker_messages: Optional[List[dict]] = None
    zone: Optional[Literal["main", "sidebar", "ticker"]] = None
    items: Optional[List[PlaylistItem]] = None

class PlaylistUpdate(BaseModel):
    name: Optional[str] = None
    branch_id: Optional[str] = None
    template_id: Optional[str] = None
    zone_items: Optional[Dict[str, List[PlaylistItem]]] = None
    main_items: Optional[List[PlaylistItem]] = None
    sidebar_items: Optional[List[PlaylistItem]] = None
    ticker_messages: Optional[List[dict]] = None

async def _validate_media(ids: List[str], client_id: str):
    ids = [mid for mid in ids if mid]
    if not ids:
        return
    owned = await db.media.count_documents({"id": {"$in": ids}, "client_id": client_id, "is_deleted": False})
    if owned != len(set(ids)):
        raise HTTPException(status_code=400, detail="Invalid media in playlist")


async def _get_template_zone_ids(template_id: Optional[str]):
    """Return ordered list of zone ids for a template. Falls back to legacy order."""
    if not template_id:
        return ["main", "sidebar", "ticker"]
    tpl = await db.templates.find_one({"id": template_id}, {"_id": 0, "layout": 1})
    if not tpl:
        return ["main", "sidebar", "ticker"]
    layout = tpl.get("layout", {}) or {}
    zones = layout.get("zones") or []
    if zones and isinstance(zones, list) and len(zones) > 0:
        return [z.get("id") or (z.get("name") or "").lower().replace(" ", "_") for z in zones]
    # fallback: if legacy names are present on layout, prefer them
    legacy = []
    if layout.get("main"): legacy.append("main")
    if layout.get("sidebar"): legacy.append("sidebar")
    if layout.get("ticker"): legacy.append("ticker")
    return legacy if legacy else ["main", "sidebar", "ticker"]


def _remap_legacy_buckets_to_zone_ids(zone_ids: List[str], legacy_buckets: List[List[dict]]):
    """Map legacy ordered buckets (main, sidebar, ticker) into concrete zone ids by position."""
    out = {}
    for idx, zid in enumerate(zone_ids):
        out[zid] = legacy_buckets[idx] if idx < len(legacy_buckets) else []
    return out


@api.get("/client/playlists")
async def list_playlists(user: dict = Depends(require_role("client")), branch_id: Optional[str] = None):
    q = {"client_id": user["id"]}
    if branch_id:
        q["branch_id"] = branch_id
    playlists = await db.playlists.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    branch_ids = {str(pl.get("branch_id") or "").strip() for pl in playlists if str(pl.get("branch_id") or "").strip()}
    branch_map = {}
    if branch_ids:
        branches = await db.branches.find({"client_id": user["id"], "id": {"$in": list(branch_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        branch_map = {str(branch.get("id") or ""): branch.get("name") or branch.get("id") or "" for branch in branches}
    for pl in playlists:
        pl["branch_name"] = branch_map.get(str(pl.get("branch_id") or ""), pl.get("branch_name") or "")
    return playlists

@api.post("/client/playlists")
async def create_playlist(body: PlaylistIn, user: dict = Depends(require_role("client"))):
    # Canonicalize incoming payload to the template's zone ids
    zone_items = body.zone_items or {}
    template_zone_ids = await _get_template_zone_ids(body.template_id)

    # If explicit zone_items provided, ensure keys match template zone ids (map legacy keys if needed)
    if zone_items:
        # If any key matches template zone ids, keep those; otherwise, try remapping legacy buckets
        has_matching = any(k in template_zone_ids for k in zone_items.keys())
        if not has_matching:
            # treat zone_items as legacy buckets array-like object and remap by order
            legacy_buckets = [zone_items.get(k) or [] for k in ["main", "sidebar", "ticker"]]
            zone_items = _remap_legacy_buckets_to_zone_ids(template_zone_ids, legacy_buckets)
        else:
            # normalize: ensure keys in returned map are template zone ids
            normalized = {k: v for k, v in zone_items.items() if k in template_zone_ids}
            # also map any legacy keys present into first available template ids
            legacy_buckets = [zone_items.get(k) or [] for k in ["main", "sidebar", "ticker"]]
            for idx, zid in enumerate(template_zone_ids):
                if zid not in normalized:
                    normalized[zid] = legacy_buckets[idx] if idx < len(legacy_buckets) else []
            zone_items = normalized
    else:
        # No explicit zone_items -> check legacy fields and single-item fields
        if (body.main_items or body.sidebar_items or body.ticker_messages):
            legacy_buckets = [body.main_items or [], body.sidebar_items or [], body.ticker_messages or []]
            zone_items = _remap_legacy_buckets_to_zone_ids(template_zone_ids, legacy_buckets)
        elif body.items and body.zone:
            # single-zone add: map body.zone (may be legacy) to template zone id
            if body.zone in template_zone_ids:
                zone_items = {zid: [] for zid in template_zone_ids}
                zone_items[body.zone] = body.items
            else:
                # map legacy name to first template zone if necessary
                zone_items = {zid: [] for zid in template_zone_ids}
                zone_items[template_zone_ids[0]] = body.items

    all_media_ids = [item.media_id for zone_list in zone_items.values() for item in (zone_list or [])]
    await _validate_media(all_media_ids, user["id"])
    branch_name = ""
    if body.branch_id:
        branch = await db.branches.find_one({"id": body.branch_id, "client_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
        if not branch:
            raise HTTPException(status_code=400, detail="Branch not assigned to you")
        branch_name = branch.get("name") or branch.get("id") or ""
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": user["id"],
        "branch_id": body.branch_id or "",
        "branch_name": branch_name,
        "name": body.name,
        "template_id": body.template_id,
        "zone_items": {zone: [item.model_dump() for item in (items or [])] for zone, items in zone_items.items()},
        # keep legacy fields for backward compatibility but prefer zone_items
        "main_items": [i.model_dump() for i in (body.main_items or [])],
        "sidebar_items": [i.model_dump() for i in (body.sidebar_items or [])],
        "ticker_messages": body.ticker_messages or [],
        "created_at": now_iso(),
    }
    await db.playlists.insert_one(doc)
    asyncio.create_task(_broadcast_queue_refresh(user["id"], reason="playlist_created"))
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="playlist_created"))
    return clean(doc)


@api.post("/client/branches")
async def create_branch(body: BranchIn, user: dict = Depends(require_role("client"))):
    # Create a new branch for this client with placeholder storefront data.
    bid = str(uuid.uuid4())
    doc = {
        "id": bid,
        "client_id": user["id"],
        "name": body.name,
        "created_at": now_iso(),
        "profile": {
            "specialty": "",
            "qualifications": "",
            "fee": 0,
            "hours": "",
            "is_open": True,
            "image_url": "",
            "description": "",
            "slot_minutes": 15,
            "services": [],
        },
    }
    await db.branches.insert_one(doc)
    # Determine source selector: clone from provided branch_id or clone global (no branch_id)
    if body.clone_from_branch_id:
        tpl_filter = {"client_id": user["id"], "branch_id": body.clone_from_branch_id}
        pl_filter = {"client_id": user["id"], "branch_id": body.clone_from_branch_id}
    else:
        tpl_filter = {"client_id": user["id"], "$or": [{"branch_id": {"$exists": False}}, {"branch_id": ""}]}
        pl_filter = {"client_id": user["id"], "$or": [{"branch_id": {"$exists": False}}, {"branch_id": ""}]}

    # Clone templates: keep a map of old->new ids to remap playlists
    tpl_map: Dict[str, str] = {}
    try:
        templates = await db.templates.find(tpl_filter, {"_id": 0}).to_list(1000)
        for t in templates:
            old_id = t.get("id")
            new_id = str(uuid.uuid4())
            tpl_map[old_id] = new_id
            new_t = dict(t)
            new_t["id"] = new_id
            new_t["branch_id"] = bid
            new_t["created_at"] = now_iso()
            await db.templates.insert_one(new_t)
    except Exception:
        pass

    # Clone playlists: remap template ids where we cloned templates
    try:
        playlists = await db.playlists.find(pl_filter, {"_id": 0}).to_list(1000)
        for p in playlists:
            old_pid = p.get("id")
            new_pid = str(uuid.uuid4())
            new_p = dict(p)
            new_p["id"] = new_pid
            new_p["branch_id"] = bid
            tpl_id = new_p.get("template_id")
            if tpl_id and tpl_id in tpl_map:
                new_p["template_id"] = tpl_map[tpl_id]
            new_p["created_at"] = now_iso()
            await db.playlists.insert_one(new_p)
    except Exception:
        pass

    return clean(doc)


@api.get("/client/branches")
async def list_client_branches(user: dict = Depends(require_role("client"))):
    return await db.branches.find({"client_id": user["id"]}, {"_id": 0}).to_list(1000)


@api.delete("/client/branches/{bid}")
async def delete_client_branch(bid: str, user: dict = Depends(require_role("client"))):
    branch = await db.branches.find_one({"id": bid, "client_id": user["id"]}, {"_id": 0, "id": 1})
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    await db.appointments.delete_many({"client_id": user["id"], "branch_id": bid})
    await db.devices.delete_many({"client_id": user["id"], "branch_id": bid})
    await db.playlists.delete_many({"client_id": user["id"], "branch_id": bid})
    await db.templates.delete_many({"client_id": user["id"], "branch_id": bid})
    await db.branches.delete_one({"id": bid, "client_id": user["id"]})
    try:
        RECENT_ANNOUNCEMENTS.pop(_scope_key(user["id"], bid), None)
    except Exception:
        pass
    return {"ok": True, "deleted_branch_id": bid}

@api.put("/client/playlists/{pid}")
async def update_playlist(pid: str, body: PlaylistUpdate, user: dict = Depends(require_role("client"))):
    upd: Dict[str, Any] = {}
    if body.name is not None: upd["name"] = body.name
    if body.branch_id is not None:
        if body.branch_id:
            branch = await db.branches.find_one({"id": body.branch_id, "client_id": user["id"]}, {"_id": 0, "id": 1, "name": 1})
            if not branch:
                raise HTTPException(status_code=400, detail="Branch not assigned to you")
            upd["branch_id"] = body.branch_id
            upd["branch_name"] = branch.get("name") or branch.get("id") or ""
        else:
            upd["branch_id"] = ""
            upd["branch_name"] = ""
    if body.template_id is not None: upd["template_id"] = body.template_id
    if body.zone_items is not None:
        # Ensure zone_items keys match the template's zone ids if possible
        tpl_id = body.template_id
        if not tpl_id:
            existing = await db.playlists.find_one({"id": pid, "client_id": user["id"]}, {"_id": 0, "template_id": 1})
            tpl_id = existing.get("template_id") if existing else None
        template_zone_ids = await _get_template_zone_ids(tpl_id)
        incoming = body.zone_items or {}
        has_match = any(k in template_zone_ids for k in incoming.keys())
        if not has_match:
            legacy_buckets = [incoming.get(k) or [] for k in ["main", "sidebar", "ticker"]]
            zone_items = _remap_legacy_buckets_to_zone_ids(template_zone_ids, legacy_buckets)
        else:
            normalized = {k: v for k, v in incoming.items() if k in template_zone_ids}
            legacy_buckets = [incoming.get(k) or [] for k in ["main", "sidebar", "ticker"]]
            for idx, zid in enumerate(template_zone_ids):
                if zid not in normalized:
                    normalized[zid] = legacy_buckets[idx] if idx < len(legacy_buckets) else []
            zone_items = normalized
        upd["zone_items"] = {zone: [item.model_dump() for item in (items or [])] for zone, items in zone_items.items()}
        all_media_ids = [item.media_id for items in zone_items.values() for item in (items or [])]
        await _validate_media(all_media_ids, user["id"])
    else:
        legacy_zone_items: Dict[str, List[PlaylistItem]] = {}
        if body.main_items is not None:
            legacy_zone_items["main"] = body.main_items
            upd["main_items"] = [i.model_dump() for i in body.main_items]
        if body.sidebar_items is not None:
            legacy_zone_items["sidebar"] = body.sidebar_items
            upd["sidebar_items"] = [i.model_dump() for i in body.sidebar_items]
        if body.ticker_messages is not None:
            upd["ticker_messages"] = body.ticker_messages
        if legacy_zone_items:
            existing = await db.playlists.find_one({"id": pid, "client_id": user["id"]}, {"_id": 0, "template_id": 1})
            tpl_id = existing.get("template_id") if existing else None
            template_zone_ids = await _get_template_zone_ids(tpl_id)
            legacy_buckets = [legacy_zone_items.get(k) or [] for k in ["main", "sidebar", "ticker"]]
            zone_items = _remap_legacy_buckets_to_zone_ids(template_zone_ids, legacy_buckets)
            upd["zone_items"] = {zone: [item.model_dump() for item in items] for zone, items in zone_items.items()}
            await _validate_media([item.media_id for items in legacy_zone_items.values() for item in items], user["id"])
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.playlists.find_one_and_update({"id": pid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Playlist not found")
    asyncio.create_task(_broadcast_queue_refresh(user["id"], reason="playlist_updated"))
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="playlist_updated"))
    return r

@api.delete("/client/playlists/{pid}")
async def delete_playlist(pid: str, user: dict = Depends(require_role("client"))):
    r = await db.playlists.delete_one({"id": pid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Playlist not found")
    await db.schedules.delete_many({"playlist_id": pid, "client_id": user["id"]})
    asyncio.create_task(_broadcast_queue_refresh(user["id"], reason="playlist_deleted"))
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="playlist_deleted"))
    return {"ok": True}

# ==================== Schedules ====================
class ScheduleIn(BaseModel):
    name: str
    playlist_id: str
    device_ids: List[str] = []
    days_of_week: List[int] = [0, 1, 2, 3, 4, 5, 6]  # 0=Mon, 6=Sun
    start_time: str = "00:00"  # HH:MM 24h
    end_time: str = "23:59"
    is_active: bool = True

class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    playlist_id: Optional[str] = None
    device_ids: Optional[List[str]] = None
    days_of_week: Optional[List[int]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    is_active: Optional[bool] = None

@api.get("/client/schedules")
async def list_schedules(user: dict = Depends(require_role("client"))):
    return await db.schedules.find({"client_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.post("/client/schedules")
async def create_schedule(body: ScheduleIn, user: dict = Depends(require_role("client"))):
    pl = await db.playlists.find_one({"id": body.playlist_id, "client_id": user["id"]}, {"_id": 0, "id": 1})
    if not pl: raise HTTPException(status_code=400, detail="Invalid playlist")
    doc = {"id": str(uuid.uuid4()), "client_id": user["id"], **body.model_dump(),
           "created_at": now_iso()}
    await db.schedules.insert_one(doc)
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="schedule_created"))
    return clean(doc)

@api.put("/client/schedules/{sid}")
async def update_schedule(sid: str, body: ScheduleUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if body.playlist_id:
        pl = await db.playlists.find_one({"id": body.playlist_id, "client_id": user["id"]}, {"_id": 0, "id": 1})
        if not pl: raise HTTPException(status_code=400, detail="Invalid playlist")
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.schedules.find_one_and_update({"id": sid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Schedule not found")
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="schedule_updated"))
    return r

@api.delete("/client/schedules/{sid}")
async def delete_schedule(sid: str, user: dict = Depends(require_role("client"))):
    r = await db.schedules.delete_one({"id": sid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Schedule not found")
    asyncio.create_task(_broadcast_content_refresh(user["id"], reason="schedule_deleted"))
    return {"ok": True}

# ==================== Public Signage Player ====================
def _hhmm_to_min(s: str) -> int:
    try:
        h, m = s.split(":"); return int(h) * 60 + int(m)
    except Exception: return 0


def _parse_time_to_min(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    text = str(value).strip().upper()
    if not text:
        return None
    formats = ["%H:%M", "%H.%M", "%I:%M %p", "%I %p", "%I:%M%p", "%I%p"]
    for fmt in formats:
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.hour * 60 + parsed.minute
        except Exception:
            continue
    return None


def _format_min_to_time(minute_value: int) -> str:
    minute_value = max(0, min(23 * 60 + 59, int(minute_value)))
    rendered = (datetime(2000, 1, 1) + timedelta(minutes=minute_value)).strftime("%I:%M %p")
    return rendered.lstrip("0")


async def _assign_next_available_time(cid: str, day: str, requested_time: Optional[str], service_duration_mins: int, branch_id: Optional[str] = None) -> Dict[str, Any]:
    app_now = _app_now()
    now_min = app_now.hour * 60 + app_now.minute
    requested_min = _parse_time_to_min(requested_time)
    candidate_min = max(requested_min if requested_min is not None else now_min, now_min)

    active_query: Dict[str, Any] = {"client_id": cid, "date": day, "status": {"$in": ["pending", "called"]}}
    if branch_id:
        active_query["branch_id"] = branch_id
    active_appointments = await db.appointments.find(
        active_query,
        {"_id": 0},
    ).sort([("token", 1), ("created_at", 1)]).to_list(200)

    occupied: List[tuple[int, int]] = []
    for item in active_appointments:
        start_min = _parse_time_to_min(item.get("assigned_time") or item.get("preferred_time") or "")
        if start_min is None:
          continue
        duration = int(item.get("service_duration_mins") or service_duration_mins or 15)
        occupied.append((start_min, start_min + max(5, duration)))

    occupied.sort(key=lambda pair: pair[0])
    while True:
        conflicting = next((slot for slot in occupied if candidate_min < slot[1] and candidate_min + service_duration_mins > slot[0]), None)
        if not conflicting:
            break
        candidate_min = max(candidate_min, conflicting[1])

    return {
        "requested_time": requested_time or "",
        "assigned_time": _format_min_to_time(candidate_min),
        "assigned_time_minutes": candidate_min,
    }

@public_api.get("/player/{pair_code}")
async def player_payload(pair_code: str, request: Request):
    """Returns current playlist items for a device based on schedules + current time."""
    device = await db.devices.find_one({"pair_code": pair_code}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found. Check pair code.")

    # Enforce that the polling player presents the device fingerprint that originally requested pairing.
    # Caller must send header 'X-Device-Fingerprint' or query param 'device_fingerprint'.
    provided_fp = request.headers.get("X-Device-Fingerprint") or request.query_params.get("device_fingerprint")
    saved_fp = device.get("fingerprint")
    if not saved_fp:
        # Device hasn't been bound to a fingerprint yet — pairing required for exclusivity
        raise HTTPException(status_code=403, detail="Device not paired with a fingerprint. Pairing required.")
    if not provided_fp or provided_fp != saved_fp:
        raise HTTPException(status_code=403, detail="Device not authorized. Fingerprint mismatch.")
    device_branch_id = str(device.get("branch_id") or "")
    # enforce subscription: do not return playlist if client's subscription is inactive
    client = await db.clients.find_one({"id": device.get("client_id")}, {"_id": 0})
    weather = _resolve_weather_snapshot(client.get("address", "")) if client else None
    subscription_state = await _client_funding_state(client or {}) if client else {"active": False, "expired": True, "suspended": False, "plan": None}
    if not subscription_state.get("active"):
        reason = "Account suspended" if subscription_state.get("suspended") else "Subscription expired"
        # return minimal payload indicating subscription required
        await db.devices.update_one({"id": device["id"]}, {"$set": {"status": "suspended", "last_seen": now_iso()}})
        return {
            "device_id": device["id"],
            "client_id": device["client_id"],
            "subscription_active": False,
            "subscription_reason": reason,
            "weather": weather,
            "message": reason,
        }
    now = datetime.now(timezone.utc)
    dow = now.weekday()
    cur_min = now.hour * 60 + now.minute

    cursor = db.schedules.find({"client_id": device["client_id"], "is_active": True,
                                "device_ids": device["id"], "days_of_week": dow})
    active_schedules = []
    async for s in cursor:
        if _hhmm_to_min(s.get("start_time", "00:00")) <= cur_min <= _hhmm_to_min(s.get("end_time", "23:59")):
            active_schedules.append(s)

    def _playlist_allowed(pl: Optional[dict]) -> bool:
        if not pl:
            return False
        if not device_branch_id:
            return True
        return str(pl.get("branch_id") or "") == device_branch_id

    async def _hydrate_items(items):
        out = []
        for item in items or []:
            # New format with explicit type field
            if item.get("type") == "text":
                out.append({"type": "text", "content": item.get("content", ""), 
                           "duration": item.get("duration", 10)})
            elif item.get("type") == "youtube":
                out.append({"type": "youtube", "url": item.get("url", ""),
                           "duration": item.get("duration", 10)})
            elif item.get("type") in {"clock", "weather", "bookings", "queue", "notices"}:
                widget_type = item.get("type")
                widget = {"type": widget_type, "duration": item.get("duration", 10)}
                for key in ("title", "location", "temperature", "condition", "high", "low", "humidity", "entries", "notices"):
                    if item.get(key) is not None:
                        widget[key] = item.get(key)
                out.append(widget)
            elif item.get("type") == "media" or item.get("media_id"):
                # Media item - fetch from database
                media_id = item.get("media_id")
                m = await db.media.find_one({"id": media_id, "is_deleted": False}, {"_id": 0})
                if not m: continue
                out.append({"type": "media", "id": m["id"], "kind": m["kind"],
                           "content_type": m.get("content_type", ""),
                           "url": f"/api/media/serve/{m['id']}",
                           "duration": item.get("duration", 10),
                           "name": m.get("name", ""), "media_id": m["id"]})
        return out

    async def _ingest(pl: dict):
        if pl is None: return
        zone_items = pl.get("zone_items") or {}
        ticker_zone_id = next((z["id"] for z in zone_defs if "ticker" in (z.get("id", "") + " " + z.get("name", "")).lower()), "ticker")
        if zone_items:
            for zone_id, items in zone_items.items():
                zones.setdefault(zone_id, []).extend(await _hydrate_items(items))
        else:
            # Legacy single-zone schema: remap ordered legacy buckets into template zone ids
            template_zone_ids = [z["id"] for z in zone_defs]
            legacy_buckets = [pl.get("main_items") or [], pl.get("sidebar_items") or [], pl.get("ticker_messages") or []]
            remapped = _remap_legacy_buckets_to_zone_ids(template_zone_ids, legacy_buckets)
            # hydrate media items and ticker messages appropriately
            for zid, items in remapped.items():
                # ticker messages might be dicts with 'text' keys
                if zid == "ticker" or any(isinstance(it, dict) and it.get("text") for it in (items or [])):
                    for t in items or []:
                        if isinstance(t, dict) and t.get("text"):
                            zones.setdefault(zid, []).append({"kind": "text", "text": t.get("text", ""), "duration": 1})
                else:
                    zones.setdefault(zid, []).extend(await _hydrate_items(items))
            # also support legacy single "items"+"zone" pairing
            if pl.get("items") and pl.get("zone"):
                entries = await _hydrate_items(pl.get("items"))
                # map provided zone name to actual zone id if present, else use first template zone
                target = pl.get("zone") if pl.get("zone") in zones else (template_zone_ids[0] if template_zone_ids else "main")
                zones.setdefault(target, []).extend(entries)

        for msg in pl.get("ticker_messages") or []:
            if isinstance(msg, dict):
                msg_type = (msg.get("type") or msg.get("kind") or "text").lower()
                if msg_type == "rss" and msg.get("url"):
                    zones.setdefault(ticker_zone_id, []).append({
                        "kind": "rss",
                        "url": msg.get("url", ""),
                        "title": msg.get("title") or msg.get("text") or "RSS Feed",
                        "duration": int(msg.get("duration", 6) or 6),
                    })
                else:
                    text = msg.get("text") or msg.get("message") or msg.get("title") or ""
                    if text:
                        zones.setdefault(ticker_zone_id, []).append({"kind": "text", "text": text, "duration": int(msg.get("duration", 6) or 6)})
            elif isinstance(msg, str) and msg.strip():
                zones.setdefault(ticker_zone_id, []).append({"kind": "text", "text": msg.strip(), "duration": 6})

    def _schedule_sort_key(schedule: dict):
        return (
            str(schedule.get("created_at") or ""),
            str(schedule.get("updated_at") or ""),
            str(schedule.get("playlist_id") or ""),
        )

    chosen_playlist = None

    # device-level direct assignment should win when present
    if device.get("playlist_id"):
        pl = await db.playlists.find_one({"id": device["playlist_id"], "client_id": device["client_id"]}, {"_id": 0})
        if _playlist_allowed(pl):
            chosen_playlist = pl

    if not chosen_playlist:
        active_schedules.sort(key=_schedule_sort_key, reverse=True)
        for s in active_schedules:
            pl = await db.playlists.find_one({"id": s["playlist_id"], "client_id": device["client_id"]}, {"_id": 0})
            if _playlist_allowed(pl):
                chosen_playlist = pl
                break

    # fallback to latest playlist if no schedule
    if not chosen_playlist:
        latest_query: Dict[str, Any] = {"client_id": device["client_id"]}
        if device_branch_id:
            latest_query["branch_id"] = device_branch_id
        chosen_playlist = await db.playlists.find_one(latest_query, {"_id": 0}, sort=[("created_at", -1)])

    effective_template_id = str((chosen_playlist or {}).get("template_id") or device.get("template_id") or "")
    template = None
    zone_defs = []
    if effective_template_id:
        template = await db.templates.find_one({"id": effective_template_id}, {"_id": 0, "layout": 1, "name": 1})
        if template:
            zone_defs = template.get("layout", {}).get("zones", []) or []
            if not zone_defs:
                layout = template.get("layout", {})
                if layout.get("main"): zone_defs.append({"id": "main", "name": layout.get("main", "Main")})
                if layout.get("sidebar"): zone_defs.append({"id": "sidebar", "name": layout.get("sidebar", "Sidebar")})
                if layout.get("ticker"): zone_defs.append({"id": "ticker", "name": layout.get("ticker", "Ticker")})
    if not zone_defs:
        zone_defs = [
            {"id": "main", "name": "Main"},
            {"id": "sidebar", "name": "Sidebar"},
            {"id": "ticker", "name": "Ticker"},
        ]

    zones = {z["id"]: [] for z in zone_defs}

    await _ingest(chosen_playlist)

    await db.devices.update_one({"id": device["id"]}, {"$set": {"status": "paired", "last_seen": now_iso()}})

    result = {"device_id": device["id"], "device_name": device["name"],
            "client_id": device["client_id"],
            "branch_id": device_branch_id,
            "weather": weather,
            "orientation": device.get("orientation", "auto"),
            "playlist_id": (chosen_playlist or {}).get("id") or device.get("playlist_id", ""),
            "brightness": int(device.get("brightness", 100) or 100),
            "zones": zones, "template": template,
            "poll_after_seconds": 60}

    # surface any recent announcement broadcast (so clients that missed websocket receive it on poll)
    try:
        recent = RECENT_ANNOUNCEMENTS.get(_scope_key(device.get("client_id"), device.get("branch_id")))
        if recent is None and not device_branch_id:
            recent = RECENT_ANNOUNCEMENTS.get(device.get("client_id"))
        if recent:
            expires_at = recent.get("expires_at")
            if expires_at and expires_at > datetime.now(timezone.utc):
                # embed announcement object at top-level so clients pick it up
                payload = recent.get("payload") or {}
                if payload.get("announcement"):
                    result["announcement"] = payload.get("announcement")
                    # include sent_at for latency measurement
                    if payload.get("sent_at"):
                        result["announcement_sent_at"] = payload.get("sent_at")
            else:
                # cleanup expired
                try: RECENT_ANNOUNCEMENTS.pop(_scope_key(device.get("client_id"), device.get("branch_id")), None)
                except Exception: pass
    except Exception:
        pass

    return result


@public_api.post("/player/{pair_code}/offline")
async def player_offline(pair_code: str, request: Request):
    device = await db.devices.find_one({"pair_code": pair_code}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found. Check pair code.")

    provided_fp = request.headers.get("X-Device-Fingerprint") or request.query_params.get("device_fingerprint")
    saved_fp = device.get("fingerprint")
    if saved_fp and provided_fp and provided_fp != saved_fp:
        raise HTTPException(status_code=403, detail="Device not authorized. Fingerprint mismatch.")

    await db.devices.update_one({"id": device["id"]}, {"$set": {"status": "offline", "last_seen": now_iso()}})
    return {"ok": True, "device_id": device["id"], "status": "offline"}



# ==================== Admin Settings (UPI) ====================
class SettingsIn(BaseModel):
    upi_id: Optional[str] = None
    upi_name: Optional[str] = None
    upi_qr_url: Optional[str] = None

SETTINGS_KEY = "global"

async def get_settings() -> dict:
    s = await db.settings.find_one({"_key": SETTINGS_KEY}, {"_id": 0})
    return s or {"_key": SETTINGS_KEY, "upi_id": "", "upi_name": "", "upi_qr_url": ""}

@api.get("/admin/settings")
async def admin_get_settings(_: dict = Depends(require_role("admin"))):
    s = await get_settings(); s.pop("_key", None); return s

@api.put("/admin/settings")
async def admin_put_settings(body: SettingsIn, _: dict = Depends(require_role("admin"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    await db.settings.update_one({"_key": SETTINGS_KEY}, {"$set": upd}, upsert=True)
    s = await get_settings(); s.pop("_key", None); return s
# Public settings (UPI for QR) — dealers/clients fetch their payee's UPI
@api.get("/admin/upi")
async def admin_upi_for_anyone(_: dict = Depends(get_current_user)):
    s = await get_settings()
    return {"upi_id": s.get("upi_id", ""), "upi_name": s.get("upi_name", ""), "upi_qr_url": s.get("upi_qr_url", "")}

@api.get("/dealer/me")
async def dealer_me(user: dict = Depends(require_role("dealer", allow_pending=True))):
    d = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return d

@api.put("/dealer/me")
async def dealer_update_me(body: SettingsIn, user: dict = Depends(require_role("dealer", allow_pending=True))):
    upd = {}
    if body.upi_id is not None: upd["upi_id"] = body.upi_id
    if body.upi_qr_url is not None: upd["upi_qr_url"] = body.upi_qr_url
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    d = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return d

@api.get("/client/my-dealer-upi")
async def client_dealer_upi(user: dict = Depends(require_role("client", allow_pending=True))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "dealer_id": 1})
    if not c: raise HTTPException(status_code=404, detail="Client not found")
    d = await db.users.find_one({"id": c["dealer_id"]}, {"_id": 0, "upi_id": 1, "upi_qr_url": 1, "name": 1})
    return {"upi_id": (d or {}).get("upi_id", ""), "upi_qr_url": (d or {}).get("upi_qr_url", ""),
            "dealer_name": (d or {}).get("name", "")}

# ==================== Status: suspend / activate / move ====================
class StatusIn(BaseModel):
    status: Literal["active", "suspended", "pending"]

class MoveDealerIn(BaseModel):
    new_dealer_id: str

@api.put("/admin/dealers/{did}/status")
async def admin_set_dealer_status(did: str, body: StatusIn, _: dict = Depends(require_role("admin"))):
    r = await db.users.find_one_and_update({"id": did, "role": "dealer"}, {"$set": {"status": body.status}},
                                           return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Dealer not found")
    return r

@api.put("/admin/clients/{cid}/status")
async def admin_set_client_status(cid: str, body: StatusIn, _: dict = Depends(require_role("admin"))):
    if body.status == "active":
        client = await db.clients.find_one({"id": cid}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        state = await _client_funding_state(client)
        if not state["active"]:
            raise HTTPException(status_code=400, detail="Client wallet balance is insufficient for the selected plan")
    r = await db.clients.find_one_and_update({"id": cid}, {"$set": {"status": body.status}},
                                              return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Client not found")
    return r

@api.put("/admin/clients/{cid}/move")
async def admin_move_client(cid: str, body: MoveDealerIn, _: dict = Depends(require_role("admin"))):
    new_dealer = await db.users.find_one({"id": body.new_dealer_id, "role": "dealer"}, {"_id": 0, "id": 1, "name": 1})
    if not new_dealer: raise HTTPException(status_code=404, detail="New dealer not found")
    r = await db.clients.find_one_and_update(
        {"id": cid},
        {"$set": {"dealer_id": new_dealer["id"], "dealer_name": new_dealer["name"], "assigned_template_ids": []}},
        return_document=True, projection={"_id": 0, "password_hash": 0},
    )
    if not r: raise HTTPException(status_code=404, detail="Client not found")
    # reassign devices' dealer_id mirror
    await db.devices.update_many({"client_id": cid}, {"$set": {"dealer_id": new_dealer["id"]}})
    return r

# ==================== Dealer Screens (devices owned by their clients) ====================
@api.put("/dealer/devices/{did}")
async def dealer_update_device(did: str, body: DeviceUpdate, user: dict = Depends(require_role("dealer"))):
    # ensure device belongs to a client of this dealer
    dev = await db.devices.find_one({"id": did, "dealer_id": user["id"]}, {"_id": 0, "client_id": 1})
    if not dev: raise HTTPException(status_code=404, detail="Device not found")
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "template_id" in upd and upd["template_id"]:
        c = await db.clients.find_one({"id": dev["client_id"]}, {"_id": 0, "assigned_template_ids": 1})
        if upd["template_id"] not in (c.get("assigned_template_ids") or []):
            raise HTTPException(status_code=400, detail="Template not assigned to the client")
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.devices.find_one_and_update({"id": did}, {"$set": upd}, return_document=True, projection={"_id": 0})
    return r

@api.delete("/dealer/devices/{did}")
async def dealer_delete_device(did: str, user: dict = Depends(require_role("dealer"))):
    r = await db.devices.delete_one({"id": did, "dealer_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Device not found")
    return {"ok": True}

# ==================== Payments (manual UPI) ====================
class PaymentCreate(BaseModel):
    amount: float
    plan_id: Optional[str] = None
    upi_txn_id: str
    notes: str = ""
    screenshot_media_id: Optional[str] = None  # not used for payments uploads — keep optional
    screenshot_url: Optional[str] = None  # public URL of uploaded screenshot

# Payment screenshot upload (reuse media store but role-aware)
@api.post("/payments/upload-screenshot")
async def upload_payment_screenshot(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ct = file.content_type or ""
    if ct not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Only image screenshots allowed")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024: raise HTTPException(status_code=400, detail="Screenshot too large (max 10MB)")
    ext = (file.filename or "img").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "png"
    fid = str(uuid.uuid4())
    path = f"{APP_NAME}/payments/{user['id']}/{fid}.{ext}"
    put_object(path, data, ct)
    await db.media.insert_one({
        "id": fid, "client_id": user["id"], "zone": "ticker", "name": file.filename or "screenshot",
        "original_filename": file.filename, "kind": "image", "content_type": ct,
        "storage_path": path, "size": len(data), "is_deleted": False, "is_payment_screenshot": True,
        "created_at": now_iso(),
    })
    return {"media_id": fid, "url": f"/api/media/serve/{fid}"}

@api.post("/dealer/payments")
async def dealer_create_payment(body: PaymentCreate, user: dict = Depends(require_role("dealer", allow_pending=True))):
    doc = {"id": str(uuid.uuid4()),
           "payer_id": user["id"], "payer_role": "dealer", "payer_name": user["name"],
           "payee_id": "admin", "payee_role": "admin",
           "amount": float(body.amount), "plan_id": body.plan_id,
           "upi_txn_id": body.upi_txn_id, "notes": body.notes,
           "screenshot_url": body.screenshot_url,
           "status": "pending", "created_at": now_iso(), "verified_at": None}
    await db.payments.insert_one(doc); return clean(doc)

@api.get("/dealer/payments")
async def dealer_list_payments(user: dict = Depends(require_role("dealer", allow_pending=True))):
    # outgoing (dealer→admin)
    outgoing = await db.payments.find({"payer_id": user["id"], "payer_role": "dealer"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # incoming (clients→this dealer)
    incoming = await db.payments.find({"payee_id": user["id"], "payee_role": "dealer"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"outgoing": outgoing, "incoming": incoming}

@api.post("/dealer/payments/{pid}/verify")
async def dealer_verify_client_payment(pid: str, body: StatusIn, user: dict = Depends(require_role("dealer"))):
    if body.status not in ("active", "pending"): raise HTTPException(status_code=400, detail="Status must be active or pending (rejected)")
    p = await db.payments.find_one({"id": pid, "payee_id": user["id"], "payee_role": "dealer"}, {"_id": 0})
    if not p: raise HTTPException(status_code=404, detail="Payment not found")
    if body.status == "active":
        client = await db.clients.find_one({"id": p["payer_id"], "dealer_id": user["id"]}, {"_id": 0})
        if client:
            state = await _client_funding_state(client)
            if not state["active"]:
                raise HTTPException(status_code=400, detail="Client wallet balance is insufficient for the selected plan")
    new_status = "verified" if body.status == "active" else "rejected"
    await db.payments.update_one({"id": pid}, {"$set": {"status": new_status, "verified_at": now_iso()}})
    if new_status == "verified":
        await db.clients.update_one({"id": p["payer_id"]}, {"$set": {"status": "active"}})
    return {"ok": True, "status": new_status}

@api.post("/client/payments")
async def client_create_payment(body: PaymentCreate, user: dict = Depends(require_role("client", allow_pending=True))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "dealer_id": 1})
    if not c: raise HTTPException(status_code=404, detail="Client not found")
    doc = {"id": str(uuid.uuid4()),
           "payer_id": user["id"], "payer_role": "client", "payer_name": user["name"],
           "payee_id": c["dealer_id"], "payee_role": "dealer",
           "amount": float(body.amount), "plan_id": body.plan_id,
           "upi_txn_id": body.upi_txn_id, "notes": body.notes,
           "screenshot_url": body.screenshot_url,
           "status": "pending", "created_at": now_iso(), "verified_at": None}
    await db.payments.insert_one(doc); return clean(doc)

@api.get("/client/payments")
async def client_list_payments(user: dict = Depends(require_role("client", allow_pending=True))):
    return await db.payments.find({"payer_id": user["id"], "payer_role": "client"}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api.get("/admin/payments")
async def admin_list_payments(_: dict = Depends(require_role("admin"))):
    items = await db.payments.find({"payee_role": "admin"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # hydrate dealer names
    dealers = {d["id"]: d["name"] for d in await db.users.find({"role": "dealer"}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    for p in items: p["payer_display"] = dealers.get(p.get("payer_id", ""), p.get("payer_name", ""))
    return items


@api.get("/dealer/plans")
async def dealer_list_plans(_: dict = Depends(require_role("dealer"))):
    items = await db.plans.find({}, {"_id": 0}).sort("price", 1).to_list(500)
    return items

@api.post("/admin/payments/{pid}/verify")
async def admin_verify_payment(pid: str, body: StatusIn, _: dict = Depends(require_role("admin"))):
    if body.status not in ("active", "pending"): raise HTTPException(status_code=400, detail="Status must be active or pending (rejected)")
    p = await db.payments.find_one({"id": pid, "payee_role": "admin"}, {"_id": 0})
    if not p: raise HTTPException(status_code=404, detail="Payment not found")
    new_status = "verified" if body.status == "active" else "rejected"
    await db.payments.update_one({"id": pid}, {"$set": {"status": new_status, "verified_at": now_iso()}})
    if new_status == "verified":
        # Activate dealer and, if this payment was for a plan, attach plan and expiry
        update_doc = {"status": "active"}
        try:
            plan_id = p.get("plan_id")
            if plan_id:
                plan_doc = await db.plans.find_one({"id": plan_id}, {"_id": 0})
                if plan_doc:
                    update_doc.update({"plan_id": plan_id, **_subscription_fields_for_plan(plan_doc)})
        except Exception:
            pass
        await db.users.update_one({"id": p["payer_id"], "role": "dealer"}, {"$set": update_doc})
    return {"ok": True, "status": new_status}


# ---------------- Startup ----------------
@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.clients.create_index("email", unique=True)
        await db.clients.create_index("id", unique=True)
        await db.templates.create_index("id", unique=True)
        await db.devices.create_index("id", unique=True)
        await db.plans.create_index("id", unique=True)
        await db.products.create_index("id", unique=True)
        await db.rooms.create_index("id", unique=True)
        # Clean up null/empty room_no_norm fields, then normalize safe room_no -> room_no_norm
        try:
            await db.rooms.update_many({"room_no_norm": None}, {"$unset": {"room_no_norm": ""}})
            await db.rooms.update_many({"room_no_norm": ""}, {"$unset": {"room_no_norm": ""}})
        except Exception:
            logger.exception("Error cleaning up empty room_no_norm fields")

        try:
            cursor = db.rooms.find({"$or": [{"room_no_norm": {"$exists": False}}, {"room_no_norm": {"$exists": False}}]}, {"_id": 0, "id": 1, "client_id": 1, "room_no": 1})
            async for r in cursor:
                room_no = r.get("room_no")
                if not room_no:
                    continue
                norm = normalize_room_no(room_no)
                if not norm:
                    continue
                # only set if no other document for this client already has the normalized value
                exists = await db.rooms.find_one({"client_id": r.get("client_id"), "room_no_norm": norm, "id": {"$ne": r.get("id")}})
                if not exists:
                    await db.rooms.update_one({"id": r.get("id")}, {"$set": {"room_no_norm": norm}})
        except Exception:
            logger.exception("Error normalizing existing room numbers")

        # Create a partial unique index that only indexes documents where room_no_norm exists.
        try:
            await db.rooms.create_index([("client_id", 1), ("room_no_norm", 1)], unique=True, partialFilterExpression={"room_no_norm": {"$exists": True}})
        except Exception:
            logger.exception("Failed to create partial unique index on rooms (client_id, room_no_norm)")
        await db.appointments.create_index("id", unique=True)
        await db.media.create_index("id", unique=True)
        await db.playlists.create_index("id", unique=True)
        try:
            await db.pairings.create_index("code", unique=True)
        except Exception:
            pass
        await db.schedules.create_index("id", unique=True)
        await db.payments.create_index("id", unique=True)
        await db.payments.create_index("payer_id")
        await db.payments.create_index("payee_id")
        await db.clinic_patients.create_index("id", unique=True)
        await db.clinic_patients.create_index([("client_id", 1), ("phone_key", 1)], unique=True)
        await db.clinic_visits.create_index("id", unique=True)
        await db.clinic_visits.create_index([("client_id", 1), ("patient_phone_key", 1), ("visit_at", -1)])
        await db.appointments.create_index([("client_id", 1), ("patient_phone_key", 1), ("created_at", -1)])
        await db.appointments.create_index([("client_id", 1), ("date", 1), ("status", 1), ("routed_location", 1)])

        # init object storage (non-blocking)
        try: init_storage()
        except Exception as e: logger.warning(f"Storage init skipped: {e}")

        admin_email = os.environ["ADMIN_EMAIL"].lower()
        admin_pw = os.environ["ADMIN_PASSWORD"]
        if not await db.users.find_one({"email": admin_email}):
            await db.users.insert_one({"id": str(uuid.uuid4()), "email": admin_email,
                "name": "Administrator", "role": "admin",
                "password_hash": hash_password(admin_pw), "created_at": now_iso()})
        if not await db.users.find_one({"email": "dealer@demo.com"}):
            await db.users.insert_one({"id": str(uuid.uuid4()), "email": "dealer@demo.com",
                "name": "Demo Dealer", "role": "dealer",
                "password_hash": hash_password("dealer123"),
                "gst_number": "29ABCDE1234F1Z5", "address": "Bangalore, India",
                "phone": "+91 9876543210", "plan": "hybrid", "wallet_balance": 5000.0,
                "status": "active", "upi_id": "demo-dealer@upi",
                "created_at": now_iso()})

        # ensure existing seeded demo accounts default to active (back-compat)
        await db.users.update_many({"role": "dealer", "status": {"$exists": False}}, {"$set": {"status": "active"}})
        await db.clients.update_many({"status": {"$exists": False}}, {"$set": {"status": "active"}})

        global REDIS_CLIENT, REDIS_SUBSCRIBER_TASK
        if REDIS_URL and redis is not None:
            try:
                REDIS_CLIENT = redis.from_url(REDIS_URL, decode_responses=True)
                await REDIS_CLIENT.ping()
                REDIS_SUBSCRIBER_TASK = asyncio.create_task(_redis_event_dispatcher())
                logger.info("Redis pub/sub enabled")
            except Exception as e:
                REDIS_CLIENT = None
                REDIS_SUBSCRIBER_TASK = None
                logger.warning(f"Redis disabled: {e}")

        global DB_READY
        DB_READY = True
    except Exception as e:
        logger.warning(f"Database startup skipped: {e}")

@app.on_event("shutdown")
async def on_shutdown():
    global REDIS_CLIENT, REDIS_SUBSCRIBER_TASK
    try:
        if REDIS_SUBSCRIBER_TASK:
            REDIS_SUBSCRIBER_TASK.cancel()
            REDIS_SUBSCRIBER_TASK = None
    except Exception:
        pass
    try:
        if REDIS_CLIENT is not None:
            await REDIS_CLIENT.close()
            REDIS_CLIENT = None
    except Exception:
        pass
    client.close()


@app.get("/api/health")
async def health_check():
    return {"ok": True}

app.include_router(api)
app.include_router(public_api)

frontend = os.environ.get("FRONTEND_URL", "")
origins = []
for item in frontend.split(",") if frontend else []:
    origin = item.strip()
    if origin:
        origins.append(origin)
origins.extend([
    "http://localhost:3000",
    "http://localhost:4000",
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "ionic://localhost",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:4000",
    "http://127.0.0.1",
])
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

