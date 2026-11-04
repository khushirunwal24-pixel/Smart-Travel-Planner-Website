import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { LandingPage } from './components/LandingPage';
import { Dashboard } from './components/Dashboard';
import { TripPlanner } from './components/TripPlanner';
import { BudgetManager } from './components/BudgetManager';
import { RouteMap } from './components/RouteMap';
import { WeatherWidget } from './components/WeatherWidget';
import { AuthModal } from './components/AuthModal';
import { ProjectSynopsisModal } from './components/ProjectSynopsisModal';
import { ToastContainer } from './components/Toast';
import { Trip, Itinerary, ToastMessage } from './types';
import { getTrips, getItinerary } from './services/tripService';

function AppContent() {
  const { user, isGuest } = useAuth();
  const userId = user?.uid || 'guest_traveler_101';

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<string>('landing');

  // Active trip & itinerary for Map and Budget
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [activeItinerary, setActiveItinerary] = useState<Itinerary | null>(null);

  // Planner prefill from search or popular cards
  const [plannerPrefill, setPlannerPrefill] = useState<{
    destination?: string;
    startLocation?: string;
    startDate?: string;
    endDate?: string;
    travelers?: number;
  }>({
    destination: 'Tokyo, Japan',
    startLocation: 'London, UK',
    travelers: 2,
  });

  // Modals state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [synopsisModalOpen, setSynopsisModalOpen] = useState(false);

  // Toast notifications state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Load initial active trip
  useEffect(() => {
    async function loadDefaultTrip() {
      try {
        const trips = await getTrips(userId, isGuest);
        if (trips.length > 0 && !activeTrip) {
          setActiveTrip(trips[0]);
          const it = await getItinerary(trips[0].id, userId, isGuest);
          if (it) setActiveItinerary(it);
        }
      } catch (err) {
        console.warn('Initial trip load handled:', err);
      }
    }
    loadDefaultTrip();
  }, [userId, isGuest]);

  // When active trip changes, load its itinerary
  useEffect(() => {
    if (!activeTrip) return;
    async function loadIt() {
      try {
        const it = await getItinerary(activeTrip!.id, userId, isGuest);
        setActiveItinerary(it);
      } catch (err) {
        console.warn('Itinerary load handled:', err);
      }
    }
    loadIt();
  }, [activeTrip, userId, isGuest]);

  const handleStartPlanning = (prefillData?: {
    destination?: string;
    startLocation?: string;
    startDate?: string;
    endDate?: string;
    travelers?: number;
  }) => {
    if (prefillData) {
      setPlannerPrefill(prefillData);
    }
    setActiveTab('planner');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTripCreated = (newTrip: Trip, newItinerary: Itinerary) => {
    setActiveTrip(newTrip);
    setActiveItinerary(newItinerary);
    showToast('success', 'Trip Plan Created', `${newTrip.title} has been initialized.`);
  };

  const handleViewOnMap = (trip: Trip, itinerary: Itinerary) => {
    setActiveTrip(trip);
    setActiveItinerary(itinerary);
    setActiveTab('map');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDashboardNavigate = (tab: string, trip?: Trip) => {
    if (trip) {
      setActiveTrip(trip);
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuth={(mode = 'login') => {
          setAuthMode(mode);
          setAuthModalOpen(true);
        }}
        onOpenSynopsis={() => setSynopsisModalOpen(true)}
        onLogout={() => showToast('info', 'Signed Out', 'You have been signed out successfully.')}
      />

      {/* Main Page Routing */}
      <main className="flex-1">
        {activeTab === 'landing' && (
          <LandingPage
            onStartPlanning={handleStartPlanning}
            setActiveTab={setActiveTab}
            onOpenSynopsis={() => setSynopsisModalOpen(true)}
          />
        )}

        {activeTab === 'dashboard' && (
          <Dashboard
            onNavigate={handleDashboardNavigate}
            onShowToast={showToast}
            onOpenSynopsis={() => setSynopsisModalOpen(true)}
          />
        )}

        {activeTab === 'planner' && (
          <TripPlanner
            prefill={plannerPrefill}
            onTripCreated={handleTripCreated}
            onViewOnMap={handleViewOnMap}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'budget' && (
          <BudgetManager
            currentTrip={activeTrip}
            onSelectTrip={(t) => setActiveTrip(t)}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'map' && (
          <RouteMap
            trip={activeTrip}
            itinerary={activeItinerary}
            onSelectTrip={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'weather' && (
          <WeatherWidget
            initialDestination={activeTrip?.destination || 'Tokyo, Japan'}
          />
        )}
      </main>

      {/* Footer */}
      <Footer
        onOpenSynopsis={() => setSynopsisModalOpen(true)}
        setActiveTab={setActiveTab}
      />

      {/* Modals & Toasts */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          showToast('success', 'Welcome!', 'Authentication successful.');
          setActiveTab('dashboard');
        }}
      />

      <ProjectSynopsisModal
        isOpen={synopsisModalOpen}
        onClose={() => setSynopsisModalOpen(false)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
