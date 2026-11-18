export interface ProviderLicenceSpec {
  source: 'overture' | 'traveltype' | 'wikidata' | 'osm' | 'opentripmap';
  name: string;
  licence: string;
  attribution: string;
  url: string;
  notes: string;
}

export const SOURCE_LICENCE_SPECS: Record<ProviderLicenceSpec['source'], ProviderLicenceSpec> = {
  overture: {
    source: 'overture',
    name: 'Overture Maps Places',
    licence: 'CDLA-Permissive-2.0 / ODbL (per-record source metadata preserved)',
    attribution: 'Overture Maps Foundation & upstream contributors (per-feature sources preserved)',
    url: 'https://docs.overturemaps.org/guides/places/',
    notes:
      'Bulk GeoParquet foundation queried via STAC bounding-box partitioning and row-group pruning. Upstream source names and dataset licenses are retained per record.',
  },
  traveltype: {
    source: 'traveltype',
    name: 'TravelType Open Data',
    licence: 'CC-BY 4.0',
    attribution: 'POI data by TravelType (https://traveltype.app/en/data), licensed under CC-BY 4.0',
    url: 'https://traveltype.app/en/data',
    notes:
      'Honors documented 60 requests/minute rate limit. Images are linked only when permitted and retain their original image_source attribution rather than assuming CC-BY 4.0 covers image rights.',
  },
  wikidata: {
    source: 'wikidata',
    name: 'Wikidata SPARQL',
    licence: 'CC0 1.0 Public Domain Dedication',
    attribution: 'Structured landmark facts and QIDs from Wikidata contributors (CC0 1.0)',
    url: 'https://www.wikidata.org/wiki/Help:Data_access',
    notes:
      'Queried selectively with coordinate radius filters, strict limits, and timeouts. Wikimedia Commons media URLs retain their respective Wikimedia licenses.',
  },
  osm: {
    source: 'osm',
    name: 'OpenStreetMap / Overpass API',
    licence: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors (Open Database License 1.0)',
    url: 'https://www.openstreetmap.org/copyright',
    notes:
      'Used for server-side local discovery and geographic enrichment with multi-mirror fallback, request timeouts, and caching.',
  },
  opentripmap: {
    source: 'opentripmap',
    name: 'OpenTripMap (Optional)',
    licence: 'OpenTripMap Free Tier (Non-Commercial)',
    attribution: 'Place enrichment optionally powered by OpenTripMap (disabled by default)',
    url: 'https://opentripmap.io/product',
    notes:
      'Disabled by default because the free tier is restricted to non-commercial usage. Enable only via OPENTRIPMAP_ENABLED=true and OPENTRIPMAP_API_KEY.',
  },
};

export interface TtlCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private map = new Map<string, TtlCacheEntry<T>>();

  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.map.size > 1000) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

const providerQueues = new Map<string, Promise<unknown>>();
const providerLastRequest = new Map<string, number>();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function scheduleProviderRequest<T>(
  provider: string,
  minIntervalMs: number,
  task: () => Promise<T>
): Promise<T> {
  const prev = providerQueues.get(provider) || Promise.resolve();
  const next = prev.then(
    async () => {
      const last = providerLastRequest.get(provider) || 0;
      const waitMs = minIntervalMs - (Date.now() - last);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      providerLastRequest.set(provider, Date.now());
      return task();
    },
    async () => {
      const last = providerLastRequest.get(provider) || 0;
      const waitMs = minIntervalMs - (Date.now() - last);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      providerLastRequest.set(provider, Date.now());
      return task();
    }
  );
  providerQueues.set(
    provider,
    next.catch(() => undefined)
  );
  return next;
}

export function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return 0;
  const trimmed = headerValue.trim();
  if (!trimmed) return 0;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(parseFloat(trimmed) * 1000));
  }

  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isNaN(parsedDateMs)) {
    return Math.max(0, parsedDateMs - Date.now());
  }
  return 0;
}

export async function fetchWithTimeoutAndRetry(
  url: string,
  init: RequestInit = {},
  options?: {
    timeoutMs?: number;
    maxRetries?: number;
    baseBackoffMs?: number;
    retryOnTimeout?: boolean;
    maxRetryAfterWaitMs?: number;
    onRetryAfter?: (retryAfterMs: number, status: number) => void;
  }
): Promise<Response> {
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? 8000);
  const maxRetries = Math.max(0, Math.min(3, options?.maxRetries ?? 2));
  const baseBackoffMs = Math.max(100, options?.baseBackoffMs ?? 500);
  const retryOnTimeout = options?.retryOnTimeout ?? true;
  const maxRetryAfterWaitMs = Math.max(500, options?.maxRetryAfterWaitMs ?? 3000);

  const computeJitteredDelay = (attempt: number, retryAfterMs = 0) => {
    const exp = baseBackoffMs * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * Math.min(350, baseBackoffMs));
    return Math.max(exp + jitter, retryAfterMs > 0 ? retryAfterMs + Math.floor(Math.random() * 150) : 0);
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (res.status === 429 || res.status === 406) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after')) || 30_000;
        options?.onRetryAfter?.(retryAfterMs, res.status);

        // If Retry-After fits comfortably in a quick retry window, wait and retry;
        // otherwise return immediately so sequential fallback moves to the next mirror.
        if (attempt < maxRetries && retryAfterMs <= maxRetryAfterWaitMs) {
          await sleep(computeJitteredDelay(attempt, retryAfterMs));
          continue;
        }
        return res;
      }

      if (
        (res.status === 502 || res.status === 503 || res.status === 504) &&
        attempt < maxRetries
      ) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        if (retryAfterMs > maxRetryAfterWaitMs) {
          options?.onRetryAfter?.(retryAfterMs, res.status);
          return res;
        }
        await sleep(computeJitteredDelay(attempt, retryAfterMs));
        continue;
      }

      return res;
    } catch (err: any) {
      lastError = err;
      const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      if (attempt < maxRetries && (!isAbort || retryOnTimeout)) {
        await sleep(computeJitteredDelay(attempt));
        continue;
      }
      if (isAbort) {
        const timeoutErr = new Error(
          `Request to ${url} timed out after ${timeoutMs}ms`
        );
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Request failed after ${maxRetries + 1} attempts: ${url}`);
}

export type SafeJsonFailureKind =
  | 'empty'
  | 'html'
  | 'xml'
  | 'plain-text'
  | 'invalid-json'
  | 'overpass-remark';

export type SafeJsonParseResult<T> =
  | {
      ok: true;
      data: T;
      contentType: string;
      status: number;
    }
  | {
      ok: false;
      kind: SafeJsonFailureKind;
      contentType: string;
      status: number;
      preview: string;
      error: string;
      isRateLimited?: boolean;
      isTimeout?: boolean;
    };

export function buildSafeBodyPreview(rawText: string, maxLen = 220): string {
  if (!rawText) return '';
  return rawText
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(api[_-]?key|token|password|secret)=([^&\s]+)/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, maxLen);
}

export async function parseJsonResponseSafely<T = any>(
  res: Response,
  contextLabel: string,
  endpointUrl?: string
): Promise<SafeJsonParseResult<T>> {
  const contentType = res.headers.get('content-type') || 'unknown';
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (err: any) {
    const errorMsg = `${contextLabel} failed reading response body (HTTP ${res.status}, Content-Type: ${contentType}): ${err?.message || 'read error'}`;
    console.warn(`[${contextLabel}] Body read error`, {
      endpoint: endpointUrl || res.url || 'unknown',
      status: res.status,
      contentType,
      error: err?.message,
    });
    return {
      ok: false,
      kind: 'plain-text',
      contentType,
      status: res.status,
      preview: '',
      error: errorMsg,
    };
  }

  const trimmed = rawText.trim();
  const preview = buildSafeBodyPreview(rawText);

  if (!trimmed) {
    console.warn(`[${contextLabel}] Empty response body`, {
      endpoint: endpointUrl || res.url || 'unknown',
      status: res.status,
      contentType,
      preview: '(empty)',
    });
    return {
      ok: false,
      kind: 'empty',
      contentType,
      status: res.status,
      preview: '',
      error: `${contextLabel} returned an empty body (HTTP ${res.status}, Content-Type: ${contentType}).`,
    };
  }

  const ctLower = contentType.toLowerCase();
  const looksHtml =
    ctLower.includes('text/html') || /^<!doctype\s+html|^<html\b/i.test(trimmed);
  const looksXml =
    !looksHtml &&
    (ctLower.includes('xml') || /^<\?xml\b|^<osm\b|^<remark\b/i.test(trimmed));

  if (looksHtml || looksXml) {
    const kind: SafeJsonFailureKind = looksHtml ? 'html' : 'xml';
    const lowerPreview = preview.toLowerCase();
    const isRateLimited =
      res.status === 429 ||
      res.status === 406 ||
      lowerPreview.includes('too many requests') ||
      lowerPreview.includes('rate limit');
    const isTimeout =
      res.status === 504 ||
      lowerPreview.includes('timed out') ||
      lowerPreview.includes('timeout') ||
      lowerPreview.includes('gateway');

    console.warn(`[${contextLabel}] Non-JSON (${kind.toUpperCase()}) response`, {
      endpoint: endpointUrl || res.url || 'unknown',
      status: res.status,
      contentType,
      preview,
    });

    return {
      ok: false,
      kind,
      contentType,
      status: res.status,
      preview,
      isRateLimited,
      isTimeout,
      error: `${contextLabel} returned ${kind.toUpperCase()} instead of JSON (HTTP ${res.status}, Content-Type: ${contentType}). Preview: ${preview}`,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as T & { remark?: string; elements?: unknown[] };
    if (!parsed || typeof parsed !== 'object') {
      console.warn(`[${contextLabel}] Unexpected JSON primitive`, {
        endpoint: endpointUrl || res.url || 'unknown',
        status: res.status,
        contentType,
        preview,
      });
      return {
        ok: false,
        kind: 'invalid-json',
        contentType,
        status: res.status,
        preview,
        error: `${contextLabel} returned a non-object JSON payload (HTTP ${res.status}, Content-Type: ${contentType}).`,
      };
    }

    // Overpass API frequently returns HTTP 200 with { "remark": "runtime error: ...", "elements": [] }
    if (
      typeof parsed.remark === 'string' &&
      parsed.remark.trim().length > 0 &&
      (!Array.isArray(parsed.elements) || parsed.elements.length === 0)
    ) {
      const remarkLower = parsed.remark.toLowerCase();
      const isOverpassErr =
        remarkLower.includes('error') ||
        remarkLower.includes('timed out') ||
        remarkLower.includes('timeout') ||
        remarkLower.includes('rate') ||
        remarkLower.includes('busy') ||
        remarkLower.includes('capacity') ||
        remarkLower.includes('memory');
      if (isOverpassErr) {
        const isTimeout = remarkLower.includes('timed out') || remarkLower.includes('timeout');
        const isRateLimited = remarkLower.includes('rate') || remarkLower.includes('too many');
        console.warn(`[${contextLabel}] Overpass JSON remark error`, {
          endpoint: endpointUrl || res.url || 'unknown',
          status: res.status,
          contentType,
          remark: parsed.remark.slice(0, 220),
        });
        return {
          ok: false,
          kind: 'overpass-remark',
          contentType,
          status: res.status,
          preview: buildSafeBodyPreview(parsed.remark),
          isTimeout,
          isRateLimited,
          error: `${contextLabel} reported an Overpass remark error (HTTP ${res.status}): ${parsed.remark.slice(0, 180)}`,
        };
      }
    }

    return {
      ok: true,
      data: parsed,
      contentType,
      status: res.status,
    };
  } catch (err: any) {
    const looksPlainText = !trimmed.startsWith('{') && !trimmed.startsWith('[');
    const kind: SafeJsonFailureKind = looksPlainText ? 'plain-text' : 'invalid-json';
    const lowerPreview = preview.toLowerCase();
    const isRateLimited =
      res.status === 429 ||
      lowerPreview.includes('too many requests') ||
      lowerPreview.includes('rate limit');
    const isTimeout =
      res.status === 504 ||
      lowerPreview.includes('timed out') ||
      lowerPreview.includes('timeout');

    console.warn(`[${contextLabel}] JSON parse failed (${kind})`, {
      endpoint: endpointUrl || res.url || 'unknown',
      status: res.status,
      contentType,
      parseError: err?.message,
      preview,
    });

    return {
      ok: false,
      kind,
      contentType,
      status: res.status,
      preview,
      isRateLimited,
      isTimeout,
      error: `${contextLabel} returned ${looksPlainText ? 'plain text' : 'invalid JSON'} (HTTP ${res.status}, Content-Type: ${contentType}). Preview: ${preview}`,
    };
  }
}

