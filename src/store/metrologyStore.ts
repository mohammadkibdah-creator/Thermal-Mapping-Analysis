import initialData from '../initial_data.json';
import { CorrectionPoint, CorrectionConvention } from '../utils/metrology.ts';

export const HARDCODED_GOOGLE_SHEETS_ID = '1x7A067pHQUIBa1JyNvOJsnPj3BqrrIyw1mn2gYvylpM';
export const HARDCODED_GOOGLE_SHEETS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbx2Btf1pjqYXJEQAdt9_nErgbCC6D5EuO5BffMVSj5VKhAqAzTJw8GIT8zdagF_3qM8MA/exec';

export interface EquipmentRecord {
  equipment_code: string;
  description: string;
  serial_number: string;
  manufacturer: string;
  traceability: string;
  temperature_enabled: number;
  humidity_enabled: number;
  notes: string;
  calibration_date: string;
  due_date: string;
  temperature_convention: CorrectionConvention | '';
  temperature_points_json: string;
  humidity_convention: CorrectionConvention | '';
  humidity_points_json: string;
  updated_at: string;
}

export interface SensorKitRecord {
  kit_code: string;
  name: string;
  serial_number: string;
  status: 'Active' | 'Inactive';
  notes: string;
  updated_at: string;
}

export interface SuperDaqSensorRecord {
  sensor_code: string;
  kit_code: string;
  name: string;
  channel_identifier: string;
  serial_number: string;
  position: string;
  calibration_date: string;
  due_date: string;
  certificate_number: string;
  provider: string;
  traceability: string;
  temperature_convention: CorrectionConvention | '';
  temperature_points_json: string;
  notes: string;
  updated_at: string;
}

export interface AcceptancePreset {
  id: string;
  name: string;
  tempLower: number;
  tempUpper: number;
  humLower?: number;
  humUpper?: number;
}

export const DEFAULT_ACCEPTANCE_PRESETS: AcceptancePreset[] = [
  {
    id: 'preset_2_8',
    name: '2–8 °C (Refrigerated Storage)',
    tempLower: 2,
    tempUpper: 8,
    humLower: 30,
    humUpper: 65,
  },
  {
    id: 'preset_15_25',
    name: '15–25 °C (Controlled Room Temp)',
    tempLower: 15,
    tempUpper: 25,
    humLower: 30,
    humUpper: 65,
  },
  {
    id: 'preset_minus_20',
    name: '-20 °C Freezer (-25 to -15 °C)',
    tempLower: -25,
    tempUpper: -15,
  },
  {
    id: 'preset_15_30',
    name: '15–30 °C (Ambient / Warehouse)',
    tempLower: 15,
    tempUpper: 30,
    humLower: 20,
    humUpper: 75,
  },
];

export interface SettingsMap {
  application_name: string;
  report_directory: string;
  session_timeout_minutes: string;
  google_sheets_id: string;
  google_sheets_web_app_url: string;
  google_sheets_sync_enabled: boolean;
  google_sheets_last_sync?: string;
  acceptance_presets?: AcceptancePreset[];
  default_sampling_interval_minutes?: number;
}

export interface AppState {
  equipment: EquipmentRecord[];
  sensor_kits: SensorKitRecord[];
  superdaq_sensors: SuperDaqSensorRecord[];
  settings: SettingsMap;
  deleted_equipment_codes?: string[];
  deleted_kit_codes?: string[];
  deleted_sensor_codes?: string[];
}

const STORAGE_KEY = 'thermal_mapping_data_v3';

function parseInitialSettings(settingsArr: { setting_key: string; setting_value: string }[]): SettingsMap {
  const map: SettingsMap = {
    application_name: 'Thermal Mapping Analysis',
    report_directory: 'C:\\Users\\3719\\Desktop\\Thermal Mapping',
    session_timeout_minutes: '30',
    google_sheets_id: HARDCODED_GOOGLE_SHEETS_ID,
    google_sheets_web_app_url: HARDCODED_GOOGLE_SHEETS_WEB_APP_URL,
    google_sheets_sync_enabled: true,
    acceptance_presets: DEFAULT_ACCEPTANCE_PRESETS,
    default_sampling_interval_minutes: 15,
  };
  for (const s of settingsArr) {
    if (s.setting_key in map) {
      (map as unknown as Record<string, unknown>)[s.setting_key] = s.setting_value;
    }
  }
  map.google_sheets_id = HARDCODED_GOOGLE_SHEETS_ID;
  map.google_sheets_web_app_url = HARDCODED_GOOGLE_SHEETS_WEB_APP_URL;
  map.google_sheets_sync_enabled = true;
  if (!Array.isArray(map.acceptance_presets) || map.acceptance_presets.length === 0) {
    map.acceptance_presets = DEFAULT_ACCEPTANCE_PRESETS;
  }
  if (!map.default_sampling_interval_minutes || map.default_sampling_interval_minutes <= 0) {
    map.default_sampling_interval_minutes = 15;
  }
  return map;
}

export function getInitialState(): AppState {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.equipment && parsed.sensor_kits) {
        const deletedKitSet = new Set((parsed.deleted_kit_codes || []).map((c: string) => String(c).toUpperCase().trim()));
        const deletedEqSet = new Set((parsed.deleted_equipment_codes || []).map((c: string) => String(c).toUpperCase().trim()));
        const deletedSensorSet = new Set((parsed.deleted_sensor_codes || []).map((c: string) => String(c).toUpperCase().trim()));

        const kitMap = new Map<string, SensorKitRecord>();
        (parsed.sensor_kits || []).forEach((k: SensorKitRecord) => {
          if (!k || !k.kit_code) return;
          const codeUpper = k.kit_code.toUpperCase().trim();
          const snUpper = (k.serial_number || '').toUpperCase().trim();
          if (deletedKitSet.has(codeUpper) || (snUpper && deletedKitSet.has(snUpper))) return;
          if (codeUpper === 'KIT001' && (k.serial_number === '44070036' || k.name.includes('Super DAQ'))) {
            k.kit_code = 'KIT_44070036';
            k.name = 'Super DAQ Kit 9 sensors';
          }
          kitMap.set(k.kit_code, k);
        });

        const eqMap = new Map<string, EquipmentRecord>();
        (parsed.equipment || []).forEach((e: EquipmentRecord) => {
          if (!e || !e.equipment_code) return;
          const codeUpper = e.equipment_code.toUpperCase().trim();
          if (deletedEqSet.has(codeUpper)) return;
          eqMap.set(e.equipment_code, e);
        });

        const sensorMap = new Map<string, SuperDaqSensorRecord>();
        (parsed.superdaq_sensors || []).forEach((s: SuperDaqSensorRecord) => {
          if (!s || !s.sensor_code) return;
          if (s.kit_code === 'KIT001') s.kit_code = 'KIT_44070036';
          // Normalize legacy double-prefixed codes like KIT_44070036_KIT_44070036_Ch 102 (C)
          const kitPrefix = s.kit_code ? `${s.kit_code}_` : '';
          if (kitPrefix && s.sensor_code.toUpperCase().startsWith(`${kitPrefix.toUpperCase()}${kitPrefix.toUpperCase()}`)) {
            s.sensor_code = s.sensor_code.slice(kitPrefix.length);
          }
          const codeUpper = s.sensor_code.toUpperCase().trim();
          if (deletedSensorSet.has(codeUpper)) return;
          sensorMap.set(s.sensor_code, s);
        });

        const updatedSettings: SettingsMap = {
          ...parsed.settings,
          google_sheets_id: HARDCODED_GOOGLE_SHEETS_ID,
          google_sheets_web_app_url: HARDCODED_GOOGLE_SHEETS_WEB_APP_URL,
          google_sheets_sync_enabled: true,
          acceptance_presets:
            Array.isArray(parsed.settings?.acceptance_presets) && parsed.settings.acceptance_presets.length > 0
              ? parsed.settings.acceptance_presets
              : DEFAULT_ACCEPTANCE_PRESETS,
          default_sampling_interval_minutes:
            typeof parsed.settings?.default_sampling_interval_minutes === 'number' &&
            parsed.settings.default_sampling_interval_minutes > 0
              ? parsed.settings.default_sampling_interval_minutes
              : 15,
        };

        return {
          ...parsed,
          equipment: Array.from(eqMap.values()),
          sensor_kits: Array.from(kitMap.values()),
          superdaq_sensors: Array.from(sensorMap.values()),
          settings: updatedSettings,
          deleted_equipment_codes: Array.from(deletedEqSet),
          deleted_kit_codes: Array.from(deletedKitSet),
          deleted_sensor_codes: Array.from(deletedSensorSet),
        };
      }
    } catch (e) {
      console.warn('Failed to parse stored state, falling back to initial data', e);
    }
  }

  return {
    equipment: (initialData.equipment as unknown as EquipmentRecord[]) || [],
    sensor_kits: (initialData.sensor_kits as unknown as SensorKitRecord[]) || [],
    superdaq_sensors: (initialData.superdaq_sensors as unknown as SuperDaqSensorRecord[]) || [],
    settings: parseInitialSettings(initialData.settings || []),
    deleted_equipment_codes: [],
    deleted_kit_codes: [],
    deleted_sensor_codes: [],
  };
}

export function saveState(state: AppState): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state to localStorage', e);
    }
  }
}

export function parsePointsJson(jsonStr: string): CorrectionPoint[] {
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (p) => typeof p.indication === 'number' && typeof p.correction === 'number'
      );
    }
  } catch {
    return [];
  }
  return [];
}

export function isRecordExpired(dueDateStr: string): boolean {
  if (!dueDateStr) return false;
  const d = new Date(dueDateStr);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

export function getEquipmentStatus(record: EquipmentRecord): 'Active' | 'Incomplete' | 'Expired' {
  if (record.due_date && isRecordExpired(record.due_date)) {
    return 'Expired';
  }
  const pts = parsePointsJson(record.temperature_points_json);
  if (record.temperature_enabled && pts.length < 2) {
    return 'Incomplete';
  }
  if (!record.serial_number || !record.description) {
    return 'Incomplete';
  }
  return 'Active';
}

// -------------------------------------------------------------------------
// STUDY DRAFT AUTOSAVE HELPERS
// -------------------------------------------------------------------------

const STUDY_DRAFT_KEY = 'thermal_mapping_study_draft_v1';

export interface SerializedAssignedRow {
  id: string;
  sourceLabel: string;
  formatName: string;
  assignedCode: string;
  valid: boolean;
  notes?: string;
  readings: { timestamp: string; temperature: number | null; humidity: number | null }[];
}

export interface StudyDraft {
  studyName: string;
  acquisitionSystem: 'data_logger' | 'fluke_superdaq';
  analysisMode: 'temperature' | 'temperature_and_humidity';
  selectedKitCode: string;
  startStr: string;
  endStr: string;
  tempLower: string;
  tempUpper: string;
  humidityLower: string;
  humidityUpper: string;
  samplingIntervalStr: string;
  selectedSensorCodes: string[];
  assignedRows: SerializedAssignedRow[];
  confirmExpired: boolean;
  step: 1 | 2 | 3;
  savedAt: string;
}

export function saveStudyDraft(draft: StudyDraft): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STUDY_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Fallback if readings exceed localStorage quota: save metadata & selections without bulky readings
    try {
      const compactDraft: StudyDraft = {
        ...draft,
        assignedRows: draft.assignedRows.map((r) => ({ ...r, readings: [] })),
      };
      localStorage.setItem(STUDY_DRAFT_KEY, JSON.stringify(compactDraft));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }
}

export function loadStudyDraft(): StudyDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STUDY_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudyDraft;
    if (!parsed || !parsed.studyName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStudyDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STUDY_DRAFT_KEY);
  } catch {
    // Ignore
  }
}

