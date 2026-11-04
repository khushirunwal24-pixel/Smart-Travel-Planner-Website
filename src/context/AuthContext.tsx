import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider, testConnection, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isGuest: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  continueAsGuest: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_GUEST_USER: UserProfile = {
  uid: 'guest_traveler_101',
  email: 'traveler@smartplanner.io',
  displayName: 'Alex Traveler (Demo)',
  photoURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
  createdAt: new Date().toISOString(),
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isGuest, setIsGuest] = useState<boolean>(false);

  useEffect(() => {
    // Run connection test once on app boot
    testConnection();

    // Check if guest was active in localStorage
    const savedGuest = localStorage.getItem('stp_guest_session');
    if (savedGuest === 'true') {
      setIsGuest(true);
      setProfile(DEMO_GUEST_USER);
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setIsGuest(false);
        localStorage.removeItem('stp_guest_session');

        // Fetch or create user document in Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        try {
          const userSnap = await getDoc(userDocRef);
          if (userSnap.exists()) {
            setProfile(userSnap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Traveler',
              photoURL: currentUser.photoURL || '',
              createdAt: new Date().toISOString(),
            };
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          console.warn('User profile sync to Firestore notice:', error);
          setProfile({
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Traveler',
            photoURL: currentUser.photoURL || '',
          });
        }
      } else {
        setUser(null);
        if (!isGuest && localStorage.getItem('stp_guest_session') !== 'true') {
          setProfile(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isGuest]);

  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, googleProvider);
      setIsGuest(false);
      localStorage.removeItem('stp_guest_session');
    } catch (err) {
      console.error('Google Sign-in failed:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), pass);
      setIsGuest(false);
      localStorage.removeItem('stp_guest_session');
    } catch (err) {
      console.error('Email Sign-in failed:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string) => {
    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      if (cred.user) {
        const cleanName = name.trim() || email.split('@')[0] || 'Traveler';
        try {
          await updateProfile(cred.user, { displayName: cleanName });
        } catch (upErr) {
          console.warn('Profile display name update warning:', upErr);
        }

        const newProfile: UserProfile = {
          uid: cred.user.uid,
          email: cred.user.email || email.trim(),
          displayName: cleanName,
          photoURL: '',
          createdAt: new Date().toISOString(),
        };

        const userDocRef = doc(db, 'users', cred.user.uid);
        try {
          await setDoc(userDocRef, newProfile);
        } catch (fErr) {
          console.warn('Initial firestore user doc creation warning:', fErr);
        }
        setProfile(newProfile);
      }
      setIsGuest(false);
      localStorage.removeItem('stp_guest_session');
    } catch (err) {
      console.error('Email Registration failed:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const continueAsGuest = () => {
    setIsGuest(true);
    localStorage.setItem('stp_guest_session', 'true');
    setProfile(DEMO_GUEST_USER);
  };

  const logout = async () => {
    try {
      setIsGuest(false);
      localStorage.removeItem('stp_guest_session');
      setProfile(null);
      setUser(null);
      await signOut(auth);
    } catch (err) {
      console.error('Sign out error:', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isGuest,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        continueAsGuest,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
