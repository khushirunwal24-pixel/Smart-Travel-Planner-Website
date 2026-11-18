import mongoose, { Schema, Model } from 'mongoose';

// 1. PLACES COLLECTION
export interface ISourceProvenance {
  source: 'overture' | 'traveltype' | 'wikidata' | 'osm' | 'opentripmap';
  externalId: string;
  licence: string;
  attribution: string;
  url?: string;
  fetchedAt: Date;
  confidence?: number;
}

export interface IPlace {
  placeId: string;
  name: string;
  normalizedName: string;
  alternateNames: string[];
  description?: string | null;
  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  citySlug?: string | null;
  category: string;
  subcategory?: string | null;
  tags: string[];
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  latitude: number;
  longitude: number;
  sourceIds: {
    overtureGersId?: string;
    wikidataQid?: string;
    osmType?: string;
    osmId?: string;
    osmCompositeId?: string;
    traveltypeId?: string;
    opentripmapXid?: string;
  };
  sourceMetadata: Record<string, any>;
  sourceLicences: Array<{
    source: string;
    licence: string;
    attribution: string;
    url?: string;
  }>;
  provenance: ISourceProvenance[];
  imageUrl?: string | null;
  imageSource?: string | null;
  imageLicence?: string | null;
  confidence?: number | null;
  popularity?: number | null;
  popularitySource?: string | null;
  rating?: number | null;
  ratingSource?: string | null;
  ratingCount?: number | null;
  estimatedVisitDurationMin?: number | null;
  durationIsEstimate: boolean;
  openingHours?: string | null;
  entranceFee?: string | null;
  feeAmount?: number | null;
  website?: string | null;
  nearbyFood?: string | null;
  lastUpdated: Date;
  createdAt: Date;
}

const PlaceSchema = new Schema<IPlace>(
  {
    placeId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    alternateNames: { type: [String], default: [] },
    description: { type: String, default: null },
    country: { type: String, default: null },
    countryCode: { type: String, default: null, uppercase: true, trim: true },
    region: { type: String, default: null },
    city: { type: String, default: null },
    citySlug: { type: String, default: null, lowercase: true, trim: true },
    category: { type: String, required: true, index: true },
    subcategory: { type: String, default: null },
    tags: { type: [String], default: [] },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (coords: number[]) =>
            Array.isArray(coords) &&
            coords.length === 2 &&
            coords[0] >= -180 &&
            coords[0] <= 180 &&
            coords[1] >= -90 &&
            coords[1] <= 90,
          message: 'GeoJSON Point coordinates must be [longitude, latitude].',
        },
      },
    },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    sourceIds: {
      overtureGersId: { type: String },
      wikidataQid: { type: String },
      osmType: { type: String },
      osmId: { type: String },
      osmCompositeId: { type: String },
      traveltypeId: { type: String },
      opentripmapXid: { type: String },
    },
    sourceMetadata: { type: Schema.Types.Mixed, default: {} },
    sourceLicences: {
      type: [
        {
          source: { type: String, required: true },
          licence: { type: String, required: true },
          attribution: { type: String, required: true },
          url: { type: String },
        },
      ],
      default: [],
    },
    provenance: {
      type: [
        {
          source: { type: String, required: true },
          externalId: { type: String, required: true },
          licence: { type: String, required: true },
          attribution: { type: String, required: true },
          url: { type: String },
          fetchedAt: { type: Date, default: Date.now },
          confidence: { type: Number },
        },
      ],
      default: [],
    },
    imageUrl: { type: String, default: null },
    imageSource: { type: String, default: null },
    imageLicence: { type: String, default: null },
    confidence: { type: Number, default: null },
    popularity: { type: Number, default: null },
    popularitySource: { type: String, default: null },
    rating: { type: Number, default: null },
    ratingSource: { type: String, default: null },
    ratingCount: { type: Number, default: null },
    estimatedVisitDurationMin: { type: Number, default: null },
    durationIsEstimate: { type: Boolean, default: true },
    openingHours: { type: String, default: null },
    entranceFee: { type: String, default: null },
    feeAmount: { type: Number, default: null },
    website: { type: String, default: null },
    nearbyFood: { type: String, default: null },
    lastUpdated: { type: Date, default: Date.now },
  },
  {
    collection: 'places',
    timestamps: { createdAt: 'createdAt', updatedAt: 'lastUpdated' },
  }
);

// Geospatial 2dsphere index
PlaceSchema.index({ location: '2dsphere' });
// Destination search indexes
PlaceSchema.index({ countryCode: 1, city: 1 });
PlaceSchema.index({ countryCode: 1, citySlug: 1 });
PlaceSchema.index({ citySlug: 1, category: 1 });
PlaceSchema.index({ category: 1, tags: 1 });
PlaceSchema.index({ normalizedName: 1, countryCode: 1 });
// Source identifier sparse indexes for fast deduplication
PlaceSchema.index({ 'sourceIds.overtureGersId': 1 }, { sparse: true });
PlaceSchema.index({ 'sourceIds.wikidataQid': 1 }, { sparse: true });
PlaceSchema.index({ 'sourceIds.osmCompositeId': 1 }, { sparse: true });
PlaceSchema.index({ 'sourceIds.traveltypeId': 1 }, { sparse: true });
PlaceSchema.index({ 'sourceIds.opentripmapXid': 1 }, { sparse: true });
// Text search index
PlaceSchema.index({
  name: 'text',
  alternateNames: 'text',
  city: 'text',
  country: 'text',
  tags: 'text',
});

// 2. CITIES COLLECTION
export interface ICity {
  citySlug: string;
  name: string;
  country: string;
  countryCode?: string | null;
  region?: string | null;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  latitude: number;
  longitude: number;
  placeCount: number;
  sourcesSynced: string[];
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CitySchema = new Schema<ICity>(
  {
    citySlug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    countryCode: { type: String, default: null, uppercase: true, trim: true },
    region: { type: String, default: null },
    location: {
      type: { type: String, enum: ['Point'], required: true, default: 'Point' },
      coordinates: { type: [Number], required: true },
    },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    placeCount: { type: Number, default: 0 },
    sourcesSynced: { type: [String], default: [] },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { collection: 'cities', timestamps: true }
);
CitySchema.index({ location: '2dsphere' });
CitySchema.index({ countryCode: 1, name: 1 });

// 3. USERS COLLECTION (Lightweight preference mirror linked to Firebase Auth UID; PII stays in Firebase)
export interface IMongoUser {
  uid: string;
  displayName?: string | null;
  preferredCategories: string[];
  preferredBudgetInr?: number | null;
  role: 'user' | 'admin';
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MongoUserSchema = new Schema<IMongoUser>(
  {
    uid: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: null },
    preferredCategories: { type: [String], default: [] },
    preferredBudgetInr: { type: Number, default: null },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { collection: 'users', timestamps: true }
);

// 4. USER FEEDBACK COLLECTION
export type FeedbackActionType =
  | 'selected'
  | 'saved'
  | 'liked'
  | 'disliked'
  | 'skipped'
  | 'visited';

export interface IUserFeedback {
  userId: string;
  sessionId?: string | null;
  queryGroupId: string;
  placeId: string;
  placeName: string;
  category: string;
  destination: string;
  city?: string | null;
  countryCode?: string | null;
  action: FeedbackActionType;
  relevanceLabel: number; // Derived strictly from real action: visited(3) / saved(2) / selected(2) / liked(2) / skipped(0) / disliked(0)
  context: {
    preferences: string[];
    budget?: number | null;
    travelers?: number | null;
    tripDays?: number | null;
    distanceFromCenterKm?: number | null;
    rankingMode: 'baseline' | 'onnx';
    rankPosition?: number | null;
  };
  featureVector: number[];
  featureSchemaVersion: string;
  createdAt: Date;
}

const UserFeedbackSchema = new Schema<IUserFeedback>(
  {
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, default: null },
    queryGroupId: { type: String, required: true, index: true },
    placeId: { type: String, required: true, index: true },
    placeName: { type: String, required: true },
    category: { type: String, required: true, index: true },
    destination: { type: String, required: true, index: true },
    city: { type: String, default: null },
    countryCode: { type: String, default: null, uppercase: true },
    action: {
      type: String,
      enum: ['selected', 'saved', 'liked', 'disliked', 'skipped', 'visited'],
      required: true,
      index: true,
    },
    relevanceLabel: { type: Number, required: true },
    context: {
      preferences: { type: [String], default: [] },
      budget: { type: Number, default: null },
      travelers: { type: Number, default: null },
      tripDays: { type: Number, default: null },
      distanceFromCenterKm: { type: Number, default: null },
      rankingMode: { type: String, enum: ['baseline', 'onnx'], default: 'baseline' },
      rankPosition: { type: Number, default: null },
    },
    featureVector: { type: [Number], default: [] },
    featureSchemaVersion: { type: String, default: 'v1' },
  },
  { collection: 'user_feedback', timestamps: { createdAt: 'createdAt', updatedAt: false } }
);
UserFeedbackSchema.index({ userId: 1, placeId: 1, action: 1 });
UserFeedbackSchema.index({ createdAt: -1 });

// 5. INGESTION JOBS COLLECTION
export interface IIngestionJob {
  jobId: string;
  source: 'overture' | 'traveltype' | 'wikidata' | 'osm' | 'opentripmap' | 'all';
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  bbox?: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
  categories?: string[];
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  cursor: {
    itemIndex: number;
    rowGroupIndex: number;
    page: number;
    lastProcessedKey?: string | null;
  };
  stats: {
    scanned: number;
    imported: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  errorLogs: Array<{ message: string; timestamp: Date; source?: string }>;
  startedBy: string;
  startedAt: Date;
  finishedAt?: Date | null;
}

const IngestionJobSchema = new Schema<IIngestionJob>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    source: {
      type: String,
      enum: ['overture', 'traveltype', 'wikidata', 'osm', 'opentripmap', 'all'],
      required: true,
    },
    countryCode: { type: String, default: null, uppercase: true },
    region: { type: String, default: null },
    city: { type: String, default: null },
    bbox: { type: [Number], default: null },
    categories: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'paused'],
      default: 'queued',
      index: true,
    },
    cursor: {
      itemIndex: { type: Number, default: 0 },
      rowGroupIndex: { type: Number, default: 0 },
      page: { type: Number, default: 0 },
      lastProcessedKey: { type: String, default: null },
    },
    stats: {
      scanned: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    errorLogs: {
      type: [
        {
          message: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
          source: { type: String },
        },
      ],
      default: [],
    },
    startedBy: { type: String, default: 'admin' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { collection: 'ingestion_jobs', timestamps: true }
);

// 6. MODEL VERSIONS COLLECTION
export interface IModelVersion {
  version: string;
  modelType: 'lightgbm-lambdarank-onnx' | 'baseline-heuristic';
  onnxPath?: string | null;
  featureSchemaVersion: string;
  trainingSamples: number;
  trainingGroups: number;
  heldOutGroups: number;
  metrics?: {
    ndcgAt5?: number | null;
    ndcgAt10?: number | null;
    precisionAt5?: number | null;
  } | null;
  isActive: boolean;
  readyForInference: boolean;
  notes?: string | null;
  trainedAt: Date;
}

const ModelVersionSchema = new Schema<IModelVersion>(
  {
    version: { type: String, required: true, unique: true, index: true },
    modelType: {
      type: String,
      enum: ['lightgbm-lambdarank-onnx', 'baseline-heuristic'],
      required: true,
    },
    onnxPath: { type: String, default: null },
    featureSchemaVersion: { type: String, required: true, default: 'v1' },
    trainingSamples: { type: Number, default: 0 },
    trainingGroups: { type: Number, default: 0 },
    heldOutGroups: { type: Number, default: 0 },
    metrics: {
      ndcgAt5: { type: Number, default: null },
      ndcgAt10: { type: Number, default: null },
      precisionAt5: { type: Number, default: null },
    },
    isActive: { type: Boolean, default: false, index: true },
    readyForInference: { type: Boolean, default: false },
    notes: { type: String, default: null },
    trainedAt: { type: Date, default: Date.now },
  },
  { collection: 'model_versions', timestamps: true }
);

export const PlaceModel: Model<IPlace> =
  mongoose.models.Place || mongoose.model<IPlace>('Place', PlaceSchema);

export const CityModel: Model<ICity> =
  mongoose.models.City || mongoose.model<ICity>('City', CitySchema);

export const MongoUserModel: Model<IMongoUser> =
  mongoose.models.MongoUser || mongoose.model<IMongoUser>('MongoUser', MongoUserSchema);

export const UserFeedbackModel: Model<IUserFeedback> =
  mongoose.models.UserFeedback || mongoose.model<IUserFeedback>('UserFeedback', UserFeedbackSchema);

export const IngestionJobModel: Model<IIngestionJob> =
  mongoose.models.IngestionJob || mongoose.model<IIngestionJob>('IngestionJob', IngestionJobSchema);

export const ModelVersionModel: Model<IModelVersion> =
  mongoose.models.ModelVersion || mongoose.model<IModelVersion>('ModelVersion', ModelVersionSchema);
