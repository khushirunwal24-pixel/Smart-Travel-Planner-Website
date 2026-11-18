import React, { useState } from 'react';
import {
  Compass,
  Home,
  Calendar,
  IndianRupee,
  MapPin,
  CloudSun,
  Award,
  LogIn,
  Sparkles,
  LayoutDashboard,
  LogOut,
  User,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onOpenSynopsis: () => void;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenAuth,
  onOpenSynopsis,
  onLogout,
}) => {
  const { user, profile, isGuest, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const isLoggedIn = !!user || isGuest;

  // Navigation action handlers
  const handleGoHome = () => {
    setActiveTab('landing');
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoExplore = () => {
    if (activeTab !== 'landing') {
      setActiveTab('landing');
    }
    setMobileMenuOpen(false);
    setTimeout(() => {
      const el = document.getElementById('explore');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 500, behavior: 'smooth' });
      }
    }, 100);
  };

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSynopsisClick = () => {
    setMobileMenuOpen(false);
    onOpenSynopsis();
  };

  const handleLoginClick = () => {
    setMobileMenuOpen(false);
    onOpenAuth('login');
  };

  const handleGetStartedClick = () => {
    setMobileMenuOpen(false);
    onOpenAuth('register');
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-2xs transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 lg:gap-4">
        {/* 1. Smart Travel Planner Logo and Name on the Far Left */}
        <div
          onClick={handleGoHome}
          className="flex items-center gap-2.5 cursor-pointer shrink-0 select-none group"
          title="Smart Travel Planner Home"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-blue-700 to-teal-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform duration-200">
            <Compass className="w-5 h-5 text-white group-hover:rotate-45 transition-transform duration-300" />
          </div>
          <div className="flex flex-col justify-center leading-tight">
            <div className="flex items-center gap-1">
              <span className="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight font-heading">
                Smart Travel
              </span>
              <span className="font-extrabold text-sm sm:text-base text-blue-600 font-heading">
                Planner
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium hidden sm:block">
              Trip & Budget Platform
            </span>
          </div>
        </div>

        {/* 2 & 3. Navigation Items Horizontally in Requested Sequence:
            Home → Explore → AI Trip Planner → Budget Management → Route Map → Weather Updates → Synopsis → Login → Get Started */}
        <nav className="hidden xl:flex items-center gap-1 2xl:gap-1.5 flex-1 justify-center px-2">
          {/* Item 1: Home */}
          <button
            type="button"
            onClick={handleGoHome}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'landing'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <Home className={`w-4 h-4 shrink-0 ${activeTab === 'landing' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Home</span>
          </button>

          {/* Item 2: Explore */}
          <button
            type="button"
            onClick={handleGoExplore}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-colors cursor-pointer"
          >
            <Compass className="w-4 h-4 shrink-0 text-slate-400" />
            <span>Explore</span>
          </button>

          {/* Item 3: AI Trip Planner */}
          <button
            type="button"
            onClick={() => handleNavClick('planner')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'planner'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <Calendar className={`w-4 h-4 shrink-0 ${activeTab === 'planner' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>AI Trip Planner</span>
          </button>

          {/* Item 4: Budget Management */}
          <button
            type="button"
            onClick={() => handleNavClick('budget')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'budget'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <IndianRupee className={`w-4 h-4 shrink-0 ${activeTab === 'budget' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Budget Management</span>
          </button>

          {/* Item 5: Route Map */}
          <button
            type="button"
            onClick={() => handleNavClick('map')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'map'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <MapPin className={`w-4 h-4 shrink-0 ${activeTab === 'map' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Route Map</span>
          </button>

          {/* Item 6: Weather Updates */}
          <button
            type="button"
            onClick={() => handleNavClick('weather')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'weather'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <CloudSun className={`w-4 h-4 shrink-0 ${activeTab === 'weather' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Weather Updates</span>
          </button>

          {/* Item 7: Synopsis */}
          <button
            type="button"
            onClick={handleSynopsisClick}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200/60 transition-colors cursor-pointer"
            title="Academic Project Synopsis & Team Details"
          >
            <Award className="w-4 h-4 shrink-0 text-indigo-600" />
            <span>Synopsis</span>
          </button>
        </nav>

        {/* Items 8 & 9: Login → Get Started (or User Session when Authenticated) */}
        <div className="hidden xl:flex items-center gap-2 shrink-0">
          {!isLoggedIn ? (
            <>
              {/* Item 8: Login */}
              <button
                type="button"
                onClick={handleLoginClick}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <LogIn className="w-4 h-4 shrink-0 text-slate-500" />
                <span>Login</span>
              </button>

              {/* Item 9: Get Started */}
              <button
                type="button"
                onClick={handleGetStartedClick}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white text-xs font-semibold shadow-sm shadow-blue-500/20 transition-all cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 shrink-0 text-white" />
                <span>Get Started</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleNavClick('dashboard')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === 'dashboard'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                }`}
              >
                <LayoutDashboard className="w-4 h-4 shrink-0" />
                <span>Dashboard</span>
              </button>

              {/* User Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-1.5 p-1 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                  title={profile?.displayName || 'Traveler Account'}
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs ring-2 ring-blue-500/20 overflow-hidden">
                    {profile?.photoURL ? (
                      <img src={profile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span>{profile?.displayName?.charAt(0) || 'U'}</span>
                    )}
                  </div>
                </button>

                {userDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50 animate-fade-in">
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {profile?.displayName || 'Traveler'}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{profile?.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleNavClick('dashboard');
                        setUserDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4 text-slate-400" />
                      <span>Dashboard & Trips</span>
                    </button>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={async () => {
                        setUserDropdownOpen(false);
                        try {
                          await logout();
                          if (activeTab === 'dashboard') {
                            setActiveTab('landing');
                          }
                          onLogout?.();
                        } catch (err) {
                          console.error('Logout error:', err);
                        }
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Hamburger Menu Toggle Button */}
        <div className="flex xl:hidden items-center gap-2">
          {!isLoggedIn ? (
            <button
              type="button"
              onClick={handleLoginClick}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Login
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleNavClick('dashboard')}
              className="p-1.5 rounded-lg bg-blue-50 text-blue-600"
              title="Dashboard"
            >
              <LayoutDashboard className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-slate-900" /> : <Menu className="w-5 h-5 text-slate-900" />}
          </button>
        </div>
      </div>

      {/* Responsive Hamburger Mobile Drawer (Preserving the Exact Sequence) */}
      {mobileMenuOpen && (
        <div className="xl:hidden border-t border-slate-200 bg-white/98 backdrop-blur-md px-4 pt-3 pb-5 space-y-1 shadow-lg animate-fade-in">
          {/* Sequence Item 1: Home */}
          <button
            type="button"
            onClick={handleGoHome}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'landing'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Home className={`w-4 h-4 shrink-0 ${activeTab === 'landing' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Home</span>
          </button>

          {/* Sequence Item 2: Explore */}
          <button
            type="button"
            onClick={handleGoExplore}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Compass className="w-4 h-4 shrink-0 text-slate-400" />
            <span>Explore</span>
          </button>

          {/* Sequence Item 3: AI Trip Planner */}
          <button
            type="button"
            onClick={() => handleNavClick('planner')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'planner'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Calendar className={`w-4 h-4 shrink-0 ${activeTab === 'planner' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>AI Trip Planner</span>
          </button>

          {/* Sequence Item 4: Budget Management */}
          <button
            type="button"
            onClick={() => handleNavClick('budget')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'budget'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <IndianRupee className={`w-4 h-4 shrink-0 ${activeTab === 'budget' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Budget Management</span>
          </button>

          {/* Sequence Item 5: Route Map */}
          <button
            type="button"
            onClick={() => handleNavClick('map')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'map'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <MapPin className={`w-4 h-4 shrink-0 ${activeTab === 'map' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Route Map</span>
          </button>

          {/* Sequence Item 6: Weather Updates */}
          <button
            type="button"
            onClick={() => handleNavClick('weather')}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'weather'
                ? 'bg-blue-50 text-blue-600 font-bold'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <CloudSun className={`w-4 h-4 shrink-0 ${activeTab === 'weather' ? 'text-blue-600' : 'text-slate-400'}`} />
            <span>Weather Updates</span>
          </button>

          {/* Sequence Item 7: Synopsis */}
          <button
            type="button"
            onClick={handleSynopsisClick}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200/50 transition-colors cursor-pointer"
          >
            <Award className="w-4 h-4 shrink-0 text-indigo-600" />
            <span>Synopsis (Project Details)</span>
          </button>

          {/* Sequence Items 8 & 9: Login & Get Started */}
          <div className="pt-2 mt-2 border-t border-slate-100 space-y-2">
            {!isLoggedIn ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleLoginClick}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <LogIn className="w-4 h-4 text-slate-500" />
                  <span>Login</span>
                </button>
                <button
                  type="button"
                  onClick={handleGetStartedClick}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white text-xs font-semibold shadow-sm transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-white" />
                  <span>Get Started</span>
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => handleNavClick('dashboard')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    activeTab === 'dashboard'
                      ? 'bg-blue-600 text-white font-bold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 shrink-0" />
                  <span>User Dashboard</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    setMobileMenuOpen(false);
                    try {
                      await logout();
                      if (activeTab === 'dashboard') {
                        setActiveTab('landing');
                      }
                      onLogout?.();
                    } catch (err) {
                      console.error('Logout error:', err);
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
