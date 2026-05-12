"""Phase 2 backend tests: plans, devices, templates layout, client role, doctor/retailer/society verticals, public booking."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://dealer-client-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
PUB = f"{BASE}/api/public"

ADMIN = {"email": "admin@admin.com", "password": "admin123"}
DEALER = {"email": "dealer@demo.com", "password": "dealer123"}


def _login(creds):
    return requests.post(f"{API}/auth/login", json=creds, timeout=20)


def H(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="session")
def admin_token():
    r = _login(ADMIN); assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def dealer_token():
    r = _login(DEALER); assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ----------- Admin Plans CRUD -----------
class TestAdminPlans:
    pid = None

    def test_create_plan(self, admin_token):
        r = requests.post(f"{API}/admin/plans", headers=H(admin_token), json={
            "name": "TEST Cloud Basic", "type": "cloud", "price": 999.0,
            "description": "Basic plan", "features": ["1 device", "Cloud sync"]
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "cloud" and d["price"] == 999.0
        assert d["features"] == ["1 device", "Cloud sync"]
        TestAdminPlans.pid = d["id"]

    def test_invalid_plan_type(self, admin_token):
        r = requests.post(f"{API}/admin/plans", headers=H(admin_token), json={
            "name": "TEST bad", "type": "bogus", "price": 1.0
        })
        assert r.status_code == 422

    def test_get_plans_includes(self, admin_token):
        r = requests.get(f"{API}/admin/plans", headers=H(admin_token))
        assert r.status_code == 200
        assert TestAdminPlans.pid in [p["id"] for p in r.json()]

    def test_update_plan(self, admin_token):
        r = requests.put(f"{API}/admin/plans/{TestAdminPlans.pid}", headers=H(admin_token),
                         json={"price": 1499.0, "type": "hybrid"})
        assert r.status_code == 200
        assert r.json()["price"] == 1499.0 and r.json()["type"] == "hybrid"

    def test_dealer_cannot_access_plans(self, dealer_token):
        r = requests.get(f"{API}/admin/plans", headers=H(dealer_token))
        assert r.status_code == 403

    def test_delete_plan(self, admin_token):
        r = requests.delete(f"{API}/admin/plans/{TestAdminPlans.pid}", headers=H(admin_token))
        assert r.status_code == 200
        # verify gone
        r2 = requests.put(f"{API}/admin/plans/{TestAdminPlans.pid}", headers=H(admin_token), json={"price": 1})
        assert r2.status_code == 404


# ----------- Templates with layout zones -----------
class TestTemplateLayout:
    tid = None

    def test_create_with_layout(self, admin_token):
        r = requests.post(f"{API}/admin/templates", headers=H(admin_token), json={
            "name": "TEST Layout Tpl", "category": "promo", "plan": "cloud",
            "assigned_dealer_ids": [],
            "layout": {"main": "video.mp4", "sidebar": "ads.png", "ticker": "Welcome!"}
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["layout"]["main"] == "video.mp4"
        assert d["layout"]["sidebar"] == "ads.png"
        assert d["layout"]["ticker"] == "Welcome!"
        TestTemplateLayout.tid = d["id"]

    def test_persist_layout_on_get(self, admin_token):
        r = requests.get(f"{API}/admin/templates", headers=H(admin_token))
        t = next((t for t in r.json() if t["id"] == TestTemplateLayout.tid), None)
        assert t and t["layout"]["main"] == "video.mp4"

    def test_update_layout(self, admin_token):
        r = requests.put(f"{API}/admin/templates/{TestTemplateLayout.tid}",
                         headers=H(admin_token),
                         json={"layout": {"main": "m2", "sidebar": "s2", "ticker": "t2"}})
        assert r.status_code == 200 and r.json()["layout"]["main"] == "m2"

    def test_cleanup(self, admin_token):
        requests.delete(f"{API}/admin/templates/{TestTemplateLayout.tid}", headers=H(admin_token))


# ----------- Admin Devices read-only -----------
class TestAdminDevices:
    def test_list_devices(self, admin_token):
        r = requests.get(f"{API}/admin/devices", headers=H(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        for d in r.json():
            assert "client_name" in d and "dealer_name" in d

    def test_dealer_forbidden(self, dealer_token):
        r = requests.get(f"{API}/admin/devices", headers=H(dealer_token))
        assert r.status_code == 403


# ----------- Dealer creates client with vertical+password -----------
@pytest.fixture(scope="module")
def doctor_client(dealer_token):
    """Create a doctor client to use across tests, then cleanup."""
    email = f"TEST_doc_{uuid.uuid4().hex[:6]}@clinic.com"
    password = "docpass123"
    r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
        "name": "TEST Dr Strange", "email": email, "password": password,
        "phone": "+91", "plan": "cloud", "vertical": "doctor"
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    yield {"id": cid, "email": email, "password": password}
    # cleanup
    requests.delete(f"{API}/dealer/clients/{cid}", headers=H(dealer_token))


@pytest.fixture(scope="module")
def retailer_client(dealer_token):
    email = f"TEST_ret_{uuid.uuid4().hex[:6]}@shop.com"
    r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
        "name": "TEST Retailer", "email": email, "password": "pass1234",
        "plan": "cloud", "vertical": "retailer"
    })
    assert r.status_code == 200
    cid = r.json()["id"]
    yield {"id": cid, "email": email, "password": "pass1234"}
    requests.delete(f"{API}/dealer/clients/{cid}", headers=H(dealer_token))


@pytest.fixture(scope="module")
def society_client(dealer_token):
    email = f"TEST_soc_{uuid.uuid4().hex[:6]}@soc.com"
    r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
        "name": "TEST Society", "email": email, "password": "pass1234",
        "plan": "cloud", "vertical": "society"
    })
    assert r.status_code == 200
    cid = r.json()["id"]
    yield {"id": cid, "email": email, "password": "pass1234"}
    requests.delete(f"{API}/dealer/clients/{cid}", headers=H(dealer_token))


def _client_token(cred):
    r = _login({"email": cred["email"], "password": cred["password"]})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


class TestClientAuth:
    def test_client_login_role_client(self, doctor_client):
        r = _login({"email": doctor_client["email"], "password": doctor_client["password"]})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "client"

    def test_email_uniqueness_users_vs_clients(self, dealer_token):
        # try to create a client with the admin's email — should fail
        r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
            "name": "x", "email": "admin@admin.com", "password": "p1", "plan": "cloud"
        })
        assert r.status_code == 400


# ----------- Client endpoints (me/stats/templates/devices) -----------
class TestClientCore:
    def test_me(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.get(f"{API}/client/me", headers=H(tok))
        assert r.status_code == 200
        assert r.json()["vertical"] == "doctor"
        assert "password_hash" not in r.json()

    def test_stats_doctor_extras(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.get(f"{API}/client/stats", headers=H(tok))
        assert r.status_code == 200
        s = r.json()
        assert s["vertical"] == "doctor" and "appointments_today" in s

    def test_stats_retailer_extras(self, retailer_client):
        tok = _client_token(retailer_client)
        r = requests.get(f"{API}/client/stats", headers=H(tok))
        assert r.status_code == 200 and "products" in r.json()

    def test_stats_society_extras(self, society_client):
        tok = _client_token(society_client)
        r = requests.get(f"{API}/client/stats", headers=H(tok))
        assert r.status_code == 200 and "rooms" in r.json()

    def test_client_cannot_access_admin(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.get(f"{API}/admin/plans", headers=H(tok))
        assert r.status_code == 403

    def test_client_cannot_access_dealer(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.get(f"{API}/dealer/clients", headers=H(tok))
        assert r.status_code == 403


# ----------- Client Devices CRUD -----------
class TestClientDevices:
    def test_create_with_autocode(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.post(f"{API}/client/devices", headers=H(tok),
                          json={"name": "Reception TV", "location": "Lobby"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "unpaired" and d["pair_code"] and len(d["pair_code"]) >= 4
        TestClientDevices.did = d["id"]

    def test_create_with_pair_code(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.post(f"{API}/client/devices", headers=H(tok),
                          json={"name": "Waiting TV", "pair_code": "123456"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "paired" and d["pair_code"] == "123456"
        TestClientDevices.did2 = d["id"]

    def test_list_devices(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.get(f"{API}/client/devices", headers=H(tok))
        assert r.status_code == 200 and len(r.json()) >= 2

    def test_update_device_name(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.put(f"{API}/client/devices/{TestClientDevices.did}",
                         headers=H(tok), json={"name": "Lobby TV"})
        assert r.status_code == 200 and r.json()["name"] == "Lobby TV"

    def test_update_device_unassigned_template_rejected(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.put(f"{API}/client/devices/{TestClientDevices.did}",
                         headers=H(tok), json={"template_id": "nonexistent-id"})
        assert r.status_code == 400

    def test_delete_devices(self, doctor_client):
        tok = _client_token(doctor_client)
        for did in (TestClientDevices.did, TestClientDevices.did2):
            r = requests.delete(f"{API}/client/devices/{did}", headers=H(tok))
            assert r.status_code == 200


# ----------- Doctor flow (profile, appointments, public booking) -----------
class TestDoctorFlow:
    def test_update_profile(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.put(f"{API}/client/doctor/profile", headers=H(tok), json={
            "specialty": "Cardiology", "qualifications": "MD", "fee": 500.0,
            "hours": "10-5", "is_open": True
        })
        assert r.status_code == 200
        assert r.json()["specialty"] == "Cardiology"

    def test_retailer_cannot_update_doctor_profile(self, retailer_client):
        tok = _client_token(retailer_client)
        r = requests.put(f"{API}/client/doctor/profile", headers=H(tok), json={"specialty": "x"})
        assert r.status_code == 403

    def test_public_doctor_profile(self, doctor_client):
        r = requests.get(f"{PUB}/doctors/{doctor_client['id']}")
        assert r.status_code == 200
        d = r.json()
        assert d["profile"]["specialty"] == "Cardiology"
        assert "queue_length" in d

    def test_public_non_doctor_404(self, retailer_client):
        r = requests.get(f"{PUB}/doctors/{retailer_client['id']}")
        assert r.status_code == 404

    def test_public_book_increments_token(self, doctor_client):
        # Book 2 patients and ensure tokens increment within the same day
        r1 = requests.post(f"{PUB}/doctors/{doctor_client['id']}/book", json={
            "patient_name": "TEST Pat1", "patient_phone": "999"
        })
        assert r1.status_code == 200, r1.text
        t1 = r1.json()["token"]
        r2 = requests.post(f"{PUB}/doctors/{doctor_client['id']}/book", json={
            "patient_name": "TEST Pat2", "patient_phone": "888"
        })
        assert r2.status_code == 200
        t2 = r2.json()["token"]
        assert t2 == t1 + 1

    def test_doctor_lists_and_updates_appointment(self, doctor_client):
        tok = _client_token(doctor_client)
        r = requests.get(f"{API}/client/doctor/appointments", headers=H(tok))
        assert r.status_code == 200
        apts = r.json()
        assert len(apts) >= 2
        aid = apts[0]["id"]
        r2 = requests.post(f"{API}/client/doctor/appointments/{aid}/status?status=called",
                           headers=H(tok))
        assert r2.status_code == 200 and r2.json()["status"] == "called"


# ----------- Retailer products CRUD -----------
class TestRetailer:
    def test_crud_products(self, retailer_client):
        tok = _client_token(retailer_client)
        r = requests.post(f"{API}/client/products", headers=H(tok), json={
            "name": "TEST Widget", "price": 99.5, "sku": "W1", "stock": 10
        })
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        # list
        rl = requests.get(f"{API}/client/products", headers=H(tok))
        assert rl.status_code == 200 and pid in [p["id"] for p in rl.json()]
        # update
        ru = requests.put(f"{API}/client/products/{pid}", headers=H(tok), json={"price": 149.0})
        assert ru.status_code == 200 and ru.json()["price"] == 149.0
        # delete
        rd = requests.delete(f"{API}/client/products/{pid}", headers=H(tok))
        assert rd.status_code == 200


# ----------- Society rooms CRUD -----------
class TestSociety:
    def test_crud_rooms(self, society_client):
        tok = _client_token(society_client)
        r = requests.post(f"{API}/client/rooms", headers=H(tok), json={
            "room_no": "A-101", "user_name": "TEST Resident", "mobile": "9999"
        })
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        rl = requests.get(f"{API}/client/rooms", headers=H(tok))
        assert rl.status_code == 200 and rid in [x["id"] for x in rl.json()]
        ru = requests.put(f"{API}/client/rooms/{rid}", headers=H(tok),
                          json={"user_name": "TEST Updated"})
        assert ru.status_code == 200 and ru.json()["user_name"] == "TEST Updated"
        rd = requests.delete(f"{API}/client/rooms/{rid}", headers=H(tok))
        assert rd.status_code == 200


# ----------- Dealer devices list filter & hydration -----------
class TestDealerDevicesScope:
    def test_dealer_devices_hydrated(self, dealer_token, doctor_client):
        tok = _client_token(doctor_client)
        # create a device under this client
        dev = requests.post(f"{API}/client/devices", headers=H(tok),
                            json={"name": "TEST DealerScope", "location": "x"}).json()
        try:
            r = requests.get(f"{API}/dealer/devices", headers=H(dealer_token))
            assert r.status_code == 200
            mine = [d for d in r.json() if d["id"] == dev["id"]]
            assert mine and mine[0]["client_name"]
        finally:
            requests.delete(f"{API}/client/devices/{dev['id']}", headers=H(tok))


# ----------- Cascade: deleting template removes from clients + devices -----------
class TestCascadeTemplate:
    def test_template_delete_cascade(self, admin_token, dealer_token):
        # create template assigned to dealer, then dealer creates client with this template,
        # client creates device pointing to it, then delete template and verify cleanup.
        me = requests.get(f"{API}/auth/me", headers=H(dealer_token)).json()
        tr = requests.post(f"{API}/admin/templates", headers=H(admin_token), json={
            "name": "TEST CascadeTpl", "category": "promo", "plan": "cloud",
            "assigned_dealer_ids": [me["id"]]
        })
        tid = tr.json()["id"]
        email = f"TEST_csc_{uuid.uuid4().hex[:6]}@x.com"
        cr = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
            "name": "TEST Cascade", "email": email, "password": "p1", "plan": "cloud",
            "assigned_template_ids": [tid]
        })
        assert cr.status_code == 200, cr.text
        cid = cr.json()["id"]
        ctok = _login({"email": email, "password": "p1"}).json()["access_token"]
        dev = requests.post(f"{API}/client/devices", headers=H(ctok), json={
            "name": "casc-dev", "template_id": tid, "pair_code": "111111"
        }).json()
        # delete template
        rdel = requests.delete(f"{API}/admin/templates/{tid}", headers=H(admin_token))
        assert rdel.status_code == 200
        # verify cascade in client
        me_c = requests.get(f"{API}/client/me", headers=H(ctok)).json()
        assert tid not in me_c.get("assigned_template_ids", [])
        # verify device template_id unset
        devs = requests.get(f"{API}/client/devices", headers=H(ctok)).json()
        d = next((x for x in devs if x["id"] == dev["id"]), None)
        assert d and not d.get("template_id")
        # cleanup
        requests.delete(f"{API}/dealer/clients/{cid}", headers=H(dealer_token))


# ----------- Cascade: deleting dealer also deletes clients + devices -----------
class TestCascadeDealer:
    def test_dealer_delete_cascade(self, admin_token):
        # Create temp dealer
        em = f"TEST_dlr_{uuid.uuid4().hex[:6]}@x.com"
        dr = requests.post(f"{API}/admin/dealers", headers=H(admin_token), json={
            "name": "TEST D", "email": em, "password": "p1", "plan": "cloud", "wallet_balance": 0
        })
        assert dr.status_code == 200
        did = dr.json()["id"]
        # Dealer login
        dtok = _login({"email": em, "password": "p1"}).json()["access_token"]
        # Dealer creates client
        cem = f"TEST_dlrcli_{uuid.uuid4().hex[:6]}@x.com"
        cr = requests.post(f"{API}/dealer/clients", headers=H(dtok), json={
            "name": "TEST DC", "email": cem, "password": "p1", "plan": "cloud"
        })
        cid = cr.json()["id"]
        # client device
        ctok = _login({"email": cem, "password": "p1"}).json()["access_token"]
        dev = requests.post(f"{API}/client/devices", headers=H(ctok), json={
            "name": "x", "pair_code": "222222"
        }).json()
        # delete dealer
        rdel = requests.delete(f"{API}/admin/dealers/{did}", headers=H(admin_token))
        assert rdel.status_code == 200
        # Verify client cannot login anymore (deleted)
        rl = _login({"email": cem, "password": "p1"})
        assert rl.status_code == 401
        # Verify device not in admin devices
        adev = requests.get(f"{API}/admin/devices", headers=H(admin_token)).json()
        assert dev["id"] not in [d["id"] for d in adev]
