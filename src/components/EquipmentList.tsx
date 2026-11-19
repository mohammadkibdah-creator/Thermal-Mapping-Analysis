import React, { useState, useMemo } from 'react';
import {
  EquipmentRecord,
  getEquipmentStatus,
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
} from 'lucide-react';
import { EquipmentModal } from './EquipmentModal.tsx';
import { exportDataLoggersRegistryWorkbook } from '../utils/excelExport.ts';
import { formatDateDDMMYYYY, getCalibrationDueInfo } from '../utils/dateFormat.ts';

interface EquipmentListProps {
  equipment: EquipmentRecord[];
  onSaveEquipment: (record: EquipmentRecord) => void;
  onDeleteEquipment: (codes: string[]) => void;
  onImportEquipment?: (records: EquipmentRecord[]) => void;
}

type SortKey =
  | 'equipment_code'
  | 'description'
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

export const EquipmentList: React.FC<EquipmentListProps> = ({
  equipment,
  onSaveEquipment,
  onDeleteEquipment,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'incomplete'>('all');
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentRecord | null>(null);
  const [drawerEquipment, setDrawerEquipment] = useState<EquipmentRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sorting state
  const [sortKey, setSortKey] = useState<SortKey>('equipment_code');
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
  const [pendingDeleteCodes, setPendingDeleteCodes] = useState<string[] | null>(null);

  const [isExporting, setIsExporting] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filteredAndSortedEquipment = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = equipment.filter((eq) => {
      const matchesSearch =
        eq.equipment_code.toLowerCase().includes(q) ||
        eq.description.toLowerCase().includes(q) ||
        eq.serial_number.toLowerCase().includes(q) ||
        eq.manufacturer.toLowerCase().includes(q) ||
        eq.traceability.toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (filter === 'expired') return Boolean(eq.due_date && isRecordExpired(eq.due_date));
      if (filter === 'incomplete') return getEquipmentStatus(eq) === 'Incomplete';
      return true;
    });

    const mult = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'equipment_code':
          return a.equipment_code.localeCompare(b.equipment_code, undefined, { numeric: true }) * mult;
        case 'description':
          return (a.description || '').localeCompare(b.description || '') * mult;
        case 'serial_number':
          return (a.serial_number || '').localeCompare(b.serial_number || '', undefined, { numeric: true }) * mult;
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
          const pa =
            parsePointsJson(a.temperature_points_json).length +
            parsePointsJson(a.humidity_points_json).length;
          const pb =
            parsePointsJson(b.temperature_points_json).length +
            parsePointsJson(b.humidity_points_json).length;
          return (pa - pb) * mult;
        }
        default:
          return 0;
      }
    });
  }, [equipment, search, filter, sortKey, sortDir]);

  const allVisibleSelected =
    filteredAndSortedEquipment.length > 0 &&
    filteredAndSortedEquipment.every((eq) => selectedCodes.has(eq.equipment_code));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      const next = new Set(selectedCodes);
      filteredAndSortedEquipment.forEach((eq) => next.delete(eq.equipment_code));
      setSelectedCodes(next);
    } else {
      const next = new Set(selectedCodes);
      filteredAndSortedEquipment.forEach((eq) => next.add(eq.equipment_code));
      setSelectedCodes(next);
    }
  };

  const toggleSelectOne = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleExportRegistry = async () => {
    setIsExporting(true);
    try {
      const bytes = await exportDataLoggersRegistryWorkbook(filteredAndSortedEquipment);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Data_Loggers_Registry.xlsx`;
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

  const visibleColCount =
    2 + Object.values(visibleCols).filter(Boolean).length + 1; // checkbox + code + dynamic + actions

  return (
    <div className="space-y-5">
      {/* Header & Actions */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-bold text-[#5275ad] dark:text-blue-400 mb-1">
            Equipment registry
          </p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#182330] dark:text-slate-100 tracking-tight">
            Data Loggers
          </h1>
          <p className="text-xs text-[#647184] dark:text-slate-400 mt-0.5">
            Maintain calibrated temperature and humidity instruments and certification snapshots.
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
              setSelectedEquipment(null);
              setIsModalOpen(true);
            }}
            className="flex-1 sm:flex-initial min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] transition-colors shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2864dc]/40"
          >
            <Plus className="w-4 h-4" />
            <span>Add Data Logger</span>
          </button>
        </div>
      </section>

      {/* Filter, Search & Column Toggle Bar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[#788493] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, serial, description..."
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
            All Loggers ({equipment.length})
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
            <span>{selectedCodes.size} data logger(s) selected</span>
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
              onClick={() => setPendingDeleteCodes(Array.from(selectedCodes))}
              className="flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#bd4d42] text-white text-xs font-semibold hover:bg-[#913b32] cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Selected ({selectedCodes.size})</span>
            </button>
          </div>
        </section>
      )}

      {/* Mobile Cards View (< md) */}
      <section className="md:hidden space-y-2.5">
        {filteredAndSortedEquipment.length > 0 && (
          <div className="flex items-center justify-between px-1 text-[11px] text-[#647184] dark:text-slate-400">
            <label className="inline-flex items-center gap-2 font-semibold cursor-pointer py-1">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="Select all visible data loggers"
                className="w-4 h-4 rounded text-[#2864dc] cursor-pointer"
              />
              <span>Select all ({filteredAndSortedEquipment.length})</span>
            </label>
            <span>Tap a card for details</span>
          </div>
        )}

        {filteredAndSortedEquipment.length > 0 ? (
          filteredAndSortedEquipment.map((eq) => {
            const tempPts = parsePointsJson(eq.temperature_points_json);
            const humPts = parsePointsJson(eq.humidity_points_json);
            const isChecked = selectedCodes.has(eq.equipment_code);

            return (
              <article
                key={eq.equipment_code}
                onClick={() => setDrawerEquipment(eq)}
                className={`p-3.5 rounded-xl bg-white dark:bg-[#1e293b] border transition-colors cursor-pointer shadow-xs space-y-2.5 ${
                  isChecked
                    ? 'border-[#2864dc] bg-[#f8faff] dark:bg-blue-950/30'
                    : 'border-[#e5e9ef] dark:border-[#334155]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className="pt-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectOne(eq.equipment_code)}
                        aria-label={`Select ${eq.equipment_code}`}
                        className="w-4 h-4 rounded text-[#2864dc] cursor-pointer"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#2864dc] dark:text-blue-400 tracking-tight">
                        {eq.equipment_code}
                      </div>
                      <p className="text-xs font-medium text-[#334052] dark:text-slate-200 truncate">
                        {eq.description || 'Not entered'}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">{renderCalDueBadge(eq.due_date)}</div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] pt-2 border-t border-[#edf0f4] dark:border-[#334155]">
                  <div>
                    <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Serial No</span>
                    <span className="font-medium text-[#182330] dark:text-slate-200 tabular-nums">
                      {eq.serial_number || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Traceability</span>
                    <span className="font-medium text-[#182330] dark:text-slate-200 truncate block">
                      {eq.traceability || 'UME/Turkey'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Cal Date / Due</span>
                    <span className="font-medium text-[#182330] dark:text-slate-200 tabular-nums">
                      {formatDateDDMMYYYY(eq.calibration_date)} → {formatDateDDMMYYYY(eq.due_date)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#788493] dark:text-slate-400 block text-[10px]">Corrections</span>
                    <span className="font-medium text-[#244c94] dark:text-blue-300 tabular-nums">
                      {tempPts.length > 0 || humPts.length > 0
                        ? `${tempPts.length} temp${humPts.length > 0 ? `, ${humPts.length} RH` : ''} pts`
                        : 'Nominal (0.0°C)'}
                    </span>
                  </div>
                </div>

                <div
                  className="flex items-center justify-end gap-2 pt-2 border-t border-[#edf0f4] dark:border-[#334155]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setDrawerEquipment(eq)}
                    className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#526071] dark:text-slate-300 bg-[#f8f9fb] dark:bg-[#0f172a] border border-[#e5e9ef] dark:border-[#334155] cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Details</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEquipment(eq);
                      setIsModalOpen(true);
                    }}
                    className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#2864dc] dark:text-blue-400 bg-[#edf3ff] dark:bg-blue-950/50 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteCodes([eq.equipment_code])}
                    className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 rounded-lg text-[#bd4d42] bg-[#fff0ed] dark:bg-red-950/40 cursor-pointer"
                    title="Delete equipment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] py-10 px-4 text-center text-xs text-[#788493] dark:text-slate-400">
            No Data Loggers match the selected filters.
          </div>
        )}
      </section>

      {/* Equipment Table (PC / Tablet >= md) */}
      <section className="hidden md:block bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
              <tr>
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible data loggers"
                    className="rounded text-[#2864dc] cursor-pointer"
                  />
                </th>
                <th className="py-3 px-3">
                  <button
                    type="button"
                    onClick={() => handleSort('equipment_code')}
                    className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                  >
                    <span>Equipment Code</span>
                    {renderSortIcon('equipment_code')}
                  </button>
                </th>
                {visibleCols.description && (
                  <th className="py-3 px-3">
                    <button
                      type="button"
                      onClick={() => handleSort('description')}
                      className="inline-flex items-center gap-1 uppercase font-bold cursor-pointer hover:text-[#2864dc]"
                    >
                      <span>Description</span>
                      {renderSortIcon('description')}
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
              {filteredAndSortedEquipment.length > 0 ? (
                filteredAndSortedEquipment.map((eq) => {
                  const tempPts = parsePointsJson(eq.temperature_points_json);
                  const humPts = parsePointsJson(eq.humidity_points_json);
                  const isChecked = selectedCodes.has(eq.equipment_code);

                  return (
                    <tr
                      key={eq.equipment_code}
                      onClick={() => setDrawerEquipment(eq)}
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
                          onChange={() => toggleSelectOne(eq.equipment_code)}
                          aria-label={`Select ${eq.equipment_code}`}
                          className="rounded text-[#2864dc] cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-3 font-bold text-[#2864dc] dark:text-blue-400 tracking-tight whitespace-nowrap">
                        {eq.equipment_code}
                      </td>
                      {visibleCols.description && (
                        <td className="py-3 px-3 text-[#334052] dark:text-slate-200 font-medium max-w-[200px] truncate">
                          {eq.description || 'Not entered'}
                        </td>
                      )}
                      {visibleCols.serial_number && (
                        <td className="py-3 px-3 text-[#647184] dark:text-slate-400 tabular-nums">
                          {eq.serial_number || '—'}
                        </td>
                      )}
                      {visibleCols.traceability && (
                        <td className="py-3 px-3 text-[#526071] dark:text-slate-300 font-medium">
                          {eq.traceability || 'UME/Turkey'}
                        </td>
                      )}
                      {visibleCols.calibration_date && (
                        <td className="py-3 px-3 text-[#334052] dark:text-slate-300 tabular-nums text-[11px] whitespace-nowrap">
                          {formatDateDDMMYYYY(eq.calibration_date)}
                        </td>
                      )}
                      {visibleCols.due_date && (
                        <td className="py-3 px-3 text-[#334052] dark:text-slate-300 tabular-nums text-[11px] whitespace-nowrap">
                          {formatDateDDMMYYYY(eq.due_date)}
                        </td>
                      )}
                      {visibleCols.certificate && (
                        <td className="py-3 px-3">{renderCalDueBadge(eq.due_date)}</td>
                      )}
                      {visibleCols.points && (
                        <td className="py-3 px-3">
                          {tempPts.length > 0 || humPts.length > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f0f4fb] dark:bg-blue-950/60 text-[#244c94] dark:text-blue-300 tabular-nums">
                              {tempPts.length} temp{humPts.length > 0 ? `, ${humPts.length} RH` : ''} pts
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
                            onClick={() => setDrawerEquipment(eq)}
                            title="View Details"
                            className="p-1.5 rounded-lg text-[#526071] dark:text-slate-300 hover:bg-[#edf3ff] dark:hover:bg-[#0f172a] hover:text-[#2864dc] cursor-pointer transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEquipment(eq);
                              setIsModalOpen(true);
                            }}
                            title="Edit Record"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-[#2864dc] dark:text-blue-400 hover:bg-[#edf3ff] dark:hover:bg-[#0f172a] cursor-pointer transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteCodes([eq.equipment_code])}
                            className="p-1.5 rounded-lg text-[#bd4d42] hover:bg-[#fff0ed] dark:hover:bg-red-950/50 hover:text-[#913b32] cursor-pointer transition-colors"
                            title="Delete equipment"
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
                  <td colSpan={visibleColCount} className="py-12 text-center text-[#788493] dark:text-slate-400">
                    No Data Loggers match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row Details Slide-over Drawer */}
      {drawerEquipment && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs"
          onClick={() => setDrawerEquipment(null)}
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
                    Certificate & Calibration Profile
                  </p>
                  <h2 className="text-xl font-bold text-[#182330] dark:text-slate-100 mt-0.5">
                    {drawerEquipment.equipment_code}
                  </h2>
                  <p className="text-xs text-[#647184] dark:text-slate-400 mt-0.5">
                    {drawerEquipment.description || 'Temperature & Humidity Data Logger'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerEquipment(null)}
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
                  {renderCalDueBadge(drawerEquipment.due_date)}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">Serial Number</span>
                    <strong className="text-[#182330] dark:text-slate-100 tabular-nums">
                      {drawerEquipment.serial_number || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">Manufacturer</span>
                    <strong className="text-[#182330] dark:text-slate-100">
                      {drawerEquipment.manufacturer || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">Traceability</span>
                    <strong className="text-[#182330] dark:text-slate-100">
                      {drawerEquipment.traceability || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">Channels</span>
                    <strong className="text-[#182330] dark:text-slate-100">
                      {[
                        drawerEquipment.temperature_enabled ? 'Temp' : null,
                        drawerEquipment.humidity_enabled ? 'RH' : null,
                      ]
                        .filter(Boolean)
                        .join(' & ') || 'None'}
                    </strong>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#788493] dark:text-slate-400">
                      <Calendar className="w-3 h-3" /> Cal Date
                    </span>
                    <strong className="block text-[#182330] dark:text-slate-100 tabular-nums">
                      {formatDateDDMMYYYY(drawerEquipment.calibration_date)}
                    </strong>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#788493] dark:text-slate-400">
                      <Calendar className="w-3 h-3" /> Cal Due
                    </span>
                    <strong className="block text-[#182330] dark:text-slate-100 tabular-nums">
                      {formatDateDDMMYYYY(drawerEquipment.due_date)}
                    </strong>
                  </div>
                </div>

                {drawerEquipment.notes && (
                  <div className="pt-2 border-t border-[#e5e9ef] dark:border-[#334155] text-xs">
                    <span className="text-[11px] text-[#788493] dark:text-slate-400 block">Notes</span>
                    <p className="text-[#334052] dark:text-slate-300 mt-0.5">{drawerEquipment.notes}</p>
                  </div>
                )}
              </div>

              {/* Temperature Correction Points Table */}
              {(() => {
                const tPts = parsePointsJson(drawerEquipment.temperature_points_json);
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-[#182330] dark:text-slate-100">
                        Temperature Correction Points (°C)
                      </h3>
                      <span className="text-[11px] text-[#647184] dark:text-slate-400">
                        {drawerEquipment.temperature_convention === 'indication_minus_correction'
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
                                  {pt.correction >= 0 ? `+${pt.correction.toFixed(3)}` : pt.correction.toFixed(3)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className="py-4 text-center text-[#788493] dark:text-slate-400">
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

              {/* Relative Humidity Correction Points Table */}
              {(() => {
                const hPts = parsePointsJson(drawerEquipment.humidity_points_json);
                if (!drawerEquipment.humidity_enabled && hPts.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-[#182330] dark:text-slate-100">
                        Relative Humidity Correction Points (%RH)
                      </h3>
                      <span className="text-[11px] text-[#647184] dark:text-slate-400">
                        {drawerEquipment.humidity_convention === 'indication_minus_correction'
                          ? 'Indication − Correction'
                          : 'Indication + Correction'}
                      </span>
                    </div>
                    <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold">
                          <tr>
                            <th className="py-2 px-3 text-right">Indication (%RH)</th>
                            <th className="py-2 px-3 text-right">Correction (%RH)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                          {hPts.length > 0 ? (
                            hPts.map((pt, i) => (
                              <tr key={i}>
                                <td className="py-2 px-3 text-right tabular-nums font-medium text-[#182330] dark:text-slate-200">
                                  {pt.indication.toFixed(2)}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#059669] dark:text-emerald-400 font-semibold">
                                  {pt.correction >= 0 ? `+${pt.correction.toFixed(3)}` : pt.correction.toFixed(3)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className="py-4 text-center text-[#788493] dark:text-slate-400">
                                No humidity correction points recorded.
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
            <div className="flex items-center justify-between gap-3 pt-4 border-t border-[#edf0f4] dark:border-[#334155]">
              <button
                type="button"
                onClick={() => {
                  const code = drawerEquipment.equipment_code;
                  setDrawerEquipment(null);
                  setPendingDeleteCodes([code]);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#fed7d0] dark:border-red-900 bg-[#fff0ed] dark:bg-red-950/40 text-xs font-semibold text-[#bd4d42] dark:text-red-300 hover:bg-[#ffe3de] cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const rec = drawerEquipment;
                  setDrawerEquipment(null);
                  setSelectedEquipment(rec);
                  setIsModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Instrument</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Delete Confirmation Modal (Single & Bulk) */}
      {pendingDeleteCodes && pendingDeleteCodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#1e293b] rounded-xl max-w-md w-full p-6 shadow-2xl border border-[#fed7d0] dark:border-red-900 space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] dark:text-red-400 flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#182330] dark:text-slate-100">
                {pendingDeleteCodes.length === 1
                  ? `Delete Equipment ${pendingDeleteCodes[0]}?`
                  : `Delete ${pendingDeleteCodes.length} Selected Data Loggers?`}
              </h3>
              <p className="text-xs text-[#667384] dark:text-slate-300 mt-1 leading-relaxed">
                {pendingDeleteCodes.length === 1 ? (
                  <>
                    Are you sure you want to delete <strong className="text-[#182330] dark:text-white">{pendingDeleteCodes[0]}</strong> and its calibration correction curves?
                  </>
                ) : (
                  <>
                    You are about to delete <strong className="text-[#182330] dark:text-white">{pendingDeleteCodes.length}</strong> data loggers ({pendingDeleteCodes.slice(0, 5).join(', ')}
                    {pendingDeleteCodes.length > 5 ? ` +${pendingDeleteCodes.length - 5} more` : ''}).
                  </>
                )}
                <br />
                You can undo immediately from the notification bar after deletion.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteCodes(null)}
                className="px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const codes = pendingDeleteCodes;
                  setPendingDeleteCodes(null);
                  setSelectedCodes((prev) => {
                    const next = new Set(prev);
                    codes.forEach((c) => next.delete(c));
                    return next;
                  });
                  onDeleteEquipment(codes);
                }}
                className="px-4 py-2 rounded-xl bg-[#bd4d42] text-white text-xs font-semibold hover:bg-[#913b32] cursor-pointer shadow-xs"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Equipment View / Edit Modal */}
      <EquipmentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialEquipment={selectedEquipment}
        onSave={onSaveEquipment}
        onDelete={(code) => {
          setIsModalOpen(false);
          setPendingDeleteCodes([code]);
        }}
      />
    </div>
  );
};
