# Frauderio Nexus

Frauderio Nexus is a financial transaction monitoring and investigation application. It combines transaction classification, account-specific anomaly features, network relationships and security-event analysis. Analysts can inspect a payment, follow connected accounts, open a case and record an outcome. Financial records and model decisions persist in a relational database.

The interface uses a text wordmark, warm neutral surfaces, compact ledgers and restrained teal accents. There are no chatbot panels, decorative AI logos, glowing gradients or oversized risk gauges.

## What is included

- React/TypeScript application: overview, transaction ledger, assessment form, transaction detail, account histories, network explorer, alerts, investigations, model evaluation, monitoring, staff administration and audit history.
- Staff account creation, sign-in and sign-out. Argon2 password hashes, opaque HTTP-only session cookies, server-side session revocation, CSRF verification and role checks.
- Customer account creation. Staff users and customer financial accounts are separate records.
- Persistent incoming and outgoing account transactions, historical predictions, device associations, security events, analyst feedback, case notes and evidence links.
- Four scoring signals: LightGBM transaction classifier, Isolation Forest behavioural percentile, LightGBM network-feature classifier and HMM likelihood plus temporal-feature classifier. A logistic stacking model is calibrated on a separate holdout partition.
- Native LightGBM TreeSHAP decision factors, hypothetical amount/device sensitivity analysis and optional DiCE experiments.
- NetworkX relationship graph and shared-device community detection, with a Cytoscape explorer. Communities are candidates for investigation, not confirmed fraud rings.
- PostgreSQL configuration, SQLAlchemy models, Alembic migration, SQLite offline demonstration, synthetic data tools, automated tests and setup scripts. No Docker required.

## Quick start on Windows

Install Python 3.11 or 3.12 and Node.js 22.12+ (or supported Node 20.19+). Extract the ZIP into a regular folder. Double-click `start.bat`, then open **http://localhost:8000**.

The ZIP includes a compiled frontend, trained demonstration model and a SQLite dataset with 80 customer accounts and 500 transactions, with no staff accounts. Create your own staff account on the sign-in screen. Registration always grants the analyst role. No default password is shipped. The first launch installs Python dependencies and therefore requires an internet connection.

To give your own account administrative access, stop the server or use another terminal in the extracted folder:

```powershell
.venv\Scripts\python.exe manage.py promote your@email.com admin
```

Sign in again. The **Users** page displays staff accounts and sessions. The **Audit history** page records sign-in, sign-out and operational actions. You can inspect the same rows with DB Browser for SQLite, or pgAdmin/DBeaver when using PostgreSQL. Passwords are stored as hashes and cannot be read back.

On macOS/Linux use `bash start.sh`. LightGBM on macOS may require `brew install libomp`. Never double-click the HTML file; the interface requires the running API.

## PostgreSQL setup

PostgreSQL is the deployment database. SQLite is the supplied offline convenience mode, selected only when `DATABASE_URL` is absent.

1. Create a database named `frauderio` using pgAdmin or `createdb frauderio`.
2. Copy `.env.example` to `.env` and set the PostgreSQL username/password.
3. In an activated virtual environment, run:

```bash
pip install -r requirements.txt
python manage.py init
python manage.py seed --accounts 80 --transactions 1000
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Use `postgresql+psycopg://USER:PASSWORD@localhost:5432/frauderio`. Hosted PostgreSQL normally needs `?sslmode=require`. Keep `.env` private. Initialization uses Alembic and preserves existing records. Seeding refuses to overwrite an existing customer dataset. Staff accounts are created through registration, not the seeder.

## Development

Backend from the project root:

```bash
python -m uvicorn backend.main:app --reload --port 8000
```

Frontend from `frontend/`:

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to FastAPI. `npm run build` creates `frontend/dist`; FastAPI serves that folder on port 8000 for a single-origin local app. Hash routing supports reloads without a separate web-server rewrite.

## A demonstration workflow

1. Register and sign in. Promote your user through the local management command if you need admin access.
2. Open **Transactions** and inspect a record. Its score, feature snapshot, model version and explanation are persisted.
3. Open its customer account to see both incoming and outgoing transactions, trusted devices and security events.
4. Add a password-reset or failed-OTP event, then record a new transaction. Only information available before scoring enters the features.
5. Inspect the two-hop network. Select an account node to open its record.
6. Open a case from the transaction, add notes and record analyst feedback. Supervisors can close the case with a resolution.
7. Inspect measured evaluation curves in **Models**. Supervisors can run a feature-distribution comparison in **System**.
8. Sign out. The database session is revoked; replaying the cookie no longer authenticates.

Use the interactive API at `/docs` for catalogue creation, additional evidence links, CSV export and fraud-ring candidates. These endpoints enforce the same session and CSRF rules as the UI. For scripted writes, send the `csrf` field returned at login as `X-CSRF-Token`.

## Models and evidence

| Layer | Implementation | Output |
|---|---|---|
| Transaction | LightGBM on amount ratio, device/location familiarity, velocity, account age, time and merchant context | Classifier probability |
| Behaviour | Isolation Forest on account-relative features | Anomaly percentile; not a fraud probability |
| Network | LightGBM on shared-device accounts, receiver count and velocity | Classifier probability |
| Sequence | Categorical HMM on event categories plus LightGBM on counts and likelihood | Classifier probability |
| Ensemble | Logistic stacking followed by logistic calibration | Combined probability, integer 0–1000 score |

Training partitions are 55% base models, 17% ensemble, 13% calibration and 15% untouched evaluation. Ensemble inputs come from models that did not train on those rows. The bundled `model_artifacts/metrics.json` contains actual measurements. The UI displays those measurements, not illustrative performance numbers.

The training data is a reproducible synthetic feature benchmark with stochastic labels. The relational database seeder separately generates connected demo activity. **These are not a real bank dataset or a validated temporal fraud benchmark.** The sequence experiment currently reconstructs canonical event sequences from recent event counts; it does not learn every permutation of the raw event timeline. Network features use recorded historical associations; optional Node2Vec snapshot embeddings are an experiment rather than an input to the served score. The application deliberately does not claim verified fraud-type classification.

Risk thresholds are initially 300 / 600 / 800. Administrators can version changes. Existing predictions retain the thresholds and tier effective when scored. A threshold is a review policy, not a verified fraud label. This application does not move funds, send OTPs or block banking accounts.

TreeSHAP values explain only the transaction model in **raw log-odds**. They are not contributions to the final calibrated ensemble probability. The scenario form recalculates modified features without changing original transactions or device trust.

## Training and optional research

```bash
python manage.py train --rows 20000
python -m data.generate --rows 200000
python -m pytest -q
```

Restart the API after replacing model artifacts. Do not load model files from untrusted sources; Joblib uses Python serialization.

For the broader Python library experiments from the project design:

```bash
pip install -r requirements-experiments.txt
python -m training.experiments anomaly
python -m training.experiments tune
python -m training.experiments embeddings
python -m training.experiments online
python -m training.experiments counterfactual
```

These provide PyOD Isolation Forest/LOF comparison, Optuna tuning, Node2Vec biased random walks with Gensim skip-gram, River prequential anomaly evaluation and constrained DiCE counterfactuals. Results go to `model_artifacts/experiments`. They are explicit research jobs; they do not automatically update production decisions. `imbalanced-learn` is available for later controlled resampling comparisons; the default models preserve the original class distribution.

## Verification

The backend test suite checks authentication, logout revocation, disabled accounts, CSRF, role enforcement, transaction persistence, incoming account history, historical feature boundaries, case evidence, feedback and model output. The React application passes its TypeScript check and production build. A Chromium browser check covers registration, the ledger, transaction detail, case notes, network rendering, model evaluation, mobile layout and sign-out. All five optional research commands were also executed successfully.

Run `python -m pytest -q` from the project root. To repeat the browser check, use a disposable copy of the seeded database because the check creates a user and a case. Start the API with that database, then run these commands from `frontend/`:

```bash
npm ci
npx playwright install chromium
node browser-check.mjs
```

Local validation used SQLite. PostgreSQL and cloud hosting configuration are included but have not been exercised against a live database or deployment.

## Database model

| Domain | Tables |
|---|---|
| Access | `users`, `sessions`, `audit_events` |
| Financial records | `customer_accounts`, `transactions`, `merchants`, `beneficiaries`, `cards`, `ip_addresses` |
| Account context | `devices`, `account_devices`, `account_events`, `behaviour_profiles` |
| Decisions | `model_versions`, `model_predictions`, `decision_factors`, `risk_thresholds` |
| Investigation | `alerts`, `cases`, `case_transactions`, `case_accounts`, `case_notes`, `analyst_feedback` |
| Monitoring | `drift_measurements` |

Financial amounts use `NUMERIC(16,2)`, not binary floating-point storage. Foreign keys enforce relationships. References and email addresses have unique constraints. Account/time indexes support history queries. A transaction and its prediction, factors and alert commit together. Incoming transactions appear on the receiver's account history. Stored timestamps use UTC; the interface converts them to local time.

User roles are constrained directly on `users` because each user has one role. Analysts share the institution's customer dataset. This is an internal investigation tool, not a consumer banking portal with private per-login wallets. Every customer still has an independent transaction history.

Example SQL for inspecting records:

```sql
SELECT id, name, email, role, active, last_login_at FROM users;
SELECT id, user_id, created_at, expires_at, revoked_at FROM sessions;
SELECT reference, account_id, receiver_id, amount, occurred_at
FROM transactions WHERE account_id = 1 OR receiver_id = 1
ORDER BY occurred_at DESC;
SELECT * FROM audit_events ORDER BY created_at DESC;
```

## Deployment

For a full deployment, use PostgreSQL and a Python host for the API. `render.yaml` provides the API service configuration. Upload the trusted model artifacts alongside the code. Run migrations before serving requests. Set `COOKIE_SECURE=true` and `APP_ORIGIN` to your actual frontend HTTPS origin.

For Vercel, use `frontend` as the project root, `npm run build` as the build command and `dist` as the output directory. Copy `vercel.json.example` to `vercel.json` and replace `YOUR-API-HOST`. The `/api` reverse proxy keeps browser authentication same-origin. Verify that the chosen proxy preserves cookies. Do not put PyTorch or the training workflow in Vercel functions. This configuration is provided but has not been deployed to a live cloud account.

Public registration is included as requested. Turn `ALLOW_REGISTRATION=false` when opening a deployment that contains non-demo data. The current per-process login throttle is suitable for a single local worker; multi-worker deployments need a shared rate-limit store. A public financial service would additionally need email verification, recovery, monitoring, backups and an operational security review.

## Repository layout

```text
backend/              API, database models, domain services
frontend/             React/TypeScript/CSS source and built application
fraud_ml/             Four-signal training and inference pipeline
training/             Optional comparative research jobs
data/                 Synthetic feature generator
migrations/           Alembic schema migration
model_artifacts/      Trained demo model and measured evaluation
tests/                Authentication, persistence and model tests
manage.py             Migrate, train, seed and change staff roles
start.bat / start.sh  Local startup helpers
```

The original Frauderio application is not overwritten by this distribution. Frauderio Nexus is a standalone codebase.

