import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CalibrationCurve,
  calculateSampleStandardDeviation,
  calculateArithmeticMean,
  calculateChannelResult,
  snapStudyBoundaries,
  inferSamplingIntervalMinutes,
  validateGrid,
  StudyValidationError,
} from './metrology.ts';

test('CalibrationCurve linear interpolation inside range with indication_plus_correction', () => {
  const points = [
    { indication: 0.0, correction: 0.2 },
    { indication: 10.0, correction: 0.4 },
  ];
  const curve = new CalibrationCurve(points, 'indication_plus_correction');
  const res = curve.correct(5.0);
  assert.equal(res.extrapolated, false);
  assert.equal(Math.abs(res.correction - 0.3) < 1e-9, true);
  assert.equal(Math.abs(res.corrected_value - 5.3) < 1e-9, true);
});

test('CalibrationCurve with indication_minus_correction', () => {
  const points = [
    { indication: 15.0, correction: 0.1 },
    { indication: 25.0, correction: 0.3 },
  ];
  const curve = new CalibrationCurve(points, 'indication_minus_correction');
  const res = curve.correct(20.0);
  assert.equal(res.extrapolated, false);
  assert.equal(Math.abs(res.correction - 0.2) < 1e-9, true);
  // indication - correction = 20 - 0.2 = 19.8
  assert.equal(Math.abs(res.corrected_value - 19.8) < 1e-9, true);
});

test('CalibrationCurve linear extrapolation below and above range', () => {
  const points = [
    { indication: 10.0, correction: 0.2 },
    { indication: 20.0, correction: 0.4 },
    { indication: 30.0, correction: 0.6 },
  ];
  const curve = new CalibrationCurve(points, 'indication_plus_correction');
  
  // Below range
  const resBelow = curve.correct(5.0);
  assert.equal(resBelow.extrapolated, true);
  assert.equal(Math.abs(resBelow.correction - 0.1) < 1e-9, true);
  assert.equal(Math.abs(resBelow.corrected_value - 5.1) < 1e-9, true);

  // Above range
  const resAbove = curve.correct(35.0);
  assert.equal(resAbove.extrapolated, true);
  assert.equal(Math.abs(resAbove.correction - 0.7) < 1e-9, true);
  assert.equal(Math.abs(resAbove.corrected_value - 35.7) < 1e-9, true);
});

test('calculateSampleStandardDeviation and calculateArithmeticMean', () => {
  const vals = [2, 4, 4, 4, 5, 5, 7, 9];
  const mean = calculateArithmeticMean(vals);
  assert.equal(mean, 5.0);
  const s = calculateSampleStandardDeviation(vals);
  assert.equal(Math.abs(s - 2.138089935299395) < 1e-9, true);
});

test('calculateChannelResult calculates duration, limits exceedance, and statistics correctly', () => {
  const start = new Date('2026-10-25T10:00:00');
  const end = new Date('2026-10-25T11:00:00'); // 60 minutes
  const timestamps = [
    new Date('2026-10-25T10:00:00'),
    new Date('2026-10-25T10:15:00'),
    new Date('2026-10-25T10:30:00'),
    new Date('2026-10-25T10:45:00'),
  ];
  const values = [1.5, 4.0, 5.0, 9.5]; // 1.5 is below 2.0; 9.5 is above 8.0
  const limits = { lower: 2.0, upper: 8.0 };
  const intervalMinutes = 15;

  const result = calculateChannelResult(values, timestamps, intervalMinutes, start, end, limits);
  assert.equal(result.minimum, 1.5);
  assert.equal(result.maximum, 9.5);
  assert.equal(result.below_minutes, 15);
  assert.equal(result.below_percent, 25);
  assert.equal(result.above_minutes, 15);
  assert.equal(result.above_percent, 25);
});

test('snapStudyBoundaries forward snaps off-grid boundaries and issues metrological warnings', () => {
  const ts1 = [
    new Date('2026-10-25T10:00:00Z'),
    new Date('2026-10-25T10:15:00Z'),
    new Date('2026-10-25T10:30:00Z'),
    new Date('2026-10-25T10:45:00Z'),
    new Date('2026-10-25T11:00:00Z'),
  ];
  const ts2 = [
    new Date('2026-10-25T09:45:00Z'),
    new Date('2026-10-25T10:00:00Z'),
    new Date('2026-10-25T10:15:00Z'),
    new Date('2026-10-25T10:30:00Z'),
    new Date('2026-10-25T10:45:00Z'),
    new Date('2026-10-25T11:00:00Z'),
  ];

  const loggers = [
    { equipmentCode: 'DL001', timestamps: ts1 },
    { equipmentCode: 'DL002', timestamps: ts2 },
  ];

  // Request off-grid: 10:05 (should snap forward to 10:15) and 10:40 (should snap forward to 10:45)
  const reqStart = new Date('2026-10-25T10:05:00Z');
  const reqEnd = new Date('2026-10-25T10:40:00Z');

  const { effectiveStart, effectiveEnd, warnings } = snapStudyBoundaries(loggers, reqStart, reqEnd);
  assert.equal(effectiveStart.getTime(), new Date('2026-10-25T10:15:00Z').getTime());
  assert.equal(effectiveEnd.getTime(), new Date('2026-10-25T10:45:00Z').getTime());
  assert.equal(warnings.length, 2);
  assert.equal(warnings[0].includes('rounded up to the next shared recorded timestamp'), true);
});

test('inferSamplingIntervalMinutes correctly infers interval and checks consistency', () => {
  const ts1 = [
    new Date('2026-10-25T10:00:00Z'),
    new Date('2026-10-25T10:15:00Z'),
    new Date('2026-10-25T10:30:00Z'),
  ];
  const ts2 = [
    new Date('2026-10-25T10:00:00Z'),
    new Date('2026-10-25T10:15:00Z'),
  ];
  const interval = inferSamplingIntervalMinutes([
    { equipmentCode: 'DL001', timestamps: ts1 },
    { equipmentCode: 'DL002', timestamps: ts2 },
  ]);
  assert.equal(interval, 15);
});

test('validateGrid strictly detects missing intermediate readings in Data Loggers', () => {
  const start = new Date('2026-10-25T10:00:00Z');
  const end = new Date('2026-10-25T10:45:00Z');
  // Missing 10:30 reading!
  const timestamps = [
    new Date('2026-10-25T10:00:00Z'),
    new Date('2026-10-25T10:15:00Z'),
    new Date('2026-10-25T10:45:00Z'),
  ];

  const issues = validateGrid('DL001', timestamps, start, end, 15, true);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].includes('missing expected reading at'), true);
});

import { calculateMeanKineticTemperature } from './metrology.ts';
import {
  formatDateTimeDDMMYYYY,
  formatDateDDMMYYYY,
  formatDateMMYYYY,
  getCalibrationDueInfo,
  parseDDMMYYYYToIso,
  isoToDDMMYYYYInput,
} from './dateFormat.ts';

test('calculateChannelResult computes Haynes MKT, uniformity, stability, and time-in-range %', () => {
  const start = new Date('2026-10-25T10:00:00');
  const end = new Date('2026-10-25T11:00:00');
  const timestamps = [
    new Date('2026-10-25T10:00:00'),
    new Date('2026-10-25T10:15:00'),
    new Date('2026-10-25T10:30:00'),
    new Date('2026-10-25T10:45:00'),
  ];
  const values = [2.0, 4.0, 6.0, 8.0];
  const result = calculateChannelResult(values, timestamps, 15, start, end, { lower: 2.0, upper: 8.0 });

  assert.equal(result.mean, 5.0);
  assert.equal(result.uniformity, 6.0);
  assert.equal(result.stability, 3.0);
  assert.equal(result.in_range_percent, 100);
  assert.equal(result.out_of_range_minutes, 0);
  // MKT is always >= arithmetic mean for non-constant temperatures
  assert.equal(result.mkt >= result.mean, true);
  assert.equal(Math.abs(calculateMeanKineticTemperature([5, 5, 5]) - 5) < 1e-6, true);
});

test('dateFormat helpers render 24h DD/MM/YYYY HH:mm and accurate Cal Due tiers', () => {
  const dt = new Date(2026, 3, 9, 21, 5); // 09/04/2026 21:05
  assert.equal(formatDateTimeDDMMYYYY(dt), '09/04/2026 21:05');
  assert.equal(formatDateDDMMYYYY('2026-04-09'), '09/04/2026');
  assert.equal(formatDateMMYYYY('2026-04-09'), '04/2026');
  assert.equal(formatDateMMYYYY('08/01/2026'), '01/2026');
  assert.equal(formatDateMMYYYY('2026-08'), '08/2026');
  assert.equal(formatDateMMYYYY(''), '—');

  assert.equal(parseDDMMYYYYToIso('09/04/2026'), '2026-04-09');
  assert.equal(parseDDMMYYYYToIso('1/8/2026'), '2026-08-01');
  assert.equal(parseDDMMYYYYToIso('29/02/2028'), '2028-02-29'); // leap year
  assert.equal(parseDDMMYYYYToIso('29/02/2026'), null); // non-leap year
  assert.equal(parseDDMMYYYYToIso('31/04/2026'), null); // April has 30 days
  assert.equal(parseDDMMYYYYToIso('15/13/2026'), null); // invalid month
  assert.equal(parseDDMMYYYYToIso('2026-04-09'), null); // not DD/MM/YYYY
  assert.equal(parseDDMMYYYYToIso(''), null);

  assert.equal(isoToDDMMYYYYInput('2026-08-01'), '01/08/2026');
  assert.equal(isoToDDMMYYYYInput('09/04/2026'), '09/04/2026');
  assert.equal(isoToDDMMYYYYInput(''), '');

  const expired = getCalibrationDueInfo('2020-01-01');
  assert.equal(expired.tier, 'expired');

  const soonDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const expiring = getCalibrationDueInfo(soonDate);
  assert.equal(expiring.tier, 'expiring');

  const farDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const valid = getCalibrationDueInfo(farDate);
  assert.equal(valid.tier, 'valid');
});

test('calculateChannelResult never exceeds 100% when reading spacing is shorter than nominal interval', () => {
  // Simulate SuperDAQ clock jitter: 51 readings spaced 59.8s apart (~49.83 min total) with nominal interval 1 min
  const startMs = new Date('2026-11-19T10:00:00Z').getTime();
  const timestamps: Date[] = [];
  const values: number[] = [];
  for (let i = 0; i <= 50; i++) {
    timestamps.push(new Date(startMs + i * 59800));
    values.push(-21.0); // all below 15.0°C lower limit
  }
  const studyStart = timestamps[0];
  const studyEnd = timestamps[timestamps.length - 1];

  const result = calculateChannelResult(values, timestamps, 1, studyStart, studyEnd, {
    lower: 15,
    upper: 25,
  });

  assert.equal(result.below_percent, 100);
  assert.equal(result.above_percent, 0);
  assert.equal(result.in_range_percent, 0);
  assert.equal(Math.abs(result.below_minutes - (studyEnd.getTime() - studyStart.getTime()) / 60000) < 1e-6, true);

  // Repeating decimal check (1/3 = 33.33...% -> 33% and 67%)
  const t0 = new Date('2026-11-19T10:00:00Z');
  const t1 = new Date('2026-11-19T10:10:00Z');
  const t2 = new Date('2026-11-19T10:20:00Z');
  const t3 = new Date('2026-11-19T10:30:00Z');
  const thirdRes = calculateChannelResult([10, 20, 20], [t0, t1, t2], 10, t0, t3, { lower: 15, upper: 25 });
  assert.equal(thirdRes.below_percent, 33);
  assert.equal(thirdRes.in_range_percent, 67);
  assert.equal(thirdRes.above_percent, 0);
});

