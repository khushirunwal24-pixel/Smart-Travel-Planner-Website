"""Evaluation metrics for grouped Learning-to-Rank attraction recommendations."""

from typing import Dict, Iterable, List, Sequence
import math


def dcg_at_k(relevances: Sequence[float], k: int) -> float:
    score = 0.0
    for idx, rel in enumerate(relevances[:k]):
        gain = (2.0 ** float(rel)) - 1.0
        discount = math.log2(idx + 2.0)
        score += gain / discount
    return score


def ndcg_at_k_for_group(y_true: Sequence[float], y_pred: Sequence[float], k: int) -> float:
    if len(y_true) == 0 or len(y_true) != len(y_pred):
        return 0.0
    paired = sorted(zip(y_pred, y_true), key=lambda x: x[0], reverse=True)
    ranked_rels = [rel for _, rel in paired]
    ideal_rels = sorted(y_true, reverse=True)
    idcg = dcg_at_k(ideal_rels, k)
    if idcg <= 0.0:
        return 0.0
    return dcg_at_k(ranked_rels, k) / idcg


def precision_at_k_for_group(
    y_true: Sequence[float],
    y_pred: Sequence[float],
    k: int,
    positive_threshold: float = 1.0,
) -> float:
    if len(y_true) == 0 or len(y_true) != len(y_pred):
        return 0.0
    paired = sorted(zip(y_pred, y_true), key=lambda x: x[0], reverse=True)
    top_k = paired[:k]
    if not top_k:
        return 0.0
    positives = sum(1 for _, rel in top_k if float(rel) >= positive_threshold)
    return positives / float(len(top_k))


def evaluate_grouped_ranking(
    y_true: Sequence[float],
    y_pred: Sequence[float],
    group_ids: Iterable[str],
) -> Dict[str, float]:
    """Compute mean NDCG@5, NDCG@10, and Precision@5 across query groups."""
    groups: Dict[str, List[int]] = {}
    for idx, gid in enumerate(group_ids):
        groups.setdefault(str(gid), []).append(idx)

    ndcg5_scores: List[float] = []
    ndcg10_scores: List[float] = []
    p5_scores: List[float] = []

    for indices in groups.values():
        g_true = [y_true[i] for i in indices]
        g_pred = [y_pred[i] for i in indices]
        # Skip degenerate groups with zero positive labels for NDCG normalization fairness
        if max(g_true, default=0.0) <= 0.0:
            continue
        ndcg5_scores.append(ndcg_at_k_for_group(g_true, g_pred, 5))
        ndcg10_scores.append(ndcg_at_k_for_group(g_true, g_pred, 10))
        p5_scores.append(precision_at_k_for_group(g_true, g_pred, 5))

    def safe_mean(vals: List[float]) -> float:
        return round(sum(vals) / float(len(vals)), 4) if vals else 0.0

    return {
        "ndcgAt5": safe_mean(ndcg5_scores),
        "ndcgAt10": safe_mean(ndcg10_scores),
        "precisionAt5": safe_mean(p5_scores),
        "evaluatedGroups": len(ndcg5_scores),
    }
