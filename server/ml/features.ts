import { AttractionCategory, DiscoveredAttraction, GeoCoordinates } from '../../src/types/index.js';
import { estimateVisitDurationMinutes, haversineDistanceKm } from '../places/normalizer.js';

export const FEATURE_SCHEMA_VERSION = 'v1';
export const NUM_RANKER_FEATURES = 12;

export interface RankerContext {
  preferences: string[];
  budget?: number;
  travelers?: number;
  tripDays?: number;
  center: GeoCoordinates;
  previousStop?: { lat: number; lng: number } | null;
  categoryFeedbackAffinity?: Record<string, { positive: number; negative: number }>;
}

const ORDERED_CATEGORIES: AttractionCategory[] = [
  'Historical Places',
  'Museums',
  'Temples and Religious Places',
  'Lakes and Waterfalls',
  'Nature and Parks',
  'Viewpoints',
  'Adventure',
  'Shopping',
  'Cultural Attractions',
  'Food and Gastronomy',
];

const PREFERENCE_CATEGORY_MAP: Record<string, AttractionCategory[]> = {
  historical: ['Historical Places', 'Museums'],
  history: ['Historical Places', 'Museums'],
  culture: ['Cultural Attractions', 'Museums', 'Temples and Religious Places'],
  cultural: ['Cultural Attractions', 'Museums', 'Temples and Religious Places'],
  food: ['Food and Gastronomy', 'Shopping'],
  gastronomy: ['Food and Gastronomy'],
  relaxation: ['Lakes and Waterfalls', 'Nature and Parks', 'Viewpoints'],
  nature: ['Nature and Parks', 'Lakes and Waterfalls', 'Viewpoints'],
  parks: ['Nature and Parks'],
  adventure: ['Adventure', 'Viewpoints', 'Nature and Parks'],
  shopping: ['Shopping', 'Cultural Attractions'],
  photography: ['Viewpoints', 'Historical Places', 'Lakes and Waterfalls'],
  nightlife: ['Cultural Attractions', 'Food and Gastronomy'],
};

export function computeInterestMatchScore(
  attraction: DiscoveredAttraction,
  preferences: string[]
): number {
  if (!preferences || preferences.length === 0) return 0.45;

  const normalizedPrefs = preferences
    .map((p) => p.toLowerCase().trim())
    .filter(Boolean);
  if (normalizedPrefs.length === 0) return 0.45;

  const attrText = `${attraction.name} ${attraction.category} ${attraction.subcategory || ''} ${(
    attraction.tags || []
  ).join(' ')} ${attraction.description}`.toLowerCase();

  let hits = 0;
  for (const pref of normalizedPrefs) {
    let matched = false;
    for (const [key, cats] of Object.entries(PREFERENCE_CATEGORY_MAP)) {
      if (pref.includes(key) && cats.includes(attraction.category)) {
        matched = true;
        break;
      }
    }
    if (!matched && attrText.includes(pref)) {
      matched = true;
    }
    if (matched) hits += 1;
  }

  return Number(Math.min(1, hits / Math.max(1, Math.min(3, normalizedPrefs.length))).toFixed(4));
}

export function extractRankerFeatures(
  attraction: DiscoveredAttraction,
  context: RankerContext
): number[] {
  // 0. interest_match
  const interestMatch = computeInterestMatchScore(attraction, context.preferences);

  // 1. category_id_norm
  const catIdx = ORDERED_CATEGORIES.indexOf(attraction.category);
  const categoryIdNorm = catIdx >= 0 ? Number((catIdx / 9).toFixed(4)) : 0.8889;

  // 2. budget_compatibility
  const travelers = Math.max(1, context.travelers || 2);
  const tripDays = Math.max(1, Math.min(14, context.tripDays || 3));
  const dailyPerPerson = context.budget && context.budget > 0 ? context.budget / (travelers * tripDays) : 3500;
  let budgetCompat = 0.7; // Neutral when entrance fee is unavailable
  if (attraction.feeAmount !== null && attraction.feeAmount !== undefined) {
    if (attraction.feeAmount === 0) {
      budgetCompat = 1.0;
    } else {
      const ratio = attraction.feeAmount / Math.max(200, dailyPerPerson * 0.25);
      budgetCompat = Number(Math.max(0.1, Math.min(1.0, 1.15 - ratio * 0.5)).toFixed(4));
    }
  }

  // 3. distance_from_center_km_norm
  const distCenterKm =
    attraction.distanceFromCenterKm !== undefined
      ? attraction.distanceFromCenterKm
      : haversineDistanceKm(context.center.lat, context.center.lng, attraction.lat, attraction.lng);
  const distCenterNorm = Number((Math.min(50, Math.max(0, distCenterKm)) / 50).toFixed(4));

  // 4. distance_from_prev_km_norm
  const distPrevKm = context.previousStop
    ? haversineDistanceKm(context.previousStop.lat, context.previousStop.lng, attraction.lat, attraction.lng)
    : distCenterKm;
  const distPrevNorm = Number((Math.min(50, Math.max(0, distPrevKm)) / 50).toFixed(4));

  // 5. popularity_log_norm (only when sourced popularity is present!)
  const popVal = attraction.popularity ?? 0;
  const popularityLogNorm =
    popVal > 0 ? Number(Math.min(1, Math.log10(1 + popVal) / 4).toFixed(4)) : 0;

  // 6 & 7. verified rating (strictly 0 if unavailable)
  const hasVerifiedRating =
    attraction.rating !== undefined && attraction.rating !== null && attraction.rating > 0 ? 1 : 0;
  const verifiedRatingNorm = hasVerifiedRating
    ? Number(Math.min(1, attraction.rating! / 5).toFixed(4))
    : 0;

  // 8. estimated_duration_norm
  const durationMin =
    attraction.estimatedVisitDurationMin || estimateVisitDurationMinutes(attraction.category);
  const durationNorm = Number((Math.min(240, Math.max(15, durationMin)) / 240).toFixed(4));

  // 9. user_category_feedback_score
  const catFb = context.categoryFeedbackAffinity?.[attraction.category];
  const fbTotal = catFb ? catFb.positive + catFb.negative : 0;
  const fbScore = catFb
    ? Number(((catFb.positive - catFb.negative) / (fbTotal + 3)).toFixed(4))
    : 0;

  // 10. trip_days_norm
  const tripDaysNorm = Number((tripDays / 14).toFixed(4));

  // 11. source_richness_norm
  const srcCount = attraction.sources?.length || 1;
  const hasDesc = Boolean(
    attraction.description && attraction.description.length > attraction.name.length + 12
  );
  const conf = attraction.confidence ?? 0.65;
  const sourceRichnessNorm = Number(
    Math.min(1, (Math.min(4, srcCount) / 4) * 0.55 + (hasDesc ? 0.25 : 0) + conf * 0.2).toFixed(4)
  );

  return [
    interestMatch,
    categoryIdNorm,
    budgetCompat,
    distCenterNorm,
    distPrevNorm,
    popularityLogNorm,
    hasVerifiedRating,
    verifiedRatingNorm,
    durationNorm,
    fbScore,
    tripDaysNorm,
    sourceRichnessNorm,
  ];
}

export function buildRecommendationExplanation(
  attraction: DiscoveredAttraction,
  features: number[],
  context: RankerContext,
  mode: 'baseline' | 'onnx'
): string {
  const reasons: string[] = [];

  if (features[0] >= 0.5 && context.preferences.length > 0) {
    reasons.push(`Matches ${context.preferences.slice(0, 2).join(' & ')} interests`);
  } else {
    reasons.push(`${attraction.category}`);
  }

  if (features[9] > 0.1) {
    reasons.push('Aligned with your saved/liked feedback');
  }

  const distKm =
    attraction.distanceFromCenterKm ??
    haversineDistanceKm(context.center.lat, context.center.lng, attraction.lat, attraction.lng);
  reasons.push(`${distKm.toFixed(1)} km from ${context.center.name}`);

  if (attraction.sources && attraction.sources.length > 0) {
    reasons.push(`Sources: ${attraction.sources.join(' + ')}`);
  }

  if (mode === 'onnx') {
    reasons.push('Ranked by LightGBM ONNX model');
  }

  return reasons.join(' • ');
}
