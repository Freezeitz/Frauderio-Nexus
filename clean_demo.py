
from pathlib import Path
from datetime import datetime
import sqlite3

from sqlalchemy import select, delete, or_
from backend.db import *


def clear_demo(db):
    demo_transactions = list(
        db.scalars(
            select(Transaction).where(
                Transaction.synthetic.is_(True)
            )
        )
    )

    transaction_ids = {t.id for t in demo_transactions}
    merchant_ids = {t.merchant_id for t in demo_transactions}
    device_ids = {t.device_id for t in demo_transactions}

    prediction_ids = list(
        db.scalars(
            select(Prediction.id).where(
                Prediction.transaction_id.in_(transaction_ids)
            )
        )
    )

    demo_accounts = list(
        db.scalars(
            select(Account).where(
                Account.name.like("Demo account %"),
                Account.reference.like("AC-%"),
            )
        )
    )

    # Preserve a demo account if you have used it
    # for a transaction entered through the application.
    account_ids = {
        account.id
        for account in demo_accounts
        if not db.scalars(
            select(Transaction.id).where(
                Transaction.synthetic.is_(False),
                or_(
                    Transaction.account_id == account.id,
                    Transaction.receiver_id == account.id,
                ),
            )
        ).first()
    }

    deleted_cases = 0

    for case in list(db.scalars(select(Case))):
        linked_transactions = set(
            db.scalars(
                select(CaseTransaction.transaction_id).where(
                    CaseTransaction.case_id == case.id
                )
            )
        )

        linked_accounts = set(
            db.scalars(
                select(CaseAccount.account_id).where(
                    CaseAccount.case_id == case.id
                )
            )
        )

        only_demo_evidence = (
            (linked_transactions or linked_accounts)
            and linked_transactions.issubset(transaction_ids)
            and linked_accounts.issubset(account_ids)
        )

        if only_demo_evidence:
            for model in (Note, CaseTransaction, CaseAccount):
                db.execute(
                    delete(model).where(model.case_id == case.id)
                )

            db.delete(case)
            deleted_cases += 1

    db.flush()

    db.execute(
        delete(CaseTransaction).where(
            CaseTransaction.transaction_id.in_(transaction_ids)
        )
    )

    db.execute(
        delete(CaseAccount).where(
            CaseAccount.account_id.in_(account_ids)
        )
    )

    db.execute(
        delete(Alert).where(
            or_(
                Alert.transaction_id.in_(transaction_ids),
                Alert.account_id.in_(account_ids),
            )
        )
    )

    for model in (Factor, Feedback):
        db.execute(
            delete(model).where(
                model.prediction_id.in_(prediction_ids)
            )
        )

    db.execute(
        delete(Prediction).where(
            Prediction.id.in_(prediction_ids)
        )
    )

    db.execute(
        delete(Transaction).where(
            Transaction.id.in_(transaction_ids)
        )
    )

    # Stop and roll back if a retained transaction still
    # references a card or beneficiary being removed.
    for model in (Card, Beneficiary):
        record_ids = list(
            db.scalars(
                select(model.id).where(
                    model.account_id.in_(account_ids)
                )
            )
        )

        transaction_column = (
            Transaction.card_id
            if model is Card
            else Transaction.beneficiary_id
        )

        retained_references = set(
            db.scalars(
                select(transaction_column).where(
                    transaction_column.in_(record_ids)
                )
            )
        )

        if retained_references:
            raise RuntimeError(
                "Demo accounts have retained financial references. "
                "Cleanup cancelled."
            )

        db.execute(
            delete(model).where(model.id.in_(record_ids))
        )

    for model in (AccountDevice, AccountEvent, Profile):
        db.execute(
            delete(model).where(
                model.account_id.in_(account_ids)
            )
        )

    db.execute(
        delete(Account).where(Account.id.in_(account_ids))
    )

    # Remove merchants only when no remaining transaction uses them.
    for merchant_id in merchant_ids:
        still_used = db.scalars(
            select(Transaction.id).where(
                Transaction.merchant_id == merchant_id
            )
        ).first()

        if not still_used:
            db.execute(
                delete(Merchant).where(Merchant.id == merchant_id)
            )

    # Preserve devices linked to retained accounts or transactions.
    for device_id in device_ids:
        used_by_transaction = db.scalars(
            select(Transaction.id).where(
                Transaction.device_id == device_id
            )
        ).first()

        used_by_account = db.scalars(
            select(AccountDevice.account_id).where(
                AccountDevice.device_id == device_id
            )
        ).first()

        if not used_by_transaction and not used_by_account:
            db.execute(
                delete(Device).where(Device.id == device_id)
            )

    # Old comparisons included the removed sample activity.
    if transaction_ids:
        db.execute(delete(Drift))

    result = {
        "demo_transactions_removed": len(transaction_ids),
        "demo_accounts_removed": len(account_ids),
        "demo_cases_removed": deleted_cases,
    }

    db.add(
        Audit(
            action="demo_cleanup",
            entity="local_database",
            detail=result,
        )
    )

    db.commit()
    return result


if __name__ == "__main__":
    if engine.url.get_backend_name() != "sqlite":
        raise SystemExit(
            "This helper supports local SQLite only. "
            "No records were changed."
        )

    source = Path(engine.url.database).resolve()

    if not source.exists():
        raise SystemExit(
            "Database not found. Run from the folder containing start.bat."
        )

    backup = source.with_name(
        source.stem
        + "-backup-"
        + datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        + ".db"
    )

    with sqlite3.connect(str(source)) as original:
        with sqlite3.connect(str(backup)) as destination:
            original.backup(destination)

    print("Backup saved:", backup)

    with Session() as db:
        print(clear_demo(db))