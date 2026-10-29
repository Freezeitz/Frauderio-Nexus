"""Export reproducible synthetic feature data for classroom experiments."""

import argparse
from pathlib import Path
import pandas as pd
from fraud_ml.pipeline import generate, NAMES

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--rows", type=int, default=200000)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()
    x, y = generate(args.rows, args.seed)
    frame = pd.DataFrame(x, columns=NAMES)
    frame["is_fraud"] = y
    Path("data/processed").mkdir(parents=True, exist_ok=True)
    frame.to_csv("data/processed/synthetic_features.csv", index=False)
    print(f"Generated {len(frame)} rows; fraud fraction {y.mean():.4f}")
