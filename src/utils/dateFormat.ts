/**
 * Centralized 24-hour date/time formatting utilities (DD/MM/YYYY and DD/MM/YYYY HH:mm)
 * and calibration due-date status computation.
 */

function parseCalendarDateParts(value: Date | string | number | null | undefined): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  hasTime: boolean;
} | null {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
      hours: value.getHours(),
      minutes: value.getMinutes(),
      hasTime: true,
    };
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hours: d.getHours(),
      minutes: d.getMinutes(),
      hasTime: true,
    };
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // Match strict YYYY-MM-DD without timezone drift
  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDateOnly) {
    return {
      year: parseInt(isoDateOnly[1], 10),
      month: parseInt(isoDateOnly[2], 10),
      day: parseInt(isoDateOnly[3], 10),
      hours: 0,
      minutes: 0,
      hasTime: false,
    };
  }

  // Match strict YYYY-MM without timezone drift
  const isoMonthOnly = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMonthOnly) {
    return {
      year: parseInt(isoMonthOnly[1], 10),
      month: parseInt(isoMonthOnly[2], 10),
      day: 1,
      hours: 0,
      minutes: 0,
      hasTime: false,
    };
  }

  // Match DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (ddmmyyyy) {
    return {
      day: parseInt(ddmmyyyy[1], 10),
      month: parseInt(ddmmyyyy[2], 10),
      year: parseInt(ddmmyyyy[3], 10),
      hours: ddmmyyyy[4] ? parseInt(ddmmyyyy[4], 10) : 0,
      minutes: ddmmyyyy[5] ? parseInt(ddmmyyyy[5], 10) : 0,
      hasTime: Boolean(ddmmyyyy[4]),
    };
  }

  // Match MM/YYYY
  const mmyyyy = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmyyyy) {
    return {
      day: 1,
      month: parseInt(mmyyyy[1], 10),
      year: parseInt(mmyyyy[2], 10),
      hours: 0,
      minutes: 0,
      hasTime: false,
    };
  }

  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hours: d.getHours(),
    minutes: d.getMinutes(),
    hasTime: true,
  };
}

/**
 * Parses a strictly formatted DD/MM/YYYY (or D/M/YYYY with /, -, or . separators) string
 * into canonical ISO YYYY-MM-DD, validating real calendar dates (including leap years).
 * Returns null if the string is empty or not a valid calendar date.
 */
export function parseDDMMYYYYToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts a stored date (e.g. ISO YYYY-MM-DD or DD/MM/YYYY) into a DD/MM/YYYY input value.
 * Returns empty string for empty or unparseable values.
 */
export function isoToDDMMYYYYInput(value: string | null | undefined): string {
  if (!value || !String(value).trim()) return '';
  const p = parseCalendarDateParts(value);
  if (!p) return '';
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  const yyyy = String(p.year).padStart(4, '0');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Formats any date/timestamp as DD/MM/YYYY HH:mm (24h).
 */
export function formatDateTimeDDMMYYYY(value: Date | string | number | null | undefined): string {
  const p = parseCalendarDateParts(value);
  if (!p) return '—';
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  const yyyy = String(p.year);
  const hh = String(p.hours).padStart(2, '0');
  const min = String(p.minutes).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/**
 * Formats a calendar date as DD/MM/YYYY (used for calibration certificates & dates without time).
 */
export function formatDateDDMMYYYY(value: Date | string | number | null | undefined): string {
  const p = parseCalendarDateParts(value);
  if (!p) return '—';
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  const yyyy = String(p.year);
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Formats a calendar date as MM/YYYY (month and year without day, used for calibration/due dates in reports).
 */
export function formatDateMMYYYY(value: Date | string | number | null | undefined): string {
  const p = parseCalendarDateParts(value);
  if (!p) return '—';
  const mm = String(p.month).padStart(2, '0');
  const yyyy = String(p.year);
  return `${mm}/${yyyy}`;
}

/**
 * Converts a Date to YYYY-MM-DDTHH:mm for HTML <input type="datetime-local" />.
 */
export function toDateTimeLocalInput(d: Date): string {
  if (!d || isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export type CalDueTier = 'valid' | 'expiring' | 'expired' | 'unrecorded';

export interface CalDueInfo {
  tier: CalDueTier;
  daysRemaining: number | null;
  badgeText: string;
  formattedDate: string;
}

/**
 * Computes calibration due status:
 * - green: > 60 days left
 * - amber: <= 60 days left (0..60)
 * - red: expired (< 0 days)
 */
export function getCalibrationDueInfo(dueDateStr: string | null | undefined): CalDueInfo {
  if (!dueDateStr || !dueDateStr.trim()) {
    return {
      tier: 'unrecorded',
      daysRemaining: null,
      badgeText: 'Not recorded',
      formattedDate: '—',
    };
  }

  const p = parseCalendarDateParts(dueDateStr);
  if (!p) {
    return {
      tier: 'unrecorded',
      daysRemaining: null,
      badgeText: 'Invalid date',
      formattedDate: String(dueDateStr),
    };
  }

  const dueLocalMidnight = new Date(p.year, p.month - 1, p.day, 23, 59, 59, 999);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const diffDays = Math.floor((dueLocalMidnight.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000));
  const formattedDate = formatDateDDMMYYYY(dueDateStr);

  if (diffDays < 0) {
    return {
      tier: 'expired',
      daysRemaining: diffDays,
      badgeText: `Expired (${Math.abs(diffDays)}d ago)`,
      formattedDate,
    };
  }

  if (diffDays <= 60) {
    return {
      tier: 'expiring',
      daysRemaining: diffDays,
      badgeText: diffDays === 0 ? 'Due today' : `${diffDays}d left`,
      formattedDate,
    };
  }

  return {
    tier: 'valid',
    daysRemaining: diffDays,
    badgeText: `${diffDays}d left`,
    formattedDate,
  };
}
