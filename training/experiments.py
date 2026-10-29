"""Optional Python research comparisons. Run from root: python -m training.experiments NAME.
These experiments do not silently replace the serving model or alter stored decisions.
"""

import argparse, json
from pathlib import Path
import numpy as np
from fraud_ml.pipeline import generate, NAMES

OUT = Path("model_artifacts/experiments")
OUT.mkdir(parents=True, exist_ok=True)


def anomaly():
    from pyod.models.iforest import IForest
    from pyod.models.lof import LOF
    from sklearn.metrics import average_precision_score

    x, y = generate(12000)
    out = {}
    for name, m in [
        ("Isolation Forest", IForest(random_state=42)),
        ("Local Outlier Factor", LOF(n_neighbors=30)),
    ]:
        m.fit(x[:8000][y[:8000] == 0])
        out[name] = float(
            average_precision_score(y[8000:], m.decision_function(x[8000:]))
        )
    return out


def tune():
    import optuna
    from lightgbm import LGBMClassifier
    from sklearn.metrics import average_precision_score

    x, y = generate(12000)

    def objective(trial):
        m = LGBMClassifier(
            num_leaves=trial.suggest_int("num_leaves", 8, 48),
            learning_rate=trial.suggest_float("learning_rate", 0.02, 0.2, log=True),
            n_estimators=100,
            n_jobs=2,
            verbosity=-1,
            random_state=42,
        )
        m.fit(x[:8000], y[:8000])
        return average_precision_score(
            y[8000:10000], m.predict_proba(x[8000:10000])[:, 1]
        )

    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=12)
    return {
        "best_parameters": study.best_params,
        "validation_average_precision": study.best_value,
        "note": "Untouched final 2000 rows are not used for parameter selection.",
    }


def online():
    from river import anomaly, preprocessing
    from sklearn.metrics import average_precision_score

    x, y = generate(8000)
    scaler = preprocessing.MinMaxScaler()
    model = anomaly.HalfSpaceTrees(seed=42)
    scores = []
    for row in x:
        record = dict(zip(NAMES, map(float, row)))
        scaled = scaler.transform_one(record)
        scores.append(model.score_one(scaled))
        scaler.learn_one(record)
        model.learn_one(scaled)
    return {
        "average_precision_after_warmup": float(
            average_precision_score(y[1000:], scores[1000:])
        ),
        "note": "Prequential evaluation: score before updating; feedback is not automatically trusted.",
    }


def embeddings():
    # Node2Vec biased second-order random walks, then skip-gram embeddings.
    import random, networkx as nx
    from gensim.models import Word2Vec
    from backend.db import Session
    from backend.services import graph

    rng = random.Random(42)
    with Session() as db:
        g = graph(db)
    walks = []
    p = 0.5
    q = 2.0
    for _ in range(8):
        for start in g:
            walk = [start]
            for _ in range(19):
                neighbours = list(g.neighbors(walk[-1]))
                if not neighbours:
                    break
                weights = [
                    (
                        1
                        if len(walk) < 2
                        else (
                            1 / p
                            if n == walk[-2]
                            else 1 if g.has_edge(n, walk[-2]) else 1 / q
                        )
                    )
                    for n in neighbours
                ]
                walk.append(rng.choices(neighbours, weights=weights, k=1)[0])
            walks.append(walk)
    if not walks:
        raise ValueError("Seed the database before generating graph embeddings")
    model = Word2Vec(
        walks,
        vector_size=32,
        window=5,
        min_count=1,
        sg=1,
        workers=1,
        seed=42,
        epochs=10,
    )
    model.wv.save(str(OUT / "node2vec.kv"))
    return {
        "nodes": len(model.wv),
        "dimensions": 32,
        "p": p,
        "q": q,
        "note": "Snapshot embeddings for research; they are not used for historical predictions because a full graph snapshot can leak future relationships.",
    }


def counterfactual():
    import pandas as pd, dice_ml
    from sklearn.ensemble import RandomForestClassifier

    x, y = generate(5000)
    frame = pd.DataFrame(x, columns=NAMES)
    frame["fraud"] = y
    m = RandomForestClassifier(n_estimators=60, max_depth=8, random_state=42).fit(
        frame[NAMES], y
    )
    data = dice_ml.Data(
        dataframe=frame, continuous_features=NAMES, outcome_name="fraud"
    )
    explainer = dice_ml.Dice(
        data, dice_ml.Model(model=m, backend="sklearn"), method="random"
    )
    query = frame.loc[frame.fraud == 1, NAMES].iloc[:1]
    result = explainer.generate_counterfactuals(
        query,
        total_CFs=2,
        desired_class="opposite",
        features_to_vary=["amount_ratio"],
        random_seed=42,
    )
    frames = [
        e.final_cfs_df for e in result.cf_examples_list if e.final_cfs_df is not None
    ]
    return {
        "counterfactuals": [frame.to_dict(orient="records") for frame in frames],
        "note": "DiCE research baseline; only amount ratio can change. Account age, device trust and history remain immutable.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "experiment",
        choices=["anomaly", "tune", "online", "embeddings", "counterfactual"],
    )
    args = parser.parse_args()
    result = globals()[args.experiment]()
    (OUT / (args.experiment + ".json")).write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
