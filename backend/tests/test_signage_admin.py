"""Backend tests for signage admin/dealer app."""
import os
import uuid
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://dealer-client-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@admin.com", "password": "admin123"}
DEALER = {"email": "dealer@demo.com", "password": "dealer123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    return r


@pytest.fixture(scope="session")
def admin_token():
    r = _login(ADMIN)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def dealer_token():
    r = _login(DEALER)
    assert r.status_code == 200, f"Dealer login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---- Auth ----
class TestAuth:
    def test_admin_login_returns_token_and_user(self):
        r = _login(ADMIN)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and data["user"]["role"] == "admin"

    def test_dealer_login(self):
        r = _login(DEALER)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "dealer"

    def test_invalid_login(self):
        r = _login({"email": "admin@admin.com", "password": "wrong"})
        assert r.status_code == 401

    def test_me_admin(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=H(admin_token))
        assert r.status_code == 200 and r.json()["role"] == "admin"

    def test_me_unauth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_logout(self, admin_token):
        r = requests.post(f"{API}/auth/logout", headers=H(admin_token))
        assert r.status_code == 200


# ---- Role enforcement ----
class TestRoles:
    def test_dealer_cannot_access_admin(self, dealer_token):
        r = requests.get(f"{API}/admin/dealers", headers=H(dealer_token))
        assert r.status_code == 403

    def test_admin_cannot_access_dealer(self, admin_token):
        r = requests.get(f"{API}/dealer/clients", headers=H(admin_token))
        assert r.status_code == 403

    def test_invalid_plan_422(self, admin_token):
        r = requests.post(f"{API}/admin/dealers", headers=H(admin_token), json={
            "name": "TEST_x", "email": f"test_{uuid.uuid4().hex[:6]}@x.com",
            "password": "p1", "plan": "bogus"
        })
        assert r.status_code == 422


# ---- Admin Dealers CRUD ----
class TestAdminDealers:
    created_id = None
    email = f"test_dealer_{uuid.uuid4().hex[:6]}@test.com"

    def test_create(self, admin_token):
        r = requests.post(f"{API}/admin/dealers", headers=H(admin_token), json={
            "name": "TEST Dealer", "email": self.email, "password": "pass1234",
            "gst_number": "GST1", "address": "Addr", "phone": "+91", "plan": "cloud",
            "wallet_balance": 100
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == self.email and d["plan"] == "cloud"
        TestAdminDealers.created_id = d["id"]

    def test_list_includes(self, admin_token):
        r = requests.get(f"{API}/admin/dealers", headers=H(admin_token))
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert TestAdminDealers.created_id in ids

    def test_update(self, admin_token):
        r = requests.put(f"{API}/admin/dealers/{TestAdminDealers.created_id}",
                         headers=H(admin_token), json={"name": "TEST Updated", "plan": "hybrid"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST Updated"
        assert r.json()["plan"] == "hybrid"

    def test_credit(self, admin_token):
        r = requests.post(f"{API}/admin/dealers/{TestAdminDealers.created_id}/credit",
                          headers=H(admin_token), json={"amount": 500})
        assert r.status_code == 200
        assert r.json()["wallet_balance"] == 600

    def test_delete_and_cascade(self, admin_token):
        r = requests.delete(f"{API}/admin/dealers/{TestAdminDealers.created_id}", headers=H(admin_token))
        assert r.status_code == 200
        # verify
        r2 = requests.get(f"{API}/admin/dealers", headers=H(admin_token))
        assert TestAdminDealers.created_id not in [x["id"] for x in r2.json()]


# ---- Admin Templates ----
class TestAdminTemplates:
    tid = None

    def test_create(self, admin_token, dealer_token):
        # Get dealer id from /auth/me
        me = requests.get(f"{API}/auth/me", headers=H(dealer_token)).json()
        r = requests.post(f"{API}/admin/templates", headers=H(admin_token), json={
            "name": "TEST Tpl", "category": "promo", "plan": "cloud",
            "assigned_dealer_ids": [me["id"]]
        })
        assert r.status_code == 200, r.text
        TestAdminTemplates.tid = r.json()["id"]
        assert me["id"] in r.json()["assigned_dealer_ids"]

    def test_dealer_sees_template(self, dealer_token):
        r = requests.get(f"{API}/dealer/templates", headers=H(dealer_token))
        assert r.status_code == 200
        assert TestAdminTemplates.tid in [t["id"] for t in r.json()]

    def test_update(self, admin_token):
        r = requests.put(f"{API}/admin/templates/{TestAdminTemplates.tid}",
                         headers=H(admin_token), json={"name": "TEST Tpl 2"})
        assert r.status_code == 200 and r.json()["name"] == "TEST Tpl 2"

    def test_delete(self, admin_token):
        r = requests.delete(f"{API}/admin/templates/{TestAdminTemplates.tid}", headers=H(admin_token))
        assert r.status_code == 200


# ---- Admin clients + stats ----
class TestAdminMisc:
    def test_clients_list(self, admin_token):
        r = requests.get(f"{API}/admin/clients", headers=H(admin_token))
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_stats(self, admin_token):
        r = requests.get(f"{API}/admin/stats", headers=H(admin_token))
        assert r.status_code == 200
        s = r.json()
        for k in ("dealers", "clients", "templates", "total_wallet", "plan_distribution"):
            assert k in s


# ---- Dealer flows ----
class TestDealerFlows:
    cid = None
    tpl_id = None

    def test_create_client(self, dealer_token, admin_token):
        # admin creates template assigned to dealer first
        me = requests.get(f"{API}/auth/me", headers=H(dealer_token)).json()
        tr = requests.post(f"{API}/admin/templates", headers=H(admin_token), json={
            "name": "TEST D-Tpl", "category": "promo", "plan": "cloud",
            "assigned_dealer_ids": [me["id"]]
        })
        TestDealerFlows.tpl_id = tr.json()["id"]
        # not-assigned template
        tr2 = requests.post(f"{API}/admin/templates", headers=H(admin_token), json={
            "name": "TEST Other", "category": "promo", "plan": "cloud", "assigned_dealer_ids": []
        })
        other_id = tr2.json()["id"]
        r = requests.post(f"{API}/dealer/clients", headers=H(dealer_token), json={
            "name": "TEST Client", "email": f"c_{uuid.uuid4().hex[:6]}@t.com",
            "password": "pass1234",
            "plan": "cloud", "assigned_template_ids": [TestDealerFlows.tpl_id, other_id]
        })
        assert r.status_code == 200, r.text
        TestDealerFlows.cid = r.json()["id"]
        # filtering check: only the assigned template should remain
        assert TestDealerFlows.tpl_id in r.json()["assigned_template_ids"]
        assert other_id not in r.json()["assigned_template_ids"]
        # cleanup other
        requests.delete(f"{API}/admin/templates/{other_id}", headers=H(admin_token))

    def test_list_own_clients(self, dealer_token):
        r = requests.get(f"{API}/dealer/clients", headers=H(dealer_token))
        assert r.status_code == 200
        assert TestDealerFlows.cid in [c["id"] for c in r.json()]

    def test_credit_client(self, dealer_token):
        # dealer seed wallet is 5000. Credit 100.
        r = requests.post(f"{API}/dealer/clients/{TestDealerFlows.cid}/credit",
                          headers=H(dealer_token), json={"amount": 100})
        assert r.status_code == 200
        assert r.json()["wallet_balance"] >= 100

    def test_credit_insufficient(self, dealer_token):
        r = requests.post(f"{API}/dealer/clients/{TestDealerFlows.cid}/credit",
                          headers=H(dealer_token), json={"amount": 9999999})
        assert r.status_code == 400

    def test_update_client(self, dealer_token):
        r = requests.put(f"{API}/dealer/clients/{TestDealerFlows.cid}",
                         headers=H(dealer_token), json={"name": "TEST Updated Client"})
        assert r.status_code == 200 and r.json()["name"] == "TEST Updated Client"

    def test_dealer_stats(self, dealer_token):
        r = requests.get(f"{API}/dealer/stats", headers=H(dealer_token))
        assert r.status_code == 200
        for k in ("clients", "templates", "wallet_balance", "plan_distribution"):
            assert k in r.json()

    def test_delete_client(self, dealer_token, admin_token):
        r = requests.delete(f"{API}/dealer/clients/{TestDealerFlows.cid}", headers=H(dealer_token))
        assert r.status_code == 200
        # cleanup template
        requests.delete(f"{API}/admin/templates/{TestDealerFlows.tpl_id}", headers=H(admin_token))
