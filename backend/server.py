from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Dict, Any
from urllib.parse import quote

import bcrypt
import boto3
import jwt
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from botocore.exceptions import ClientError, BotoCoreError
import io

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'signage')]
DB_READY = False

app = FastAPI()
api = APIRouter(prefix="/api")
public_api = APIRouter(prefix="/api/public")

JWT_ALGO = "HS256"
PLAN_TYPES = ("cloud", "usb", "hybrid")
VERTICALS = ("general", "doctor", "retailer", "society")

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
    price: float = 0.0
    description: str = ""
    features: List[str] = []

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["cloud", "usb", "hybrid"]] = None
    price: Optional[float] = None
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
    width: Optional[str] = None  # CSS width or grid column span
    height: Optional[str] = None  # CSS height or grid row span
    position: Optional[str] = None  # CSS grid position or flex order

class TemplateLayout(BaseModel):
    # New: dynamic zones array
    zones: List[TemplateZone] = []
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
    vertical: Literal["general", "doctor", "retailer", "society"] = "general"
    wallet_balance: float = 0.0
    assigned_template_ids: List[str] = []

class ClientUpdate(BaseModel):
    name: Optional[str] = None; email: Optional[EmailStr] = None
    password: Optional[str] = None
    phone: Optional[str] = None; gst_number: Optional[str] = None
    address: Optional[str] = None
    plan: Optional[Literal["cloud", "usb", "hybrid"]] = None
    vertical: Optional[Literal["general", "doctor", "retailer", "society"]] = None
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

class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    status: Optional[Literal["paired", "unpaired", "offline"]] = None
    template_id: Optional[str] = None

# Doctor models
class DoctorProfile(BaseModel):
    specialty: str = ""
    qualifications: str = ""
    fee: float = 0.0
    hours: str = ""
    is_open: bool = True

class AppointmentCreate(BaseModel):
    patient_name: str
    patient_phone: str
    notes: str = ""

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

# ---------------- Helpers ----------------
def now_iso(): return datetime.now(timezone.utc).isoformat()
def clean(d): d.pop("_id", None); d.pop("password_hash", None); return d
def gen_pair_code(): return str(uuid.uuid4().int)[:6]

async def hydrate_client(c: dict) -> dict:
    if not c: return c
    c.pop("_id", None); c.pop("password_hash", None)
    if c.get("dealer_id"):
        d = await db.users.find_one({"id": c["dealer_id"]}, {"_id": 0, "name": 1})
        c["dealer_name"] = d["name"] if d else ""
    return c

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
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now_iso()}
    await db.plans.insert_one(doc); return clean(doc)

@api.put("/admin/plans/{pid}")
async def update_plan(pid: str, body: PlanUpdate, _: dict = Depends(require_role("admin"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
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
    doc = {"id": str(uuid.uuid4()), "email": email, "name": body.name, "role": "dealer",
           "password_hash": hash_password(body.password),
           "gst_number": body.gst_number, "address": body.address, "phone": body.phone,
           "plan": body.plan, "plan_id": body.plan_id, "wallet_balance": float(body.wallet_balance),
           "created_at": now_iso()}
    await db.users.insert_one(doc); return clean(doc)

@api.put("/admin/dealers/{did}")
async def update_dealer(did: str, body: DealerUpdate, _: dict = Depends(require_role("admin"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items() if k != "password"}
    if body.password: upd["password_hash"] = hash_password(body.password)
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
    for c in docs: c["dealer_name"] = dealers.get(c.get("dealer_id", ""), "")
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
    for d in docs: d["dealer_name"] = user["name"]
    return docs

@api.post("/dealer/clients")
async def create_client(body: ClientCreate, user: dict = Depends(require_role("dealer"))):
    email = body.email.lower()
    if await db.clients.find_one({"email": email}) or await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    valid = set([t["id"] for t in await db.templates.find({"assigned_dealer_ids": user["id"]}, {"_id": 0, "id": 1}).to_list(1000)])
    safe = [t for t in body.assigned_template_ids if t in valid]
    doc = {"id": str(uuid.uuid4()), "name": body.name, "email": email,
           "password_hash": hash_password(body.password),
           "phone": body.phone, "gst_number": body.gst_number, "address": body.address,
           "plan": body.plan, "vertical": body.vertical, "wallet_balance": float(body.wallet_balance),
           "dealer_id": user["id"], "dealer_name": user["name"],
           "assigned_template_ids": safe, "doctor_profile": {},
           "status": "pending", "created_at": now_iso()}
    await db.clients.insert_one(doc); return clean(doc)

@api.put("/dealer/clients/{cid}")
async def update_client(cid: str, body: ClientUpdate, user: dict = Depends(require_role("dealer", allow_pending=True))):
    # dealer cannot transfer client to other dealer or change status via this endpoint
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items() if k not in ("password", "dealer_id")}
    if body.password: upd["password_hash"] = hash_password(body.password)
    # only allow specific status transitions by dealer
    if body.status and body.status not in ("active", "suspended"): upd.pop("status", None)
    if body.assigned_template_ids is not None:
        valid = set([t["id"] for t in await db.templates.find({"assigned_dealer_ids": user["id"]}, {"_id": 0, "id": 1}).to_list(1000)])
        upd["assigned_template_ids"] = [t for t in body.assigned_template_ids if t in valid]
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.clients.find_one_and_update({"id": cid, "dealer_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=404, detail="Client not found")
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
    r["dealer_name"] = user["name"]; return r

@api.get("/dealer/templates")
async def list_my_templates(user: dict = Depends(require_role("dealer"))):
    return await db.templates.find({"assigned_dealer_ids": user["id"]}, {"_id": 0}).to_list(1000)

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
    templates_count = await db.templates.count_documents({"assigned_dealer_ids": user["id"]})
    client_ids = [c["id"] for c in await db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "id": 1}).to_list(2000)]
    devices_count = await db.devices.count_documents({"client_id": {"$in": client_ids}})
    p = [{"$match": {"dealer_id": user["id"]}}, {"$group": {"_id": None, "total": {"$sum": "$wallet_balance"}}}]
    cw = await db.clients.aggregate(p).to_list(1)
    dealer = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    plan_counts = {t: 0 for t in PLAN_TYPES}
    async for c in db.clients.find({"dealer_id": user["id"]}, {"_id": 0, "plan": 1}):
        plan_counts[c.get("plan", "cloud")] = plan_counts.get(c.get("plan", "cloud"), 0) + 1
    return {"clients": clients_count, "templates": templates_count, "devices": devices_count,
            "wallet_balance": round(dealer.get("wallet_balance", 0) if dealer else 0, 2),
            "clients_wallet_total": round(cw[0]["total"] if cw else 0, 2),
            "plan_distribution": plan_counts}

# ---------------- Client: Self / Devices / Templates / Storefront ----------------
@api.get("/client/me")
async def client_me(user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    if not c: raise HTTPException(status_code=404, detail="Client not found")
    return await hydrate_client(c)

@api.get("/client/stats")
async def client_stats(user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0})
    devices = await db.devices.count_documents({"client_id": user["id"]})
    paired = await db.devices.count_documents({"client_id": user["id"], "status": "paired"})
    tpls = len(c.get("assigned_template_ids", [])) if c else 0
    extras = {}
    if c and c.get("vertical") == "doctor":
        extras["appointments_today"] = await db.appointments.count_documents({"client_id": user["id"], "date": datetime.now(timezone.utc).date().isoformat()})
    elif c and c.get("vertical") == "retailer":
        extras["products"] = await db.products.count_documents({"client_id": user["id"]})
    elif c and c.get("vertical") == "society":
        extras["rooms"] = await db.rooms.count_documents({"client_id": user["id"]})
    return {"devices": devices, "paired": paired, "templates": tpls,
            "wallet_balance": round(c.get("wallet_balance", 0) if c else 0, 2),
            "vertical": c.get("vertical", "general") if c else "general", **extras}

@api.get("/client/templates")
async def client_templates(user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "assigned_template_ids": 1})
    ids = c.get("assigned_template_ids", []) if c else []
    return await db.templates.find({"id": {"$in": ids}}, {"_id": 0}).to_list(1000)

@api.get("/client/devices")
async def list_client_devices(user: dict = Depends(require_role("client"))):
    return await db.devices.find({"client_id": user["id"]}, {"_id": 0}).to_list(2000)

@api.post("/client/devices")
async def create_device(body: DeviceCreate, user: dict = Depends(require_role("client"))):
    c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "dealer_id": 1})
    pair_code = body.pair_code or gen_pair_code()
    doc = {"id": str(uuid.uuid4()), "name": body.name, "location": body.location,
           "pair_code": pair_code, "status": "paired" if body.pair_code else "unpaired",
           "client_id": user["id"], "dealer_id": c.get("dealer_id", ""),
           "template_id": body.template_id, "paired_at": now_iso() if body.pair_code else None,
           "created_at": now_iso()}
    await db.devices.insert_one(doc); return clean(doc)

@api.put("/client/devices/{did}")
async def update_device(did: str, body: DeviceUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "template_id" in upd and upd["template_id"]:
        c = await db.clients.find_one({"id": user["id"]}, {"_id": 0, "assigned_template_ids": 1})
        if upd["template_id"] not in (c.get("assigned_template_ids") or []):
            raise HTTPException(status_code=400, detail="Template not assigned to you")
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.devices.find_one_and_update({"id": did, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Device not found")
    return r

@api.delete("/client/devices/{did}")
async def delete_device(did: str, user: dict = Depends(require_role("client"))):
    r = await db.devices.delete_one({"id": did, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Device not found")
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

# ----------- Doctor vertical -----------
@api.put("/client/doctor/profile")
async def update_doc_profile(body: DoctorProfile, user: dict = Depends(require_role("client"))):
    r = await db.clients.find_one_and_update({"id": user["id"], "vertical": "doctor"}, {"$set": {"doctor_profile": body.model_dump()}}, return_document=True, projection={"_id": 0, "password_hash": 0})
    if not r: raise HTTPException(status_code=403, detail="Not a doctor account")
    return r.get("doctor_profile", {})

@api.get("/client/doctor/appointments")
async def list_appointments(user: dict = Depends(require_role("client"))):
    return await db.appointments.find({"client_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api.post("/client/doctor/appointments/{aid}/status")
async def set_apt_status(aid: str, status: Literal["pending", "called", "done", "cancelled"], user: dict = Depends(require_role("client"))):
    r = await db.appointments.find_one_and_update({"id": aid, "client_id": user["id"]}, {"$set": {"status": status}}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Appointment not found")
    return r

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
    doc = {"id": str(uuid.uuid4()), "client_id": user["id"], **body.model_dump(), "created_at": now_iso()}
    await db.rooms.insert_one(doc); return clean(doc)

@api.put("/client/rooms/{rid}")
async def update_room(rid: str, body: RoomUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.rooms.find_one_and_update({"id": rid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Room not found")
    return r

@api.delete("/client/rooms/{rid}")
async def delete_room(rid: str, user: dict = Depends(require_role("client"))):
    r = await db.rooms.delete_one({"id": rid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Room not found")
    return {"ok": True}

# ---------------- Public: Doctor booking ----------------
@public_api.get("/doctors/{cid}")
async def public_doctor_profile(cid: str):
    c = await db.clients.find_one({"id": cid, "vertical": "doctor"}, {"_id": 0, "password_hash": 0, "wallet_balance": 0})
    if not c: raise HTTPException(status_code=404, detail="Doctor not found")
    pending = await db.appointments.count_documents({"client_id": cid, "status": "pending", "date": datetime.now(timezone.utc).date().isoformat()})
    return {"id": c["id"], "name": c["name"], "phone": c.get("phone", ""), "address": c.get("address", ""),
            "profile": c.get("doctor_profile", {}), "queue_length": pending}

@public_api.post("/doctors/{cid}/book")
async def public_doctor_book(cid: str, body: AppointmentCreate):
    c = await db.clients.find_one({"id": cid, "vertical": "doctor"}, {"_id": 0})
    if not c: raise HTTPException(status_code=404, detail="Doctor not found")
    today = datetime.now(timezone.utc).date().isoformat()
    token = await db.appointments.count_documents({"client_id": cid, "date": today}) + 1
    doc = {"id": str(uuid.uuid4()), "client_id": cid, "date": today,
           "token": token, "patient_name": body.patient_name, "patient_phone": body.patient_phone,
           "notes": body.notes, "status": "pending", "created_at": now_iso()}
    await db.appointments.insert_one(doc)
    return clean(doc)


# ==================== Object Storage ====================
S3_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("S3_ACCESS_KEY_ID", "")
S3_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY") or os.environ.get("S3_SECRET_ACCESS_KEY", "")
S3_REGION = os.environ.get("AWS_REGION") or os.environ.get("S3_REGION", "ap-southeast-2")
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL", "https://xztrjsqymgyltfivpgdj.storage.supabase.co/storage/v1/s3")
SUPABASE_PROJECT_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://xztrjsqymgyltfivpgdj.supabase.co")
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
    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    file_id = str(uuid.uuid4())
    path = f"{APP_NAME}/{user['id']}/{file_id}.{ext}"
    result = put_object(path, data, content_type)
    kind = "video" if content_type.startswith("video/") else "image"
    doc = {"id": file_id, "client_id": user["id"], "zone": zone, "folder": folder or "default",
           "name": name or file.filename or "untitled",
           "original_filename": file.filename, "kind": kind,
           "content_type": content_type, "storage_path": result.get("path", path),
           "size": len(data), "is_deleted": False, "created_at": now_iso()}
    await db.media.insert_one(doc)
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
    return r

@api.delete("/client/media/{mid}")
async def delete_media(mid: str, user: dict = Depends(require_role("client"))):
    r = await db.media.update_one({"id": mid, "client_id": user["id"]}, {"$set": {"is_deleted": True}})
    if r.matched_count == 0: raise HTTPException(status_code=404, detail="Media not found")
    return {"ok": True}

@api.get("/media/serve/{mid}")
async def serve_media(mid: str):
    """Public-readable media stream — signage players read this without auth."""
    rec = await db.media.find_one({"id": mid, "is_deleted": False}, {"_id": 0})
    if not rec: raise HTTPException(status_code=404, detail="Media not found")
    data, ctype = get_object(rec["storage_path"])
    return StreamingResponse(io.BytesIO(data), media_type=rec.get("content_type") or ctype,
                             headers={"Cache-Control": "public, max-age=3600"})

# ==================== Playlists (template-driven zones) ====================
class PlaylistItem(BaseModel):
    media_id: str
    duration: int = 10  # seconds; videos play their natural length

class PlaylistIn(BaseModel):
    name: str
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
    template_id: Optional[str] = None
    zone_items: Optional[Dict[str, List[PlaylistItem]]] = None
    main_items: Optional[List[PlaylistItem]] = None
    sidebar_items: Optional[List[PlaylistItem]] = None
    ticker_messages: Optional[List[dict]] = None

async def _validate_media(ids: List[str], client_id: str):
    if not ids: return
    owned = await db.media.count_documents({"id": {"$in": ids}, "client_id": client_id, "is_deleted": False})
    if owned != len(set(ids)):
        raise HTTPException(status_code=400, detail="Invalid media in playlist")

@api.get("/client/playlists")
async def list_playlists(user: dict = Depends(require_role("client"))):
    return await db.playlists.find({"client_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.post("/client/playlists")
async def create_playlist(body: PlaylistIn, user: dict = Depends(require_role("client"))):
    zone_items = body.zone_items or {}
    if not zone_items and (body.main_items or body.sidebar_items or body.ticker_messages):
        zone_items = {
            "main": body.main_items or [],
            "sidebar": body.sidebar_items or [],
            "ticker": [],
        }
    if body.items and body.zone:
        zone_items[body.zone] = body.items
    all_media_ids = [item.media_id for zone_list in zone_items.values() for item in zone_list]
    await _validate_media(all_media_ids, user["id"])
    doc = {
        "id": str(uuid.uuid4()),
        "client_id": user["id"],
        "name": body.name,
        "template_id": body.template_id,
        "zone_items": {zone: [item.model_dump() for item in items] for zone, items in zone_items.items()},
        "main_items": [i.model_dump() for i in (body.main_items or [])],
        "sidebar_items": [i.model_dump() for i in (body.sidebar_items or [])],
        "ticker_messages": body.ticker_messages or [],
        "created_at": now_iso(),
    }
    await db.playlists.insert_one(doc)
    return clean(doc)

@api.put("/client/playlists/{pid}")
async def update_playlist(pid: str, body: PlaylistUpdate, user: dict = Depends(require_role("client"))):
    upd: Dict[str, Any] = {}
    if body.name is not None: upd["name"] = body.name
    if body.template_id is not None: upd["template_id"] = body.template_id
    if body.zone_items is not None:
        upd["zone_items"] = {zone: [item.model_dump() for item in items] for zone, items in body.zone_items.items()}
        all_media_ids = [item.media_id for items in body.zone_items.values() for item in items]
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
            upd["zone_items"] = {zone: [item.model_dump() for item in items] for zone, items in legacy_zone_items.items()}
            await _validate_media([item.media_id for items in legacy_zone_items.values() for item in items], user["id"])
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.playlists.find_one_and_update({"id": pid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Playlist not found")
    return r

@api.delete("/client/playlists/{pid}")
async def delete_playlist(pid: str, user: dict = Depends(require_role("client"))):
    r = await db.playlists.delete_one({"id": pid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Playlist not found")
    await db.schedules.delete_many({"playlist_id": pid, "client_id": user["id"]})
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
    await db.schedules.insert_one(doc); return clean(doc)

@api.put("/client/schedules/{sid}")
async def update_schedule(sid: str, body: ScheduleUpdate, user: dict = Depends(require_role("client"))):
    upd = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if body.playlist_id:
        pl = await db.playlists.find_one({"id": body.playlist_id, "client_id": user["id"]}, {"_id": 0, "id": 1})
        if not pl: raise HTTPException(status_code=400, detail="Invalid playlist")
    if not upd: raise HTTPException(status_code=400, detail="Nothing to update")
    r = await db.schedules.find_one_and_update({"id": sid, "client_id": user["id"]}, {"$set": upd}, return_document=True, projection={"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Schedule not found")
    return r

@api.delete("/client/schedules/{sid}")
async def delete_schedule(sid: str, user: dict = Depends(require_role("client"))):
    r = await db.schedules.delete_one({"id": sid, "client_id": user["id"]})
    if r.deleted_count == 0: raise HTTPException(status_code=404, detail="Schedule not found")
    return {"ok": True}

# ==================== Public Signage Player ====================
def _hhmm_to_min(s: str) -> int:
    try:
        h, m = s.split(":"); return int(h) * 60 + int(m)
    except Exception: return 0

@public_api.get("/player/{pair_code}")
async def player_payload(pair_code: str):
    """Returns current playlist items for a device based on schedules + current time."""
    device = await db.devices.find_one({"pair_code": pair_code}, {"_id": 0})
    if not device: raise HTTPException(status_code=404, detail="Device not found. Check pair code.")
    now = datetime.now(timezone.utc)
    dow = now.weekday()
    cur_min = now.hour * 60 + now.minute

    cursor = db.schedules.find({"client_id": device["client_id"], "is_active": True,
                                "device_ids": device["id"], "days_of_week": dow})
    active_schedules = []
    async for s in cursor:
        if _hhmm_to_min(s.get("start_time", "00:00")) <= cur_min <= _hhmm_to_min(s.get("end_time", "23:59")):
            active_schedules.append(s)

    template = None
    zone_defs = []
    if device.get("template_id"):
        template = await db.templates.find_one({"id": device["template_id"]}, {"_id": 0, "layout": 1, "name": 1})
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

    async def _hydrate_items(items):
        out = []
        for item in items or []:
            m = await db.media.find_one({"id": item["media_id"], "is_deleted": False}, {"_id": 0})
            if not m: continue
            out.append({"id": m["id"], "kind": m["kind"],
                        "url": f"/api/media/serve/{m['id']}",
                        "duration": item.get("duration", 10),
                        "name": m.get("name", "")})
        return out

    async def _ingest(pl: dict):
        if pl is None: return
        zone_items = pl.get("zone_items") or {}
        if zone_items:
            for zone_id, items in zone_items.items():
                zones.setdefault(zone_id, []).extend(await _hydrate_items(items))
        else:
            # legacy single-zone schema
            if pl.get("main_items"):
                target_zone = "main" if "main" in zones else next(iter(zones.keys()), "main")
                zones.setdefault(target_zone, []).extend(await _hydrate_items(pl.get("main_items")))
            if pl.get("sidebar_items"):
                target_zone = "sidebar" if "sidebar" in zones else next(iter(zones.keys()), "main")
                zones.setdefault(target_zone, []).extend(await _hydrate_items(pl.get("sidebar_items")))
            for t in pl.get("ticker_messages") or []:
                zones.setdefault("ticker", []).append({"kind": "text", "text": t.get("text", ""), "duration": 1})
            if pl.get("items") and pl.get("zone"):
                entries = await _hydrate_items(pl.get("items"))
                zones.setdefault(pl["zone"], []).extend(entries)

    seen = set()
    for s in active_schedules:
        if s["playlist_id"] in seen: continue
        seen.add(s["playlist_id"])
        await _ingest(await db.playlists.find_one({"id": s["playlist_id"]}, {"_id": 0}))

    # fallback to latest playlist if no schedule
    if not any(zones.values()):
        pl = await db.playlists.find_one({"client_id": device["client_id"]}, {"_id": 0}, sort=[("created_at", -1)])
        await _ingest(pl)

    await db.devices.update_one({"id": device["id"]}, {"$set": {"status": "paired", "last_seen": now_iso()}})

    return {"device_id": device["id"], "device_name": device["name"],
            "client_id": device["client_id"],
            "zones": zones, "template": template,
            "poll_after_seconds": 60}



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

@api.post("/admin/payments/{pid}/verify")
async def admin_verify_payment(pid: str, body: StatusIn, _: dict = Depends(require_role("admin"))):
    if body.status not in ("active", "pending"): raise HTTPException(status_code=400, detail="Status must be active or pending (rejected)")
    p = await db.payments.find_one({"id": pid, "payee_role": "admin"}, {"_id": 0})
    if not p: raise HTTPException(status_code=404, detail="Payment not found")
    new_status = "verified" if body.status == "active" else "rejected"
    await db.payments.update_one({"id": pid}, {"$set": {"status": new_status, "verified_at": now_iso()}})
    if new_status == "verified":
        await db.users.update_one({"id": p["payer_id"], "role": "dealer"}, {"$set": {"status": "active"}})
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
        await db.appointments.create_index("id", unique=True)
        await db.media.create_index("id", unique=True)
        await db.playlists.create_index("id", unique=True)
        await db.schedules.create_index("id", unique=True)
        await db.payments.create_index("id", unique=True)
        await db.payments.create_index("payer_id")
        await db.payments.create_index("payee_id")

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
        global DB_READY
        DB_READY = True
    except Exception as e:
        logger.warning(f"Database startup skipped: {e}")

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

app.include_router(api)
app.include_router(public_api)

frontend = os.environ.get("FRONTEND_URL", "")
origins = [
    o for o in [
        frontend,
        "http://localhost:3000",
        "http://localhost:4000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:4000",
    ] if o
]
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
