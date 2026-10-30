import os, secrets, hashlib, re, time
from datetime import timedelta, datetime
from decimal import Decimal
from typing import Literal
from collections import defaultdict, deque
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func, or_
from sqlalchemy.exc import IntegrityError
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from .db import *
from .services import serialize, score, graph, features
from fraud_ml.pipeline import load, predict, NAMES

app = FastAPI(title="Frauderio Nexus", version="1.0.0")
hasher = PasswordHasher()
dummy_hash = hasher.hash(secrets.token_urlsafe(32))
attempts = defaultdict(deque)


def database():
    with Session() as db:
        yield db


def fail(code, msg):
    raise HTTPException(code, msg)


def audit(db, u, action, entity="", detail=None):
    db.add(
        Audit(
            user_id=u.id if u else None,
            action=action,
            entity=str(entity),
            detail=detail or {},
        )
    )


def current(request: Request, db=Depends(database)):
    token = request.cookies.get("frauderio_session", "")
    s = db.scalars(
        select(LoginSession).where(
            LoginSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
            LoginSession.revoked_at.is_(None),
            LoginSession.expires_at > now(),
        )
    ).first()
    if not s:
        fail(401, "Please sign in")
    user = db.get(User, s.user_id)
    if not user.active:
        fail(403, "Account disabled")
    if request.method not in ("GET", "HEAD", "OPTIONS") and not secrets.compare_digest(
        request.headers.get("X-CSRF-Token", ""), s.csrf
    ):
        fail(403, "Invalid request token")
    request.state.session = s
    return user


def admin(u=Depends(current)):
    if u.role != "admin":
        fail(403, "Administrator access required")
    return u


def supervisor(u=Depends(current)):
    if u.role not in ("admin", "supervisor"):
        fail(403, "Supervisor access required")
    return u


def get(db, cls, id):
    obj = db.get(cls, id)
    if not obj:
        fail(404, "Record not found")
    return obj


def public_user(u):
    return {
        k: getattr(u, k)
        for k in [
            "id",
            "name",
            "email",
            "role",
            "active",
            "created_at",
            "last_login_at",
        ]
    }


@app.middleware("http")
async def protections(request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        allowed = {
            os.getenv("APP_ORIGIN", "http://localhost:5173"),
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        }
        if origin and origin not in allowed:
            return JSONResponse({"detail": "Origin not permitted"}, 403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        v = v.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v):
            raise ValueError("Enter a valid email address")
        return v


class Registration(Credentials):
    name: str = Field(min_length=2, max_length=100)


def throttle(request):
    key = request.client.host if request.client else "unknown"
    q = attempts[key]
    ts = time.monotonic()
    while q and q[0] < ts - 60:
        q.popleft()
    if len(q) >= 12:
        fail(429, "Too many attempts. Wait one minute.")
    q.append(ts)


def session_response(db, u, response):
    token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    db.add(
        LoginSession(
            user_id=u.id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            csrf=csrf,
            expires_at=now() + timedelta(hours=8),
        )
    )
    u.last_login_at = now()
    audit(db, u, "sign_in")
    db.commit()
    response.set_cookie(
        "frauderio_session",
        token,
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="lax",
        max_age=28800,
        path="/",
    )
    return {"user": public_user(u), "csrf": csrf}


@app.post("/api/auth/register", status_code=201)
def register(
    data: Registration, request: Request, response: Response, db=Depends(database)
):
    throttle(request)
    if os.getenv("ALLOW_REGISTRATION", "true").lower() != "true":
        fail(403, "Registration is disabled")
    u = User(
        name=data.name.strip(),
        email=data.email,
        password_hash=hasher.hash(data.password),
        role="analyst",
    )
    db.add(u)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        fail(409, "Email is already registered")
    audit(db, u, "account_created")
    return session_response(db, u, response)


@app.post("/api/auth/login")
def login(
    data: Credentials, request: Request, response: Response, db=Depends(database)
):
    throttle(request)
    u = db.scalars(select(User).where(User.email == data.email)).first()
    try:
        hasher.verify(u.password_hash if u else dummy_hash, data.password)
    except VerificationError:
        fail(401, "Email or password is incorrect")
    if not u or not u.active:
        fail(401, "Email or password is incorrect")
    return session_response(db, u, response)


@app.get("/api/auth/me")
def me(request: Request, u=Depends(current)):
    return {"user": public_user(u), "csrf": request.state.session.csrf}


@app.post("/api/auth/logout")
def logout(
    request: Request, response: Response, u=Depends(current), db=Depends(database)
):
    request.state.session.revoked_at = now()
    audit(db, u, "sign_out")
    db.commit()
    response.delete_cookie("frauderio_session", path="/")
    return {"ok": True}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "models_ready": Path("model_artifacts/bundle.joblib").exists(),
    }


@app.get("/api/overview")
def overview(u=Depends(current), db=Depends(database)):
    active_statuses = ("new", "under_review", "escalated")

    transaction_count = db.scalar(
        select(func.count()).select_from(Transaction)
    )

    account_count = db.scalar(
        select(func.count()).select_from(Account)
    )

    open_alert_count = db.scalar(
        select(func.count())
        .select_from(Alert)
        .where(Alert.status.in_(active_statuses))
    )

    active_case_count = db.scalar(
        select(func.count())
        .select_from(Case)
        .where(Case.status != "closed")
    )

    amount_under_review = db.scalar(
        select(func.sum(Transaction.amount))
        .join(Alert, Alert.transaction_id == Transaction.id)
        .where(Alert.status.in_(active_statuses))
    )

    risk_distribution = [
        {"tier": tier, "count": count}
        for tier, count in db.execute(
            select(Prediction.tier, func.count())
            .group_by(Prediction.tier)
        )
    ]

    return {
        "transactions": transaction_count,
        "accounts": account_count,
        "alerts": open_alert_count,
        "cases": active_case_count,
        "amount_under_review": float(amount_under_review or 0),
        "risk_distribution": risk_distribution,
    }


class AccountInput(BaseModel):
    reference: str | None = Field(
        default=None,
        min_length=3,
        max_length=40,
        pattern=r"^[A-Za-z0-9-]+$",
    )
    name: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=2, max_length=80)
    usual_amount: Decimal = Field(
        gt=0,
        max_digits=16,
        decimal_places=2,
    )
    usual_hour: int = Field(default=14, ge=0, le=23)


@app.post("/api/accounts", status_code=201)
def create_account(
    data: AccountInput,
    u=Depends(current),
    db=Depends(database),
):
    values = data.model_dump()

    values["reference"] = (
        values["reference"]
        or "AC-" + secrets.token_hex(5).upper()
    )

    existing = db.scalars(
        select(Account).where(
            Account.reference == values["reference"]
        )
    ).first()

    if existing:
        fail(
            409,
            "Account number already exists. Select the existing account.",
        )

    account = Account(**values)
    db.add(account)

    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        fail(409, "Account number already exists")

    audit(db, u, "customer_account_created", account.id)
    db.commit()

    return serialize(account)


@app.get("/api/accounts")
def accounts(q: str = "", u=Depends(current), db=Depends(database)):
    return [
        serialize(a)
        for a in db.scalars(
            select(Account)
            .where(
                or_(
                    Account.name.ilike("%" + q + "%"),
                    Account.reference.ilike("%" + q + "%"),
                )
            )
            .order_by(Account.id)
            .limit(10000)
        )
    ]


@app.get("/api/accounts/{id}")
def account(id: int, u=Depends(current), db=Depends(database)):
    a = get(db, Account, id)
    return {
        "account": serialize(a),
        "transactions": transaction_rows(db, account_id=id, limit=200),
        "events": [
            serialize(e)
            for e in db.scalars(
                select(AccountEvent)
                .where(AccountEvent.account_id == id)
                .order_by(AccountEvent.occurred_at.desc())
                .limit(200)
            )
        ],
        "devices": [
            {"device_id": e.device_id, "trusted": e.trusted}
            for e in db.scalars(
                select(AccountDevice).where(AccountDevice.account_id == id)
            )
        ],
        "profiles": [
            serialize(p)
            for p in db.scalars(
                select(Profile)
                .where(Profile.account_id == id)
                .order_by(Profile.id.desc())
                .limit(5)
            )
        ],
    }


@app.get("/api/catalogue")
def catalogue(u=Depends(current), db=Depends(database)):
    return {
        "devices": [serialize(x) for x in db.scalars(select(Device).limit(10000))],
        "merchants": [serialize(x) for x in db.scalars(select(Merchant))],
    }


def transaction_rows(
    db,
    account_id=None,
    q="",
    tier="",
    limit=100,
    offset=0,
):
    stmt = select(Transaction, Prediction).outerjoin(
        Prediction,
        Prediction.transaction_id == Transaction.id,
    )

    if account_id:
        stmt = stmt.where(
            or_(
                Transaction.account_id == account_id,
                Transaction.receiver_id == account_id,
            )
        )

    if q:
        stmt = stmt.where(
            Transaction.reference.ilike("%" + q + "%")
        )

    if tier:
        stmt = stmt.where(Prediction.tier == tier)

    references = dict(
        db.execute(
            select(Account.id, Account.reference)
        ).all()
    )

    return [
        {
            **serialize(transaction),
            "risk": serialize(prediction) if prediction else None,
            "account_number": references.get(
                transaction.account_id,
                str(transaction.account_id),
            ),
        }
        for transaction, prediction in db.execute(
            stmt.order_by(Transaction.occurred_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ]


@app.get("/api/transactions")
def transactions(
    account_id: int | None = None,
    q: str = "",
    tier: str = "",
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    u=Depends(current),
    db=Depends(database),
):
    return transaction_rows(db, account_id, q, tier, limit, offset)


class TransactionInput(BaseModel):
    account_id: int
    receiver_id: int | None = None
    device_id: int
    merchant_id: int
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    city: str = Field(min_length=2, max_length=80)
    reference: str = Field(min_length=3, max_length=50)


@app.post("/api/transactions", status_code=201)
def submit(data: TransactionInput, u=Depends(current), db=Depends(database)):
    get(db, Account, data.account_id)
    get(db, Device, data.device_id)
    get(db, Merchant, data.merchant_id)
    if data.receiver_id:
        get(db, Account, data.receiver_id)
    if db.scalars(
        select(Transaction).where(Transaction.reference == data.reference)
    ).first():
        fail(409, "Transaction reference already exists")
    tx = Transaction(**data.model_dump(), occurred_at=now())
    db.add(tx)
    try:
        db.flush()
        score(db, tx)
        if not db.get(AccountDevice, (tx.account_id, tx.device_id)):
            db.add(
                AccountDevice(
                    account_id=tx.account_id, device_id=tx.device_id, trusted=False
                )
            )
        db.add(
            AccountEvent(
                account_id=tx.account_id, kind="transaction", occurred_at=tx.occurred_at
            )
        )
        audit(db, u, "transaction_scored", tx.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "Duplicate transaction")
    except RuntimeError as e:
        db.rollback()
        fail(503, str(e))
    return transaction_detail(tx.id, u, db)


@app.get("/api/transactions/{id}")
def transaction_detail(id: int, u=Depends(current), db=Depends(database)):
    tx = get(db, Transaction, id)
    pred = db.scalars(select(Prediction).where(Prediction.transaction_id == id)).first()
    return {
        "transaction": serialize(tx),
        "prediction": serialize(pred) if pred else None,
        "factors": (
            [
                serialize(f)
                for f in db.scalars(
                    select(Factor).where(Factor.prediction_id == pred.id)
                )
            ]
            if pred
            else []
        ),
        "feedback": (
            [
                serialize(f)
                for f in db.scalars(
                    select(Feedback).where(Feedback.prediction_id == pred.id)
                )
            ]
            if pred
            else []
        ),
    }


class Scenario(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=16, decimal_places=2)
    trusted_device: bool = False


@app.post("/api/transactions/{id}/scenario")
def scenario(id: int, data: Scenario, u=Depends(current), db=Depends(database)):
    tx = get(db, Transaction, id)
    p = db.scalars(select(Prediction).where(Prediction.transaction_id == id)).first()
    if not p:
        fail(404, "Prediction unavailable")
    x = [p.features[k] for k in NAMES]
    x[0] *= float(data.amount) / float(tx.amount)
    x[1] = 0 if data.trusted_device else x[1]
    return {
        "original_score": p.score,
        "scenario": predict(x),
        "notice": "Hypothetical sensitivity analysis. No account trust or transaction record is changed.",
    }


class EventInput(BaseModel):
    account_id: int
    kind: Literal[
        "login", "password_reset", "otp_failed", "beneficiary_added", "device_change"
    ]
    success: bool = True


@app.post("/api/events")
def event(data: EventInput, u=Depends(current), db=Depends(database)):
    get(db, Account, data.account_id)
    obj = AccountEvent(**data.model_dump())
    db.add(obj)
    audit(db, u, "event_recorded", data.account_id)
    db.commit()
    return serialize(obj)


@app.get("/api/network/{id}")
def network(id: int, u=Depends(current), db=Depends(database)):
    get(db, Account, id)
    g = graph(db)
    key = f"A{id}"
    if key not in g:
        g.add_node(key, kind="account", label=f"Account {id}")
    sub = __import__("networkx").ego_graph(g, key, radius=2)
    nodes = list(sub.nodes)[:180]
    sub = sub.subgraph(nodes)
    return {
        "nodes": [{"data": {"id": n, **sub.nodes[n]}} for n in sub],
        "edges": [
            {"data": {"id": f"{a}-{b}", "source": a, "target": b, **d}}
            for a, b, d in sub.edges(data=True)
        ],
        "scope": "Two-hop neighbourhood, up to 180 nodes; connections are evidence of association, not proof of fraud.",
    }


@app.get("/api/alerts")
def alerts(u=Depends(current), db=Depends(database)):
    return [
        serialize(x)
        for x in db.scalars(select(Alert).order_by(Alert.id.desc()).limit(500))
    ]


class AlertUpdate(BaseModel):
    status: Literal["new", "under_review", "escalated", "resolved", "dismissed"]


@app.patch("/api/alerts/{id}")
def update_alert(id: int, data: AlertUpdate, u=Depends(current), db=Depends(database)):
    a = get(db, Alert, id)
    a.status = data.status
    a.assigned_to = u.id
    audit(db, u, "alert_updated", id, {"status": a.status})
    db.commit()
    return serialize(a)


class CaseInput(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    transaction_id: int | None = None
    account_id: int | None = None


@app.get("/api/cases")
def cases(u=Depends(current), db=Depends(database)):
    return [serialize(x) for x in db.scalars(select(Case).order_by(Case.id.desc()))]


@app.post("/api/cases", status_code=201)
def create_case(data: CaseInput, u=Depends(current), db=Depends(database)):
    if data.account_id:
        get(db, Account, data.account_id)
    if data.transaction_id:
        get(db, Transaction, data.transaction_id)
    c = Case(title=data.title, assigned_to=u.id)
    db.add(c)
    db.flush()
    if data.account_id:
        db.add(CaseAccount(case_id=c.id, account_id=data.account_id))
    if data.transaction_id:
        db.add(CaseTransaction(case_id=c.id, transaction_id=data.transaction_id))
    audit(db, u, "case_created", c.id)
    db.commit()
    return serialize(c)


@app.get("/api/cases/{id}")
def case(id: int, u=Depends(current), db=Depends(database)):
    return {
        "case": serialize(get(db, Case, id)),
        "notes": [
            serialize(n) for n in db.scalars(select(Note).where(Note.case_id == id))
        ],
        "accounts": [
            a.account_id
            for a in db.scalars(select(CaseAccount).where(CaseAccount.case_id == id))
        ],
        "transactions": [
            a.transaction_id
            for a in db.scalars(
                select(CaseTransaction).where(CaseTransaction.case_id == id)
            )
        ],
    }


class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=3000)


@app.post("/api/cases/{id}/notes")
def note(id: int, data: NoteInput, u=Depends(current), db=Depends(database)):
    get(db, Case, id)
    n = Note(case_id=id, author_id=u.id, text=data.text)
    db.add(n)
    audit(db, u, "case_note_added", id)
    db.commit()
    return serialize(n)


class CaseUpdate(BaseModel):
    status: Literal["open", "under_review", "escalated", "closed"]
    resolution: str = Field(default="", max_length=2000)
    assigned_to: int | None = None


@app.patch("/api/cases/{id}")
def case_update(id: int, data: CaseUpdate, u=Depends(supervisor), db=Depends(database)):
    c = get(db, Case, id)
    if data.status == "closed" and not data.resolution.strip():
        fail(422, "Provide a resolution")
    if data.assigned_to:
        get(db, User, data.assigned_to)
        c.assigned_to = data.assigned_to
    c.status = data.status
    c.resolution = data.resolution
    audit(db, u, "case_updated", id, data.model_dump())
    db.commit()
    return serialize(c)


class FeedbackInput(BaseModel):
    outcome: Literal["fraud", "legitimate", "uncertain"]
    reason: str = Field(min_length=3, max_length=1000)


@app.post("/api/transactions/{id}/feedback")
def feedback(id: int, data: FeedbackInput, u=Depends(current), db=Depends(database)):
    p = db.scalars(select(Prediction).where(Prediction.transaction_id == id)).first()
    if not p:
        fail(404, "Prediction not found")
    f = Feedback(prediction_id=p.id, analyst_id=u.id, **data.model_dump())
    db.add(f)
    audit(db, u, "feedback_submitted", id)
    db.commit()
    return serialize(f)


@app.get("/api/models")
def models(u=Depends(current)):
    try:
        b = load()
    except RuntimeError as e:
        fail(503, str(e))
    return {
        "version": b["version"],
        "metrics": b["metrics"],
        "features": NAMES,
        "explanation_units": "Transaction model TreeSHAP log-odds; not contributions to final ensemble probability.",
    }


@app.get("/api/users")
def users(u=Depends(admin), db=Depends(database)):
    return [public_user(x) for x in db.scalars(select(User))]


@app.get("/api/sessions")
def sessions(u=Depends(admin), db=Depends(database)):
    return [
        {
            k: getattr(x, k)
            for k in ["id", "user_id", "created_at", "expires_at", "revoked_at"]
        }
        for x in db.scalars(
            select(LoginSession).order_by(LoginSession.id.desc()).limit(200)
        )
    ]


class UserUpdate(BaseModel):
    role: Literal["analyst", "supervisor", "admin"]
    active: bool


@app.patch("/api/users/{id}")
def user_update(id: int, data: UserUpdate, u=Depends(admin), db=Depends(database)):
    if u.id == id and (data.role != "admin" or not data.active):
        fail(409, "Cannot remove your own administrator access")
    target = get(db, User, id)
    target.role = data.role
    target.active = data.active
    if not data.active:
        for s in db.scalars(select(LoginSession).where(LoginSession.user_id == id)):
            s.revoked_at = now()
    audit(db, u, "user_updated", id, data.model_dump())
    db.commit()
    return public_user(target)


@app.get("/api/audit")
def audit_log(u=Depends(supervisor), db=Depends(database)):
    return [
        serialize(x)
        for x in db.scalars(select(Audit).order_by(Audit.id.desc()).limit(500))
    ]


class ThresholdInput(BaseModel):
    low: int = Field(ge=0, le=999)
    medium: int = Field(ge=1, le=999)
    high: int = Field(ge=2, le=1000)


@app.get("/api/thresholds")
def thresholds(u=Depends(current), db=Depends(database)):
    t = db.scalars(select(Threshold).order_by(Threshold.id.desc())).first()
    return serialize(t) if t else {"low": 300, "medium": 600, "high": 800}


@app.post("/api/thresholds")
def set_thresholds(data: ThresholdInput, u=Depends(admin), db=Depends(database)):
    if not data.low < data.medium < data.high:
        fail(422, "Thresholds must be strictly increasing")
    t = Threshold(**data.model_dump(), created_by=u.id)
    db.add(t)
    audit(db, u, "thresholds_changed", detail=data.model_dump())
    db.commit()
    return serialize(t)


@app.get("/api/monitoring")
def monitoring(u=Depends(current), db=Depends(database)):
    return [
        serialize(x)
        for x in db.scalars(select(Drift).order_by(Drift.id.desc()).limit(60))
    ]


@app.post("/api/monitoring/run")
def drift_run(u=Depends(supervisor), db=Depends(database)):
    from scipy.stats import ks_2samp

    rows = list(
        db.scalars(select(Prediction).order_by(Prediction.id.desc()).limit(500))
    )
    if len(rows) < 30:
        fail(422, "At least 30 predictions required")
    reference = load()["reference"]
    for i, f in enumerate(NAMES):
        result = ks_2samp(reference[:, i], [r.features[f] for r in rows])
        db.add(
            Drift(
                feature=f,
                statistic=float(result.statistic),
                p_value=float(result.pvalue),
                sample_size=len(rows),
            )
        )
    audit(db, u, "drift_measured")
    db.commit()
    return {"ok": True}


from . import extended  # Register additional API routes before the frontend catch-all.

dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
