import React, { useState, useId, useMemo, useRef } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import { formatDateTimeDDMMYYYY } from '../utils/dateFormat.ts';
import {
  CHART_SERIES_COLORS,
  renderChartToPngBytes,
  downloadPngBytes,
} from '../utils/chartPng.ts';

export interface ThermalChartSeries {
  equipmentCode: string;
  timestamps: Date[];
  values: number[];
}

interface ThermalChartProps {
  title: string;
  studyName: string;
  unit: '°C' | '%RH';
  limits: { lower: number; upper: number };
  series: ThermalChartSeries[];
  accentColor?: string;
}

export const ThermalChart: React.FC<ThermalChartProps> = ({
  title,
  studyName,
  unit,
  limits,
  series,
  accentColor = '#2864dc',
}) => {
  const clipId = useId();
  const [hiddenSensors, setHiddenSensors] = useState<Set<string>>(new Set());
  const [zoomWindow, setZoomWindow] = useState<{ startMs: number; endMs: number } | null>(null);
  const [isExportingPng, setIsExportingPng] = useState(false);

  // Drag-to-pan state
  const isPanningRef = useRef(false);
  const panStartXRef = useRef(0);
  const panStartWindowRef = useRef<{ startMs: number; endMs: number } | null>(null);

  const [hoveredPoint, setHoveredPoint] = useState<{
    sensor: string;
    time: Date;
    val: number;
    x: number;
    y: number;
    color: string;
  } | null>(null);

  const colorByCode = useMemo(() => {
    const map = new Map<string, string>();
    series.forEach((s, idx) => {
      map.set(s.equipmentCode, CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length]);
    });
    return map;
  }, [series]);

  const visibleSeries = useMemo(
    () => series.filter((s) => !hiddenSensors.has(s.equipmentCode)),
    [series, hiddenSensors]
  );

  // Global time bounds across all series
  const { fullMinTime, fullMaxTime } = useMemo(() => {
    let minT = Infinity;
    let maxT = -Infinity;
    for (const s of series) {
      for (const ts of s.timestamps) {
        const ms = ts.getTime();
        if (ms < minT) minT = ms;
        if (ms > maxT) maxT = ms;
      }
    }
    if (!Number.isFinite(minT) || !Number.isFinite(maxT) || maxT <= minT) {
      const now = Date.now();
      return { fullMinTime: now - 3600000, fullMaxTime: now };
    }
    return { fullMinTime: minT, fullMaxTime: maxT };
  }, [series]);

  const minTime = zoomWindow?.startMs ?? fullMinTime;
  const maxTime = zoomWindow?.endMs ?? fullMaxTime;
  const timeSpan = Math.max(1, maxTime - minTime);
  const fullSpan = Math.max(1, fullMaxTime - fullMinTime);
  const zoomFactor = fullSpan / timeSpan;
  const isZoomed = zoomWindow !== null && zoomFactor > 1.02;

  // Value bounds inside visible time window & visible series
  const { yMin, yMax, globalMinPt, globalMaxPt } = useMemo(() => {
    const vals: number[] = [limits.lower, limits.upper];
    let minPt: { code: string; ms: number; val: number } | null = null;
    let maxPt: { code: string; ms: number; val: number } | null = null;

    for (const s of visibleSeries) {
      for (let i = 0; i < s.timestamps.length; i++) {
        const ms = s.timestamps[i].getTime();
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        if (ms < minTime || ms > maxTime) continue;

        vals.push(v);
        if (!minPt || v < minPt.val) minPt = { code: s.equipmentCode, ms, val: v };
        if (!maxPt || v > maxPt.val) maxPt = { code: s.equipmentCode, ms, val: v };
      }
    }

    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const range = Math.max(unit === '°C' ? 1 : 5, rawMax - rawMin);
    const computedYMin =
      unit === '%RH'
        ? Math.max(0, Math.floor(rawMin - range * 0.12))
        : Math.floor((rawMin - range * 0.12) * 2) / 2;
    const computedYMax =
      unit === '%RH'
        ? Math.min(100, Math.ceil(rawMax + range * 0.12))
        : Math.ceil((rawMax + range * 0.12) * 2) / 2;

    return { yMin: computedYMin, yMax: computedYMax, globalMinPt: minPt, globalMaxPt: maxPt };
  }, [visibleSeries, limits, minTime, maxTime, unit]);

  const width = 1040;
  const height = 400;
  const padding = { top: 28, right: 98, bottom: 48, left: 66 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const getX = (ms: number) => padding.left + ((ms - minTime) / timeSpan) * innerWidth;
  const getY = (val: number) =>
    padding.top + (1 - (val - yMin) / Math.max(0.1, yMax - yMin)) * innerHeight;

  // Ticks
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const rawStep = (yMax - yMin) / 6;
    const step =
      unit === '%RH' ? Math.max(2, Math.round(rawStep)) : Math.max(0.5, Math.round(rawStep * 2) / 2);
    for (let v = yMin; v <= yMax + 0.001; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [yMin, yMax, unit]);

  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) {
      ticks.push(minTime + (i / 4) * timeSpan);
    }
    return ticks;
  }, [minTime, timeSpan]);

  const toggleSensor = (code: string) => {
    setHiddenSensors((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // Zoom controls
  const applyZoom = (factor: number, anchorFraction = 0.5) => {
    const newSpan = Math.max(Math.min(fullSpan, 60000), Math.min(fullSpan, timeSpan * factor));
    if (newSpan >= fullSpan * 0.99) {
      setZoomWindow(null);
      return;
    }
    const anchorMs = minTime + anchorFraction * timeSpan;
    let newStart = anchorMs - anchorFraction * newSpan;
    let newEnd = newStart + newSpan;
    if (newStart < fullMinTime) {
      newStart = fullMinTime;
      newEnd = fullMinTime + newSpan;
    }
    if (newEnd > fullMaxTime) {
      newEnd = fullMaxTime;
      newStart = Math.max(fullMinTime, fullMaxTime - newSpan);
    }
    setZoomWindow({ startMs: newStart, endMs: newEnd });
  };

  const panByFraction = (fraction: number) => {
    if (!isZoomed) return;
    const shift = timeSpan * fraction;
    let newStart = minTime + shift;
    let newEnd = maxTime + shift;
    if (newStart < fullMinTime) {
      newStart = fullMinTime;
      newEnd = fullMinTime + timeSpan;
    }
    if (newEnd > fullMaxTime) {
      newEnd = fullMaxTime;
      newStart = fullMaxTime - timeSpan;
    }
    setZoomWindow({ startMs: newStart, endMs: newEnd });
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    // Allow normal page scroll unless user zooms intentionally with wheel over chart
    if (!e.ctrlKey && !e.shiftKey && Math.abs(e.deltaY) < 4) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const frac = Math.max(0, Math.min(1, (svgX - padding.left) / innerWidth));
    applyZoom(e.deltaY < 0 ? 0.78 : 1.28, frac);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isZoomed) return;
    isPanningRef.current = true;
    panStartXRef.current = e.clientX;
    panStartWindowRef.current = { startMs: minTime, endMs: maxTime };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    if (isPanningRef.current && panStartWindowRef.current) {
      const dxPx = e.clientX - panStartXRef.current;
      const dxSvg = (dxPx / svgRect.width) * width;
      const dtMs = -(dxSvg / innerWidth) * timeSpan;
      const startW = panStartWindowRef.current;
      let newStart = startW.startMs + dtMs;
      let newEnd = startW.endMs + dtMs;
      if (newStart < fullMinTime) {
        newStart = fullMinTime;
        newEnd = fullMinTime + timeSpan;
      }
      if (newEnd > fullMaxTime) {
        newEnd = fullMaxTime;
        newStart = fullMaxTime - timeSpan;
      }
      setZoomWindow({ startMs: newStart, endMs: newEnd });
      setHoveredPoint(null);
      return;
    }

    if (visibleSeries.length === 0) return;
    const mouseX = e.clientX - svgRect.left;
    const svgX = (mouseX / svgRect.width) * width;
    if (svgX < padding.left || svgX > width - padding.right) {
      setHoveredPoint(null);
      return;
    }
    const frac = Math.max(0, Math.min(1, (svgX - padding.left) / innerWidth));
    const targetTime = minTime + frac * timeSpan;

    const mouseY = e.clientY - svgRect.top;
    const svgY = (mouseY / svgRect.height) * height;

    let best: {
      sensor: string;
      time: Date;
      val: number;
      x: number;
      y: number;
      color: string;
      dist: number;
    } | null = null;

    for (const s of visibleSeries) {
      let closestIdx = 0;
      let minTDiff = Infinity;
      for (let i = 0; i < s.timestamps.length; i++) {
        const d = Math.abs(s.timestamps[i].getTime() - targetTime);
        if (d < minTDiff) {
          minTDiff = d;
          closestIdx = i;
        }
      }
      const val = s.values[closestIdx];
      const ts = s.timestamps[closestIdx];
      if (typeof val === 'number' && Number.isFinite(val) && ts) {
        const px = getX(ts.getTime());
        const py = getY(val);
        const dist = Math.abs(py - svgY) + Math.abs(px - svgX) * 0.25;
        if (!best || dist < best.dist) {
          best = {
            sensor: s.equipmentCode,
            time: ts,
            val,
            x: px,
            y: py,
            color: colorByCode.get(s.equipmentCode) || accentColor,
            dist,
          };
        }
      }
    }

    if (best) {
      setHoveredPoint({
        sensor: best.sensor,
        time: best.time,
        val: best.val,
        x: best.x,
        y: best.y,
        color: best.color,
      });
    } else {
      setHoveredPoint(null);
    }
  };

  const handleMouseUpOrLeave = () => {
    isPanningRef.current = false;
    panStartWindowRef.current = null;
    setHoveredPoint(null);
  };

  const inspectAtClientPoint = (clientX: number, clientY: number, svgEl: SVGSVGElement) => {
    if (visibleSeries.length === 0) return;
    const svgRect = svgEl.getBoundingClientRect();
    const mouseX = clientX - svgRect.left;
    const svgX = (mouseX / svgRect.width) * width;
    if (svgX < padding.left || svgX > width - padding.right) {
      setHoveredPoint(null);
      return;
    }
    const frac = Math.max(0, Math.min(1, (svgX - padding.left) / innerWidth));
    const targetTime = minTime + frac * timeSpan;
    const mouseY = clientY - svgRect.top;
    const svgY = (mouseY / svgRect.height) * height;

    let best: {
      sensor: string;
      time: Date;
      val: number;
      x: number;
      y: number;
      color: string;
      dist: number;
    } | null = null;

    for (const s of visibleSeries) {
      let closestIdx = 0;
      let minTDiff = Infinity;
      for (let i = 0; i < s.timestamps.length; i++) {
        const d = Math.abs(s.timestamps[i].getTime() - targetTime);
        if (d < minTDiff) {
          minTDiff = d;
          closestIdx = i;
        }
      }
      const val = s.values[closestIdx];
      const ts = s.timestamps[closestIdx];
      if (typeof val === 'number' && Number.isFinite(val) && ts) {
        const px = getX(ts.getTime());
        const py = getY(val);
        const dist = Math.abs(py - svgY) + Math.abs(px - svgX) * 0.25;
        if (!best || dist < best.dist) {
          best = {
            sensor: s.equipmentCode,
            time: ts,
            val,
            x: px,
            y: py,
            color: colorByCode.get(s.equipmentCode) || accentColor,
            dist,
          };
        }
      }
    }

    if (best) {
      setHoveredPoint({
        sensor: best.sensor,
        time: best.time,
        val: best.val,
        x: best.x,
        y: best.y,
        color: best.color,
      });
    } else {
      setHoveredPoint(null);
    }
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    inspectAtClientPoint(touch.clientX, touch.clientY, e.currentTarget);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    inspectAtClientPoint(touch.clientX, touch.clientY, e.currentTarget);
  };

  const handleExportPng = async () => {
    if (isExportingPng) return;
    setIsExportingPng(true);
    try {
      const periodStr = `${formatDateTimeDDMMYYYY(new Date(minTime))} – ${formatDateTimeDDMMYYYY(new Date(maxTime))}`;
      const bytes = await renderChartToPngBytes({
        title: `${studyName} — ${title}`,
        subtitle: `Period: ${periodStr}  |  Limits: ${limits.lower}${unit} to ${limits.upper}${unit}`,
        unit,
        limits,
        series: visibleSeries.map((s) => ({
          code: s.equipmentCode,
          color: colorByCode.get(s.equipmentCode) || accentColor,
          timestamps: s.timestamps,
          values: s.values,
        })),
        viewStartMs: minTime,
        viewEndMs: maxTime,
        scale: 2,
      });
      if (bytes) {
        const safeName = (studyName || 'Thermal_Mapping').replace(/[^a-zA-Z0-9_-]/g, '_');
        const suffix = unit === '°C' ? 'temperature' : 'humidity';
        downloadPngBytes(bytes, `${safeName}_${suffix}_chart.png`);
      }
    } finally {
      setIsExportingPng(false);
    }
  };

  // Out-of-limit shaded Y rectangles clamped to plot bounds
  const upperLimitY = getY(limits.upper);
  const lowerLimitY = getY(limits.lower);
  const upperShadeHeight = Math.max(0, Math.min(innerHeight, upperLimitY - padding.top));
  const lowerShadeStart = Math.max(padding.top, Math.min(padding.top + innerHeight, lowerLimitY));
  const lowerShadeHeight = Math.max(0, padding.top + innerHeight - lowerShadeStart);

  return (
    <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] shadow-xs p-3.5 sm:p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
          <div>
            <h2 className="text-sm font-bold text-[#182330] dark:text-slate-100">{title}</h2>
            <p className="text-[11px] text-[#647184] dark:text-slate-400 tabular-nums">
              {formatDateTimeDDMMYYYY(new Date(minTime))} – {formatDateTimeDDMMYYYY(new Date(maxTime))}
              {isZoomed && <span className="ml-2 font-semibold text-[#2864dc]">({zoomFactor.toFixed(1)}x zoom · drag to pan)</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Zoom / Pan Controls */}
          <div className="inline-flex items-center rounded-lg border border-[#dce4ef] dark:border-[#334155] bg-[#f8f9fb] dark:bg-[#0f172a] p-0.5">
            <button
              type="button"
              onClick={() => applyZoom(0.7)}
              title="Zoom In"
              className="p-2 sm:p-1.5 rounded-md text-[#334155] dark:text-slate-300 hover:bg-white dark:hover:bg-[#1e293b] cursor-pointer transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyZoom(1.4)}
              disabled={!isZoomed}
              title="Zoom Out"
              className="p-2 sm:p-1.5 rounded-md text-[#334155] dark:text-slate-300 hover:bg-white dark:hover:bg-[#1e293b] disabled:opacity-40 cursor-pointer transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => panByFraction(-0.25)}
              disabled={!isZoomed}
              title="Pan Left"
              className="p-2 sm:p-1.5 rounded-md text-[#334155] dark:text-slate-300 hover:bg-white dark:hover:bg-[#1e293b] disabled:opacity-40 cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => panByFraction(0.25)}
              disabled={!isZoomed}
              title="Pan Right"
              className="p-2 sm:p-1.5 rounded-md text-[#334155] dark:text-slate-300 hover:bg-white dark:hover:bg-[#1e293b] disabled:opacity-40 cursor-pointer transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {isZoomed && (
              <button
                type="button"
                onClick={() => setZoomWindow(null)}
                title="Reset Zoom"
                className="inline-flex items-center gap-1 px-2 py-1.5 sm:py-1 rounded-md text-[11px] font-semibold text-[#2864dc] hover:bg-white dark:hover:bg-[#1e293b] cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleExportPng}
            disabled={isExportingPng || visibleSeries.length === 0}
            className="min-h-[38px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs font-semibold text-[#2864dc] dark:text-blue-400 hover:bg-[#f5f8ff] dark:hover:bg-[#1e293b] transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExportingPng ? 'Rendering PNG...' : 'Export Chart PNG'}</span>
          </button>
        </div>
      </div>

      {/* Per-Sensor Interactive Legend Toggles */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#edf0f4] dark:border-[#334155] text-xs">
        {series.map((s) => {
          const color = colorByCode.get(s.equipmentCode) || accentColor;
          const isHidden = hiddenSensors.has(s.equipmentCode);
          return (
            <button
              key={s.equipmentCode}
              type="button"
              onClick={() => toggleSensor(s.equipmentCode)}
              title={isHidden ? `Show ${s.equipmentCode}` : `Hide ${s.equipmentCode}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-lg border text-[11px] font-medium transition-all cursor-pointer ${
                isHidden
                  ? 'border-transparent bg-[#f5f7fa] dark:bg-[#0f172a] text-[#94a3b8] opacity-50 line-through'
                  : 'border-[#e5e9ef] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-[#182330] dark:text-slate-200 hover:border-[#cbd5e1]'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span>{s.equipmentCode}</span>
            </button>
          );
        })}

        {hiddenSensors.size > 0 && (
          <button
            type="button"
            onClick={() => setHiddenSensors(new Set())}
            className="px-2 py-1 text-[11px] font-semibold text-[#2864dc] hover:underline cursor-pointer"
          >
            Show All ({series.length})
          </button>
        )}

        <div className="flex items-center gap-1.5 w-full sm:w-auto sm:ml-auto pt-1 sm:pt-0 text-[11px] text-[#bd4d42] font-semibold tabular-nums">
          <span className="w-4 h-0.5 border-t-2 border-dashed border-[#dc2626]" />
          <span>
            Alert Limits ({limits.lower} / {limits.upper} {unit})
          </span>
        </div>
      </div>

      {/* Mobile horizontal scroll hint */}
      <p className="md:hidden text-[10px] text-[#788493] dark:text-slate-400">
        Swipe horizontally to view full timeline · Tap chart to inspect readings
      </p>

      {/* SVG Plot Area */}
      <div className="relative w-full overflow-x-auto bg-[#fafbfd] dark:bg-[#0f172a] rounded-xl border border-[#edf0f4] dark:border-[#334155] p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={`w-full h-auto min-w-[620px] md:min-w-[740px] select-none ${isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} />
            </clipPath>
          </defs>

          {/* Out-of-limit light red shaded bands */}
          <g clipPath={`url(#${clipId})`}>
            {upperShadeHeight > 0 && (
              <rect
                x={padding.left}
                y={padding.top}
                width={innerWidth}
                height={upperShadeHeight}
                fill="rgba(220, 38, 38, 0.08)"
              />
            )}
            {lowerShadeHeight > 0 && (
              <rect
                x={padding.left}
                y={lowerShadeStart}
                width={innerWidth}
                height={lowerShadeHeight}
                fill="rgba(220, 38, 38, 0.08)"
              />
            )}
          </g>

          {/* Horizontal Gridlines & Y Labels */}
          {yTicks.map((tick) => {
            const yPos = getY(tick);
            if (yPos < padding.top - 2 || yPos > height - padding.bottom + 2) return null;
            return (
              <g key={tick}>
                <line
                  x1={padding.left}
                  y1={yPos}
                  x2={width - padding.right}
                  y2={yPos}
                  stroke="#e2e8f0"
                  strokeOpacity="0.65"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <line
                  x1={padding.left - 4}
                  y1={yPos}
                  x2={padding.left}
                  y2={yPos}
                  stroke="#64748b"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={yPos + 3.5}
                  className="fill-[#334155] dark:fill-slate-300 tabular-nums"
                  fontSize="10.5"
                  textAnchor="end"
                  fontWeight="500"
                >
                  {tick.toFixed(1)}{unit === '°C' ? '°C' : '%'}
                </text>
              </g>
            );
          })}

          {/* Vertical Gridlines & X Labels (DD/MM/YYYY HH:mm) */}
          {xTicks.map((tickTime, idx) => {
            const dateObj = new Date(tickTime);
            const xPos = getX(tickTime);
            return (
              <g key={idx}>
                <line
                  x1={xPos}
                  y1={padding.top}
                  x2={xPos}
                  y2={height - padding.bottom}
                  stroke="#e2e8f0"
                  strokeOpacity="0.5"
                  strokeWidth="1"
                />
                <line
                  x1={xPos}
                  y1={height - padding.bottom}
                  x2={xPos}
                  y2={height - padding.bottom + 4}
                  stroke="#64748b"
                  strokeWidth="1"
                />
                <text
                  x={xPos}
                  y={height - padding.bottom + 18}
                  className="fill-[#334155] dark:fill-slate-300 tabular-nums"
                  fontSize="10.5"
                  textAnchor={idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'}
                  fontWeight="500"
                >
                  {formatDateTimeDDMMYYYY(dateObj)}
                </text>
              </g>
            );
          })}

          {/* Axis Baseline Lines */}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={height - padding.bottom}
            stroke="#cbd5e1"
            strokeWidth="1.2"
          />
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke="#cbd5e1"
            strokeWidth="1.2"
          />

          {/* Alert Limit Dashed Lines */}
          {upperLimitY >= padding.top && upperLimitY <= height - padding.bottom && (
            <g>
              <line
                x1={padding.left}
                y1={upperLimitY}
                x2={width - padding.right}
                y2={upperLimitY}
                stroke="#dc2626"
                strokeWidth="1.3"
                strokeDasharray="5 4"
              />
              <text
                x={width - padding.right + 6}
                y={upperLimitY + 3.5}
                fill="#dc2626"
                fontSize="10"
                fontWeight="600"
                className="tabular-nums"
              >
                UTL {limits.upper}{unit}
              </text>
            </g>
          )}

          {lowerLimitY >= padding.top && lowerLimitY <= height - padding.bottom && (
            <g>
              <line
                x1={padding.left}
                y1={lowerLimitY}
                x2={width - padding.right}
                y2={lowerLimitY}
                stroke="#dc2626"
                strokeWidth="1.3"
                strokeDasharray="5 4"
              />
              <text
                x={width - padding.right + 6}
                y={lowerLimitY + 3.5}
                fill="#dc2626"
                fontSize="10"
                fontWeight="600"
                className="tabular-nums"
              >
                LTL {limits.lower}{unit}
              </text>
            </g>
          )}

          {/* Continuous Crisp Data Lines clipped cleanly */}
          <g clipPath={`url(#${clipId})`}>
            {visibleSeries.map((s) => {
              const color = colorByCode.get(s.equipmentCode) || accentColor;
              const points = s.timestamps
                .map((t, i) => {
                  const val = s.values[i];
                  if (!Number.isFinite(val)) return null;
                  return `${getX(t.getTime()).toFixed(1)},${getY(val).toFixed(1)}`;
                })
                .filter(Boolean)
                .join(' ');

              return (
                <polyline
                  key={s.equipmentCode}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
              );
            })}
          </g>

          {/* Global Max & Global Min Point Markers + Labels */}
          {globalMaxPt && (() => {
            const gx = getX(globalMaxPt.ms);
            const gy = getY(globalMaxPt.val);
            const label = `Max: ${globalMaxPt.val.toFixed(2)}${unit} (${globalMaxPt.code})`;
            const boxW = Math.max(120, label.length * 6.2 + 12);
            const boxX = Math.max(padding.left + 4, Math.min(width - padding.right - boxW - 4, gx - boxW / 2));
            const boxY = Math.max(padding.top + 3, gy - 26);
            return (
              <g pointerEvents="none">
                <circle cx={gx} cy={gy} r="4.5" fill="#dc2626" stroke="#ffffff" strokeWidth="1.5" />
                <rect x={boxX} y={boxY} width={boxW} height="19" rx="4" fill="#ffffff" stroke="#dc2626" strokeWidth="1" />
                <text
                  x={boxX + boxW / 2}
                  y={boxY + 13}
                  fill="#dc2626"
                  fontSize="10"
                  fontWeight="600"
                  textAnchor="middle"
                  className="tabular-nums"
                >
                  {label}
                </text>
              </g>
            );
          })()}

          {globalMinPt && (() => {
            const gx = getX(globalMinPt.ms);
            const gy = getY(globalMinPt.val);
            const label = `Min: ${globalMinPt.val.toFixed(2)}${unit} (${globalMinPt.code})`;
            const boxW = Math.max(120, label.length * 6.2 + 12);
            const boxX = Math.max(padding.left + 4, Math.min(width - padding.right - boxW - 4, gx - boxW / 2));
            const boxY = Math.min(height - padding.bottom - 22, gy + 8);
            return (
              <g pointerEvents="none">
                <circle cx={gx} cy={gy} r="4.5" fill="#2864dc" stroke="#ffffff" strokeWidth="1.5" />
                <rect x={boxX} y={boxY} width={boxW} height="19" rx="4" fill="#ffffff" stroke="#2864dc" strokeWidth="1" />
                <text
                  x={boxX + boxW / 2}
                  y={boxY + 13}
                  fill="#2864dc"
                  fontSize="10"
                  fontWeight="600"
                  textAnchor="middle"
                  className="tabular-nums"
                >
                  {label}
                </text>
              </g>
            );
          })()}

          {/* Interactive Crosshair & Hover Callout */}
          {hoveredPoint && (
            <g pointerEvents="none">
              <line
                x1={hoveredPoint.x}
                y1={padding.top}
                x2={hoveredPoint.x}
                y2={height - padding.bottom}
                stroke="#94a3b8"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="4"
                fill={hoveredPoint.color}
                stroke="#ffffff"
                strokeWidth="1.5"
              />
              {(() => {
                const text = `${hoveredPoint.sensor}: ${hoveredPoint.val.toFixed(2)}${unit} · ${formatDateTimeDDMMYYYY(hoveredPoint.time)}`;
                const boxW = Math.max(185, text.length * 6 + 16);
                const tx = Math.max(
                  padding.left + boxW / 2 + 4,
                  Math.min(width - padding.right - boxW / 2 - 4, hoveredPoint.x)
                );
                const ty = Math.max(padding.top + 32, hoveredPoint.y - 12);
                return (
                  <g transform={`translate(${tx}, ${ty})`}>
                    <rect
                      x={-boxW / 2}
                      y="-26"
                      width={boxW}
                      height="24"
                      rx="6"
                      fill="#182330"
                      opacity="0.95"
                    />
                    <text
                      x="0"
                      y="-10.5"
                      fill="#ffffff"
                      fontSize="10"
                      textAnchor="middle"
                      fontWeight="600"
                      className="tabular-nums"
                    >
                      {text}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
      </div>
    </section>
  );
};
