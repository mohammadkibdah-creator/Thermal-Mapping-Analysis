import React, { useState, useEffect } from 'react';
import { SuperDaqSensorRecord, parsePointsJson } from '../store/metrologyStore.ts';
import { CorrectionPoint, CorrectionConvention } from '../utils/metrology.ts';
import { normalizeDateToIso } from '../services/sheetService.ts';
import {
  getCalibrationDueInfo,
  isoToDDMMYYYYInput,
  parseDDMMYYYYToIso,
} from '../utils/dateFormat.ts';
import { DateInputDDMMYYYY } from './DateInputDDMMYYYY.tsx';
import { X, Plus, Trash2, AlertCircle } from 'lucide-react';

interface SuperDaqSensorModalProps {
  initialSensor: SuperDaqSensorRecord | null;
  kitCode: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (sensor: SuperDaqSensorRecord) => void;
}

const DEFAULT_PT100_POINTS: CorrectionPoint[] = [
  { indication: -40.0, correction: 0.015 },
  { indication: 0.0, correction: 0.027 },
  { indication: 40.0, correction: 0.061 },
  { indication: 100.0, correction: 0.17 },
];

export const SuperDaqSensorModal: React.FC<SuperDaqSensorModalProps> = ({
  initialSensor,
  kitCode,
  isOpen,
  onClose,
  onSave,
}) => {
  const isNew = !initialSensor;
  const [sensorCode, setSensorCode] = useState(
    initialSensor?.sensor_code || `SDQ${kitCode}CH${Math.floor(Math.random() * 900 + 100)}`
  );
  const [name, setName] = useState(initialSensor?.name || 'Resistance Thermometer (PT 100)');
  const [channelIdentifier, setChannelIdentifier] = useState(initialSensor?.channel_identifier || 'Ch 101 (C)');
  const [serialNumber, setSerialNumber] = useState(initialSensor?.serial_number || '1');
  const [position, setPosition] = useState(initialSensor?.position || '');
  const [calibrationDate, setCalibrationDate] = useState(
    initialSensor?.calibration_date
      ? isoToDDMMYYYYInput(normalizeDateToIso(initialSensor.calibration_date))
      : '01/08/2026'
  );
  const [dueDate, setDueDate] = useState(
    initialSensor?.due_date
      ? isoToDDMMYYYYInput(normalizeDateToIso(initialSensor.due_date))
      : '01/08/2027'
  );
  const [certificateNumber, setCertificateNumber] = useState(initialSensor?.certificate_number || '');
  const [provider, setProvider] = useState(initialSensor?.provider || '');
  const [traceability, setTraceability] = useState(initialSensor?.traceability || 'UME/Turkey');
  const [temperatureConvention, setTemperatureConvention] = useState<CorrectionConvention | ''>(
    initialSensor?.temperature_convention || 'indication_plus_correction'
  );
  const [points, setPoints] = useState<CorrectionPoint[]>(
    initialSensor ? parsePointsJson(initialSensor.temperature_points_json) : DEFAULT_PT100_POINTS
  );
  const [notes, setNotes] = useState(initialSensor?.notes || '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setSensorCode(
      initialSensor?.sensor_code || `SDQ${kitCode}CH${Math.floor(Math.random() * 900 + 100)}`
    );
    setName(initialSensor?.name || 'Resistance Thermometer (PT 100)');
    setChannelIdentifier(initialSensor?.channel_identifier || 'Ch 101 (C)');
    setSerialNumber(initialSensor?.serial_number || '1');
    setPosition(initialSensor?.position || '');
    setCalibrationDate(
      initialSensor?.calibration_date
        ? isoToDDMMYYYYInput(normalizeDateToIso(initialSensor.calibration_date))
        : '01/08/2026'
    );
    setDueDate(
      initialSensor?.due_date
        ? isoToDDMMYYYYInput(normalizeDateToIso(initialSensor.due_date))
        : '01/08/2027'
    );
    setCertificateNumber(initialSensor?.certificate_number || '');
    setProvider(initialSensor?.provider || '');
    setTraceability(initialSensor?.traceability || 'UME/Turkey');
    setTemperatureConvention(initialSensor?.temperature_convention || 'indication_plus_correction');
    setPoints(
      initialSensor ? parsePointsJson(initialSensor.temperature_points_json) : DEFAULT_PT100_POINTS
    );
    setNotes(initialSensor?.notes || '');
    setErrors({});
  }, [initialSensor, kitCode, isOpen]);

  if (!isOpen) return null;

  const parsedDueIso = parseDDMMYYYYToIso(dueDate) || '';
  const dueInfo = getCalibrationDueInfo(parsedDueIso);

  const handleAddPoint = () => {
    setPoints([...points, { indication: 0, correction: 0 }]);
  };

  const handleRemovePoint = (idx: number) => {
    setPoints(points.filter((_, i) => i !== idx));
  };

  const handleUpdatePoint = (idx: number, field: keyof CorrectionPoint, val: string) => {
    const num = val === '' ? NaN : parseFloat(val);
    const updated = [...points];
    updated[idx] = { ...updated[idx], [field]: num };
    setPoints(updated);
    if (errors.points) setErrors((p) => ({ ...p, points: '' }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};

    if (!channelIdentifier.trim()) {
      nextErrors.channelIdentifier = 'Channel Identifier is required (e.g., Ch 101 (C)).';
    }
    if (!sensorCode.trim()) {
      nextErrors.sensorCode = 'Sensor Code is required.';
    }
    const calIso = calibrationDate.trim() ? parseDDMMYYYYToIso(calibrationDate) : '';
    const dueIso = dueDate.trim() ? parseDDMMYYYYToIso(dueDate) : '';

    if (calibrationDate.trim() && !calIso) {
      nextErrors.calibrationDate = 'Enter a valid date in dd/mm/yyyy format (e.g. 01/08/2026).';
    }
    if (dueDate.trim() && !dueIso) {
      nextErrors.dueDate = 'Enter a valid date in dd/mm/yyyy format (e.g. 01/08/2027).';
    } else if (calIso && dueIso && dueIso < calIso) {
      nextErrors.dueDate = 'Calibration Due Date cannot precede Calibration Date.';
    }

    if (points.length > 0 && points.length < 2) {
      nextErrors.points = 'Provide at least 2 calibration points for linear interpolation (or leave 0 for nominal).';
    } else if (points.some((p) => !Number.isFinite(p.indication) || !Number.isFinite(p.correction))) {
      nextErrors.points = 'All calibration indication and correction values must be valid numbers.';
    } else if (new Set(points.map((p) => p.indication)).size !== points.length) {
      nextErrors.points = 'Calibration indication values must be unique.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onSave({
      sensor_code: sensorCode.trim().toUpperCase(),
      kit_code: kitCode,
      name: name.trim() || 'Resistance Thermometer (PT 100)',
      channel_identifier: channelIdentifier.trim(),
      serial_number: serialNumber.trim(),
      position: position.trim(),
      calibration_date: calIso || '',
      due_date: dueIso || '',
      certificate_number: certificateNumber.trim(),
      provider: provider.trim(),
      traceability: traceability.trim(),
      temperature_convention: temperatureConvention,
      temperature_points_json: JSON.stringify(points),
      notes: notes.trim(),
      updated_at: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#1e293b] rounded-t-2xl sm:rounded-xl max-w-2xl w-full max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto shadow-2xl border border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 pb-safe sm:pb-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#edf0f4] dark:border-[#334155]">
          <div>
            <p className="text-[10px] uppercase font-bold text-[#5275ad] dark:text-blue-400 tracking-wider">
              SuperDAQ Kit: {kitCode}
            </p>
            <h2 className="text-lg font-bold text-[#182330] dark:text-slate-100">
              {isNew ? 'Add SuperDAQ Sensor' : `Edit Sensor: ${channelIdentifier}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#788493] hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Channel Identifier (as exported in Excel) <span className="text-[#bd4d42]">*</span>
              <input
                type="text"
                value={channelIdentifier}
                onChange={(e) => {
                  setChannelIdentifier(e.target.value);
                  if (errors.channelIdentifier) setErrors((p) => ({ ...p, channelIdentifier: '' }));
                }}
                placeholder="Ch 101 (C)"
                className={`mt-1 w-full h-10 px-3 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                  errors.channelIdentifier ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
                }`}
              />
              {errors.channelIdentifier && (
                <span className="flex items-center gap-1 text-[11px] text-[#bd4d42] font-normal mt-1">
                  <AlertCircle className="w-3 h-3" /> {errors.channelIdentifier}
                </span>
              )}
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Sensor Code <span className="text-[#bd4d42]">*</span>
              <input
                type="text"
                readOnly={!isNew}
                value={sensorCode}
                onChange={(e) => {
                  setSensorCode(e.target.value);
                  if (errors.sensorCode) setErrors((p) => ({ ...p, sensorCode: '' }));
                }}
                className={`mt-1 w-full h-10 px-3 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                  errors.sensorCode ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
                } ${!isNew ? 'opacity-70 cursor-not-allowed' : ''}`}
              />
              {errors.sensorCode && (
                <span className="flex items-center gap-1 text-[11px] text-[#bd4d42] font-normal mt-1">
                  <AlertCircle className="w-3 h-3" /> {errors.sensorCode}
                </span>
              )}
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Sensor Name / Model
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Resistance Thermometer (PT 100)"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
              />
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Sensor Serial Number
              <input
                type="text"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="1"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc]"
              />
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300 md:col-span-2">
              Position / Location
              <input
                type="text"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="Top shelf, front-left corner"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#edf0f4] dark:border-[#334155]">
            <div className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              <span>Calibration Date</span>
              <DateInputDDMMYYYY
                value={calibrationDate}
                onChange={(val) => {
                  setCalibrationDate(val);
                  if (errors.calibrationDate) setErrors((p) => ({ ...p, calibrationDate: '' }));
                }}
                hasError={Boolean(errors.calibrationDate)}
                className="mt-1!"
                ariaLabel="Calibration Date (dd/mm/yyyy)"
              />
              {errors.calibrationDate && (
                <span className="flex items-center gap-1 text-[11px] text-[#bd4d42] font-normal mt-1">
                  <AlertCircle className="w-3 h-3" /> {errors.calibrationDate}
                </span>
              )}
            </div>

            <div className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              <span>Calibration Due Date</span>
              <DateInputDDMMYYYY
                value={dueDate}
                onChange={(val) => {
                  setDueDate(val);
                  if (errors.dueDate) setErrors((p) => ({ ...p, dueDate: '' }));
                }}
                hasError={Boolean(errors.dueDate)}
                className="mt-1!"
                ariaLabel="Calibration Due Date (dd/mm/yyyy)"
              />
              {errors.dueDate ? (
                <span className="flex items-center gap-1 text-[11px] text-[#bd4d42] font-normal mt-1">
                  <AlertCircle className="w-3 h-3" /> {errors.dueDate}
                </span>
              ) : (
                parsedDueIso && (
                  <span className="text-[10px] text-[#788493] dark:text-slate-400 font-normal mt-0.5 block tabular-nums">
                    {dueInfo.badgeText}
                  </span>
                )
              )}
            </div>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Traceability
              <input
                type="text"
                value={traceability}
                onChange={(e) => setTraceability(e.target.value)}
                placeholder="UME / Turkey"
                className="mt-1 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
              />
            </label>
          </div>

          {/* Temperature Calibration Points */}
          <div className="space-y-3 pt-3 border-t border-[#edf0f4] dark:border-[#334155]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-[#182330] dark:text-slate-100">Calibration Corrections</h4>
                <p className="text-[11px] text-[#788493] dark:text-slate-400">Indication & correction in °C</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#334052] dark:text-slate-300">Convention:</span>
                <select
                  value={temperatureConvention}
                  onChange={(e) => setTemperatureConvention(e.target.value as CorrectionConvention)}
                  className="h-8 px-2 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none"
                >
                  <option value="indication_plus_correction">Indication + correction</option>
                  <option value="indication_minus_correction">Indication - correction</option>
                </select>
              </div>
            </div>

            {errors.points && (
              <p className="flex items-center gap-1.5 text-[11px] text-[#bd4d42] font-medium">
                <AlertCircle className="w-3.5 h-3.5" /> {errors.points}
              </p>
            )}

            <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden max-h-44 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-2">Indication (°C)</th>
                    <th className="p-2">Correction (°C)</th>
                    <th className="p-2 w-10 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                  {points.map((pt, idx) => (
                    <tr key={idx}>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="any"
                          value={Number.isNaN(pt.indication) ? '' : pt.indication}
                          onChange={(e) => handleUpdatePoint(idx, 'indication', e.target.value)}
                          className="w-full h-7 px-2 border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] rounded text-xs text-[#182330] dark:text-slate-100 tabular-nums"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="number"
                          step="any"
                          value={Number.isNaN(pt.correction) ? '' : pt.correction}
                          onChange={(e) => handleUpdatePoint(idx, 'correction', e.target.value)}
                          className="w-full h-7 px-2 border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] rounded text-xs text-[#182330] dark:text-slate-100 tabular-nums"
                        />
                      </td>
                      <td className="p-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemovePoint(idx)}
                          className="text-[#bd4d42] p-1 hover:bg-[#fff0ed] dark:hover:bg-red-950/40 rounded cursor-pointer"
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
              onClick={handleAddPoint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#345a9e] dark:text-blue-400 hover:bg-[#f9fbff] dark:hover:bg-[#0f172a] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add calibration point</span>
            </button>
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto min-h-[42px] sm:min-h-0 px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 px-5 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] cursor-pointer"
            >
              Save Sensor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
