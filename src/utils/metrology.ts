import { formatDateTimeDDMMYYYY } from './dateFormat.ts';

export type CorrectionConvention = 'indication_plus_correction' | 'indication_minus_correction';

export interface CorrectionPoint {
  indication: number;
  correction: number;
}

export interface CorrectionResult {
  indication: number;
  correction: number;
  corrected_value: number;
  extrapolated: boolean;
  calibration_range: [number, number];
}

export interface ChannelLimits {
  lower: number;
  upper: number;
}

export interface ChannelResult {
  mkt: number;
  mean: number;
  minimum: number;
  maximum: number;
  uniformity: number;
  stability: number;
  sample_standard_deviation: number;
  below_minutes: number;
  below_percent: number;
  above_minutes: number;
  above_percent: number;
  in_range_minutes: number;
  in_range_percent: number;
  out_of_range_minutes: number;
}

export class CalibrationError extends Error {}
export class StudyValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join('\n'));
    this.issues = issues;
  }
}

export class CalibrationCurve {
  points: CorrectionPoint[];
  convention: CorrectionConvention;

  constructor(points: CorrectionPoint[], convention: CorrectionConvention) {
    if (!points || points.length === 0) {
      this.points = [{ indication: 0, correction: 0 }];
      this.convention = convention || 'indication_plus_correction';
      return;
    }
    if (points.length === 1) {
      this.points = points;
      this.convention = convention || 'indication_plus_correction';
      return;
    }
    for (const pt of points) {
      if (!Number.isFinite(pt.indication) || !Number.isFinite(pt.correction)) {
        throw new CalibrationError('Calibration values must be finite numbers.');
      }
    }
    const sorted = [...points].sort((a, b) => a.indication - b.indication);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].indication === sorted[i + 1].indication) {
        throw new CalibrationError('Calibration indication points must be unique.');
      }
    }
    this.points = sorted;
    this.convention = convention || 'indication_plus_correction';
  }

  correct(indication: number): CorrectionResult {
    if (!Number.isFinite(indication)) {
      throw new CalibrationError('The indication must be a finite number.');
    }
    const pts = this.points;

    // Single-point constant offset fallback
    if (pts.length === 1) {
      const corr = pts[0].correction;
      const corrected_value =
        this.convention === 'indication_plus_correction'
          ? indication + corr
          : indication - corr;
      return {
        indication,
        correction: corr,
        corrected_value,
        extrapolated: false,
        calibration_range: [pts[0].indication, pts[0].indication],
      };
    }

    const minInd = pts[0].indication;
    const maxInd = pts[pts.length - 1].indication;
    const extrapolated = indication < minInd || indication > maxInd;

    let left: CorrectionPoint;
    let right: CorrectionPoint;

    if (indication <= minInd) {
      left = pts[0];
      right = pts[1];
    } else if (indication >= maxInd) {
      left = pts[pts.length - 2];
      right = pts[pts.length - 1];
    } else {
      const rightIndex = pts.findIndex((p) => p.indication >= indication);
      left = pts[rightIndex - 1];
      right = pts[rightIndex];
    }

    const fraction = (indication - left.indication) / (right.indication - left.indication);
    const correction = left.correction + fraction * (right.correction - left.correction);
    const sign = this.convention === 'indication_plus_correction' ? 1 : -1;
    const corrected_value = indication + sign * correction;

    return {
      indication,
      correction,
      corrected_value,
      extrapolated,
      calibration_range: [minInd, maxInd],
    };
  }
}

export function calculateSampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const sumSquaredDiff = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
  return Math.sqrt(sumSquaredDiff / (values.length - 1));
}

export function calculateArithmeticMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Computes Mean Kinetic Temperature (°C) using the Haynes equation (ICH Q1A / USP <1079>).
 * Delta H = 83.14472 kJ/mol, R = 0.008314472 kJ/(mol·K) => Delta H / R = 10000 K.
 */
export function calculateMeanKineticTemperature(valuesCelsius: number[]): number {
  if (valuesCelsius.length === 0) return 0;
  const deltaHOverR = 83.14472 / 0.008314472; // 10000 K
  let sumExp = 0;
  let validCount = 0;
  for (const tC of valuesCelsius) {
    const tK = tC + 273.15;
    if (tK <= 0) continue;
    sumExp += Math.exp(-deltaHOverR / tK);
    validCount++;
  }
  if (validCount === 0 || sumExp <= 0) {
    return calculateArithmeticMean(valuesCelsius);
  }
  const mktKelvin = -deltaHOverR / Math.log(sumExp / validCount);
  return mktKelvin - 273.15;
}

export function calculateChannelResult(
  values: number[],
  timestamps: Date[],
  intervalMinutes: number,
  studyStart: Date,
  studyEnd: Date,
  limits: ChannelLimits
): ChannelResult {
  const durationMinutes = (studyEnd.getTime() - studyStart.getTime()) / (60 * 1000);
  if (durationMinutes <= 0) {
    throw new Error('Study duration must be greater than zero.');
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  const studyStartMs = studyStart.getTime();
  const studyEndMs = studyEnd.getTime();

  const pairs = values
    .map((val, idx) => ({ val, tsMs: timestamps[idx].getTime() }))
    .sort((a, b) => a.tsMs - b.tsMs);

  let belowMinutes = 0;
  let aboveMinutes = 0;

  for (let i = 0; i < pairs.length; i++) {
    const { val, tsMs } = pairs[i];
    const nextTsMs = i + 1 < pairs.length ? pairs[i + 1].tsMs : studyEndMs;
    const intervalEndMs = Math.min(tsMs + intervalMs, nextTsMs, studyEndMs);
    const intervalStartEffective = Math.max(tsMs, studyStartMs);
    const countedMinutes = Math.max(0, (intervalEndMs - intervalStartEffective) / (60 * 1000));

    if (val < limits.lower) {
      belowMinutes += countedMinutes;
    } else if (val > limits.upper) {
      aboveMinutes += countedMinutes;
    }
  }

  const mean = calculateArithmeticMean(values);
  const mkt = calculateMeanKineticTemperature(values);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const uniformity = maximum - minimum;
  const stability = uniformity / 2;
  const sample_standard_deviation = calculateSampleStandardDeviation(values);

  let below_percent = Math.round(Math.min(100, Math.max(0, (belowMinutes / durationMinutes) * 100)));
  let above_percent = Math.round(Math.min(100, Math.max(0, (aboveMinutes / durationMinutes) * 100)));
  if (below_percent + above_percent > 100) {
    if (below_percent >= above_percent) {
      below_percent = 100 - above_percent;
    } else {
      above_percent = 100 - below_percent;
    }
  }
  const out_of_range_minutes = Math.min(durationMinutes, belowMinutes + aboveMinutes);
  const in_range_minutes = Math.max(0, durationMinutes - out_of_range_minutes);
  const in_range_percent = Math.max(0, Math.min(100, 100 - below_percent - above_percent));

  return {
    mkt,
    mean,
    minimum,
    maximum,
    uniformity,
    stability,
    sample_standard_deviation,
    below_minutes: belowMinutes,
    below_percent,
    above_minutes: aboveMinutes,
    above_percent,
    in_range_minutes,
    in_range_percent,
    out_of_range_minutes,
  };
}

export interface BoundaryLoggerInput {
  equipmentCode: string;
  timestamps: Date[];
}

/**
 * Port of Python's snap_study_boundaries:
 * Finds the intersection of timestamps shared by all loggers.
 * If requested start/end does not land on an exact common timestamp,
 * rounds up (forward) to the next shared recorded timestamp,
 * generating a formal metrological warning.
 */
export function snapStudyBoundaries(
  loggers: BoundaryLoggerInput[],
  requestedStart: Date,
  requestedEnd: Date
): { effectiveStart: Date; effectiveEnd: Date; warnings: string[] } {
  if (!loggers || loggers.length === 0) {
    throw new StudyValidationError(['At least one Data Logger file must be assigned.']);
  }

  // Find set of timestamps in ms for each logger
  const timestampSets: Set<number>[] = loggers.map((logger) => {
    const set = new Set<number>();
    for (const ts of logger.timestamps) {
      if (!ts || isNaN(ts.getTime())) {
        throw new StudyValidationError([
          `Data Logger ${logger.equipmentCode}: timestamps must be valid before study boundaries can be selected.`,
        ]);
      }
      set.add(ts.getTime());
    }
    return set;
  });

  // Common intersection of timestamps across all loggers
  let commonMs = Array.from(timestampSets[0]);
  for (let i = 1; i < timestampSets.length; i++) {
    const currentSet = timestampSets[i];
    commonMs = commonMs.filter((ms) => currentSet.has(ms));
  }

  if (commonMs.length === 0) {
    throw new StudyValidationError([
      'Assigned Data Loggers do not share any timestamps, so common study boundaries cannot be selected.',
    ]);
  }

  commonMs.sort((a, b) => a - b);
  const commonSet = new Set(commonMs);
  const warnings: string[] = [];

  function formatIsoNoTz(d: Date): string {
    return formatDateTimeDDMMYYYY(d);
  }

  function nextBoundary(requested: Date, label: 'start' | 'end'): Date {
    const reqMs = requested.getTime();
    if (commonSet.has(reqMs)) {
      return requested;
    }

    const later = commonMs.filter((ms) => ms > reqMs);
    if (later.length === 0) {
      throw new StudyValidationError([
        `Requested study ${label} ${formatIsoNoTz(requested)} is outside the recorded range. ` +
        `The next shared recorded timestamp does not exist.`,
      ]);
    }

    const selectedMs = later[0];
    const selected = new Date(selectedMs);
    const diffMin = Math.round((selectedMs - reqMs) / 60000);
    warnings.push(
      `Requested study ${label} ${formatIsoNoTz(requested)} was rounded up to the next shared ` +
      `recorded timestamp ${formatIsoNoTz(selected)} (difference ${diffMin} min).`
    );
    return selected;
  }

  const effectiveStart = nextBoundary(requestedStart, 'start');
  const effectiveEnd = nextBoundary(requestedEnd, 'end');

  if (effectiveEnd.getTime() <= effectiveStart.getTime()) {
    throw new StudyValidationError([
      'Rounded study boundaries do not form a positive study duration. Adjust the requested start or end.',
    ]);
  }

  return { effectiveStart, effectiveEnd, warnings };
}

/**
 * Port of Python's infer_sampling_interval_minutes:
 * Calculates interval from the first two timestamped readings and rounds to nearest minute.
 */
export function inferSamplingIntervalMinutes(loggers: BoundaryLoggerInput[]): number {
  if (!loggers || loggers.length === 0) {
    throw new StudyValidationError(['At least one Data Logger file must be assigned.']);
  }

  const intervalsMinutes: number[] = [];
  for (const logger of loggers) {
    const sorted = [...logger.timestamps].sort((a, b) => a.getTime() - b.getTime());
    if (sorted.length < 2) {
      throw new StudyValidationError([
        `Data Logger ${logger.equipmentCode}: at least two timestamped readings are required to determine the sampling interval.`,
      ]);
    }
    const diffMs = sorted[1].getTime() - sorted[0].getTime();
    if (diffMs <= 0) {
      throw new StudyValidationError([
        `Data Logger ${logger.equipmentCode}: the first two readings do not define a positive sampling interval.`,
      ]);
    }
    const mins = Math.max(1, Math.round(diffMs / (60 * 1000)));
    intervalsMinutes.push(mins);
  }

  const first = intervalsMinutes[0];
  if (intervalsMinutes.some((m) => m !== first)) {
    throw new StudyValidationError([
      'Assigned Data Loggers use different sampling intervals. The system cannot determine one sampling interval for the study.',
    ]);
  }

  return first;
}

/**
 * Port of Python's _validate_grid with strictGrid checking:
 * Checks start, end, duplicate timestamps, and missing expected intermediate readings.
 */
export function validateGrid(
  code: string,
  timestamps: Date[],
  start: Date,
  end: Date,
  intervalMinutes: number,
  strictGrid: boolean
): string[] {
  const issues: string[] = [];
  const timesMs = timestamps.map((t) => t.getTime()).sort((a, b) => a - b);

  // Check duplicates
  const uniqueSet = new Set(timesMs);
  if (uniqueSet.size !== timesMs.length) {
    issues.push(`Data Logger ${code}: duplicate timestamps were found in the file.`);
    return issues;
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  const intervalMs = intervalMinutes * 60 * 1000;

  const windowMs = timesMs.filter((ms) => ms >= startMs && ms <= endMs);
  const windowSet = new Set(windowMs);

  function formatIso(ms: number): string {
    return formatDateTimeDDMMYYYY(ms);
  }

  if (!windowSet.has(startMs)) {
    issues.push(`Data Logger ${code}: required study start ${formatIso(startMs)} is missing.`);
  }
  if (!windowSet.has(endMs)) {
    issues.push(`Data Logger ${code}: required study end ${formatIso(endMs)} is missing.`);
  }

  if (strictGrid) {
    const expectedCount = Math.round((endMs - startMs) / intervalMs) + 1;
    for (let index = 0; index < expectedCount; index++) {
      const expectedMs = startMs + index * intervalMs;
      if (!windowSet.has(expectedMs)) {
        issues.push(
          `Data Logger ${code}: missing expected reading at ${formatIso(expectedMs)}. ` +
          `Expected sampling interval: ${intervalMinutes} minutes. Analysis cannot proceed.`
        );
      }
    }
  }

  if (windowMs.length < 2) {
    issues.push(
      `Data Logger ${code}: fewer than two measurements are available; sample standard deviation cannot be calculated.`
    );
  }

  return issues;
}
