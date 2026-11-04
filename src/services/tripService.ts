import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Trip, Itinerary, Expense, DayItinerary } from '../types';

// In-memory / localStorage cache for guest mode
const GUEST_TRIPS_KEY = 'stp_guest_trips';
const GUEST_ITINERARIES_KEY = 'stp_guest_itineraries';
const GUEST_EXPENSES_KEY = 'stp_guest_expenses';

function getLocalData<T>(key: string, defaultValue: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setLocalData<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Local storage save failed:', e);
  }
}

// Initial demo seed data for an instant rich experience (in INR)
const SEED_TRIPS: Trip[] = [
  {
    id: 'demo_trip_paris',
    userId: 'guest_traveler_101',
    title: 'Parisian Lights & Culture Discovery',
    startLocation: 'Mumbai, India',
    destination: 'Paris, France',
    startDate: '2026-12-10',
    endDate: '2026-12-14',
    travelers: 2,
    budget: 150000,
    travelPreferences: 'Historical, Food, Relaxation, Photography',
    travelMode: 'flight',
    accommodation: 'Boutique Hotel in Le Marais',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'demo_trip_tokyo',
    userId: 'guest_traveler_101',
    title: 'Tokyo Neon & Ancient Temples Expedition',
    startLocation: 'New Delhi, India',
    destination: 'Tokyo, Japan',
    startDate: '2027-03-15',
    endDate: '2027-03-21',
    travelers: 1,
    budget: 240000,
    travelPreferences: 'Food, Adventure, Shopping, Culture',
    travelMode: 'flight',
    accommodation: 'Modern High-Rise in Shinjuku',
    status: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const SEED_ITINERARY_PARIS: Itinerary = {
  id: 'itinerary_demo_trip_paris',
  tripId: 'demo_trip_paris',
  userId: 'guest_traveler_101',
  destination: 'Paris, France',
  totalDays: 4,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  days: [
    {
      dayNumber: 1,
      theme: 'Arrival, Iconic Eiffel Tower & Seine Sunset Cruise',
      description: 'Check into your boutique room, stroll through Champ de Mars, and experience the Eiffel Tower illumination.',
      estimatedCost: 15000,
      locations: [
        {
          name: 'Eiffel Tower & Trocadéro Gardens',
          description: 'Ascend to the summit observation deck for breathtaking views of the Paris skyline.',
          visitingTime: '10:00 AM – 1:00 PM',
          cost: 3000,
          recommendedActivity: 'High-speed elevator ride to Summit & photography from Trocadéro fountains',
          foodSuggestion: 'Warm butter croissants & café crème at Café de l’Homme',
          estimatedDistance: 'Central 7th arrondissement',
          lat: 48.8584,
          lng: 2.2945,
        },
        {
          name: 'Musée d’Orsay & Left Bank Stroll',
          description: 'Marvel at masterpieces by Monet, Van Gogh, and Renoir inside the opulent Beaux-Arts railway station.',
          visitingTime: '2:30 PM – 5:30 PM',
          cost: 1500,
          recommendedActivity: 'Impressionist gallery walk & clock face balcony photo',
          foodSuggestion: 'Classic Croque Monsieur and fresh citron pressé on Rue de Bac',
          estimatedDistance: '2.4 km along the Seine riverside',
          lat: 48.8599,
          lng: 2.3266,
        },
        {
          name: 'Bateaux Parisiens Twilight River Cruise',
          description: 'Glide under the romantic Pont Alexandre III as historic monuments light up the night.',
          visitingTime: '7:30 PM – 9:30 PM',
          cost: 1800,
          recommendedActivity: 'Open-air panoramic boat tour with audio guide and champagne',
          foodSuggestion: 'Dinner at Le Comptoir du Relais: Duck Confit & Crème Brûlée',
          estimatedDistance: '1.8 km from Orsay pier',
          lat: 48.8596,
          lng: 2.2965,
        },
      ],
    },
    {
      dayNumber: 2,
      theme: 'Louvre Treasury, Palais-Royal & Historic Le Marais',
      description: 'Discover centuries of royal art followed by charming artisan lanes and vintage boutiques.',
      estimatedCost: 16500,
      locations: [
        {
          name: 'The Louvre Museum & Glass Pyramid',
          description: 'Explore the world’s greatest art collection, including the Mona Lisa and Venus de Milo.',
          visitingTime: '9:30 AM – 1:30 PM',
          cost: 2000,
          recommendedActivity: 'Curated wing tour & photo by the I.M. Pei glass pyramid',
          foodSuggestion: 'Artisan Baguette sandwich with Comté cheese in Tuileries Garden',
          estimatedDistance: '1st Arrondissement',
          lat: 48.8606,
          lng: 2.3376,
        },
        {
          name: 'Palais-Royal Columns & Jardin',
          description: 'Wander between Daniel Buren’s striped modern columns and tranquil shaded arcades.',
          visitingTime: '2:30 PM – 4:30 PM',
          cost: 0,
          recommendedActivity: 'Courtyard stroll, coffee at Café Kitsuné & fountain relaxation',
          foodSuggestion: 'Specialty flat white and matcha pastries',
          estimatedDistance: '0.6 km north of Louvre',
          lat: 48.8648,
          lng: 2.3372,
        },
        {
          name: 'Place des Vosges & Le Marais Bistros',
          description: 'Oldest planned square in Paris with pink brick vaulted arcades and lively evening terraces.',
          visitingTime: '6:00 PM – 9:30 PM',
          cost: 4500,
          recommendedActivity: 'Gallery browsing, Victor Hugo house, and wine bar hopping',
          foodSuggestion: 'World-famous warm pita falafel at L’As du Fallafel followed by Berthillon gelato',
          estimatedDistance: '2.1 km east to 4th Arrondissement',
          lat: 48.8554,
          lng: 2.3654,
        },
      ],
    },
    {
      dayNumber: 3,
      theme: 'Montmartre Artists, Sacré-Cœur & Bohemian Cafés',
      description: 'Ascend the cobblestone hill of Montmartre to see panoramic vistas and painter studios.',
      estimatedCost: 12000,
      locations: [
        {
          name: 'Sacré-Cœur Basilica & Dome',
          description: 'The shimmering white basilica crowned atop the city’s highest hill.',
          visitingTime: '10:00 AM – 1:00 PM',
          cost: 800,
          recommendedActivity: 'Climbing dome steps for 360° Paris skyline and bell tower view',
          foodSuggestion: 'Warm crepes suzette and cider from a rustic Montmartre crêperie',
          estimatedDistance: '18th Arrondissement hilltop',
          lat: 48.8867,
          lng: 2.3431,
        },
        {
          name: 'Place du Tertre & Le Mur des Je T’aime',
          description: 'Vibrant artist square where portraitists paint en plein air; visit the Wall of Love.',
          visitingTime: '2:00 PM – 5:00 PM',
          cost: 2500,
          recommendedActivity: 'Custom caricature portrait & exploring quaint Rue de l’Abreuvoir',
          foodSuggestion: 'Traditional French Onion Soup gratinated with Gruyère',
          estimatedDistance: '0.4 km scenic cobblestone walk',
          lat: 48.8865,
          lng: 2.3408,
        },
        {
          name: 'Moulin Rouge & Pigalle Cabaret District',
          description: 'Experience the electric evening ambiance of legendary Parisian entertainment.',
          visitingTime: '7:30 PM – 10:30 PM',
          cost: 6500,
          recommendedActivity: 'Cabaret show or cocktail evening at a retro speakeasy',
          foodSuggestion: 'Steak Frites with secret herb butter sauce at Le Relais de Venise',
          estimatedDistance: '1.1 km down the hill',
          lat: 48.8841,
          lng: 2.3323,
        },
      ],
    },
  ],
};

const SEED_EXPENSES_PARIS: Expense[] = [
  {
    id: 'exp_paris_1',
    tripId: 'demo_trip_paris',
    userId: 'guest_traveler_101',
    title: 'High Speed Train / Flight Tickets',
    amount: 28500,
    category: 'Transport',
    date: '2026-12-10',
    notes: 'Transit tickets from departure hub',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'exp_paris_2',
    tripId: 'demo_trip_paris',
    userId: 'guest_traveler_101',
    title: 'Le Marais Boutique Hotel Deposit',
    amount: 52000,
    category: 'Accommodation',
    date: '2026-12-10',
    notes: '3 nights stay with courtyard breakfast',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'exp_paris_3',
    tripId: 'demo_trip_paris',
    userId: 'guest_traveler_101',
    title: 'Eiffel Tower Summit & Louvre Museum Passes',
    amount: 9200,
    category: 'Activities',
    date: '2026-12-11',
    notes: 'Fast-track priority entry tickets',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'exp_paris_4',
    tripId: 'demo_trip_paris',
    userId: 'guest_traveler_101',
    title: 'Seine River Twilight Dinner & Wine',
    amount: 12000,
    category: 'Food',
    date: '2026-12-11',
    notes: 'Romantic dinner on Left Bank',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'exp_paris_5',
    tripId: 'demo_trip_paris',
    userId: 'guest_traveler_101',
    title: 'Artisan Perfume & French Macarons',
    amount: 7100,
    category: 'Shopping',
    date: '2026-12-12',
    notes: 'Ladurée gift box and boutique scent',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// Trip Service APIs
export async function getTrips(userId: string, isGuest = false): Promise<Trip[]> {
  if (isGuest || userId.startsWith('guest_')) {
    const list = getLocalData<Trip>(GUEST_TRIPS_KEY, SEED_TRIPS);
    return list;
  }

  const tripsCollection = collection(db, 'trips');
  try {
    const q = query(tripsCollection, where('userId', '==', userId));
    const snapshot = await getDocs(q);
    const trips = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Trip));
    return trips;
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, 'trips');
    } catch {
      // Diagnostic logged via handleFirestoreError
    }
    return getLocalData<Trip>(GUEST_TRIPS_KEY, SEED_TRIPS);
  }
}

export async function createTrip(trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>, isGuest = false): Promise<Trip> {
  const id = 'trip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = new Date().toISOString();
  const newTrip: Trip = {
    ...trip,
    id,
    createdAt: now,
    updatedAt: now,
  };

  if (isGuest || trip.userId.startsWith('guest_')) {
    const current = getLocalData<Trip>(GUEST_TRIPS_KEY, SEED_TRIPS);
    setLocalData(GUEST_TRIPS_KEY, [newTrip, ...current]);
    return newTrip;
  }

  const tripDocRef = doc(db, 'trips', id);
  try {
    await setDoc(tripDocRef, newTrip);
    return newTrip;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `trips/${id}`);
    throw error;
  }
}

export async function updateTrip(tripId: string, updates: Partial<Trip>, isGuest = false): Promise<void> {
  const now = new Date().toISOString();
  if (isGuest) {
    const current = getLocalData<Trip>(GUEST_TRIPS_KEY, SEED_TRIPS);
    const updated = current.map((t) => (t.id === tripId ? { ...t, ...updates, updatedAt: now } : t));
    setLocalData(GUEST_TRIPS_KEY, updated);
    return;
  }

  const tripDocRef = doc(db, 'trips', tripId);
  try {
    await updateDoc(tripDocRef, { ...updates, updatedAt: now });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `trips/${tripId}`);
  }
}

export async function deleteTrip(tripId: string, isGuest = false): Promise<void> {
  if (isGuest) {
    const current = getLocalData<Trip>(GUEST_TRIPS_KEY, SEED_TRIPS);
    setLocalData(GUEST_TRIPS_KEY, current.filter((t) => t.id !== tripId));
    return;
  }

  const tripDocRef = doc(db, 'trips', tripId);
  try {
    await deleteDoc(tripDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `trips/${tripId}`);
  }
}

// Itinerary Service APIs
export async function getItinerary(tripId: string, userId: string, isGuest = false): Promise<Itinerary | null> {
  if (isGuest || userId.startsWith('guest_')) {
    const list = getLocalData<Itinerary>(GUEST_ITINERARIES_KEY, [SEED_ITINERARY_PARIS]);
    const found = list.find((it) => it.tripId === tripId);
    return found || null;
  }

  const itRef = doc(db, 'itineraries', `itinerary_${tripId}`);
  try {
    const snap = await getDoc(itRef);
    if (snap.exists()) {
      const data = snap.data();
      let days: DayItinerary[] = [];
      try {
        days = typeof data.daysJson === 'string' ? JSON.parse(data.daysJson) : data.days || [];
      } catch {
        days = data.days || [];
      }
      return {
        id: snap.id,
        tripId: data.tripId,
        userId: data.userId,
        destination: data.destination,
        totalDays: data.totalDays,
        days,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    }
    return null;
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.GET, `itineraries/itinerary_${tripId}`);
    } catch {
      // Diagnostic logged via handleFirestoreError
    }
    const list = getLocalData<Itinerary>(GUEST_ITINERARIES_KEY, [SEED_ITINERARY_PARIS]);
    return list.find((it) => it.tripId === tripId) || null;
  }
}

export async function saveItinerary(
  tripId: string,
  userId: string,
  destination: string,
  days: DayItinerary[],
  isGuest = false
): Promise<Itinerary> {
  const id = `itinerary_${tripId}`;
  const now = new Date().toISOString();
  const itinerary: Itinerary = {
    id,
    tripId,
    userId,
    destination,
    totalDays: days.length,
    days,
    createdAt: now,
    updatedAt: now,
  };

  if (isGuest || userId.startsWith('guest_')) {
    const list = getLocalData<Itinerary>(GUEST_ITINERARIES_KEY, [SEED_ITINERARY_PARIS]);
    const filtered = list.filter((i) => i.tripId !== tripId);
    setLocalData(GUEST_ITINERARIES_KEY, [itinerary, ...filtered]);
    return itinerary;
  }

  const itRef = doc(db, 'itineraries', id);
  try {
    await setDoc(itRef, {
      tripId,
      userId,
      destination,
      totalDays: days.length,
      daysJson: JSON.stringify(days),
      createdAt: now,
      updatedAt: now,
    });
    return itinerary;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `itineraries/${id}`);
    throw error;
  }
}

// Expenses Service APIs
export async function getExpenses(tripId: string, userId: string, isGuest = false): Promise<Expense[]> {
  if (isGuest || userId.startsWith('guest_')) {
    const list = getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
    return list.filter((e) => e.tripId === tripId);
  }

  const expensesCol = collection(db, 'expenses');
  try {
    const q = query(expensesCol, where('userId', '==', userId), where('tripId', '==', tripId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense));
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, 'expenses');
    } catch {
      // Diagnostic logged via handleFirestoreError
    }
    const list = getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
    return list.filter((e) => e.tripId === tripId);
  }
}

export async function getAllExpensesForUser(userId: string, isGuest = false): Promise<Expense[]> {
  if (isGuest || userId.startsWith('guest_')) {
    return getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
  }

  const expensesCol = collection(db, 'expenses');
  try {
    const q = query(expensesCol, where('userId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense));
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, 'expenses');
    } catch {
      // Diagnostic logged via handleFirestoreError
    }
    return getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
  }
}

export async function addExpense(
  expense: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>,
  isGuest = false
): Promise<Expense> {
  const id = 'exp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const now = new Date().toISOString();
  const newExp: Expense = {
    ...expense,
    id,
    createdAt: now,
    updatedAt: now,
  };

  if (isGuest || expense.userId.startsWith('guest_')) {
    const current = getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
    setLocalData(GUEST_EXPENSES_KEY, [newExp, ...current]);
    return newExp;
  }

  const docRef = doc(db, 'expenses', id);
  try {
    await setDoc(docRef, newExp);
    return newExp;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `expenses/${id}`);
    throw error;
  }
}

export async function updateExpense(
  expenseId: string,
  updates: Partial<Expense>,
  isGuest = false
): Promise<void> {
  const now = new Date().toISOString();
  if (isGuest) {
    const current = getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
    setLocalData(
      GUEST_EXPENSES_KEY,
      current.map((e) => (e.id === expenseId ? { ...e, ...updates, updatedAt: now } : e))
    );
    return;
  }

  const docRef = doc(db, 'expenses', expenseId);
  try {
    await updateDoc(docRef, { ...updates, updatedAt: now });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `expenses/${expenseId}`);
  }
}

export async function deleteExpense(expenseId: string, isGuest = false): Promise<void> {
  if (isGuest) {
    const current = getLocalData<Expense>(GUEST_EXPENSES_KEY, SEED_EXPENSES_PARIS);
    setLocalData(
      GUEST_EXPENSES_KEY,
      current.filter((e) => e.id !== expenseId)
    );
    return;
  }

  const docRef = doc(db, 'expenses', expenseId);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `expenses/${expenseId}`);
  }
}
