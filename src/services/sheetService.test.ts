import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRobustCsv,
  buildSheetGvizUrl,
  findVal,
  extractSpreadsheetId,
} from './sheetService.ts';

test('parseRobustCsv handles basic comma separated values', () => {
  const csv = 'Equipment Code,Serial Number,Manufacturer\nDL001,84435686,Testo\nDL002,84433070,Testo';
  const rows = parseRobustCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Equipment Code', 'Serial Number', 'Manufacturer']);
  assert.deepEqual(rows[1], ['DL001', '84435686', 'Testo']);
  assert.deepEqual(rows[2], ['DL002', '84433070', 'Testo']);
});

test('parseRobustCsv preserves commas inside quoted values', () => {
  const csv = 'Code,Description,Traceability\nDL001,"Data Logger (DL001, Calibration Lab)","UME, Turkey"';
  const rows = parseRobustCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'DL001');
  assert.equal(rows[1][1], 'Data Logger (DL001, Calibration Lab)');
  assert.equal(rows[1][2], 'UME, Turkey');
});

test('parseRobustCsv handles escaped quotes ("")', () => {
  const csv = 'ID,Notes\n1,"Calibrated with ""Secondary Standard"" PT100"';
  const rows = parseRobustCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'Calibrated with "Secondary Standard" PT100');
});

test('parseRobustCsv handles multi-line cells with newlines inside quotes', () => {
  const csv = 'ID,Remarks\n1,"Line 1\nLine 2\nLine 3"\n2,Normal';
  const rows = parseRobustCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'Line 1\nLine 2\nLine 3');
  assert.equal(rows[2][0], '2');
  assert.equal(rows[2][1], 'Normal');
});

test('buildSheetGvizUrl constructs exact Google Visualization API export URL', () => {
  const id = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  const sheet = 'Data_Logger_Corrections';
  const url = buildSheetGvizUrl(id, sheet);
  assert.equal(
    url,
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/gviz/tq?tqx=out:csv&headers=1&sheet=Data_Logger_Corrections'
  );

  const sheetWithSpaces = 'Data loggers corrections';
  const urlSpaces = buildSheetGvizUrl(id, sheetWithSpaces);
  assert.equal(
    urlSpaces,
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/gviz/tq?tqx=out:csv&headers=1&sheet=Data%20loggers%20corrections'
  );
});

test('findVal performs flexible case and whitespace-insensitive key lookups', () => {
  const row = {
    'Equipment Code': 'DL001',
    'Calibration Date ': '2026-01-01',
    'Serial_Number': '84435686',
  };

  assert.equal(findVal(row, 'equipment_code', 'code'), 'DL001');
  assert.equal(findVal(row, 'calibration_date', 'cal_date'), '2026-01-01');
  assert.equal(findVal(row, 'serial_number'), '84435686');
  assert.equal(findVal(row, 'non_existent_field'), '');
});

test('extractSpreadsheetId extracts ID from full URL or bare string', () => {
  const rawId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  assert.equal(extractSpreadsheetId(rawId), rawId);

  const fullUrl = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=sharing#gid=0';
  assert.equal(extractSpreadsheetId(fullUrl), rawId);
});

