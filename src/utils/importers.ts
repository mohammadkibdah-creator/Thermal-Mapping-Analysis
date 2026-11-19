import * as XLSX from 'xlsx';
import {
  CalibrationCurve,
  ChannelLimits,
  CorrectionPoint,
  CorrectionConvention,
  calculateChannelResult,
  calculateArithmeticMean,
  snapStudyBoundaries,
  inferSamplingIntervalMinutes,
  validateGrid,
  StudyValidationError,
} from './metrology.ts';
import { formatDateTimeDDMMYYYY, formatDateDDMMYYYY, formatDateMMYYYY } from './dateFormat.ts';

export interface MeasurementReading {
  timestamp: Date;
  temperature: number | null;
  humidity: number | null;
}

export interface ParsedSingleFile {
  fileName: string;
  formatName: string;
  instrumentCode: string | null;
  readings: MeasurementReading[];
}

export interface ParsedMultiChannelFile {
  fileName: string;
  formatName: string;
  channels: Record<string, MeasurementReading[]>;
}

// Simple synchronous string hasher for sensor codes when length exceeds 32
function simpleHash16(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return (part1 + part2).toUpperCase().substring(0, 16);
}

export function parseExcelDate(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    const ssf = (XLSX as unknown as { SSF?: typeof XLSX.SSF; default?: { SSF?: typeof XLSX.SSF } }).SSF ||
      (XLSX as unknown as { default?: { SSF?: typeof XLSX.SSF } }).default?.SSF;
    if (ssf?.parse_date_code) {
      const parsed = ssf.parse_date_code(val);
      if (parsed) {
        return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
      }
    }
    const msSinceEpoch = (val - 25569) * 86400 * 1000;
    const d = new Date(msSinceEpoch);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof val === 'string' && val.trim()) {
    const s = val.trim();
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;

    // Common Metrology timestamp formats: e.g. 4/19/2025 9:45:00 PM or 2025-04-19 21:45:00
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+(AM|PM))?$/i);
    if (m) {
      let month = parseInt(m[1], 10) - 1;
      let day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      let hours = parseInt(m[4], 10);
      const minutes = parseInt(m[5], 10);
      const seconds = m[6] ? parseInt(m[6], 10) : 0;
      const ampm = m[7] ? m[7].toUpperCase() : null;

      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      if (month > 11) {
        const tmp = month;
        month = day - 1;
        day = tmp + 1;
      }
      return new Date(year, month, day, hours, minutes, seconds);
    }
  }
  return null;
}

export function parseDataLoggerFile(fileData: ArrayBuffer | Uint8Array, fileName: string): ParsedSingleFile {
  const workbook = XLSX.read(fileData, { type: 'array', cellDates: true });
  let instrumentCode: string | null = null;
  let targetSheet: XLSX.WorkSheet | null = null;
  let headerRowIndex = -1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

    // Look for Instrument name in first 15 rows
    for (let r = 0; r < Math.min(data.length, 15); r++) {
      const row = data[r] || [];
      for (const cell of row) {
        if (typeof cell === 'string') {
          const match = cell.match(/Instrument\s+name:\s*(.+?)(?:\s*$|\s{2,})/i);
          if (match) {
            instrumentCode = match[1].trim();
          }
        }
      }
    }

    // Look for header row with date/time and temperature
    for (let r = 0; r < Math.min(data.length, 50); r++) {
      const row = (data[r] || []).map((c) => String(c || '').toLowerCase().replace(/\s+/g, ''));
      if (row.some((c) => c.includes('date/time') || c === 'time' || c.includes('datetime')) &&
          row.some((c) => c.includes('temperature') || c.includes('temp'))) {
        headerRowIndex = r;
        targetSheet = sheet;
        break;
      }
    }
    if (targetSheet) break;
  }

  if (!targetSheet) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    for (let r = 0; r < Math.min(data.length, 20); r++) {
      const row = (data[r] || []).map((c) => String(c || '').toLowerCase());
      if (row.some((c) => c.includes('time') || c.includes('date'))) {
        headerRowIndex = r;
        targetSheet = sheet;
        break;
      }
    }
  }

  if (!targetSheet || headerRowIndex === -1) {
    throw new Error('No valid measurement table or header row found in file.');
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(targetSheet, { header: 1, raw: true });
  const headers = (rawRows[headerRowIndex] || []).map((c) => String(c || '').trim().toLowerCase());

  const timeCol = headers.findIndex((h) => h.includes('date/time') || h === 'time' || h.includes('datetime') || h.includes('date'));
  const tempCol = headers.findIndex((h) => h.includes('temperature') || h.includes('temp') || h.includes('°c') || h.includes('(c)'));
  const humCol = headers.findIndex((h) => h.includes('humidity') || h.includes('%rh') || h.includes('rh'));

  if (timeCol === -1 || tempCol === -1) {
    throw new Error('Could not identify Timestamp and Temperature columns in worksheet.');
  }

  const readings: MeasurementReading[] = [];
  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const timeRaw = row[timeCol];
    if (timeRaw == null || String(timeRaw).trim() === '') continue;

    const timestamp = parseExcelDate(timeRaw);
    if (!timestamp) continue;

    const tempRaw = row[tempCol];
    const tempNum = typeof tempRaw === 'number' ? tempRaw : parseFloat(String(tempRaw));
    const temperature = Number.isFinite(tempNum) ? tempNum : null;

    let humidity: number | null = null;
    if (humCol !== -1 && row[humCol] != null) {
      const humRaw = row[humCol];
      const humNum = typeof humRaw === 'number' ? humRaw : parseFloat(String(humRaw));
      humidity = Number.isFinite(humNum) ? humNum : null;
    }

    readings.push({ timestamp, temperature, humidity });
  }

  return {
    fileName,
    formatName: 'Report_Table.xls / Data Logger format',
    instrumentCode,
    readings,
  };
}

export function parseSuperDaqFile(fileData: ArrayBuffer | Uint8Array, fileName: string): ParsedMultiChannelFile {
  const workbook = XLSX.read(fileData, { type: 'array', cellDates: true });
  let targetSheet: XLSX.WorkSheet | null = null;
  let headerRowIndex = -1;
  let timeColIndex = -1;
  const channelColumns: { label: string; index: number }[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r] || [];
      const timeIdx = row.findIndex(
        (cell) => typeof cell === 'string' && cell.trim().toLowerCase() === 'time'
      );
      const chs: { label: string; index: number }[] = [];
      row.forEach((cell, idx) => {
        if (typeof cell === 'string' && /^Ch\s+\S/i.test(cell.trim())) {
          chs.push({ label: cell.trim(), index: idx });
        }
      });

      if (timeIdx !== -1 && chs.length > 0) {
        targetSheet = sheet;
        headerRowIndex = r;
        timeColIndex = timeIdx;
        channelColumns.push(...chs);
        break;
      }
    }
    if (targetSheet) break;
  }

  if (!targetSheet || headerRowIndex === -1) {
    throw new Error('No worksheet contains a SuperDAQ Time column and channel headers (e.g. Ch 101 (C)).');
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(targetSheet, { header: 1, raw: true });
  const channels: Record<string, MeasurementReading[]> = {};
  for (const ch of channelColumns) {
    channels[ch.label] = [];
  }

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const timeRaw = row[timeColIndex];
    if (timeRaw == null || String(timeRaw).trim() === '') continue;

    const timestamp = parseExcelDate(timeRaw);
    if (!timestamp) continue;

    for (const ch of channelColumns) {
      const valRaw = row[ch.index];
      let temp: number | null = null;
      if (valRaw != null) {
        const parsed = typeof valRaw === 'number' ? valRaw : parseFloat(String(valRaw));
        if (Number.isFinite(parsed) && Math.abs(parsed) < 1e10) {
          temp = parsed;
        }
      }
      channels[ch.label].push({
        timestamp,
        temperature: temp,
        humidity: null,
      });
    }
  }

  return {
    fileName,
    formatName: 'Fluke SuperDAQ Excel export',
    channels,
  };
}

// -------------------------------------------------------------------------
// EQUIPMENT IMPORTERS: Port of Python equipment_import.py and superdaq_equipment_import.py
// -------------------------------------------------------------------------

export interface EquipmentRecordDraft {
  equipment_code: string;
  description: string;
  serial_number: string;
  manufacturer: string;
  traceability: string;
  calibration_date: string;
  due_date: string;
  temperature_enabled: number;
  humidity_enabled: number;
  temperature_convention: CorrectionConvention | '';
  humidity_convention: CorrectionConvention | '';
  temperature_points: CorrectionPoint[];
  humidity_points: CorrectionPoint[];
}

export interface EquipmentImportPreview {
  equipment: EquipmentRecordDraft[];
  points: Record<string, { temperature: CorrectionPoint[]; relative_humidity: CorrectionPoint[] }>;
  counts: { equipment_code: string; temperature: number; relative_humidity: number }[];
  issues: string[];
  can_import: boolean;
}

const INDICATION_DL_REGEX = /^\s*Data\s*Logger\s*-\s*(DL\d+)\s*-\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%RH|C)\s*\)\s*$/i;
const EQUIPMENT_CODE_REGEX = /\bDL\d+\b/i;

function formatDateToIso(val: unknown, sheetName: string, rowNum: number, fieldName: string): string | null {
  if (val == null || (typeof val === 'string' && !val.trim())) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    const ssf = (XLSX as unknown as { SSF?: typeof XLSX.SSF; default?: { SSF?: typeof XLSX.SSF } }).SSF ||
      (XLSX as unknown as { default?: { SSF?: typeof XLSX.SSF } }).default?.SSF;
    if (ssf?.parse_date_code) {
      const parsed = ssf.parse_date_code(val);
      if (parsed) {
        const m = String(parsed.m).padStart(2, '0');
        const d = String(parsed.d).padStart(2, '0');
        return `${parsed.y}-${m}-${d}`;
      }
    }
    const msSinceEpoch = (val - 25569) * 86400 * 1000;
    const dateObj = new Date(msSinceEpoch);
    if (!isNaN(dateObj.getTime())) {
      const y = dateObj.getUTCFullYear();
      const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const str = String(val).trim();

  // Explicit ISO YYYY-MM-DD without timezone drift
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    const check = new Date(y, m - 1, d);
    if (check.getFullYear() === y && check.getMonth() === m - 1 && check.getDate() === d) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Explicit DD/MM/YYYY (or DD-MM-YYYY / DD.MM.YYYY)
  const dmyMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    const check = new Date(y, m - 1, d);
    if (check.getFullYear() === y && check.getMonth() === m - 1 && check.getDate() === d) {
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const dateObj = new Date(str);
  if (!isNaN(dateObj.getTime())) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  throw new Error(`${sheetName} row ${rowNum}: ${fieldName} must include a full calendar date (dd/mm/yyyy); found '${str}'.`);
}

/**
 * Port of Python parse_equipment_workbook from equipment_import.py
 */
export function parseEquipmentWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  existingCodes: Set<string> = new Set()
): EquipmentImportPreview {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  const sheetMap: Record<string, XLSX.WorkSheet> = {};
  for (const name of sheetNames) {
    sheetMap[name.trim().toLowerCase()] = workbook.Sheets[name];
  }

  const requiredSheets = ['equipment details', 'corrections'];
  const missing = requiredSheets.filter((req) => !sheetMap[req]);
  if (missing.length > 0) {
    throw new Error(`Workbook is missing required worksheet(s): ${missing.sort().join(', ')}.`);
  }

  const issues: string[] = [];
  const equipmentByCode: Record<string, EquipmentRecordDraft> = {};
  const sourceRows: Record<string, number> = {};
  const groupedPoints: Record<string, { temperature: CorrectionPoint[]; relative_humidity: CorrectionPoint[] }> = {};

  const existingNormalized = new Set(Array.from(existingCodes).map((c) => c.toLowerCase()));

  // 1. Process 'Equipment details'
  const eqSheet = sheetMap['equipment details'];
  const eqRows: unknown[][] = XLSX.utils.sheet_to_json(eqSheet, { header: 1, raw: true });
  if (eqRows.length === 0) {
    throw new Error('Equipment details worksheet is empty.');
  }

  const headerRow = (eqRows[0] || []).map((c) => String(c ?? '').trim().toLowerCase());
  const expectedHeaders = [
    'instrument description',
    'equipment code',
    'serial number',
    'manufacturer',
    'traceability',
    'calibration date',
    'calibration due date',
  ];
  for (const eh of expectedHeaders) {
    if (!headerRow.includes(eh)) {
      throw new Error(`Equipment details worksheet is missing the '${eh}' column.`);
    }
  }

  const getCol = (h: string) => headerRow.indexOf(h);
  const colDesc = getCol('instrument description');
  const colCode = getCol('equipment code');
  const colSn = getCol('serial number');
  const colMfg = getCol('manufacturer');
  const colTrace = getCol('traceability');
  const colCalDate = getCol('calibration date');
  const colDueDate = getCol('calibration due date');

  for (let r = 1; r < eqRows.length; r++) {
    const row = eqRows[r];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const rowNumber = r + 1;

    const rawCode = row[colCode];
    if (rawCode == null || String(rawCode).trim() === '') {
      issues.push(`Equipment details row ${rowNumber}: equipment code is missing.`);
      continue;
    }
    const code = String(rawCode).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) {
      issues.push(`Equipment details row ${rowNumber}: invalid equipment code '${rawCode}'.`);
      continue;
    }
    const codeLower = code.toLowerCase();
    if (sourceRows[codeLower]) {
      issues.push(
        `Equipment details row ${rowNumber}: duplicate equipment code ${code}; first appears on row ${sourceRows[codeLower]}.`
      );
      continue;
    }
    sourceRows[codeLower] = rowNumber;

    if (existingNormalized.has(codeLower)) {
      issues.push(
        `Equipment details row ${rowNumber}: ${code} already exists in the registry; imports never overwrite existing equipment.`
      );
    }

    const description = String(row[colDesc] ?? '').trim();
    if (!description) {
      issues.push(`Equipment details row ${rowNumber}: instrument description is required.`);
    }
    const describedMatch = description.match(EQUIPMENT_CODE_REGEX);
    if (describedMatch && describedMatch[0].toUpperCase() !== code) {
      issues.push(
        `Equipment details row ${rowNumber}: description identifies ${describedMatch[0].toUpperCase()} but Equipment Code is ${code}.`
      );
    }

    const serial = String(row[colSn] ?? '').trim();
    const traceability = String(row[colTrace] ?? '').trim();
    const manufacturer = String(row[colMfg] ?? '').trim();

    if (!serial) issues.push(`Equipment details row ${rowNumber}: serial number is required.`);
    if (!traceability) issues.push(`Equipment details row ${rowNumber}: traceability is required.`);

    let calibrationDate: string | null = null;
    try {
      calibrationDate = formatDateToIso(row[colCalDate], 'Equipment details', rowNumber, 'Calibration Date');
    } catch (e: unknown) {
      issues.push(e instanceof Error ? e.message : String(e));
    }

    let dueDate: string | null = null;
    try {
      dueDate = formatDateToIso(row[colDueDate], 'Equipment details', rowNumber, 'Calibration Due Date');
    } catch (e: unknown) {
      issues.push(e instanceof Error ? e.message : String(e));
    }

    if (calibrationDate && dueDate && dueDate < calibrationDate) {
      issues.push(`Equipment details row ${rowNumber}: Calibration Due Date precedes Calibration Date.`);
    }

    equipmentByCode[code] = {
      equipment_code: code,
      description,
      serial_number: serial,
      manufacturer,
      traceability,
      calibration_date: calibrationDate || '',
      due_date: dueDate || '',
      temperature_enabled: 1,
      humidity_enabled: 1,
      temperature_convention: 'indication_plus_correction',
      humidity_convention: 'indication_plus_correction',
      temperature_points: [],
      humidity_points: [],
    };
    groupedPoints[code] = { temperature: [], relative_humidity: [] };
  }

  if (Object.keys(equipmentByCode).length === 0) {
    issues.push('Equipment details worksheet contains no instruments.');
  }

  // 2. Process 'corrections'
  const corrSheet = sheetMap['corrections'];
  const corrRows: unknown[][] = XLSX.utils.sheet_to_json(corrSheet, { header: 1, raw: true });
  if (corrRows.length === 0) {
    throw new Error('Corrections worksheet is empty.');
  }

  const corrHeader = (corrRows[0] || []).map((c) => String(c ?? '').trim().toLowerCase());
  const indCol = corrHeader.findIndex((h) => h.startsWith('indication'));
  const corrCol = corrHeader.findIndex((h) => h.startsWith('correction'));

  if (indCol === -1 || corrCol === -1) {
    throw new Error('Corrections worksheet must contain Indication and Correction columns.');
  }

  for (let r = 1; r < corrRows.length; r++) {
    const row = corrRows[r];
    if (!row) continue;
    const indicationRaw = row[indCol];
    const correctionRaw = row[corrCol];
    if ((indicationRaw == null || String(indicationRaw).trim() === '') &&
        (correctionRaw == null || String(correctionRaw).trim() === '')) {
      continue;
    }
    const rowNumber = r + 1;
    if (indicationRaw == null || String(indicationRaw).trim() === '') {
      issues.push(`Corrections row ${rowNumber}: Correction is populated but Indication is blank.`);
      continue;
    }
    if (typeof indicationRaw !== 'string') {
      issues.push(`Corrections row ${rowNumber}: Indication must be text; found '${indicationRaw}'.`);
      continue;
    }

    const match = indicationRaw.match(INDICATION_DL_REGEX);
    if (!match) {
      issues.push(
        `Corrections row ${rowNumber}: malformed Indication '${indicationRaw}'; expected an equipment code, numeric indication, and C or %RH unit.`
      );
      continue;
    }

    const code = match[1].toUpperCase();
    const indValStr = match[2];
    const unit = match[3];

    if (!equipmentByCode[code]) {
      issues.push(
        `Corrections row ${rowNumber}: equipment code ${code} has no exact match in Equipment Code; its points were not assigned.`
      );
      continue;
    }

    if (correctionRaw == null || typeof correctionRaw === 'boolean' || String(correctionRaw).trim() === '') {
      issues.push(`Corrections row ${rowNumber}: correction for ${code} is missing or non-numeric.`);
      continue;
    }

    const indVal = parseFloat(indValStr);
    const corrVal = typeof correctionRaw === 'number' ? correctionRaw : parseFloat(String(correctionRaw));

    if (!Number.isFinite(indVal) || !Number.isFinite(corrVal)) {
      issues.push(`Corrections row ${rowNumber}: indication and correction for ${code} must be finite numbers.`);
      continue;
    }

    const kind = unit.toUpperCase() === 'C' ? 'temperature' : 'relative_humidity';
    groupedPoints[code][kind].push({ indication: indVal, correction: corrVal });
  }

  // 3. Validate each equipment's points
  for (const code of Object.keys(equipmentByCode)) {
    for (const kind of ['temperature', 'relative_humidity'] as const) {
      const pts = groupedPoints[code][kind];
      const label = kind === 'temperature' ? 'temperature' : 'relative-humidity';
      if (pts.length < 2) {
        issues.push(`${code}: at least two ${label} correction points are required; found ${pts.length}.`);
      }
      const indCounts = new Map<number, number>();
      for (const p of pts) {
        indCounts.set(p.indication, (indCounts.get(p.indication) || 0) + 1);
      }
      const duplicates = Array.from(indCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([val]) => val)
        .sort((a, b) => a - b);
      if (duplicates.length > 0) {
        issues.push(`${code}: duplicate ${label} indication point(s): ${duplicates.join(', ')}.`);
      }

      if (kind === 'temperature') {
        equipmentByCode[code].temperature_points = pts;
      } else {
        equipmentByCode[code].humidity_points = pts;
      }
    }
  }

  const counts = Object.keys(equipmentByCode)
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({
      equipment_code: code,
      temperature: groupedPoints[code].temperature.length,
      relative_humidity: groupedPoints[code].relative_humidity.length,
    }));

  return {
    equipment: Object.values(equipmentByCode),
    points: groupedPoints,
    counts,
    issues,
    can_import: issues.length === 0,
  };
}

export interface SuperDaqSensorDraft {
  sensor_code: string;
  name: string;
  channel_identifier: string;
  serial_number: string;
  position: string;
  calibration_date: string;
  due_date: string;
  traceability: string;
  temperature_convention: CorrectionConvention;
  temperature_points: CorrectionPoint[];
}

export interface SuperDAQEquipmentPreview {
  kit: { name: string; serial_number: string };
  sensors: SuperDaqSensorDraft[];
  issues: string[];
  can_import: boolean;
}

const SUPERDAQ_INDICATION_REGEX = /^\s*(?:\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*C\s*\)|([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*C)\s*$/i;

/**
 * Port of Python parse_superdaq_equipment_workbook from superdaq_equipment_import.py
 */
export function parseSuperDaqEquipmentWorkbook(buffer: ArrayBuffer | Uint8Array): SuperDAQEquipmentPreview {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  const sheetMap: Record<string, XLSX.WorkSheet> = {};
  for (const name of sheetNames) {
    sheetMap[name.trim().toLowerCase()] = workbook.Sheets[name];
  }

  const missing = ['equipment details', 'corrections'].filter((req) => !sheetMap[req]);
  if (missing.length > 0) {
    throw new Error(`Workbook is missing required worksheet(s): ${missing.sort().join(', ')}.`);
  }

  const issues: string[] = [];
  const kitSensorsByChannel: Record<string, Record<string, SuperDaqSensorDraft>> = {};
  const kitNamesBySerial: Record<string, string> = {};
  const correctionGroups: Record<string, CorrectionPoint[]> = {};

  // 1. Process 'Equipment details'
  const eqSheet = sheetMap['equipment details'];
  const eqRows: unknown[][] = XLSX.utils.sheet_to_json(eqSheet, { header: 1, raw: true });
  if (eqRows.length === 0) {
    throw new Error('Equipment details worksheet is empty.');
  }

  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = (eqRows[0] || []).map(norm);

  const expectedFields: Record<string, string> = {
    'kit name': 'kitnamedescription',
    'kit serial number': 'kitserialnumber',
    'sensor name': 'sensorname',
    'serial number': 'serialnumber',
    'sensor code': 'sensorcode',
    'channel identifier': 'superdaqchannelidentifier',
    'calibration date': 'calibrationdate',
    'calibration due date': 'calibrationduedate',
    'traceability': 'traceability',
  };

  const missingCols = Object.entries(expectedFields)
    .filter(([, key]) => !headers.includes(key))
    .map(([label]) => label);

  if (missingCols.length > 0) {
    throw new Error(`Equipment details worksheet is missing column(s): ${missingCols.join(', ')}.`);
  }

  for (let r = 1; r < eqRows.length; r++) {
    const row = eqRows[r];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const rowNumber = r + 1;

    const getVal = (key: string) => {
      const idx = headers.indexOf(key);
      return idx !== -1 ? row[idx] : undefined;
    };

    const kitNameRaw = getVal('kitnamedescription');
    const kitSerialRaw = getVal('kitserialnumber');
    const sensorNameRaw = getVal('sensorname');
    const sensorSerialRaw = getVal('serialnumber');
    const sensorCodeRaw = getVal('sensorcode');
    const channelRaw = getVal('superdaqchannelidentifier');
    const calDateRaw = getVal('calibrationdate');
    const dueDateRaw = getVal('calibrationduedate');
    const traceRaw = getVal('traceability');

    const requiredPairs = [
      ['kit name', kitNameRaw],
      ['kit serial number', kitSerialRaw],
      ['sensor name', sensorNameRaw],
      ['serial number', sensorSerialRaw],
      ['sensor code', sensorCodeRaw],
      ['channel identifier', channelRaw],
      ['traceability', traceRaw],
    ] as const;

    const missingReq = requiredPairs
      .filter(([, val]) => val == null || String(val).trim() === '')
      .map(([label]) => label);

    if (missingReq.length > 0) {
      issues.push(`Equipment details row ${rowNumber}: missing ${missingReq.join(', ')}.`);
      continue;
    }

    const kitName = String(kitNameRaw).trim();
    const kitSerial = String(kitSerialRaw).trim();
    const sensorName = String(sensorNameRaw).trim();
    const sensorSerial = String(sensorSerialRaw).trim();
    const workbookSensorCode = String(sensorCodeRaw).trim();
    const channel = String(channelRaw).trim();
    const traceability = String(traceRaw).trim();

    let calDate = '';
    try {
      calDate = formatDateToIso(calDateRaw, 'Equipment details', rowNumber, 'Calibration Date') || '';
    } catch (e: unknown) {
      issues.push(e instanceof Error ? e.message : String(e));
    }

    let dueDate = '';
    try {
      dueDate = formatDateToIso(dueDateRaw, 'Equipment details', rowNumber, 'Calibration Due Date') || '';
    } catch (e: unknown) {
      issues.push(e instanceof Error ? e.message : String(e));
    }

    if (calDate && dueDate && dueDate < calDate) {
      issues.push(`Equipment details row ${rowNumber}: Calibration Due Date precedes Calibration Date.`);
    }

    if (!kitSensorsByChannel[kitSerial]) {
      kitSensorsByChannel[kitSerial] = {};
      kitNamesBySerial[kitSerial] = kitName;
    }
    if (kitNamesBySerial[kitSerial] !== kitName) {
      issues.push(`Equipment details row ${rowNumber}: kit serial ${kitSerial} has conflicting kit names.`);
    }

    if (kitSensorsByChannel[kitSerial][channel]) {
      issues.push(`Equipment details row ${rowNumber}: duplicate channel '${channel}' for kit serial ${kitSerial}.`);
      continue;
    }

    // Build sensor code
    const rawSensorCode = `SDQ${kitSerial}${workbookSensorCode}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sensorCode = rawSensorCode.length <= 32 ? rawSensorCode : `SDQ${simpleHash16(`${kitSerial}|${workbookSensorCode}`)}`;

    kitSensorsByChannel[kitSerial][channel] = {
      sensor_code: sensorCode,
      name: sensorName,
      channel_identifier: channel,
      serial_number: sensorSerial,
      position: '',
      calibration_date: calDate,
      due_date: dueDate,
      traceability,
      temperature_convention: 'indication_plus_correction',
      temperature_points: [],
    };
  }

  const kitSerials = Object.keys(kitSensorsByChannel);
  if (kitSerials.length === 0) {
    issues.push('Equipment details worksheet contains no complete sensor records.');
  }
  if (kitSerials.length > 1) {
    issues.push(`This import accepts one sensor kit per workbook; the workbook contains ${kitSerials.length} kit serial numbers.`);
  }

  // 2. Process 'corrections'
  const corrSheet = sheetMap['corrections'];
  const corrRows: unknown[][] = XLSX.utils.sheet_to_json(corrSheet, { header: 1, raw: true });
  if (corrRows.length === 0) {
    throw new Error('Corrections worksheet is empty.');
  }

  const corrHeaders = (corrRows[0] || []).map(norm);
  const serialCol = corrHeaders.indexOf('kitserialnumber');
  const chCol = corrHeaders.indexOf('superdaqchannelidentifier');
  const indCol = corrHeaders.findIndex((h) => h.startsWith('indication'));
  const corrCol = corrHeaders.findIndex((h) => h.startsWith('correction'));

  const missingCorrHeaders: string[] = [];
  if (serialCol === -1) missingCorrHeaders.push('Kit Serial Number');
  if (chCol === -1) missingCorrHeaders.push('SuperDAQ Channel Identifier');
  if (indCol === -1) missingCorrHeaders.push('Indication');
  if (corrCol === -1) missingCorrHeaders.push('Correction');

  if (missingCorrHeaders.length > 0) {
    throw new Error(`Corrections worksheet is missing column(s): ${missingCorrHeaders.join(', ')}.`);
  }

  for (let r = 1; r < corrRows.length; r++) {
    const row = corrRows[r];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const rowNumber = r + 1;

    const rawSerial = row[serialCol];
    const rawCh = row[chCol];
    const rawInd = row[indCol];
    const rawCorr = row[corrCol];

    if (rawSerial == null || rawCh == null || rawInd == null || rawCorr == null ||
        String(rawSerial).trim() === '' || String(rawCh).trim() === '' ||
        String(rawInd).trim() === '' || String(rawCorr).trim() === '') {
      issues.push(`Corrections row ${rowNumber}: populated correction row has missing values.`);
      continue;
    }

    const serial = String(rawSerial).trim();
    const channel = String(rawCh).trim();
    const indText = String(rawInd).trim();
    const indMatch = indText.match(SUPERDAQ_INDICATION_REGEX);

    if (!indMatch) {
      issues.push(`Corrections row ${rowNumber}: malformed temperature indication '${indText}'; expected a numeric value with a C unit.`);
      continue;
    }

    const corrText = String(rawCorr).trim();
    const corrNum = typeof rawCorr === 'number' ? rawCorr : parseFloat(corrText);
    const indNum = parseFloat(indMatch[1] || indMatch[2]);

    if (!Number.isFinite(indNum) || !Number.isFinite(corrNum)) {
      issues.push(`Corrections row ${rowNumber}: indication and correction must be finite numbers.`);
      continue;
    }

    if (!kitSensorsByChannel[serial]) {
      issues.push(`Corrections row ${rowNumber}: kit serial '${serial}' has no exact match in Equipment details; this point was not assigned.`);
      continue;
    }

    if (!kitSensorsByChannel[serial][channel]) {
      issues.push(`Corrections row ${rowNumber}: channel '${channel}' has no exact match for kit serial ${serial}; this point was not assigned.`);
      continue;
    }

    const key = `${serial}|${channel}`;
    if (!correctionGroups[key]) {
      correctionGroups[key] = [];
    }
    correctionGroups[key].push({ indication: indNum, correction: corrNum });
  }

  // 3. Assemble and validate
  if (kitSerials.length === 1) {
    const targetSerial = kitSerials[0];
    const channelMap = kitSensorsByChannel[targetSerial];
    const sensorsList: SuperDaqSensorDraft[] = [];
    const seenCodes = new Map<string, string>();

    for (const [channel, sensor] of Object.entries(channelMap)) {
      if (seenCodes.has(sensor.sensor_code)) {
        issues.push(
          `Equipment details: Sensor Code values produce the same registry sensor code ${sensor.sensor_code}.`
        );
      }
      seenCodes.set(sensor.sensor_code, channel);

      const pts = correctionGroups[`${targetSerial}|${channel}`] || [];
      if (pts.length < 2) {
        issues.push(`${channel}: at least two temperature correction points are required; found ${pts.length}.`);
      }

      const indCounts = new Map<number, number>();
      for (const p of pts) {
        indCounts.set(p.indication, (indCounts.get(p.indication) || 0) + 1);
      }
      const duplicateInds = Array.from(indCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([val]) => val)
        .sort((a, b) => a - b);
      if (duplicateInds.length > 0) {
        issues.push(`${channel}: duplicate temperature indication(s): ${duplicateInds.join(', ')}.`);
      }

      try {
        new CalibrationCurve(pts, 'indication_plus_correction');
      } catch (e: unknown) {
        issues.push(`${channel}: invalid temperature correction curve: ${e instanceof Error ? e.message : String(e)}`);
      }

      sensor.temperature_points = pts;
      sensorsList.push(sensor);
    }

    return {
      kit: {
        name: kitNamesBySerial[targetSerial] || 'Super DAQ Kit',
        serial_number: targetSerial,
      },
      sensors: sensorsList,
      issues,
      can_import: issues.length === 0,
    };
  }

  return {
    kit: { name: '', serial_number: '' },
    sensors: [],
    issues,
    can_import: false,
  };
}

// -------------------------------------------------------------------------
// STUDY ANALYSIS: Metrological calculations and grid snapping
// -------------------------------------------------------------------------

export interface AssignedLoggerInput {
  equipmentCode: string;
  readings: MeasurementReading[];
  temperatureCurve: CalibrationCurve;
  humidityCurve?: CalibrationCurve;
  // Metadata for JNMI report traceability
  serialNumber?: string;
  description?: string;
  traceability?: string;
  calibrationDate?: string;
  dueDate?: string;
  sourceChannel?: string;
  position?: string;
  sensorName?: string;
  certificateNumber?: string;
  provider?: string;
}

export interface StudyAnalysisInput {
  studyName: string;
  requestedStart: Date;
  requestedEnd: Date;
  samplingIntervalMinutes?: number;
  mode: 'temperature' | 'temperature_and_humidity';
  temperatureLimits: ChannelLimits;
  humidityLimits?: ChannelLimits;
  acquisitionSystem?: 'data_logger' | 'fluke_superdaq' | string;
  sensorKit?: string;
  expiredCertificateConfirmed?: boolean;
  assignedLoggers: AssignedLoggerInput[];
}

export interface LoggerSeriesResult {
  equipmentCode: string;
  timestamps: Date[];
  correctedTemperatures: number[];
  correctedHumidities: number[];
  originalTemperatures: number[];
  temperatureCorrections: number[];
  originalHumidities: number[];
  humidityCorrections: number[];
}

export interface StudyAnalysisOutput {
  studyName: string;
  requestedStart: Date;
  requestedEnd: Date;
  start: Date; // effective/snapped
  end: Date;   // effective/snapped
  samplingIntervalMinutes: number;
  mode: 'temperature' | 'temperature_and_humidity';
  acquisitionSystem: string;
  sensorKit: string;
  temperatureLimits: ChannelLimits;
  humidityLimits?: ChannelLimits;
  expiredCertificateConfirmed: boolean;
  globalTemperatureMean: number;
  globalHumidityMean: number | null;
  overallTemperatureUniformity: number;
  overallTemperatureStability: number;
  hotSpotCode: string | null;
  coldSpotCode: string | null;
  overallHumidityUniformity: number | null;
  humHighSpotCode: string | null;
  humLowSpotCode: string | null;
  warnings: string[];
  loggerResults: {
    equipmentCode: string;
    temperature: ReturnType<typeof calculateChannelResult>;
    humidity: ReturnType<typeof calculateChannelResult> | null;
  }[];
  series: LoggerSeriesResult[];
  assignedSnapshots: AssignedLoggerInput[];
}

export function runMetrologyStudyAnalysis(input: StudyAnalysisInput): StudyAnalysisOutput {
  const {
    studyName,
    requestedStart,
    requestedEnd,
    mode,
    temperatureLimits,
    humidityLimits,
    acquisitionSystem = 'data_logger',
    sensorKit = '',
    expiredCertificateConfirmed = false,
    assignedLoggers,
  } = input;

  if (assignedLoggers.length === 0) {
    throw new StudyValidationError(['At least one Data Logger / Sensor must be assigned.']);
  }

  // 1. Study Boundary Snapping across common timestamps
  const boundaryLoggers = assignedLoggers.map((l) => ({
    equipmentCode: l.equipmentCode,
    timestamps: l.readings.map((r) => r.timestamp),
  }));

  const snapped = snapStudyBoundaries(boundaryLoggers, requestedStart, requestedEnd);
  const effectiveStart = snapped.effectiveStart;
  const effectiveEnd = snapped.effectiveEnd;
  const warnings: string[] = [...snapped.warnings];

  // 2. Infer or validate sampling interval
  let intervalMinutes = input.samplingIntervalMinutes;
  if (!intervalMinutes || intervalMinutes <= 0) {
    intervalMinutes = inferSamplingIntervalMinutes(boundaryLoggers);
  }

  // 3. Grid Validation (Strict grid for Data Logger, standard for SuperDAQ)
  const isDataLogger = acquisitionSystem.toLowerCase().includes('logger') || acquisitionSystem === 'data_logger';
  const strictGrid = isDataLogger;

  for (const logger of assignedLoggers) {
    const issues = validateGrid(
      logger.equipmentCode,
      logger.readings.map((r) => r.timestamp),
      effectiveStart,
      effectiveEnd,
      intervalMinutes,
      strictGrid
    );
    if (issues.length > 0) {
      throw new StudyValidationError(issues);
    }
  }

  const loggerResults: StudyAnalysisOutput['loggerResults'] = [];
  const series: LoggerSeriesResult[] = [];
  const pooledTemperatures: number[] = [];
  const pooledHumidities: number[] = [];

  const startMs = effectiveStart.getTime();
  const endMs = effectiveEnd.getTime();

  for (const logger of assignedLoggers) {
    // Filter readings to effective window [effectiveStart, effectiveEnd]
    const windowReadings = logger.readings
      .filter((r) => r.timestamp.getTime() >= startMs && r.timestamp.getTime() <= endMs)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (windowReadings.length < 2) {
      throw new StudyValidationError([
        `Data Logger ${logger.equipmentCode}: fewer than two measurements found within the study window.`,
      ]);
    }

    const timestamps: Date[] = [];
    const correctedTemperatures: number[] = [];
    const correctedHumidities: number[] = [];
    const originalTemperatures: number[] = [];
    const temperatureCorrections: number[] = [];
    const originalHumidities: number[] = [];
    const humidityCorrections: number[] = [];

    for (const r of windowReadings) {
      if (r.temperature == null) continue;
      timestamps.push(r.timestamp);

      const tempRes = logger.temperatureCurve.correct(r.temperature);
      originalTemperatures.push(r.temperature);
      temperatureCorrections.push(tempRes.correction);
      correctedTemperatures.push(tempRes.corrected_value);
      pooledTemperatures.push(tempRes.corrected_value);

      if (tempRes.extrapolated) {
        warnings.push(
          `Data Logger ${logger.equipmentCode}, temperature: indication ${r.temperature}°C used calibration extrapolation; range ${tempRes.calibration_range[0]} to ${tempRes.calibration_range[1]}°C.`
        );
      }

      if (mode === 'temperature_and_humidity' && logger.humidityCurve && r.humidity != null) {
        const humRes = logger.humidityCurve.correct(r.humidity);
        originalHumidities.push(r.humidity);
        humidityCorrections.push(humRes.correction);
        correctedHumidities.push(humRes.corrected_value);
        pooledHumidities.push(humRes.corrected_value);

        if (humRes.extrapolated) {
          warnings.push(
            `Data Logger ${logger.equipmentCode}, RH: indication ${r.humidity}% used calibration extrapolation; range ${humRes.calibration_range[0]} to ${humRes.calibration_range[1]}%.`
          );
        }
      }
    }

    const tempChannelResult = calculateChannelResult(
      correctedTemperatures,
      timestamps,
      intervalMinutes,
      effectiveStart,
      effectiveEnd,
      temperatureLimits
    );

    let humChannelResult: ReturnType<typeof calculateChannelResult> | null = null;
    if (mode === 'temperature_and_humidity' && humidityLimits && correctedHumidities.length > 0) {
      humChannelResult = calculateChannelResult(
        correctedHumidities,
        timestamps,
        intervalMinutes,
        effectiveStart,
        effectiveEnd,
        humidityLimits
      );
    }

    loggerResults.push({
      equipmentCode: logger.equipmentCode,
      temperature: tempChannelResult,
      humidity: humChannelResult,
    });

    series.push({
      equipmentCode: logger.equipmentCode,
      timestamps,
      correctedTemperatures,
      correctedHumidities,
      originalTemperatures,
      temperatureCorrections,
      originalHumidities,
      humidityCorrections,
    });
  }

  const globalTemperatureMean = calculateArithmeticMean(pooledTemperatures);
  const globalHumidityMean = pooledHumidities.length > 0 ? calculateArithmeticMean(pooledHumidities) : null;

  // Identify Hot Spot (highest recorded max, tie-break highest mean) & Cold Spot (lowest min, tie-break lowest mean)
  let hotSpotCode: string | null = null;
  let coldSpotCode: string | null = null;
  let globalTempMin = Infinity;
  let globalTempMax = -Infinity;
  let hotRef = { max: -Infinity, mean: -Infinity };
  let coldRef = { min: Infinity, mean: Infinity };

  for (const lr of loggerResults) {
    if (lr.temperature.minimum < globalTempMin) globalTempMin = lr.temperature.minimum;
    if (lr.temperature.maximum > globalTempMax) globalTempMax = lr.temperature.maximum;

    if (
      lr.temperature.maximum > hotRef.max ||
      (lr.temperature.maximum === hotRef.max && lr.temperature.mean > hotRef.mean)
    ) {
      hotRef = { max: lr.temperature.maximum, mean: lr.temperature.mean };
      hotSpotCode = lr.equipmentCode;
    }

    if (
      lr.temperature.minimum < coldRef.min ||
      (lr.temperature.minimum === coldRef.min && lr.temperature.mean < coldRef.mean)
    ) {
      coldRef = { min: lr.temperature.minimum, mean: lr.temperature.mean };
      coldSpotCode = lr.equipmentCode;
    }
  }

  const overallTemperatureUniformity = Number.isFinite(globalTempMax - globalTempMin)
    ? globalTempMax - globalTempMin
    : 0;
  const overallTemperatureStability = overallTemperatureUniformity / 2;

  // Humidity high/low spot & uniformity
  const humResults = loggerResults.filter((lr) => lr.humidity !== null);
  let humHighSpotCode: string | null = null;
  let humLowSpotCode: string | null = null;
  let overallHumidityUniformity: number | null = null;

  if (humResults.length > 0) {
    let gHumMin = Infinity;
    let gHumMax = -Infinity;
    let hHighRef = { max: -Infinity, mean: -Infinity };
    let hLowRef = { min: Infinity, mean: Infinity };

    for (const lr of humResults) {
      const h = lr.humidity!;
      if (h.minimum < gHumMin) gHumMin = h.minimum;
      if (h.maximum > gHumMax) gHumMax = h.maximum;

      if (h.maximum > hHighRef.max || (h.maximum === hHighRef.max && h.mean > hHighRef.mean)) {
        hHighRef = { max: h.maximum, mean: h.mean };
        humHighSpotCode = lr.equipmentCode;
      }
      if (h.minimum < hLowRef.min || (h.minimum === hLowRef.min && h.mean < hLowRef.mean)) {
        hLowRef = { min: h.minimum, mean: h.mean };
        humLowSpotCode = lr.equipmentCode;
      }
    }
    overallHumidityUniformity = gHumMax - gHumMin;
  }

  return {
    studyName,
    requestedStart,
    requestedEnd,
    start: effectiveStart,
    end: effectiveEnd,
    samplingIntervalMinutes: intervalMinutes,
    mode,
    acquisitionSystem: isDataLogger ? 'Data Logger' : 'Fluke SuperDAQ',
    sensorKit,
    temperatureLimits,
    humidityLimits,
    expiredCertificateConfirmed,
    globalTemperatureMean,
    globalHumidityMean,
    overallTemperatureUniformity,
    overallTemperatureStability,
    hotSpotCode,
    coldSpotCode,
    overallHumidityUniformity,
    humHighSpotCode,
    humLowSpotCode,
    warnings: Array.from(new Set(warnings)),
    loggerResults,
    series,
    assignedSnapshots: assignedLoggers,
  };
}

/**
 * Returns a concise display identifier for study results, charts, and Excel tabs:
 * For SuperDAQ sensors (or long composite KIT_/SDQ codes), uses the sensor Serial Number directly (e.g. "2")
 * instead of the long internal composite code. Falls back to channel identifier when SN is absent.
 */
export function getSensorDisplayLabel(
  code: string | null | undefined,
  snapshots: AssignedLoggerInput[],
  acquisitionSystem?: string
): string {
  if (!code) return '—';
  const snap = snapshots.find((a) => a.equipmentCode === code);
  const isSuperDaq =
    (acquisitionSystem ? !acquisitionSystem.toLowerCase().includes('logger') : false) ||
    Boolean(snap?.sourceChannel) ||
    /^KIT_|^SDQ/i.test(code);

  if (!isSuperDaq) {
    return code;
  }

  const sn = snap?.serialNumber?.trim();
  if (sn && sn.toLowerCase() !== 'pending s/n' && sn !== '—') {
    const base = sn.replace(/^sn[\s:-]+/i, '').trim() || sn;
    const duplicateSnCount = snapshots.filter(
      (a) => (a.serialNumber?.trim().toLowerCase() || '') === sn.toLowerCase()
    ).length;
    if (duplicateSnCount > 1 && snap?.sourceChannel) {
      return `${base} (${snap.sourceChannel})`;
    }
    return base;
  }

  if (snap?.sourceChannel?.trim()) {
    return snap.sourceChannel.trim();
  }

  // Fallback: strip long repeated KIT_<id>_ prefixes so raw channel (e.g. "Ch 102 (C)") is shown
  const stripped = code.replace(/^(?:KIT_[^_]+_)+/i, '').trim();
  return stripped || code;
}

// -------------------------------------------------------------------------
// EXCEL EXPORTER: Exact JNMI report structure matching Python reports.py
// -------------------------------------------------------------------------

function sanitizeSheetName(raw: string, usedNames: Set<string>): string {
  let cleaned = raw.replace(/[\[\]:*?/\\]/g, '_').trim() || 'Sensor';
  cleaned = cleaned.substring(0, 31);
  let candidate = cleaned;
  let suffix = 1;
  while (usedNames.has(candidate)) {
    const sfx = `_${suffix}`;
    candidate = `${cleaned.substring(0, 31 - sfx.length)}${sfx}`;
    suffix++;
  }
  usedNames.add(candidate);
  return candidate;
}

function formatIsoDate(d: Date): string {
  return formatDateTimeDDMMYYYY(d);
}

export function exportStudyToExcel(output: StudyAnalysisOutput): Uint8Array {
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  const durationHours = (output.end.getTime() - output.start.getTime()) / (3600 * 1000);
  const now = new Date();
  const reportId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // 1. Study Information Worksheet
  const infoRows = [
    ['Field', 'Value'],
    ['Study name', output.studyName.trim() || 'Not provided'],
    ['Unique report ID', reportId],
    ['Study start', formatIsoDate(output.start)],
    ['Study end', formatIsoDate(output.end)],
    ['Requested study start', formatIsoDate(output.requestedStart)],
    ['Requested study end', formatIsoDate(output.requestedEnd)],
    ['Total study duration (h)', parseFloat(durationHours.toFixed(4))],
    ['Sampling interval (min)', output.samplingIntervalMinutes],
    ['Analysis mode', output.mode === 'temperature' ? 'Temperature Only' : 'Temperature and Relative Humidity'],
    ['Acquisition system', output.acquisitionSystem],
    ['Sensor kit', output.sensorKit || 'Not applicable'],
    ['Temperature limits (°C)', `${output.temperatureLimits.lower} to ${output.temperatureLimits.upper}`],
    [
      'RH limits (%RH)',
      output.humidityLimits ? `${output.humidityLimits.lower} to ${output.humidityLimits.upper}` : 'Not applicable',
    ],
    [
      output.acquisitionSystem === 'Data Logger' ? 'Data Loggers included' : 'Sensors included',
      output.assignedSnapshots.length,
    ],
    ['Report generated', formatIsoDate(now)],
    ['Server timezone', 'Local timezone'],
    ['Software version', '1.0.0'],
    ['Expired certificate confirmation', output.expiredCertificateConfirmed ? 'Confirmed' : 'Not required'],
  ];

  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo['!cols'] = [{ wch: 36 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Study Information');
  usedSheetNames.add('Study Information');

  // 2. Temperature Results Worksheet
  const tempHeaders = [
    'Sensors',
    'MKT (°C)',
    'Min (°C)',
    'Max (°C)',
    'Mean',
    'Standard deviation',
    'Safe range',
    'Accumulated time below lower alert (min)',
    '% below lower alert',
    'Accumulated time above upper alert (min)',
    '% above upper alert',
  ];

  const tempRows = output.loggerResults.map((lr) => [
    lr.equipmentCode,
    parseFloat(lr.temperature.mean.toFixed(2)),
    parseFloat(lr.temperature.minimum.toFixed(2)),
    parseFloat(lr.temperature.maximum.toFixed(2)),
    parseFloat(output.globalTemperatureMean.toFixed(2)),
    parseFloat(lr.temperature.sample_standard_deviation.toFixed(3)),
    `${output.temperatureLimits.lower} to ${output.temperatureLimits.upper} °C`,
    parseFloat(lr.temperature.below_minutes.toFixed(1)),
    Math.round(lr.temperature.below_percent),
    parseFloat(lr.temperature.above_minutes.toFixed(1)),
    Math.round(lr.temperature.above_percent),
  ]);

  const wsTemp = XLSX.utils.aoa_to_sheet([tempHeaders, ...tempRows]);
  wsTemp['!cols'] = [
    { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 18 }, { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 32 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTemp, 'Temperature Results');
  usedSheetNames.add('Temperature Results');

  // 3. Relative Humidity Results Worksheet (when applicable)
  if (output.mode === 'temperature_and_humidity' && output.humidityLimits) {
    const humHeaders = [
      'Sensors',
      'Average corrected RH (%RH)',
      'Min (%RH)',
      'Max (%RH)',
      'Global Mean (%RH)',
      'Standard deviation',
      'Safe range',
      'Accumulated time below lower alert (min)',
      '% below lower alert',
      'Accumulated time above upper alert (min)',
      '% above upper alert',
    ];

    const humRows = output.loggerResults
      .filter((lr) => lr.humidity !== null)
      .map((lr) => [
        lr.equipmentCode,
        parseFloat(lr.humidity!.mean.toFixed(2)),
        parseFloat(lr.humidity!.minimum.toFixed(2)),
        parseFloat(lr.humidity!.maximum.toFixed(2)),
        output.globalHumidityMean !== null ? parseFloat(output.globalHumidityMean.toFixed(2)) : '',
        parseFloat(lr.humidity!.sample_standard_deviation.toFixed(3)),
        `${output.humidityLimits!.lower} to ${output.humidityLimits!.upper} %RH`,
        parseFloat(lr.humidity!.below_minutes.toFixed(1)),
        Math.round(lr.humidity!.below_percent),
        parseFloat(lr.humidity!.above_minutes.toFixed(1)),
        Math.round(lr.humidity!.above_percent),
      ]);

    const wsHum = XLSX.utils.aoa_to_sheet([humHeaders, ...humRows]);
    wsHum['!cols'] = [
      { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 20 },
      { wch: 18 }, { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 32 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, wsHum, 'Relative Humidity Results');
    usedSheetNames.add('Relative Humidity Results');
  }

  // 4. Equipment Information Worksheet
  const isDl = output.acquisitionSystem === 'Data Logger';
  const deviceSheetTitle = isDl ? 'Data Logger Information' : 'SuperDAQ Sensor Information';

  let deviceRows: unknown[][];
  if (isDl) {
    deviceRows = [
      ['No.', 'Reference Standard Description', 'Serial No.', 'Traceability', 'Cal. Date', 'Due Date'],
    ];
    output.assignedSnapshots.forEach((snap, idx) => {
      let desc = (snap.description || 'Data Logger').trim();
      if (!desc.toUpperCase().includes(snap.equipmentCode.toUpperCase())) {
        desc = `${desc} (${snap.equipmentCode})`;
      }
      deviceRows.push([
        idx + 1,
        desc,
        snap.serialNumber || '',
        snap.traceability || '',
        formatDateMMYYYY(snap.calibrationDate),
        formatDateMMYYYY(snap.dueDate),
      ]);
    });
  } else {
    deviceRows = [
      [
        'No.', 'Sensor Code', 'Sensor Name', 'SuperDAQ Channel', 'Position',
        'Serial No.', 'Traceability', 'Cal. Date', 'Due Date', 'Kit',
      ],
    ];
    output.assignedSnapshots.forEach((snap, idx) => {
      deviceRows.push([
        idx + 1,
        snap.equipmentCode,
        snap.sensorName || snap.description || 'PT100 Sensor',
        snap.sourceChannel || '',
        snap.position || '',
        snap.serialNumber || '',
        snap.traceability || '',
        formatDateMMYYYY(snap.calibrationDate),
        formatDateMMYYYY(snap.dueDate),
        output.sensorKit || '',
      ]);
    });
  }

  const wsDevice = XLSX.utils.aoa_to_sheet(deviceRows);
  wsDevice['!cols'] = [
    { wch: 8 }, { wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 20 },
    { wch: 24 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDevice, deviceSheetTitle);
  usedSheetNames.add(deviceSheetTitle);

  // 5. Calibration Snapshot Worksheet
  const calRows: unknown[][] = [
    ['Equipment / Sensor', 'Channel', 'Correction convention', 'Indication', 'Correction'],
  ];

  for (const snap of output.assignedSnapshots) {
    const channelName = snap.sourceChannel ? `Temperature (${snap.sourceChannel})` : 'Temperature';
    for (const pt of snap.temperatureCurve.points) {
      calRows.push([
        snap.equipmentCode,
        channelName,
        snap.temperatureCurve.convention,
        pt.indication,
        pt.correction,
      ]);
    }
    if (snap.humidityCurve) {
      for (const pt of snap.humidityCurve.points) {
        calRows.push([
          snap.equipmentCode,
          'Relative humidity',
          snap.humidityCurve.convention,
          pt.indication,
          pt.correction,
        ]);
      }
    }
  }

  const wsCal = XLSX.utils.aoa_to_sheet(calRows);
  wsCal['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 38 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsCal, 'Calibration Snapshot');
  usedSheetNames.add('Calibration Snapshot');

  // 6. Warnings and Validation Worksheet
  const warnRows: unknown[][] = [
    ['Type', 'Details'],
    ['Validation', 'All mandatory data validation checks passed.'],
  ];
  if (output.expiredCertificateConfirmed) {
    warnRows.push([
      'Calibration',
      'Expired certificate use was explicitly confirmed by the user; this does not establish metrological suitability.',
    ]);
  }
  for (const msg of output.warnings) {
    warnRows.push(['Warning', msg]);
  }

  const wsWarn = XLSX.utils.aoa_to_sheet(warnRows);
  wsWarn['!cols'] = [{ wch: 24 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wsWarn, 'Warnings and Validation');
  usedSheetNames.add('Warnings and Validation');

  // 7. Individual Sensor Worksheets (Time-series data with Date, Time, Corrected, Limits)
  for (const s of output.series) {
    const sensorHeaders = [
      'Date', 'Time', 'Date & Time',
      'Original Temperature (°C)', 'Temperature Correction (°C)', 'Corrected Temperature (°C)',
    ];
    if (output.mode === 'temperature_and_humidity') {
      sensorHeaders.push(
        'Original Relative Humidity (%RH)',
        'RH Correction (%RH)',
        'Corrected Relative Humidity (%RH)'
      );
    }
    sensorHeaders.push('LTL (°C)', 'UTL (°C)');
    if (output.mode === 'temperature_and_humidity' && output.humidityLimits) {
      sensorHeaders.push('LRL (%RH)', 'URL (%RH)');
    }

    const sensorDataRows: unknown[][] = [sensorHeaders];

    for (let i = 0; i < s.timestamps.length; i++) {
      const ts = s.timestamps[i];
      const dateStr = formatDateDDMMYYYY(ts);
      const timeStr = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
      const dateTimeStr = formatDateTimeDDMMYYYY(ts);

      const row: unknown[] = [
        dateStr,
        timeStr,
        dateTimeStr,
        s.originalTemperatures[i] ?? '',
        s.temperatureCorrections[i] ?? '',
        s.correctedTemperatures[i] ?? '',
      ];

      if (output.mode === 'temperature_and_humidity') {
        row.push(
          s.originalHumidities[i] ?? '',
          s.humidityCorrections[i] ?? '',
          s.correctedHumidities[i] ?? ''
        );
      }

      row.push(output.temperatureLimits.lower, output.temperatureLimits.upper);

      if (output.mode === 'temperature_and_humidity' && output.humidityLimits) {
        row.push(output.humidityLimits.lower, output.humidityLimits.upper);
      }

      sensorDataRows.push(row);
    }

    const sheetName = sanitizeSheetName(s.equipmentCode, usedSheetNames);
    const wsSensor = XLSX.utils.aoa_to_sheet(sensorDataRows);
    wsSensor['!cols'] = [
      { wch: 14 }, { wch: 12 }, { wch: 22 },
      { wch: 24 }, { wch: 26 }, { wch: 24 },
      { wch: 12 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSensor, sheetName);
  }

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Uint8Array(wbout);
}
