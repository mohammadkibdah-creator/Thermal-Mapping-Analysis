import React from 'react';
import {
  AppState,
  isRecordExpired,
} from '../store/metrologyStore.ts';
import { ArrowRight } from 'lucide-react';
import { ActiveTab } from './Header.tsx';

interface DashboardProps {
  state: AppState;
  setActiveTab: (tab: ActiveTab) => void;
  onLaunchSampleStudy?: (sampleType: 'data_logger' | 'superdaq') => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  state,
  setActiveTab,
}) => {
  const totalEquipment = state.equipment.length;
  const totalKits = state.sensor_kits.length;

  const dlExpiredCount = state.equipment.filter(
    (e) => e.due_date && isRecordExpired(e.due_date)
  ).length;
  const sqExpiredCount = state.superdaq_sensors.filter(
    (s) => s.due_date && isRecordExpired(s.due_date)
  ).length;
  const expiredCount = dlExpiredCount + sqExpiredCount;

  return (
    <div className="space-y-5">
      {/* Hero Panel */}
      <section className="relative overflow-hidden rounded-xl border border-[#dce6f7] dark:border-[#334155] bg-gradient-to-r from-white via-[#f5f8ff] to-[#edf3ff] dark:from-[#1e293b] dark:via-[#1e293b] dark:to-[#0f172a] p-5 sm:p-6 md:p-9 min-h-[220px] sm:min-h-[268px] flex flex-col md:flex-row items-center justify-between shadow-sm">
        <div className="relative z-10 w-full md:w-auto max-w-md space-y-3 sm:space-y-4">
          <h1 className="text-2xl md:text-3xl font-bold text-[#182330] dark:text-slate-100 tracking-tight leading-snug">
            Thermal Mapping Analysis
          </h1>
          <p className="text-xs md:text-sm text-[#526071] dark:text-slate-300 leading-relaxed">
            Analyze temperature and humidity data, apply calibration corrections, and generate detailed study reports.
          </p>
          <div className="pt-1 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setActiveTab('study')}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2864dc]/40"
            >
              <span>Start a Study</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Full-bleed Hero Background Artwork */}
        <div className="absolute inset-0 pointer-events-none select-none">
          <img
            src={`${import.meta.env.BASE_URL}assets/aistudio/Thermal_Mapping_in_a_Smart_Warehouse_00c88b7b.webp`}
            alt="Thermal mapping visualization of temperature-controlled storage room"
            className="w-full h-full object-cover object-[62%_center] sm:object-[66%_center] md:object-center border-0 outline-none shadow-none saturate-[0.94] contrast-[1.06] brightness-[0.99] opacity-95 md:opacity-100 dark:saturate-[0.9] dark:contrast-[1.04] dark:brightness-[0.92] dark:opacity-90 [mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.08)_16%,rgba(0,0,0,0.35)_32%,rgba(0,0,0,0.72)_48%,black_66%,black_90%,rgba(0,0,0,0.82)_100%)] md:[mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.1)_14%,rgba(0,0,0,0.38)_28%,rgba(0,0,0,0.74)_44%,rgba(0,0,0,0.94)_56%,black_66%,black_91%,rgba(0,0,0,0.84)_100%)] dark:[mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.08)_16%,rgba(0,0,0,0.34)_30%,rgba(0,0,0,0.72)_46%,black_62%,black_90%,rgba(0,0,0,0.82)_100%)]"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          {/* Continuous full-width multi-stop transition: pure white left -> transparent center -> subtle cool-blue right edge */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff_0%,rgba(255,255,255,0.96)_18%,rgba(248,251,255,0.76)_30%,rgba(244,248,255,0.36)_42%,rgba(240,246,255,0.08)_54%,transparent_64%,transparent_88%,rgba(232,241,255,0.42)_100%)] dark:bg-[linear-gradient(to_right,#1e293b_0%,rgba(30,41,59,0.96)_20%,rgba(30,41,59,0.78)_33%,rgba(30,41,59,0.38)_46%,rgba(15,23,42,0.08)_58%,transparent_66%,transparent_88%,rgba(15,23,42,0.42)_100%)]" />
          {/* Very subtle top & bottom edge feathering */}
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(248,251,255,0.35)_0%,transparent_12%,transparent_86%,rgba(238,244,255,0.4)_100%)] dark:bg-[linear-gradient(to_bottom,rgba(30,41,59,0.35)_0%,transparent_12%,transparent_86%,rgba(15,23,42,0.45)_100%)]" />
        </div>
      </section>

      {/* Equipment Summary Statistics Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label="Equipment summary">
        <article
          onClick={() => setActiveTab('equipment')}
          className="p-5 rounded-xl bg-white dark:bg-[#1e293b] border border-[#e5e9ef] dark:border-[#334155] shadow-xs flex flex-col justify-between min-h-[112px] hover:border-[#ccd7e6] dark:hover:border-slate-500 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#526071] dark:text-slate-300 group-hover:text-[#182330] dark:group-hover:text-white transition-colors">
              Registered Data Loggers
            </span>
            <span className="w-7 h-7 rounded-lg bg-[#edf3ff] dark:bg-blue-950/60 text-[#2864dc] dark:text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0">
              DL
            </span>
          </div>
          <strong className="text-3xl font-extrabold text-[#182330] dark:text-slate-100 tabular-nums mt-3 tracking-tight">
            {totalEquipment}
          </strong>
        </article>

        <article
          onClick={() => setActiveTab('sensor_kits')}
          className="p-5 rounded-xl bg-white dark:bg-[#1e293b] border border-[#e5e9ef] dark:border-[#334155] shadow-xs flex flex-col justify-between min-h-[112px] hover:border-[#ccd7e6] dark:hover:border-slate-500 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#526071] dark:text-slate-300 group-hover:text-[#182330] dark:group-hover:text-white transition-colors">
              Registered SuperDAQ Kits
            </span>
            <span className="w-7 h-7 rounded-lg bg-[#edf3ff] dark:bg-blue-950/60 text-[#2864dc] dark:text-blue-400 text-[11px] font-bold flex items-center justify-center shrink-0">
              SQ
            </span>
          </div>
          <strong className="text-3xl font-extrabold text-[#182330] dark:text-slate-100 tabular-nums mt-3 tracking-tight">
            {totalKits}
          </strong>
        </article>

        <article
          onClick={() =>
            setActiveTab(
              dlExpiredCount === 0 && sqExpiredCount > 0 ? 'sensor_kits' : 'equipment'
            )
          }
          className="p-5 rounded-xl bg-white dark:bg-[#1e293b] border border-[#e5e9ef] dark:border-[#334155] shadow-xs flex flex-col justify-between min-h-[112px] hover:border-[#ccd7e6] dark:hover:border-slate-500 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#526071] dark:text-slate-300 group-hover:text-[#182330] dark:group-hover:text-white transition-colors">
              Expired Calibrations
            </span>
            <span className="w-7 h-7 rounded-lg bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] dark:text-red-400 text-[12px] font-bold flex items-center justify-center shrink-0">
              !
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <strong className="text-3xl font-extrabold text-[#182330] dark:text-slate-100 tabular-nums tracking-tight">
              {expiredCount}
            </strong>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#788493] dark:text-slate-400 tabular-nums">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab('equipment');
                }}
                className="py-1.5 px-1.5 -my-1 sm:py-0 sm:px-0 sm:my-0 hover:text-[#2864dc] dark:hover:text-blue-400 transition-colors cursor-pointer"
              >
                DL {dlExpiredCount}
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab('sensor_kits');
                }}
                className="py-1.5 px-1.5 -my-1 sm:py-0 sm:px-0 sm:my-0 hover:text-[#2864dc] dark:hover:text-blue-400 transition-colors cursor-pointer"
              >
                SQ {sqExpiredCount}
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
};
