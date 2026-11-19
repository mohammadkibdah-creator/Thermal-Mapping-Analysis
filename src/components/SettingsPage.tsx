import React, { useState } from 'react';
import {
  AcceptancePreset,
  DEFAULT_ACCEPTANCE_PRESETS,
  SettingsMap,
} from '../store/metrologyStore.ts';
import { Plus, Trash2, Save, RotateCcw, Sliders, CheckCircle2, AlertCircle } from 'lucide-react';

interface SettingsPageProps {
  settings: SettingsMap;
  onSaveSettings: (updated: SettingsMap) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onSaveSettings }) => {
  const [presets, setPresets] = useState<AcceptancePreset[]>(
    settings.acceptance_presets && settings.acceptance_presets.length > 0
      ? settings.acceptance_presets
      : DEFAULT_ACCEPTANCE_PRESETS
  );
  const [defaultInterval, setDefaultInterval] = useState<string>(
    String(settings.default_sampling_interval_minutes ?? 15)
  );
  const [reportDir, setReportDir] = useState<string>(settings.report_directory || '');
  const [sessionTimeout, setSessionTimeout] = useState<string>(settings.session_timeout_minutes || '30');

  // New preset builder state
  const [newName, setNewName] = useState('');
  const [newTempLower, setNewTempLower] = useState('');
  const [newTempUpper, setNewTempUpper] = useState('');
  const [newHumLower, setNewHumLower] = useState('');
  const [newHumUpper, setNewHumUpper] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const handleAddPreset = () => {
    setError(null);
    const name = newName.trim();
    const tLow = parseFloat(newTempLower);
    const tHigh = parseFloat(newTempUpper);

    if (!name) {
      setError('Preset name is required (e.g., "2–8 °C Cold Chain").');
      return;
    }
    if (!Number.isFinite(tLow) || !Number.isFinite(tHigh)) {
      setError('Temperature lower and upper limits must be valid numbers.');
      return;
    }
    if (tLow >= tHigh) {
      setError('Temperature lower limit must be strictly less than upper limit.');
      return;
    }

    let hLow: number | undefined;
    let hHigh: number | undefined;
    if (newHumLower.trim() !== '' || newHumUpper.trim() !== '') {
      hLow = parseFloat(newHumLower);
      hHigh = parseFloat(newHumUpper);
      if (!Number.isFinite(hLow) || !Number.isFinite(hHigh) || hLow < 0 || hHigh > 100 || hLow >= hHigh) {
        setError('If RH limits are specified, lower must be < upper and within 0–100 %RH.');
        return;
      }
    }

    const added: AcceptancePreset = {
      id: `preset_${Date.now()}`,
      name,
      tempLower: tLow,
      tempUpper: tHigh,
      humLower: hLow,
      humUpper: hHigh,
    };

    const nextPresets = [...presets, added];
    setPresets(nextPresets);
    setNewName('');
    setNewTempLower('');
    setNewTempUpper('');
    setNewHumLower('');
    setNewHumUpper('');
  };

  const handleDeletePreset = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveAll = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedNotice(null);

    const intervalNum = parseInt(defaultInterval, 10);
    if (!Number.isFinite(intervalNum) || intervalNum < 1 || intervalNum > 1440) {
      setError('Default sampling interval must be a whole number between 1 and 1440 minutes.');
      return;
    }

    const timeoutNum = parseInt(sessionTimeout, 10);
    if (!Number.isFinite(timeoutNum) || timeoutNum < 1) {
      setError('Session timeout must be at least 1 minute.');
      return;
    }

    if (presets.length === 0) {
      setError('At least one acceptance limit preset is required.');
      return;
    }

    onSaveSettings({
      ...settings,
      acceptance_presets: presets,
      default_sampling_interval_minutes: intervalNum,
      report_directory: reportDir.trim(),
      session_timeout_minutes: String(timeoutNum),
    });

    setSavedNotice('Settings saved successfully.');
    setTimeout(() => setSavedNotice(null), 4000);
  };

  const handleResetPresets = () => {
    setPresets(DEFAULT_ACCEPTANCE_PRESETS);
    setDefaultInterval('15');
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-bold text-[#5275ad] dark:text-blue-400 mb-1">
            Configuration
          </p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#182330] dark:text-slate-100 tracking-tight">
            Study Settings & Presets
          </h1>
          <p className="text-xs text-[#647184] dark:text-slate-400 mt-0.5">
            Manage acceptance limit presets, default sampling interval, and workspace preferences.
          </p>
        </div>

        <button
          type="button"
          onClick={handleResetPresets}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs font-semibold text-[#526071] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Restore Defaults</span>
        </button>
      </section>

      {error && (
        <div className="p-3.5 rounded-xl bg-[#fff0ed] dark:bg-red-950/40 border border-[#fed7d0] dark:border-red-900 text-[#bd4d42] dark:text-red-300 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-[#e8f5ed] dark:bg-emerald-950/40 border border-[#c1e7ce] dark:border-emerald-900 text-[#1b6b3e] dark:text-emerald-300 text-xs flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="font-medium">{savedNotice}</span>
        </div>
      )}

      <form onSubmit={handleSaveAll} className="space-y-6">
        {/* General Study Defaults */}
        <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[#edf0f4] dark:border-[#334155]">
            <Sliders className="w-4 h-4 text-[#2864dc]" />
            <h2 className="text-sm font-bold text-[#182330] dark:text-slate-100">
              Sampling & Workspace Defaults
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Default Sampling Interval (minutes)
              <input
                type="number"
                min={1}
                max={1440}
                value={defaultInterval}
                onChange={(e) => setDefaultInterval(e.target.value)}
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
              />
              <span className="block text-[11px] font-normal text-[#788493] dark:text-slate-400 mt-1">
                Used as initial fallback interval when creating new thermal mapping studies.
              </span>
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Default Report Directory Reference
              <input
                type="text"
                value={reportDir}
                onChange={(e) => setReportDir(e.target.value)}
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
              />
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Session Timeout (minutes)
              <input
                type="number"
                min={1}
                value={sessionTimeout}
                onChange={(e) => setSessionTimeout(e.target.value)}
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
              />
            </label>
          </div>
        </section>

        {/* Acceptance Limit Presets */}
        <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#edf0f4] dark:border-[#334155]">
            <div>
              <h2 className="text-sm font-bold text-[#182330] dark:text-slate-100">
                Acceptance Limit Presets
              </h2>
              <p className="text-[11px] text-[#788493] dark:text-slate-400">
                Quick-apply temperature and humidity acceptance ranges in Study Setup.
              </p>
            </div>
            <span className="text-xs font-semibold text-[#2864dc] tabular-nums">
              {presets.length} presets
            </span>
          </div>

          <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
                <tr>
                  <th className="py-2.5 px-3.5">Preset Label</th>
                  <th className="py-2.5 px-3 text-right">Temp Lower (°C)</th>
                  <th className="py-2.5 px-3 text-right">Temp Upper (°C)</th>
                  <th className="py-2.5 px-3 text-right">RH Lower (%RH)</th>
                  <th className="py-2.5 px-3 text-right">RH Upper (%RH)</th>
                  <th className="py-2.5 px-3.5 text-right w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                {presets.map((p) => (
                  <tr key={p.id} className="hover:bg-[#fbfcfe] dark:hover:bg-[#0f172a]/50">
                    <td className="py-2.5 px-3.5 font-semibold text-[#182330] dark:text-slate-100">
                      {p.name}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#334052] dark:text-slate-300">
                      {p.tempLower.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#334052] dark:text-slate-300">
                      {p.tempUpper.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#647184] dark:text-slate-400">
                      {p.humLower !== undefined ? p.humLower.toFixed(1) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#647184] dark:text-slate-400">
                      {p.humUpper !== undefined ? p.humUpper.toFixed(1) : '—'}
                    </td>
                    <td className="py-2.5 px-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeletePreset(p.id)}
                        disabled={presets.length <= 1}
                        title="Delete preset"
                        className="p-1.5 rounded-lg text-[#bd4d42] hover:bg-[#fff0ed] dark:hover:bg-red-950/40 disabled:opacity-30 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add Preset Row */}
          <div className="p-3.5 rounded-xl bg-[#f8f9fb] dark:bg-[#0f172a] border border-[#e5e9ef] dark:border-[#334155] space-y-3">
            <p className="text-xs font-bold text-[#182330] dark:text-slate-100">Add New Acceptance Preset</p>
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end">
              <label className="sm:col-span-2 text-[11px] font-semibold text-[#526071] dark:text-slate-400">
                Preset Name
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Ultra-Low (-80 to -60°C)"
                  className="mt-1 w-full h-9 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                />
              </label>
              <label className="text-[11px] font-semibold text-[#526071] dark:text-slate-400">
                Min °C
                <input
                  type="number"
                  step="any"
                  value={newTempLower}
                  onChange={(e) => setNewTempLower(e.target.value)}
                  placeholder="2.0"
                  className="mt-1 w-full h-9 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc]"
                />
              </label>
              <label className="text-[11px] font-semibold text-[#526071] dark:text-slate-400">
                Max °C
                <input
                  type="number"
                  step="any"
                  value={newTempUpper}
                  onChange={(e) => setNewTempUpper(e.target.value)}
                  placeholder="8.0"
                  className="mt-1 w-full h-9 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc]"
                />
              </label>
              <label className="text-[11px] font-semibold text-[#526071] dark:text-slate-400">
                Min %RH (opt)
                <input
                  type="number"
                  step="any"
                  value={newHumLower}
                  onChange={(e) => setNewHumLower(e.target.value)}
                  placeholder="30"
                  className="mt-1 w-full h-9 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc]"
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex-1 text-[11px] font-semibold text-[#526071] dark:text-slate-400">
                  Max %RH
                  <input
                    type="number"
                    step="any"
                    value={newHumUpper}
                    onChange={(e) => setNewHumUpper(e.target.value)}
                    placeholder="65"
                    className="mt-1 w-full h-9 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc]"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleAddPreset}
                  className="h-9 px-3 rounded-lg bg-[#edf3ff] dark:bg-blue-950/60 text-[#2864dc] dark:text-blue-400 border border-[#dce6f7] dark:border-blue-800 text-xs font-semibold hover:bg-[#dce6f7] cursor-pointer inline-flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Save Bar */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] shadow-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2864dc]/40"
          >
            <Save className="w-4 h-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
};
