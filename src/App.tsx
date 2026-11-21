import { useState, useEffect, useRef } from 'react';
import {
  AppState,
  getInitialState,
  saveState,
  EquipmentRecord,
  SensorKitRecord,
  SuperDaqSensorRecord,
  SettingsMap,
} from './store/metrologyStore.ts';
import { Header, ActiveTab } from './components/Header.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { EquipmentList } from './components/EquipmentList.tsx';
import { SensorKitList } from './components/SensorKitList.tsx';
import { StudyWorkspace } from './components/StudyWorkspace.tsx';
import { ResultsPreview } from './components/ResultsPreview.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { isSessionAuthorized, revokeSessionAccess } from './utils/accessGate.ts';
import { StudyAnalysisOutput } from './utils/importers.ts';
import { formatDateTimeDDMMYYYY } from './utils/dateFormat.ts';
import {
  syncAllSheetsData,
  saveEquipmentToRemoteSheet,
  deleteEquipmentFromRemoteSheet,
  saveKitToRemoteSheet,
  deleteKitFromRemoteSheet,
  saveSensorToRemoteSheet,
  deleteSensorFromRemoteSheet,
} from './services/sheetService.ts';
import { Database, RefreshCw, RotateCcw } from 'lucide-react';

const THEME_STORAGE_KEY = 'thermal_mapping_theme';

interface ToastState {
  message: string;
  type: 'success' | 'info' | 'error';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => isSessionAuthorized());
  const [state, setState] = useState<AppState>(getInitialState);
  const [activeTab, setActiveTab] = useState<ActiveTab | 'results'>('dashboard');
  const [studyInitialStep, setStudyInitialStep] = useState<1 | 2 | 3>(1);
  const [analysisResults, setAnalysisResults] = useState<StudyAnalysisOutput | null>(null);
  const [presetSampleType, setPresetSampleType] = useState<'data_logger' | 'superdaq' | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<{
    lastSync: Date | null;
    success: boolean;
    error?: string;
  }>({
    lastSync: null,
    success: true,
  });

  // Dark mode state synced with <html class="dark">
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (
    message: string,
    type: 'success' | 'info' | 'error' = 'info',
    duration = 5000,
    action?: { label: string; onClick: () => void }
  ) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type, action });
    toastTimerRef.current = setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, duration);
  };

  // Sync state to local storage on changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Equipment handlers
  const handleSaveEquipment = async (record: EquipmentRecord) => {
    const normCode = record.equipment_code.trim().toUpperCase();
    const cleanRecord: EquipmentRecord = {
      ...record,
      equipment_code: normCode,
    };

    setState((prev) => {
      const idx = prev.equipment.findIndex((e) => e.equipment_code.trim().toUpperCase() === normCode);
      const updated = [...prev.equipment];
      if (idx >= 0) {
        updated[idx] = cleanRecord;
      } else {
        updated.unshift(cleanRecord);
      }
      const cleanDeleted = (prev.deleted_equipment_codes || []).filter((c) => c.toUpperCase() !== normCode);
      const next: AppState = {
        ...prev,
        equipment: updated,
        deleted_equipment_codes: cleanDeleted,
      };
      saveState(next);
      return next;
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      showToast(`Saving ${normCode} to Google Sheets...`, 'info', 3000);
      try {
        const res = await saveEquipmentToRemoteSheet(cleanRecord, webAppUrl);
        if (res.success) {
          showToast(`Equipment ${normCode} and calibration points saved to Google Sheets.`, 'success');
        } else {
          showToast(`Saved locally. Google Sheets notice: ${res.message}`, 'error', 7000);
        }
      } catch (err: unknown) {
        showToast(
          `Saved locally. Could not reach Google Sheets: ${err instanceof Error ? err.message : String(err)}`,
          'error',
          6000
        );
      }
    } else {
      showToast(`Equipment ${normCode} saved locally.`, 'success', 5000);
    }
  };

  // Restore deleted equipment items (for Undo toast)
  const handleRestoreEquipment = async (records: EquipmentRecord[]) => {
    if (records.length === 0) return;
    const restoredCodes = new Set(records.map((r) => r.equipment_code.trim().toUpperCase()));

    setState((prev) => {
      const existing = new Set(prev.equipment.map((e) => e.equipment_code.trim().toUpperCase()));
      const additions = records.filter((r) => !existing.has(r.equipment_code.trim().toUpperCase()));
      const next: AppState = {
        ...prev,
        equipment: [...additions, ...prev.equipment],
        deleted_equipment_codes: (prev.deleted_equipment_codes || []).filter(
          (c) => !restoredCodes.has(c.toUpperCase())
        ),
      };
      saveState(next);
      return next;
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      for (const rec of records) {
        try {
          await saveEquipmentToRemoteSheet(rec, webAppUrl);
        } catch {
          // Ignore individual network failures during restore
        }
      }
    }
    showToast(`Restored ${records.length} data logger record(s).`, 'success', 4000);
  };

  // Single & bulk delete with Undo support
  const handleDeleteEquipment = async (codes: string[]) => {
    const normSet = new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
    if (normSet.size === 0) return;

    const deletedSnapshot = state.equipment.filter((e) =>
      normSet.has(e.equipment_code.trim().toUpperCase())
    );

    setState((prev) => {
      const next: AppState = {
        ...prev,
        equipment: prev.equipment.filter(
          (e) => !normSet.has(e.equipment_code.trim().toUpperCase())
        ),
        deleted_equipment_codes: Array.from(
          new Set([...(prev.deleted_equipment_codes || []), ...Array.from(normSet)])
        ),
      };
      saveState(next);
      return next;
    });

    const label =
      deletedSnapshot.length === 1
        ? `Deleted ${deletedSnapshot[0].equipment_code}.`
        : `Deleted ${normSet.size} data loggers.`;

    showToast(label, 'info', 8000, {
      label: 'Undo',
      onClick: () => handleRestoreEquipment(deletedSnapshot),
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      for (const code of normSet) {
        try {
          await deleteEquipmentFromRemoteSheet(code, webAppUrl);
        } catch {
          // Non-blocking remote delete; local deletion already committed
        }
      }
    }
  };

  const handleImportEquipment = (records: EquipmentRecord[]) => {
    setState((prev) => {
      const existingCodes = new Set(prev.equipment.map((e) => e.equipment_code.toUpperCase()));
      const newItems = records.filter((r) => !existingCodes.has(r.equipment_code.toUpperCase()));
      const next: AppState = {
        ...prev,
        equipment: [...newItems, ...prev.equipment],
      };
      saveState(next);
      return next;
    });
    showToast(`Successfully imported ${records.length} instruments.`, 'success');
  };

  // Sensor Kit handlers
  const handleSaveKit = async (kit: SensorKitRecord) => {
    const normCode = kit.kit_code.trim().toUpperCase();
    const cleanKit: SensorKitRecord = { ...kit, kit_code: normCode };

    setState((prev) => {
      const kitMap = new Map<string, SensorKitRecord>();
      prev.sensor_kits.forEach((k) => kitMap.set(k.kit_code.toUpperCase(), k));
      kitMap.set(normCode, cleanKit);
      const cleanDeleted = (prev.deleted_kit_codes || []).filter((c) => c.toUpperCase() !== normCode);
      const next: AppState = {
        ...prev,
        sensor_kits: Array.from(kitMap.values()),
        deleted_kit_codes: cleanDeleted,
      };
      saveState(next);
      return next;
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      try {
        const res = await saveKitToRemoteSheet(cleanKit, webAppUrl);
        if (res.success) {
          showToast(`Kit ${cleanKit.name} saved to Google Sheets.`, 'success');
        }
      } catch {
        // Ignore remote notice
      }
    } else {
      showToast(`Kit ${cleanKit.name} saved locally.`, 'info');
    }
  };

  const handleDeleteKit = async (kitCode: string) => {
    const normCode = kitCode.trim().toUpperCase();
    const kitObj = state.sensor_kits.find((k) => k.kit_code.toUpperCase() === normCode);
    const kitName = kitObj?.name || '';
    const kitSn = kitObj?.serial_number || normCode.replace(/^KIT_/, '');

    setState((prev) => {
      const nextKits = prev.sensor_kits.filter((k) => {
        if (k.kit_code.toUpperCase() === normCode) return false;
        if (kitName && k.name.trim().toLowerCase() === kitName.trim().toLowerCase()) return false;
        if (kitSn && k.serial_number && k.serial_number.trim() === kitSn.trim()) return false;
        return true;
      });

      const nextSensors = prev.superdaq_sensors.filter((s) => s.kit_code.toUpperCase() !== normCode);

      const next: AppState = {
        ...prev,
        sensor_kits: nextKits,
        superdaq_sensors: nextSensors,
        deleted_kit_codes: Array.from(
          new Set([...(prev.deleted_kit_codes || []), normCode, kitSn.toUpperCase()])
        ),
      };
      saveState(next);
      return next;
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      try {
        await deleteKitFromRemoteSheet(normCode, kitSn, kitName, webAppUrl);
        showToast(`Kit ${kitName || normCode} deleted from Google Sheets.`, 'success');
      } catch {
        showToast(`Kit deleted locally.`, 'info');
      }
    } else {
      showToast(`Kit deleted from application.`, 'info');
    }
  };

  const handleSaveSensor = async (sensor: SuperDaqSensorRecord) => {
    const normCode = sensor.sensor_code.trim().toUpperCase();
    const cleanSensor: SuperDaqSensorRecord = {
      ...sensor,
      sensor_code: normCode,
      updated_at: new Date().toISOString(),
    };

    setState((prev) => {
      const sensorMap = new Map<string, SuperDaqSensorRecord>();
      prev.superdaq_sensors.forEach((s) => sensorMap.set(s.sensor_code.toUpperCase(), s));
      sensorMap.set(normCode, cleanSensor);
      const cleanDeleted = (prev.deleted_sensor_codes || []).filter((c) => c.toUpperCase() !== normCode);
      const next: AppState = {
        ...prev,
        superdaq_sensors: Array.from(sensorMap.values()),
        deleted_sensor_codes: cleanDeleted,
      };
      saveState(next);
      return next;
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      try {
        const parentKit = state.sensor_kits.find(
          (k) => k.kit_code.toUpperCase() === cleanSensor.kit_code.toUpperCase()
        );
        const res = await saveSensorToRemoteSheet(cleanSensor, parentKit?.name, webAppUrl);
        if (res.success) {
          showToast(`Sensor ${cleanSensor.channel_identifier} saved to Google Sheets.`, 'success');
        }
      } catch {
        // Ignore remote error
      }
    } else {
      showToast(`Sensor ${cleanSensor.channel_identifier} saved locally.`, 'info');
    }
  };

  const handleRestoreSensors = async (records: SuperDaqSensorRecord[]) => {
    if (records.length === 0) return;
    const restoredSet = new Set(records.map((r) => r.sensor_code.trim().toUpperCase()));

    setState((prev) => {
      const existing = new Set(prev.superdaq_sensors.map((s) => s.sensor_code.trim().toUpperCase()));
      const additions = records.filter((r) => !existing.has(r.sensor_code.trim().toUpperCase()));
      const next: AppState = {
        ...prev,
        superdaq_sensors: [...additions, ...prev.superdaq_sensors],
        deleted_sensor_codes: (prev.deleted_sensor_codes || []).filter(
          (c) => !restoredSet.has(c.toUpperCase())
        ),
      };
      saveState(next);
      return next;
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl) {
      for (const rec of records) {
        try {
          const parentKit = state.sensor_kits.find(
            (k) => k.kit_code.toUpperCase() === rec.kit_code.toUpperCase()
          );
          await saveSensorToRemoteSheet(rec, parentKit?.name, webAppUrl);
        } catch {
          // Ignore individual restore network failures
        }
      }
    }
    showToast(`Restored ${records.length} SuperDAQ sensor(s).`, 'success', 4000);
  };

  const handleDeleteSensors = async (sensorCodes: string[]) => {
    const normSet = new Set(sensorCodes.map((c) => c.trim().toUpperCase()).filter(Boolean));
    if (normSet.size === 0) return;

    const deletedSnapshot = state.superdaq_sensors.filter((s) =>
      normSet.has(s.sensor_code.trim().toUpperCase())
    );

    setState((prev) => {
      const next: AppState = {
        ...prev,
        superdaq_sensors: prev.superdaq_sensors.filter(
          (s) => !normSet.has(s.sensor_code.trim().toUpperCase())
        ),
        deleted_sensor_codes: Array.from(
          new Set([...(prev.deleted_sensor_codes || []), ...Array.from(normSet)])
        ),
      };
      saveState(next);
      return next;
    });

    const label =
      deletedSnapshot.length === 1
        ? `Deleted sensor ${deletedSnapshot[0].channel_identifier}.`
        : `Deleted ${normSet.size} SuperDAQ sensors.`;

    showToast(label, 'info', 8000, {
      label: 'Undo',
      onClick: () => handleRestoreSensors(deletedSnapshot),
    });

    const webAppUrl = state.settings.google_sheets_web_app_url?.trim();
    if (webAppUrl && deletedSnapshot.length > 0) {
      for (const s of deletedSnapshot) {
        try {
          const parentKit = state.sensor_kits.find(
            (k) => k.kit_code.toUpperCase() === s.kit_code.toUpperCase()
          );
          await deleteSensorFromRemoteSheet(
            s.sensor_code.trim().toUpperCase(),
            s.channel_identifier,
            parentKit?.name,
            webAppUrl
          );
        } catch {
          // Non-blocking remote delete
        }
      }
    }
  };

  const handleImportKitWithSensors = (kit: SensorKitRecord, newSensors: SuperDaqSensorRecord[]) => {
    setState((prev) => {
      const kitMap = new Map<string, SensorKitRecord>();
      prev.sensor_kits.forEach((k) => kitMap.set(k.kit_code, k));
      kitMap.set(kit.kit_code, kit);

      const sensorMap = new Map<string, SuperDaqSensorRecord>();
      prev.superdaq_sensors.forEach((s) => sensorMap.set(s.sensor_code, s));
      newSensors.forEach((s) => sensorMap.set(s.sensor_code, s));

      const next: AppState = {
        ...prev,
        sensor_kits: Array.from(kitMap.values()),
        superdaq_sensors: Array.from(sensorMap.values()),
      };
      saveState(next);
      return next;
    });
  };

  // Google Sheets master data sync handler
  const handleTriggerSync = async (sheetIdOverride?: string) => {
    const targetSheetId = (sheetIdOverride || state.settings.google_sheets_id)?.trim();
    if (!targetSheetId) return;

    setIsSyncing(true);
    try {
      const res = await syncAllSheetsData(targetSheetId);
      setState((prev) => {
        const deletedEq = new Set((prev.deleted_equipment_codes || []).map((c) => c.toUpperCase()));
        const deletedKits = new Set((prev.deleted_kit_codes || []).map((c) => c.toUpperCase()));
        const deletedSensors = new Set((prev.deleted_sensor_codes || []).map((c) => c.toUpperCase()));

        const now = Date.now();
        const isRecentlyAdded = (updatedAtStr?: string) => {
          if (!updatedAtStr) return false;
          const diff = now - new Date(updatedAtStr).getTime();
          return diff >= 0 && diff < 25000;
        };

        const eqMap = new Map<string, EquipmentRecord>();
        if (res.equipment && res.equipment.length > 0) {
          res.equipment.forEach((remoteEq) => {
            const code = remoteEq.equipment_code.trim().toUpperCase();
            if (!deletedEq.has(code)) {
              eqMap.set(code, remoteEq);
            }
          });
          prev.equipment.forEach((localEq) => {
            const code = localEq.equipment_code.trim().toUpperCase();
            if (!deletedEq.has(code) && !eqMap.has(code) && isRecentlyAdded(localEq.updated_at)) {
              eqMap.set(code, localEq);
            }
          });
        } else {
          prev.equipment.forEach((e) => {
            const code = e.equipment_code.trim().toUpperCase();
            if (!deletedEq.has(code)) eqMap.set(code, e);
          });
        }

        const kitMap = new Map<string, SensorKitRecord>();
        if (res.sensorKits && res.sensorKits.length > 0) {
          res.sensorKits.forEach((remoteKit) => {
            const code = remoteKit.kit_code.trim().toUpperCase();
            if (!deletedKits.has(code)) {
              kitMap.set(code, remoteKit);
            }
          });
          prev.sensor_kits.forEach((localKit) => {
            const code = localKit.kit_code.trim().toUpperCase();
            if (!deletedKits.has(code) && !kitMap.has(code) && isRecentlyAdded(localKit.updated_at)) {
              kitMap.set(code, localKit);
            }
          });
        } else {
          prev.sensor_kits.forEach((k) => {
            const code = k.kit_code.trim().toUpperCase();
            if (!deletedKits.has(code)) kitMap.set(code, k);
          });
        }

        const sensorMap = new Map<string, SuperDaqSensorRecord>();
        if (res.sensors && res.sensors.length > 0) {
          res.sensors.forEach((remoteSensor) => {
            const code = remoteSensor.sensor_code.trim().toUpperCase();
            if (!deletedSensors.has(code)) {
              sensorMap.set(code, remoteSensor);
            }
          });
          prev.superdaq_sensors.forEach((localSensor) => {
            const code = localSensor.sensor_code.trim().toUpperCase();
            if (!deletedSensors.has(code) && !sensorMap.has(code) && isRecentlyAdded(localSensor.updated_at)) {
              sensorMap.set(code, localSensor);
            }
          });
        } else {
          prev.superdaq_sensors.forEach((s) => {
            const code = s.sensor_code.trim().toUpperCase();
            if (!deletedSensors.has(code)) sensorMap.set(code, s);
          });
        }

        const nextSettings: SettingsMap = {
          ...prev.settings,
          ...(res.settings || {}),
          google_sheets_id: targetSheetId,
          google_sheets_last_sync: res.syncedAt,
          acceptance_presets: prev.settings.acceptance_presets,
          default_sampling_interval_minutes: prev.settings.default_sampling_interval_minutes,
        };

        const nextState: AppState = {
          ...prev,
          equipment: Array.from(eqMap.values()),
          sensor_kits: Array.from(kitMap.values()),
          superdaq_sensors: Array.from(sensorMap.values()),
          settings: nextSettings,
        };

        saveState(nextState);
        return nextState;
      });
      setSyncStatus({
        lastSync: new Date(),
        success: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncStatus((prev) => ({
        lastSync: prev.lastSync,
        success: false,
        error: msg,
      }));
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    const sheetId = state.settings.google_sheets_id?.trim();
    const isAutoSyncEnabled = state.settings.google_sheets_sync_enabled !== false;
    if (!sheetId || !isAutoSyncEnabled) return;

    handleTriggerSync(sheetId).catch(() => {});

    const intervalTimer = setInterval(() => {
      handleTriggerSync(sheetId).catch(() => {});
    }, 60000);

    return () => clearInterval(intervalTimer);
  }, [isAuthenticated, state.settings.google_sheets_id, state.settings.google_sheets_sync_enabled]);

  const handleLogout = () => {
    revokeSessionAccess();
    setIsAuthenticated(false);
    setActiveTab('dashboard');
    setAnalysisResults(null);
  };

  const handleLaunchSampleStudy = (sampleType: 'data_logger' | 'superdaq') => {
    setPresetSampleType(sampleType);
    setStudyInitialStep(3);
    setActiveTab('study');
  };

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onAuthenticated={() => setIsAuthenticated(true)}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((d) => !d)}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f7fa] dark:bg-[#0f172a] text-[#182330] dark:text-slate-100 transition-colors">
      {/* Slim Sticky Header */}
      <Header
        activeTab={activeTab === 'results' ? 'study' : activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'study') setAnalysisResults(null);
          if (tab === 'study') setStudyInitialStep(1);
        }}
        applicationName={state.settings.application_name}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode((d) => !d)}
        onLogout={handleLogout}
      />

      {/* Main Page Body */}
      <main className="flex-1 max-w-[1680px] w-full mx-auto px-3 sm:px-5 md:px-8 xl:px-10 py-4 sm:py-6 lg:py-8">
        {activeTab === 'dashboard' && (
          <Dashboard
            state={state}
            setActiveTab={(tab) => {
              if (tab === 'study') setStudyInitialStep(1);
              setActiveTab(tab);
            }}
            onLaunchSampleStudy={handleLaunchSampleStudy}
          />
        )}

        {activeTab === 'equipment' && (
          <EquipmentList
            equipment={state.equipment}
            onSaveEquipment={handleSaveEquipment}
            onDeleteEquipment={handleDeleteEquipment}
            onImportEquipment={handleImportEquipment}
          />
        )}

        {activeTab === 'sensor_kits' && (
          <SensorKitList
            kits={state.sensor_kits}
            sensors={state.superdaq_sensors}
            onSaveKit={handleSaveKit}
            onDeleteKit={handleDeleteKit}
            onSaveSensor={handleSaveSensor}
            onDeleteSensors={handleDeleteSensors}
            onImportKitWithSensors={handleImportKitWithSensors}
          />
        )}

        {activeTab === 'study' && (
          <StudyWorkspace
            equipment={state.equipment}
            sensorKits={state.sensor_kits}
            sensors={state.superdaq_sensors}
            defaultSamplingIntervalMinutes={state.settings.default_sampling_interval_minutes}
            initialStep={studyInitialStep}
            onAnalysisComplete={(output) => {
              setAnalysisResults(output);
              setActiveTab('results');
            }}
            presetSampleType={presetSampleType}
            onClearPresetSample={() => setPresetSampleType(null)}
          />
        )}

        {activeTab === 'results' && analysisResults && (
          <ResultsPreview
            output={analysisResults}
            onBackToStudy={() => {
              setStudyInitialStep(3);
              setActiveTab('study');
            }}
            onJumpToStep={(step) => {
              setStudyInitialStep(step);
              setActiveTab('study');
            }}
            onFinish={() => {
              setAnalysisResults(null);
              setStudyInitialStep(1);
              setActiveTab('dashboard');
            }}
          />
        )}
      </main>

      {/* Institutional Footer */}
      <footer className="border-t border-[#e5e9ef] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs text-[#647184] dark:text-slate-400 py-3 lg:py-3.5 pb-safe sm:pb-3 lg:pb-3.5 px-3 sm:px-5 md:px-8 xl:px-10 mt-auto transition-colors">
        <div className="max-w-[1680px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2 text-[11px] sm:text-xs text-[#526071] dark:text-slate-300 leading-relaxed">
            <span>© 2026 Eng. Mohammad Ibdah. All rights reserved. Thermal Mapping Analysis Version 1.0.0</span>
          </div>

          {/* Database Status */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTriggerSync().catch(() => {})}
              disabled={isSyncing}
              title={
                syncStatus.error
                  ? `Database sync notice: ${syncStatus.error}. Click to retry.`
                  : syncStatus.lastSync
                  ? `Database synced at ${formatDateTimeDDMMYYYY(syncStatus.lastSync)}. Click to sync now.`
                  : 'Click to sync master data from central database'
              }
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                syncStatus.error
                  ? 'border-[#fde8c2] dark:border-amber-800 bg-[#fffcf5] dark:bg-amber-950/30 text-[#94620c] dark:text-amber-300 hover:bg-[#fff7e6]'
                  : 'border-[#e5e9ef] dark:border-[#334155] bg-[#f8f9fb] dark:bg-[#0f172a] text-[#526071] dark:text-slate-300 hover:bg-[#f0f3f7] dark:hover:bg-[#334155]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${syncStatus.error ? 'bg-[#d97706]' : 'bg-[#10b981]'}`}
              />
              <Database
                className={`w-3.5 h-3.5 ${syncStatus.error ? 'text-[#d97706]' : 'text-[#059669]'}`}
              />
              <RefreshCw
                className={`w-3 h-3 text-[#788493] ${isSyncing ? 'animate-spin text-[#2864dc]' : ''}`}
              />
              <span>
                {isSyncing
                  ? 'Database Syncing...'
                  : syncStatus.error
                  ? 'Database Sync Notice'
                  : 'Database Connected'}
              </span>
              {syncStatus.lastSync && !isSyncing && (
                <span className="text-[10px] text-[#8896a6] dark:text-slate-400 tabular-nums hidden md:inline">
                  · Synced {formatDateTimeDDMMYYYY(syncStatus.lastSync)}
                </span>
              )}
            </button>
          </div>
        </div>
      </footer>

      {/* Toast Notification with Optional Undo Action */}
      {toast && (
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:bottom-5 sm:right-5 z-50 sm:max-w-md">
          <div
            className={`p-3.5 rounded-xl shadow-xl border flex items-center gap-3 backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-[#e8f5ed]/95 dark:bg-emerald-950/95 border-[#c1e7ce] dark:border-emerald-800 text-[#1b6b3e] dark:text-emerald-200'
                : toast.type === 'error'
                ? 'bg-[#fff0ed]/95 dark:bg-red-950/95 border-[#fed7d0] dark:border-red-800 text-[#bd4d42] dark:text-red-200'
                : 'bg-[#182330]/95 border-[#334155] text-white'
            }`}
          >
            <div className="text-xs font-semibold leading-relaxed flex-1">{toast.message}</div>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  const act = toast.action;
                  setToast(null);
                  act?.onClick();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2864dc] text-white text-xs font-bold hover:bg-[#1e4fae] cursor-pointer shrink-0 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{toast.action.label}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-current opacity-60 hover:opacity-100 p-0.5 cursor-pointer text-xs shrink-0"
              aria-label="Close notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
