from datetime import timedelta
import networkx as nx
from sqlalchemy import select, func
from .db import *
from fraud_ml.pipeline import predict, load, NAMES


def graph(db, at=None):
    g = nx.Graph()
    for link in db.scalars(
        select(AccountDevice).where(AccountDevice.first_seen <= (at or now()))
    ):
        g.add_node(
            f"A{link.account_id}", kind="account", label=f"Account {link.account_id}"
        )
        g.add_node(
            f"D{link.device_id}", kind="device", label=f"Device {link.device_id}"
        )
        g.add_edge(f"A{link.account_id}", f"D{link.device_id}", relation="uses device")
    for tx in db.scalars(
        select(Transaction)
        .where(Transaction.occurred_at < (at or now()))
        .order_by(Transaction.occurred_at.desc())
        .limit(20000)
    ):
        source = f"A{tx.account_id}"
        g.add_node(source, kind="account", label=f"Account {tx.account_id}")
        for prefix, identifier, kind in [
            ("M", tx.merchant_id, "merchant"),
            ("I", tx.ip_id, "ip"),
            ("C", tx.card_id, "card"),
        ]:
            if identifier:
                node = f"{prefix}{identifier}"
                g.add_node(node, kind=kind, label=f"{kind.title()} {identifier}")
                g.add_edge(source, node, relation=f"uses {kind}")
        if tx.receiver_id:
            g.add_node(
                f"A{tx.receiver_id}", kind="account", label=f"Account {tx.receiver_id}"
            )
            g.add_node(
                f"A{tx.account_id}", kind="account", label=f"Account {tx.account_id}"
            )
            g.add_edge(
                f"A{tx.account_id}", f"A{tx.receiver_id}", relation="transfers to"
            )
    return g


def features(db, tx):
    account = db.get(Account, tx.account_id)
    merchant = db.get(Merchant, tx.merchant_id)
    history = list(
        db.scalars(
            select(Transaction)
            .where(
                Transaction.account_id == tx.account_id,
                Transaction.occurred_at < tx.occurred_at,
            )
            .order_by(Transaction.occurred_at.desc())
            .limit(500)
        )
    )
    avg = (
        sum(float(t.amount) for t in history) / len(history)
        if history
        else float(account.usual_amount)
    )
    dev = db.get(AccountDevice, (tx.account_id, tx.device_id))
    velocity = sum(
        t.occurred_at >= tx.occurred_at - timedelta(hours=1) for t in history
    )
    shared = (
        db.scalar(
            select(func.count())
            .select_from(AccountDevice)
            .where(
                AccountDevice.device_id == tx.device_id,
                AccountDevice.first_seen < tx.occurred_at,
            )
        )
        or 0
    )
    receivers = (
        db.scalar(
            select(func.count(func.distinct(Transaction.account_id))).where(
                Transaction.receiver_id == tx.receiver_id,
                Transaction.occurred_at < tx.occurred_at,
            )
        )
        if tx.receiver_id
        else 0
    )
    events = list(
        db.scalars(
            select(AccountEvent).where(
                AccountEvent.account_id == account.id,
                AccountEvent.occurred_at <= tx.occurred_at,
                AccountEvent.occurred_at >= tx.occurred_at - timedelta(hours=1),
            )
        )
    )
    hour = abs(tx.occurred_at.hour - account.usual_hour)
    hour = min(hour, 24 - hour)
    values = [
        float(tx.amount) / max(avg, 1),
        int(not dev or not dev.trusted),
        int(tx.city != account.city),
        velocity,
        shared,
        receivers or 0,
        max(0, (tx.occurred_at - account.opened_at).days),
        hour,
        sum(e.kind == "password_reset" for e in events),
        sum(e.kind == "otp_failed" for e in events),
        int(any(e.kind == "beneficiary_added" for e in events)),
        merchant.risk,
    ]
    return values


def score(db, tx):
    values = features(db, tx)
    result = predict(values)
    thresholds = db.scalars(select(Threshold).order_by(Threshold.id.desc())).first()
    limits = (
        [thresholds.low, thresholds.medium, thresholds.high]
        if thresholds
        else [300, 600, 800]
    )
    idx = sum(result["score"] > v for v in limits)
    tier = ["low", "medium", "high", "critical"][idx]
    action = ["continue", "verify", "hold and review", "escalate"][idx]
    model = db.scalars(
        select(ModelVersion).where(ModelVersion.version == load()["version"])
    ).first()
    if not model:
        model = ModelVersion(version=load()["version"], metrics=load()["metrics"])
        db.add(model)
        db.flush()
    pred = Prediction(
        transaction_id=tx.id,
        model_version_id=model.id,
        probability=result["probability"],
        score=result["score"],
        tier=tier,
        action=action,
        components=result["components"],
        features=dict(zip(NAMES, values)),
    )
    db.add(pred)
    db.flush()
    for f in result["factors"]:
        db.add(Factor(prediction_id=pred.id, **f))
    if idx >= 2:
        db.add(
            Alert(transaction_id=tx.id, account_id=tx.account_id, prediction_id=pred.id)
        )
    db.add(
        Profile(
            account_id=tx.account_id,
            snapshot={"features_at_scoring": dict(zip(NAMES, values))},
        )
    )
    return pred


def serialize(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
