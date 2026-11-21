import React from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';

export type ActiveTab = 'dashboard' | 'equipment' | 'sensor_kits' | 'study';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  applicationName?: string;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isDarkMode,
  onToggleDarkMode,
  onLogout,
}) => {
  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'equipment', label: 'Data Loggers' },
    { id: 'sensor_kits', label: 'SuperDAQ Kits' },
    { id: 'study', label: 'Study Workspace' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#0f172a]/95 backdrop-blur-sm border-b border-[#e5e9ef] dark:border-[#334155] px-3 sm:px-5 md:px-8 xl:px-10 transition-colors">
      <div className="max-w-[1680px] mx-auto flex items-center justify-between gap-2 sm:gap-4 py-2 lg:py-2.5">
        {/* Slim Single-Line Brand Zone */}
        <button
          onClick={() => setActiveTab('dashboard')}
          className="flex items-center gap-2 sm:gap-3 text-left hover:opacity-90 transition-opacity cursor-pointer min-w-0 flex-1 lg:flex-initial lg:shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2864dc]/40 rounded-lg"
        >
          <img
            src={`${import.meta.env.BASE_URL}RSS_JNMI_Lock-Up.png`}
            alt="Royal Scientific Society and Jordan National Metrology Institute"
            className="h-7 sm:h-9 lg:h-10 w-auto max-w-[92px] sm:max-w-[140px] md:max-w-[165px] lg:max-w-[180px] object-contain shrink-0 dark:brightness-110"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <div className="flex flex-col justify-center border-l border-[#e5e9ef] dark:border-[#334155] pl-2 sm:pl-3 min-w-0">
            <span className="text-[13px] sm:text-[15px] md:text-[16px] lg:text-[17px] font-bold text-[#182330] dark:text-slate-100 tracking-[0.015em] leading-tight truncate sm:whitespace-nowrap">
              Thermal Mapping Analysis
            </span>
            <span className="w-full flex items-center justify-between gap-1.5 sm:gap-2 text-[8.5px] sm:text-[9px] lg:text-[10px] font-medium text-[#647184] dark:text-slate-400 leading-tight mt-0.5 truncate sm:whitespace-nowrap">
              <span className="shrink-0">JNMI · RSS</span>
              <span className="truncate">
                Developed by{' '}
                <strong className="font-semibold text-[#334155] dark:text-slate-200">
                  Eng. Mohammad Ibdah
                </strong>
              </span>
            </span>
          </div>
        </button>

        {/* Desktop Navigation Tabs + Dark Mode Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <nav className="hidden lg:flex items-center gap-1.5" aria-label="Main navigation">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2864dc]/30 ${
                    isActive
                      ? 'bg-[#edf3ff] dark:bg-blue-950/60 text-[#2864dc] dark:text-blue-400'
                      : 'text-[#526071] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#1e293b] hover:text-[#182330] dark:hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={onToggleDarkMode}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 flex items-center justify-center p-2 rounded-lg border border-[#e5e9ef] dark:border-[#334155] bg-[#f8f9fb] dark:bg-[#1e293b] text-[#526071] dark:text-slate-300 hover:bg-[#edf3ff] dark:hover:bg-[#334155] hover:text-[#2864dc] dark:hover:text-blue-400 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2864dc]/30"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              title="Sign Out"
              aria-label="Sign Out"
              className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 flex items-center justify-center p-2 rounded-lg border border-[#e5e9ef] dark:border-[#334155] bg-[#f8f9fb] dark:bg-[#1e293b] text-[#526071] dark:text-slate-300 hover:bg-[#fff0ed] dark:hover:bg-red-950/50 hover:text-[#bd4d42] dark:hover:text-red-400 hover:border-[#fed7d0] dark:hover:border-red-800/70 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2864dc]/30"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden grid grid-cols-4 border-t border-[#edf0f4] dark:border-[#334155] py-1.5 gap-1"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`min-h-[38px] px-1.5 py-1.5 text-[11px] font-semibold leading-tight text-center rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
              activeTab === item.id
                ? 'bg-[#edf3ff] dark:bg-blue-950/60 text-[#2864dc] dark:text-blue-400'
                : 'text-[#526071] dark:text-slate-300 active:bg-[#f5f7fa] dark:active:bg-[#1e293b]'
            }`}
          >
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
};
