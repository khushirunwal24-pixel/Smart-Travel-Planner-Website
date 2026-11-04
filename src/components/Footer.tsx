import React, { useState } from 'react';
import { Compass, Heart, Github, Send, Check, Award, Shield, MapPin, Zap } from 'lucide-react';

interface FooterProps {
  onOpenSynopsis: () => void;
  setActiveTab: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenSynopsis, setActiveTab }) => {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubscribed(true);
      setTimeout(() => setSubscribed(false), 4000);
      setEmail('');
    }
  };

  return (
    <footer className="bg-slate-900 text-slate-300 pt-16 pb-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 mb-12">
          {/* Col 1 & 2: Brand & Mission */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Compass className="w-5 h-5" />
              </div>
              <span className="font-bold text-xl text-white font-heading tracking-tight">
                Smart Travel <span className="text-blue-400">Planner</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              An intelligent, full-stack travel planning platform designed to streamline itineraries, optimize travel
              routes, manage expenses, and provide live weather forecasts from one unified workspace.
            </p>

            {/* Academic Project Credits Badge */}
            <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700/80 max-w-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-teal-400 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5" /> Mini Project Synopsis
                </span>
                <button
                  onClick={onOpenSynopsis}
                  className="text-[11px] text-blue-400 hover:text-blue-300 underline font-medium cursor-pointer"
                >
                  View Details
                </button>
              </div>
              <p className="text-xs text-slate-200 font-medium">
                Developer: <span className="text-white font-semibold">Garima Runwal</span> (Roll No: 24036142)
              </p>
              <p className="text-[11px] text-slate-400">
                Project Mentor: <span className="text-slate-300">Mrs. Akanksha Gupta</span>
              </p>
            </div>
          </div>

          {/* Col 3: Navigation */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 font-heading">
              Platform Features
            </h4>
            <ul className="space-y-2.5 text-xs text-slate-400">
              <li>
                <button
                  onClick={() => setActiveTab('planner')}
                  className="hover:text-blue-400 transition-colors cursor-pointer"
                >
                  AI Itinerary Planner
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('budget')}
                  className="hover:text-blue-400 transition-colors cursor-pointer"
                >
                  Budget & Expense Manager
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('map')}
                  className="hover:text-blue-400 transition-colors cursor-pointer"
                >
                  Interactive Route Map
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('weather')}
                  className="hover:text-blue-400 transition-colors cursor-pointer"
                >
                  Real-Time Weather Updates
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="hover:text-blue-400 transition-colors cursor-pointer"
                >
                  Traveler Dashboard
                </button>
              </li>
            </ul>
          </div>

          {/* Col 4: Tech Stack Architecture */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 font-heading">
              Architecture & Tech
            </h4>
            <ul className="space-y-2 text-xs text-slate-400">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Firebase Auth & Firestore
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                Leaflet + OpenStreetMap
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                Open-Meteo Live API
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                Google Gemini Intelligence
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                Tailwind CSS & Lucide Icons
              </li>
            </ul>
          </div>

          {/* Col 5: Newsletter */}
          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4 font-heading">
              Travel Intelligence
            </h4>
            <p className="text-xs text-slate-400 mb-3">
              Get destination guides, budget hacks, and itinerary templates delivered to your inbox.
            </p>
            <form onSubmit={handleSubscribe} className="space-y-2">
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="traveler@example.com"
                  required
                  className="w-full pl-3 pr-9 py-2 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 text-xs focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                  aria-label="Subscribe"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              {subscribed && (
                <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Subscribed successfully!
                </p>
              )}
            </form>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© 2026 Smart Travel Planner. Built with high performance & modern travel-tech UI/UX.</p>
          <div className="flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Shield className="w-3.5 h-3.5 text-emerald-400" /> Secure Firebase Cloud
            </span>
            <button
              onClick={onOpenSynopsis}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Academic Synopsis
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};
