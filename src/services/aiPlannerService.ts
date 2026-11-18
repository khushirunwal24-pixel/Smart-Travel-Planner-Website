import {
  DiscoveredAttraction,
  GeoCoordinates,
  ItineraryGenerationResponse,
} from '../types';

export interface PlanTripParams {
  destination: string;
  startLocation: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  travelPreferences: string;
  travelMode: string;
  accommodation: string;
  radiusMeters?: number;
  customOverpassUrl?: string;
  customOsrmUrl?: string;
  waitOnRateLimit?: boolean;
}

export interface EndpointAttemptInfo {
  endpoint: string;
  status: number | 'timeout' | 'network-error';
  message: string;
}

export interface AttractionDiscoveryResult {
  destinationInfo: GeoCoordinates;
  attractions: DiscoveredAttraction[];
  searchRadiusMeters: number;
  overpassEndpointUsed: string;
  fallbacksTried: string[];
  source?: string;
  attempts?: EndpointAttemptInfo[];
  coverageNotice?: string;
  modelStatus?: {
    mode: 'baseline' | 'onnx';
    modelVersion: string;
    trainedModelReady: boolean;
    reason?: string;
  };
  queryGroupId?: string;
}

export type PlannerErrorCode =
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INSUFFICIENT_RESULTS'
  | 'GEOCODE_ERROR'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export class PlannerApiError extends Error {
  code: PlannerErrorCode;
  statusCode?: number;
  retryAfterSeconds?: number;
  destGeo?: GeoCoordinates;
  attempts?: EndpointAttemptInfo[];

  constructor(
    message: string,
    code: PlannerErrorCode,
    options?: {
      statusCode?: number;
      retryAfterSeconds?: number;
      destGeo?: GeoCoordinates;
      attempts?: EndpointAttemptInfo[];
    }
  ) {
    super(message);
    this.name = 'PlannerApiError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.destGeo = options?.destGeo;
    this.attempts = options?.attempts;
  }
}

export interface ApiEndpointsConfig {
  overpassUrl: string;
  overpassFallbacks?: string[];
  osrmUrl: string;
  openMeteoGeocodeUrl: string;
  openMeteoForecastUrl: string;
}

export async function fetchDefaultApiConfig(): Promise<ApiEndpointsConfig> {
  try {
    const res = await fetch('/api/config', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      return await parseBackendResponse<ApiEndpointsConfig>(res, 'API config');
    }
  } catch {
    // Fallback to public defaults if config endpoint temporarily unreachable
  }
  return {
    overpassUrl: 'https://overpass-api.de/api/interpreter',
    overpassFallbacks: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ],
    osrmUrl: 'https://router.project-osrm.org/route/v1/driving',
    openMeteoGeocodeUrl: 'https://geocoding-api.open-meteo.com/v1/search',
    openMeteoForecastUrl: 'https://api.open-meteo.com/v1/forecast',
  };
}

function buildSafeResponsePreview(rawText: string, maxLen = 200): string {
  if (!rawText) return '';
  return rawText
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(api[_-]?key|token|password|secret)=([^&\s]+)/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, maxLen);
}

export async function parseBackendResponse<T>(res: Response, contextLabel: string): Promise<T> {
  const contentType = res.headers.get('content-type') || 'unknown';
  const rawText = await res.text();
  const trimmed = rawText.trim();
  const bodyPreview = buildSafeResponsePreview(rawText);

  let payload: any = null;
  let parseErrorMsg: string | null = null;
  if (trimmed) {
    try {
      payload = JSON.parse(trimmed);
    } catch (err: any) {
      payload = null;
      parseErrorMsg = err?.message || 'JSON syntax error';
    }
  }

  const ctLower = contentType.toLowerCase();
  const looksHtml =
    ctLower.includes('text/html') || /^<!doctype\s+html|^<html\b/i.test(trimmed);
  const looksXml =
    !looksHtml && (ctLower.includes('xml') || /^<\?xml\b|^<osm\b/i.test(trimmed));

  if (!payload || typeof payload !== 'object') {
    console.error(`[${contextLabel}] Unexpected non-JSON response`, {
      url: res.url || 'unknown',
      status: res.status,
      contentType,
      parseError: parseErrorMsg || (trimmed ? 'non-object JSON value' : 'empty body'),
      bodyPreview: bodyPreview || '(empty)',
    });
  }

  if (!res.ok) {
    const code: PlannerErrorCode =
      (payload?.code as PlannerErrorCode) ||
      (res.status === 429
        ? 'RATE_LIMITED'
        : res.status === 404
        ? 'INSUFFICIENT_RESULTS'
        : res.status === 400
        ? 'VALIDATION_ERROR'
        : 'SERVICE_UNAVAILABLE');

    const backendMsg =
      payload?.error ||
      (looksHtml
        ? `${contextLabel} failed with HTTP ${res.status} (HTML response, Content-Type: ${contentType}).`
        : bodyPreview
        ? `${contextLabel} failed (HTTP ${res.status}, Content-Type: ${contentType}): ${bodyPreview}`
        : `${contextLabel} failed with backend HTTP ${res.status}.`);

    throw new PlannerApiError(backendMsg, code, {
      statusCode: res.status,
      retryAfterSeconds: payload?.retryAfterSeconds,
      destGeo: payload?.destGeo,
      attempts: payload?.attempts,
    });
  }

  if (!payload || typeof payload !== 'object') {
    const detail = looksHtml
      ? `received an HTML page instead of JSON (HTTP ${res.status}, Content-Type: ${contentType})`
      : looksXml
      ? `received XML instead of JSON (HTTP ${res.status}, Content-Type: ${contentType})`
      : !trimmed
      ? `received an empty response body (HTTP ${res.status}, Content-Type: ${contentType})`
      : `returned an unexpected non-JSON response (HTTP ${res.status}, Content-Type: ${contentType})`;

    const previewNote = !looksHtml && bodyPreview ? ` Preview: ${bodyPreview.slice(0, 120)}` : '';
    throw new PlannerApiError(
      `${contextLabel} ${detail}.${previewNote}`,
      'SERVICE_UNAVAILABLE',
      { statusCode: res.status }
    );
  }

  return payload as T;
}

const INVALID_LITERAL_DESTINATIONS = new Set(['null', 'undefined', 'nan', 'none', 'n/a', 'na']);

export function validateDestinationInput(raw: string): {
  valid: boolean;
  cleaned?: string;
  error?: string;
} {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Destination cannot be empty. Please enter a city name such as Jaipur, Udaipur, or Delhi.',
    };
  }

  if (trimmed.length > 120) {
    return {
      valid: false,
      error: 'Destination name is too long. Please enter a concise city or region name.',
    };
  }

  const parts = trimmed
    .split(',')
    .map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      valid: false,
      error: 'Destination cannot be empty. Please enter a valid city name such as Jaipur, Udaipur, or Delhi.',
    };
  }

  const cityQuery = parts[0];
  if (
    INVALID_LITERAL_DESTINATIONS.has(cityQuery.toLowerCase()) ||
    INVALID_LITERAL_DESTINATIONS.has(trimmed.toLowerCase())
  ) {
    return {
      valid: false,
      error: 'Please enter a real destination city name (e.g. Jaipur, Udaipur, or Delhi).',
    };
  }

  const lettersOnly = cityQuery.replace(/[^\p{L}]/gu, '');
  if (lettersOnly.length < 2) {
    return {
      valid: false,
      error: 'Please enter a valid destination name with at least 2 letters (e.g. Jaipur, Udaipur, or Delhi).',
    };
  }

  return {
    valid: true,
    cleaned: parts.join(', '),
  };
}

// Step 1: Discover real tourist attractions via backend (MongoDB-first + multi-source backfill + single ranker)
export async function discoverRealAttractions(params: {
  destination: string;
  travelPreferences?: string;
  radiusMeters?: number;
  customOverpassUrl?: string;
  budget?: number;
  travelers?: number;
  tripDays?: number;
  userId?: string;
  forceRefresh?: boolean;
}): Promise<AttractionDiscoveryResult> {
  const validation = validateDestinationInput(params.destination);
  if (!validation.valid || !validation.cleaned) {
    throw new PlannerApiError(
      validation.error || 'Destination cannot be empty.',
      'VALIDATION_ERROR',
      { statusCode: 400 }
    );
  }

  let res: Response;
  try {
    res = await fetch('/api/discover-attractions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...params, destination: validation.cleaned }),
    });
  } catch (err: any) {
    throw new PlannerApiError(
      `Unable to reach attraction discovery backend: ${err?.message || 'Network error'}.`,
      'SERVICE_UNAVAILABLE'
    );
  }

  const data = await parseBackendResponse<AttractionDiscoveryResult>(res, 'Attraction discovery');
  if (!Array.isArray(data.attractions) || data.attractions.length === 0) {
    throw new PlannerApiError(
      'Backend returned 0 tourist attractions for this destination.',
      'INSUFFICIENT_RESULTS',
      { statusCode: res.status, destGeo: data.destinationInfo, attempts: data.attempts }
    );
  }
  return data;
}

// Step 2: Generate day-wise itinerary using ONLY the user's selected attractions
export async function generateItineraryFromSelected(
  params: PlanTripParams & {
    selectedAttractions: DiscoveredAttraction[];
    allDiscovered?: DiscoveredAttraction[];
    destinationInfo: GeoCoordinates;
    overpassEndpointUsed?: string;
  }
): Promise<ItineraryGenerationResponse> {
  let res: Response;
  try {
    res = await fetch('/api/generate-selected-itinerary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch (err: any) {
    throw new PlannerApiError(
      `Unable to reach itinerary builder backend: ${err?.message || 'Network error'}.`,
      'SERVICE_UNAVAILABLE'
    );
  }

  const data = await parseBackendResponse<ItineraryGenerationResponse>(
    res,
    'Itinerary generation'
  );
  if (!Array.isArray(data.itinerary)) {
    throw new PlannerApiError(
      'Backend returned an invalid itinerary payload.',
      'INTERNAL_ERROR',
      { statusCode: res.status }
    );
  }
  return data;
}

// Single-step helper (kept for compatibility, server-side only)
export async function generateRealItinerary(
  params: PlanTripParams
): Promise<ItineraryGenerationResponse> {
  const validation = validateDestinationInput(params.destination);
  if (!validation.valid || !validation.cleaned) {
    throw new PlannerApiError(
      validation.error || 'Destination cannot be empty.',
      'VALIDATION_ERROR',
      { statusCode: 400 }
    );
  }

  let res: Response;
  try {
    res = await fetch('/api/generate-itinerary', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ ...params, destination: validation.cleaned }),
    });
  } catch (err: any) {
    throw new PlannerApiError(
      `Unable to reach trip planning backend: ${err?.message || 'Network error'}.`,
      'SERVICE_UNAVAILABLE'
    );
  }

  const data = await parseBackendResponse<ItineraryGenerationResponse>(
    res,
    'Itinerary generation'
  );
  if (!Array.isArray(data.itinerary)) {
    throw new PlannerApiError(
      'Backend returned an invalid itinerary payload.',
      'INTERNAL_ERROR',
      { statusCode: res.status }
    );
  }
  return data;
}

export type FeedbackAction = 'selected' | 'saved' | 'liked' | 'disliked' | 'skipped' | 'visited';

export interface ModelStatusSummary {
  mode: 'baseline' | 'onnx';
  modelVersion: string;
  modelType: 'baseline-heuristic' | 'lightgbm-lambdarank-onnx';
  trainedModelReady: boolean;
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
}

export interface AttributionResponse {
  sources: Array<{
    source: string;
    licence: string;
    attribution: string;
    url?: string;
  }>;
  imagePolicy: string;
  datasetStats?: {
    placesCount: number;
    citiesCount: number;
    mongodb?: { connected: boolean };
  };
}

export async function submitAttractionFeedback(payload: {
  userId?: string;
  queryGroupId?: string;
  attraction: DiscoveredAttraction;
  destination: string;
  center?: GeoCoordinates;
  action: FeedbackAction;
  context?: {
    preferences?: string[];
    budget?: number;
    travelers?: number;
    tripDays?: number;
    rankingMode?: 'baseline' | 'onnx';
    rankPosition?: number;
  };
}): Promise<{ saved: boolean; relevanceLabel?: number }> {
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: payload.userId || 'guest_traveler_101',
        queryGroupId: payload.queryGroupId,
        placeId: payload.attraction.placeId || payload.attraction.id,
        placeName: payload.attraction.name,
        category: payload.attraction.category,
        destination: payload.destination,
        city: payload.attraction.city || payload.center?.name,
        countryCode: payload.attraction.countryCode,
        action: payload.action,
        attraction: payload.attraction,
        center: payload.center,
        context: {
          ...payload.context,
          distanceFromCenterKm: payload.attraction.distanceFromCenterKm,
        },
      }),
    });
    if (!res.ok) return { saved: false };
    return (await res.json()) as { saved: boolean; relevanceLabel?: number };
  } catch {
    return { saved: false };
  }
}

export async function fetchModelStatus(): Promise<ModelStatusSummary | null> {
  try {
    const res = await fetch('/api/admin/model/status', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await parseBackendResponse<ModelStatusSummary>(res, 'Model status');
  } catch {
    return null;
  }
}

export async function fetchAttributionInfo(): Promise<AttributionResponse | null> {
  try {
    const res = await fetch('/api/attribution', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await parseBackendResponse<AttributionResponse>(res, 'Attribution info');
  } catch {
    return null;
  }
}

export async function searchWorldwidePlaces(params: {
  q?: string;
  city?: string;
  countryCode?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: DiscoveredAttraction[]; total: number }> {
  const usp = new URLSearchParams();
  if (params.q) usp.set('q', params.q);
  if (params.city) usp.set('city', params.city);
  if (params.countryCode) usp.set('countryCode', params.countryCode);
  if (params.category) usp.set('category', params.category);
  if (params.page) usp.set('page', String(params.page));
  if (params.limit) usp.set('limit', String(params.limit));

  const res = await fetch(`/api/places/search?${usp.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await parseBackendResponse<{
    items: DiscoveredAttraction[];
    pagination: { total: number };
  }>(res, 'Places search');
  return {
    items: data.items || [],
    total: data.pagination?.total || 0,
  };
}
