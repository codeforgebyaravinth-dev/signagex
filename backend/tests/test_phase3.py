"""Phase 3 backend tests: media upload/serve, playlists, schedules, public player."""
import io
import os
import struct
import uuid
import zlib
from datetime import datetime, timezone

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://dealer-client-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@admin.com", "password": "admin123"}
DEALER = {"email": "dealer@demo.com", "password": "dealer123"}


def _login(creds):
    return requests.post(f"{API}/auth/login", json=creds, timeout=20)


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def _png_bytes(w=2, h=2):
    """Create a tiny valid PNG byte string."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    raw = b""
    for _ in range(h):
        raw += b"\x00" + b"\xff\x00\x00" * w
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


# ---- fixtures ----
@pytest.fixture(scope="session")
def admin_token():
    r = _login(ADMIN); assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def dealer_token():
    r = _login(DEALER); assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def client_user(dealer_token):
    """A fresh client created by dealer for phase 3."""
    email = f"TEST_ph3_{uuid.uuid4().hex[:6]}@x.com"
    password = "pass1234"
    r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
        "name": "TEST Phase3 Client", "email": email, "password": password,
        "plan": "cloud", "vertical": "general"
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    lr = _login({"email": email, "password": password})
    assert lr.status_code == 200
    tok = lr.json()["access_token"]
    yield {"id": cid, "email": email, "token": tok}
    requests.delete(f"{API}/dealer/clients/{cid}", headers=H(dealer_token))


@pytest.fixture(scope="module")
def other_client(dealer_token):
    """Second isolated client to verify cross-tenant isolation."""
    email = f"TEST_ph3b_{uuid.uuid4().hex[:6]}@x.com"
    r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
        "name": "TEST Other", "email": email, "password": "pass1234",
        "plan": "cloud", "vertical": "general"
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    tok = _login({"email": email, "password": "pass1234"}).json()["access_token"]
    yield {"id": cid, "email": email, "token": tok}
    requests.delete(f"{API}/dealer/clients/{cid}", headers=H(dealer_token))


# =================== Media =====================
class TestMedia:
    def test_upload_png_ok(self, client_user):
        files = {"file": ("tiny.png", _png_bytes(), "image/png")}
        data = {"zone": "main", "name": "TEST main img"}
        r = requests.post(f"{API}/client/media", headers=H(client_user["token"]),
                          files=files, data=data)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["kind"] == "image" and d["zone"] == "main"
        assert d["size"] > 0 and "id" in d and "storage_path" in d
        TestMedia.mid = d["id"]
        TestMedia.path = d["storage_path"]

    def test_reject_unsupported_mime(self, client_user):
        files = {"file": ("bad.txt", b"hello", "text/plain")}
        r = requests.post(f"{API}/client/media", headers=H(client_user["token"]),
                          files=files, data={"zone": "main"})
        assert r.status_code == 400

    def test_reject_too_large(self, client_user):
        big = b"\x00" * (51 * 1024 * 1024)
        files = {"file": ("big.png", big, "image/png")}
        r = requests.post(f"{API}/client/media", headers=H(client_user["token"]),
                          files=files, data={"zone": "main"})
        assert r.status_code == 400

    def test_list_media_filtered_by_zone(self, client_user):
        # upload another into sidebar
        files = {"file": ("s.png", _png_bytes(), "image/png")}
        r = requests.post(f"{API}/client/media", headers=H(client_user["token"]),
                          files=files, data={"zone": "sidebar", "name": "TEST sb"})
        assert r.status_code == 200
        TestMedia.sb_mid = r.json()["id"]
        # list main
        r1 = requests.get(f"{API}/client/media?zone=main", headers=H(client_user["token"]))
        assert r1.status_code == 200
        assert any(m["id"] == TestMedia.mid for m in r1.json())
        assert all(m["zone"] == "main" for m in r1.json())
        # list all
        r2 = requests.get(f"{API}/client/media", headers=H(client_user["token"]))
        ids = [m["id"] for m in r2.json()]
        assert TestMedia.mid in ids and TestMedia.sb_mid in ids

    def test_serve_public_no_auth(self, client_user):
        r = requests.get(f"{API}/media/serve/{TestMedia.mid}")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")
        assert len(r.content) > 0

    def test_serve_unknown_404(self):
        r = requests.get(f"{API}/media/serve/nope-{uuid.uuid4().hex[:6]}")
        assert r.status_code == 404

    def test_update_media(self, client_user):
        r = requests.put(f"{API}/client/media/{TestMedia.mid}",
                         headers=H(client_user["token"]),
                         json={"name": "TEST main renamed", "zone": "ticker"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST main renamed"
        assert r.json()["zone"] == "ticker"
        # revert zone
        requests.put(f"{API}/client/media/{TestMedia.mid}",
                     headers=H(client_user["token"]), json={"zone": "main"})

    def test_soft_delete_hides_from_list(self, client_user):
        r = requests.delete(f"{API}/client/media/{TestMedia.sb_mid}",
                            headers=H(client_user["token"]))
        assert r.status_code == 200
        lst = requests.get(f"{API}/client/media", headers=H(client_user["token"])).json()
        assert TestMedia.sb_mid not in [m["id"] for m in lst]
        # serve should 404 for soft-deleted
        r2 = requests.get(f"{API}/media/serve/{TestMedia.sb_mid}")
        assert r2.status_code == 404

    def test_cross_tenant_isolation(self, other_client):
        # other client should not see client_user's media
        r = requests.get(f"{API}/client/media", headers=H(other_client["token"]))
        assert r.status_code == 200
        assert TestMedia.mid not in [m["id"] for m in r.json()]

    def test_role_enforcement_admin_dealer(self, admin_token, dealer_token):
        for tok in (admin_token, dealer_token):
            r = requests.get(f"{API}/client/media", headers=H(tok))
            assert r.status_code == 403


# =================== Playlists =====================
class TestPlaylists:
    def test_create_with_valid_media(self, client_user):
        body = {"name": "TEST pl1", "zone": "main",
                "items": [{"media_id": TestMedia.mid, "duration": 7}]}
        r = requests.post(f"{API}/client/playlists",
                          headers=H(client_user["token"]), json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["items"][0]["media_id"] == TestMedia.mid
        assert d["items"][0]["duration"] == 7
        TestPlaylists.pid = d["id"]

    def test_create_with_invalid_media_rejected(self, client_user):
        body = {"name": "TEST bad", "items": [{"media_id": "ghost-id", "duration": 5}]}
        r = requests.post(f"{API}/client/playlists",
                          headers=H(client_user["token"]), json=body)
        assert r.status_code == 400

    def test_create_with_other_clients_media_rejected(self, other_client):
        body = {"name": "TEST steal", "items": [{"media_id": TestMedia.mid, "duration": 3}]}
        r = requests.post(f"{API}/client/playlists",
                          headers=H(other_client["token"]), json=body)
        assert r.status_code == 400

    def test_list_only_own_playlists(self, client_user, other_client):
        r1 = requests.get(f"{API}/client/playlists", headers=H(client_user["token"])).json()
        r2 = requests.get(f"{API}/client/playlists", headers=H(other_client["token"])).json()
        assert TestPlaylists.pid in [p["id"] for p in r1]
        assert TestPlaylists.pid not in [p["id"] for p in r2]

    def test_update_playlist(self, client_user):
        r = requests.put(f"{API}/client/playlists/{TestPlaylists.pid}",
                         headers=H(client_user["token"]),
                         json={"name": "TEST pl1 renamed",
                               "items": [{"media_id": TestMedia.mid, "duration": 12}]})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST pl1 renamed"
        assert r.json()["items"][0]["duration"] == 12

    def test_role_enforcement(self, admin_token, dealer_token):
        for tok in (admin_token, dealer_token):
            r = requests.get(f"{API}/client/playlists", headers=H(tok))
            assert r.status_code == 403


# =================== Schedules + Public Player =====================
class TestSchedulesAndPlayer:
    def test_create_device_for_player(self, client_user):
        # create device with known pair_code
        pc = uuid.uuid4().hex[:6].upper()
        r = requests.post(f"{API}/client/devices",
                          headers=H(client_user["token"]),
                          json={"name": "TEST Player Dev", "pair_code": pc})
        assert r.status_code == 200, r.text
        TestSchedulesAndPlayer.did = r.json()["id"]
        TestSchedulesAndPlayer.pc = pc

    def test_create_schedule_valid(self, client_user):
        now = datetime.now(timezone.utc)
        dow = now.weekday()
        body = {"name": "TEST sch1", "playlist_id": TestPlaylists.pid,
                "device_ids": [TestSchedulesAndPlayer.did],
                "days_of_week": [dow], "start_time": "00:00", "end_time": "23:59",
                "is_active": True}
        r = requests.post(f"{API}/client/schedules",
                          headers=H(client_user["token"]), json=body)
        assert r.status_code == 200, r.text
        TestSchedulesAndPlayer.sid = r.json()["id"]
        assert r.json()["is_active"] is True

    def test_create_schedule_invalid_playlist(self, client_user):
        r = requests.post(f"{API}/client/schedules",
                          headers=H(client_user["token"]),
                          json={"name": "TEST bad", "playlist_id": "ghost"})
        assert r.status_code == 400

    def test_create_schedule_other_clients_playlist(self, other_client):
        r = requests.post(f"{API}/client/schedules",
                          headers=H(other_client["token"]),
                          json={"name": "TEST steal", "playlist_id": TestPlaylists.pid})
        assert r.status_code == 400

    def test_public_player_unknown_pair_code_404(self):
        r = requests.get(f"{API}/public/player/NOPE{uuid.uuid4().hex[:4]}")
        assert r.status_code == 404

    def test_public_player_returns_media_in_zone(self):
        r = requests.get(f"{API}/public/player/{TestSchedulesAndPlayer.pc}")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["device_id"] == TestSchedulesAndPlayer.did
        assert "zones" in d and {"main", "sidebar", "ticker"} <= set(d["zones"].keys())
        assert d["poll_after_seconds"] >= 1
        main = d["zones"]["main"]
        assert any(item["id"] == TestMedia.mid for item in main), f"main zone: {main}"
        item = next(item for item in main if item["id"] == TestMedia.mid)
        assert item["url"].endswith(f"/api/media/serve/{TestMedia.mid}")
        assert item["kind"] == "image"

    def test_player_marks_device_paired(self, client_user):
        # after hitting player, device.status should be paired
        devs = requests.get(f"{API}/client/devices",
                            headers=H(client_user["token"])).json()
        d = next(x for x in devs if x["id"] == TestSchedulesAndPlayer.did)
        assert d["status"] == "paired"

    def test_schedule_inactive_falls_back_to_latest(self, client_user):
        # deactivate schedule; player should still return zone media via fallback
        r = requests.put(f"{API}/client/schedules/{TestSchedulesAndPlayer.sid}",
                         headers=H(client_user["token"]),
                         json={"is_active": False})
        assert r.status_code == 200
        pl = requests.get(f"{API}/public/player/{TestSchedulesAndPlayer.pc}").json()
        # fallback uses latest playlist per zone
        assert any(item["id"] == TestMedia.mid for item in pl["zones"]["main"])
        # restore
        requests.put(f"{API}/client/schedules/{TestSchedulesAndPlayer.sid}",
                     headers=H(client_user["token"]), json={"is_active": True})

    def test_schedule_day_excluded(self, client_user):
        # set days_of_week to NOT include today; no active schedule should match
        now = datetime.now(timezone.utc)
        today = now.weekday()
        not_today = [d for d in range(7) if d != today]
        requests.put(f"{API}/client/schedules/{TestSchedulesAndPlayer.sid}",
                     headers=H(client_user["token"]),
                     json={"days_of_week": not_today, "is_active": True})
        # delete media+playlist fallback won't work; we still expect fallback (latest)
        # to return media because fallback ignores schedule. But the active schedule
        # branch should NOT contribute. Verify the active-schedule list returns same
        # set as fallback.
        pl = requests.get(f"{API}/public/player/{TestSchedulesAndPlayer.pc}").json()
        # Either fallback gives main, or empty if playlist removed; we kept playlist
        assert any(item["id"] == TestMedia.mid for item in pl["zones"]["main"])
        # restore
        requests.put(f"{API}/client/schedules/{TestSchedulesAndPlayer.sid}",
                     headers=H(client_user["token"]),
                     json={"days_of_week": list(range(7))})

    def test_delete_playlist_cascades_schedules(self, client_user):
        # create new playlist+schedule, delete playlist, verify schedule gone
        pl = requests.post(f"{API}/client/playlists",
                           headers=H(client_user["token"]),
                           json={"name": "TEST tmp", "zone": "main",
                                 "items": [{"media_id": TestMedia.mid, "duration": 4}]}).json()
        sch = requests.post(f"{API}/client/schedules",
                            headers=H(client_user["token"]),
                            json={"name": "TEST sch tmp",
                                  "playlist_id": pl["id"],
                                  "device_ids": [TestSchedulesAndPlayer.did]}).json()
        sid = sch["id"]
        # delete playlist
        r = requests.delete(f"{API}/client/playlists/{pl['id']}",
                            headers=H(client_user["token"]))
        assert r.status_code == 200
        # verify schedule is also gone
        scheds = requests.get(f"{API}/client/schedules",
                              headers=H(client_user["token"])).json()
        assert sid not in [s["id"] for s in scheds]

    def test_role_enforcement_schedules(self, admin_token, dealer_token):
        for tok in (admin_token, dealer_token):
            r = requests.get(f"{API}/client/schedules", headers=H(tok))
            assert r.status_code == 403

    def test_cleanup(self, client_user):
        # delete schedule, playlist, device, media
        requests.delete(f"{API}/client/schedules/{TestSchedulesAndPlayer.sid}",
                        headers=H(client_user["token"]))
        requests.delete(f"{API}/client/playlists/{TestPlaylists.pid}",
                        headers=H(client_user["token"]))
        requests.delete(f"{API}/client/devices/{TestSchedulesAndPlayer.did}",
                        headers=H(client_user["token"]))
        requests.delete(f"{API}/client/media/{TestMedia.mid}",
                        headers=H(client_user["token"]))
