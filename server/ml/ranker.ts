import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { ModelVersionModel, UserFeedbackModel } from '../db/models.js';
import { DiscoveredAttraction } from '../../src/types/index.js';
import {
  buildRecommendationExplanation,
  extractRankerFeatures,
  FEATURE_SCHEMA_VERSION,
  NUM_RANKER_FEATURES,
  RankerContext,
} from './features.js';

export const MIN_TRAINING_FEEDBACK_SAMPLES = 50;
export const MIN_TRAINING_QUERY_GROUPS = 10;

export interface ModelStatusReport {
  mode: 'baseline' | 'onnx';
  modelVersion: string;
  modelType: 'baseline-heuristic' | 'lightgbm-lambdarank-onnx';
  trainedModelReady: boolean;
  onnxFileExists: boolean;
  onnxPath: string;
  featureSchemaVersion: string;
  feedbackCount: number;
  distinctQueryGroups: number;
  minRequiredSamples: number;
  minRequiredGroups: number;
  reason: string;
  metrics: {
    ndcgAt5?: number | null;
    ndcgAt10?: number | null;
    precisionAt5?: number | null;
  } | null;
  trainedAt?: string | null;
}

export interface RankedAttractionResult {
  attractions: DiscoveredAttraction[];
  modelStatus: {
    mode: 'baseline' | 'onnx';
    modelVersion: string;
    trainedModelReady: boolean;
    reason?: string;
  };
}

let cachedOnnxSession: { path: string; mtimeMs: number; session: any } | null = null;

export function scoreBaselineCandidate(features: number[]): number {
  // Deterministic linear baseline matching feature_schema.json v1
  const [
    interestMatch,
    _categoryIdNorm,
    budgetCompat,
    distCenterNorm,
    distPrevNorm,
    popularityLogNorm,
    hasVerifiedRating,
    verifiedRatingNorm,
    _durationNorm,
    userFbScore,
    _tripDaysNorm,
    sourceRichnessNorm,
  ] = features;

  const score =
    0.34 * interestMatch +
    0.18 * popularityLogNorm +
    0.16 * sourceRichnessNorm +
    0.12 * (1 - distCenterNorm) +
    0.05 * (1 - distPrevNorm) +
    0.07 * budgetCompat +
    0.04 * (hasVerifiedRating ? verifiedRatingNorm : 0) +
    0.18 * userFbScore;

  return Number(Math.max(0, Math.min(1, score)).toFixed(4));
}

export async function getModelStatus(): Promise<ModelStatusReport> {
  const configuredPath = process.env.MODEL_ONNX_PATH || 'ml/artifacts/attraction_ranker.onnx';
  const resolvedOnnxPath = path.resolve(process.cwd(), configuredPath);
  const onnxFileExists = fs.existsSync(resolvedOnnxPath);

  let feedbackCount = 0;
  let distinctQueryGroups = 0;
  let activeModelDoc: any = null;

  if (mongoose.connection.readyState === 1) {
    try {
      feedbackCount = await UserFeedbackModel.countDocuments();
      const groups = await UserFeedbackModel.distinct('queryGroupId');
      distinctQueryGroups = Array.isArray(groups) ? groups.length : 0;
      activeModelDoc = await ModelVersionModel.findOne({ isActive: true }).lean();
    } catch {
      // Non-fatal fallback
    }
  }

  // Only activate ONNX inference if an authentic trained model record exists & file exists on disk
  if (
    onnxFileExists &&
    activeModelDoc &&
    activeModelDoc.readyForInference &&
    activeModelDoc.modelType === 'lightgbm-lambdarank-onnx'
  ) {
    return {
      mode: 'onnx',
      modelVersion: activeModelDoc.version,
      modelType: 'lightgbm-lambdarank-onnx',
      trainedModelReady: true,
      onnxFileExists: true,
      onnxPath: configuredPath,
      featureSchemaVersion: activeModelDoc.featureSchemaVersion || FEATURE_SCHEMA_VERSION,
      feedbackCount,
      distinctQueryGroups,
      minRequiredSamples: MIN_TRAINING_FEEDBACK_SAMPLES,
      minRequiredGroups: MIN_TRAINING_QUERY_GROUPS,
      reason: `Active LightGBM ONNX ranker (${activeModelDoc.version}) loaded for server-side inference.`,
      metrics: activeModelDoc.metrics || null,
      trainedAt: activeModelDoc.trainedAt ? new Date(activeModelDoc.trainedAt).toISOString() : null,
    };
  }

  // Check if metadata JSON exists on disk alongside ONNX when MongoDB has no record yet
  const siblingMetaPath = path.join(path.dirname(resolvedOnnxPath), 'model_metadata.json');
  const defaultMetaPath = path.resolve(process.cwd(), 'ml/artifacts/model_metadata.json');
  const metaPath = fs.existsSync(siblingMetaPath) ? siblingMetaPath : defaultMetaPath;
  if (onnxFileExists && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.readyForInference && meta.trainingSamples >= MIN_TRAINING_FEEDBACK_SAMPLES) {
        return {
          mode: 'onnx',
          modelVersion: meta.version || 'lgbm-onnx-v1',
          modelType: 'lightgbm-lambdarank-onnx',
          trainedModelReady: true,
          onnxFileExists: true,
          onnxPath: configuredPath,
          featureSchemaVersion: meta.featureSchemaVersion || FEATURE_SCHEMA_VERSION,
          feedbackCount,
          distinctQueryGroups,
          minRequiredSamples: MIN_TRAINING_FEEDBACK_SAMPLES,
          minRequiredGroups: MIN_TRAINING_QUERY_GROUPS,
          reason: `Trained LightGBM ONNX model (${meta.version || 'lgbm-onnx-v1'}) ready from local artifact metadata.`,
          metrics: meta.metrics || null,
          trainedAt: meta.trainedAt || null,
        };
      }
    } catch {
      // Ignore invalid metadata JSON
    }
  }

  return {
    mode: 'baseline',
    modelVersion: 'baseline-heuristic-v1',
    modelType: 'baseline-heuristic',
    trainedModelReady: false,
    onnxFileExists,
    onnxPath: configuredPath,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    feedbackCount,
    distinctQueryGroups,
    minRequiredSamples: MIN_TRAINING_FEEDBACK_SAMPLES,
    minRequiredGroups: MIN_TRAINING_QUERY_GROUPS,
    reason:
      `Trained LightGBM ONNX model is not ready yet (${feedbackCount}/${MIN_TRAINING_FEEDBACK_SAMPLES} real feedback samples, ${distinctQueryGroups}/${MIN_TRAINING_QUERY_GROUPS} query groups). Running transparent baseline ranking and collecting real feedback.`,
    metrics: null,
    trainedAt: null,
  };
}

async function loadOnnxSession(onnxFilePath: string) {
  const stat = fs.statSync(onnxFilePath);
  if (
    cachedOnnxSession &&
    cachedOnnxSession.path === onnxFilePath &&
    cachedOnnxSession.mtimeMs === stat.mtimeMs
  ) {
    return cachedOnnxSession.session;
  }

  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(onnxFilePath);
  cachedOnnxSession = { path: onnxFilePath, mtimeMs: stat.mtimeMs, session };
  return session;
}

export async function scoreWithOnnxModel(
  onnxFilePath: string,
  featureMatrix: number[][]
): Promise<number[]> {
  if (featureMatrix.length === 0) return [];
  const ort = await import('onnxruntime-node');
  const session = await loadOnnxSession(onnxFilePath);
  const inputName = session.inputNames[0] || 'features';
  const flat = new Float32Array(featureMatrix.length * NUM_RANKER_FEATURES);
  for (let i = 0; i < featureMatrix.length; i++) {
    for (let j = 0; j < NUM_RANKER_FEATURES; j++) {
      flat[i * NUM_RANKER_FEATURES + j] = featureMatrix[i][j] ?? 0;
    }
  }
  const tensor = new ort.Tensor('float32', flat, [featureMatrix.length, NUM_RANKER_FEATURES]);
  const results = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0];
  const outData = results[outputName]?.data;
  if (!outData) {
    throw new Error('ONNX model returned empty output tensor.');
  }
  return Array.from(outData as Float32Array | number[], (v) => Number(v));
}

export async function loadUserCategoryFeedbackAffinity(
  userId?: string
): Promise<Record<string, { positive: number; negative: number }>> {
  if (mongoose.connection.readyState !== 1) return {};
  try {
    const match: any = userId ? { $or: [{ userId }, { action: { $in: ['selected', 'visited', 'liked', 'disliked'] } }] } : {};
    const rows = await UserFeedbackModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          positive: {
            $sum: {
              $cond: [{ $in: ['$action', ['visited', 'saved', 'selected', 'liked']] }, 1, 0],
            },
          },
          negative: {
            $sum: {
              $cond: [{ $in: ['$action', ['disliked', 'skipped']] }, 1, 0],
            },
          },
        },
      },
    ]);

    const map: Record<string, { positive: number; negative: number }> = {};
    for (const r of rows) {
      if (r?._id) {
        map[String(r._id)] = { positive: r.positive || 0, negative: r.negative || 0 };
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function rankAttractionsWithModel(
  candidates: DiscoveredAttraction[],
  context: RankerContext,
  options?: { userId?: string; forceOnnxPath?: string }
): Promise<RankedAttractionResult> {
  if (candidates.length === 0) {
    const status = await getModelStatus();
    return {
      attractions: [],
      modelStatus: {
        mode: status.mode,
        modelVersion: status.modelVersion,
        trainedModelReady: status.trainedModelReady,
        reason: status.reason,
      },
    };
  }

  const affinity =
    context.categoryFeedbackAffinity || (await loadUserCategoryFeedbackAffinity(options?.userId));
  const fullContext: RankerContext = {
    ...context,
    categoryFeedbackAffinity: affinity,
  };

  const featureMatrix = candidates.map((c) => extractRankerFeatures(c, fullContext));
  const status = await getModelStatus();
  const resolvedOverride = options?.forceOnnxPath
    ? path.resolve(process.cwd(), options.forceOnnxPath)
    : null;
  const onnxToUse =
    resolvedOverride && fs.existsSync(resolvedOverride)
      ? resolvedOverride
      : status.mode === 'onnx'
      ? path.resolve(process.cwd(), status.onnxPath)
      : null;

  let scores: number[] = [];
  let activeMode: 'baseline' | 'onnx' = 'baseline';
  let activeVersion = status.modelVersion;
  let activeReady = status.trainedModelReady;
  let activeReason = status.reason;

  if (onnxToUse) {
    try {
      scores = await scoreWithOnnxModel(onnxToUse, featureMatrix);
      activeMode = 'onnx';
      if (resolvedOverride) {
        activeVersion = 'onnx-verified-inference';
        activeReady = true;
      }
    } catch (err: any) {
      console.warn('[ML Ranker] ONNX inference fallback to baseline:', err?.message || err);
      scores = featureMatrix.map((f) => scoreBaselineCandidate(f));
      activeMode = 'baseline';
      activeReason = `ONNX inference fallback to baseline (${err?.message || 'session error'})`;
    }
  } else {
    scores = featureMatrix.map((f) => scoreBaselineCandidate(f));
  }

  const ranked = candidates
    .map((attr, idx) => {
      const score = scores[idx] ?? scoreBaselineCandidate(featureMatrix[idx]);
      const explanation = buildRecommendationExplanation(
        attr,
        featureMatrix[idx],
        fullContext,
        activeMode
      );
      return {
        ...attr,
        recommendationScore: Number(score.toFixed(4)),
        relevanceScore: Math.round(score * 100),
        recommendationExplanation: explanation,
      };
    })
    .sort((a, b) => (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0));

  return {
    attractions: ranked,
    modelStatus: {
      mode: activeMode,
      modelVersion: activeVersion,
      trainedModelReady: activeReady,
      reason: activeReason,
    },
  };
}
