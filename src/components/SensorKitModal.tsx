import React, { useState, useEffect } from 'react';
import { SensorKitRecord } from '../store/metrologyStore.ts';
import { X, AlertCircle } from 'lucide-react';

interface SensorKitModalProps {
  initialKit: SensorKitRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (record: SensorKitRecord) => void;
}

export const SensorKitModal: React.FC<SensorKitModalProps> = ({
  initialKit,
  isOpen,
  onClose,
  onSave,
}) => {
  const isNew = !initialKit;
  const [kitCode, setKitCode] = useState(initialKit?.kit_code || '');
  const [name, setName] = useState(initialKit?.name || '');
  const [serialNumber, setSerialNumber] = useState(initialKit?.serial_number || '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(initialKit?.status || 'Active');
  const [notes, setNotes] = useState(initialKit?.notes || '');
  const [errors, setErrors] = useState<{ kitCode?: string; name?: string }>({});

  useEffect(() => {
    if (!isOpen) return;
    setKitCode(initialKit?.kit_code || '');
    setName(initialKit?.name || '');
    setSerialNumber(initialKit?.serial_number || '');
    setStatus(initialKit?.status || 'Active');
    setNotes(initialKit?.notes || '');
    setErrors({});
  }, [initialKit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: { kitCode?: string; name?: string } = {};

    if (!kitCode.trim()) {
      nextErrors.kitCode = 'Kit Code is required (e.g., KIT_44070036).';
    } else if (!/^[A-Za-z0-9_-]+$/.test(kitCode.trim())) {
      nextErrors.kitCode = 'Kit Code may contain only letters, numbers, underscores, or hyphens.';
    }

    if (!name.trim()) {
      nextErrors.name = 'Kit Name / Description is required.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onSave({
      kit_code: kitCode.trim().toUpperCase(),
      name: name.trim(),
      serial_number: serialNumber.trim(),
      status,
      notes: notes.trim(),
      updated_at: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#1e293b] rounded-t-2xl sm:rounded-xl max-w-lg w-full max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto shadow-2xl border border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 pb-safe sm:pb-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#edf0f4] dark:border-[#334155]">
          <h2 className="text-lg font-bold text-[#182330] dark:text-slate-100">
            {isNew ? 'Add SuperDAQ Sensor Kit' : `Edit Kit: ${kitCode}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#788493] hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <label className="block text-xs font-semibold text-[#334052] dark:text-slate-300">
            Kit Code <span className="text-[#bd4d42]">*</span>
            <input
              type="text"
              readOnly={!isNew}
              value={kitCode}
              onChange={(e) => {
                setKitCode(e.target.value);
                if (errors.kitCode) setErrors((p) => ({ ...p, kitCode: undefined }));
              }}
              placeholder="KIT_44070036"
              className={`mt-1 w-full h-10 px-3 rounded-lg border text-xs text-[#182330] dark:text-slate-100 bg-white dark:bg-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                errors.kitCode ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
              } ${!isNew ? 'opacity-70 cursor-not-allowed' : ''}`}
            />
            {errors.kitCode && (
              <span className="flex items-center gap-1 text-[11px] text-[#bd4d42] font-normal mt-1">
                <AlertCircle className="w-3 h-3" /> {errors.kitCode}
              </span>
            )}
          </label>

          <label className="block text-xs font-semibold text-[#334052] dark:text-slate-300">
            Kit Name / Description <span className="text-[#bd4d42]">*</span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              placeholder="Super DAQ System with PT100 Sensors"
              className={`mt-1 w-full h-10 px-3 rounded-lg border text-xs text-[#182330] dark:text-slate-100 bg-white dark:bg-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                errors.name ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
              }`}
            />
            {errors.name && (
              <span className="flex items-center gap-1 text-[11px] text-[#bd4d42] font-normal mt-1">
                <AlertCircle className="w-3 h-3" /> {errors.name}
              </span>
            )}
          </label>

          <label className="block text-xs font-semibold text-[#334052] dark:text-slate-300">
            Fluke SuperDAQ Mainframe Serial Number
            <input
              type="text"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="44070036"
              className="mt-1 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
            />
          </label>

          <label className="block text-xs font-semibold text-[#334052] dark:text-slate-300">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'Active' | 'Inactive')}
              className="mt-1 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>

          <label className="block text-xs font-semibold text-[#334052] dark:text-slate-300">
            Notes
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Laboratory allocation notes"
              className="mt-1 w-full p-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
            />
          </label>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-3 border-t border-[#edf0f4] dark:border-[#334155]">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-4 py-2 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] cursor-pointer"
            >
              Save Kit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
