import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  MapPin,
  Calendar,
  Users,
  IndianRupee,
  Compass,
  Car,
  Plane,
  Train,
  Bus,
  Hotel,
  Clock,
  Printer,
  Save,
  RotateCcw,
  Edit3,
  Map as MapIcon,
  CheckCircle,
  AlertCircle,
  X,
  Settings2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Navigation,
  RefreshCw,
  Maximize2,
  Ticket,
  Utensils,
  Search,
  Check,
  ArrowLeft,
  ListChecks,
  ThumbsUp,
  ThumbsDown,
  Bookmark,
  SkipForward,
  Cpu,
  Globe,
  Star,
} from 'lucide-react';
import {
  Trip,
  DayItinerary,
  TripLocationItem,
  Itinerary,
  ItineraryGenerationResponse,
  DiscoveredAttraction,
} from '../types';
import {
  discoverRealAttractions,
  generateItineraryFromSelected,
  fetchDefaultApiConfig,
  validateDestinationInput,
  submitAttractionFeedback,
  PlannerApiError,
  AttractionDiscoveryResult,
  FeedbackAction,
} from '../services/aiPlannerService';
import { createTrip, saveItinerary } from '../services/tripService';
import { useAuth } from '../context/AuthContext';
import { formatINR } from '../utils/currency';

interface TripPlannerProps {
  prefill?: {
    destination?: string;
    startLocation?: string;
    startDate?: string;
    endDate?: string;
    travelers?: number;
  };
  onTripCreated?: (trip: Trip, itinerary: Itinerary) => void;
  onViewOnMap?: (trip: Trip, itinerary: Itinerary, focusedSpot?: TripLocationItem) => void;
  onShowToast: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
}

const PREFERENCE_OPTIONS = [
  'Historical',
  'Culture',
  'Food & Gastronomy',
  'Relaxation',
  'Adventure',
  'Nature & Parks',
  'Shopping',
  'Photography',
  'Nightlife',
];

const ACCOMMODATION_OPTIONS = [
  'Boutique Hotel',
  'Luxury Resort',
  'Cozy City Apartment / Airbnb',
  'Budget Hostel',
  'Heritage Villa / Ryokan',
  'Eco Lodge',
];

const RADIUS_OPTIONS = [
  { label: '8 km (City Center)', value: 8000 },
  { label: '12 km (Standard)', value: 12000 },
  { label: '20 km (Extended City)', value: 20000 },
  { label: '30 km (Metro Area)', value: 30000 },
  { label: '40 km (Regional)', value: 40000 },
];

const CATEGORY_BADGE_STYLES: Record<string, string> = {
  'Historical Places': 'bg-amber-50 text-amber-800 border-amber-200',
  Museums: 'bg-purple-50 text-purple-800 border-purple-200',
  'Temples and Religious Places': 'bg-orange-50 text-orange-800 border-orange-200',
  'Lakes and Waterfalls': 'bg-cyan-50 text-cyan-800 border-cyan-200',
  'Nature and Parks': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Viewpoints: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Adventure: 'bg-rose-50 text-rose-800 border-rose-200',
  Shopping: 'bg-pink-50 text-pink-800 border-pink-200',
  'Cultural Attractions': 'bg-blue-50 text-blue-800 border-blue-200',
  'Food and Gastronomy': 'bg-yellow-50 text-yellow-800 border-yellow-200',
};

export const TripPlanner: React.FC<TripPlannerProps> = ({
  prefill,
  onTripCreated,
  onViewOnMap,
  onShowToast,
}) => {
  const { user, isGuest } = useAuth();
  const userId = user?.uid || 'guest_traveler_101';

  // Form State
  const [destination, setDestination] = useState(prefill?.destination || 'Jaipur');
  const [startLocation, setStartLocation] = useState(prefill?.startLocation || 'New Delhi');
  const [startDate, setStartDate] = useState(
    prefill?.startDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(
    prefill?.endDate || new Date(Date.now() + 17 * 86400000).toISOString().split('T')[0]
  );
  const [travelers, setTravelers] = useState(prefill?.travelers || 2);
  const [budget, setBudget] = useState(25000);
  const [selectedPreferences, setSelectedPreferences] = useState<string[]>([
    'Historical',
    'Culture',
    'Food & Gastronomy',
  ]);
  const [travelMode, setTravelMode] = useState<'flight' | 'train' | 'bus' | 'car'>('train');
  const [accommodation, setAccommodation] = useState('Boutique Hotel');

  // Search Radius & Endpoint Configuration State
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [searchRadiusMeters, setSearchRadiusMeters] = useState(12000);
  const [customOverpassUrl, setCustomOverpassUrl] = useState(
    'https://overpass-api.de/api/interpreter'
  );
  const [customOsrmUrl, setCustomOsrmUrl] = useState(
    'https://router.project-osrm.org/route/v1/driving'
  );

  // Step 1: Discovery & Multi-Select State
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<AttractionDiscoveryResult | null>(null);
  const [selectedAttractionIds, setSelectedAttractionIds] = useState<Set<string>>(new Set());
  const [attractionSearch, setAttractionSearch] = useState('');
  const [attractionCategoryFilter, setAttractionCategoryFilter] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'select' | 'itinerary'>('select');
  const [feedbackByPlace, setFeedbackByPlace] = useState<Record<string, FeedbackAction>>({});
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Step 2: Itinerary Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [planResult, setPlanResult] = useState<ItineraryGenerationResponse | null>(null);
  const [generatedDays, setGeneratedDays] = useState<DayItinerary[] | null>(null);
  const [plannerError, setPlannerError] = useState<{
    message: string;
    code: string;
    statusCode?: number;
    retryAfterSeconds: number;
  } | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Edit Spot Modal State
  const [editingSpot, setEditingSpot] = useState<{
    dayIndex: number;
    spotIndex: number;
    spot: TripLocationItem;
  } | null>(null);

  // Sync prefill props if updated externally
  useEffect(() => {
    if (prefill?.destination) {
      setDestination(prefill.destination);
      setDestinationError(null);
    }
    if (prefill?.startLocation) setStartLocation(prefill.startLocation);
    if (prefill?.startDate) setStartDate(prefill.startDate);
    if (prefill?.endDate) setEndDate(prefill.endDate);
    if (prefill?.travelers) setTravelers(prefill.travelers);
  }, [prefill]);

  // Load default backend API endpoints
  useEffect(() => {
    fetchDefaultApiConfig().then((cfg) => {
      if (cfg.overpassUrl) setCustomOverpassUrl(cfg.overpassUrl);
      if (cfg.osrmUrl) setCustomOsrmUrl(cfg.osrmUrl);
    });
  }, []);

  // Countdown timer for mandatory 30-second pause on Overpass 429/406
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const togglePreference = (pref: string) => {
    setSelectedPreferences((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref]
    );
  };

  const tripDaysCount = useMemo(() => {
    const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
    const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      return Math.max(1, Math.min(14, Math.round((endMs - startMs) / 86400000) + 1));
    }
    return 3;
  }, [startDate, endDate]);

  // Step 1: Fetch real attractions from OpenStreetMap Overpass (with multi-server fallback)
  const runDiscovery = async (overrideRadius?: number) => {
    const validation = validateDestinationInput(destination);
    if (!validation.valid || !validation.cleaned) {
      const errorMsg =
        validation.error ||
        'Destination cannot be empty. Please enter a city name such as Jaipur, Udaipur, or Delhi.';
      setDestinationError(errorMsg);
      setPlannerError({
        message: errorMsg,
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        retryAfterSeconds: 0,
      });
      onShowToast('error', 'Destination Required', errorMsg);
      return;
    }

    if (cooldownSeconds > 0) {
      onShowToast(
        'info',
        'Rate-Limit Pause Active',
        `Please wait ${cooldownSeconds}s before retrying OpenStreetMap Overpass.`
      );
      return;
    }

    const activeRadius = overrideRadius ?? searchRadiusMeters;
    setDestinationError(null);
    setIsDiscovering(true);
    setPlannerError(null);
    setLoadingStage(
      `Geocoding ${validation.cleaned} & fetching real OpenStreetMap attractions (with multi-server Overpass fallback)...`
    );

    try {
      const result = await discoverRealAttractions({
        destination: validation.cleaned,
        travelPreferences: selectedPreferences.join(', '),
        radiusMeters: activeRadius,
        customOverpassUrl: customOverpassUrl.trim() || undefined,
        budget,
        travelers,
        tripDays: tripDaysCount,
        userId,
      });

      setDiscoveryResult(result);
      setFeedbackByPlace({});
      setFailedImages(new Set());
      setGeneratedDays(null);
      setPlanResult(null);
      setAttractionCategoryFilter('All');
      setAttractionSearch('');
      setViewMode('select');

      // Pre-select recommended top attractions matching trip duration (user can freely toggle)
      const defaultSelectCount = Math.min(result.attractions.length, Math.max(4, tripDaysCount * 3));
      const initialIds = new Set(result.attractions.slice(0, defaultSelectCount).map((a) => a.id));
      setSelectedAttractionIds(initialIds);

      onShowToast(
        'success',
        'Real Attractions Loaded',
        `Found ${result.attractions.length} real places in ${result.destinationInfo.displayName}. Select your favorites to build the itinerary.`
      );
    } catch (err: any) {
      const apiErr = err instanceof PlannerApiError ? err : null;
      const code = apiErr?.code || 'SERVICE_UNAVAILABLE';
      const retrySec = apiErr?.retryAfterSeconds || (code === 'RATE_LIMITED' ? 30 : 0);

      if (retrySec > 0) {
        setCooldownSeconds(retrySec);
      }

      setPlannerError({
        message:
          err?.message ||
          'Backend attraction discovery returned an unexpected error.',
        code,
        statusCode: apiErr?.statusCode,
        retryAfterSeconds: retrySec,
      });
      onShowToast(
        'error',
        apiErr?.statusCode ? `Discovery Error (HTTP ${apiErr.statusCode})` : 'Attraction Discovery Failed',
        err?.message || 'Backend discovery failed.'
      );
    } finally {
      setIsDiscovering(false);
      setLoadingStage('');
    }
  };

  const handleDiscoverSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await runDiscovery();
  };

  const handleExpandRadiusAndRetry = async () => {
    const nextRadius =
      searchRadiusMeters < 20000 ? 25000 : searchRadiusMeters < 35000 ? 40000 : 45000;
    setSearchRadiusMeters(nextRadius);
    await runDiscovery(nextRadius);
  };

  // Toggle single attraction card selection
  const toggleAttractionSelection = (id: string) => {
    setSelectedAttractionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Categories present in discovered places
  const availableCategories = useMemo(() => {
    if (!discoveryResult) return ['All'];
    const cats = Array.from(new Set(discoveryResult.attractions.map((a) => a.category)));
    return ['All', ...cats];
  }, [discoveryResult]);

  // Filtered list of selectable attraction cards
  const filteredAttractions = useMemo(() => {
    if (!discoveryResult) return [];
    const q = attractionSearch.trim().toLowerCase();
    return discoveryResult.attractions.filter((attr) => {
      const matchesCat =
        attractionCategoryFilter === 'All' || attr.category === attractionCategoryFilter;
      const matchesSearch =
        !q ||
        attr.name.toLowerCase().includes(q) ||
        attr.category.toLowerCase().includes(q) ||
        attr.description.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [discoveryResult, attractionCategoryFilter, attractionSearch]);

  // Step 2: Generate itinerary using ONLY the selected attractions
  const handleGenerateFromSelected = async () => {
    if (!discoveryResult) return;
    const chosen = discoveryResult.attractions.filter((a) => selectedAttractionIds.has(a.id));
    if (chosen.length === 0) {
      onShowToast(
        'error',
        'No Attractions Selected',
        'Please select at least 1 real tourist attraction card before generating your itinerary.'
      );
      return;
    }

    setIsGenerating(true);
    setPlannerError(null);
    setLoadingStage(
      `Clustering your ${chosen.length} selected real place(s) into ${tripDaysCount} day(s) & computing OSRM routes...`
    );

    try {
      // Log genuine 'selected' interaction signals asynchronously for the ML training dataset
      void Promise.allSettled(
        chosen.slice(0, 12).map((attr, idx) =>
          submitAttractionFeedback({
            userId,
            queryGroupId: discoveryResult.queryGroupId,
            attraction: attr,
            destination: discoveryResult.destinationInfo.displayName || destination.trim(),
            center: discoveryResult.destinationInfo,
            action: 'selected',
            context: {
              preferences: selectedPreferences,
              budget,
              travelers,
              tripDays: tripDaysCount,
              rankingMode: discoveryResult.modelStatus?.mode || 'baseline',
              rankPosition: idx + 1,
            },
          })
        )
      );

      const result = await generateItineraryFromSelected({
        selectedAttractions: chosen,
        allDiscovered: discoveryResult.attractions,
        destinationInfo: discoveryResult.destinationInfo,
        overpassEndpointUsed: discoveryResult.overpassEndpointUsed,
        destination: destination.trim(),
        startLocation: startLocation.trim(),
        startDate,
        endDate,
        travelers,
        budget,
        travelPreferences: selectedPreferences.join(', '),
        travelMode,
        accommodation,
        radiusMeters: searchRadiusMeters,
        customOsrmUrl: customOsrmUrl.trim() || undefined,
      });

      setPlanResult(result);
      setGeneratedDays(result.itinerary);
      setViewMode('itinerary');
      onShowToast(
        'success',
        'Itinerary Generated',
        `Built ${result.itinerary.length}-day itinerary using ONLY your ${chosen.length} selected place(s).`
      );
    } catch (err: any) {
      onShowToast('error', 'Generation Failed', err?.message || 'Could not build itinerary.');
    } finally {
      setIsGenerating(false);
      setLoadingStage('');
    }
  };

  const buildCurrentTripObject = (id = 'temp_trip'): Trip => ({
    id,
    userId,
    title: `${
      planResult?.destinationInfo?.name ||
      discoveryResult?.destinationInfo?.name ||
      destination.trim()
    } Exploration`,
    startLocation: startLocation.trim(),
    destination:
      planResult?.destinationInfo?.displayName ||
      discoveryResult?.destinationInfo?.displayName ||
      destination.trim(),
    startDate,
    endDate,
    travelers,
    budget,
    travelPreferences: selectedPreferences.join(', '),
    travelMode,
    accommodation,
    status: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const buildCurrentItineraryObject = (tripId = 'temp_trip'): Itinerary => ({
    id: `itinerary_${tripId}`,
    tripId,
    userId,
    destination:
      planResult?.destinationInfo?.displayName ||
      discoveryResult?.destinationInfo?.displayName ||
      destination.trim(),
    totalDays: generatedDays?.length || 0,
    days: generatedDays || [],
    discoveredAttractions: planResult?.discoveredAttractions || discoveryResult?.attractions,
    budgetSummary: planResult?.budgetSummary,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const handleSaveTrip = async () => {
    if (!generatedDays || generatedDays.length === 0) return;

    try {
      const destDisplay = planResult?.destinationInfo?.displayName || destination.trim();
      const trip = await createTrip(
        {
          userId,
          title: `${planResult?.destinationInfo?.name || destination.trim()} Exploration`,
          startLocation: startLocation.trim(),
          destination: destDisplay,
          startDate,
          endDate,
          travelers,
          budget,
          travelPreferences: selectedPreferences.join(', '),
          travelMode,
          accommodation,
          status: 'planning',
        },
        isGuest
      );

      const itinerary = await saveItinerary(
        trip.id,
        userId,
        destDisplay,
        generatedDays,
        isGuest,
        {
          discoveredAttractions: planResult?.discoveredAttractions || discoveryResult?.attractions,
          budgetSummary: planResult?.budgetSummary,
        }
      );

      onShowToast(
        'success',
        'Saved Successfully',
        'Trip and selected-attractions itinerary saved to your profile.'
      );
      onTripCreated?.(trip, itinerary);
    } catch {
      onShowToast('error', 'Save Error', 'Could not save trip to Firestore.');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSaveSpotEdit = () => {
    if (!editingSpot || !generatedDays) return;
    const { dayIndex, spotIndex, spot } = editingSpot;
    const updatedDays = [...generatedDays];
    updatedDays[dayIndex] = {
      ...updatedDays[dayIndex],
      locations: updatedDays[dayIndex].locations.map((l, idx) => (idx === spotIndex ? spot : l)),
    };
    setGeneratedDays(updatedDays);
    setEditingSpot(null);
    onShowToast('info', 'Updated', 'Itinerary stop updated.');
  };

  const isBusy = isDiscovering || isGenerating;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-1">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span>OpenStreetMap + Overpass Multi-Server Real-Location Discovery</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading">
            Smart Trip Planner
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Fetch real OpenStreetMap tourist attractions, select the exact places you want to visit, and build your day-wise OSRM route.
          </p>
        </div>

        {(discoveryResult || planResult) && (
          <div className="px-3.5 py-2 rounded-2xl bg-teal-50 border border-teal-200 text-teal-900 text-xs flex items-center gap-2 font-medium">
            <CheckCircle className="w-4 h-4 text-teal-600 shrink-0" />
            <span>
              {(discoveryResult?.attractions.length || planResult?.discoveredAttractions.length || 0)}{' '}
              real OSM places in{' '}
              <strong>
                {planResult?.destinationInfo?.displayName ||
                  discoveryResult?.destinationInfo?.displayName}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Main Grid: Input Parameters Form (Left) & Attraction Selection / Itinerary Output (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form (5 columns) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-5">
          <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 font-heading">Trip Parameters</h3>
            <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">
              {discoveryResult ? 'Step 2: Select Places' : 'Step 1: Discover'}
            </span>
          </div>

          <form onSubmit={handleDiscoverSubmit} noValidate className="space-y-4">
            {/* Destination & Starting City */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-600" /> Target Destination
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    if (destinationError) setDestinationError(null);
                    if (plannerError?.code === 'VALIDATION_ERROR') setPlannerError(null);
                  }}
                  placeholder="e.g. Jaipur, Udaipur, Delhi, Paris, Tokyo"
                  aria-invalid={Boolean(destinationError)}
                  className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 ${
                    destinationError
                      ? 'border-rose-400 bg-rose-50/40 focus:ring-rose-500/20 focus:border-rose-500'
                      : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-600'
                  }`}
                />
                {destinationError && (
                  <p className="mt-1 text-[11px] font-medium text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{destinationError}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-slate-400" /> Starting City / Point of Departure
                </label>
                <input
                  type="text"
                  value={startLocation}
                  onChange={(e) => setStartLocation(e.target.value)}
                  placeholder="e.g. New Delhi, Bilaspur, Mumbai"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>
            </div>

            {/* Travel Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Departure Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Return Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>
            </div>

            {/* Travelers & Budget */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-purple-600" /> Travelers
                </label>
                <select
                  value={travelers}
                  onChange={(e) => setTravelers(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 cursor-pointer"
                >
                  <option value={1}>1 Solo Explorer</option>
                  <option value={2}>2 Couple / Pair</option>
                  <option value={3}>3 Friends Group</option>
                  <option value={4}>4 Family Vacation</option>
                  <option value={6}>6+ Large Group</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <IndianRupee className="w-3.5 h-3.5 text-teal-600" /> Total Budget (₹)
                </label>
                <input
                  type="number"
                  min="1000"
                  step="500"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>
            </div>

            {/* Travel Mode Radio Select */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Primary Transport Mode
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'flight', label: 'Flight', icon: Plane },
                  { id: 'train', label: 'Train', icon: Train },
                  { id: 'bus', label: 'Bus', icon: Bus },
                  { id: 'car', label: 'Car', icon: Car },
                ].map((mode) => {
                  const Icon = mode.icon;
                  const isSel = travelMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setTravelMode(mode.id as any)}
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1 text-[11px] font-semibold transition-all cursor-pointer ${
                        isSel
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-2xs'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Accommodation Preference */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Hotel className="w-3.5 h-3.5 text-blue-600" /> Accommodation Preference
              </label>
              <select
                value={accommodation}
                onChange={(e) => setAccommodation(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 cursor-pointer"
              >
                {ACCOMMODATION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Travel Preferences Chips */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Travel Style & Preferences
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PREFERENCE_OPTIONS.map((pref) => {
                  const isSel = selectedPreferences.includes(pref);
                  return (
                    <button
                      key={pref}
                      type="button"
                      onClick={() => togglePreference(pref)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                        isSel
                          ? 'bg-blue-600 text-white shadow-2xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      {pref}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Collapsible Search Radius & API Provider Config */}
            <div className="pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAdvancedConfig((v) => !v)}
                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-500 hover:text-slate-800 py-1.5 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                  Search Radius ({Math.round(searchRadiusMeters / 1000)} km) & Overpass Endpoints
                </span>
                {showAdvancedConfig ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {showAdvancedConfig && (
                <div className="mt-2 p-3 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-2.5 text-[11px]">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Attraction Search Radius
                    </label>
                    <select
                      value={searchRadiusMeters}
                      onChange={(e) => setSearchRadiusMeters(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800"
                    >
                      {RADIUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Primary Overpass URL (with automatic multi-mirror fallback)
                    </label>
                    <input
                      type="url"
                      value={customOverpassUrl}
                      onChange={(e) => setCustomOverpassUrl(e.target.value)}
                      placeholder="https://overpass-api.de/api/interpreter"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      OSRM Routing Endpoint
                    </label>
                    <input
                      type="url"
                      value={customOsrmUrl}
                      onChange={(e) => setCustomOsrmUrl(e.target.value)}
                      placeholder="https://router.project-osrm.org/route/v1/driving"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button: Discover Real Attractions */}
            <button
              type="submit"
              disabled={isBusy || cooldownSeconds > 0}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-blue-700 to-teal-500 hover:from-blue-700 hover:to-teal-600 disabled:opacity-60 text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {isDiscovering ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Fetching Real OpenStreetMap Places...</span>
                </>
              ) : cooldownSeconds > 0 ? (
                <>
                  <Clock className="w-4 h-4" />
                  <span>Rate-Limit Pause ({cooldownSeconds}s)</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Discover Real Tourist Attractions</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Output: Selectable Attractions OR Generated Itinerary (7 columns) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Loading Banner */}
          {isBusy && (
            <div className="bg-white p-8 rounded-3xl border border-blue-200 shadow-xs text-center space-y-3 animate-fade-in">
              <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <h3 className="text-sm font-bold text-slate-900 font-heading">
                {isDiscovering
                  ? `Discovering Real Places in ${destination}`
                  : `Building Itinerary from Selected Places`}
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {loadingStage || 'Querying OpenStreetMap Overpass fallback servers...'}
              </p>
            </div>
          )}

          {/* Fallback Error Card with Retry, 30s Pause, Expand Radius, Custom Provider URL */}
          {!isBusy && plannerError && (
            <div className="bg-rose-50/90 border border-rose-200 rounded-3xl p-6 space-y-4 shadow-xs animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-rose-950 font-heading">
                    {plannerError.code === 'VALIDATION_ERROR'
                      ? 'Destination Required'
                      : plannerError.code === 'RATE_LIMITED'
                      ? 'Overpass Rate-Limit Pause Required'
                      : plannerError.code === 'INSUFFICIENT_RESULTS'
                      ? 'No Real Attractions Found Within Current Radius'
                      : plannerError.code === 'GEOCODE_ERROR'
                      ? 'Destination Not Found'
                      : `Attraction Discovery Failed${plannerError.statusCode ? ` (HTTP ${plannerError.statusCode})` : ''}`}
                  </h3>
                  <p className="text-xs text-rose-800 mt-1 leading-relaxed break-words">
                    {plannerError.message}
                  </p>
                  <p className="text-[11px] text-rose-700 mt-1.5">
                    To maintain data accuracy, Smart Travel Planner never invents fictional attractions, prices, ratings, or opening hours.
                  </p>
                </div>
              </div>

              {plannerError.code !== 'VALIDATION_ERROR' && (
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={cooldownSeconds > 0}
                    onClick={() => runDiscovery()}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      {cooldownSeconds > 0 ? `Retry in ${cooldownSeconds}s` : 'Retry Discovery'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={cooldownSeconds > 0 || searchRadiusMeters >= 45000}
                    onClick={handleExpandRadiusAndRetry}
                    className="px-4 py-2 rounded-xl bg-white border border-rose-200 hover:bg-rose-100/70 disabled:opacity-50 text-rose-900 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>
                      Expand Radius (to{' '}
                      {searchRadiusMeters < 20000 ? 25 : searchRadiusMeters < 35000 ? 40 : 45} km)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAdvancedConfig(true)}
                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    <span>Configure Overpass URL</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 1 OUTPUT: Selectable Real Attraction Cards */}
          {!isBusy && !plannerError && discoveryResult && viewMode === 'select' && (
            <div className="space-y-4 animate-fade-in">
              {/* Selection Header & Generate CTA */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-teal-700 mb-0.5">
                      <ListChecks className="w-4 h-4" />
                      <span>Select Attractions for Your Itinerary</span>
                      {discoveryResult.modelStatus && (
                        <span
                          title={discoveryResult.modelStatus.reason}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                            discoveryResult.modelStatus.mode === 'onnx'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}
                        >
                          <Cpu className="w-3 h-3" />
                          {discoveryResult.modelStatus.mode === 'onnx'
                            ? 'LightGBM ONNX'
                            : 'Baseline Ranker'}
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-900 text-base font-heading">
                      {discoveryResult.attractions.length} Real Tourist Places in{' '}
                      {discoveryResult.destinationInfo.displayName}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Source:{' '}
                      {discoveryResult.source === 'mongodb-cache'
                        ? 'Worldwide MongoDB Atlas/Local Catalog (Multi-Source)'
                        : discoveryResult.source === 'server-cache'
                        ? 'Server Discovery Cache (OpenStreetMap / Open Data)'
                        : discoveryResult.source === 'multi-source'
                        ? 'Multi-Source (TravelType + Wikidata + OpenStreetMap)'
                        : discoveryResult.source === 'openstreetmap-overpass'
                        ? 'OpenStreetMap Overpass'
                        : discoveryResult.source === 'mixed'
                        ? 'OpenStreetMap + Wikidata/Wikipedia'
                        : discoveryResult.overpassEndpointUsed || 'Open Travel Data'}{' '}
                      ({discoveryResult.overpassEndpointUsed})
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={selectedAttractionIds.size === 0}
                    onClick={handleGenerateFromSelected}
                    className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 disabled:opacity-50 text-white font-bold text-xs shadow-sm shadow-blue-500/20 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      Generate Itinerary Using Selected ({selectedAttractionIds.size})
                    </span>
                  </button>
                </div>

                {discoveryResult.coverageNotice && (
                  <div className="p-3 rounded-2xl bg-amber-50/90 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{discoveryResult.coverageNotice}</span>
                  </div>
                )}

                {/* Search + Bulk Selection Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={attractionSearch}
                      onChange={(e) => setAttractionSearch(e.target.value)}
                      placeholder="Filter discovered places by name or category..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        const topN = Math.min(
                          discoveryResult.attractions.length,
                          Math.max(4, tripDaysCount * 3)
                        );
                        setSelectedAttractionIds(
                          new Set(discoveryResult.attractions.slice(0, topN).map((a) => a.id))
                        );
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold cursor-pointer"
                    >
                      Top Recommended
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedAttractionIds(
                          new Set(filteredAttractions.map((a) => a.id))
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                    >
                      Select Visible ({filteredAttractions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAttractionIds(new Set())}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Category Filter Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {availableCategories.map((cat) => {
                    const active = attractionCategoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setAttractionCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Multi-Select Grid of Real Attraction Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[680px] overflow-y-auto pr-1">
                {filteredAttractions.map((attr, idx) => {
                  const isSelected = selectedAttractionIds.has(attr.id);
                  const catStyle =
                    CATEGORY_BADGE_STYLES[attr.category] ||
                    'bg-slate-100 text-slate-700 border-slate-200';
                  const currentFeedback = feedbackByPlace[attr.id];
                  const showVerifiedImage =
                    Boolean(attr.imageUrl && attr.imageSource && !failedImages.has(attr.id));

                  const handleFeedbackClick = async (
                    e: React.MouseEvent,
                    action: FeedbackAction
                  ) => {
                    e.stopPropagation();
                    setFeedbackByPlace((prev) => ({ ...prev, [attr.id]: action }));
                    if (action === 'saved') {
                      setSelectedAttractionIds((prev) => new Set(prev).add(attr.id));
                    } else if (action === 'disliked' || action === 'skipped') {
                      setSelectedAttractionIds((prev) => {
                        const next = new Set(prev);
                        next.delete(attr.id);
                        return next;
                      });
                    }
                    const res = await submitAttractionFeedback({
                      userId,
                      queryGroupId: discoveryResult.queryGroupId,
                      attraction: attr,
                      destination: discoveryResult.destinationInfo.displayName || destination,
                      center: discoveryResult.destinationInfo,
                      action,
                      context: {
                        preferences: selectedPreferences,
                        budget,
                        travelers,
                        tripDays: tripDaysCount,
                        rankingMode: discoveryResult.modelStatus?.mode || 'baseline',
                        rankPosition: idx + 1,
                      },
                    });
                    if (res.saved) {
                      onShowToast(
                        'info',
                        'Preference Recorded',
                        `Recorded "${action}" feedback for ${attr.name} to improve future rankings.`
                      );
                    }
                  };

                  return (
                    <div
                      key={attr.id}
                      onClick={() => toggleAttractionSelection(attr.id)}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          toggleAttractionSelection(attr.id);
                        }
                      }}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/40 ring-2 ring-blue-600/15 shadow-xs'
                          : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="space-y-2">
                        {showVerifiedImage && (
                          <div className="relative rounded-xl overflow-hidden bg-slate-100 h-28">
                            <img
                              src={attr.imageUrl}
                              alt={attr.name}
                              loading="lazy"
                              onError={() =>
                                setFailedImages((prev) => new Set(prev).add(attr.id))
                              }
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-slate-900/75 text-[9px] text-white font-medium">
                              Photo: {attr.imageSource}
                            </span>
                          </div>
                        )}

                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-sm text-slate-900 leading-snug">
                              {attr.name}
                            </h4>
                            {(attr.locality || attr.city || attr.country) && (
                              <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                <Globe className="w-2.5 h-2.5 shrink-0" />
                                <span>
                                  {Array.from(
                                    new Set([attr.locality, attr.city, attr.country].filter(Boolean))
                                  ).join(', ')}
                                </span>
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-semibold ${catStyle}`}
                              >
                                {attr.category}
                              </span>
                              {attr.estimatedDuration && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-medium">
                                  {attr.estimatedDuration}
                                </span>
                              )}
                              {attr.rating !== undefined && attr.rating !== null && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold inline-flex items-center gap-0.5">
                                  <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                  {attr.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div
                            className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white border-slate-300 text-transparent'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                          {attr.description}
                        </p>

                        {attr.recommendationExplanation && (
                          <p className="text-[10px] text-blue-700/90 bg-blue-50/70 px-2 py-1 rounded-lg leading-snug">
                            {attr.recommendationExplanation}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-emerald-700 flex items-center gap-1">
                              <Ticket className="w-3 h-3" />
                              {attr.entranceFee || 'Price unavailable'}
                            </span>
                            {attr.sources && attr.sources.length > 0 && (
                              <span className="text-slate-400 capitalize">
                                • {attr.sources.join(', ')}
                              </span>
                            )}
                          </div>

                          <a
                            href={attr.osmUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline font-semibold inline-flex items-center gap-0.5"
                          >
                            Map <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>

                        {/* Interactive User Feedback Row (Feeds ML Training Dataset) */}
                        <div className="flex items-center justify-between gap-1 pt-1">
                          <span className="text-[9px] font-medium text-slate-400">
                            Feedback:
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => handleFeedbackClick(e, 'liked')}
                              title="Like this attraction"
                              className={`px-1.5 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                currentFeedback === 'liked'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700'
                              }`}
                            >
                              <ThumbsUp className="w-2.5 h-2.5" />
                              <span>Like</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleFeedbackClick(e, 'saved')}
                              title="Save & include in itinerary"
                              className={`px-1.5 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                currentFeedback === 'saved'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700'
                              }`}
                            >
                              <Bookmark className="w-2.5 h-2.5" />
                              <span>Save</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleFeedbackClick(e, 'skipped')}
                              title="Skip for this trip"
                              className={`px-1.5 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                currentFeedback === 'skipped'
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-100 hover:bg-amber-50 text-slate-600 hover:text-amber-700'
                              }`}
                            >
                              <SkipForward className="w-2.5 h-2.5" />
                              <span>Skip</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleFeedbackClick(e, 'disliked')}
                              title="Dislike attraction"
                              className={`px-1.5 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                currentFeedback === 'disliked'
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700'
                              }`}
                            >
                              <ThumbsDown className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredAttractions.length === 0 && (
                <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
                  No discovered attractions match your current search or category filter.
                </div>
              )}
            </div>
          )}

          {/* STEP 2 OUTPUT: Generated Itinerary Using ONLY Selected Attractions */}
          {!isBusy && !plannerError && viewMode === 'itinerary' && generatedDays && generatedDays.length > 0 && (
            <div className="space-y-6 animate-fade-in">
              {/* Itinerary Action Bar */}
              <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm font-heading">
                    {planResult?.destinationInfo?.displayName || destination} • {generatedDays.length}{' '}
                    {generatedDays.length === 1 ? 'Day' : 'Days'} Schedule
                  </h3>
                  {planResult?.note && (
                    <p className="text-[11px] text-slate-500 mt-0.5">{planResult.note}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {discoveryResult && (
                    <button
                      type="button"
                      onClick={() => setViewMode('select')}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Edit Selected ({selectedAttractionIds.size})</span>
                    </button>
                  )}

                  <button
                    onClick={handleGenerateFromSelected}
                    disabled={cooldownSeconds > 0}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Rebuild route for selected places"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rebuild</span>
                  </button>

                  <button
                    onClick={handlePrint}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Print or Save PDF"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print</span>
                  </button>

                  {onViewOnMap && (
                    <button
                      onClick={() =>
                        onViewOnMap(buildCurrentTripObject(), buildCurrentItineraryObject())
                      }
                      className="p-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <MapIcon className="w-3.5 h-3.5 text-teal-600" />
                      <span>Map Route</span>
                    </button>
                  )}

                  <button
                    onClick={handleSaveTrip}
                    className="py-2 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Trip</span>
                  </button>
                </div>
              </div>

              {/* Smart Budget Summary Panel */}
              {planResult?.budgetSummary && (
                <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 font-heading">
                        Trip Expenditure Breakdown (INR)
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Calculated for {travelers} traveler(s) • Real OSM entrance fees where available
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${
                        planResult.budgetSummary.remainingBudget < 0
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}
                    >
                      {planResult.budgetSummary.remainingBudget < 0
                        ? `Over Budget by ${formatINR(Math.abs(planResult.budgetSummary.remainingBudget))}`
                        : `Remaining: ${formatINR(planResult.budgetSummary.remainingBudget)}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Total Est. Spend
                      </span>
                      <div className="text-base font-extrabold text-slate-900 mt-0.5">
                        {formatINR(planResult.budgetSummary.totalEstimatedExpenditure)}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Per Person
                      </span>
                      <div className="text-base font-extrabold text-blue-700 mt-0.5">
                        {formatINR(planResult.budgetSummary.perPersonExpenditure)}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Your Budget
                      </span>
                      <div className="text-base font-extrabold text-slate-900 mt-0.5">
                        {formatINR(planResult.budgetSummary.totalBudget)}
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400">
                        Known Entry Fees
                      </span>
                      <div className="text-base font-extrabold text-teal-700 mt-0.5">
                        {formatINR(planResult.budgetSummary.categoryTotals.entranceFees)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                    <div className="px-3 py-2 rounded-xl bg-blue-50/70 border border-blue-100">
                      <span className="text-slate-500 block">Transport (est.)</span>
                      <strong className="text-slate-900">
                        {formatINR(planResult.budgetSummary.categoryTotals.transport)}
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-xl bg-teal-50/70 border border-teal-100">
                      <span className="text-slate-500 block">Stay (est.)</span>
                      <strong className="text-slate-900">
                        {formatINR(planResult.budgetSummary.categoryTotals.accommodation)}
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-xl bg-amber-50/70 border border-amber-100">
                      <span className="text-slate-500 block">Food (est.)</span>
                      <strong className="text-slate-900">
                        {formatINR(planResult.budgetSummary.categoryTotals.food)}
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-xl bg-purple-50/70 border border-purple-100">
                      <span className="text-slate-500 block">Tickets (OSM)</span>
                      <strong className="text-slate-900">
                        {formatINR(planResult.budgetSummary.categoryTotals.entranceFees)}
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70">
                      <span className="text-slate-500 block">Other (est.)</span>
                      <strong className="text-slate-900">
                        {formatINR(planResult.budgetSummary.categoryTotals.other)}
                      </strong>
                    </div>
                  </div>

                  {planResult.budgetSummary.unavailablePriceCount > 0 && (
                    <p className="text-[11px] text-slate-500">
                      Note: {planResult.budgetSummary.unavailablePriceCount} selected attraction(s) do not publish ticket prices on OpenStreetMap and are marked as{' '}
                      <strong className="text-slate-700">"Price unavailable"</strong> rather than estimated.
                    </p>
                  )}
                </div>
              )}

              {/* Day Cards List */}
              <div className="space-y-4">
                {generatedDays.map((day, dIdx) => (
                  <div
                    key={day.dayNumber}
                    className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden"
                  >
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                          D{day.dayNumber}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-bold text-sm font-heading">{day.theme}</h4>
                            {day.formattedDate && (
                              <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] text-blue-200 font-semibold">
                                {day.formattedDate}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5">{day.description}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-slate-400 block uppercase font-medium">
                          Day Est.
                        </span>
                        <span className="font-bold text-xs text-teal-400">
                          {formatINR(day.estimatedCost)}
                        </span>
                        {day.totalRouteDistanceKm !== undefined && (
                          <span className="block text-[10px] text-slate-300 mt-0.5">
                            {day.totalRouteDistanceKm} km • ~{day.totalRouteDurationMin} min
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-4 space-y-3 bg-slate-50/40">
                      {day.locations.map((spot, sIdx) => {
                        const catStyle =
                          CATEGORY_BADGE_STYLES[spot.category || ''] ||
                          'bg-slate-100 text-slate-700 border-slate-200';
                        const priceText =
                          spot.priceLabel ||
                          (spot.cost > 0 ? formatINR(spot.cost) : 'Price unavailable');

                        return (
                          <div
                            key={`${spot.osmId || spot.name}_${sIdx}`}
                            className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <div className="w-6 h-6 rounded-lg bg-blue-600 text-white font-bold text-[11px] flex items-center justify-center mt-0.5 shrink-0">
                                  {sIdx + 1}
                                </div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h5 className="font-bold text-sm text-slate-900">{spot.name}</h5>
                                    {spot.category && (
                                      <span
                                        className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${catStyle}`}
                                      >
                                        {spot.category}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-500">
                                    <span className="flex items-center gap-1 font-medium text-blue-600">
                                      <Clock className="w-3 h-3" /> {spot.visitingTime}
                                    </span>
                                    {spot.openingHours && (
                                      <span className="text-slate-600 font-medium">
                                        Hours (OSM): {spot.openingHours}
                                      </span>
                                    )}
                                    {spot.estimatedDistance && (
                                      <span className="flex items-center gap-1 text-slate-600">
                                        <Navigation className="w-3 h-3 text-teal-600" />
                                        {spot.estimatedDistance}
                                      </span>
                                    )}
                                    <span className="flex items-center gap-1 font-semibold text-emerald-700">
                                      <Ticket className="w-3 h-3" />
                                      {priceText}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {onViewOnMap && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onViewOnMap(
                                        buildCurrentTripObject(),
                                        buildCurrentItineraryObject(),
                                        spot
                                      )
                                    }
                                    className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                                    title="Explore on Map"
                                  >
                                    <MapPin className="w-3 h-3 text-teal-600" />
                                    <span className="hidden sm:inline">Explore on Map</span>
                                  </button>
                                )}

                                {spot.osmUrl && (
                                  <a
                                    href={spot.osmUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors"
                                    title="View on OpenStreetMap"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingSpot({
                                      dayIndex: dIdx,
                                      spotIndex: sIdx,
                                      spot: { ...spot },
                                    })
                                  }
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors cursor-pointer"
                                  title="Edit spot"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <p className="text-xs text-slate-600 pl-8 leading-relaxed">
                              {spot.description}
                            </p>

                            <div className="pl-8 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-slate-700">
                                <strong className="text-slate-900 block mb-0.5">
                                  Recommended Activities:
                                </strong>
                                <span>{spot.recommendedActivity}</span>
                              </div>
                              <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-100 text-amber-900">
                                <strong className="text-amber-950 flex items-center gap-1 mb-0.5">
                                  <Utensils className="w-3 h-3" /> Nearby Food (OSM):
                                </strong>
                                <span>{spot.foodSuggestion}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isBusy && !plannerError && !discoveryResult && !generatedDays && (
            <div className="bg-white p-12 rounded-3xl border border-dashed border-slate-300 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner">
                <Compass className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 font-heading">
                Discover & Select Real Tourist Attractions
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Enter any city such as <strong>Jaipur</strong>, <strong>Udaipur</strong>,{' '}
                <strong>Delhi</strong>, or <strong>Paris</strong>, then fetch real OpenStreetMap places, select the exact attractions you want to visit, and generate your itinerary.
              </p>
              <button
                type="button"
                onClick={() => handleDiscoverSubmit()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-blue-600 text-white font-semibold text-xs shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-colors cursor-pointer"
              >
                <Search className="w-4 h-4" /> Discover Places in {destination.trim() || 'Your Destination'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Spot Modal */}
      {editingSpot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-teal-500 p-5 text-white flex items-center justify-between">
              <h4 className="font-bold text-sm font-heading">Edit Itinerary Stop</h4>
              <button
                onClick={() => setEditingSpot(null)}
                className="p-1 rounded-full hover:bg-white/20 text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Place Name</label>
                <input
                  type="text"
                  value={editingSpot.spot.name}
                  onChange={(e) =>
                    setEditingSpot({
                      ...editingSpot,
                      spot: { ...editingSpot.spot, name: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Visiting Hours</label>
                  <input
                    type="text"
                    value={editingSpot.spot.visitingTime}
                    onChange={(e) =>
                      setEditingSpot({
                        ...editingSpot,
                        spot: { ...editingSpot.spot, visitingTime: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Entrance Cost (₹)</label>
                  <input
                    type="number"
                    value={editingSpot.spot.cost}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setEditingSpot({
                        ...editingSpot,
                        spot: {
                          ...editingSpot.spot,
                          cost: val,
                          priceLabel: val > 0 ? formatINR(val) : 'Price unavailable',
                        },
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  value={editingSpot.spot.description}
                  onChange={(e) =>
                    setEditingSpot({
                      ...editingSpot,
                      spot: { ...editingSpot.spot, description: e.target.value },
                    })
                  }
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Recommended Activity</label>
                <input
                  type="text"
                  value={editingSpot.spot.recommendedActivity}
                  onChange={(e) =>
                    setEditingSpot({
                      ...editingSpot,
                      spot: { ...editingSpot.spot, recommendedActivity: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Food Suggestion</label>
                <input
                  type="text"
                  value={editingSpot.spot.foodSuggestion}
                  onChange={(e) =>
                    setEditingSpot({
                      ...editingSpot,
                      spot: { ...editingSpot.spot, foodSuggestion: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSpot(null)}
                  className="px-4 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveSpotEdit}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
