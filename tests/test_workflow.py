import os
import tempfile
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["ALLOW_REGISTRATION"] = "true"
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from backend.main import app, attempts
from backend.db import *
from fraud_ml.pipeline import load, predict, NAMES


@pytest.fixture(autouse=True)
def reset():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    attempts.clear()
    with Session() as db:
        a = Account(
            reference="A1",
            name="Customer",
            city="Bengaluru",
            usual_amount=1000,
            opened_at=now() - __import__("datetime").timedelta(days=100),
        )
        db.add(a)
        db.add(
            Account(reference="A2", name="Receiver", city="Mumbai", usual_amount=2000)
        )
        db.add(Device(reference="D1"))
        db.add(Merchant(name="Retail", risk=0.1))
        db.commit()
    yield


def signup(client, email="analyst@example.com"):
    r = client.post(
        "/api/auth/register",
        json={"name": "Test Analyst", "email": email, "password": "Secure-pass-123"},
    )
    assert r.status_code == 201, r.text
    client.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r.json()["user"]


def tx():
    return {
        "reference": "TX-001",
        "account_id": 1,
        "receiver_id": 2,
        "device_id": 1,
        "merchant_id": 1,
        "amount": "2500.00",
        "city": "Bengaluru",
    }


def test_registration_hash_and_database_session():
    with TestClient(app) as c:
        u = signup(c)
        assert u["role"] == "analyst" and "password_hash" not in u
        with Session() as db:
            user = db.get(User, u["id"])
            s = db.scalars(select(LoginSession)).first()
            assert user.password_hash.startswith("$argon2")
            assert s.token_hash != c.cookies.get("frauderio_session")
            assert db.scalar(select(func.count()).select_from(Audit)) == 2


def test_protected_routes_and_logout():
    with TestClient(app) as c:
        assert c.get("/api/transactions").status_code == 401
        signup(c)
        token = c.cookies.get("frauderio_session")
        assert c.get("/api/transactions").status_code == 200
        assert c.post("/api/auth/logout").status_code == 200
        c.cookies.set("frauderio_session", token)
        assert c.get("/api/transactions").status_code == 401


def test_csrf_and_role_enforcement():
    with TestClient(app) as c:
        signup(c)
        assert c.get("/api/users").status_code == 403
        assert (
            c.post(
                "/api/thresholds", json={"low": 1, "medium": 2, "high": 3}
            ).status_code
            == 403
        )
        c.headers.pop("X-CSRF-Token")
        assert c.post("/api/transactions", json=tx()).status_code == 403


def test_duplicate_and_invalid_registration():
    with TestClient(app) as c:
        signup(c)
        assert (
            c.post(
                "/api/auth/register",
                json={
                    "name": "Duplicate",
                    "email": "ANALYST@example.com",
                    "password": "Secure-pass-123",
                },
            ).status_code
            == 409
        )
        assert (
            c.post(
                "/api/auth/register",
                json={"name": "Test", "email": "bad", "password": "short"},
            ).status_code
            == 422
        )


def test_transaction_prediction_persistence_and_account_history():
    with TestClient(app) as c:
        signup(c)
        r = c.post("/api/transactions", json=tx())
        assert r.status_code == 201, r.text
        d = r.json()
        assert 0 <= d["prediction"]["score"] <= 1000 and len(d["factors"]) == 5
        assert c.post("/api/transactions", json=tx()).status_code == 409
        assert len(c.get("/api/accounts/1").json()["transactions"]) == 1
        assert len(c.get("/api/accounts/2").json()["transactions"]) == 1
        with Session() as db:
            assert db.scalar(select(func.count()).select_from(Transaction)) == 1
            assert db.scalar(select(func.count()).select_from(Prediction)) == 1


def test_invalid_transaction_no_partial_write():
    with TestClient(app) as c:
        signup(c)
        assert (
            c.post("/api/transactions", json={**tx(), "amount": "-1"}).status_code
            == 422
        )
        assert (
            c.post("/api/transactions", json={**tx(), "account_id": 999}).status_code
            == 404
        )
        with Session() as db:
            assert db.scalar(select(func.count()).select_from(Transaction)) == 0


def test_case_feedback_and_notes():
    with TestClient(app) as c:
        signup(c)
        r = c.post("/api/transactions", json=tx()).json()
        tid = r["transaction"]["id"]
        case = c.post(
            "/api/cases",
            json={"title": "Review payment", "transaction_id": tid, "account_id": 1},
        ).json()
        assert (
            c.post(
                f'/api/cases/{case["id"]}/notes',
                json={"text": "Checked the device history"},
            ).status_code
            == 200
        )
        assert (
            c.post(
                f"/api/transactions/{tid}/feedback",
                json={"outcome": "legitimate", "reason": "Customer verified payment"},
            ).status_code
            == 200
        )
        detail = c.get(f'/api/cases/{case["id"]}').json()
        assert detail["transactions"] == [tid] and len(detail["notes"]) == 1
        assert (
            c.patch(
                f'/api/cases/{case["id"]}',
                json={"status": "closed", "resolution": "Reviewed"},
            ).status_code
            == 403
        )


def test_scenario_does_not_mutate_original():
    with TestClient(app) as c:
        signup(c)
        d = c.post("/api/transactions", json=tx()).json()
        tid = d["transaction"]["id"]
        assert (
            c.post(
                f"/api/transactions/{tid}/scenario",
                json={"amount": 500, "trusted_device": True},
            ).status_code
            == 200
        )
        assert c.get(f"/api/transactions/{tid}").json() == d


def test_origin_rejected():
    with TestClient(app) as c:
        assert (
            c.post(
                "/api/auth/login",
                headers={"Origin": "https://untrusted.invalid"},
                json={"email": "a@b.co", "password": "testing1234"},
            ).status_code
            == 403
        )


def test_threshold_versioning_and_admin_access():
    with TestClient(app) as c:
        u = signup(c)
        with Session() as db:
            db.get(User, u["id"]).role = "admin"
            db.commit()
        assert c.get("/api/users").status_code == 200
        assert (
            c.post(
                "/api/thresholds", json={"low": 500, "medium": 400, "high": 800}
            ).status_code
            == 422
        )
        assert (
            c.post(
                "/api/thresholds", json={"low": 200, "medium": 500, "high": 800}
            ).status_code
            == 200
        )
        assert c.get("/api/thresholds").json()["low"] == 200
        assert c.get("/api/sessions").status_code == 200
        assert "token_hash" not in c.get("/api/sessions").json()[0]


def test_future_events_not_used_in_features():
    from backend.services import features
    from datetime import timedelta

    with Session() as db:
        t = Transaction(**tx(), occurred_at=now())
        db.add(t)
        db.flush()
        db.add(
            AccountEvent(
                account_id=1,
                kind="password_reset",
                occurred_at=t.occurred_at + timedelta(hours=1),
            )
        )
        db.flush()
        assert features(db, t)[8] == 0


def test_model_scores_are_finite():
    import numpy as np

    result = predict([1, 0, 0, 2, 1, 0, 100, 1, 0, 0, 0, 0.1])
    assert np.isfinite(result["probability"]) and 0 <= result["probability"] <= 1
    assert load()["metrics"]["test_rows"] > 0


def test_login_and_disabled_account_revoke_sessions():
    with TestClient(app) as c:
        user = signup(c)
        assert c.post("/api/auth/logout").status_code == 200
        assert (
            c.post(
                "/api/auth/login",
                json={"email": "analyst@example.com", "password": "incorrect-password"},
            ).status_code
            == 401
        )
        login = c.post(
            "/api/auth/login",
            json={"email": "analyst@example.com", "password": "Secure-pass-123"},
        )
        assert login.status_code == 200
        c.headers["X-CSRF-Token"] = login.json()["csrf"]
        with Session() as db:
            db.get(User, user["id"]).active = False
            db.commit()
        assert c.get("/api/transactions").status_code == 403
        assert (
            c.post(
                "/api/auth/login",
                json={"email": "analyst@example.com", "password": "Secure-pass-123"},
            ).status_code
            == 401
        )


def test_catalogue_evidence_and_export_permissions():
    with TestClient(app) as c:
        user = signup(c)
        assert (
            c.post("/api/devices", json={"reference": "SECOND-DEVICE"}).status_code
            == 201
        )
        assert (
            c.post("/api/devices", json={"reference": "SECOND-DEVICE"}).status_code
            == 409
        )
        assert (
            c.post(
                "/api/merchants",
                json={"name": "Bookshop", "category": "Retail", "risk": 0.1},
            ).status_code
            == 201
        )
        assert len(c.get("/api/catalogue").json()["devices"]) == 2
        tid = c.post("/api/transactions", json=tx()).json()["transaction"]["id"]
        case_id = c.post("/api/cases", json={"title": "Evidence review"}).json()["id"]
        evidence = {"transaction_id": tid, "account_id": 2}
        for _ in range(2):
            assert (
                c.post(f"/api/cases/{case_id}/evidence", json=evidence).status_code
                == 200
            )
        detail = c.get(f"/api/cases/{case_id}").json()
        assert detail["transactions"] == [tid] and detail["accounts"] == [2]
        assert c.get("/api/export/transactions.csv").status_code == 403
        with Session() as db:
            db.get(User, user["id"]).role = "supervisor"
            db.commit()
        exported = c.get("/api/export/transactions.csv")
        assert exported.status_code == 200 and "TX-001" in exported.text
        assert c.get("/api/fraud-rings").status_code == 200
