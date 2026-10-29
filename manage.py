"""Explicit database/bootstrap commands. No fixed passwords or auto-created admin."""

import argparse, json, random, uuid
from datetime import timedelta
from backend.db import *


def seed(accounts=80, transactions=1000):
    rng = random.Random(42)
    with Session() as db:
        if db.scalar(select(func.count()).select_from(Account)):
            raise SystemExit("Seed refused: accounts already exist")
        start = now() - timedelta(days=30)
        for i in range(accounts):
            db.add(
                Account(
                    reference=f"AC-{i+1:06}",
                    name=f"Demo account {i+1:03}",
                    city=rng.choice(["Bengaluru", "Mumbai", "Delhi"]),
                    usual_amount=rng.randint(500, 8000),
                    opened_at=start - timedelta(days=rng.randint(30, 1000)),
                )
            )
        for i in range(accounts):
            db.add(Device(reference=f"DEV-{i+1:05}", first_seen=start))
        for i in range(15):
            db.add(
                Merchant(
                    name=["Retail", "Travel", "Utilities", "Market", "Transfer"][i % 5]
                    + f" {i+1}",
                    category=["retail", "travel", "utilities"][i % 3],
                    risk=rng.uniform(0.01, 0.8),
                )
            )
        db.flush()
        for i in range(1, accounts + 1):
            db.add(
                AccountDevice(account_id=i, device_id=i, trusted=True, first_seen=start)
            )
            if i <= 10 and i != 1:
                db.add(
                    AccountDevice(
                        account_id=i, device_id=1, trusted=False, first_seen=start
                    )
                )
            db.add(
                Card(
                    account_id=i,
                    token=uuid.uuid4().hex,
                    last_four=f"{i:04}",
                    status="active",
                )
            )
        db.add(IP(address="192.0.2.1", city="Bengaluru"))
        db.flush()
        for i in range(transactions):
            aid = rng.randint(1, accounts)
            a = db.get(Account, aid)
            suspicious = rng.random() < 0.09
            timestamp = start + timedelta(seconds=i * max(1, 2590000 // transactions))
            tx = Transaction(
                reference=f"DEMO-{i+1:07}",
                account_id=aid,
                receiver_id=accounts if suspicious else rng.randint(1, accounts),
                device_id=1 if suspicious else aid,
                merchant_id=rng.randint(1, 15),
                amount=round(
                    float(a.usual_amount)
                    * rng.uniform(0.2, 2)
                    * (8 if suspicious else 1),
                    2,
                ),
                city="Overseas" if suspicious else a.city,
                occurred_at=timestamp,
                synthetic=True,
                ip_id=1,
            )
            db.add(tx)
            db.flush()
            if suspicious:
                for minutes, kind in [
                    (12, "login"),
                    (9, "password_reset"),
                    (6, "beneficiary_added"),
                    (3, "otp_failed"),
                ]:
                    db.add(
                        AccountEvent(
                            account_id=aid,
                            kind=kind,
                            occurred_at=timestamp - timedelta(minutes=minutes),
                        )
                    )
            db.flush()
            from backend.services import score

            score(db, tx)
        db.commit()


if __name__ == "__main__":
    from sqlalchemy import select, func

    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["init", "seed", "train", "promote"])
    parser.add_argument("email", nargs="?")
    parser.add_argument("role", nargs="?", choices=["analyst", "supervisor", "admin"])
    parser.add_argument("--rows", type=int, default=20000)
    parser.add_argument("--accounts", type=int, default=80)
    parser.add_argument("--transactions", type=int, default=1000)
    args = parser.parse_args()
    if args.command == "init":
        from alembic.config import Config
        from alembic import command

        command.upgrade(Config("alembic.ini"), "head")
        print("Database migrated")
    if args.command == "train":
        from fraud_ml.pipeline import train

        print(json.dumps(train(args.rows), indent=2))
    if args.command == "seed":
        seed(args.accounts, args.transactions)
        print("Synthetic records created")
    if args.command == "promote":
        if not args.email or not args.role:
            parser.error("promote requires EMAIL ROLE")
        with Session() as db:
            u = db.scalars(select(User).where(User.email == args.email.lower())).first()
            if not u:
                raise SystemExit("User not found; register first")
            u.role = args.role
            db.add(
                Audit(
                    user_id=u.id,
                    action="local_role_change",
                    entity="users",
                    detail={"role": args.role},
                )
            )
            db.commit()
            print("Role updated")
