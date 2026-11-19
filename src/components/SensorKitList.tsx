import React, { useState, useMemo } from 'react';
import {
  SensorKitRecord,
  SuperDaqSensorRecord,
  isRecordExpired,
  parsePointsJson,
} from '../store/metrologyStore.ts';
import {
  Plus,
  Search,
  Filter,
  Trash2,
  Edit3,
  Download,
  Columns,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  X,
  CheckSquare,
  Calendar,
  Award,
  ChevronDown,
  ChevronRight,
  Cpu,
} from 'lucide-react';
import { SensorKitModal } from './SensorKitModal.tsx';
import { SuperDaqSensorModal } from './SuperDaqSensorModal.tsx';
import { exportSuperDaqRegistryWorkbook } from '../utils/excelExport.ts';
import { formatDateDDMMYYYY, getCalibrationDueInfo } from '../utils/dateFormat.ts';

interface SensorKitListProps {
  kits: SensorKitRecord[];
  sensors: SuperDaqSensorRecord[];
  onSaveKit: (kit: SensorKitRecord) => void;
  onDeleteKit: (kitCode: string) => void;
  onSaveSensor: (sensor: SuperDaqSensorRecord) => void;
  onDeleteSensors: (sensorCodes: string[]) => void;
  onImportKitWithSensors?: (kit: SensorKitRecord, newSensors: SuperDaqSensorRecord[]) => void;
}

type SortKey =
  | 'channel_identifier'
  | 'name'
  | 'serial_number'
  | 'traceability'
  | 'calibration_date'
  | 'due_date'
  | 'days_left'
  | 'points';

type ColumnKey =
  | 'description'
  | 'serial_number'
  | 'traceability'
  | 'calibration_date'
  | 'due_date'
  | 'certificate'
  | 'points';

const COLUMN_LABELS: Record<ColumnKey, string> = {
  description: 'Description',
  serial_number: 'Serial No',
  traceability: 'Traceability',
  calibration_date: 'Cal Date',
  due_date: 'Cal Due',
  certificate: 'Certificate',
  points: 'Correction Points',
};

function isSensorIncomplete(sensor: SuperDaqSensorRecord): boolean {
  const pts = parsePointsJson(sensor.temperature_points_json);
  if (pts.length < 2) return true;
  if (!sensor.serial_number || !sensor.name) return true;
  return false;
}

export const SensorKitList: React.FC<SensorKitListProps> = ({
  kits,
  sensors,
  onSaveKit,
  onDeleteKit,
  onSaveSensor,
  onDeleteSensors,
}) => {
  const [expandedKitCodes, setExpandedKitCodes] = useState<Record<string, boolean>>({
    KIT_44070036: true,
    KIT001: true,
  });

  // Search & Filter state (matching Data Loggers)
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'expired'>('all');

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>('channel_identifier');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Column visibility toggle state
  const [visibleCols, setVisibleCols] = useState<Record<ColumnKey, boolean>>({
    description: true,
    serial_number: true,
    traceability: true,
    calibration_date: true,
    due_date: true,
    certificate: true,
    points: true,
  });
  const [showColMenu, setShowColMenu] = useState(false);

  // Bulk select & delete confirmation state
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [pendingDeleteSensorCodes, setPendingDeleteSensorCodes] = useState<string[] | null>(null);
  const [kitToDelete, setKitToDelete] = useState<SensorKitRecord | null>(null);

  // Modals & Row Details Drawer
  const [selectedKit, setSelectedKit] = useState<SensorKitRecord | null>(null);
  const [isKitModalOpen, setIsKitModalOpen] = useState(false);
  const [activeKitCodeForSensor, setActiveKitCodeForSensor] = useState<string | null>(null);
  const [selectedSensor, setSelectedSensor] = useState<SuperDaqSensorRecord | null>(null);
  const [isSensorModalOpen, setIsSensorModalOpen] = useState(false);
  const [drawerSensor, setDrawerSensor] = useState<SuperDaqSensorRecord | null>(null);

  const [isExporting, setIsExporting] = useState(false);

  const toggleExpand = (kitCode: string) => {
    setExpandedKitCodes((prev) => ({ ...prev, [kitCode]: !prev[kitCode] }));
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Filtered & sorted sensors
  const filteredAndSortedSensors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = sensors.filter((s) => {
      const matchesSearch =
        !q ||
        s.channel_identifier.toLowerCase().includes(q) ||
        s.sensor_code.toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (s.serial_number || '').toLowerCase().includes(q) ||
        (s.traceability || '').toLowerCase().includes(q) ||
        (s.position || '').toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (filter === 'expired') return Boolean(s.due_date && isRecordExpired(s.due_date));
      if (filter === 'incomplete') return isSensorIncomplete(s);
      return true;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'channel_identifier':
          return (
            a.channel_identifier.localeCompare(b.channel_identifier, undefined, { numeric: true }) *
            mult
          );
        case 'name':
          return (a.name || '').localeCompare(b.name || '') * mult;
        case 'serial_number':
          return (
            (a.serial_number || '').localeCompare(b.serial_number || '', undefined, {
              numeric: true,
            }) * mult
          );
        case 'traceability':
          return (a.traceability || '').localeCompare(b.traceability || '') * mult;
        case 'calibration_date':
          return (a.calibration_date || '').localeCompare(b.calibration_date || '') * mult;
        case 'due_date':
          return (a.due_date || '').localeCompare(b.due_date || '') * mult;
        case 'days_left': {
          const da = getCalibrationDueInfo(a.due_date).daysRemaining ?? -999999;
          const db = getCalibrationDueInfo(b.due_date).daysRemaining ?? -999999;
          return (da - db) * mult;
        }
        case 'points': {
          const pa = parsePointsJson(a.temperature_points_json).length;
          const pb = parsePointsJson(b.temperature_points_json).length;
          return (pa - pb) * mult;
        }
        default:
          return 0;
      }
    });
  }, [sensors, search, filter, sortKey, sortDir]);

  const toggleSelectOne = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleSelectKitSensors = (kitSensors: SuperDaqSensorRecord[]) => {
    const allSelected =
      kitSensors.length > 0 && kitSensors.every((s) => selectedCodes.has(s.sensor_code));
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        kitSensors.forEach((s) => next.delete(s.sensor_code));
      } else {
        kitSensors.forEach((s) => next.add(s.sensor_code));
      }
      return next;
    });
  };

  const handleExportRegistry = async () => {
    setIsExporting(true);
    try {
      const bytes = await exportSuperDaqRegistryWorkbook(kits, filteredAndSortedSensors);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SuperDAQ_Registry.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#2864dc]" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#2864dc]" />
    );
  };

  const renderCalDueBadge = (dueDateStr: string) => {
    const info = getCalibrationDueInfo(dueDateStr);
    if (info.tier === 'expired') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] dark:text-red-300 border border-[#fed7d0] dark:border-red-900 whitespace-nowrap tabular-nums">
          {info.badgeText}
        </span>
      );
    }
    if (info.tier === 'expiring') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fff5dc] dark:bg-amber-950/60 text-[#94620c] dark:text-amber-300 border border-[#fde8c2] dark:border-amber-900 whitespace-nowrap tabular-nums">
          {info.badgeText}
        </span>
      );
    }
    if (info.tier === 'valid') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f5ed] dark:bg-emerald-950/60 text-[#1b6b3e] dark:text-emerald-300 border border-[#c1e7ce] dark:border-emerald-900 whitespace-nowrap tabular-nums">
          {info.badgeText}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#f5f7fa] dark:bg-slate-800 text-[#788493] dark:text-slate-400 whitespace-nowrap">
        {info.badgeText}
      </span>
    );
  };

  const visibleColCount = 2 + Object.values(visibleCols).filter(Boolean).length + 1;

  return (
    <div className="space-y-5">
      {/* Header & Actions */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-bold text-[#5275ad] dark:text-blue-400 mb-1">
            Equipment Registry
          </p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#182330] dark:text-slate-100 tracking-tight">
            SuperDAQ Sensor Kits
          </h1>
          <p className="text-xs text-[#647184] dark:text-slate-400 mt-0.5">
            Manage Fluke SuperDAQ multi-channel mainframes and calibrated PT100 temperature sensors.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleExportRegistry}
            disabled={isExporting}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1e293b] border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#334052] dark:text-slate-200 hover:bg-[#f9fbff] dark:hover:bg-[#0f172a] transition-colors cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-[#059669]" />
            <span>{isExporting ? 'Exporting...' : 'Export to Excel'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedKit(null);
              setIsKitModalOpen(true);
            }}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] transition-colors shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2864dc]/40"
          >
            <Plus className="w-4 h-4" />
            <span>Add Sensor Kit</span>
          </button>
        </div>
      </section>

      {/* Search, Filter & Column Visibility Bar (matching Data Loggers) */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[#788493] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channel, code, serial, traceability..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 focus:border-[#2864dc]"
            />
          </div>

          {/* Column Visibility Dropdown */}
          <div className="relative hidden md:block">
            <button
              type="button"
              onClick={() => setShowColMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-[#f8f9fb] dark:bg-[#0f172a] text-xs font-semibold text-[#334052] dark:text-slate-300 hover:bg-[#edf3ff] dark:hover:bg-[#334155] cursor-pointer transition-colors"
            >
              <Columns className="w-3.5 h-3.5 text-[#2864dc]" />
              <span>Columns</span>
            </button>

            {showColMenu && (
              <div className="absolute left-0 mt-1.5 w-48 rounded-xl bg-white dark:bg-[#1e293b] border border-[#e5e9ef] dark:border-[#334155] shadow-lg p-2 z-30 space-y-1">
                {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((colKey) => (
                  <label
                    key={colKey}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] text-xs text-[#334052] dark:text-slate-200 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols[colKey]}
                      onChange={() =>
                        setVisibleCols((prev) => ({ ...prev, [colKey]: !prev[colKey] }))
                      }
                      className="rounded text-[#2864dc]"
                    />
                    <span>{COLUMN_LABELS[colKey]}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[11px] font-semibold text-[#788493] mr-1 hidden sm:inline-flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </span>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
              filter === 'all'
                ? 'bg-[#182330] dark:bg-[#2864dc] text-white'
                : 'text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a]'
            }`}
          >
            All Sensors ({sensors.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('incomplete')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'incomplete'
                ? 'bg-[#94620c] text-white'
                : 'text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a]'
            }`}
          >
            Incomplete
          </button>
          <button
            type="button"
            onClick={() => setFilter('expired')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              filter === 'expired'
                ? 'bg-[#bd4d42] text-white'
                : 'text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a]'
            }`}
          >
            Expired
          </button>
        </div>
      </section>

      {/* Bulk Action Bar */}
      {selectedCodes.size > 0 && (
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 px-4 py-2.5 rounded-xl bg-[#edf3ff] dark:bg-blue-950/50 border border-[#dce6f7] dark:border-blue-800">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#182330] dark:text-slate-100 tabular-nums">
            <CheckSquare className="w-4 h-4 text-[#2864dc]" />
            <span>{selectedCodes.size} sensor(s) selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedCodes(new Set())}
              className="flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#526071] dark:text-slate-300 hover:bg-white/70 dark:hover:bg-[#1e293b] cursor-pointer"
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={() => setPendingDeleteSensorCodes(Array.from(selectedCodes))}
              className="flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#bd4d42] text-white text-xs font-semibold hover:bg-[#913b32] cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected ({selectedCodes.size})</span>
            </button>
          </div>
        </section>
      )}

      {/* Kits List */}
      <div className="space-y-4">
        {kits.map((kit, index) => {
          const totalKitSensors = sensors.filter((s) => s.kit_code === kit.kit_code);
          const kitSensors = filteredAndSortedSensors.filter((s) => s.kit_code === kit.kit_code);
          const isExpanded = expandedKitCodes[kit.kit_code] ?? true;
          const allKitSelected =
            kitSensors.length > 0 && kitSensors.every((s) => selectedCodes.has(s.sensor_code));

          return (
            <div
              key={`${kit.kit_code}-${index}`}
              className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs overflow-hidden transition-colors"
            >
              {/* Kit Header Card */}
              <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#fcfdfe] dark:bg-[#0f172a]/50 border-b border-[#edf0f4] dark:border-[#334155]">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(kit.kit_code)}
                    className="p-1 rounded-lg text-[#788493] hover:bg-[#f0f3f7] dark:hover:bg-[#334155] cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5 text-[#2864dc]" />
                    ) : (
                      <ChevronRight className="w-5 h-5" />
                    )}
                  </button>

                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-[#edf3ff] dark:bg-blue-950/60 text-[#2864dc] dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                      <Cpu className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-[#2864dc] dark:text-blue-400">
                          {kit.kit_code}
                        </span>
                        <span className="text-sm font-bold text-[#182330] dark:text-slate-100">
                          {kit.name}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            kit.status === 'Active'
                              ? 'bg-[#e8f5ed] dark:bg-emerald-950/60 text-[#32704d] dark:text-emerald-300'
                              : 'bg-[#f5f7fa] dark:bg-slate-800 text-[#788493] dark:text-slate-400'
                          }`}
                        >
                          {kit.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#788493] dark:text-slate-400 mt-0.5 flex items-center gap-2 tabular-nums">
                        <span>
                          Serial:{' '}
                          <strong className="text-[#334052] dark:text-slate-200 tabular-nums">
                            {kit.serial_number || '—'}
                          </strong>
                        </span>
                        <span>·</span>
                        <span>
                          {kitSensors.length === totalKitSensors.length
                            ? `${totalKitSensors.length} registered PT100 sensors`
                            : `${kitSensors.length} of ${totalKitSensors.length} sensors shown`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveKitCodeForSensor(kit.kit_code);
                      setSelectedSensor(null);
                      setIsSensorModalOpen(true);
                    }}
                    className="min-h-[38px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#2864dc] dark:text-blue-400 hover:bg-[#f5f8ff] dark:hover:bg-[#0f172a] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Sensor</span>
                  </button>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKit(kit);
                        setIsKitModalOpen(true);
                      }}
                      className="min-h-[38px] sm:min-h-0 inline-flex items-center gap-1 text-xs font-semibold text-[#667384] dark:text-slate-300 hover:text-[#182330] dark:hover:text-white cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Kit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setKitToDelete(kit)}
                      className="min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 inline-flex items-center justify-center p-1.5 rounded-lg text-[#bd4d42] hover:bg-[#fff0ed] dark:hover:bg-red-950/40 hover:text-[#913b32] cursor-pointer transition-colors"
                      title="Remove kit"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Mobile Sensor Cards (< md) */}
              {isExpanded && (
                <div className="md:hidden divide-y divide-[#edf0f4] dark:divide-[#334155]">
                  {kitSensors.length > 0 && (
                    <div className="px-4 py-2 bg-[#f8f9fb] dark:bg-[#0f172a] flex items-center justify-between text-[11px] text-[#647184] dark:text-slate-400">
                      <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allKitSelected}
                          onChange={() => toggleSelectKitSensors(kitSensors)}
                          aria-label={`Select all visible sensors in ${kit.kit_code}`}
                          className="w-4 h-4 rounded text-[#2864dc] cursor-pointer"
                        />
                        <span>Select all ({kitSensors.length})</span>
                      </label>
                      <span>Tap a sensor for details</span>
                    </div>
                  )}

                  {kitSensors.length > 0 ? (
                    kitSensors.map((sensor) => {
                      const tempPts = parsePointsJson(sensor.temperature_points_json);
                      const isChecked = selectedCodes.has(sensor.sensor_code);

                      return (
                        <div
                          key={sensor.sensor_code}
                          onClick={() => setDrawerSensor(sensor)}
                          className={`p-3.5 space-y-2.5 cursor-pointer transition-colors ${
                            isChecked ? 'bg-[#edf3ff]/50 dark:bg-blue-950/30' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelectOne(sensor.sensor_code)}
                                  aria-label={`Select ${sensor.channel_identifier}`}
                                  className="w-4 h-4 rounded text-[#2864dc] cursor-pointer"
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-[#2864dc] dark:text-blue-400">
                                  {sensor.channel_identifier}
                                </div>
                                <div className="text-xs font-medium text-[#334052] dark:text-slate-200 truncate">
                                  {sensor.name || 'PT100 Temperature Sensor'}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0">{renderCalDueBadge(sensor.due_date)}</div>
                          </div>

                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                            <div>
                              <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Serial No</span>
                              <span className="font-medium text-[#182330] dark:text-slate-200 tabular-nums">
                                {sensor.serial_number || '—'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Corrections</span>
                              <span className="font-medium text-[#244c94] dark:text-blue-300 tabular-nums">
                                {tempPts.length > 0 ? `${tempPts.length} temp pts` : 'Nominal (0.0°C)'}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Cal Date / Due</span>
                              <span className="font-medium text-[#182330] dark:text-slate-200 tabular-nums">
                                {formatDateDDMMYYYY(sensor.calibration_date)} → {formatDateDDMMYYYY(sensor.due_date)}
                              </span>
                            </div>
                          </div>

                          <div
                            className="flex items-center justify-end gap-2 pt-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setDrawerSensor(sensor)}
                              className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#526071] dark:text-slate-300 bg-[#f8f9fb] dark:bg-[#0f172a] border border-[#e5e9ef] dark:border-[#334155] cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveKitCodeForSensor(kit.kit_code);
                                setSelectedSensor(sensor);
                                setIsSensorModalOpen(true);
                              }}
                              className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#2864dc] dark:text-blue-400 bg-[#edf3ff] dark:bg-blue-950/50 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDeleteSensorCodes([sensor.sensor_code])}
                              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 rounded-lg text-[#bd4d42] bg-[#fff0ed] dark:bg-red-950/40 cursor-pointer"
                              title="Delete sensor"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 px-4 text-center text-xs text-[#788493] dark:text-slate-400">
                      {totalKitSensors.length === 0
                        ? 'No sensors registered for this kit yet.'
                        : 'No sensors match the selected filters.'}
                    </div>
                  )}
                </div>
              )}

              {/* Nested Sortable Sensors Table (PC / Tablet >= md) */}
              {isExpanded && (
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
                      <tr>
                        <th className="py-3 px-3 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={allKitSelected}
                            onChange={() => toggleSelectKitSensors(kitSensors)}
                            aria-label={`Select all visible sensors in ${kit.kit_code}`}
                            className="rounded text-[#2864dc] cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-3">
                          <button
                            type="button"
                            onClick={() => handleSort('channel_identifier')}
                            className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                          >
                            <span>Equipment Code</span>
                            {renderSortIcon('channel_identifier')}
                          </button>
                        </th>
                        {visibleCols.description && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('name')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Description</span>
                              {renderSortIcon('name')}
                            </button>
                          </th>
                        )}
                        {visibleCols.serial_number && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('serial_number')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Serial No</span>
                              {renderSortIcon('serial_number')}
                            </button>
                          </th>
                        )}
                        {visibleCols.traceability && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('traceability')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Traceability</span>
                              {renderSortIcon('traceability')}
                            </button>
                          </th>
                        )}
                        {visibleCols.calibration_date && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('calibration_date')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Cal Date</span>
                              {renderSortIcon('calibration_date')}
                            </button>
                          </th>
                        )}
                        {visibleCols.due_date && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('due_date')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Cal Due</span>
                              {renderSortIcon('due_date')}
                            </button>
                          </th>
                        )}
                        {visibleCols.certificate && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('days_left')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Certificate</span>
                              {renderSortIcon('days_left')}
                            </button>
                          </th>
                        )}
                        {visibleCols.points && (
                          <th className="py-3 px-3">
                            <button
                              type="button"
                              onClick={() => handleSort('points')}
                              className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                            >
                              <span>Correction Points</span>
                              {renderSortIcon('points')}
                            </button>
                          </th>
                        )}
                        <th className="py-3 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                      {kitSensors.length > 0 ? (
                        kitSensors.map((sensor) => {
                          const tempPts = parsePointsJson(sensor.temperature_points_json);
                          const isChecked = selectedCodes.has(sensor.sensor_code);

                          return (
                            <tr
                              key={sensor.sensor_code}
                              onClick={() => setDrawerSensor(sensor)}
                              className={`hover:bg-[#f8faff] dark:hover:bg-[#0f172a]/60 transition-colors cursor-pointer ${
                                isChecked ? 'bg-[#edf3ff]/50 dark:bg-blue-950/30' : ''
                              }`}
                            >
                              <td
                                className="py-3 px-3 text-center"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelectOne(sensor.sensor_code)}
                                  aria-label={`Select ${sensor.channel_identifier}`}
                                  className="rounded text-[#2864dc] cursor-pointer"
                                />
                              </td>
                              <td className="py-3 px-3 font-bold text-[#2864dc] dark:text-blue-400 tracking-tight whitespace-nowrap">
                                <div>{sensor.channel_identifier}</div>
                                {sensor.sensor_code &&
                                  sensor.sensor_code !== sensor.channel_identifier && (
                                    <div className="text-[10px] text-[#788493] dark:text-slate-400 tabular-nums font-normal">
                                      {sensor.sensor_code}
                                    </div>
                                  )}
                              </td>
                              {visibleCols.description && (
                                <td className="py-3 px-3 text-[#334052] dark:text-slate-200 font-medium max-w-[180px] truncate">
                                  {sensor.name || 'PT100 Temperature Sensor'}
                                </td>
                              )}
                              {visibleCols.serial_number && (
                                <td className="py-3 px-3 text-[#788493] dark:text-slate-400 tabular-nums">
                                  {sensor.serial_number || '—'}
                                </td>
                              )}
                              {visibleCols.traceability && (
                                <td className="py-3 px-3 text-[#526071] dark:text-slate-300 font-medium">
                                  {sensor.traceability || 'UME/Turkey'}
                                </td>
                              )}
                              {visibleCols.calibration_date && (
                                <td className="py-3 px-3 text-[#334052] dark:text-slate-300 tabular-nums text-[11px] whitespace-nowrap">
                                  {formatDateDDMMYYYY(sensor.calibration_date)}
                                </td>
                              )}
                              {visibleCols.due_date && (
                                <td className="py-3 px-3 text-[#334052] dark:text-slate-300 tabular-nums text-[11px] whitespace-nowrap">
                                  {formatDateDDMMYYYY(sensor.due_date)}
                                </td>
                              )}
                              {visibleCols.certificate && (
                                <td className="py-3 px-3">{renderCalDueBadge(sensor.due_date)}</td>
                              )}
                              {visibleCols.points && (
                                <td className="py-3 px-3">
                                  {tempPts.length > 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f0f4fb] dark:bg-blue-950/60 text-[#244c94] dark:text-blue-300 tabular-nums">
                                      {tempPts.length} temp pts
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f8f9fb] dark:bg-slate-800 text-[#788493] dark:text-slate-400">
                                      Nominal (0.0°C)
                                    </span>
                                  )}
                                </td>
                              )}
                              <td
                                className="py-3 px-3 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setDrawerSensor(sensor)}
                                    title="View Details"
                                    className="p-1.5 rounded-lg text-[#526071] dark:text-slate-300 hover:bg-[#edf3ff] dark:hover:bg-[#0f172a] hover:text-[#2864dc] cursor-pointer transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveKitCodeForSensor(kit.kit_code);
                                      setSelectedSensor(sensor);
                                      setIsSensorModalOpen(true);
                                    }}
                                    title="Edit Sensor"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-[#2864dc] dark:text-blue-400 hover:bg-[#edf3ff] dark:hover:bg-[#0f172a] cursor-pointer transition-colors"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteSensorCodes([sensor.sensor_code])}
                                    className="p-1.5 rounded-lg text-[#bd4d42] hover:bg-[#fff0ed] dark:hover:bg-red-950/50 hover:text-[#913b32] cursor-pointer transition-colors"
                                    title="Delete sensor"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td
                            colSpan={visibleColCount}
                            className="py-10 text-center text-[#788493] dark:text-slate-400"
                          >
                            {totalKitSensors.length === 0
                              ? 'No sensors registered for this kit yet.'
                              : 'No sensors match the selected filters.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Row Details Slide-over Drawer */}
      {drawerSensor && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs"
          onClick={() => setDrawerSensor(null)}
        >
          <aside
            className="bg-white dark:bg-[#1e293b] w-full max-w-lg h-full overflow-y-auto shadow-2xl border-l border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 pb-safe sm:pb-6 space-y-6 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6">
              {/* Drawer Header */}
              <div className="flex items-start justify-between pb-4 border-b border-[#edf0f4] dark:border-[#334155]">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-[#2864dc] dark:text-blue-400">
                    SuperDAQ Sensor Certificate Profile · {drawerSensor.kit_code}
                  </p>
                  <h2 className="text-xl font-bold text-[#182330] dark:text-slate-100 mt-0.5">
                    {drawerSensor.channel_identifier}
                  </h2>
                  <p className="text-xs text-[#647184] dark:text-slate-400 mt-0.5">
                    {drawerSensor.name || 'PT100 Temperature Sensor'} ·{' '}
                    <span className="tabular-nums">{drawerSensor.sensor_code}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerSensor(null)}
                  className="p-1.5 rounded-lg text-[#788493] hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Certificate Info Grid */}
              <div className="p-4 rounded-xl bg-[#f8f9fb] dark:bg-[#0f172a] border border-[#e5e9ef] dark:border-[#334155] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#182330] dark:text-slate-100">
                    <Award className="w-4 h-4 text-[#2864dc]" />
                    <span>Certificate Details</span>
                  </span>
                  {renderCalDueBadge(drawerSensor.due_date)}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">
                      Serial Number
                    </span>
                    <strong className="text-[#182330] dark:text-slate-100 tabular-nums">
                      {drawerSensor.serial_number || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">
                      Position / Location
                    </span>
                    <strong className="text-[#182330] dark:text-slate-100">
                      {drawerSensor.position || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">
                      Traceability
                    </span>
                    <strong className="text-[#182330] dark:text-slate-100">
                      {drawerSensor.traceability || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">
                      Certificate / Provider
                    </span>
                    <strong className="text-[#182330] dark:text-slate-100">
                      {[drawerSensor.certificate_number, drawerSensor.provider]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#788493] dark:text-slate-400">
                      <Calendar className="w-3 h-3" /> Cal Date
                    </span>
                    <strong className="block text-[#182330] dark:text-slate-100 tabular-nums">
                      {formatDateDDMMYYYY(drawerSensor.calibration_date)}
                    </strong>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#788493] dark:text-slate-400">
                      <Calendar className="w-3 h-3" /> Cal Due
                    </span>
                    <strong className="block text-[#182330] dark:text-slate-100 tabular-nums">
                      {formatDateDDMMYYYY(drawerSensor.due_date)}
                    </strong>
                  </div>
                </div>

                {drawerSensor.notes && (
                  <div className="pt-2 border-t border-[#e5e9ef] dark:border-[#334155] text-xs">
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">Notes</span>
                    <p className="text-[#334052] dark:text-slate-300 mt-0.5">{drawerSensor.notes}</p>
                  </div>
                )}
              </div>

              {/* Temperature Correction Points Table */}
              {(() => {
                const tPts = parsePointsJson(drawerSensor.temperature_points_json);
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-[#182330] dark:text-slate-100">
                        Temperature Correction Points (°C)
                      </h3>
                      <span className="text-[11px] text-[#647184] dark:text-slate-400">
                        {drawerSensor.temperature_convention === 'indication_minus_correction'
                          ? 'Indication − Correction'
                          : 'Indication + Correction'}
                      </span>
                    </div>
                    <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold">
                          <tr>
                            <th className="py-2 px-3 text-right">Indication (°C)</th>
                            <th className="py-2 px-3 text-right">Correction (°C)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                          {tPts.length > 0 ? (
                            tPts.map((pt, i) => (
                              <tr key={i}>
                                <td className="py-2 px-3 text-right tabular-nums font-medium text-[#182330] dark:text-slate-200">
                                  {pt.indication.toFixed(2)}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#2864dc] dark:text-blue-400 font-semibold">
                                  {pt.correction >= 0
                                    ? `+${pt.correction.toFixed(3)}`
                                    : pt.correction.toFixed(3)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={2}
                                className="py-4 text-center text-[#788493] dark:text-slate-400"
                              >
                                No temperature correction points recorded.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Drawer Footer Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
              <button
                type="button"
                onClick={() => {
                  const code = drawerSensor.sensor_code;
                  setDrawerSensor(null);
                  setPendingDeleteSensorCodes([code]);
                }}
                className="px-3.5 py-2 rounded-xl border border-[#fed7d0] dark:border-red-900 text-xs font-semibold text-[#bd4d42] dark:text-red-300 hover:bg-[#fff0ed] dark:hover:bg-red-950/40 cursor-pointer"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = drawerSensor;
                  setDrawerSensor(null);
                  setActiveKitCodeForSensor(s.kit_code);
                  setSelectedSensor(s);
                  setIsSensorModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] cursor-pointer"
              >
                Edit Sensor
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Kit Delete Confirmation Modal */}
      {kitToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1e293b] rounded-xl max-w-md w-full p-6 shadow-2xl border border-[#fed7d0] dark:border-red-900 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#182330] dark:text-slate-100">
                Delete SuperDAQ Kit ({kitToDelete.kit_code})?
              </h3>
              <p className="text-xs text-[#667384] dark:text-slate-400 mt-1 leading-relaxed">
                Are you sure you want to delete{' '}
                <strong className="text-[#182330] dark:text-slate-200">{kitToDelete.name}</strong> and
                all registered PT100 sensors under it?
                <br />
                This will delete the kit, sensors, and calibration curves from both the application and
                Google Sheets.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setKitToDelete(null)}
                className="px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const code = kitToDelete.kit_code;
                  setKitToDelete(null);
                  onDeleteKit(code);
                }}
                className="px-4 py-2 rounded-xl bg-[#bd4d42] text-white text-xs font-semibold hover:bg-[#913b32] cursor-pointer shadow-xs"
              >
                Delete Kit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single / Bulk Sensor Delete Confirmation Modal */}
      {pendingDeleteSensorCodes && pendingDeleteSensorCodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1e293b] rounded-xl max-w-md w-full p-6 shadow-2xl border border-[#fed7d0] dark:border-red-900 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#182330] dark:text-slate-100">
                {pendingDeleteSensorCodes.length === 1
                  ? `Delete SuperDAQ Sensor (${
                      sensors.find((s) => s.sensor_code === pendingDeleteSensorCodes[0])
                        ?.channel_identifier || pendingDeleteSensorCodes[0]
                    })?`
                  : `Delete ${pendingDeleteSensorCodes.length} Selected Sensors?`}
              </h3>
              <p className="text-xs text-[#667384] dark:text-slate-400 mt-1 leading-relaxed">
                {pendingDeleteSensorCodes.length === 1
                  ? 'This will remove the sensor record and its calibration points from the application and Google Sheets. You can undo immediately afterward.'
                  : `You are about to delete ${pendingDeleteSensorCodes.length} SuperDAQ sensors and their calibration curves. An Undo option will appear after deletion.`}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteSensorCodes(null)}
                className="px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targets = [...pendingDeleteSensorCodes];
                  setPendingDeleteSensorCodes(null);
                  setSelectedCodes((prev) => {
                    const next = new Set(prev);
                    targets.forEach((c) => next.delete(c));
                    return next;
                  });
                  onDeleteSensors(targets);
                }}
                className="px-4 py-2 rounded-xl bg-[#bd4d42] text-white text-xs font-semibold hover:bg-[#913b32] cursor-pointer shadow-xs"
              >
                {pendingDeleteSensorCodes.length === 1
                  ? 'Delete Sensor'
                  : `Delete ${pendingDeleteSensorCodes.length} Sensors`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <SensorKitModal
        isOpen={isKitModalOpen}
        onClose={() => setIsKitModalOpen(false)}
        initialKit={selectedKit}
        onSave={onSaveKit}
      />

      <SuperDaqSensorModal
        isOpen={isSensorModalOpen}
        onClose={() => {
          setIsSensorModalOpen(false);
          setActiveKitCodeForSensor(null);
        }}
        kitCode={activeKitCodeForSensor || 'KIT_44070036'}
        initialSensor={selectedSensor}
        onSave={onSaveSensor}
      />
    </div>
  );
};
