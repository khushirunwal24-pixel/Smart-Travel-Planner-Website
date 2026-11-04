import React, { useState } from 'react';
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
  Trash2,
  Edit3,
  Map as MapIcon,
  CheckCircle,
  Plus,
  AlertCircle,
  X,
  Share2,
} from 'lucide-react';
import { Trip, DayItinerary, TripLocationItem, Itinerary } from '../types';
import { generateSmartItinerary } from '../services/aiPlannerService';
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
  onViewOnMap?: (trip: Trip, itinerary: Itinerary) => void;
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

export const TripPlanner: React.FC<TripPlannerProps> = ({
  prefill,
  onTripCreated,
  onViewOnMap,
  onShowToast,
}) => {
  const { user, isGuest } = useAuth();
  const userId = user?.uid || 'guest_traveler_101';

  // Form State
  const [destination, setDestination] = useState(prefill?.destination || 'Tokyo, Japan');
  const [startLocation, setStartLocation] = useState(prefill?.startLocation || 'New Delhi, India');
  const [startDate, setStartDate] = useState(
    prefill?.startDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(
    prefill?.endDate || new Date(Date.now() + 19 * 86400000).toISOString().split('T')[0]
  );
  const [travelers, setTravelers] = useState(prefill?.travelers || 2);
  const [budget, setBudget] = useState(75000);
  const [selectedPreferences, setSelectedPreferences] = useState<string[]>([
    'Historical',
    'Food & Gastronomy',
    'Culture',
  ]);
  const [travelMode, setTravelMode] = useState<'flight' | 'train' | 'bus' | 'car'>('flight');
  const [accommodation, setAccommodation] = useState('Boutique Hotel');

  // Generated Itinerary State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDays, setGeneratedDays] = useState<DayItinerary[] | null>(null);
  const [generationMeta, setGenerationMeta] = useState<{ source?: string; note?: string } | null>(null);

  // Edit Spot Modal State
  const [editingSpot, setEditingSpot] = useState<{
    dayIndex: number;
    spotIndex: number;
    spot: TripLocationItem;
  } | null>(null);

  // Toggle preference chip
  const togglePreference = (pref: string) => {
    setSelectedPreferences((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref]
    );
  };

  // Generate Itinerary
  const handleGenerateItinerary = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!destination.trim()) {
      onShowToast('error', 'Validation Error', 'Please enter a target destination.');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateSmartItinerary({
        destination: destination.trim(),
        startLocation: startLocation.trim(),
        startDate,
        endDate,
        travelers,
        budget,
        travelPreferences: selectedPreferences.join(', '),
        travelMode,
        accommodation,
      });

      setGeneratedDays(result.days);
      setGenerationMeta({ source: result.source, note: result.note });
      onShowToast(
        'success',
        'Itinerary Ready!',
        `Generated personalized ${result.days.length}-day schedule for ${destination}.`
      );
    } catch (err: any) {
      onShowToast('error', 'Generation Error', 'Failed to generate itinerary. Try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Save Trip & Itinerary to Firestore
  const handleSaveTrip = async () => {
    if (!generatedDays || generatedDays.length === 0) return;

    try {
      const trip = await createTrip(
        {
          userId,
          title: `${destination} Exploration`,
          startLocation: startLocation.trim(),
          destination: destination.trim(),
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

      const itinerary = await saveItinerary(trip.id, userId, destination.trim(), generatedDays, isGuest);

      onShowToast('success', 'Saved Successfully', 'Trip and day-wise schedule saved to your profile.');
      onTripCreated?.(trip, itinerary);
    } catch (err: any) {
      onShowToast('error', 'Save Error', 'Could not save trip to Firestore.');
    }
  };

  // Print / Export Itinerary
  const handlePrint = () => {
    window.print();
  };

  // Update a single spot
  const handleSaveSpotEdit = () => {
    if (!editingSpot || !generatedDays) return;
    const { dayIndex, spotIndex, spot } = editingSpot;

    const updatedDays = [...generatedDays];
    updatedDays[dayIndex].locations[spotIndex] = spot;
    setGeneratedDays(updatedDays);
    setEditingSpot(null);
    onShowToast('info', 'Updated', 'Itinerary stop updated.');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 mb-1">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span>AI-Driven Personalized Itinerary Architect</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading">
            AI Trip Planner
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Specify your parameters and let our intelligent engine structure balanced day-wise adventures.
          </p>
        </div>

        {generationMeta && (
          <div className="px-3.5 py-1.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-800 text-xs flex items-center gap-2 font-medium">
            <CheckCircle className="w-4 h-4 text-teal-600" />
            <span>{generationMeta.note || 'AI Engine active'}</span>
          </div>
        )}
      </div>

      {/* Main Grid: Input Parameters Form (Left) & Live Itinerary Preview (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form (5 columns) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-5">
          <div className="pb-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 font-heading">Trip Parameters</h3>
            <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">
              Step 1 of 2
            </span>
          </div>

          <form onSubmit={handleGenerateItinerary} className="space-y-4">
            {/* Destination & Starting City */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-600" /> Target Destination
                </label>
                <input
                  type="text"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Tokyo, Paris, Bali, Rome, Jaipur"
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-slate-400" /> Starting City / Point of Departure
                </label>
                <input
                  type="text"
                  value={startLocation}
                  onChange={(e) => setStartLocation(e.target.value)}
                  placeholder="e.g. San Francisco, London, Mumbai"
                  required
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
                  min="5000"
                  step="1000"
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

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isGenerating}
              className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-blue-600 via-blue-700 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Generating AI Itinerary...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Day-Wise Travel Itinerary</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Output: Itinerary Schedule (7 columns) */}
        <div className="lg:col-span-7 space-y-6">
          {generatedDays ? (
            <div className="space-y-6 animate-fade-in">
              {/* Itinerary Action Bar */}
              <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-sm font-heading">
                    {destination} • {generatedDays.length} Days Schedule
                  </h3>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleGenerateItinerary}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Regenerate Itinerary"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Regenerate</span>
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
                        onViewOnMap(
                          {
                            id: 'temp_trip',
                            userId,
                            title: `${destination} Trip`,
                            startLocation,
                            destination,
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
                          },
                          {
                            id: 'temp_itinerary',
                            tripId: 'temp_trip',
                            userId,
                            destination,
                            totalDays: generatedDays.length,
                            days: generatedDays,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                          }
                        )
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

              {/* Day Cards List */}
              <div className="space-y-4">
                {generatedDays.map((day, dIdx) => (
                  <div
                    key={day.dayNumber}
                    className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden"
                  >
                    {/* Day Header Banner */}
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                          D{day.dayNumber}
                        </span>
                        <div>
                          <h4 className="font-bold text-sm font-heading">{day.theme}</h4>
                          <p className="text-[11px] text-slate-300 mt-0.5">{day.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block uppercase font-medium">
                          Day Est.
                        </span>
                        <span className="font-bold text-xs text-teal-400">{formatINR(day.estimatedCost)}</span>
                      </div>
                    </div>

                    {/* Locations / Stops */}
                    <div className="p-4 space-y-3 divide-y divide-slate-100">
                      {day.locations.map((spot, sIdx) => (
                        <div key={sIdx} className="pt-3 first:pt-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5">
                              <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-700 font-bold text-[11px] flex items-center justify-center mt-0.5 shrink-0">
                                {sIdx + 1}
                              </div>
                              <div>
                                <h5 className="font-bold text-xs text-slate-900">{spot.name}</h5>
                                <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-500">
                                  <span className="flex items-center gap-1 font-medium text-blue-600">
                                    <Clock className="w-3 h-3" /> {spot.visitingTime}
                                  </span>
                                  {spot.estimatedDistance && (
                                    <span className="text-slate-400">• {spot.estimatedDistance}</span>
                                  )}
                                  <span className="font-semibold text-emerald-600">
                                    Cost: {formatINR(spot.cost)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() =>
                                setEditingSpot({
                                  dayIndex: dIdx,
                                  spotIndex: sIdx,
                                  spot: { ...spot },
                                })
                              }
                              className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors"
                              title="Edit spot"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <p className="text-xs text-slate-600 mt-2 pl-8 leading-relaxed">
                            {spot.description}
                          </p>

                          {/* Recommended Activity & Food */}
                          <div className="mt-2.5 pl-8 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 text-slate-700">
                              <strong className="text-slate-900 block mb-0.5">Recommended Activity:</strong>
                              <span>{spot.recommendedActivity}</span>
                            </div>
                            <div className="p-2 rounded-xl bg-amber-50/60 border border-amber-100 text-amber-900">
                              <strong className="text-amber-950 block mb-0.5">🍽️ Food Suggestion:</strong>
                              <span>{spot.foodSuggestion}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="bg-white p-12 rounded-3xl border border-dashed border-slate-300 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-inner">
                <Compass className="w-8 h-8 animate-spin-slow" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 font-heading">
                Ready to Craft Your Custom Itinerary
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Fill in your starting point, destination, dates, and budget on the left, then click{' '}
                <strong className="text-slate-700">Generate Day-Wise Travel Itinerary</strong>.
              </p>
              <button
                type="button"
                onClick={() => handleGenerateItinerary()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-blue-600 text-white font-semibold text-xs shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" /> Load Sample Itinerary for {destination}
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
                  <label className="block font-semibold text-slate-700 mb-1">Estimated Cost (₹)</label>
                  <input
                    type="number"
                    value={editingSpot.spot.cost}
                    onChange={(e) =>
                      setEditingSpot({
                        ...editingSpot,
                        spot: { ...editingSpot.spot, cost: Number(e.target.value) },
                      })
                    }
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
