import React, { useState } from 'react';
import { StudyAnalysisOutput, getSensorDisplayLabel } from '../utils/importers.ts';
import { exportStudyReportWorkbook } from '../utils/excelExport.ts';
import { formatDateTimeDDMMYYYY } from '../utils/dateFormat.ts';
import { ThermalChart } from './ThermalChart.tsx';
import { CHART_SERIES_COLORS } from '../utils/chartPng.ts';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Check,
  Flame,
  Snowflake,
} from 'lucide-react';

interface ResultsPreviewProps {
  output: StudyAnalysisOutput;
  onBackToStudy: () => void;
  onJumpToStep?: (step: 1 | 2 | 3) => void;
  onFinish: () => void;
}

export const ResultsPreview: React.FC<ResultsPreviewProps> = ({
  output,
  onBackToStudy,
  onJumpToStep,
  onFinish,
}) => {
  const [warningsExpanded, setWarningsExpanded] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  const handleDownloadExcel = async () => {
    if (isExportingExcel) return;
    setIsExportingExcel(true);
    try {
      const bytes = await exportStudyReportWorkbook(output);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (output.studyName || 'Thermal_Mapping_Report').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `${safeName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const hasHumidity =
    output.mode === 'temperature_and_humidity' ||
    output.loggerResults.some((r) => r.humidity !== null) ||
    output.series.some((s) => s.correctedHumidities && s.correctedHumidities.length > 0);

  const humLimits = output.humidityLimits || { lower: 20, upper: 65 };
  const humResults = output.loggerResults.filter((item) => item.humidity !== null);

  const allMins = output.loggerResults.map((r) => r.temperature.minimum);
  const allMaxs = output.loggerResults.map((r) => r.temperature.maximum);
  const globalLowest = allMins.length > 0 ? Math.min(...allMins) : 0;
  const globalHighest = allMaxs.length > 0 ? Math.max(...allMaxs) : 0;

  const humMins = humResults.map((r) => r.humidity!.minimum);
  const humMaxs = humResults.map((r) => r.humidity!.maximum);
  const globalHumLowest = humMins.length > 0 ? Math.min(...humMins) : 0;
  const globalHumHighest = humMaxs.length > 0 ? Math.max(...humMaxs) : 0;

  const labelFor = (code: string | null | undefined) =>
    getSensorDisplayLabel(code, output.assignedSnapshots, output.acquisitionSystem);

  return (
    <div className="space-y-6">
      {/* Unified 4-Step Stepper (Step 4 Active) */}
      <nav
        aria-label="Study workflow progress"
        className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-3 shadow-xs"
      >
        <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { step: 1 as const, label: 'Setup' },
            { step: 2 as const, label: 'Select Sensors' },
            { step: 3 as const, label: 'Upload Data' },
            { step: 4 as const, label: 'Results' },
          ].map((item) => {
            const isActive = item.step === 4;
            const isCompleted = item.step < 4;
            return (
              <li key={item.step}>
                <button
                  type="button"
                  disabled={isActive}
                  onClick={() => {
                    if (item.step !== 4) {
                      if (onJumpToStep) onJumpToStep(item.step);
                      else onBackToStudy();
                    }
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-[#edf3ff] dark:bg-blue-950/60 border border-[#bfd3f8] dark:border-blue-800 text-[#2864dc] dark:text-blue-300'
                      : 'bg-[#f8fafc] dark:bg-[#0f172a]/50 border border-[#e5e9ef] dark:border-[#334155] text-[#182330] dark:text-slate-200 hover:border-[#2864dc]/50 cursor-pointer'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums shrink-0 ${
                      isActive ? 'bg-[#2864dc] text-white' : 'bg-[#10b981] text-white'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : item.step}
                  </span>
                  <div className="min-w-0">
                    <span className="block text-[10px] uppercase tracking-wider font-bold opacity-75">
                      Step {item.step}
                    </span>
                    <span className="block text-xs font-bold truncate">{item.label}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Top Header & Actions */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#182330] dark:text-slate-100 tracking-tight">
            {output.studyName} — Study Results
          </h1>
          <p className="text-xs text-[#647184] dark:text-slate-400 mt-1 font-medium tabular-nums">
            Period: {formatDateTimeDDMMYYYY(output.start)} – {formatDateTimeDDMMYYYY(output.end)} ·{' '}
            {output.acquisitionSystem}
            {output.sensorKit ? ` (${output.sensorKit})` : ''} · Interval: {output.samplingIntervalMinutes} min
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full md:w-auto">
          <button
            type="button"
            onClick={onBackToStudy}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1e293b] border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#345a9e] dark:text-blue-400 hover:bg-[#f9fbff] dark:hover:bg-[#0f172a] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Study</span>
          </button>
          <button
            type="button"
            onClick={onFinish}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1e293b] border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] transition-colors cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-[#059669]" />
            <span>Finish</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={isExportingExcel}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] shadow-xs transition-colors cursor-pointer disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>{isExportingExcel ? 'Generating Workbook...' : 'Save to Excel (.xlsx)'}</span>
          </button>
        </div>
      </section>

      {/* Collapsible Analysis Warnings Panel */}
      {output.warnings.length > 0 && (
        <section className="rounded-xl bg-[#fffbeb] dark:bg-amber-950/30 border border-[#fde68a] dark:border-amber-800 overflow-hidden">
          <button
            type="button"
            onClick={() => setWarningsExpanded((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[#fef3c7]/50 dark:hover:bg-amber-950/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 text-xs font-bold text-[#92400e] dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 text-[#d97706]" />
              <span>Analysis Warnings & Rounding Notices ({output.warnings.length})</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#92400e] dark:text-amber-300">
              <span>{warningsExpanded ? 'Hide details' : 'Show details'}</span>
              {warningsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
          {warningsExpanded && (
            <div className="px-4 pb-3.5 pt-1 border-t border-[#fde68a]/60 dark:border-amber-800/50">
              <ul className="list-disc list-inside text-[11px] space-y-1 text-[#78350f] dark:text-amber-200 tabular-nums">
                {output.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Temperature Key Summary Metrics Bar */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-4 shadow-xs">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#647184] dark:text-slate-400">
            Overall Temp Mean
          </p>
          <p className="text-xl font-extrabold text-[#2864dc] dark:text-blue-400 tabular-nums mt-1">
            {output.globalTemperatureMean.toFixed(2)} °C
          </p>
        </div>

        <div className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-4 shadow-xs min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#bd4d42] dark:text-red-400 flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 shrink-0" /> Hot Spot Sensor
          </p>
          <p
            className="text-xl font-extrabold text-[#182330] dark:text-slate-100 tabular-nums mt-1 truncate"
            title={output.hotSpotCode || undefined}
          >
            {labelFor(output.hotSpotCode)}{' '}
            <span className="text-xs font-semibold text-[#bd4d42] dark:text-red-400">
              ({globalHighest.toFixed(2)} °C max)
            </span>
          </p>
        </div>

        <div className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-4 shadow-xs min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#0284c7] dark:text-sky-400 flex items-center gap-1">
            <Snowflake className="w-3.5 h-3.5 shrink-0" /> Cold Spot Sensor
          </p>
          <p
            className="text-xl font-extrabold text-[#182330] dark:text-slate-100 tabular-nums mt-1 truncate"
            title={output.coldSpotCode || undefined}
          >
            {labelFor(output.coldSpotCode)}{' '}
            <span className="text-xs font-semibold text-[#0284c7] dark:text-sky-400">
              ({globalLowest.toFixed(2)} °C min)
            </span>
          </p>
        </div>
      </section>

      {/* Temperature Results Table */}
      <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#edf0f4] dark:border-[#334155] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#2864dc]" />
            <h2 className="text-sm font-bold text-[#182330] dark:text-slate-100">
              Temperature Results Table
            </h2>
          </div>
          <div className="text-xs text-[#526071] dark:text-slate-300 tabular-nums">
            Limits: {output.temperatureLimits.lower.toFixed(1)} to {output.temperatureLimits.upper.toFixed(1)} °C
          </div>
        </div>

        {/* Mobile Temperature Cards (< md) */}
        <div className="md:hidden divide-y divide-[#edf0f4] dark:divide-[#334155]">
          {output.loggerResults.map((item, idx) => {
            const color = CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length];
            const isHot = output.loggerResults.length > 1 && item.equipmentCode === output.hotSpotCode;
            const isCold = output.loggerResults.length > 1 && item.equipmentCode === output.coldSpotCode;
            const t = item.temperature;
            const rowTint = isHot
              ? 'bg-[#fff5f5] dark:bg-red-950/25'
              : isCold
              ? 'bg-[#f0f7ff] dark:bg-sky-950/25'
              : '';

            return (
              <div key={item.equipmentCode} className={`p-3.5 space-y-2.5 ${rowTint}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-sm font-bold text-[#2864dc] dark:text-blue-400 truncate">
                      {labelFor(item.equipmentCode)}
                    </span>
                    {isHot && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#fee2e2] dark:bg-red-950/60 text-[#b91c1c] dark:text-red-300 shrink-0">
                        <Flame className="w-3 h-3" /> Hot
                      </span>
                    )}
                    {isCold && !isHot && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#e0f2fe] dark:bg-sky-950/60 text-[#0369a1] dark:text-sky-300 shrink-0">
                        <Snowflake className="w-3 h-3" /> Cold
                      </span>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-block px-2 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                      t.in_range_percent < 100
                        ? 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                        : 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                    }`}
                  >
                    {Math.round(t.in_range_percent)}% In-Range
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                  <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                    <span className="block text-[10px] text-[#788493] dark:text-slate-400">MKT</span>
                    <strong className="text-[#182330] dark:text-slate-100">{t.mkt.toFixed(2)} °C</strong>
                  </div>
                  <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                    <span className="block text-[10px] text-[#788493] dark:text-slate-400">Mean</span>
                    <strong className="text-[#182330] dark:text-slate-100">{t.mean.toFixed(2)} °C</strong>
                  </div>
                  <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                    <span className="block text-[10px] text-[#788493] dark:text-slate-400">Std Dev</span>
                    <strong className="text-[#182330] dark:text-slate-100">{t.sample_standard_deviation.toFixed(3)}</strong>
                  </div>
                  <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                    <span className="block text-[10px] text-[#788493] dark:text-slate-400">Min</span>
                    <strong className="text-[#182330] dark:text-slate-100">{t.minimum.toFixed(2)} °C</strong>
                  </div>
                  <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                    <span className="block text-[10px] text-[#788493] dark:text-slate-400">Max</span>
                    <strong className="text-[#182330] dark:text-slate-100">{t.maximum.toFixed(2)} °C</strong>
                  </div>
                  <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                    <span className="block text-[10px] text-[#788493] dark:text-slate-400">Out-of-Range</span>
                    <strong className="text-[#182330] dark:text-slate-100">{t.out_of_range_minutes.toFixed(1)}m</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-slate-300 tabular-nums pt-0.5">
                  <span>Below: {t.below_minutes.toFixed(1)}m ({Math.round(t.below_percent)}%)</span>
                  <span>Above: {t.above_minutes.toFixed(1)}m ({Math.round(t.above_percent)}%)</span>
                </div>
              </div>
            );
          })}
          <div className="p-3.5 bg-[#f8f9fb] dark:bg-[#0f172a] flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-[#334155] dark:text-slate-200 tabular-nums">
            <span>Total: {output.loggerResults.length} Sensors</span>
            <span>
              Mean <strong className="text-[#2864dc] dark:text-blue-400">{output.globalTemperatureMean.toFixed(2)}°C</strong> · Min {globalLowest.toFixed(2)}°C · Max {globalHighest.toFixed(2)}°C
            </span>
          </div>
        </div>

        {/* Desktop Temperature Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
              <tr>
                <th className="py-2.5 px-3.5 text-left">Sensor</th>
                <th className="py-2.5 px-2.5 text-center">Spot</th>
                <th className="py-2.5 px-2.5 text-right">MKT (°C)</th>
                <th className="py-2.5 px-2.5 text-right">Mean (°C)</th>
                <th className="py-2.5 px-2.5 text-right">Min (°C)</th>
                <th className="py-2.5 px-2.5 text-right">Max (°C)</th>
                <th className="py-2.5 px-2.5 text-right">Std Dev</th>
                <th className="py-2.5 px-2.5 text-right">In-Range %</th>
                <th className="py-2.5 px-2.5 text-right">Out-of-Range (min)</th>
                <th className="py-2.5 px-2.5 text-right">Below Alert</th>
                <th className="py-2.5 px-3.5 text-right">Above Alert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
              {output.loggerResults.map((item, idx) => {
                const color = CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length];
                const isHot = output.loggerResults.length > 1 && item.equipmentCode === output.hotSpotCode;
                const isCold = output.loggerResults.length > 1 && item.equipmentCode === output.coldSpotCode;
                const t = item.temperature;

                const rowTint = isHot
                  ? 'bg-[#fff5f5] dark:bg-red-950/25'
                  : isCold
                  ? 'bg-[#f0f7ff] dark:bg-sky-950/25'
                  : 'hover:bg-[#fbfcfe] dark:hover:bg-[#0f172a]/50';

                return (
                  <tr key={item.equipmentCode} className={`${rowTint} transition-colors`}>
                    <td className="py-2.5 px-3.5 text-left font-semibold text-[#182330] dark:text-slate-100 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span
                          className="text-[#2864dc] dark:text-blue-400 font-semibold"
                          title={item.equipmentCode}
                        >
                          {labelFor(item.equipmentCode)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                      {isHot && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#fee2e2] dark:bg-red-950/60 text-[#b91c1c] dark:text-red-300">
                          <Flame className="w-3 h-3" /> Hot Spot
                        </span>
                      )}
                      {isCold && !isHot && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#e0f2fe] dark:bg-sky-950/60 text-[#0369a1] dark:text-sky-300">
                          <Snowflake className="w-3 h-3" /> Cold Spot
                        </span>
                      )}
                      {!isHot && !isCold && (
                        <span className="text-[11px] text-[#94a3b8] dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums font-semibold text-[#182330] dark:text-slate-100">
                      {t.mkt.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#334052] dark:text-slate-200">
                      {t.mean.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#334052] dark:text-slate-200">
                      {t.minimum.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#334052] dark:text-slate-200">
                      {t.maximum.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#526071] dark:text-slate-300">
                      {t.sample_standard_deviation.toFixed(3)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          t.in_range_percent < 100
                            ? 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                            : 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                        }`}
                      >
                        {Math.round(t.in_range_percent)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums font-medium text-[#334052] dark:text-slate-200">
                      {t.out_of_range_minutes.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#526071] dark:text-slate-300 whitespace-nowrap">
                      {t.below_minutes.toFixed(1)}m ({Math.round(t.below_percent)}%)
                    </td>
                    <td className="py-2.5 px-3.5 text-right tabular-nums text-[#526071] dark:text-slate-300 whitespace-nowrap">
                      {t.above_minutes.toFixed(1)}m ({Math.round(t.above_percent)}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#f8f9fb] dark:bg-[#0f172a] border-t border-[#e5e9ef] dark:border-[#334155] text-[#334155] dark:text-slate-200 font-semibold text-[11px]">
              <tr>
                <td className="py-2.5 px-3.5 text-left">
                  Total: {output.loggerResults.length} Sensors
                </td>
                <td className="py-2.5 px-2.5 text-center text-[10px] text-[#647184] dark:text-slate-400">
                  Hot/Cold
                </td>
                <td className="py-2.5 px-2.5 text-right tabular-nums">—</td>
                <td className="py-2.5 px-2.5 text-right tabular-nums text-[#2864dc] dark:text-blue-400 font-bold">
                  {output.globalTemperatureMean.toFixed(2)}
                </td>
                <td className="py-2.5 px-2.5 text-right tabular-nums">{globalLowest.toFixed(2)}</td>
                <td className="py-2.5 px-2.5 text-right tabular-nums">{globalHighest.toFixed(2)}</td>
                <td colSpan={5} className="py-2.5 px-3.5 text-right text-[#647184] dark:text-slate-400 text-[10px] font-normal tabular-nums">
                  Safe Range: {output.temperatureLimits.lower.toFixed(1)} to {output.temperatureLimits.upper.toFixed(1)} °C
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Interactive Temperature Chart */}
      <ThermalChart
        title="Temperature Distribution Over Study Window (°C)"
        studyName={output.studyName}
        unit="°C"
        limits={output.temperatureLimits}
        series={output.series.map((s) => ({
          equipmentCode: labelFor(s.equipmentCode),
          timestamps: s.timestamps,
          values: s.correctedTemperatures,
        }))}
        accentColor="#2864dc"
      />

      {/* Relative Humidity Results Table & Chart (When Applicable) */}
      {hasHumidity && humResults.length > 0 && (
        <>
          <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#edf0f4] dark:border-[#334155] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#059669]" />
                <h2 className="text-sm font-bold text-[#182330] dark:text-slate-100">
                  Relative Humidity Results Table (%RH)
                </h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-[#526071] dark:text-slate-300 tabular-nums">
                {output.globalHumidityMean !== null && (
                  <span>
                    Overall Mean:{' '}
                    <strong className="text-[#059669] dark:text-emerald-400">
                      {output.globalHumidityMean.toFixed(2)} %RH
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* Mobile Humidity Cards (< md) */}
            <div className="md:hidden divide-y divide-[#edf0f4] dark:divide-[#334155]">
              {humResults.map((item, idx) => {
                const hum = item.humidity!;
                const color = CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length];
                const isHigh = humResults.length > 1 && item.equipmentCode === output.humHighSpotCode;
                const isLow = humResults.length > 1 && item.equipmentCode === output.humLowSpotCode;
                const rowTint = isHigh
                  ? 'bg-[#fff5f5] dark:bg-red-950/25'
                  : isLow
                  ? 'bg-[#f0f7ff] dark:bg-sky-950/25'
                  : '';

                return (
                  <div key={item.equipmentCode} className={`p-3.5 space-y-2.5 ${rowTint}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-sm font-bold text-[#059669] dark:text-emerald-400 truncate">
                          {labelFor(item.equipmentCode)}
                        </span>
                        {isHigh && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#fee2e2] dark:bg-red-950/60 text-[#b91c1c] dark:text-red-300 shrink-0">
                            Highest RH
                          </span>
                        )}
                        {isLow && !isHigh && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#e0f2fe] dark:bg-sky-950/60 text-[#0369a1] dark:text-sky-300 shrink-0">
                            Lowest RH
                          </span>
                        )}
                      </div>
                      <span
                        className={`shrink-0 inline-block px-2 py-0.5 rounded text-[11px] font-bold tabular-nums ${
                          hum.in_range_percent < 100
                            ? 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                            : 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                        }`}
                      >
                        {Math.round(hum.in_range_percent)}% In-Range
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                      <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                        <span className="block text-[10px] text-[#788493] dark:text-slate-400">Mean</span>
                        <strong className="text-[#182330] dark:text-slate-100">{hum.mean.toFixed(2)}%</strong>
                      </div>
                      <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                        <span className="block text-[10px] text-[#788493] dark:text-slate-400">Min</span>
                        <strong className="text-[#182330] dark:text-slate-100">{hum.minimum.toFixed(2)}%</strong>
                      </div>
                      <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                        <span className="block text-[10px] text-[#788493] dark:text-slate-400">Max</span>
                        <strong className="text-[#182330] dark:text-slate-100">{hum.maximum.toFixed(2)}%</strong>
                      </div>
                      <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5">
                        <span className="block text-[10px] text-[#788493] dark:text-slate-400">Std Dev</span>
                        <strong className="text-[#182330] dark:text-slate-100">{hum.sample_standard_deviation.toFixed(3)}</strong>
                      </div>
                      <div className="bg-[#f8f9fb] dark:bg-[#0f172a] rounded-lg px-2.5 py-1.5 col-span-2">
                        <span className="block text-[10px] text-[#788493] dark:text-slate-400">Out-of-Range</span>
                        <strong className="text-[#182330] dark:text-slate-100">{hum.out_of_range_minutes.toFixed(1)} min</strong>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#526071] dark:text-slate-300 tabular-nums pt-0.5">
                      <span>Below: {hum.below_minutes.toFixed(1)}m ({Math.round(hum.below_percent)}%)</span>
                      <span>Above: {hum.above_minutes.toFixed(1)}m ({Math.round(hum.above_percent)}%)</span>
                    </div>
                  </div>
                );
              })}
              <div className="p-3.5 bg-[#f8f9fb] dark:bg-[#0f172a] flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-[#334155] dark:text-slate-200 tabular-nums">
                <span>Total: {humResults.length} Sensors</span>
                <span>
                  Mean <strong className="text-[#059669] dark:text-emerald-400">{output.globalHumidityMean !== null ? output.globalHumidityMean.toFixed(2) : '—'}%</strong> · Min {globalHumLowest.toFixed(2)}% · Max {globalHumHighest.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Desktop Humidity Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
                  <tr>
                    <th className="py-2.5 px-3.5 text-left">Sensor</th>
                    <th className="py-2.5 px-2.5 text-center">Spot</th>
                    <th className="py-2.5 px-2.5 text-right">Mean (%RH)</th>
                    <th className="py-2.5 px-2.5 text-right">Min (%RH)</th>
                    <th className="py-2.5 px-2.5 text-right">Max (%RH)</th>
                    <th className="py-2.5 px-2.5 text-right">Std Dev</th>
                    <th className="py-2.5 px-2.5 text-right">In-Range %</th>
                    <th className="py-2.5 px-2.5 text-right">Out-of-Range (min)</th>
                    <th className="py-2.5 px-2.5 text-right">Below Alert</th>
                    <th className="py-2.5 px-3.5 text-right">Above Alert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                  {humResults.map((item, idx) => {
                    const hum = item.humidity!;
                    const color = CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length];
                    const isHigh = humResults.length > 1 && item.equipmentCode === output.humHighSpotCode;
                    const isLow = humResults.length > 1 && item.equipmentCode === output.humLowSpotCode;

                    const rowTint = isHigh
                      ? 'bg-[#fff5f5] dark:bg-red-950/25'
                      : isLow
                      ? 'bg-[#f0f7ff] dark:bg-sky-950/25'
                      : 'hover:bg-[#fbfcfe] dark:hover:bg-[#0f172a]/50';

                    return (
                      <tr key={item.equipmentCode} className={`${rowTint} transition-colors`}>
                        <td className="py-2.5 px-3.5 text-left font-semibold text-[#182330] dark:text-slate-100 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span
                              className="text-[#059669] dark:text-emerald-400 font-semibold"
                              title={item.equipmentCode}
                            >
                              {labelFor(item.equipmentCode)}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-center whitespace-nowrap">
                          {isHigh && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#fee2e2] dark:bg-red-950/60 text-[#b91c1c] dark:text-red-300">
                              Highest RH
                            </span>
                          )}
                          {isLow && !isHigh && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#e0f2fe] dark:bg-sky-950/60 text-[#0369a1] dark:text-sky-300">
                              Lowest RH
                            </span>
                          )}
                          {!isHigh && !isLow && (
                            <span className="text-[11px] text-[#94a3b8] dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums font-semibold text-[#182330] dark:text-slate-100">
                          {hum.mean.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums text-[#334052] dark:text-slate-200">
                          {hum.minimum.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums text-[#334052] dark:text-slate-200">
                          {hum.maximum.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums text-[#526071] dark:text-slate-300">
                          {hum.sample_standard_deviation.toFixed(3)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              hum.in_range_percent < 100
                                ? 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                                : 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                            }`}
                          >
                            {Math.round(hum.in_range_percent)}%
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums font-medium text-[#334052] dark:text-slate-200">
                          {hum.out_of_range_minutes.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right tabular-nums text-[#526071] dark:text-slate-300 whitespace-nowrap">
                          {hum.below_minutes.toFixed(1)}m ({Math.round(hum.below_percent)}%)
                        </td>
                        <td className="py-2.5 px-3.5 text-right tabular-nums text-[#526071] dark:text-slate-300 whitespace-nowrap">
                          {hum.above_minutes.toFixed(1)}m ({Math.round(hum.above_percent)}%)
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-[#f8f9fb] dark:bg-[#0f172a] border-t border-[#e5e9ef] dark:border-[#334155] text-[#334155] dark:text-slate-200 font-semibold text-[11px]">
                  <tr>
                    <td className="py-2.5 px-3.5 text-left">
                      Total: {humResults.length} Sensors
                    </td>
                    <td className="py-2.5 px-2.5 text-center text-[10px] text-[#647184] dark:text-slate-400">
                      High/Low
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums text-[#059669] dark:text-emerald-400 font-bold">
                      {output.globalHumidityMean !== null ? output.globalHumidityMean.toFixed(2) : '—'}
                    </td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">{globalHumLowest.toFixed(2)}</td>
                    <td className="py-2.5 px-2.5 text-right tabular-nums">{globalHumHighest.toFixed(2)}</td>
                    <td colSpan={5} className="py-2.5 px-3.5 text-right text-[#647184] dark:text-slate-400 text-[10px] font-normal tabular-nums">
                      Safe Range: {humLimits.lower.toFixed(1)} to {humLimits.upper.toFixed(1)} %RH
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <ThermalChart
            title="Relative Humidity Distribution Over Study Window (%RH)"
            studyName={output.studyName}
            unit="%RH"
            limits={humLimits}
            series={output.series
              .filter((s) => s.correctedHumidities && s.correctedHumidities.length > 0)
              .map((s) => ({
                equipmentCode: labelFor(s.equipmentCode),
                timestamps: s.timestamps,
                values: s.correctedHumidities,
              }))}
            accentColor="#059669"
          />
        </>
      )}
    </div>
  );
};
