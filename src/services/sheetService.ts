import {
  EquipmentRecord,
  SensorKitRecord,
  SuperDaqSensorRecord,
  SettingsMap,
} from '../store/metrologyStore.ts';
import { CorrectionPoint } from '../utils/metrology.ts';

/**
 * Robust CSV parser that handles:
 * - Commas inside quoted values
 * - Multi-line cell values
 * - Escaped quotes ("")
 * - Empty cells and ragged rows
 */
export function parseRobustCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i++; // skip second quote
        } else {
          // End of quoted cell
          insideQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++; // skip \n in \r\n
        }
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentCell += char;
      }
    }
  }

  // Flush remaining buffer
  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Constructs the Google Visualization API CSV export URL for a target sheet.
 * Format: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet={SHEET_NAME}
 * Setting headers=1 prevents GViz from heuristically merging multiple data rows into row 1 as a header.
 */
export function buildSheetGvizUrl(spreadsheetId: string, sheetName: string): string {
  const cleanId = spreadsheetId.trim();
  const cleanSheet = encodeURIComponent(sheetName.trim());
  return `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&headers=1&sheet=${cleanSheet}`;
}

/**
 * Fetches raw CSV data from a specific tab in a public Google Spreadsheet
 * ("Anyone with the link – Viewer") and parses into an array of row objects.
 */
export async function fetchSheetData(
  spreadsheetId: string,
  sheetName: string
): Promise<Record<string, string>[]> {
  const url = buildSheetGvizUrl(spreadsheetId, sheetName);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch sheet "${sheetName}": HTTP ${resp.status} ${resp.statusText}`);
  }

  const rawText = await resp.text();

  // Detect Google login redirects or HTML error pages
  if (rawText.trim().startsWith('<!DOCTYPE') || rawText.includes('accounts.google.com') || rawText.includes('<html')) {
    throw new Error(
      `Google Sheet "${sheetName}" is not publicly readable. Please set sheet sharing to "Anyone with the link – Viewer".`
    );
  }

  const rawRows = parseRobustCsv(rawText);
  if (rawRows.length === 0) return [];

  const headers = rawRows[0].map((h) => h.trim());
  const objects: Record<string, string>[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0 || row.every((c) => !c)) continue;

    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) {
        rowObj[header] = row[idx] ?? '';
      }
    });
    objects.push(rowObj);
  }

  return objects;
}

/**
 * Normalize key names (remove underscores, spaces, lowercase)
 * e.g. "Equipment Code", "equipment_code", "EquipmentCode" all match "equipmentcode".
 */
export function findVal(row: Record<string, string>, ...candidateKeys: string[]): string {
  const normKeys = Object.keys(row).map((k) => ({
    original: k,
    normalized: k.toLowerCase().replace(/[^a-z0-9]/g, ''),
  }));

  for (const candidate of candidateKeys) {
    const targetNorm = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = normKeys.find((k) => k.normalized === targetNorm);
    if (match && row[match.original] !== undefined) {
      return String(row[match.original]).trim();
    }
  }
  return '';
}

export interface GoogleSheetsSyncResult {
  equipment: EquipmentRecord[];
  sensorKits: SensorKitRecord[];
  sensors: SuperDaqSensorRecord[];
  settings?: Partial<SettingsMap>;
  syncedAt: string;
  sourceSheetId: string;
  warnings: string[];
}

const INDICATION_REGEX = /^\s*Data\s*Logger\s*-\s*(DL\d+)\s*-\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%RH|C)\s*\)\s*$/i;
const SUPERDAQ_INDICATION_REGEX = /^\s*(?:\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*C\s*\)|([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*°?\s*C)\s*$/i;

/**
 * Helper to fetch a sheet trying primary and fallback tab names
 */
/**
 * Helper: Parses numeric values, supporting Arabic decimal comma (٫) and ASCII dot (.)
 */
export function parseCleanNumber(val: string): number {
  if (!val) return NaN;
  const normalized = val.replace(/٫/g, '.').replace(/[^\d.-]/g, '');
  return parseFloat(normalized);
}

/**
 * Normalizes varied date strings (e.g. DD/MM/YYYY, MM/DD/YYYY, D/M/YYYY) to standard ISO YYYY-MM-DD
 */
export function normalizeDateToIso(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parts = trimmed.split(/[/.-]/);
  if (parts.length === 3) {
    const [p1, p2, p3] = parts;
    if (p3.length === 4) {
      // In JNMI/RSS metrology sheets, standard order is DD/MM/YYYY
      const day = p1.padStart(2, '0');
      const month = p2.padStart(2, '0');
      return `${p3}-${month}-${day}`;
    }
    if (p1.length === 4) {
      return `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;
    }
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return trimmed;
}

/**
 * Helper to fetch a sheet trying candidate names and verifying headers.
 * This prevents Google GViz from silently returning the default/first sheet when a tab does not exist.
 */
async function fetchWithFallback(
  spreadsheetId: string,
  candidateNames: string[],
  isValid: (rows: Record<string, string>[]) => boolean
): Promise<{ rows: Record<string, string>[]; tabUsed: string }> {
  for (const name of candidateNames) {
    try {
      const rows = await fetchSheetData(spreadsheetId, name);
      if (rows && rows.length > 0 && isValid(rows)) {
        return { rows, tabUsed: name };
      }
    } catch {
      // continue to next candidate
    }
  }
  const fallbackRows = await fetchSheetData(spreadsheetId, candidateNames[0]);
  return { rows: fallbackRows, tabUsed: candidateNames[0] };
}

/**
 * Extracts clean Google Spreadsheet ID from either:
 * - Direct ID string (e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms)
 * - Full Google Sheets URL (https://docs.google.com/spreadsheets/d/1BxiMVs.../edit...)
 * - Retains Apps Script URL for contextual diagnostics
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return trimmed;
}

/**
 * Synchronizes all shared master data from Google Sheets:
 * - Data_Loggers / Data Loggers
 * - Data_Logger_Corrections / Data loggers corrections
 * - Sensor_Kits / Sensor Kits
 * - SuperDAQ_Sensors / Super DAQ
 * - SuperDAQ_Corrections / Super DAQ corrections
 * - Settings
 */
export async function syncAllSheetsData(inputSource: string): Promise<GoogleSheetsSyncResult> {
  const warnings: string[] = [];
  let spreadsheetId = extractSpreadsheetId(inputSource);

  // If input is an Apps Script Web App URL, attempt to query its info endpoint
  if (spreadsheetId.includes('script.google.com/macros/s/')) {
    try {
      const sep = spreadsheetId.includes('?') ? '&' : '?';
      const infoResp = await fetch(`${spreadsheetId}${sep}action=info`);
      if (infoResp.ok) {
        const infoText = await infoResp.text();
        if (infoText.trim().startsWith('{')) {
          const infoJson = JSON.parse(infoText);
          if (infoJson.spreadsheetId) {
            spreadsheetId = infoJson.spreadsheetId;
          }
        }
      }
    } catch {
      // Continue to validation below
    }

    if (spreadsheetId.includes('script.google.com')) {
      throw new Error(
        'The link provided is a Google Apps Script Web App deployment (/exec). Please provide your Google Spreadsheet URL (from https://docs.google.com/spreadsheets/d/...) or Spreadsheet ID, and ensure sharing is set to "Anyone with the link – Viewer".'
      );
    }
  }

  // 1. Fetch Data Loggers
  const { rows: dlRows } = await fetchWithFallback(
    spreadsheetId,
    ['Data Loggers', 'Data_Loggers', 'DataLoggers'],
    (rows) => rows.some((r) => findVal(r, 'equipment_code', 'equipment code', 'instrument description', 'code') !== '')
  );

  // 2. Fetch Data Logger Corrections
  let dlcRows: Record<string, string>[] = [];
  try {
    const res = await fetchWithFallback(
      spreadsheetId,
      ['Data loggers corrections', 'Data_Logger_Corrections', 'DataLoggerCorrections'],
      (rows) =>
        rows.length > 0 &&
        (rows.some((r) => {
          const keys = Object.keys(r);
          return keys.some((k) => k.includes('Data Logger') || k.includes('Indication') || k.includes('DL001'));
        }) || rows.some((r) => findVal(r, 'equipment_code', 'indication') !== ''))
    );
    dlcRows = res.rows;
  } catch (e) {
    warnings.push(`Could not fetch Data Logger Corrections tab: ${String(e)}`);
  }

  // 3. Fetch Sensor Kits
  let kitRows: Record<string, string>[] = [];
  try {
    const res = await fetchWithFallback(
      spreadsheetId,
      ['Sensor_Kits', 'Sensor Kits', 'Kits'],
      (rows) =>
        rows.length > 0 &&
        findVal(rows[0], 'superdaq_channel_identifier', 'superdaq channel identifier', 'channel_identifier') === '' &&
        rows.some((r) => findVal(r, 'kit_name', 'kit serial number', 'kit_serial_number') !== '')
    );
    // Only accept kitRows if it actually came from a dedicated kit tab and did not fallback to Super DAQ
    if (res.rows.length > 0 && findVal(res.rows[0], 'superdaq_channel_identifier', 'superdaq channel identifier') === '') {
      kitRows = res.rows;
    }
  } catch {
    // If separate kit sheet doesn't exist, we will synthesize from SuperDAQ sensors
  }

  // 4. Fetch SuperDAQ Sensors
  let sqSensorRows: Record<string, string>[] = [];
  try {
    const res = await fetchWithFallback(
      spreadsheetId,
      ['Super DAQ', 'SuperDAQ_Sensors', 'SuperDAQ', 'Super DAQ Sensors'],
      (rows) => rows.some((r) => findVal(r, 'channel_identifier', 'superdaq channel identifier', 'sensor_code') !== '')
    );
    sqSensorRows = res.rows;
  } catch (e) {
    warnings.push(`Could not fetch SuperDAQ Sensors tab: ${String(e)}`);
  }

  // 5. Fetch SuperDAQ Corrections
  let sqCorrRows: Record<string, string>[] = [];
  try {
    const res = await fetchWithFallback(
      spreadsheetId,
      ['Super DAQ corrections', 'SuperDAQ_Corrections', 'SuperDAQCorrections'],
      (rows) => rows.some((r) => findVal(r, 'channel_identifier', 'superdaq channel identifier', 'indication') !== '')
    );
    sqCorrRows = res.rows;
  } catch (e) {
    warnings.push(`Could not fetch SuperDAQ Corrections tab: ${String(e)}`);
  }

  // 6. Fetch Settings (Optional)
  let settingsRows: Record<string, string>[] = [];
  try {
    settingsRows = await fetchSheetData(spreadsheetId, 'Settings');
  } catch {
    // Settings tab optional
  }

  // --- Process Data Logger Corrections ---
  // Structure: Map<equipmentCode, { temp: CorrectionPoint[], rh: CorrectionPoint[] }>
  const dlPoints = new Map<string, { temp: CorrectionPoint[]; rh: CorrectionPoint[] }>();

  // Check if first row keys contain composite multi-point headers (e.g. DL001 calibration curve)
  if (dlcRows.length > 0) {
    const keys = Object.keys(dlcRows[0]);
    const header0 = keys[0] || '';
    const header1 = keys[1] || '';

    if (header0.includes('Data Logger') && header1.includes('Correction')) {
      const matches = [...header0.matchAll(/Data\s*Logger\s*-\s*(DL\d+)\s*-\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(%RH|C)\s*\)/gi)];
      const corrNumbers = header1.replace(/Correction/i, '').trim().split(/\s+/).map((n) => parseCleanNumber(n));
      matches.forEach((m, idx) => {
        const code = m[1].toUpperCase();
        const numInd = parseFloat(m[2]);
        const unit = m[3].toUpperCase();
        const numCorr = corrNumbers[idx];
        if (Number.isFinite(numInd) && Number.isFinite(numCorr)) {
          if (!dlPoints.has(code)) dlPoints.set(code, { temp: [], rh: [] });
          if (unit === 'C') {
            dlPoints.get(code)!.temp.push({ indication: numInd, correction: numCorr });
          } else {
            dlPoints.get(code)!.rh.push({ indication: numInd, correction: numCorr });
          }
        }
      });
    }
  }

  for (const row of dlcRows) {
    // Try normalized schema first: Equipment_Code, Measurement_Type, Indication, Correction
    let code = findVal(row, 'equipment_code', 'equipment code', 'equipment id', 'equipment_id', 'code').toUpperCase();
    const typeStr = findVal(row, 'measurement_type', 'type', 'channel').toLowerCase();
    const values = Object.values(row);
    const rawInd = findVal(row, 'indication', 'indication (°c)', 'indication (%rh)', 'nominal') || values[0] || '';
    const rawCorr = findVal(row, 'correction', 'correction (°c)', 'correction (%rh)', 'error') || values[1] || '';
    const rawUnit = findVal(row, 'unit').toLowerCase();

    // If Indication column has the composite label format: "Data Logger  - DL001 - (-20 C)"
    if (rawInd) {
      const match = rawInd.match(INDICATION_REGEX);
      if (match) {
        code = match[1].toUpperCase();
        const numInd = parseCleanNumber(match[2]);
        const unit = match[3].toUpperCase();
        const numCorr = parseCleanNumber(rawCorr);
        if (Number.isFinite(numInd) && Number.isFinite(numCorr)) {
          if (!dlPoints.has(code)) dlPoints.set(code, { temp: [], rh: [] });
          if (unit === 'C') {
            dlPoints.get(code)!.temp.push({ indication: numInd, correction: numCorr });
          } else {
            dlPoints.get(code)!.rh.push({ indication: numInd, correction: numCorr });
          }
          continue;
        }
      }
    }

    // Standard normalized row
    if (code && rawInd && rawCorr) {
      const numInd = parseCleanNumber(rawInd);
      const numCorr = parseCleanNumber(rawCorr);
      if (Number.isFinite(numInd) && Number.isFinite(numCorr)) {
        if (!dlPoints.has(code)) dlPoints.set(code, { temp: [], rh: [] });
        const isRh = typeStr.includes('humid') || rawUnit.includes('rh') || rawUnit.includes('%');
        if (isRh) {
          dlPoints.get(code)!.rh.push({ indication: numInd, correction: numCorr });
        } else {
          dlPoints.get(code)!.temp.push({ indication: numInd, correction: numCorr });
        }
      }
    }
  }

  // Build EquipmentRecord[] (deduplicated by equipment_code)
  const equipment: EquipmentRecord[] = [];
  const seenEquipmentCodes = new Set<string>();
  for (const row of dlRows) {
    const code = findVal(row, 'equipment_code', 'equipment code', 'code').toUpperCase();
    if (!code || seenEquipmentCodes.has(code)) continue;
    seenEquipmentCodes.add(code);

    const desc = findVal(row, 'description', 'instrument description', 'name') || `Data Logger (${code})`;
    const sn = findVal(row, 'serial_number', 'serial number', 'serial');
    const mfg = findVal(row, 'manufacturer', 'make') || 'Testo';
    const trace = findVal(row, 'traceability', 'Traceability', 'trace') || 'UME/Turkey';
    const calDate = normalizeDateToIso(
      findVal(row, 'calibration_date', 'Calibration Date', 'calibration date', 'cal date', 'cal_date', 'calibration')
    );
    const dueDate = normalizeDateToIso(
      findVal(
        row,
        'calibration_due_date',
        'Calibration Due Date',
        'calibration due date',
        'due date',
        'due_date',
        'cal due date',
        'cal_due_date',
        'cal due',
        'expiry_date'
      )
    );
    const notes = findVal(row, 'notes', 'comments');

    const pts = dlPoints.get(code);
    const tempPts = pts ? pts.temp.sort((a, b) => a.indication - b.indication) : [];
    const rhPts = pts ? pts.rh.sort((a, b) => a.indication - b.indication) : [];

    equipment.push({
      equipment_code: code,
      description: desc,
      serial_number: sn,
      manufacturer: mfg,
      traceability: trace,
      temperature_enabled: 1,
      humidity_enabled: rhPts.length > 0 ? 1 : 0,
      notes: notes || 'Synchronized from Google Sheets',
      calibration_date: calDate,
      due_date: dueDate,
      temperature_convention: 'indication_plus_correction',
      temperature_points_json: JSON.stringify(tempPts),
      humidity_convention: rhPts.length > 0 ? 'indication_plus_correction' : '',
      humidity_points_json: JSON.stringify(rhPts),
      updated_at: new Date().toISOString(),
    });
  }

  // --- Process SuperDAQ Corrections ---
  // Structure: Map<compositeKeyOrChannel, CorrectionPoint[]>
  // Supports composite key by both Kit Name/Description AND Kit Serial Number:
  // e.g. `${normKitName}_${chClean}` and `${rawKitSn}_${chClean}`
  const sqPoints = new Map<string, CorrectionPoint[]>();

  for (const row of sqCorrRows) {
    const rawKitName = findVal(row, 'kit_name', 'kit name / description', 'kit description', 'name').trim();
    const rawKitSn = findVal(row, 'kit_serial_number', 'kit serial number', 'kit serial', 'serial_number').trim();
    const ch = findVal(
      row,
      'channel_identifier',
      'superdaq channel identifier',
      'channel',
      'sensor_id'
    ).toLowerCase().replace(/\s+/g, '');
    const rawInd = findVal(row, 'indication', 'indication (°c)', 'nominal');
    const rawCorr = findVal(row, 'correction', 'correction (°c)', 'error');

    if (!ch || !rawInd || !rawCorr) continue;

    let numInd = parseCleanNumber(rawInd);
    const indMatch = rawInd.match(SUPERDAQ_INDICATION_REGEX);
    if (indMatch) {
      numInd = parseCleanNumber(indMatch[1] || indMatch[2]);
    }

    const numCorr = parseCleanNumber(rawCorr);
    if (Number.isFinite(numInd) && Number.isFinite(numCorr)) {
      const cleanCh = ch.replace(/\([^)]*\)/g, '');
      const point = { indication: numInd, correction: numCorr };

      // 1. Composite key by Kit Name / Description (Primary requested linkage)
      if (rawKitName) {
        const normKitName = rawKitName.toLowerCase().replace(/\s+/g, '');
        const nameKey = `${normKitName}_${ch}`;
        if (!sqPoints.has(nameKey)) sqPoints.set(nameKey, []);
        sqPoints.get(nameKey)!.push(point);

        if (cleanCh && cleanCh !== ch) {
          const nameCleanKey = `${normKitName}_${cleanCh}`;
          if (!sqPoints.has(nameCleanKey)) sqPoints.set(nameCleanKey, []);
          sqPoints.get(nameCleanKey)!.push(point);
        }
      }

      // 2. Composite key with Kit Serial Number
      if (rawKitSn) {
        const compKey = `${rawKitSn}_${ch}`;
        if (!sqPoints.has(compKey)) sqPoints.set(compKey, []);
        sqPoints.get(compKey)!.push(point);

        if (cleanCh && cleanCh !== ch) {
          const compCleanKey = `${rawKitSn}_${cleanCh}`;
          if (!sqPoints.has(compCleanKey)) sqPoints.set(compCleanKey, []);
          sqPoints.get(compCleanKey)!.push(point);
        }
      }

      // 3. Fallback channel key ONLY for legacy rows that specify neither kit name nor kit serial.
      // Prevents one kit's calibration points from leaking onto another kit sharing the same channel IDs (e.g. Ch 101 (C)).
      if (!rawKitName && !rawKitSn) {
        if (!sqPoints.has(ch)) sqPoints.set(ch, []);
        sqPoints.get(ch)!.push(point);

        if (cleanCh && cleanCh !== ch) {
          if (!sqPoints.has(cleanCh)) sqPoints.set(cleanCh, []);
          sqPoints.get(cleanCh)!.push(point);
        }
      }
    }
  }

  // Build SensorKitRecord[] and SuperDaqSensorRecord[]
  const kitMap = new Map<string, SensorKitRecord>();

  // 1. Process dedicated kit sheet if available
  if (kitRows.length > 0) {
    for (const row of kitRows) {
      const kitSn = findVal(row, 'kit_serial_number', 'kit serial number', 'serial_number');
      const kitName = findVal(row, 'kit_name', 'kit name / description', 'name') || 'Super DAQ System with PT100 Sensors';
      const kitCode = kitSn
        ? `KIT_${kitSn.replace(/[^a-zA-Z0-9_-]/g, '')}`
        : `KIT_${kitName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const status = findVal(row, 'status') === 'Inactive' ? 'Inactive' : 'Active';
      const notes = findVal(row, 'notes');

      if (!kitMap.has(kitCode)) {
        kitMap.set(kitCode, {
          kit_code: kitCode,
          name: kitName,
          serial_number: kitSn || 'Pending S/N',
          status,
          notes: notes || 'Synchronized from Google Sheets',
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  // 2. Discover and assign kits from SuperDAQ sensor rows
  let unassignedKitCounter = 1;
  let currentUnassignedKitCode: string | null = null;
  let lastKitSerial: string | null = null;
  const rowKitAssignments: string[] = [];

  for (let r = 0; r < sqSensorRows.length; r++) {
    const row = sqSensorRows[r];
    const rawKitName = findVal(row, 'kit_name', 'kit name / description', 'kit description', 'name');
    const rawKitSn = findVal(row, 'kit_serial_number', 'kit serial number', 'kit serial');

    if (rawKitSn) {
      const kitCode = `KIT_${rawKitSn.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      if (!kitMap.has(kitCode)) {
        kitMap.set(kitCode, {
          kit_code: kitCode,
          name: rawKitName || `Super DAQ System with PT100 Sensors`,
          serial_number: rawKitSn,
          status: 'Active',
          notes: 'Synchronized from Google Sheets',
          updated_at: new Date().toISOString(),
        });
      }
      rowKitAssignments[r] = kitCode;
      lastKitSerial = rawKitSn;
    } else {
      // Row has no Kit Serial Number (e.g. user added a new kit row or left serial blank)
      if (!currentUnassignedKitCode || lastKitSerial !== null) {
        unassignedKitCounter++;
        currentUnassignedKitCode = `KIT_AUTO_${unassignedKitCounter}`;
        const kitName = rawKitName
          ? `${rawKitName} (Kit ${unassignedKitCounter})`
          : `Super DAQ System with PT100 Sensors (Kit ${unassignedKitCounter})`;
        kitMap.set(currentUnassignedKitCode, {
          kit_code: currentUnassignedKitCode,
          name: kitName,
          serial_number: 'Pending S/N',
          status: 'Active',
          notes: 'Synchronized from Google Sheets (Empty Kit Serial Number - please enter S/N in column B)',
          updated_at: new Date().toISOString(),
        });
      }
      rowKitAssignments[r] = currentUnassignedKitCode;
      lastKitSerial = null;
    }
  }

  // 3. Extract SuperDAQ Sensors linked to their respective kits
  const sensors: SuperDaqSensorRecord[] = [];
  const seenSensorCodes = new Set<string>();

  for (let r = 0; r < sqSensorRows.length; r++) {
    const row = sqSensorRows[r];
    const chId = findVal(row, 'channel_identifier', 'superdaq channel identifier', 'channel');
    if (!chId) continue;

    const kitCode = rowKitAssignments[r] || 'KIT_44070036';
    const rawCode = findVal(row, 'sensor_code', 'sensor code').trim();
    const sCode = rawCode
      ? rawCode.toUpperCase().startsWith(`${kitCode.toUpperCase()}_`)
        ? rawCode
        : `${kitCode}_${rawCode}`
      : `${kitCode}_${chId.replace(/[^a-zA-Z0-9]/g, '')}`;

    if (seenSensorCodes.has(sCode)) continue;
    seenSensorCodes.add(sCode);

    const name = findVal(row, 'sensor_name', 'name') || 'Resistance Thermometer (PT 100)';
    const sn = findVal(row, 'serial_number', 'serial number', 'serial');
    const pos = findVal(row, 'position', 'location');
    const calDate = normalizeDateToIso(
      findVal(row, 'calibration_date', 'Calibration Date', 'calibration date', 'cal date', 'cal_date')
    );
    const dueDate = normalizeDateToIso(
      findVal(
        row,
        'calibration_due_date',
        'Calibration Due Date',
        'calibration due date',
        'due date',
        'due_date',
        'cal due date',
        'cal_due'
      )
    );
    const trace = findVal(row, 'traceability', 'Traceability') || 'UME/Turkey';

    const rawKitName = findVal(row, 'kit_name', 'kit name / description', 'kit description', 'name').trim();
    const rawKitSn = findVal(row, 'kit_serial_number', 'kit serial number', 'kit serial').trim();
    const kitObj = kitMap.get(kitCode);
    const resolvedKitName = rawKitName || kitObj?.name || '';
    const resolvedKitSn = rawKitSn || kitObj?.serial_number || '';

    const chKey = chId.toLowerCase().replace(/\s+/g, '');
    const cleanChKey = chKey.replace(/\([^)]*\)/g, '');

    // Composite key lookup:
    // 1. Prioritize Kit Name / Description (primary link)
    let pts: CorrectionPoint[] = [];
    if (resolvedKitName) {
      const normKitName = resolvedKitName.toLowerCase().replace(/\s+/g, '');
      pts =
        sqPoints.get(`${normKitName}_${chKey}`) ||
        sqPoints.get(`${normKitName}_${cleanChKey}`) ||
        [];
    }
    // 2. Secondary: Prioritize Kit Serial Number if points exist under S/N
    if (pts.length === 0 && resolvedKitSn) {
      pts =
        sqPoints.get(`${resolvedKitSn}_${chKey}`) ||
        sqPoints.get(`${resolvedKitSn}_${cleanChKey}`) ||
        [];
    }
    // 3. Fallback if no kit-specific points were matched
    if (pts.length === 0) {
      pts = sqPoints.get(chKey) || sqPoints.get(cleanChKey) || [];
    }
    pts.sort((a, b) => a.indication - b.indication);

    sensors.push({
      sensor_code: sCode,
      kit_code: kitCode,
      name,
      channel_identifier: chId,
      serial_number: sn,
      position: pos,
      calibration_date: calDate,
      due_date: dueDate,
      certificate_number: '',
      provider: '',
      traceability: trace,
      temperature_convention: 'indication_plus_correction',
      temperature_points_json: JSON.stringify(pts),
      notes: 'Synchronized from Google Sheets',
      updated_at: new Date().toISOString(),
    });
  }

  const sensorKits: SensorKitRecord[] = Array.from(kitMap.values());

  // Process Settings (optional)
  const settings: Partial<SettingsMap> = {};
  for (const row of settingsRows) {
    const key = findVal(row, 'setting_key', 'key', 'name');
    const val = findVal(row, 'setting_value', 'value');
    if (key && val) {
      if (key === 'application_name') settings.application_name = val;
      if (key === 'report_directory') settings.report_directory = val;
      if (key === 'session_timeout_minutes') settings.session_timeout_minutes = val;
    }
  }

  return {
    equipment,
    sensorKits,
    sensors,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
    syncedAt: new Date().toISOString(),
    sourceSheetId: spreadsheetId,
    warnings,
  };
}

export interface RemoteMutationResult {
  success: boolean;
  message?: string;
}

/**
 * Sends a mutation (add/update/delete) directly to the Google Sheet via the deployed Google Apps Script Web App.
 * Uses text/plain to avoid CORS preflight, with GET fallback.
 */
export async function mutateGoogleSheet(
  action: string,
  payload: Record<string, unknown>,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  const url = webAppUrl?.trim();
  if (!url) {
    return {
      success: false,
      message: 'No Google Apps Script Web App URL configured. Please set the Web App URL in Application Settings to enable live two-way sync.',
    };
  }

  const dataToSend = { action, ...payload };

  // 1. Try POST with text/plain (CORS-friendly for Google Apps Script Web Apps)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(dataToSend),
    });

    if (resp.ok) {
      const text = await resp.text();
      try {
        const json = JSON.parse(text);
        return {
          success: json.status === 'success',
          message: json.message || 'Updated successfully in Google Sheet.',
        };
      } catch {
        return { success: true, message: 'Google Sheet mutation received.' };
      }
    }
  } catch (err) {
    console.warn('POST failed for Google Apps Script Web App, attempting GET fallback...', err);
  }

  // 2. Fallback to GET with JSON payload in query parameter
  try {
    const encoded = encodeURIComponent(JSON.stringify(dataToSend));
    const sep = url.includes('?') ? '&' : '?';
    const resp = await fetch(`${url}${sep}action=${encodeURIComponent(action)}&payload=${encoded}`);
    if (resp.ok) {
      const text = await resp.text();
      try {
        const json = JSON.parse(text);
        return {
          success: json.status === 'success',
          message: json.message || 'Updated successfully in Google Sheet.',
        };
      } catch {
        return { success: true, message: 'Google Sheet mutation received.' };
      }
    }
  } catch (err) {
    console.error('All mutation attempts to Google Apps Script failed:', err);
    return {
      success: false,
      message: `Failed to connect to Google Sheet Web App: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { success: false, message: 'Could not update Google Sheet.' };
}

export async function saveEquipmentToRemoteSheet(
  record: EquipmentRecord,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  let tempPts: CorrectionPoint[] = [];
  let humPts: CorrectionPoint[] = [];
  try {
    tempPts = JSON.parse(record.temperature_points_json || '[]');
  } catch {}
  try {
    humPts = JSON.parse(record.humidity_points_json || '[]');
  } catch {}

  return mutateGoogleSheet(
    'save_equipment',
    {
      record: {
        equipment_code: record.equipment_code,
        description: record.description,
        serial_number: record.serial_number,
        manufacturer: record.manufacturer,
        traceability: record.traceability,
        calibration_date: record.calibration_date,
        due_date: record.due_date,
        notes: record.notes,
        temperature_points: tempPts,
        humidity_points: humPts,
      },
    },
    webAppUrl
  );
}

export async function deleteEquipmentFromRemoteSheet(
  equipmentCode: string,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  return mutateGoogleSheet(
    'delete_equipment',
    { equipment_code: equipmentCode },
    webAppUrl
  );
}

export async function saveKitToRemoteSheet(
  kit: SensorKitRecord,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  return mutateGoogleSheet('save_kit', { kit }, webAppUrl);
}

export async function deleteKitFromRemoteSheet(
  kitCode: string,
  serialNumber?: string,
  kitName?: string,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  return mutateGoogleSheet(
    'delete_kit',
    { kit_code: kitCode, serial_number: serialNumber, kit_name: kitName },
    webAppUrl
  );
}

export async function saveSensorToRemoteSheet(
  sensor: SuperDaqSensorRecord,
  kitName?: string,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  let pts: CorrectionPoint[] = [];
  try {
    pts = JSON.parse(sensor.temperature_points_json || '[]');
  } catch {}

  return mutateGoogleSheet(
    'save_sensor',
    {
      sensor: {
        sensor_code: sensor.sensor_code,
        kit_code: sensor.kit_code,
        kit_name: kitName || '',
        kit_serial_number: sensor.kit_code.replace(/^KIT_/, ''),
        channel_identifier: sensor.channel_identifier,
        name: sensor.name,
        serial_number: sensor.serial_number,
        position: sensor.position,
        calibration_date: sensor.calibration_date,
        due_date: sensor.due_date,
        traceability: sensor.traceability,
        temperature_points: pts,
      },
    },
    webAppUrl
  );
}

export async function deleteSensorFromRemoteSheet(
  sensorCode: string,
  channelId?: string,
  kitName?: string,
  webAppUrl?: string
): Promise<RemoteMutationResult> {
  return mutateGoogleSheet(
    'delete_sensor',
    { sensor_code: sensorCode, channel_identifier: channelId, kit_name: kitName },
    webAppUrl
  );
}

