import React, { useState } from 'react';
import {
  Compass,
  MapPin,
  Calendar,
  Users,
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  IndianRupee,
  CloudSun,
  Map as MapIcon,
  Star,
  CheckCircle2,
  TrendingUp,
  Plane,
} from 'lucide-react';

interface LandingProps {
  onStartPlanning: (prefill?: {
    destination?: string;
    startLocation?: string;
    startDate?: string;
    endDate?: string;
    travelers?: number;
  }) => void;
  setActiveTab: (tab: string) => void;
  onOpenSynopsis: () => void;
}

export const LandingPage: React.FC<LandingProps> = ({
  onStartPlanning,
  setActiveTab,
  onOpenSynopsis,
}) => {
  const [dest, setDest] = useState('');
  const [origin, setOrigin] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [travelers, setTravelers] = useState(2);

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onStartPlanning({
      destination: dest || 'Tokyo, Japan',
      startLocation: origin || 'New Delhi, India',
      startDate: startDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      endDate: endDate || new Date(Date.now() + 12 * 86400000).toISOString().split('T')[0],
      travelers: travelers || 2,
    });
  };

  const popularDestinations = [
    {
      name: 'Paris, France',
      tagline: 'Art, Romance & Seine River Promenade',
      image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=800&q=80',
      budget: '₹1,50,000',
      days: '5 Days',
      weather: '19°C Mild',
      rating: 4.9,
    },
    {
      name: 'Tokyo, Japan',
      tagline: 'Neon Skylines, Ancient Shrines & Gastronomy',
      image: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=800&q=80',
      budget: '₹2,00,000',
      days: '7 Days',
      weather: '22°C Clear',
      rating: 4.95,
    },
    {
      name: 'Bali, Indonesia',
      tagline: 'Lush Terraces, Sacred Temples & Coastal Sunsets',
      image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=800&q=80',
      budget: '₹95,000',
      days: '6 Days',
      weather: '29°C Tropical',
      rating: 4.88,
    },
    {
      name: 'Rome, Italy',
      tagline: 'Colosseum, Vatican Treasures & Historic Piazzas',
      image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=800&q=80',
      budget: '₹1,40,000',
      days: '5 Days',
      weather: '24°C Sunny',
      rating: 4.92,
    },
    {
      name: 'Jaipur, India',
      tagline: 'Royal Forts, Pink City Bazaars & Heritage Stays',
      image: 'https://images.unsplash.com/photo-1599661046289-e31897846e41?auto=format&fit=crop&w=800&q=80',
      budget: '₹25,000',
      days: '4 Days',
      weather: '30°C Warm',
      rating: 4.85,
    },
    {
      name: 'Zurich, Switzerland',
      tagline: 'Alpine Peaks, Pristine Lakes & Chocolate Houses',
      image: 'https://images.unsplash.com/photo-1515488764276-beab7607c1e6?auto=format&fit=crop&w=800&q=80',
      budget: '₹2,25,000',
      days: '5 Days',
      weather: '16°C Fresh',
      rating: 4.94,
    },
  ];

  const features = [
    {
      icon: Sparkles,
      title: 'AI-Powered Smart Planner',
      desc: 'Generates hour-by-hour schedules with curated local landmarks, travel distance estimates, and authentic food spots.',
      color: 'bg-blue-50 text-blue-600 border-blue-100',
    },
    {
      icon: IndianRupee,
      title: 'Dynamic Budget & Expense Tracker',
      desc: 'Real-time category breakdown (Transport, Stay, Food, Activities) in INR with budget progress bars and overspending warnings.',
      color: 'bg-teal-50 text-teal-600 border-teal-100',
    },
    {
      icon: MapIcon,
      title: 'Interactive Route Map',
      desc: 'Leaflet & OpenStreetMap pinpointing every itinerary stop with custom markers, connecting route paths, and navigation details.',
      color: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    },
    {
      icon: CloudSun,
      title: 'Live Destination Weather',
      desc: 'Real-time temperature, wind, humidity, and 5-day forecasts so you never get caught unprepared in rain or cold.',
      color: 'bg-amber-50 text-amber-600 border-amber-100',
    },
    {
      icon: ShieldCheck,
      title: 'Secure Firebase Cloud Sync',
      desc: 'Every trip, itinerary, and expense is securely persisted with Firebase Authentication and strict attribute-based Firestore rules.',
      color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    },
    {
      icon: TrendingUp,
      title: 'Traveler Analytics Dashboard',
      desc: 'High-level insights across past and upcoming adventures with one-click itinerary export and printable travel summaries.',
      color: 'bg-purple-50 text-purple-600 border-purple-100',
    },
  ];

  const testimonials = [
    {
      name: 'Sophia Martinez',
      role: 'Solo Explorer & Photographer',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80',
      comment:
        'The day-wise itinerary for Tokyo was spot-on. It grouped nearby attractions so I didn’t waste hours commuting on trains, and the expense tracker saved me from blowing my budget!',
      rating: 5,
    },
    {
      name: 'David Chen',
      role: 'Family Vacationer',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80',
      comment:
        'Planning our 5-day trip to Paris with kids used to be overwhelming. Smart Travel Planner generated meal suggestions, ticket cost estimates, and map routes in 10 seconds.',
      rating: 5,
    },
    {
      name: 'Elena Rostova',
      role: 'Digital Nomad & Trekker',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
      comment:
        'The real-time weather integration helped us pack properly for changing alpine conditions, and having all expenses synchronized to Firebase meant zero spreadsheet headaches.',
      rating: 5,
    },
  ];

  return (
    <div className="space-y-20 pb-16">
      {/* Hero Section */}
      <section className="relative min-h-[580px] lg:min-h-[640px] flex items-center justify-center overflow-hidden bg-slate-900">
        {/* Background photo with overlay gradient */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 scale-105 transform transition-transform duration-1000"
          style={{
            backgroundImage:
              'url("https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2000&q=85")',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/70 to-slate-900/40" />

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center z-10">
          {/* Top highlight pill */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs font-semibold backdrop-blur-md mb-6 animate-fade-in">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Intelligent Travel Engine & Budget Management Platform</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight font-heading leading-tight max-w-4xl mx-auto">
            Your Journey, <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-teal-300 to-indigo-300">Perfectbly Planned.</span>
          </h1>

          <p className="mt-4 text-sm sm:text-base lg:text-lg text-slate-300 max-w-2xl mx-auto font-normal leading-relaxed">
            Eliminate hours of manual research across scattered blogs. Generate tailored itineraries, track travel budgets in real time, explore interactive route maps, and monitor live weather from one intuitive workspace.
          </p>

          {/* Search Trip Box */}
          <form
            onSubmit={handleHeroSearch}
            className="mt-8 max-w-4xl mx-auto bg-white/95 backdrop-blur-xl p-3 sm:p-4 rounded-3xl shadow-2xl border border-white/20 text-slate-800 text-left"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Destination */}
              <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-blue-400 transition-colors">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-blue-600" /> Where to?
                </label>
                <input
                  type="text"
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder="e.g. Tokyo, Paris, Bali"
                  className="w-full bg-transparent font-medium text-xs sm:text-sm text-slate-900 focus:outline-none placeholder:text-slate-400"
                />
              </div>

              {/* Starting City */}
              <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-blue-400 transition-colors">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                  <Plane className="w-3 h-3 text-teal-600" /> Departing from
                </label>
                <input
                  type="text"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="e.g. London, New York"
                  className="w-full bg-transparent font-medium text-xs sm:text-sm text-slate-900 focus:outline-none placeholder:text-slate-400"
                />
              </div>

              {/* Travel Dates */}
              <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-blue-400 transition-colors">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-indigo-600" /> Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-transparent font-medium text-xs sm:text-sm text-slate-900 focus:outline-none"
                />
              </div>

              {/* Travelers & Action */}
              <div className="flex items-center gap-2">
                <div className="flex-1 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-blue-400 transition-colors">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                    <Users className="w-3 h-3 text-purple-600" /> Travelers
                  </label>
                  <select
                    value={travelers}
                    onChange={(e) => setTravelers(Number(e.target.value))}
                    className="w-full bg-transparent font-medium text-xs sm:text-sm text-slate-900 focus:outline-none cursor-pointer"
                  >
                    <option value={1}>1 Solo</option>
                    <option value={2}>2 Couple</option>
                    <option value={3}>3 Friends</option>
                    <option value={4}>4 Family</option>
                    <option value={6}>6+ Group</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="h-full min-h-[52px] px-5 rounded-2xl bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white font-semibold text-xs sm:text-sm shadow-md shadow-blue-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                  <Search className="w-4 h-4" />
                  <span className="hidden sm:inline">Plan Trip</span>
                </button>
              </div>
            </div>
          </form>

          {/* Quick suggestions */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-300">
            <span className="text-slate-400">Popular right now:</span>
            {['Paris', 'Tokyo', 'Bali', 'Rome', 'Jaipur'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setDest(item);
                  onStartPlanning({ destination: item, travelers: 2 });
                }}
                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition-colors cursor-pointer"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Explore Popular Destinations Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10">
          <div>
            <span className="text-xs font-bold text-blue-600 uppercase tracking-widest font-heading">
              World Highlights
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading mt-1">
              Explore Popular Destinations
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-xl">
              Curated travel favorites with pre-calculated budgets, weather snapshots, and day-wise smart itineraries ready to customize.
            </p>
          </div>
          <button
            onClick={() => onStartPlanning()}
            className="mt-4 md:mt-0 inline-flex items-center gap-2 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
          >
            Custom Destination Planner <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {popularDestinations.map((dest) => (
            <div
              key={dest.name}
              className="group bg-white rounded-3xl overflow-hidden border border-slate-200/80 shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col"
            >
              <div className="relative h-52 overflow-hidden">
                <img
                  src={dest.image}
                  alt={dest.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />

                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/90 backdrop-blur-md text-[11px] font-bold text-slate-800 flex items-center gap-1">
                  <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                  <span>{dest.rating}</span>
                </div>

                <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-[11px] font-semibold text-white flex items-center gap-1">
                  <CloudSun className="w-3 h-3 text-teal-300" />
                  <span>{dest.weather}</span>
                </div>

                <div className="absolute bottom-3 left-3 right-3 text-white">
                  <h3 className="text-lg font-bold font-heading">{dest.name}</h3>
                  <p className="text-xs text-slate-200 line-clamp-1">{dest.tagline}</p>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span className="font-semibold text-slate-900">{dest.days}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Est. Budget:</span>
                    <span className="font-bold text-slate-900">{dest.budget}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                  <button
                    onClick={() =>
                      onStartPlanning({
                        destination: dest.name,
                        travelers: 2,
                      })
                    }
                    className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm shadow-blue-500/20 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Plan Itinerary
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('weather');
                    }}
                    className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors flex items-center justify-center cursor-pointer"
                    title="View Weather"
                  >
                    <CloudSun className="w-3.5 h-3.5 text-slate-600" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works Section */}
      <section className="bg-gradient-to-b from-blue-50/60 to-slate-50 py-16 border-y border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-widest font-heading">
              Effortless Workflow
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading mt-1">
              How Smart Travel Planner Works
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2">
              From daydreaming to departure, our four-step intelligent system organizes your entire trip seamlessly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
            {[
              {
                step: '01',
                title: 'Set Preferences',
                desc: 'Input departure point, destination, travel dates, budget, travel style, and accommodation preference.',
                icon: MapPin,
              },
              {
                step: '02',
                title: 'AI Smart Itinerary',
                desc: 'Our engine generates a day-by-day plan with morning, afternoon, and evening spots, costs, and local cuisine.',
                icon: Sparkles,
              },
              {
                step: '03',
                title: 'Budget & Expenses',
                desc: 'Categorize spending, monitor remaining funds, and receive warning alerts before exceeding your budget.',
                icon: IndianRupee,
              },
              {
                step: '04',
                title: 'Navigate & Explore',
                desc: 'View your route on an interactive Leaflet map, track real-time weather forecasts, and travel worry-free.',
                icon: Compass,
              },
            ].map((item, idx) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow relative"
                >
                  <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm mb-4 shadow-sm shadow-blue-500/20">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-blue-600 font-mono">Step {item.step}</span>
                  <h3 className="text-base font-bold text-slate-900 font-heading mt-1 mb-2">{item.title}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Features Grid Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-bold text-teal-600 uppercase tracking-widest font-heading">
            Enterprise Grade Features
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading mt-1">
            Engineered for Modern Travelers
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-2">
            Packed with essential tools to ensure you spend less time planning and more time creating memories.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all group"
              >
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center border mb-4 ${feat.color}`}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900 font-heading mb-2 group-hover:text-blue-600 transition-colors">
                  {feat.title}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">{feat.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="bg-slate-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest font-heading">
              Loved by Explorers
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold font-heading mt-1 text-white">
              What Travelers Say About Us
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-2">
              Real stories from globetrotters who planned their dream trips with Smart Travel Planner.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="p-6 rounded-3xl bg-slate-800/80 border border-slate-700/80 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center gap-1 text-amber-400">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-xs text-slate-300 italic leading-relaxed">"{t.comment}"</p>
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-slate-700/60">
                  <img
                    src={t.avatar}
                    alt={t.name}
                    className="w-10 h-10 rounded-full object-cover ring-2 ring-blue-500/30"
                  />
                  <div>
                    <h4 className="text-xs font-bold text-white">{t.name}</h4>
                    <p className="text-[11px] text-slate-400">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Academic Project Synopsis Callout */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-500 text-white shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center sm:text-left">
            <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-md">
              Academic Mini Project Synopsis
            </span>
            <h3 className="text-xl sm:text-2xl font-bold font-heading">
              Smart Travel Planner Architecture
            </h3>
            <p className="text-xs text-blue-100 max-w-lg">
              Designed & Developed by <span className="font-semibold text-white">Garima Runwal</span> (Roll No: 24036142) under the guidance of Mentor <span className="font-semibold text-white">Mrs. Akanksha Gupta</span>.
            </p>
          </div>
          <button
            onClick={onOpenSynopsis}
            className="px-6 py-3 rounded-2xl bg-white text-blue-900 font-bold text-xs hover:bg-blue-50 shadow-lg transition-colors shrink-0 cursor-pointer"
          >
            Read Project Synopsis
          </button>
        </div>
      </section>
    </div>
  );
};
