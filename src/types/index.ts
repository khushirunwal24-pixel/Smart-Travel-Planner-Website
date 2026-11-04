export type TripStatus = 'planning' | 'active' | 'completed' | 'cancelled';

export type ExpenseCategory =
  | 'Transport'
  | 'Accommodation'
  | 'Food'
  | 'Activities'
  | 'Shopping'
  | 'Other';

export interface TripLocationItem {
  name: string;
  description: string;
  visitingTime: string;
  cost: number;
  recommendedActivity: string;
  foodSuggestion: string;
  estimatedDistance?: string;
  lat: number;
  lng: number;
}

export interface DayItinerary {
  dayNumber: number;
  theme: string;
  description: string;
  estimatedCost: number;
  locations: TripLocationItem[];
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

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}
