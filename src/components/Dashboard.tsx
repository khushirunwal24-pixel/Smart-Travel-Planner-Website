import React, { useState, useEffect } from 'react';
import {
  Compass,
  Calendar,
  IndianRupee,
  CloudSun,
  Plus,
  ArrowRight,
  MapPin,
  TrendingUp,
  Clock,
  Sparkles,
  Trash2,
  ExternalLink,
  Users,
  Award,
} from 'lucide-react';
import { Trip, Expense, WeatherData } from '../types';
import { getTrips, deleteTrip, getAllExpensesForUser } from '../services/tripService';
import { fetchLiveWeather } from '../services/weatherService';
import { useAuth } from '../context/AuthContext';
import { formatINR } from '../utils/currency';

interface DashboardProps {
  onNavigate: (tab: string, trip?: Trip) => void;
  onShowToast: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
  onOpenSynopsis: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onNavigate,
  onShowToast,
  onOpenSynopsis,
}) => {
  const { user, profile, isGuest } = useAuth();
  const userId = user?.uid || 'guest_traveler_101';

  const [trips, setTrips] = useState<Trip[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      try {
        const [userTrips, userExpenses] = await Promise.all([
          getTrips(userId, isGuest),
          getAllExpensesForUser(userId, isGuest),
        ]);
        setTrips(userTrips);
        setExpenses(userExpenses);

        // Fetch live weather for the first trip destination or Paris
        const mainDest = userTrips.length > 0 ? userTrips[0].destination : 'Paris, France';
        const wData = await fetchLiveWeather(mainDest);
        setWeather(wData);
      } catch (err) {
        console.warn('Dashboard data sync notice:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboardData();
  }, [userId, isGuest]);

  const handleDelete = async (tripId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to remove this trip?')) return;
    try {
      await deleteTrip(tripId, isGuest);
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
      onShowToast('info', 'Trip Removed', 'Trip deleted from your collection.');
    } catch {
      onShowToast('error', 'Error', 'Failed to delete trip.');
    }
  };

  // Calculations
  const totalTripsPlanned = trips.length;
  const totalTravelBudget = trips.reduce((sum, t) => sum + (t.budget || 0), 0);
  const totalActualSpending = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const upcomingTrips = trips.filter((t) => t.status === 'planning' || t.status === 'active');

  const currentDateFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-500 rounded-3xl p-6 sm:p-8 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-md">
                Traveler Workspace
              </span>
              <span className="text-xs text-blue-100 font-medium">{currentDateFormatted}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold font-heading">
              Welcome back, {profile?.displayName || 'Traveler'}! ✈️
            </h1>
            <p className="text-xs sm:text-sm text-blue-100 mt-1 max-w-xl">
              You have <span className="font-bold text-white">{upcomingTrips.length} upcoming trip(s)</span> lined up. Monitor your itinerary schedules, budget burn, and destination weather updates below.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => onNavigate('planner')}
              className="py-2.5 px-4 rounded-2xl bg-white text-blue-900 font-bold text-xs shadow-md hover:bg-blue-50 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-blue-600" /> Plan New Trip
            </button>
            <button
              onClick={() => onNavigate('budget')}
              className="py-2.5 px-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs backdrop-blur-md transition-colors flex items-center gap-2 cursor-pointer"
            >
              <IndianRupee className="w-4 h-4 text-teal-300" /> Manage Budget
            </button>
          </div>
        </div>
      </div>

      {/* Top 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Trips */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Trips Planned
            </span>
            <div className="text-2xl font-extrabold text-slate-900 font-heading mt-1">
              {totalTripsPlanned}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{upcomingTrips.length} active or scheduled</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Compass className="w-6 h-6" />
          </div>
        </div>

        {/* Total Travel Budget */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Planned Budget
            </span>
            <div className="text-2xl font-extrabold text-slate-900 font-heading mt-1">
              {formatINR(totalTravelBudget)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Across all created trips</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <IndianRupee className="w-6 h-6" />
          </div>
        </div>

        {/* Total Actual Expenses */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Spending
            </span>
            <div className="text-2xl font-extrabold text-slate-900 font-heading mt-1">
              {formatINR(totalActualSpending)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{expenses.length} logged expenses</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        {/* Weather Snapshot */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Live Weather Snapshot
            </span>
            <div className="text-2xl font-extrabold text-slate-900 font-heading mt-1">
              {weather ? `${weather.temp}°C` : '19°C'}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate max-w-[130px]">
              {weather?.city || 'Paris, France'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <CloudSun className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Content Grid: Upcoming Trips (Left 8 cols) & Weather + Recent Expenses (Right 4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Trips List (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-900 font-heading">My Travel Itineraries</h3>
              <p className="text-xs text-slate-500">Your created trips and day schedules</p>
            </div>
            <button
              onClick={() => onNavigate('planner')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
            >
              Create New <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-4">
            {trips.map((trip) => (
              <div
                key={trip.id}
                onClick={() => onNavigate('map', trip)}
                className="group bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          trip.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {trip.status}
                      </span>
                      <span className="text-xs text-slate-400">
                        {trip.travelMode.toUpperCase()} • {trip.travelers} traveler(s)
                      </span>
                    </div>

                    <h4 className="text-base font-bold text-slate-900 font-heading group-hover:text-blue-600 transition-colors">
                      {trip.title}
                    </h4>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-blue-600" />
                        {trip.destination}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                        {trip.startDate} to {trip.endDate}
                      </span>
                      <span className="font-semibold text-slate-900">
                        Budget: {formatINR(trip.budget)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate('map', trip);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 text-xs font-semibold transition-colors"
                    >
                      View Route
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate('budget', trip);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-teal-50 hover:text-teal-600 text-slate-700 text-xs font-semibold transition-colors"
                    >
                      Budget
                    </button>
                    <button
                      onClick={(e) => handleDelete(trip.id, e)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete trip"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {trips.length === 0 && (
              <div className="bg-white p-10 rounded-3xl border border-dashed border-slate-300 text-center">
                <Compass className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-800">No trips planned yet</h4>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  Ready to map out your next adventure?
                </p>
                <button
                  onClick={() => onNavigate('planner')}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm"
                >
                  Create Your First Trip
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar: Live Weather + Recent Expenses (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Weather Glance */}
          {weather && (
            <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 font-heading">Destination Weather</h4>
                  <p className="text-[11px] text-slate-400">{weather.city}</p>
                </div>
                <button
                  onClick={() => onNavigate('weather')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                >
                  Forecast ↗
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-teal-50/50 border border-blue-100 flex items-center justify-between">
                <div>
                  <div className="text-3xl font-extrabold text-slate-900 font-heading">
                    {weather.temp}°C
                  </div>
                  <p className="text-xs text-blue-700 font-medium mt-0.5">{weather.condition}</p>
                  <p className="text-[11px] text-slate-400">Wind: {weather.windSpeed} km/h • Humidity: {weather.humidity}%</p>
                </div>
                <CloudSun className="w-10 h-10 text-blue-500" />
              </div>
            </div>
          )}

          {/* Recent Expenses Glance */}
          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900 font-heading">Recent Expenses</h4>
                <p className="text-[11px] text-slate-400">Latest transactions</p>
              </div>
              <button
                onClick={() => onNavigate('budget')}
                className="text-xs text-teal-600 hover:text-teal-700 font-semibold"
              >
                All ↗
              </button>
            </div>

            <div className="space-y-2.5">
              {expenses.slice(0, 4).map((exp) => (
                <div
                  key={exp.id}
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs"
                >
                  <div>
                    <h5 className="font-semibold text-slate-900 truncate max-w-[150px]">
                      {exp.title}
                    </h5>
                    <p className="text-[10px] text-slate-400">{exp.category} • {exp.date}</p>
                  </div>
                  <span className="font-bold text-slate-900">{formatINR(exp.amount)}</span>
                </div>
              ))}

              {expenses.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">No recent expenses logged.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
