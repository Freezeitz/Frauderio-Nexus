"""Trainable synthetic benchmark; all prediction features represent information available at scoring time."""

from pathlib import Path
import json
import numpy as np
import joblib
from lightgbm import LGBMClassifier
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    roc_auc_score,
    brier_score_loss,
    confusion_matrix,
    precision_recall_curve,
    roc_curve,
)
from sklearn.calibration import calibration_curve
from scipy.special import expit
from hmmlearn.hmm import CategoricalHMM

ROOT = Path(__file__).resolve().parents[1] / "model_artifacts"
NAMES = [
    "amount_ratio",
    "untrusted_device",
    "unfamiliar_city",
    "velocity_1h",
    "shared_accounts",
    "receiver_count",
    "account_age_days",
    "hour_deviation",
    "password_resets",
    "otp_failures",
    "new_beneficiary",
    "merchant_risk",
]
TX = [0, 1, 2, 3, 6, 7, 11]
GRAPH = [4, 5, 3]
SEQ = [8, 9, 10, 3]
BEHAV = [0, 1, 2, 3, 7]


def generate(n=20000, seed=42):
    rng = np.random.default_rng(seed)
    x = np.column_stack(
        [
            rng.lognormal(0, 1, n),
            rng.binomial(1, 0.18, n),
            rng.binomial(1, 0.16, n),
            rng.poisson(2, n),
            rng.poisson(1, n),
            rng.poisson(2, n),
            rng.integers(1, 2000, n),
            rng.uniform(0, 12, n),
            rng.poisson(0.12, n),
            rng.poisson(0.3, n),
            rng.binomial(1, 0.15, n),
            rng.beta(1, 5, n),
        ]
    )
    p = expit(
        -6
        + 0.35 * x[:, 0]
        + 0.9 * x[:, 1]
        + 0.6 * x[:, 2]
        + 0.15 * x[:, 3]
        + 0.35 * x[:, 4]
        + 0.15 * x[:, 5]
        + 0.8 * x[:, 8]
        + 0.5 * x[:, 9]
        + 0.7 * x[:, 10]
        + 1.3 * x[:, 11]
    )
    return x, rng.binomial(1, p)


def event_sequence(row):
    # 0 login, 1 reset, 2 failed OTP, 3 beneficiary, 4 payment
    return (
        [0]
        + [1] * min(int(row[8]), 5)
        + [2] * min(int(row[9]), 8)
        + ([3] if row[10] else [])
        + [4]
    )


def parts(bundle, x):
    raw = -bundle["anomaly"].score_samples(x[:, BEHAV])
    anomaly = np.searchsorted(bundle["anomaly_reference"], raw) / len(
        bundle["anomaly_reference"]
    )
    likelihood = []
    for row in x:
        seq = np.array(event_sequence(row)).reshape(-1, 1)
        likelihood.append(-bundle["hmm"].score(seq) / len(seq))
    likelihood = np.asarray(likelihood)
    seq_x = np.column_stack([x[:, SEQ], likelihood])
    return np.column_stack(
        [
            bundle["transaction"].predict_proba(x[:, TX])[:, 1],
            anomaly,
            bundle["network"].predict_proba(x[:, GRAPH])[:, 1],
            bundle["sequence"].predict_proba(seq_x)[:, 1],
        ]
    )


def train(n=20000):
    ROOT.mkdir(exist_ok=True)
    x, y = generate(n)
    # Independent base-fit, meta-fit, calibration, and untouched evaluation partitions.
    a, b, c = int(n * 0.55), int(n * 0.72), int(n * 0.85)

    def model():
        return LGBMClassifier(
            n_estimators=70,
            num_leaves=15,
            learning_rate=0.06,
            verbosity=-1,
            n_jobs=2,
            random_state=42,
        )

    bundle = {
        "transaction": model().fit(x[:a, TX], y[:a]),
        "network": model().fit(x[:a, GRAPH], y[:a]),
    }
    bundle["anomaly"] = IsolationForest(n_estimators=80, random_state=42, n_jobs=2).fit(
        x[:a][y[:a] == 0][:, BEHAV]
    )
    bundle["anomaly_reference"] = np.sort(
        -bundle["anomaly"].score_samples(x[:a, BEHAV])
    )
    sequences = [event_sequence(r) for r in x[: min(a, 3000)][y[: min(a, 3000)] == 0]]
    hmm = CategoricalHMM(n_components=3, n_iter=30, random_state=42, n_features=5)
    hmm.fit(np.concatenate(sequences).reshape(-1, 1), [len(s) for s in sequences])
    bundle["hmm"] = hmm
    ll = [
        -hmm.score(np.array(event_sequence(r)).reshape(-1, 1)) / len(event_sequence(r))
        for r in x[:a]
    ]
    bundle["sequence"] = model().fit(np.column_stack([x[:a, SEQ], ll]), y[:a])
    s = parts(bundle, x)
    bundle["ensemble"] = LogisticRegression(max_iter=1000).fit(s[a:b], y[a:b])
    logits = bundle["ensemble"].decision_function(s).reshape(-1, 1)
    bundle["calibrator"] = LogisticRegression().fit(logits[b:c], y[b:c])
    pred = bundle["calibrator"].predict_proba(logits[c:])[:, 1]
    metrics = {
        "dataset": "Synthetic feature benchmark; not evidence of real-world detection quality",
        "rows": n,
        "positive_rate": float(y.mean()),
        "test_rows": n - c,
        "average_precision": float(average_precision_score(y[c:], pred)),
        "roc_auc": float(roc_auc_score(y[c:], pred)),
        "brier_score": float(brier_score_loss(y[c:], pred)),
        "confusion_matrix_at_0_5": confusion_matrix(y[c:], pred >= 0.5).tolist(),
    }
    for name, indices in [("transaction", TX), ("network", GRAPH)]:
        metrics[name + "_average_precision"] = float(
            average_precision_score(
                y[c:], bundle[name].predict_proba(x[c:, indices])[:, 1]
            )
        )
    precision, recall, _ = precision_recall_curve(y[c:], pred)
    fpr, tpr, _ = roc_curve(y[c:], pred)
    obs, est = calibration_curve(y[c:], pred, n_bins=8)
    metrics["curves"] = {
        "precision": precision[:: max(1, len(precision) // 100)].tolist(),
        "recall": recall[:: max(1, len(recall) // 100)].tolist(),
        "fpr": fpr.tolist(),
        "tpr": tpr.tolist(),
        "calibration_predicted": est.tolist(),
        "calibration_observed": obs.tolist(),
    }
    from datetime import datetime, timezone

    bundle["reference"] = x[: min(a, 2000)]
    bundle["metrics"] = metrics
    bundle["version"] = "synthetic-" + datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%S%f"
    )
    joblib.dump(bundle, ROOT / "bundle.joblib")
    (ROOT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


_bundle = None


def load():
    global _bundle
    if _bundle is None:
        if not (ROOT / "bundle.joblib").exists():
            raise RuntimeError("Model missing. Run python manage.py train")
        _bundle = joblib.load(ROOT / "bundle.joblib")
    return _bundle


def predict(values, explain=True):
    b = load()
    x = np.asarray(values, dtype=float).reshape(1, -1)
    s = parts(b, x)
    logit = b["ensemble"].decision_function(s).reshape(-1, 1)
    p = float(b["calibrator"].predict_proba(logit)[0, 1])
    factors = []
    if explain:
        # LightGBM native TreeSHAP contributions, explicitly in raw transaction-model log odds.
        shap_values = b["transaction"].booster_.predict(x[:, TX], pred_contrib=True)[0][
            :-1
        ]
        for j in np.argsort(-np.abs(shap_values))[:5]:
            factors.append(
                {
                    "name": NAMES[TX[j]],
                    "contribution": float(shap_values[j]),
                    "message": f'{NAMES[TX[j]].replace("_"," ")}: {x[0,TX[j]]:.2f}',
                }
            )
    return {
        "probability": p,
        "score": round(p * 1000),
        "components": dict(
            zip(
                ["transaction", "behaviour_percentile", "network", "sequence"],
                map(float, s[0]),
            )
        ),
        "factors": factors,
    }
