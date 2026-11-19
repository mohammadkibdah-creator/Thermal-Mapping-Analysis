import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';
import { isoToDDMMYYYYInput, parseDDMMYYYYToIso } from '../utils/dateFormat.ts';

interface DateInputDDMMYYYYProps {
  value: string;
  onChange: (nextDDMMYYYY: string) => void;
  hasError?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * Locale-independent DD/MM/YYYY date input with an optional native calendar picker trigger.
 * Always displays and accepts dates in dd/mm/yyyy format regardless of browser/OS locale.
 */
export const DateInputDDMMYYYY: React.FC<DateInputDDMMYYYYProps> = ({
  value,
  onChange,
  hasError = false,
  placeholder = 'dd/mm/yyyy',
  className = '',
  ariaLabel,
}) => {
  const nativePickerRef = useRef<HTMLInputElement | null>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;

    // Allow users to delete or edit freely when shortening the string
    if (raw.length < value.length) {
      onChange(raw.replace(/[^\d/]/g, '').slice(0, 10));
      return;
    }

    // Handle pasted ISO YYYY-MM-DD seamlessly by converting to dd/mm/yyyy
    const isoMatch = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const converted = isoToDDMMYYYYInput(raw.trim());
      if (converted) {
        onChange(converted);
        return;
      }
    }

    // Strip non-digits and auto-insert slashes as the user types DDMMYYYY
    const digitsOnly = raw.replace(/\D/g, '').slice(0, 8);
    let formatted = digitsOnly;
    if (digitsOnly.length > 4) {
      formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4)}`;
    } else if (digitsOnly.length > 2) {
      formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
    } else if (digitsOnly.length === 2 && raw.endsWith('/')) {
      formatted = `${digitsOnly}/`;
    }

    onChange(formatted);
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const iso = parseDDMMYYYYToIso(trimmed);
    if (iso) {
      onChange(isoToDDMMYYYYInput(iso));
    }
  };

  const openNativePicker = () => {
    const el = nativePickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // Fall through to click/focus fallback
      }
    }
    el.focus();
    el.click();
  };

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isoVal = e.target.value;
    if (!isoVal) {
      onChange('');
      return;
    }
    onChange(isoToDDMMYYYYInput(isoVal));
  };

  const isoValue = parseDDMMYYYYToIso(value) || '';

  return (
    <div className={`relative mt-1.5 ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        maxLength={10}
        dir="ltr"
        value={value}
        onChange={handleTextChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`w-full h-10 pl-3 pr-9 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
          hasError
            ? 'border-[#bd4d42]'
            : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
        }`}
      />
      <button
        type="button"
        onClick={openNativePicker}
        title="Choose date (dd/mm/yyyy)"
        aria-label="Open calendar picker"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[#647184] dark:text-slate-400 hover:text-[#2864dc] dark:hover:text-blue-400 hover:bg-[#f5f7fa] dark:hover:bg-[#1e293b] transition-colors cursor-pointer"
      >
        <Calendar className="w-3.5 h-3.5" />
      </button>
      <input
        ref={nativePickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        onChange={handlePickerChange}
        className="sr-only"
      />
    </div>
  );
};
