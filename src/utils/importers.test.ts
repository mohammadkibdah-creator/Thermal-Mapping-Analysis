import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as XLSX from 'xlsx';
import {
  parseDataLoggerFile,
  parseSuperDaqFile,
  parseEquipmentWorkbook,
  parseSuperDaqEquipmentWorkbook,
  runMetrologyStudyAnalysis,
  exportStudyToExcel,
} from './importers.ts';
import { CalibrationCurve } from './metrology.ts';

test('parseDataLoggerFile parses Report_Table.xls and detects DL001', () => {
  const buf = fs.readFileSync('public/Report_Table.xls');
  const parsed = parseDataLoggerFile(buf, 'Report_Table.xls');

  assert.equal(parsed.instrumentCode, 'DL001');
  assert.equal(parsed.readings.length > 500, true);
  const firstReading = parsed.readings[0];
  assert.equal(firstReading.timestamp instanceof Date, true);
  assert.equal(typeof firstReading.temperature, 'number');
});

test('parseSuperDaqFile parses dat00001.xlsx and extracts multiple channels', () => {
  const buf = fs.readFileSync('public/dat00001.xlsx');
  const parsed = parseSuperDaqFile(buf, 'dat00001.xlsx');

  const channelKeys = Object.keys(parsed.channels);
  assert.equal(channelKeys.length > 5, true);
  assert.equal(channelKeys.includes('Ch 101 (C)'), true);
  const ch101 = parsed.channels['Ch 101 (C)'];
  assert.equal(ch101.length > 10, true);
  assert.equal(ch101[0].timestamp instanceof Date, true);
  assert.equal(typeof ch101[0].temperature, 'number');
});

test('parseEquipmentWorkbook parses data logger data.xlsx with full calibration curves', () => {
  const buf = fs.readFileSync('public/data logger data.xlsx');
  const preview = parseEquipmentWorkbook(buf);

  assert.equal(preview.equipment.length > 0, true);
  const dl001 = preview.equipment.find((eq) => eq.equipment_code === 'DL001');
  assert.equal(Boolean(dl001), true);
  assert.equal(dl001!.serial_number, '84435686');
  assert.equal(dl001!.manufacturer, 'Testo');
  assert.equal(dl001!.traceability, 'UME/Turkey');
  assert.equal(dl001!.calibration_date, '2026-01-01');
  assert.equal(dl001!.due_date, '2028-01-01');

  // Multi-point curves
  assert.equal(dl001!.temperature_points.length >= 2, true);
  assert.equal(dl001!.humidity_points.length >= 2, true);
  assert.equal(preview.issues.length, 0);
  assert.equal(preview.can_import, true);
});

test('parseSuperDaqEquipmentWorkbook parses SuperDaq Data.xlsx with multi-point curves', () => {
  const buf = fs.readFileSync('public/SuperDaq Data.xlsx');
  const preview = parseSuperDaqEquipmentWorkbook(buf);

  assert.equal(preview.kit.serial_number, '44070036');
  assert.equal(preview.kit.name.includes('Super DAQ'), true);
  assert.equal(preview.sensors.length >= 9, true);

  const firstSensor = preview.sensors[0];
  assert.equal(firstSensor.channel_identifier, 'Ch 101 (C)');
  assert.equal(firstSensor.temperature_points.length >= 10, true);
  assert.equal(preview.issues.length, 0);
  assert.equal(preview.can_import, true);
});

test('runMetrologyStudyAnalysis and exportStudyToExcel produce complete 7-worksheet JNMI report', () => {
  const buf = fs.readFileSync('public/Report_Table.xls');
  const parsed = parseDataLoggerFile(buf, 'Report_Table.xls');

  const tempCurve = new CalibrationCurve(
    [
      { indication: 10, correction: 0.2 },
      { indication: 25, correction: 0.1 },
    ],
    'indication_plus_correction'
  );

  const humCurve = new CalibrationCurve(
    [
      { indication: 20, correction: -0.5 },
      { indication: 80, correction: 0.8 },
    ],
    'indication_plus_correction'
  );

  const reqStart = parsed.readings[0].timestamp;
  const reqEnd = parsed.readings[20].timestamp;

  const analysisOutput = runMetrologyStudyAnalysis({
    studyName: 'Sample JNMI Mapping Study',
    requestedStart: reqStart,
    requestedEnd: reqEnd,
    samplingIntervalMinutes: 15,
    mode: 'temperature_and_humidity',
    temperatureLimits: { lower: 15, upper: 25 },
    humidityLimits: { lower: 30, upper: 65 },
    acquisitionSystem: 'data_logger',
    assignedLoggers: [
      {
        equipmentCode: 'DL001',
        description: 'Testo 174H Data Logger (DL001)',
        serialNumber: '84435686',
        traceability: 'UME/Turkey',
        calibrationDate: '2026-01-01',
        dueDate: '2028-01-01',
        readings: parsed.readings,
        temperatureCurve: tempCurve,
        humidityCurve: humCurve,
      },
    ],
  });

  assert.equal(analysisOutput.loggerResults.length, 1);
  assert.equal(analysisOutput.loggerResults[0].equipmentCode, 'DL001');

  // Export to Excel
  const excelBytes = exportStudyToExcel(analysisOutput);
  assert.equal(excelBytes.length > 1000, true);

  // Read back generated workbook and assert all 7 sheets
  const generatedWb = XLSX.read(excelBytes, { type: 'array' });
  const sheetNames = generatedWb.SheetNames;

  assert.equal(sheetNames.includes('Study Information'), true);
  assert.equal(sheetNames.includes('Temperature Results'), true);
  assert.equal(sheetNames.includes('Relative Humidity Results'), true);
  assert.equal(sheetNames.includes('Data Logger Information'), true);
  assert.equal(sheetNames.includes('Calibration Snapshot'), true);
  assert.equal(sheetNames.includes('Warnings and Validation'), true);
  assert.equal(sheetNames.includes('DL001'), true);

  // Inspect Study Information sheet contents
  const infoSheet = generatedWb.Sheets['Study Information'];
  const infoRows: unknown[][] = XLSX.utils.sheet_to_json(infoSheet, { header: 1 });
  assert.equal(infoRows[0][0], 'Field');
  assert.equal(infoRows[0][1], 'Value');
  const fieldNames = infoRows.map((r) => r[0]);
  assert.equal(fieldNames.includes('Study name'), true);
  assert.equal(fieldNames.includes('Unique report ID'), true);
  assert.equal(fieldNames.includes('Study start'), true);
  assert.equal(fieldNames.includes('Study end'), true);
  assert.equal(fieldNames.includes('Requested study start'), true);
  assert.equal(fieldNames.includes('Total study duration (h)'), true);
  assert.equal(fieldNames.includes('Software version'), true);

  // Inspect Temperature Results sheet headers
  const tempSheet = generatedWb.Sheets['Temperature Results'];
  const tempHeaders: string[] = XLSX.utils.sheet_to_json(tempSheet, { header: 1 })[0] as string[];
  assert.equal(tempHeaders[0], 'Sensors');
  assert.equal(tempHeaders[1], 'MKT (°C)');
  assert.equal(tempHeaders[4], 'Mean');
  assert.equal(tempHeaders[5], 'Standard deviation');
  assert.equal(tempHeaders[6], 'Safe range');
});

import { exportStudyReportWorkbook, exportSuperDaqRegistryWorkbook } from './excelExport.ts';

test('exportStudyReportWorkbook creates Summary, Humidity Summary, and per-sensor Temp + RH sheets', async () => {
  const buf = fs.readFileSync('public/Report_Table.xls');
  const parsed = parseDataLoggerFile(buf, 'Report_Table.xls');

  const tempCurve = new CalibrationCurve(
    [
      { indication: 10, correction: 0.2 },
      { indication: 25, correction: 0.1 },
    ],
    'indication_plus_correction'
  );
  const humCurve = new CalibrationCurve(
    [
      { indication: 20, correction: -0.5 },
      { indication: 80, correction: 0.8 },
    ],
    'indication_plus_correction'
  );

  const reqStart = parsed.readings[0].timestamp;
  const reqEnd = parsed.readings[20].timestamp;

  const analysisOutput = runMetrologyStudyAnalysis({
    studyName: 'ExcelJS Report Verification',
    requestedStart: reqStart,
    requestedEnd: reqEnd,
    samplingIntervalMinutes: 15,
    mode: 'temperature_and_humidity',
    temperatureLimits: { lower: 15, upper: 25 },
    humidityLimits: { lower: 30, upper: 65 },
    acquisitionSystem: 'data_logger',
    assignedLoggers: [
      {
        equipmentCode: 'DL001',
        description: 'Testo 174H',
        serialNumber: '84435686',
        traceability: 'UME/Turkey',
        calibrationDate: '2026-01-01',
        dueDate: '2028-01-01',
        readings: parsed.readings,
        temperatureCurve: tempCurve,
        humidityCurve: humCurve,
      },
    ],
  });

  assert.equal(analysisOutput.hotSpotCode, 'DL001');
  assert.equal(analysisOutput.coldSpotCode, 'DL001');

  const xlsxBytes = await exportStudyReportWorkbook(analysisOutput);
  assert.equal(xlsxBytes.length > 5000, true);

  const wb = XLSX.read(xlsxBytes, { type: 'array' });
  assert.equal(wb.SheetNames.includes('Summary'), true);
  assert.equal(wb.SheetNames.includes('Humidity Summary'), true);
  assert.equal(wb.SheetNames.includes('DL001'), true);
  assert.equal(wb.SheetNames.includes('DL001 RH'), true);
  assert.equal(wb.SheetNames.includes('Equipment Information'), true);
  assert.equal(wb.SheetNames.includes('Calibration Snapshot'), true);

  // Verify DL001 sheet has header at row 8 and all 21 readings with Date, Time, and Date & Time
  const dlRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['DL001'], { header: 1 });
  assert.equal(dlRows[7][0], 'No.');
  assert.equal(dlRows[7][1], 'Date (DD/MM/YYYY)');
  assert.equal(String(dlRows[7][2]).startsWith('Time'), true);
  assert.equal(String(dlRows[7][3]).startsWith('Date & Time'), true);
  assert.equal(dlRows[7][4], 'Raw Temperature (°C)');
  assert.equal(dlRows[7][6], 'Corrected Temperature (°C)');
  const readingRows = dlRows.slice(8).filter((r) => typeof r[0] === 'number');
  assert.equal(readingRows.length, analysisOutput.series[0].timestamps.length);
  assert.equal(readingRows[0][0], 1);
  assert.equal(readingRows[readingRows.length - 1][0], 21);

  // Verify DL001 RH sheet also has all 21 readings starting at row 8/9
  const rhRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['DL001 RH'], { header: 1 });
  assert.equal(rhRows[7][1], 'Date (DD/MM/YYYY)');
  const rhReadingRows = rhRows.slice(8).filter((r) => typeof r[0] === 'number');
  assert.equal(rhReadingRows.length, analysisOutput.series[0].timestamps.length);

  // Verify Uniformity and Stability are excluded from Summary and Humidity Summary
  const summaryRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1 });
  const summaryText = JSON.stringify(summaryRows);
  assert.equal(summaryText.includes('Uniformity'), false);
  assert.equal(summaryText.includes('Stability'), false);

  const humSummaryRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['Humidity Summary'], { header: 1 });
  const humSummaryText = JSON.stringify(humSummaryRows);
  assert.equal(humSummaryText.includes('Uniformity'), false);
  assert.equal(humSummaryText.includes('Stability'), false);

  // Verify Cal. Date and Due Date in Equipment Information and per-sensor sheets use MM/YYYY (no day)
  const eqRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['Equipment Information'], { header: 1 });
  assert.equal(eqRows[1][5], '01/2026');
  assert.equal(eqRows[1][6], '01/2028');
  assert.equal(dlRows[5][5], '01/2026 / 01/2028');

  // Verify SuperDAQ study report also formats Cal. Date and Due Date as MM/YYYY (no day)
  const sdOutput = runMetrologyStudyAnalysis({
    studyName: 'SuperDAQ Cal Date Check',
    requestedStart: reqStart,
    requestedEnd: reqEnd,
    samplingIntervalMinutes: 15,
    mode: 'temperature',
    temperatureLimits: { lower: 15, upper: 25 },
    acquisitionSystem: 'fluke_superdaq',
    sensorKit: 'Super DAQ',
    assignedLoggers: [
      {
        equipmentCode: 'KIT_44070036_CH102',
        description: 'Resistance Thermometer (PT 100)',
        sensorName: 'Resistance Thermometer (PT 100)',
        sourceChannel: 'Ch 102 (C)',
        serialNumber: '2',
        traceability: 'UME/Turkey',
        calibrationDate: '2026-08-01',
        dueDate: '2027-08-01',
        readings: parsed.readings,
        temperatureCurve: tempCurve,
      },
    ],
  });
  const sdBytes = await exportStudyReportWorkbook(sdOutput);
  const sdWb = XLSX.read(sdBytes, { type: 'array' });
  const sdEqRows: unknown[][] = XLSX.utils.sheet_to_json(sdWb.Sheets['Equipment Information'], { header: 1 });
  assert.equal(sdEqRows[1][5], '08/2026');
  assert.equal(sdEqRows[1][6], '08/2027');
  const sdSensorRows: unknown[][] = XLSX.utils.sheet_to_json(sdWb.Sheets['2'], { header: 1 });
  assert.equal(sdSensorRows[5][5], '08/2026 / 08/2027');
});

test('exportSuperDaqRegistryWorkbook outputs SuperDAQ Registry and Correction Points sheets', async () => {
  const xlsxBytes = await exportSuperDaqRegistryWorkbook(
    [
      {
        kit_code: 'KIT_44070036',
        name: 'Super DAQ',
        serial_number: '44070036',
        status: 'active',
      },
    ],
    [
      {
        sensor_code: 'CH_101',
        kit_code: 'KIT_44070036',
        name: 'PT100 Sensor 101',
        channel_identifier: 'Ch 101 (C)',
        serial_number: '101',
        position: 'Top Front',
        calibration_date: '2026-01-15',
        due_date: '2027-01-15',
        certificate_number: 'CERT-101',
        provider: 'JNMI',
        traceability: 'JNMI/RSS',
        temperature_convention: 'indication_plus_correction',
        temperature_points_json: JSON.stringify([
          { indication: 0, correction: 0.02 },
          { indication: 25, correction: -0.01 },
        ]),
        notes: 'Primary channel',
      },
    ]
  );

  assert.equal(xlsxBytes.length > 2000, true);
  const wb = XLSX.read(xlsxBytes, { type: 'array' });
  assert.equal(wb.SheetNames.includes('SuperDAQ Registry'), true);
  assert.equal(wb.SheetNames.includes('Correction Points'), true);

  const regRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['SuperDAQ Registry'], { header: 1 });
  assert.equal(regRows[0][0], 'Kit Code');
  assert.equal(regRows[1][2], 'Ch 101 (C)');
  assert.equal(regRows[1][8], '15/01/2026');
  assert.equal(regRows[1][9], '15/01/2027');

  const ptRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets['Correction Points'], { header: 1 });
  assert.equal(ptRows.length, 3);
  assert.equal(ptRows[1][1], 'Ch 101 (C)');
});

import { getSensorDisplayLabel } from './importers.ts';

test('getSensorDisplayLabel prefers concise SN for SuperDAQ sensors and preserves DL codes', () => {
  const dummyCurve = new CalibrationCurve(
    [
      { indication: 0, correction: 0 },
      { indication: 50, correction: 0 },
    ],
    'indication_plus_correction'
  );

  const sqSnapshots = [
    {
      equipmentCode: 'KIT_44070036_KIT_44070036_Ch 106 (C)',
      serialNumber: '325506',
      sourceChannel: 'Ch 106 (C)',
      readings: [],
      temperatureCurve: dummyCurve,
    },
    {
      equipmentCode: 'KIT_44070036_Ch 105 (C)',
      serialNumber: '325505',
      sourceChannel: 'Ch 105 (C)',
      readings: [],
      temperatureCurve: dummyCurve,
    },
  ];

  assert.equal(
    getSensorDisplayLabel('KIT_44070036_KIT_44070036_Ch 106 (C)', sqSnapshots, 'Fluke SuperDAQ'),
    '325506'
  );
  assert.equal(
    getSensorDisplayLabel('KIT_44070036_Ch 105 (C)', sqSnapshots, 'Fluke SuperDAQ'),
    '325505'
  );
  assert.equal(
    getSensorDisplayLabel(
      'DL001',
      [{ equipmentCode: 'DL001', serialNumber: '84435686', readings: [], temperatureCurve: dummyCurve }],
      'Data Logger'
    ),
    'DL001'
  );
  assert.equal(
    getSensorDisplayLabel('KIT_44070036_KIT_44070036_Ch 102 (C)', [], 'Fluke SuperDAQ'),
    'Ch 102 (C)'
  );
});

