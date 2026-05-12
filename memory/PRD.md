# Signage OS — Admin / Dealer / Client Panel

## Problem Statement (original)
Admin creates dealers and assigns signage templates; creates templates; manages clients (created by dealers).
Dealer panel: dealer creates/updates/deletes clients, assigns templates (only those assigned by admin).
Each dealer & client has GST, address, wallet balance, plan (Cloud / USB / Hybrid Signage).
Phase 2: Plans tab (admin creates priced plans), Devices tab (admin sees all paired screens), Templates with layout zones (main/sidebar/ticker), Client login + panel with industry verticals (doctor with public booking & tokens, retailer products, society rooms).

## Architecture
- Backend: FastAPI + Motor (MongoDB)
- Frontend: React + React Router + shadcn/ui + Tailwind
- Auth: JWT (12h access cookie + Authorization Bearer fallback via localStorage), bcrypt password hash
- Roles: `admin` (single), `dealer`, `client`

## Personas
- **Admin** — operates the platform, creates dealers + plans + templates, monitors devices.
- **Dealer** — partner/reseller; creates client accounts, assigns admin-issued templates, manages wallet.
- **Client** — end customer; pairs signage screens, picks a template per screen, manages vertical content.

## Implemented (2026-02)
### Phase 1
- JWT auth (login, logout, refresh, me)
- Admin: Dealers CRUD + wallet credit + delete-cascade
- Admin: Templates CRUD with dealer assignment
- Admin: All-clients read view, stats KPIs
- Dealer: Clients CRUD + wallet credit (debits dealer wallet) + assign templates
- Dealer: Templates list (only admin-assigned)
- Plan badges: Cloud (blue) / USB (amber) / Hybrid (emerald)
- Default seed admin (admin@admin.com/admin123) + demo dealer (dealer@demo.com/dealer123)

### Phase 2
- Admin: **Plans** CRUD (name, type, price, features) — `/admin/plans`
- Admin: **Devices** read-only view — `/admin/devices`
- Admin: **Templates layout zones** — main/sidebar/ticker with visual preview
- Dealer client form: **password**, **mobile**, **vertical**, GST, full address
- **Client role + login + panel**
  - Dashboard with vertical-specific KPIs
  - Devices CRUD (pair screens with auto-generated pair code, assign layout template)
  - Templates (read-only, assigned by dealer)
  - Storefront switches by vertical:
    - **Doctor** → profile (specialty/fee/hours), public booking URL, live appointment queue with token system (pending → called → done/cancelled)
    - **Retailer** → products CRUD (name, SKU, price, stock, image, description)
    - **Society** → rooms CRUD (room_no, resident, mobile, notes)
    - **General** → placeholder
- **Public page** `/book/:clientId` — anyone can book a doctor and receive a numbered token (no auth)

## Backlog / Next
- **P1**: Wire admin dealer-create form to pick from `Plans` (currently uses plan-type enum only)
- **P1**: a11y warning — add `DialogDescription` to all shadcn dialogs (cosmetic)
- **P2**: Live device preview / WebSocket status pings
- **P2**: Retailer shoppable public storefront (currently only inventory CMS)
- **P2**: Society visitor logs & notice board
- **P2**: Payment integration for plan billing (Stripe / Razorpay)
- **P2**: Pair-code uniqueness index + retry-on-collision
- **P3**: Rate limit `/api/public/doctors/{cid}/book` to prevent abuse

## Endpoints (key)
- `POST /api/auth/login` `POST /api/auth/logout` `GET /api/auth/me`
- `GET|POST /api/admin/plans`, `PUT|DELETE /api/admin/plans/{id}`
- `GET|POST /api/admin/dealers`, `PUT|DELETE /api/admin/dealers/{id}`, `POST /api/admin/dealers/{id}/credit`
- `GET|POST /api/admin/templates`, `PUT|DELETE /api/admin/templates/{id}` (with `layout`)
- `GET /api/admin/devices`, `GET /api/admin/clients`, `GET /api/admin/stats`
- `GET|POST /api/dealer/clients`, `PUT|DELETE /api/dealer/clients/{id}`, `POST /api/dealer/clients/{id}/credit`
- `GET /api/dealer/templates`, `/api/dealer/devices`, `/api/dealer/stats`
- `GET /api/client/me`, `GET /api/client/stats`, `GET /api/client/templates`
- `GET|POST|PUT|DELETE /api/client/devices`
- `PUT /api/client/doctor/profile`, `GET /api/client/doctor/appointments`, `POST /api/client/doctor/appointments/{id}/status?status=...`
- `GET|POST|PUT|DELETE /api/client/products`
- `GET|POST|PUT|DELETE /api/client/rooms`
- `GET /api/public/doctors/{cid}`, `POST /api/public/doctors/{cid}/book`

## Phase 3 (2026-02 — Same session)
- **Media library** (`/client/media`): upload images/videos via Emergent object storage; organize in Main/Sidebar/Ticker zone tabs; soft-delete.
- **Playlists** (`/client/playlists`): sequence media with per-item duration; reorder; bind to a zone.
- **Schedules** (`/client/schedules`): bind a playlist to selected devices with day-of-week + start/end time window; active toggle.
- **Public Signage Player** (`/play/:pairCode`): no-auth web player; polls `/api/public/player/{pair_code}` every 60s; renders main + sidebar zones (images cycle by duration, videos play to end) plus scrolling ticker; fullscreen button; sets device.status=paired on first hit.
- **Object storage**: `EMERGENT_LLM_KEY` based; supports image/jpeg/png/webp/gif and video/mp4/webm up to 50MB.
- **New backend endpoints**: `/api/client/media`, `/api/client/playlists`, `/api/client/schedules`, public `/api/media/serve/{id}`, public `/api/public/player/{pair_code}`.
- Test counts: 92/92 cumulative pytest pass (27 + 37 + 28).

## Backlog updated
- (Resolved) ~~Client sidebar missing Media/Playlists/Schedule nav items~~
- P1: Stream large videos via httpx.stream() instead of full in-memory buffer in `/api/media/serve/{id}`
- P1: Make schedule time-window timezone-aware (currently UTC)
- P2: Pair-code uniqueness index
- P2: Client-side pre-flight file size/MIME check on media upload
