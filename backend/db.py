import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy import (
    create_engine,
    event,
    Column,
    String,
    Integer,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    Numeric,
    UniqueConstraint,
    CheckConstraint,
)
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


URL = os.getenv("DATABASE_URL", "sqlite:///./frauderio.db")
engine = create_engine(
    URL,
    **(
        {"connect_args": {"check_same_thread": False}}
        if URL.startswith("sqlite")
        else {}
    )
)
if URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def pragma(conn, record):
        conn.execute("PRAGMA foreign_keys=ON")


Session = sessionmaker(engine, expire_on_commit=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    email = Column(String(254), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="analyst", nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now)
    last_login_at = Column(DateTime)
    __table_args__ = (CheckConstraint("role IN ('analyst','supervisor','admin')"),)


class LoginSession(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    csrf = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=now)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime)


class Audit(Base):
    __tablename__ = "audit_events"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id"))
    action = Column(String(100))
    entity = Column(String(100))
    detail = Column(JSON, default=dict)
    created_at = Column(DateTime, default=now, index=True)


class Account(Base):
    __tablename__ = "customer_accounts"
    id = Column(Integer, primary_key=True)
    reference = Column(String(40), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    city = Column(String(80), default="Bengaluru")
    status = Column(String(30), default="active")
    opened_at = Column(DateTime, default=now)
    usual_amount = Column(Numeric(16, 2), default=2000)
    usual_hour = Column(Integer, default=14)


class Device(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    reference = Column(String(80), unique=True)
    kind = Column(String(40), default="mobile")
    first_seen = Column(DateTime, default=now)


class AccountDevice(Base):
    __tablename__ = "account_devices"
    account_id = Column(ForeignKey("customer_accounts.id"), primary_key=True)
    device_id = Column(ForeignKey("devices.id"), primary_key=True)
    trusted = Column(Boolean, default=False)
    first_seen = Column(DateTime, default=now)


class Merchant(Base):
    __tablename__ = "merchants"
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    category = Column(String(80))
    risk = Column(Float, default=0.1)


class Beneficiary(Base):
    __tablename__ = "beneficiaries"
    id = Column(Integer, primary_key=True)
    account_id = Column(ForeignKey("customer_accounts.id"), nullable=False)
    receiver_id = Column(ForeignKey("customer_accounts.id"), nullable=False)
    created_at = Column(DateTime, default=now)


class IP(Base):
    __tablename__ = "ip_addresses"
    id = Column(Integer, primary_key=True)
    address = Column(String(45), unique=True)
    city = Column(String(80))
    proxy = Column(Boolean, default=False)


class Card(Base):
    __tablename__ = "cards"
    id = Column(Integer, primary_key=True)
    account_id = Column(ForeignKey("customer_accounts.id"), nullable=False)
    token = Column(String(100), unique=True)
    last_four = Column(String(4))
    status = Column(String(20), default="active")


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    reference = Column(String(50), unique=True, nullable=False)
    account_id = Column(ForeignKey("customer_accounts.id"), nullable=False, index=True)
    receiver_id = Column(ForeignKey("customer_accounts.id"))
    device_id = Column(ForeignKey("devices.id"), nullable=False)
    merchant_id = Column(ForeignKey("merchants.id"), nullable=False)
    ip_id = Column(ForeignKey("ip_addresses.id"))
    card_id = Column(ForeignKey("cards.id"))
    beneficiary_id = Column(ForeignKey("beneficiaries.id"))
    amount = Column(Numeric(16, 2), nullable=False)
    currency = Column(String(3), default="INR")
    city = Column(String(80))
    channel = Column(String(30), default="online")
    occurred_at = Column(DateTime, default=now, index=True)
    created_at = Column(DateTime, default=now)
    status = Column(String(30), default="recorded")
    synthetic = Column(Boolean, default=False)
    __table_args__ = (CheckConstraint("amount > 0"),)


class AccountEvent(Base):
    __tablename__ = "account_events"
    id = Column(Integer, primary_key=True)
    account_id = Column(ForeignKey("customer_accounts.id"), nullable=False, index=True)
    kind = Column(String(50))
    success = Column(Boolean, default=True)
    occurred_at = Column(DateTime, default=now, index=True)


class Profile(Base):
    __tablename__ = "behaviour_profiles"
    id = Column(Integer, primary_key=True)
    account_id = Column(ForeignKey("customer_accounts.id"), nullable=False)
    snapshot = Column(JSON)
    calculated_at = Column(DateTime, default=now)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id = Column(Integer, primary_key=True)
    version = Column(String(80), unique=True)
    metrics = Column(JSON)
    created_at = Column(DateTime, default=now)


class Prediction(Base):
    __tablename__ = "model_predictions"
    id = Column(Integer, primary_key=True)
    transaction_id = Column(ForeignKey("transactions.id"), unique=True, nullable=False)
    model_version_id = Column(ForeignKey("model_versions.id"))
    probability = Column(Float)
    score = Column(Integer)
    tier = Column(String(20))
    action = Column(String(80))
    components = Column(JSON)
    features = Column(JSON)
    created_at = Column(DateTime, default=now)


class Factor(Base):
    __tablename__ = "decision_factors"
    id = Column(Integer, primary_key=True)
    prediction_id = Column(ForeignKey("model_predictions.id"), nullable=False)
    name = Column(String(80))
    contribution = Column(Float)
    message = Column(String(200))


class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True)
    transaction_id = Column(ForeignKey("transactions.id"), unique=True)
    account_id = Column(ForeignKey("customer_accounts.id"))
    prediction_id = Column(ForeignKey("model_predictions.id"))
    status = Column(String(30), default="new")
    assigned_to = Column(ForeignKey("users.id"))
    created_at = Column(DateTime, default=now)


class Case(Base):
    __tablename__ = "cases"
    id = Column(Integer, primary_key=True)
    title = Column(String(200))
    status = Column(String(30), default="open")
    assigned_to = Column(ForeignKey("users.id"))
    resolution = Column(String(2000))
    created_at = Column(DateTime, default=now)


class CaseTransaction(Base):
    __tablename__ = "case_transactions"
    case_id = Column(ForeignKey("cases.id"), primary_key=True)
    transaction_id = Column(ForeignKey("transactions.id"), primary_key=True)


class CaseAccount(Base):
    __tablename__ = "case_accounts"
    case_id = Column(ForeignKey("cases.id"), primary_key=True)
    account_id = Column(ForeignKey("customer_accounts.id"), primary_key=True)


class Note(Base):
    __tablename__ = "case_notes"
    id = Column(Integer, primary_key=True)
    case_id = Column(ForeignKey("cases.id"), nullable=False)
    author_id = Column(ForeignKey("users.id"))
    text = Column(String(3000))
    created_at = Column(DateTime, default=now)


class Feedback(Base):
    __tablename__ = "analyst_feedback"
    id = Column(Integer, primary_key=True)
    prediction_id = Column(ForeignKey("model_predictions.id"))
    analyst_id = Column(ForeignKey("users.id"))
    outcome = Column(String(30))
    reason = Column(String(1000))
    created_at = Column(DateTime, default=now)


class Threshold(Base):
    __tablename__ = "risk_thresholds"
    id = Column(Integer, primary_key=True)
    low = Column(Integer, default=300)
    medium = Column(Integer, default=600)
    high = Column(Integer, default=800)
    created_by = Column(ForeignKey("users.id"))
    created_at = Column(DateTime, default=now)


class Drift(Base):
    __tablename__ = "drift_measurements"
    id = Column(Integer, primary_key=True)
    feature = Column(String(80))
    statistic = Column(Float)
    p_value = Column(Float)
    sample_size = Column(Integer)
    created_at = Column(DateTime, default=now)
