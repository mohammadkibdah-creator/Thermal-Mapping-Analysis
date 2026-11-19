import React, { useState, useEffect } from 'react';
import {
  EquipmentRecord,
  parsePointsJson,
} from '../store/metrologyStore.ts';
import { normalizeDateToIso } from '../services/sheetService.ts';
import { CorrectionPoint, CorrectionConvention } from '../utils/metrology.ts';
import { X, Plus, Trash2, ShieldAlert } from 'lucide-react';
import {
  getCalibrationDueInfo,
  isoToDDMMYYYYInput,
  parseDDMMYYYYToIso,
} from '../utils/dateFormat.ts';
import { DateInputDDMMYYYY } from './DateInputDDMMYYYY.tsx';

interface EquipmentModalProps {
  initialEquipment: EquipmentRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (record: EquipmentRecord) => void;
  onDelete?: (code: string) => void;
}

export const EquipmentModal: React.FC<EquipmentModalProps> = ({
  initialEquipment,
  isOpen,
  onClose,
  onSave,
  onDelete,
}) => {
  const isNew = !initialEquipment;

  const [equipmentCode, setEquipmentCode] = useState(initialEquipment?.equipment_code || '');
  const [description, setDescription] = useState(initialEquipment?.description || '');
  const [serialNumber, setSerialNumber] = useState(initialEquipment?.serial_number || '');
  const [manufacturer, setManufacturer] = useState(initialEquipment?.manufacturer || '');
  const [traceability, setTraceability] = useState(initialEquipment?.traceability || 'UME/Turkey');
  const [temperatureEnabled, setTemperatureEnabled] = useState(
    initialEquipment ? Boolean(initialEquipment.temperature_enabled) : true
  );
  const [humidityEnabled, setHumidityEnabled] = useState(
    initialEquipment ? Boolean(initialEquipment.humidity_enabled) : false
  );
  const [notes, setNotes] = useState(initialEquipment?.notes || '');
  const [calibrationDate, setCalibrationDate] = useState(
    initialEquipment?.calibration_date
      ? isoToDDMMYYYYInput(normalizeDateToIso(initialEquipment.calibration_date))
      : ''
  );
  const [dueDate, setDueDate] = useState(
    initialEquipment?.due_date
      ? isoToDDMMYYYYInput(normalizeDateToIso(initialEquipment.due_date))
      : ''
  );

  const [tempConvention, setTempConvention] = useState<CorrectionConvention | ''>(
    initialEquipment?.temperature_convention || 'indication_plus_correction'
  );
  const [tempPoints, setTempPoints] = useState<CorrectionPoint[]>(
    initialEquipment
      ? parsePointsJson(initialEquipment.temperature_points_json)
      : [
          { indication: 0.0, correction: 0.1 },
          { indication: 20.0, correction: 0.15 },
        ]
  );

  const [humidityConvention, setHumidityConvention] = useState<CorrectionConvention | ''>(
    initialEquipment?.humidity_convention || 'indication_plus_correction'
  );
  const [humidityPoints, setHumidityPoints] = useState<CorrectionPoint[]>(
    initialEquipment ? parsePointsJson(initialEquipment.humidity_points_json) : []
  );

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEquipmentCode(initialEquipment?.equipment_code || '');
    setDescription(initialEquipment?.description || '');
    setSerialNumber(initialEquipment?.serial_number || '');
    setManufacturer(initialEquipment?.manufacturer || '');
    setTraceability(initialEquipment?.traceability || 'UME/Turkey');
    setTemperatureEnabled(initialEquipment ? Boolean(initialEquipment.temperature_enabled) : true);
    setHumidityEnabled(initialEquipment ? Boolean(initialEquipment.humidity_enabled) : false);
    setNotes(initialEquipment?.notes || '');
    setCalibrationDate(
      initialEquipment?.calibration_date
        ? isoToDDMMYYYYInput(normalizeDateToIso(initialEquipment.calibration_date))
        : ''
    );
    setDueDate(
      initialEquipment?.due_date
        ? isoToDDMMYYYYInput(normalizeDateToIso(initialEquipment.due_date))
        : ''
    );
    setTempConvention(initialEquipment?.temperature_convention || 'indication_plus_correction');
    setTempPoints(
      initialEquipment
        ? parsePointsJson(initialEquipment.temperature_points_json)
        : [
            { indication: 0.0, correction: 0.1 },
            { indication: 20.0, correction: 0.15 },
          ]
    );
    setHumidityConvention(initialEquipment?.humidity_convention || 'indication_plus_correction');
    setHumidityPoints(initialEquipment ? parsePointsJson(initialEquipment.humidity_points_json) : []);
    setFieldErrors({});
    setError(null);
  }, [initialEquipment, isOpen]);

  if (!isOpen) return null;

  const handleAddTempPoint = () => {
    setTempPoints([...tempPoints, { indication: 0, correction: 0 }]);
  };

  const handleRemoveTempPoint = (index: number) => {
    setTempPoints(tempPoints.filter((_, i) => i !== index));
  };

  const handleUpdateTempPoint = (index: number, field: keyof CorrectionPoint, val: string) => {
    const num = parseFloat(val);
    const updated = [...tempPoints];
    updated[index] = { ...updated[index], [field]: Number.isFinite(num) ? num : 0 };
    setTempPoints(updated);
  };

  const handleAddHumPoint = () => {
    setHumidityPoints([...humidityPoints, { indication: 10, correction: 0 }]);
  };

  const handleRemoveHumPoint = (index: number) => {
    setHumidityPoints(humidityPoints.filter((_, i) => i !== index));
  };

  const handleUpdateHumPoint = (index: number, field: keyof CorrectionPoint, val: string) => {
    const num = parseFloat(val);
    const updated = [...humidityPoints];
    updated[index] = { ...updated[index], [field]: Number.isFinite(num) ? num : 0 };
    setHumidityPoints(updated);
  };

  const validateForm = (): boolean => {
    const errs: Record<string, string> = {};
    const code = equipmentCode.trim().toUpperCase();
    if (!code) {
      errs.equipmentCode = 'Equipment Code is required.';
    } else if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) {
      errs.equipmentCode = 'Use 2–32 alphanumeric characters, dashes, or underscores (e.g. DL006).';
    }

    if (!description.trim()) {
      errs.description = 'Instrument Description is required.';
    }

    if (!serialNumber.trim()) {
      errs.serialNumber = 'Serial Number is required for traceability.';
    }

    const calIso = calibrationDate.trim() ? parseDDMMYYYYToIso(calibrationDate) : '';
    const dueIso = dueDate.trim() ? parseDDMMYYYYToIso(dueDate) : '';

    if (calibrationDate.trim() && !calIso) {
      errs.calibrationDate = 'Enter a valid date in dd/mm/yyyy format (e.g. 01/01/2026).';
    }
    if (dueDate.trim() && !dueIso) {
      errs.dueDate = 'Enter a valid date in dd/mm/yyyy format (e.g. 01/01/2028).';
    } else if (calIso && dueIso && dueIso < calIso) {
      errs.dueDate = 'Calibration Due Date cannot precede Calibration Date.';
    }

    if (!temperatureEnabled && !humidityEnabled) {
      errs.channels = 'Enable at least one measurement channel (Temperature or RH).';
    }

    if (temperatureEnabled) {
      if (tempPoints.some((p) => !Number.isFinite(p.indication) || !Number.isFinite(p.correction))) {
        errs.tempPoints = 'All temperature points must be valid finite numbers.';
      } else {
        const seen = new Set<number>();
        for (const pt of tempPoints) {
          if (seen.has(pt.indication)) {
            errs.tempPoints = `Duplicate temperature indication value: ${pt.indication}°C.`;
            break;
          }
          seen.add(pt.indication);
        }
      }
    }

    if (humidityEnabled && humidityPoints.length > 0) {
      if (humidityPoints.some((p) => !Number.isFinite(p.indication) || !Number.isFinite(p.correction))) {
        errs.humPoints = 'All humidity points must be valid finite numbers.';
      } else {
        const seen = new Set<number>();
        for (const pt of humidityPoints) {
          if (seen.has(pt.indication)) {
            errs.humPoints = `Duplicate humidity indication value: ${pt.indication}%RH.`;
            break;
          }
          seen.add(pt.indication);
        }
      }
    }

    setFieldErrors(errs);
    const firstErr = Object.values(errs)[0];
    setError(firstErr || null);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const calIso = calibrationDate.trim() ? parseDDMMYYYYToIso(calibrationDate) || '' : '';
    const dueIso = dueDate.trim() ? parseDDMMYYYYToIso(dueDate) || '' : '';

    const record: EquipmentRecord = {
      equipment_code: equipmentCode.trim().toUpperCase(),
      description: description.trim(),
      serial_number: serialNumber.trim(),
      manufacturer: manufacturer.trim(),
      traceability: traceability.trim(),
      temperature_enabled: temperatureEnabled ? 1 : 0,
      humidity_enabled: humidityEnabled ? 1 : 0,
      notes: notes.trim(),
      calibration_date: calIso,
      due_date: dueIso,
      temperature_convention: tempConvention,
      temperature_points_json: JSON.stringify(tempPoints),
      humidity_convention: humidityConvention,
      humidity_points_json: JSON.stringify(humidityPoints),
      updated_at: new Date().toISOString(),
    };

    onSave(record);
    onClose();
  };

  const dueInfo = getCalibrationDueInfo(parseDDMMYYYYToIso(dueDate) || '');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#1e293b] rounded-t-2xl sm:rounded-xl max-w-3xl w-full max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto shadow-2xl border border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 pb-safe sm:pb-6 space-y-5">
        <div className="flex items-center justify-between pb-4 border-b border-[#edf0f4] dark:border-[#334155]">
          <div>
            <p className="text-[10px] uppercase font-bold text-[#5275ad] dark:text-blue-400 tracking-wider">
              Equipment Registry
            </p>
            <h2 className="text-xl font-bold text-[#182330] dark:text-slate-100">
              {isNew ? 'Add Data Logger' : `Data Logger: ${equipmentCode}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#788493] hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] hover:text-[#182330] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[#fff0ed] dark:bg-red-950/40 text-[#bd4d42] dark:text-red-300 border border-[#f5c6cb] dark:border-red-900 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Equipment details */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-[#182330] dark:text-slate-100">Equipment details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                Equipment Code <span className="text-[#bd4d42]">*</span>
                <input
                  type="text"
                  value={equipmentCode}
                  onChange={(e) => setEquipmentCode(e.target.value)}
                  readOnly={!isNew}
                  placeholder="DL006"
                  className={`mt-1.5 w-full h-10 px-3 rounded-lg border text-xs bg-white dark:bg-[#0f172a] text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                    fieldErrors.equipmentCode
                      ? 'border-[#bd4d42]'
                      : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
                  }`}
                />
                {fieldErrors.equipmentCode && (
                  <span className="text-[11px] font-medium text-[#bd4d42] mt-1 block">{fieldErrors.equipmentCode}</span>
                )}
              </label>

              <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                Instrument Description <span className="text-[#bd4d42]">*</span>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Temperature & RH Data Logger"
                  className={`mt-1.5 w-full h-10 px-3 rounded-lg border text-xs bg-white dark:bg-[#0f172a] text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                    fieldErrors.description
                      ? 'border-[#bd4d42]'
                      : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
                  }`}
                />
                {fieldErrors.description && (
                  <span className="text-[11px] font-medium text-[#bd4d42] mt-1 block">{fieldErrors.description}</span>
                )}
              </label>

              <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                Serial Number <span className="text-[#bd4d42]">*</span>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="84435686"
                  className={`mt-1.5 w-full h-10 px-3 rounded-lg border text-xs bg-white dark:bg-[#0f172a] text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                    fieldErrors.serialNumber
                      ? 'border-[#bd4d42]'
                      : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
                  }`}
                />
                {fieldErrors.serialNumber && (
                  <span className="text-[11px] font-medium text-[#bd4d42] mt-1 block">{fieldErrors.serialNumber}</span>
                )}
              </label>

              <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                Manufacturer
                <input
                  type="text"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="Testo"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
                />
              </label>
            </div>

            <div className="pt-1">
              <p className="text-xs font-semibold text-[#334052] dark:text-slate-300 mb-2">Measurement channels</p>
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <label className="flex items-center gap-2 text-xs font-medium text-[#334052] dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={temperatureEnabled}
                    onChange={(e) => setTemperatureEnabled(e.target.checked)}
                    className="rounded text-[#2864dc]"
                  />
                  <span>Temperature Channel</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-[#334052] dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={humidityEnabled}
                    onChange={(e) => setHumidityEnabled(e.target.checked)}
                    className="rounded text-[#2864dc]"
                  />
                  <span>Relative Humidity Channel</span>
                </label>
              </div>
              {fieldErrors.channels && (
                <span className="text-[11px] font-medium text-[#bd4d42] mt-1 block">{fieldErrors.channels}</span>
              )}
            </div>

            <label className="block text-xs font-semibold text-[#334052] dark:text-slate-300">
              Equipment Notes
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Laboratory calibration notes or position history"
                className="mt-1.5 w-full p-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
              />
            </label>
          </div>

          {/* Calibration Certificate */}
          <div className="space-y-4 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#182330] dark:text-slate-100">Calibration Certificate</h3>
              <span
                className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums ${
                  dueInfo.tier === 'expired'
                    ? 'bg-[#fff0ed] text-[#bd4d42]'
                    : dueInfo.tier === 'expiring'
                    ? 'bg-[#fff5dc] text-[#94620c]'
                    : dueInfo.tier === 'valid'
                    ? 'bg-[#e8f5ed] text-[#1b6b3e]'
                    : 'bg-[#f5f7fa] text-[#647184]'
                }`}
              >
                {dueInfo.badgeText}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                <span>Calibration Date</span>
                <DateInputDDMMYYYY
                  value={calibrationDate}
                  onChange={(val) => {
                    setCalibrationDate(val);
                    if (fieldErrors.calibrationDate) {
                      setFieldErrors((prev) => ({ ...prev, calibrationDate: '' }));
                    }
                  }}
                  hasError={Boolean(fieldErrors.calibrationDate)}
                  ariaLabel="Calibration Date (dd/mm/yyyy)"
                />
                {fieldErrors.calibrationDate && (
                  <span className="text-[11px] font-medium text-[#bd4d42] mt-1 block">
                    {fieldErrors.calibrationDate}
                  </span>
                )}
              </div>

              <div className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                <span>Calibration Due Date</span>
                <DateInputDDMMYYYY
                  value={dueDate}
                  onChange={(val) => {
                    setDueDate(val);
                    if (fieldErrors.dueDate) {
                      setFieldErrors((prev) => ({ ...prev, dueDate: '' }));
                    }
                  }}
                  hasError={Boolean(fieldErrors.dueDate)}
                  ariaLabel="Calibration Due Date (dd/mm/yyyy)"
                />
                {fieldErrors.dueDate && (
                  <span className="text-[11px] font-medium text-[#bd4d42] mt-1 block">
                    {fieldErrors.dueDate}
                  </span>
                )}
              </div>

              <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                Traceability
                <input
                  type="text"
                  value={traceability}
                  onChange={(e) => setTraceability(e.target.value)}
                  placeholder="UME / Turkey"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                />
              </label>
            </div>
          </div>

          {/* Temperature Corrections */}
          {temperatureEnabled && (
            <div className="space-y-3 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-[#182330] dark:text-slate-100">Temperature Corrections</h4>
                  <p className="text-[11px] text-[#788493] dark:text-slate-400">Indication and correction points in °C</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#334052] dark:text-slate-300">Convention:</span>
                  <select
                    value={tempConvention}
                    onChange={(e) => setTempConvention(e.target.value as CorrectionConvention)}
                    className="h-8 px-2 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none"
                  >
                    <option value="indication_plus_correction">Indication + correction</option>
                    <option value="indication_minus_correction">Indication - correction</option>
                  </select>
                </div>
              </div>

              {fieldErrors.tempPoints && (
                <p className="text-[11px] font-medium text-[#bd4d42]">{fieldErrors.tempPoints}</p>
              )}

              <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#647184] dark:text-slate-300 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="p-2.5">Indication (°C)</th>
                      <th className="p-2.5">Correction (°C)</th>
                      <th className="p-2.5 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                    {tempPoints.map((pt, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            value={pt.indication}
                            onChange={(e) => handleUpdateTempPoint(idx, 'indication', e.target.value)}
                            className="w-full h-8 px-2 border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] rounded text-xs tabular-nums text-[#182330] dark:text-slate-100"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            value={pt.correction}
                            onChange={(e) => handleUpdateTempPoint(idx, 'correction', e.target.value)}
                            className="w-full h-8 px-2 border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] rounded text-xs tabular-nums text-[#182330] dark:text-slate-100"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveTempPoint(idx)}
                            className="text-[#bd4d42] hover:text-[#913b32] p-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={handleAddTempPoint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#345a9e] dark:text-blue-400 hover:bg-[#f9fbff] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add temperature point</span>
              </button>
            </div>
          )}

          {/* Humidity Corrections */}
          {humidityEnabled && (
            <div className="space-y-3 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-[#182330] dark:text-slate-100">Relative Humidity Corrections</h4>
                  <p className="text-[11px] text-[#788493] dark:text-slate-400">Indication in %RH; correction in RH percentage points</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#334052] dark:text-slate-300">Convention:</span>
                  <select
                    value={humidityConvention}
                    onChange={(e) => setHumidityConvention(e.target.value as CorrectionConvention)}
                    className="h-8 px-2 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none"
                  >
                    <option value="indication_plus_correction">Indication + correction</option>
                    <option value="indication_minus_correction">Indication - correction</option>
                  </select>
                </div>
              </div>

              {fieldErrors.humPoints && (
                <p className="text-[11px] font-medium text-[#bd4d42]">{fieldErrors.humPoints}</p>
              )}

              <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#647184] dark:text-slate-300 uppercase text-[10px] font-bold">
                    <tr>
                      <th className="p-2.5">Indication (%RH)</th>
                      <th className="p-2.5">Correction (pts)</th>
                      <th className="p-2.5 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                    {humidityPoints.map((pt, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            value={pt.indication}
                            onChange={(e) => handleUpdateHumPoint(idx, 'indication', e.target.value)}
                            className="w-full h-8 px-2 border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] rounded text-xs tabular-nums text-[#182330] dark:text-slate-100"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="any"
                            value={pt.correction}
                            onChange={(e) => handleUpdateHumPoint(idx, 'correction', e.target.value)}
                            className="w-full h-8 px-2 border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] rounded text-xs tabular-nums text-[#182330] dark:text-slate-100"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveHumPoint(idx)}
                            className="text-[#bd4d42] hover:text-[#913b32] p-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={handleAddHumPoint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#345a9e] dark:text-blue-400 hover:bg-[#f9fbff] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add RH point</span>
              </button>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
            {!isNew && onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(initialEquipment.equipment_code)}
                className="w-full sm:w-auto min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#fed7d0] dark:border-red-900 bg-[#fff0ed] dark:bg-red-950/40 text-xs font-semibold text-[#bd4d42] dark:text-red-300 hover:bg-[#ffe3de] cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Equipment</span>
              </button>
            ) : (
              <div className="hidden sm:block" />
            )}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2.5 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-5 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] shadow-xs cursor-pointer"
              >
                Save Equipment Record
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
