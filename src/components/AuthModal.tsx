import React, { useState } from 'react';
import {
  X,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Sparkles,
  Compass,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import firebaseConfig from '@/firebase-applet-config.json';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'login',
}) => {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, continueAsGuest } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOperationNotAllowed, setIsOperationNotAllowed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const projectId = firebaseConfig.projectId || 'gen-lang-client-0421739572';
  const consoleAuthUrl = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;

  const formatAuthError = (err: any) => {
    const code = err?.code || '';
    const rawMsg = err?.message || '';

    if (code === 'auth/operation-not-allowed' || rawMsg.includes('operation-not-allowed')) {
      setIsOperationNotAllowed(true);
      return 'Email/Password sign-in provider is currently disabled in your Firebase Project Console. See instructions below to enable it.';
    }

    setIsOperationNotAllowed(false);

    if (code === 'auth/email-already-in-use' || rawMsg.includes('email-already-in-use')) {
      return 'An account with this email address already exists. Please switch to the Log In tab above.';
    }

    if (code === 'auth/invalid-email' || rawMsg.includes('invalid-email')) {
      return 'Please enter a valid email address (e.g. name@example.com).';
    }

    if (code === 'auth/weak-password' || rawMsg.includes('weak-password')) {
      return 'Password should be at least 6 characters long.';
    }

    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      rawMsg.includes('invalid-credential') ||
      rawMsg.includes('user-not-found') ||
      rawMsg.includes('wrong-password')
    ) {
      return 'Invalid email or password. Please check your credentials or use Google Sign-in / Guest Mode.';
    }

    if (code === 'auth/popup-closed-by-user' || rawMsg.includes('popup-closed-by-user')) {
      return 'Google sign-in popup was closed before completing. Please try again.';
    }

    if (code === 'auth/popup-blocked' || rawMsg.includes('popup-blocked')) {
      return 'Popup was blocked by your browser. Please allow popups or try Email Sign-in.';
    }

    if (code === 'auth/too-many-requests' || rawMsg.includes('too-many-requests')) {
      return 'Too many unsuccessful attempts. Access to this account has been temporarily disabled. Please try again later.';
    }

    if (code === 'auth/network-request-failed' || rawMsg.includes('network-request-failed')) {
      return 'Network connection issue. Please check your internet connection.';
    }

    return rawMsg || 'Authentication failed. Please verify your credentials.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsOperationNotAllowed(false);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage('Please fill in both email and password.');
      return;
    }

    if (mode === 'register' && !displayName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    try {
      setSubmitting(true);
      if (mode === 'login') {
        await signInWithEmail(cleanEmail, password);
      } else {
        await signUpWithEmail(cleanEmail, password, displayName.trim());
      }
      onSuccess?.();
      onClose();
    } catch (err: any) {
      const friendly = formatAuthError(err);
      setErrorMessage(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setErrorMessage(null);
    setIsOperationNotAllowed(false);
    try {
      setSubmitting(true);
      await signInWithGoogle();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      const friendly = formatAuthError(err);
      setErrorMessage(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuestDemo = () => {
    continueAsGuest();
    onSuccess?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-8">
        {/* Top visual decoration */}
        <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-teal-500 p-6 text-white text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md mx-auto flex items-center justify-center mb-3">
            <Compass className="w-6 h-6 text-white animate-spin-slow" />
          </div>
          <h3 className="text-xl font-bold font-heading">
            {mode === 'login' ? 'Welcome Back Traveler' : 'Join Smart Travel Planner'}
          </h3>
          <p className="text-xs text-blue-100 mt-1">
            Access your personalized itineraries and budget tracking
          </p>

          {/* Mode Switcher Tabs */}
          <div className="mt-5 grid grid-cols-2 p-1 bg-black/20 rounded-xl max-w-xs mx-auto">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
                setIsOperationNotAllowed(false);
              }}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'login' ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-100 hover:text-white'
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
                setIsOperationNotAllowed(false);
              }}
              className={`py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'register' ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-100 hover:text-white'
              }`}
            >
              Sign Up
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6">
          {/* Operation Not Allowed Detailed Guide Alert */}
          {isOperationNotAllowed && (
            <div className="mb-5 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2.5 animate-fade-in shadow-xs">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold text-amber-950 text-xs">
                    Firebase Console Setting Required
                  </h4>
                  <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                    Firebase returned <code className="font-mono font-semibold bg-amber-100 px-1 py-0.5 rounded">auth/operation-not-allowed</code> because the <strong>Email/Password</strong> provider is disabled by default in your Firebase project.
                  </p>
                </div>
              </div>

              <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200/80 text-[11px] text-slate-800 space-y-1">
                <p className="font-semibold text-slate-900">How to enable it in 30 seconds:</p>
                <ol className="list-decimal pl-4 space-y-0.5 text-slate-700">
                  <li>Open the Firebase Console for your project:</li>
                  <li className="font-mono text-[10px] text-blue-600 break-all">{consoleAuthUrl}</li>
                  <li>Click on <strong>Email/Password</strong> under <em>Sign-in providers</em>.</li>
                  <li>Toggle the <strong>Enable</strong> switch to <strong>ON</strong> and click <strong>Save</strong>.</li>
                </ol>
              </div>

              <div className="pt-1 flex items-center justify-between gap-2">
                <a
                  href={consoleAuthUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-blue-600 hover:text-blue-700 underline text-xs"
                >
                  Open Firebase Auth Console <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-[10px] text-amber-700">Or use Google login below</span>
              </div>
            </div>
          )}

          {/* Standard error banner (when not operation-not-allowed) */}
          {errorMessage && !isOperationNotAllowed && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2 animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1-Click Google Sign In */}
          <button
            type="button"
            onClick={handleGoogleAuth}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors shadow-sm mb-4 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-4">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              or with email
            </span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Traveler"
                    required
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  className="w-full pl-9 pr-10 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {submitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : mode === 'login' ? (
                'Sign In to Dashboard'
              ) : (
                'Create Free Account'
              )}
            </button>
          </form>

          {/* Demo guest traveler bypass button */}
          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={handleGuestDemo}
              className="w-full py-2 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Instant Test: Continue as Guest Demo Traveler</span>
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Explore full features instantly without needing an account
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
