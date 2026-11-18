import express from 'express';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  buildItineraryFromOsmElements,
  buildItineraryFromSelectedAttractions,
  buildRealLocationItinerary,
  DestinationValidationError,
  discoverAttractionsForDestination,
  geocodeDestination,
  getDefaultApiConfig,
  getOsrmRoute,
  OverpassError,
  processOsmElements,
  rankAttractionsByPreferences,
  validateAndNormalizeDestination,
  validateExternalEndpoint,
} from './server/travelEngine.js';
import { connectToMongoDB, getMongoStatus } from './server/db/connection.js';
import {
  CityModel,
  FeedbackActionType,
  IngestionJobModel,
  IPlace,
  MongoUserModel,
  PlaceModel,
  UserFeedbackModel,
} from './server/db/models.js';
import { SOURCE_LICENCE_SPECS } from './server/places/httpClient.js';
import {
  haversineDistanceKm,
  placeToDiscoveredAttraction,
  resolveCountryCode,
  slugifyCity,
} from './server/places/normalizer.js';
import { listIngestionJobs, runControlledIngestionJob } from './server/places/ingestionManager.js';
import { getModelStatus } from './server/ml/ranker.js';
import { extractRankerFeatures, FEATURE_SCHEMA_VERSION, NUM_RANKER_FEATURES } from './server/ml/features.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));

const FEEDBACK_LABEL_MAP: Record<FeedbackActionType, number> = {
  visited: 3,
  saved: 2,
  selected: 2,
  liked: 2,
  skipped: 0,
  disliked: 0,
};

function handlePlannerApiError(res: express.Response, err: any, fallbackMessage: string) {
  if (err instanceof DestinationValidationError) {
    return res.status(400).json({
      error: err.message,
      code: 'VALIDATION_ERROR',
    });
  }

  if (err instanceof OverpassError) {
    if (err.isRateLimited || err.statusCode === 429 || err.statusCode === 406) {
      return res.status(429).json({
        error: err.message,
        code: 'RATE_LIMITED',
        retryAfterSeconds: err.retryAfterSeconds || 30,
        destGeo: err.destGeo,
        attempts: err.attempts,
      });
    }
    if (err.statusCode === 404) {
      return res.status(404).json({
        error: err.message,
        code: 'INSUFFICIENT_RESULTS',
        destGeo: err.destGeo,
        attempts: err.attempts,
      });
    }
    return res.status(err.statusCode === 502 || err.statusCode === 504 ? err.statusCode : 503).json({
      error: err.message,
      code: 'SERVICE_UNAVAILABLE',
      destGeo: err.destGeo,
      attempts: err.attempts,
    });
  }

  const msg = err?.message || fallbackMessage;
  if (msg.includes('Could not find geographical coordinates')) {
    return res.status(400).json({ error: msg, code: 'GEOCODE_ERROR' });
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ error: msg, code: 'INTERNAL_ERROR' });
}

function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const configuredKey = (process.env.ADMIN_API_KEY || '').trim();
  const headerKey = String(req.headers['x-admin-key'] || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!configuredKey) {
    return res.status(403).json({
      error: 'Admin ingestion API is locked because ADMIN_API_KEY is not configured on the server.',
      code: 'ADMIN_NOT_CONFIGURED',
    });
  }

  const supplied = headerKey || bearerToken;
  if (!supplied) {
    return res.status(401).json({
      error: 'Missing admin authentication credentials (x-admin-key or Bearer token required).',
      code: 'UNAUTHORIZED',
    });
  }

  if (supplied !== configuredKey) {
    return res.status(403).json({
      error: 'Invalid admin authentication credentials.',
      code: 'FORBIDDEN',
    });
  }

  return next();
}

// Health endpoint (including MongoDB + ML readiness status)
app.get('/api/health', async (req, res) => {
  try {
    await connectToMongoDB().catch(() => ({ connected: false }));
    const modelStatus = await getModelStatus().catch(() => null);
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      mongodb: getMongoStatus(),
      model: modelStatus
        ? {
            mode: modelStatus.mode,
            modelVersion: modelStatus.modelVersion,
            trainedModelReady: modelStatus.trainedModelReady,
            feedbackCount: modelStatus.feedbackCount,
          }
        : null,
    });
  } catch (err: any) {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      mongodb: getMongoStatus(),
      error: err?.message,
    });
  }
});

// Expose default public endpoints for UI configurability
app.get('/api/config', (req, res) => {
  res.json(getDefaultApiConfig());
});

// Destination validation + geocoding endpoint (GET & POST)
const geocodeHandler = async (req: express.Request, res: express.Response) => {
  try {
    const rawDest =
      req.method === 'GET'
        ? req.query.destination ?? req.query.city ?? req.query.q
        : req.body?.destination ?? req.body?.city ?? req.body?.q;

    const validation = validateAndNormalizeDestination(rawDest);
    if (!validation.valid || !validation.cleaned) {
      return res.status(400).json({
        error: validation.error || 'Destination cannot be empty.',
        code: 'VALIDATION_ERROR',
      });
    }

    const defaults = getDefaultApiConfig();
    const destinationInfo = await geocodeDestination(
      validation.cleaned,
      defaults.openMeteoGeocodeUrl
    );
    return res.json({ destinationInfo });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to geocode destination.');
  }
};

app.get('/api/geocode', geocodeHandler);
app.post('/api/geocode', geocodeHandler);

// Step 1: Discover real tourist attractions (MongoDB-first + multi-source backfill + single ML/baseline ranker)
const discoverAttractionsHandler = async (req: express.Request, res: express.Response) => {
  try {
    const payload = req.method === 'GET' ? req.query : req.body || {};
    const {
      destination,
      travelPreferences,
      radiusMeters,
      customOverpassUrl,
      budget,
      travelers,
      tripDays,
      userId,
      forceRefresh,
    } = payload;

    const validation = validateAndNormalizeDestination(destination);
    if (!validation.valid || !validation.cleaned) {
      return res.status(400).json({
        error: validation.error || 'Destination is required.',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await discoverAttractionsForDestination({
      destination: validation.cleaned,
      travelPreferences: String(travelPreferences || ''),
      radiusMeters: radiusMeters ? Number(radiusMeters) : undefined,
      customOverpassUrl: customOverpassUrl ? String(customOverpassUrl) : undefined,
      budget: budget ? Number(budget) : undefined,
      travelers: travelers ? Number(travelers) : undefined,
      tripDays: tripDays ? Number(tripDays) : undefined,
      userId: userId ? String(userId) : undefined,
      forceRefresh: forceRefresh === true || forceRefresh === 'true',
    });

    return res.json(result);
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to discover attractions.');
  }
};

app.post('/api/discover-attractions', discoverAttractionsHandler);
app.get('/api/discover-attractions', discoverAttractionsHandler);
app.post('/api/attractions', discoverAttractionsHandler);
app.get('/api/attractions', discoverAttractionsHandler);

// ML-ranked Attraction Recommendations endpoint
app.get('/api/recommendations/attractions', async (req, res) => {
  try {
    const {
      destination,
      travelPreferences,
      budget,
      travelers,
      tripDays,
      radiusMeters,
      userId,
      limit,
    } = req.query;

    const validation = validateAndNormalizeDestination(destination);
    if (!validation.valid || !validation.cleaned) {
      return res.status(400).json({
        error: validation.error || 'Destination is required.',
        code: 'VALIDATION_ERROR',
      });
    }

    const maxItems = limit ? Math.max(1, Math.min(60, Number(limit) || 30)) : 30;
    const result = await discoverAttractionsForDestination({
      destination: validation.cleaned,
      travelPreferences: String(travelPreferences || ''),
      radiusMeters: radiusMeters ? Number(radiusMeters) : undefined,
      budget: budget ? Number(budget) : undefined,
      travelers: travelers ? Number(travelers) : undefined,
      tripDays: tripDays ? Number(tripDays) : undefined,
      userId: userId ? String(userId) : undefined,
    });

    return res.json({
      destinationInfo: result.destinationInfo,
      attractions: result.attractions.slice(0, maxItems),
      modelStatus: result.modelStatus,
      queryGroupId: result.queryGroupId,
      coverageNotice: result.coverageNotice,
      source: result.source,
    });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to compute attraction recommendations.');
  }
});

// Worldwide Places Search API (must precede /api/places/:id)
app.get('/api/places/search', async (req, res) => {
  try {
    await connectToMongoDB().catch(() => null);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB place catalog is not currently connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }

    const q = String(req.query.q || '').trim();
    const city = String(req.query.city || '').trim();
    const countryCode = String(req.query.countryCode || '').trim().toUpperCase();
    const category = String(req.query.category || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || '20'), 10) || 20));

    const filter: Record<string, any> = {};
    if (countryCode && /^[A-Z]{2}$/.test(countryCode)) {
      filter.countryCode = countryCode;
    } else if (countryCode) {
      return res.status(400).json({
        error: 'countryCode must be a valid 2-letter ISO code (e.g. IN, FR, GB, US, JP, AU).',
        code: 'VALIDATION_ERROR',
      });
    }

    if (city) {
      const slug = slugifyCity(city);
      filter.$or = [
        ...(slug ? [{ citySlug: slug }] : []),
        { city: { $regex: new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
      ];
    }

    if (category) {
      filter.category = { $regex: new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
    }

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const qOr = [
        { name: regex },
        { alternateNames: regex },
        { tags: regex },
        { city: regex },
        { country: regex },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: qOr }];
        delete filter.$or;
      } else {
        filter.$or = qOr;
      }
    }

    const total = await PlaceModel.countDocuments(filter);
    const docs = await PlaceModel.find(filter)
      .sort({ popularity: -1, confidence: -1, lastUpdated: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<IPlace[]>();

    return res.json({
      items: docs.map((d) => placeToDiscoveredAttraction(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to search places catalog.');
  }
});

// Geospatial Nearby Places API (must precede /api/places/:id)
app.get('/api/places/nearby', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      req.query.lat === undefined ||
      req.query.lng === undefined ||
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        error: 'Valid numeric lat (-90..90) and lng (-180..180) query parameters are required.',
        code: 'VALIDATION_ERROR',
      });
    }

    await connectToMongoDB().catch(() => null);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB place catalog is not currently connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }

    const radiusMeters = Math.max(500, Math.min(50000, Number(req.query.radiusMeters) || 12000));
    const category = String(req.query.category || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || '20'), 10) || 20));

    const matchStage: Record<string, any> = {
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radiusMeters,
        },
      },
    };
    if (category) {
      matchStage.category = category;
    }

    const docs = await PlaceModel.find(matchStage)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<IPlace[]>();

    const centerRef = { name: 'Query Center', displayName: 'Query Center', lat, lng };
    const items = docs.map((d) => ({
      ...placeToDiscoveredAttraction(d, centerRef),
      distanceFromCenterKm: haversineDistanceKm(lat, lng, d.latitude, d.longitude),
    }));

    return res.json({
      center: { lat, lng },
      radiusMeters,
      items,
      pagination: {
        page,
        limit,
        returned: items.length,
      },
    });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to query nearby places.');
  }
});

// Single Place Detail API
app.get('/api/places/:id', async (req, res) => {
  try {
    await connectToMongoDB().catch(() => null);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB place catalog is not currently connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }

    const rawId = decodeURIComponent(String(req.params.id || '')).trim();
    if (!rawId) {
      return res.status(400).json({ error: 'Place ID is required.', code: 'VALIDATION_ERROR' });
    }

    const doc = await PlaceModel.findOne({
      $or: [
        { placeId: rawId },
        { 'sourceIds.overtureGersId': rawId },
        { 'sourceIds.wikidataQid': rawId.toUpperCase() },
        { 'sourceIds.osmCompositeId': rawId },
        { 'sourceIds.traveltypeId': rawId },
      ],
    }).lean<IPlace>();

    if (!doc) {
      return res.status(404).json({
        error: `Place not found for id "${rawId}".`,
        code: 'NOT_FOUND',
      });
    }

    return res.json({
      place: doc,
      attraction: placeToDiscoveredAttraction(doc),
    });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to retrieve place details.');
  }
});

// User Feedback Collection Endpoint (feeds real-world Learning-to-Rank dataset)
app.post('/api/feedback', async (req, res) => {
  try {
    const body = req.body || {};
    const action = String(body.action || '').trim().toLowerCase() as FeedbackActionType;
    if (!Object.prototype.hasOwnProperty.call(FEEDBACK_LABEL_MAP, action)) {
      return res.status(400).json({
        error: `Invalid action "${body.action}". Allowed: selected, saved, liked, disliked, skipped, visited.`,
        code: 'VALIDATION_ERROR',
      });
    }

    const placeId = String(body.placeId || '').trim();
    const placeName = String(body.placeName || '').trim();
    const category = String(body.category || 'Cultural Attractions').trim();
    const destination = String(body.destination || '').trim();

    if (!placeId || !placeName || !destination) {
      return res.status(400).json({
        error: 'placeId, placeName, and destination are required.',
        code: 'VALIDATION_ERROR',
      });
    }

    await connectToMongoDB().catch(() => null);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB is unavailable to persist feedback.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }

    const userId = String(body.userId || 'guest_traveler_101').trim();
    const queryGroupId =
      String(body.queryGroupId || '').trim() || `qry_fb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const relevanceLabel = FEEDBACK_LABEL_MAP[action];

    let featureVector: number[] = [];
    if (
      Array.isArray(body.featureVector) &&
      body.featureVector.length === NUM_RANKER_FEATURES &&
      body.featureVector.every((v: any) => typeof v === 'number' && Number.isFinite(v))
    ) {
      featureVector = body.featureVector;
    } else if (body.attraction && typeof body.attraction.lat === 'number') {
      const center = body.center && typeof body.center.lat === 'number'
        ? body.center
        : {
            name: destination,
            displayName: destination,
            lat: body.attraction.lat,
            lng: body.attraction.lng,
          };
      featureVector = extractRankerFeatures(body.attraction, {
        preferences: Array.isArray(body.context?.preferences) ? body.context.preferences : [],
        budget: body.context?.budget,
        travelers: body.context?.travelers,
        tripDays: body.context?.tripDays,
        center,
      });
    } else {
      // Fallback 12-feature vector from persisted place doc if available
      const placeDoc = await PlaceModel.findOne({
        $or: [{ placeId }, { 'sourceIds.osmCompositeId': placeId }],
      }).lean<IPlace>();

      if (placeDoc) {
        const attr = placeToDiscoveredAttraction(placeDoc);
        featureVector = extractRankerFeatures(attr, {
          preferences: Array.isArray(body.context?.preferences) ? body.context.preferences : [],
          budget: body.context?.budget,
          travelers: body.context?.travelers,
          tripDays: body.context?.tripDays,
          center: {
            name: destination,
            displayName: destination,
            lat: placeDoc.latitude,
            lng: placeDoc.longitude,
          },
        });
      } else {
        featureVector = new Array(NUM_RANKER_FEATURES).fill(0);
      }
    }

    const feedbackDoc = await UserFeedbackModel.create({
      userId,
      sessionId: body.sessionId ? String(body.sessionId) : null,
      queryGroupId,
      placeId,
      placeName,
      category,
      destination,
      city: body.city ? String(body.city) : null,
      countryCode: resolveCountryCode(null, body.countryCode),
      action,
      relevanceLabel,
      context: {
        preferences: Array.isArray(body.context?.preferences)
          ? body.context.preferences.map(String)
          : [],
        budget: typeof body.context?.budget === 'number' ? body.context.budget : null,
        travelers: typeof body.context?.travelers === 'number' ? body.context.travelers : null,
        tripDays: typeof body.context?.tripDays === 'number' ? body.context.tripDays : null,
        distanceFromCenterKm:
          typeof body.context?.distanceFromCenterKm === 'number'
            ? body.context.distanceFromCenterKm
            : null,
        rankingMode: body.context?.rankingMode === 'onnx' ? 'onnx' : 'baseline',
        rankPosition:
          typeof body.context?.rankPosition === 'number' ? body.context.rankPosition : null,
      },
      featureVector,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    });

    // Sync lightweight user preference mirror in MongoDB (no PII stored)
    const updateUser: any = {
      $set: { lastActiveAt: new Date() },
      $setOnInsert: { uid: userId, role: 'user' },
    };
    if (relevanceLabel >= 2 && category) {
      updateUser.$addToSet = { preferredCategories: category };
    }
    await MongoUserModel.updateOne({ uid: userId }, updateUser, { upsert: true }).catch(() => undefined);

    return res.status(201).json({
      feedbackId: feedbackDoc._id,
      queryGroupId,
      action,
      relevanceLabel,
      saved: true,
    });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to save user feedback.');
  }
});

// Admin Protected Controlled Ingestion API
app.post('/api/admin/ingestion/start', requireAdminAuth, async (req, res) => {
  try {
    await connectToMongoDB().catch(() => null);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB must be connected before starting ingestion.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }

    const body = req.body || {};
    const validSources = new Set(['overture', 'traveltype', 'wikidata', 'osm', 'opentripmap', 'all']);
    const source = String(body.source || 'all').toLowerCase();
    if (!validSources.has(source)) {
      return res.status(400).json({
        error: 'Invalid source. Allowed: overture, traveltype, wikidata, osm, opentripmap, all.',
        code: 'VALIDATION_ERROR',
      });
    }

    let centerGeo = body.center;
    if (!centerGeo && body.city) {
      const defaults = getDefaultApiConfig();
      const validation = validateAndNormalizeDestination(body.city);
      if (validation.valid && validation.cleaned) {
        centerGeo = await geocodeDestination(validation.cleaned, defaults.openMeteoGeocodeUrl);
      }
    }

    const job = await runControlledIngestionJob({
      source: source as any,
      countryCode: body.countryCode ? String(body.countryCode) : undefined,
      region: body.region ? String(body.region) : undefined,
      city: body.city ? String(body.city) : undefined,
      center: centerGeo,
      bbox: Array.isArray(body.bbox) && body.bbox.length === 4 ? body.bbox : undefined,
      radiusMeters: body.radiusMeters ? Number(body.radiusMeters) : undefined,
      maxPlaces: body.maxPlaces ? Math.min(500, Math.max(5, Number(body.maxPlaces))) : 80,
      resumeJobId: body.resumeJobId ? String(body.resumeJobId) : undefined,
      startedBy: 'admin-api',
    });

    return res.status(200).json({ job });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to run controlled ingestion job.');
  }
});

app.get('/api/admin/ingestion/status', requireAdminAuth, async (req, res) => {
  try {
    await connectToMongoDB().catch(() => null);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'MongoDB is not connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }

    const jobId = String(req.query.jobId || '').trim();
    if (jobId) {
      const job = await IngestionJobModel.findOne({ jobId }).lean();
      if (!job) {
        return res.status(404).json({ error: `Ingestion job "${jobId}" not found.`, code: 'NOT_FOUND' });
      }
      return res.json({ job });
    }

    const jobs = await listIngestionJobs(Number(req.query.limit) || 20);
    return res.json({ jobs });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to fetch ingestion status.');
  }
});

// Honest ML Model Readiness & Metrics Endpoint
const modelStatusHandler = async (_req: express.Request, res: express.Response) => {
  try {
    await connectToMongoDB().catch(() => ({ connected: false }));
    const report = await getModelStatus();
    return res.json(report);
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to check ML ranker status.');
  }
};
app.get('/api/admin/model/status', modelStatusHandler);
app.get('/api/model/status', modelStatusHandler);

// Public Attribution & Licensing Metadata Endpoint
app.get('/api/attribution', async (_req, res) => {
  try {
    await connectToMongoDB().catch(() => ({ connected: false }));
    let placesCount = 0;
    let citiesCount = 0;
    if (mongoose.connection.readyState === 1) {
      placesCount = await PlaceModel.countDocuments();
      citiesCount = await CityModel.countDocuments();
    }

    return res.json({
      sources: Object.values(SOURCE_LICENCE_SPECS),
      imagePolicy:
        'Attraction photographs are displayed solely via direct external URLs when a source explicitly identifies an image provider and licence; CC-BY dataset text licences do not grant bulk image redistribution rights.',
      datasetStats: {
        placesCount,
        citiesCount,
        mongodb: getMongoStatus(),
      },
    });
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to fetch attribution metadata.');
  }
});

// Process raw Overpass elements discovered via browser-side multi-server CORS fallback
app.post('/api/process-osm-elements', (req, res) => {
  try {
    const { elements, destGeo, travelPreferences, radiusMeters, endpointUsed } = req.body || {};
    if (!Array.isArray(elements) || !destGeo || typeof destGeo.lat !== 'number') {
      return res.status(400).json({
        error: 'Valid OSM elements and destination coordinates are required.',
        code: 'VALIDATION_ERROR',
      });
    }

    const { attractions } = processOsmElements(elements, destGeo);
    const radius = radiusMeters ? Number(radiusMeters) : 12000;
    if (attractions.length === 0) {
      return res.status(404).json({
        error: `OpenStreetMap returned 0 named tourist attractions within ${(radius / 1000).toFixed(0)} km of ${destGeo.displayName}. Try expanding the search radius.`,
        code: 'INSUFFICIENT_RESULTS',
        destGeo,
      });
    }

    const ranked = rankAttractionsByPreferences(attractions, String(travelPreferences || ''));
    return res.json({
      destinationInfo: destGeo,
      attractions: ranked.slice(0, 60),
      searchRadiusMeters: radius,
      overpassEndpointUsed: String(endpointUsed || 'https://overpass-api.de/api/interpreter'),
      fallbacksTried: [String(endpointUsed || 'browser-overpass')],
    });
  } catch (err: any) {
    console.error('Process OSM elements error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to process OSM places.', code: 'INTERNAL_ERROR' });
  }
});

// Step 2: Generate day-wise itinerary using ONLY the user's selected attractions
app.post('/api/generate-selected-itinerary', async (req, res) => {
  try {
    const {
      selectedAttractions,
      allDiscovered,
      destinationInfo,
      destination,
      startLocation,
      startDate,
      endDate,
      travelers,
      budget,
      travelPreferences,
      travelMode,
      accommodation,
      radiusMeters,
      customOsrmUrl,
      overpassEndpointUsed,
    } = req.body || {};

    if (!Array.isArray(selectedAttractions) || selectedAttractions.length === 0) {
      return res.status(400).json({
        error: 'Please select at least 1 real attraction to build your itinerary.',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!destinationInfo || typeof destinationInfo.lat !== 'number') {
      return res.status(400).json({
        error: 'Destination coordinates are required.',
        code: 'VALIDATION_ERROR',
      });
    }

    const destLabel = destination || destinationInfo.name;
    const validation = validateAndNormalizeDestination(destLabel);
    if (!validation.valid || !validation.cleaned) {
      return res.status(400).json({
        error: validation.error || 'Destination cannot be empty.',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await buildItineraryFromSelectedAttractions(
      selectedAttractions,
      destinationInfo,
      {
        destination: validation.cleaned,
        startLocation: String(startLocation || '').trim(),
        startDate: String(startDate || ''),
        endDate: String(endDate || ''),
        travelers: Number(travelers) || 1,
        budget: Number(budget) || 0,
        travelPreferences: String(travelPreferences || ''),
        travelMode: String(travelMode || 'flight'),
        accommodation: String(accommodation || 'Boutique Hotel'),
        radiusMeters: radiusMeters ? Number(radiusMeters) : undefined,
        customOsrmUrl: customOsrmUrl ? String(customOsrmUrl) : undefined,
      },
      String(overpassEndpointUsed || 'multi-source'),
      Array.isArray(allDiscovered) ? allDiscovered : undefined
    );

    return res.json(result);
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to generate itinerary from selected attractions.');
  }
});

// Real-Location Itinerary Generator endpoint
const generateItineraryHandler = async (req: express.Request, res: express.Response) => {
  try {
    const {
      destination,
      startLocation,
      startDate,
      endDate,
      travelers,
      budget,
      travelPreferences,
      travelMode,
      accommodation,
      radiusMeters,
      customOverpassUrl,
      customOsrmUrl,
      waitOnRateLimit,
    } = req.body || {};

    const validation = validateAndNormalizeDestination(destination);
    if (!validation.valid || !validation.cleaned) {
      return res.status(400).json({
        error: validation.error || 'Destination is required.',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await buildRealLocationItinerary({
      destination: validation.cleaned,
      startLocation: String(startLocation || '').trim(),
      startDate: String(startDate || ''),
      endDate: String(endDate || ''),
      travelers: Number(travelers) || 1,
      budget: Number(budget) || 0,
      travelPreferences: String(travelPreferences || ''),
      travelMode: String(travelMode || 'flight'),
      accommodation: String(accommodation || 'Boutique Hotel'),
      radiusMeters: radiusMeters ? Number(radiusMeters) : undefined,
      customOverpassUrl: customOverpassUrl ? String(customOverpassUrl) : undefined,
      customOsrmUrl: customOsrmUrl ? String(customOsrmUrl) : undefined,
      waitOnRateLimit: Boolean(waitOnRateLimit),
    });

    return res.json(result);
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to build real-location itinerary.');
  }
};

app.post('/api/generate-itinerary', generateItineraryHandler);
app.post('/api/itinerary', generateItineraryHandler);
app.post('/api/itineraries/generate', generateItineraryHandler);

// Process raw Overpass elements discovered via client-side CORS fallback
app.post('/api/plan-from-elements', async (req, res) => {
  try {
    const {
      elements,
      destGeo,
      endpointUsed,
      destination,
      startLocation,
      startDate,
      endDate,
      travelers,
      budget,
      travelPreferences,
      travelMode,
      accommodation,
      radiusMeters,
      customOsrmUrl,
    } = req.body || {};

    if (!Array.isArray(elements) || !destGeo || typeof destGeo.lat !== 'number') {
      return res.status(400).json({ error: 'Valid OSM elements and destination coordinates are required.', code: 'VALIDATION_ERROR' });
    }

    const result = await buildItineraryFromOsmElements(
      elements,
      destGeo,
      {
        destination: String(destination || destGeo.name),
        startLocation: String(startLocation || '').trim(),
        startDate: String(startDate || ''),
        endDate: String(endDate || ''),
        travelers: Number(travelers) || 1,
        budget: Number(budget) || 0,
        travelPreferences: String(travelPreferences || ''),
        travelMode: String(travelMode || 'flight'),
        accommodation: String(accommodation || 'Boutique Hotel'),
        radiusMeters: radiusMeters ? Number(radiusMeters) : undefined,
        customOsrmUrl: customOsrmUrl ? String(customOsrmUrl) : undefined,
      },
      String(endpointUsed || 'https://overpass-api.de/api/interpreter')
    );

    return res.json(result);
  } catch (err: any) {
    return handlePlannerApiError(res, err, 'Failed to assemble itinerary.');
  }
});

// OSRM route geometry & distance/duration endpoint (rate-limited & cached on backend)
const routeHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { points, customOsrmUrl } = req.body || {};
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ error: 'Route points array is required.', code: 'VALIDATION_ERROR' });
    }

    const validPoints = points
      .filter((p: any) => typeof p?.lat === 'number' && typeof p?.lng === 'number')
      .map((p: any) => ({ lat: p.lat, lng: p.lng }));

    if (validPoints.length === 0) {
      return res.status(400).json({ error: 'No valid coordinates provided.', code: 'VALIDATION_ERROR' });
    }

    const defaults = getDefaultApiConfig();
    const osrmUrl = customOsrmUrl
      ? validateExternalEndpoint(String(customOsrmUrl), defaults.osrmUrl)
      : defaults.osrmUrl;

    const routeResult = await getOsrmRoute(validPoints, osrmUrl);
    return res.json(routeResult);
  } catch (err: any) {
    console.error('Route API error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to calculate route.', code: 'INTERNAL_ERROR' });
  }
};

app.post('/api/route', routeHandler);
app.post('/api/routes', routeHandler);

// Guarantee /api/* requests never fall through to SPA HTML HTTP 200
app.use('/api/*', (req, res) => {
  return res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
});

// Guarantee any middleware error (e.g. malformed JSON body) under /api returns JSON instead of Express HTML
app.use(
  '/api',
  (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status =
      typeof err?.status === 'number' && err.status >= 400 && err.status < 600
        ? err.status
        : 500;
    const isJsonSyntax = err?.type === 'entity.parse.failed' || err instanceof SyntaxError;
    console.error(`[API Error] ${req.method} ${req.originalUrl} (HTTP ${status}):`, err?.message || err);
    return res.status(isJsonSyntax ? 400 : status).json({
      error: isJsonSyntax
        ? 'Invalid JSON request payload.'
        : err?.message || 'Unexpected backend error.',
      code: isJsonSyntax || status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
    });
  }
);

// Local / Container Server Boot (bypassed automatically under Vercel serverless)
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const fs = await import('fs');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  }

  // Initialize MongoDB connection lazily on server boot (non-blocking if unreachable)
  connectToMongoDB().catch(() => undefined);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule && process.env.VERCEL !== '1' && process.env.DISABLE_AUTO_LISTEN !== '1') {
  startServer();
}
