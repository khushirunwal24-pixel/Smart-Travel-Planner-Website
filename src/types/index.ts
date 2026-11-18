export type TripStatus = 'planning' | 'active' | 'completed' | 'cancelled';

export type ExpenseCategory =
  | 'Transport'
  | 'Accommodation'
  | 'Food'
  | 'Activities'
  | 'Shopping'
  | 'Other';

export type AttractionCategory =
  | 'Historical Places'
  | 'Museums'
  | 'Temples and Religious Places'
  | 'Lakes and Waterfalls'
  | 'Nature and Parks'
  | 'Viewpoints'
  | 'Adventure'
  | 'Shopping'
  | 'Cultural Attractions'
  | 'Food and Gastronomy';

export interface SourceLicenceInfo {
  source: string;
  licence: string;
  attribution: string;
  url?: string;
}

export interface DiscoveredAttraction {
  id: string;
  placeId?: string;
  name: string;
  alternateNames?: string[];
  category: AttractionCategory;
  subcategory?: string;
  tags?: string[];
  city?: string;
  locality?: string;
  address?: string;
  country?: string;
  countryCode?: string;
  lat: number;
  lng: number;
  distanceFromCenterKm?: number;
  description: string;
  osmTags: Record<string, string>;
  openingHours?: string;
  estimatedDuration?: string;
  estimatedVisitDurationMin?: number;
  durationIsEstimate?: boolean;
  entranceFee?: string;
  feeAmount?: number | null;
  website?: string;
  nearbyFood?: string;
  imageUrl?: string;
  imageSource?: string;
  imageLicence?: string;
  popularity?: number;
  popularitySource?: string;
  rating?: number;
  ratingSource?: string;
  confidence?: number;
  relevanceScore: number;
  recommendationScore?: number;
  recommendationExplanation?: string;
  osmUrl: string;
  dataSource?: 'openstreetmap-overpass' | 'wikidata-wikipedia' | 'overture' | 'traveltype' | 'mongodb-cache' | 'server-cache' | 'multi-source';
  sources?: string[];
  sourceLicences?: SourceLicenceInfo[];
}

export interface EndpointAttemptLog {
  endpoint: string;
  status: number | 'timeout' | 'network-error';
  message: string;
  retryAfterSeconds?: number;
}

export interface DiscoveryResponse {
  attractions: DiscoveredAttraction[];
  destinationInfo: GeoCoordinates;
  startDistanceKm: number | null;
  searchRadiusMeters: number;
  endpointUsed: string;
  source: 'openstreetmap-overpass' | 'wikidata-wikipedia' | 'mixed' | 'mongodb-cache' | 'server-cache' | 'multi-source';
  attempts: EndpointAttemptLog[];
  note?: string;
  coverageNotice?: string;
  modelStatus?: {
    mode: 'baseline' | 'onnx';
    modelVersion: string;
    trainedModelReady: boolean;
    reason?: string;
  };
  queryGroupId?: string;
}

export interface TripLocationItem {
  name: string;
  category?: AttractionCategory | string;
  description: string;
  visitingTime: string;
  arrivalTime?: string;
  visitDuration?: string;
  distanceFromPrevKm?: number | null;
  travelTimeMin?: number | null;
  distanceSource?: 'osrm' | 'haversine-estimate' | 'start';
  cost: number;
  priceLabel?: string;
  openingHours?: string;
  recommendedActivity: string;
  foodSuggestion: string;
  estimatedDistance?: string;
  lat: number;
  lng: number;
  osmUrl?: string;
  osmId?: string;
}

export interface DayCostBreakdown {
  transport: number;
  accommodation: number;
  food: number;
  entranceFees: number;
  other: number;
}

export interface DayItinerary {
  dayNumber: number;
  date?: string;
  formattedDate?: string;
  theme: string;
  description: string;
  estimatedCost: number;
  costBreakdown?: DayCostBreakdown;
  totalRouteDistanceKm?: number;
  totalRouteDurationMin?: number;
  routeSource?: 'osrm' | 'haversine-fallback';
  locations: TripLocationItem[];
}

export interface BudgetSummary {
  totalBudget: number;
  totalEstimatedExpenditure: number;
  remainingBudget: number;
  perPersonExpenditure: number;
  dailyBreakdown: Array<{
    dayNumber: number;
    date: string;
    formattedDate: string;
    amount: number;
  }>;
  categoryTotals: DayCostBreakdown;
  unavailablePriceCount: number;
}

export interface GeoCoordinates {
  name: string;
  displayName: string;
  country?: string;
  admin1?: string;
  placeType?: string;
  lat: number;
  lng: number;
}

export interface ItineraryGenerationResponse {
  itinerary: DayItinerary[];
  discoveredAttractions: DiscoveredAttraction[];
  destinationInfo: GeoCoordinates;
  budgetSummary: BudgetSummary;
  searchRadiusMeters: number;
  overpassEndpointUsed: string;
  source: string;
  note?: string;
  attempts?: EndpointAttemptLog[];
}

export interface Trip {
  id: string;
  userId: string;
  title: string;
  startLocation: string;
  destination: string;
  startDate: string;
  endDate: string;
  travelers: number;
  budget: number;
  travelPreferences: string;
  travelMode: 'flight' | 'train' | 'bus' | 'car';
  accommodation: string;
  status: TripStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Itinerary {
  id: string;
  tripId: string;
  userId: string;
  destination: string;
  totalDays: number;
  days: DayItinerary[];
  discoveredAttractions?: DiscoveredAttraction[];
  budgetSummary?: BudgetSummary;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  tripId: string;
  userId: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt?: string;
}

export interface DailyForecast {
  date: string;
  dayName: string;
  maxTemp: number;
  minTemp: number;
  condition: string;
  precipitationChance: number;
  weatherCode: number;
}

export interface WeatherData {
  city: string;
  country?: string;
  lat?: number;
  lng?: number;
  temp: number;
  feelsLike: number;
  condition: string;
  weatherCode: number;
  humidity: number;
  windSpeed: number;
  uvIndex: number;
  forecast: DailyForecast[];
  source: 'live' | 'fallback';
}

export interface RouteSegmentResult {
  distanceKm: number;
  durationMin: number;
  geometry: Array<[number, number]>; // [lat, lng]
  legs: Array<{
    fromIndex: number;
    toIndex: number;
    distanceKm: number;
    durationMin: number;
  }>;
  source: 'osrm' | 'haversine-fallback';
  note?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}
