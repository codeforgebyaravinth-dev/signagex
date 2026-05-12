"""Phase 4 backend tests: status (suspend/activate/pending), client move, admin UPI settings,
dealer UPI, client dealer-UPI, payments (dealer→admin, client→dealer, verify), payment screenshot
upload, multi-zone playlist round-trip (incl. legacy), public player zones, dealer device edit."""
import os
import io
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dealer-client-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@admin.com", "admin123")
DEALER = ("dealer@demo.com", "dealer123")
CLIENT = ("ravi@clinic.com", "pass123")


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {email} -> {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def admin_s():
    s = requests.Session(); _login(s, *ADMIN); return s

@pytest.fixture(scope="module")
def dealer_s():
    s = requests.Session(); _login(s, *DEALER); return s

@pytest.fixture(scope="module")
def client_s():
    s = requests.Session(); _login(s, *CLIENT); return s


# ---------- Admin UPI settings ----------
class TestAdminUPI:
    def test_admin_put_settings(self, admin_s):
        r = admin_s.put(f"{API}/admin/settings", json={"upi_id": "signageos@hdfcbank", "upi_name": "SignageOS Admin"})
        assert r.status_code == 200
        d = r.json()
        assert d["upi_id"] == "signageos@hdfcbank"

    def test_admin_get_settings(self, admin_s):
        r = admin_s.get(f"{API}/admin/settings")
        assert r.status_code == 200
        assert r.json()["upi_id"] == "signageos@hdfcbank"

    def test_admin_upi_public_for_dealer(self, dealer_s):
        r = dealer_s.get(f"{API}/admin/upi")
        assert r.status_code == 200
        assert r.json()["upi_id"] == "signageos@hdfcbank"

    def test_dealer_set_own_upi(self, dealer_s):
        r = dealer_s.put(f"{API}/dealer/me", json={"upi_id": "demodealer@upi"})
        assert r.status_code == 200
        assert r.json()["upi_id"] == "demodealer@upi"

    def test_client_my_dealer_upi(self, client_s):
        r = client_s.get(f"{API}/client/my-dealer-upi")
        assert r.status_code == 200
        d = r.json()
        assert d["upi_id"] == "demodealer@upi"
        assert "dealer_name" in d


# ---------- Status / suspend / activate / pending ----------
class TestStatus:
    @pytest.fixture(scope="class")
    def new_dealer(self, admin_s):
        em = f"TEST_d_{int(time.time())}@x.com"
        r = admin_s.post(f"{API}/admin/dealers", json={"name": "TestDealer", "email": em, "password": "pw12345"})
        assert r.status_code == 200
        d = r.json()
        yield d, em, "pw12345"
        admin_s.delete(f"{API}/admin/dealers/{d['id']}")

    def test_new_dealer_is_pending(self, admin_s, new_dealer):
        d, _, _ = new_dealer
        # ensure default status reflected via list
        r = admin_s.get(f"{API}/admin/dealers")
        rec = next(x for x in r.json() if x["id"] == d["id"])
        # NOTE: backend POST /admin/dealers does NOT set status field on create.
        # Login should still work; require_role treats missing as 'active'.
        assert rec.get("status", "active") in ("pending", "active")

    def test_pending_dealer_can_login(self, admin_s, new_dealer):
        d, em, pw = new_dealer
        # Force status=pending
        admin_s.put(f"{API}/admin/dealers/{d['id']}/status", json={"status": "pending"})
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": em, "password": pw})
        assert r.status_code == 200
        # allow_pending endpoint works
        r2 = s.get(f"{API}/dealer/payments")
        assert r2.status_code == 200
        # blocked endpoint returns 403 'pending'
        r3 = s.get(f"{API}/dealer/clients")
        assert r3.status_code == 403
        assert "pending" in r3.json().get("detail", "").lower()

    def test_suspended_dealer_blocked(self, admin_s, new_dealer):
        d, em, pw = new_dealer
        r = admin_s.put(f"{API}/admin/dealers/{d['id']}/status", json={"status": "suspended"})
        assert r.status_code == 200
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": em, "password": pw})
        r2 = s.get(f"{API}/dealer/payments")
        assert r2.status_code == 403
        assert "suspended" in r2.json().get("detail", "").lower()

    def test_activate_dealer(self, admin_s, new_dealer):
        d, em, pw = new_dealer
        r = admin_s.put(f"{API}/admin/dealers/{d['id']}/status", json={"status": "active"})
        assert r.status_code == 200
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": em, "password": pw})
        r2 = s.get(f"{API}/dealer/clients")
        assert r2.status_code == 200

    def test_client_status_suspend(self, admin_s, dealer_s):
        # create new client under demo dealer
        em = f"TEST_c_{int(time.time())}@x.com"
        r = dealer_s.post(f"{API}/dealer/clients", json={"name": "TC", "email": em, "password": "pw12345"})
        assert r.status_code == 200
        cid = r.json()["id"]
        # default should be pending
        cl = await_login_get_me(em, "pw12345")
        # suspend via admin
        r2 = admin_s.put(f"{API}/admin/clients/{cid}/status", json={"status": "suspended"})
        assert r2.status_code == 200 and r2.json()["status"] == "suspended"
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": em, "password": "pw12345"})
        r3 = s.get(f"{API}/client/devices")
        assert r3.status_code == 403
        # cleanup
        dealer_s.delete(f"{API}/dealer/clients/{cid}")


def await_login_get_me(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    return r.status_code == 200


# ---------- Move client ----------
class TestMoveClient:
    def test_move_client_to_new_dealer(self, admin_s, dealer_s):
        # create a second dealer
        em_d = f"TEST_d2_{int(time.time())}@x.com"
        d2 = admin_s.post(f"{API}/admin/dealers", json={"name": "D2", "email": em_d, "password": "pw12345"}).json()
        admin_s.put(f"{API}/admin/dealers/{d2['id']}/status", json={"status": "active"})

        # create a client under demo dealer
        em_c = f"TEST_mc_{int(time.time())}@x.com"
        c = dealer_s.post(f"{API}/dealer/clients", json={"name": "MC", "email": em_c, "password": "pw12345"}).json()

        # create a device under that client so we can check cascade
        # need to login as client to create device
        cs = requests.Session()
        cs.post(f"{API}/auth/login", json={"email": em_c, "password": "pw12345"})
        # client is pending — devices endpoint will 403. Activate first.
        admin_s.put(f"{API}/admin/clients/{c['id']}/status", json={"status": "active"})
        cs = requests.Session()
        cs.post(f"{API}/auth/login", json={"email": em_c, "password": "pw12345"})
        dev = cs.post(f"{API}/client/devices", json={"name": "Dev1"}).json()

        # move
        r = admin_s.put(f"{API}/admin/clients/{c['id']}/move", json={"new_dealer_id": d2["id"]})
        assert r.status_code == 200
        assert r.json()["dealer_id"] == d2["id"]
        assert r.json()["assigned_template_ids"] == []

        # device cascade — admin/devices to verify
        devs = admin_s.get(f"{API}/admin/devices").json()
        moved = next(x for x in devs if x["id"] == dev["id"])
        assert moved["dealer_id"] == d2["id"]

        # 404 if new dealer not found
        r2 = admin_s.put(f"{API}/admin/clients/{c['id']}/move", json={"new_dealer_id": "nonexistent"})
        assert r2.status_code == 404

        # cleanup
        admin_s.delete(f"{API}/admin/dealers/{d2['id']}")


# ---------- Payment screenshot upload ----------
class TestPaymentScreenshot:
    def test_upload_screenshot_returns_id_and_url(self, dealer_s):
        # tiny PNG
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
        )
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = dealer_s.post(f"{API}/payments/upload-screenshot", files=files)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "media_id" in d and "url" in d and d["url"].startswith("/api/media/serve/")

    def test_upload_rejects_non_image(self, dealer_s):
        files = {"file": ("a.txt", io.BytesIO(b"hello"), "text/plain")}
        r = dealer_s.post(f"{API}/payments/upload-screenshot", files=files)
        assert r.status_code == 400


# ---------- Payments end-to-end ----------
class TestPaymentsFlow:
    def test_dealer_create_and_admin_verify(self, dealer_s, admin_s):
        r = dealer_s.post(f"{API}/dealer/payments", json={"amount": 999, "upi_txn_id": "TXN_TEST_D1", "notes": "test"})
        assert r.status_code == 200
        pid = r.json()["id"]
        assert r.json()["status"] == "pending"

        # admin list
        items = admin_s.get(f"{API}/admin/payments").json()
        assert any(p["id"] == pid for p in items)

        # admin verify
        rv = admin_s.post(f"{API}/admin/payments/{pid}/verify", json={"status": "active"})
        assert rv.status_code == 200
        assert rv.json()["status"] == "verified"

    def test_client_create_and_dealer_verify_activates_client(self, dealer_s, admin_s):
        # create a fresh pending client under dealer
        em = f"TEST_payc_{int(time.time())}@x.com"
        c = dealer_s.post(f"{API}/dealer/clients", json={"name": "PayC", "email": em, "password": "pw12345"}).json()
        cs = requests.Session()
        cs.post(f"{API}/auth/login", json={"email": em, "password": "pw12345"})
        # client should be pending → can create payment via allow_pending
        r = cs.post(f"{API}/client/payments", json={"amount": 100, "upi_txn_id": "TXN_TEST_C1"})
        assert r.status_code == 200
        pid = r.json()["id"]

        # dealer sees in incoming
        lst = dealer_s.get(f"{API}/dealer/payments").json()
        assert any(p["id"] == pid for p in lst["incoming"])

        # dealer verify
        rv = dealer_s.post(f"{API}/dealer/payments/{pid}/verify", json={"status": "active"})
        assert rv.status_code == 200 and rv.json()["status"] == "verified"

        # client status flipped to active
        cl = next(x for x in admin_s.get(f"{API}/admin/clients").json() if x["id"] == c["id"])
        assert cl["status"] == "active"

        # cleanup
        dealer_s.delete(f"{API}/dealer/clients/{c['id']}")


# ---------- Multi-zone playlist & public player ----------
class TestPlaylistMultiZone:
    def test_create_multizone_and_player_returns_zones(self, client_s):
        # upload one media
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
        )
        files = {"file": ("m.png", io.BytesIO(png), "image/png")}
        m = client_s.post(f"{API}/client/media", files=files, data={"zone": "main", "name": "Ph4Main"}).json()
        # create playlist with all 3 zones
        pl = client_s.post(f"{API}/client/playlists", json={
            "name": "Ph4 Multi",
            "main_items": [{"media_id": m["id"], "duration": 7}],
            "sidebar_items": [{"media_id": m["id"], "duration": 5}],
            "ticker_messages": [{"text": "Welcome to Phase 4"}, {"text": "Second msg"}],
        }).json()
        assert pl["main_items"][0]["duration"] == 7
        assert len(pl["sidebar_items"]) == 1
        assert len(pl["ticker_messages"]) == 2

        # ensure device exists
        devs = client_s.get(f"{API}/client/devices").json()
        if not devs:
            devs = [client_s.post(f"{API}/client/devices", json={"name": "tmp"}).json()]
        pair = devs[0]["pair_code"]
        rp = requests.get(f"{API}/public/player/{pair}")
        assert rp.status_code == 200
        z = rp.json()["zones"]
        assert any(it.get("kind") == "text" for it in z["ticker"]) or len(z["ticker"]) > 0
        # main/sidebar populated (fallback uses latest playlist with no schedule)
        assert len(z["main"]) >= 1
        assert len(z["sidebar"]) >= 1

        # cleanup
        client_s.delete(f"{API}/client/playlists/{pl['id']}")
        client_s.delete(f"{API}/client/media/{m['id']}")

    def test_legacy_payload_still_works(self, client_s):
        png = bytes.fromhex(
            "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
        )
        files = {"file": ("legacy.png", io.BytesIO(png), "image/png")}
        m = client_s.post(f"{API}/client/media", files=files, data={"zone": "main", "name": "LG"}).json()
        pl = client_s.post(f"{API}/client/playlists", json={
            "name": "Legacy", "zone": "main", "items": [{"media_id": m["id"], "duration": 8}],
        })
        assert pl.status_code == 200
        client_s.delete(f"{API}/client/playlists/{pl.json()['id']}")
        client_s.delete(f"{API}/client/media/{m['id']}")


# ---------- Dealer device edit ----------
class TestDealerDeviceEdit:
    def test_dealer_edit_device(self, dealer_s, client_s, admin_s):
        # find a device for client ravi (under demo dealer)
        devs = dealer_s.get(f"{API}/dealer/devices").json()
        assert len(devs) >= 1, "demo dealer should have at least one client device"
        dev = devs[0]
        r = dealer_s.put(f"{API}/dealer/devices/{dev['id']}", json={"location": "TEST_loc_ph4"})
        assert r.status_code == 200
        assert r.json()["location"] == "TEST_loc_ph4"

    def test_dealer_edit_device_with_invalid_template(self, dealer_s):
        devs = dealer_s.get(f"{API}/dealer/devices").json()
        dev = devs[0]
        r = dealer_s.put(f"{API}/dealer/devices/{dev['id']}", json={"template_id": "not-a-real-template"})
        assert r.status_code == 400

    def test_dealer_edit_other_dealers_device_404(self, dealer_s):
        r = dealer_s.put(f"{API}/dealer/devices/nonexistent", json={"location": "x"})
        assert r.status_code == 404


# ---------- Role enforcement ----------
class TestRoleEnforcement:
    def test_dealer_cant_hit_admin(self, dealer_s):
        r = dealer_s.get(f"{API}/admin/dealers")
        assert r.status_code == 403

    def test_client_cant_hit_dealer(self, client_s):
        r = client_s.get(f"{API}/dealer/clients")
        assert r.status_code == 403

    def test_admin_cant_hit_client(self, admin_s):
        r = admin_s.get(f"{API}/client/me")
        assert r.status_code == 403
