"""Catalogue, graph communities and export endpoints."""

import csv, io
from decimal import Decimal
from fastapi import Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, func
import networkx as nx
from .main import app, current, supervisor, database, audit, get, fail
from .db import *
from .services import graph, serialize
from .main import AccountInput, TransactionInput, submit
from sqlalchemy.exc import IntegrityError

class EntryInput(BaseModel):
    reference: str = Field(min_length=3, max_length=50)
    amount: Decimal = Field(
        gt=0,
        max_digits=16,
        decimal_places=2,
    )
    city: str = Field(min_length=2, max_length=80)

    account_id: int | None = None
    new_account: AccountInput | None = None

    merchant_id: int | None = None
    new_merchant_name: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )
    merchant_category: str = Field(
        default="Retail",
        max_length=80,
    )

    device_id: int | None = None
    new_device_reference: str | None = Field(
        default=None,
        min_length=2,
        max_length=80,
    )

    receiver_id: int | None = None


@app.post("/api/transactions/entry", status_code=201)
def entry(
    data: EntryInput,
    u=Depends(current),
    db=Depends(database),
):
    if bool(data.account_id) == bool(data.new_account):
        fail(
            422,
            "Choose an existing account or enter a new account",
        )

    if bool(data.merchant_id) == bool(data.new_merchant_name):
        fail(
            422,
            "Choose an existing merchant or enter a new merchant",
        )

    if bool(data.device_id) == bool(data.new_device_reference):
        fail(
            422,
            "Choose a device or enter a device reference",
        )

    account_id = data.account_id
    merchant_id = data.merchant_id
    device_id = data.device_id

    try:
        if data.new_account:
            values = data.new_account.model_dump()

            if not values["reference"]:
                fail(422, "Enter your account number")

            account = Account(**values)
            db.add(account)
            db.flush()

            account_id = account.id
            audit(
                db,
                u,
                "customer_account_created",
                account.id,
            )

        if data.new_merchant_name:
            name = data.new_merchant_name.strip()

            if len(name) < 2:
                fail(422, "Enter a merchant name")

            existing = db.scalars(
                select(Merchant).where(
                    func.lower(Merchant.name) == name.lower()
                )
            ).first()

            if existing:
                fail(
                    409,
                    "Merchant already exists. Select the existing merchant.",
                )

            merchant = Merchant(
                name=name,
                category=data.merchant_category,
                risk=0.1,
            )

            db.add(merchant)
            db.flush()

            merchant_id = merchant.id
            audit(db, u, "merchant_created", merchant.id)

        if data.new_device_reference:
            device = Device(
                reference=data.new_device_reference
            )
            db.add(device)
            db.flush()

            device_id = device.id

        # The existing submit function scores the transaction
        # and commits all the new records together.
        return submit(
            TransactionInput(
                reference=data.reference,
                amount=data.amount,
                city=data.city,
                account_id=account_id,
                merchant_id=merchant_id,
                device_id=device_id,
                receiver_id=data.receiver_id,
            ),
            u,
            db,
        )

    except IntegrityError:
        db.rollback()
        fail(
            409,
            "Account number, device reference or transaction "
            "reference already exists. Select the saved record.",
        )
        
class DeviceInput(BaseModel):
    reference: str = Field(min_length=2, max_length=80)
    kind: str = Field(default="mobile", max_length=40)


@app.post("/api/devices", status_code=201)
def device(data: DeviceInput, u=Depends(current), db=Depends(database)):
    if db.scalars(select(Device).where(Device.reference == data.reference)).first():
        fail(409, "Device already exists")
    obj = Device(**data.model_dump())
    db.add(obj)
    audit(db, u, "device_created", data.reference)
    db.commit()
    return serialize(obj)


class MerchantInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = Field(max_length=80)
    risk: float = Field(default=0.1, ge=0, le=1)


@app.post("/api/merchants", status_code=201)
def merchant(data: MerchantInput, u=Depends(current), db=Depends(database)):
    obj = Merchant(**data.model_dump())
    db.add(obj)
    audit(db, u, "merchant_created", data.name)
    db.commit()
    return serialize(obj)


class LinkInput(BaseModel):
    transaction_id: int | None = None
    account_id: int | None = None


@app.post("/api/cases/{id}/evidence")
def evidence(id: int, data: LinkInput, u=Depends(current), db=Depends(database)):
    get(db, Case, id)
    if not data.transaction_id and not data.account_id:
        fail(422, "Select a transaction or account")
    if data.transaction_id:
        get(db, Transaction, data.transaction_id)
        if not db.get(CaseTransaction, (id, data.transaction_id)):
            db.add(CaseTransaction(case_id=id, transaction_id=data.transaction_id))
    if data.account_id:
        get(db, Account, data.account_id)
        if not db.get(CaseAccount, (id, data.account_id)):
            db.add(CaseAccount(case_id=id, account_id=data.account_id))
    audit(db, u, "case_evidence_added", id, data.model_dump())
    db.commit()
    return {"ok": True}


@app.get("/api/fraud-rings")
def rings(u=Depends(current), db=Depends(database)):
    # Shared-device projection avoids treating a popular merchant as a fraud ring.
    g = nx.Graph()
    devices = {}
    for link in db.scalars(select(AccountDevice)):
        devices.setdefault(link.device_id, []).append(link.account_id)
    for ids in devices.values():
        for i, a in enumerate(ids):
            for b in ids[i + 1 :]:
                g.add_edge(a, b)
    if not g.number_of_edges():
        return []
    groups = nx.community.louvain_communities(g, seed=42)
    out = []
    for ids in groups:
        if len(ids) < 3:
            continue
        scores = list(
            db.scalars(
                select(Prediction.score)
                .join(Transaction, Transaction.id == Prediction.transaction_id)
                .where(Transaction.account_id.in_(ids))
            )
        )
        out.append(
            {
                "id": min(ids),
                "account_ids": sorted(ids),
                "accounts": len(ids),
                "shared_devices": sum(len(set(v) & ids) > 1 for v in devices.values()),
                "density": nx.density(g.subgraph(ids)),
                "max_risk_score": max(scores, default=0),
                "status": "candidate community",
                "label": "Association requiring investigation; not confirmed fraud",
            }
        )
    return sorted(out, key=lambda x: x["max_risk_score"], reverse=True)


@app.get("/api/export/transactions.csv")
def export(u=Depends(supervisor), db=Depends(database)):
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(
        ["reference", "account_id", "receiver_id", "amount", "currency", "occurred_at"]
    )
    for t in db.scalars(select(Transaction).order_by(Transaction.id)):
        ref = t.reference
        if ref.startswith(("=", "+", "-", "@")):
            ref = "'" + ref
        writer.writerow(
            [ref, t.account_id, t.receiver_id, t.amount, t.currency, t.occurred_at]
        )
    audit(db, u, "transactions_exported")
    db.commit()
    return Response(
        stream.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=transactions.csv"},
    )
