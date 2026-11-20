import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Moon, ShieldCheck, Sun, User, AlertCircle } from 'lucide-react';
import { verifyAccessCredentials, grantSessionAccess } from '../utils/accessGate.ts';

interface LoginScreenProps {
  onAuthenticated: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onAuthenticated,
  isDarkMode,
  onToggleDarkMode,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setIsChecking(true);
    try {
      const valid = await verifyAccessCredentials(username, password);
      if (valid) {
        grantSessionAccess(rememberMe);
        onAuthenticated();
      } else {
        setError('Invalid username or password. Please check your credentials and try again.');
      }
    } catch {
      setError('Unable to verify credentials. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f7fa] dark:bg-[#0f172a] text-[#182330] dark:text-slate-100 transition-colors">
      {/* Top Bar with Theme Switcher */}
      <div className="w-full px-4 sm:px-6 py-3 flex justify-end">
        <button
          type="button"
          onClick={onToggleDarkMode}
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 flex items-center justify-center p-2 rounded-lg border border-[#e5e9ef] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-[#526071] dark:text-slate-300 hover:bg-[#edf3ff] dark:hover:bg-[#334155] hover:text-[#2864dc] dark:hover:text-blue-400 transition-colors cursor-pointer"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Centered Institutional Access Card */}
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[420px]">
          <div className="bg-white dark:bg-[#1e293b] border border-[#e5e9ef] dark:border-[#334155] rounded-2xl shadow-sm overflow-hidden transition-colors">
            {/* Institutional Header Band */}
            <div className="px-6 pt-7 pb-5 border-b border-[#edf0f4] dark:border-[#334155] bg-gradient-to-b from-[#fafcff] to-white dark:from-[#1e293b] dark:to-[#1e293b] text-center">
              <div className="flex justify-center mb-4">
                <img
                  src={`${import.meta.env.BASE_URL}RSS_JNMI_Lock-Up.png`}
                  alt="Royal Scientific Society and Jordan National Metrology Institute"
                  className="h-11 sm:h-12 w-auto max-w-[220px] object-contain dark:brightness-110"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-[#182330] dark:text-slate-100 tracking-tight">
                Thermal Mapping Analysis
              </h1>
              <p className="text-xs text-[#647184] dark:text-slate-400 mt-1 flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#2864dc] dark:text-blue-400 shrink-0" />
                <span>JNMI · RSS — Authorized Access Only</span>
              </p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3 rounded-xl bg-[#fff0ed] dark:bg-red-950/40 border border-[#fed7d0] dark:border-red-800/70 text-[#bd4d42] dark:text-red-300 text-xs font-medium leading-relaxed"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="login-username"
                  className="block text-xs font-semibold text-[#334155] dark:text-slate-200 mb-1.5"
                >
                  Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#8896a6] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    className="w-full h-11 pl-10 pr-3 rounded-xl border border-[#d6dde6] dark:border-[#334155] bg-[#fafbfd] dark:bg-[#0f172a] text-sm text-[#182330] dark:text-slate-100 placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#2864dc]/30 focus:border-[#2864dc] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-[#334155] dark:text-slate-200 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#8896a6] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    className="w-full h-11 pl-10 pr-11 rounded-xl border border-[#d6dde6] dark:border-[#334155] bg-[#fafbfd] dark:bg-[#0f172a] text-sm text-[#182330] dark:text-slate-100 placeholder:text-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#2864dc]/30 focus:border-[#2864dc] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#647184] hover:text-[#182330] dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-[#526071] dark:text-slate-300 cursor-pointer select-none pt-0.5">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-[#cbd5e1] text-[#2864dc] focus:ring-[#2864dc]/30 cursor-pointer"
                />
                <span>Keep me signed in on this device</span>
              </label>

              <button
                type="submit"
                disabled={isChecking}
                className="w-full min-h-[44px] mt-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#2864dc] hover:bg-[#1e4fae] disabled:opacity-60 text-white text-sm font-semibold shadow-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2864dc]/40"
              >
                <Lock className="w-4 h-4" />
                <span>{isChecking ? 'Verifying...' : 'Sign In'}</span>
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Institutional Footer */}
      <footer className="py-4 pb-safe px-4 text-center text-[11px] text-[#647184] dark:text-slate-400">
        © 2026 Eng. Mohammad Ibdah. All rights reserved. Thermal Mapping Analysis Version 1.0.0
      </footer>
    </div>
  );
};
