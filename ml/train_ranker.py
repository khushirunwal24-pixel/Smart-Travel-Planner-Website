"""Offline LightGBM LambdaRank trainer and ONNX exporter for Smart Travel Planner.

Honest Training Guard:
- Reads ONLY real user feedback rows exported from MongoDB `user_feedback`.
- Never fabricates synthetic or random training labels.
- Exits cleanly if feedback samples < min_feedback_samples or query groups < min_query_groups.
"""

import argparse
import datetime as dt
import json
import os
import sys
from typing import Any, Dict, List, Tuple

from evaluate_ranker import evaluate_grouped_ranking


def load_schema(schema_path: str) -> Dict[str, Any]:
    with open(schema_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_feedback_rows(input_path: str, num_features: int) -> List[Dict[str, Any]]:
    if not os.path.exists(input_path):
        return []
    rows: List[Dict[str, Any]] = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            item = json.loads(line)
            vec = item.get("featureVector")
            if isinstance(vec, list) and len(vec) == num_features and item.get("queryGroupId"):
                rows.append(item)
    return rows


def group_counts_in_order(groups: List[str]) -> Tuple[List[int], List[int]]:
    """Return index permutation sorting by group_id and LightGBM group size array."""
    buckets: Dict[str, List[int]] = {}
    for idx, gid in enumerate(groups):
        buckets.setdefault(gid, []).append(idx)
    ordered_indices: List[int] = []
    sizes: List[int] = []
    for gid in buckets:
        idxs = buckets[gid]
        ordered_indices.extend(idxs)
        sizes.append(len(idxs))
    return ordered_indices, sizes


def main() -> int:
    default_onnx = os.environ.get("MODEL_ONNX_PATH", "ml/artifacts/attraction_ranker.onnx")
    default_meta = os.path.join(os.path.dirname(default_onnx) or "ml/artifacts", "model_metadata.json")
    parser = argparse.ArgumentParser(description="Train LightGBM attraction ranker and export ONNX.")
    parser.add_argument("--input", default="ml/data/feedback_dataset.jsonl", help="Real feedback JSONL path")
    parser.add_argument("--schema", default="ml/feature_schema.json", help="Feature schema JSON path")
    parser.add_argument("--output", default=default_onnx, help="Output ONNX path")
    parser.add_argument("--metadata", default=default_meta, help="Metadata JSON path")
    parser.add_argument("--version", default=None, help="Explicit model version tag")
    args = parser.parse_args()

    schema = load_schema(args.schema)
    num_features = int(schema["num_features"])
    thresholds = schema.get("minimum_training_thresholds", {})
    min_samples = int(thresholds.get("min_feedback_samples", 50))
    min_groups = int(thresholds.get("min_query_groups", 10))

    rows = load_feedback_rows(args.input, num_features)
    distinct_groups = {str(r["queryGroupId"]) for r in rows}

    if len(rows) < min_samples or len(distinct_groups) < min_groups:
        print(
            f"[ML Trainer] Insufficient real user feedback for LightGBM training: "
            f"{len(rows)}/{min_samples} samples, {len(distinct_groups)}/{min_groups} query groups. "
            "No synthetic labels will be generated; application remains on transparent baseline ranker."
        )
        return 0

    import lightgbm as lgb
    import numpy as np
    import onnxruntime as ort
    from onnxmltools import convert_lightgbm
    from onnxmltools.convert.common.data_types import FloatTensorType
    from sklearn.model_selection import GroupShuffleSplit

    X = np.array([r["featureVector"] for r in rows], dtype=np.float32)
    y = np.array([int(r["relevanceLabel"]) for r in rows], dtype=np.int32)
    groups = [str(r["queryGroupId"]) for r in rows]

    gss_test = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_val_idx, test_idx = next(gss_test.split(X, y, groups))

    X_tv, y_tv = X[train_val_idx], y[train_val_idx]
    groups_tv = [groups[i] for i in train_val_idx]

    gss_val = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_rel_idx, val_rel_idx = next(gss_val.split(X_tv, y_tv, groups_tv))

    train_idx = [train_val_idx[i] for i in train_rel_idx]
    val_idx = [train_val_idx[i] for i in val_rel_idx]

    tr_perm, tr_sizes = group_counts_in_order([groups[i] for i in train_idx])
    va_perm, va_sizes = group_counts_in_order([groups[i] for i in val_idx])

    X_train = X[[train_idx[i] for i in tr_perm]]
    y_train = y[[train_idx[i] for i in tr_perm]]
    X_val = X[[val_idx[i] for i in va_perm]]
    y_val = y[[val_idx[i] for i in va_perm]]

    X_test = X[test_idx]
    y_test = y[test_idx]
    groups_test = [groups[i] for i in test_idx]

    ranker = lgb.LGBMRanker(
        objective="lambdarank",
        metric="ndcg",
        ndcg_eval_at=[5, 10],
        n_estimators=120,
        learning_rate=0.05,
        num_leaves=15,
        min_child_samples=5,
        subsample=0.85,
        colsample_bytree=0.9,
        random_state=42,
    )

    ranker.fit(
        X_train,
        y_train,
        group=tr_sizes,
        eval_set=[(X_val, y_val)],
        eval_group=[va_sizes],
        callbacks=[lgb.early_stopping(stopping_rounds=20, verbose=False)],
    )

    test_preds = ranker.predict(X_test)
    metrics = evaluate_grouped_ranking(y_test.tolist(), test_preds.tolist(), groups_test)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    onnx_model = convert_lightgbm(
        ranker,
        initial_types=[(schema.get("input_name", "features"), FloatTensorType([None, num_features]))],
        target_opset=12,
    )
    with open(args.output, "wb") as f:
        f.write(onnx_model.SerializeToString())

    # Verify ONNX inference matches LightGBM predictions
    sess = ort.InferenceSession(args.output, providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    ort_preds = sess.run(None, {input_name: X_test})[0].reshape(-1)
    max_diff = float(np.max(np.abs(ort_preds - test_preds))) if len(test_preds) > 0 else 0.0

    version = args.version or f"lgbm-onnx-{dt.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    trained_at = dt.datetime.utcnow().isoformat() + "Z"

    metadata = {
        "version": version,
        "modelType": "lightgbm-lambdarank-onnx",
        "featureSchemaVersion": schema.get("schema_version", "v1"),
        "onnxPath": args.output,
        "trainingSamples": len(rows),
        "trainingGroups": len({groups[i] for i in train_idx}),
        "validationGroups": len({groups[i] for i in val_idx}),
        "heldOutGroups": len(set(groups_test)),
        "metrics": {
            "ndcgAt5": metrics["ndcgAt5"],
            "ndcgAt10": metrics["ndcgAt10"],
            "precisionAt5": metrics["precisionAt5"],
        },
        "onnxMaxNumericalDiff": round(max_diff, 6),
        "readyForInference": max_diff < 1e-3,
        "trainedAt": trained_at,
    }

    with open(args.metadata, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    mongo_uri = os.environ.get("MONGODB_URI")
    if mongo_uri:
        try:
            from pymongo import MongoClient

            db_name = os.environ.get("MONGODB_DB_NAME", "smart_travel_planner")
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            db = client[db_name]
            db["model_versions"].update_many({}, {"$set": {"isActive": False}})
            db["model_versions"].update_one(
                {"version": version},
                {
                    "$set": {
                        "version": version,
                        "modelType": "lightgbm-lambdarank-onnx",
                        "onnxPath": args.output,
                        "featureSchemaVersion": schema.get("schema_version", "v1"),
                        "trainingSamples": len(rows),
                        "trainingGroups": metadata["trainingGroups"],
                        "heldOutGroups": metadata["heldOutGroups"],
                        "metrics": metadata["metrics"],
                        "isActive": metadata["readyForInference"],
                        "readyForInference": metadata["readyForInference"],
                        "notes": f"Verified ONNX parity diff={max_diff:.6f}",
                        "trainedAt": dt.datetime.utcnow(),
                    }
                },
                upsert=True,
            )
            client.close()
        except Exception as exc:
            print(f"[ML Trainer] Warning: could not register model_versions in MongoDB: {exc}", file=sys.stderr)

    print(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
