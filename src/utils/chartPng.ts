import { formatDateTimeDDMMYYYY } from './dateFormat.ts';

export const CHART_SERIES_COLORS = [
  '#2864dc',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0284c7',
  '#dc2626',
  '#475569',
  '#0d9488',
  '#ea580c',
];

export interface PngChartSeriesInput {
  code: string;
  color: string;
  timestamps: Date[];
  values: number[];
}

export interface PngChartOptions {
  title: string;
  subtitle: string;
  unit: '°C' | '%RH';
  limits: { lower: number; upper: number };
  series: PngChartSeriesInput[];
  viewStartMs?: number;
  viewEndMs?: number;
  width?: number;
  height?: number;
  scale?: number;
}

/**
 * Renders a high-resolution, white-background PNG chart using HTML5 Canvas 2D.
 * Includes title, subtitle, legend, alert limit lines, light-red out-of-limit shading,
 * and global min/max point callout markers. Returns null if executed without a DOM (Node tests).
 */
export async function renderChartToPngBytes(options: PngChartOptions): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') {
    return null;
  }

  const width = options.width ?? 1120;
  const height = options.height ?? 470;
  const scale = options.scale ?? 2;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);

  // Solid white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Subtle outer frame
  ctx.strokeStyle = '#e5e9ef';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  // Header area: Title & Subtitle
  ctx.fillStyle = '#182330';
  ctx.font = `700 16px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText(options.title, 24, 28);

  ctx.fillStyle = '#526071';
  ctx.font = `500 11px ${fontFamily}`;
  ctx.fillText(options.subtitle, 24, 46);

  // Compute time & value bounds
  const allTimes: number[] = [];
  const allVals: number[] = [options.limits.lower, options.limits.upper];

  for (const s of options.series) {
    for (let i = 0; i < s.timestamps.length; i++) {
      const t = s.timestamps[i].getTime();
      const v = s.values[i];
      if (Number.isFinite(t) && Number.isFinite(v)) {
        if (
          (options.viewStartMs === undefined || t >= options.viewStartMs) &&
          (options.viewEndMs === undefined || t <= options.viewEndMs)
        ) {
          allTimes.push(t);
          allVals.push(v);
        }
      }
    }
  }

  if (allTimes.length === 0) {
    // Fallback to full range if window empty
    for (const s of options.series) {
      s.timestamps.forEach((ts) => allTimes.push(ts.getTime()));
      s.values.forEach((v) => {
        if (Number.isFinite(v)) allVals.push(v);
      });
    }
  }

  const minTime = options.viewStartMs ?? (allTimes.length ? Math.min(...allTimes) : Date.now() - 3600000);
  const maxTime = options.viewEndMs ?? (allTimes.length ? Math.max(...allTimes) : Date.now());
  const timeSpan = Math.max(1, maxTime - minTime);

  const minRaw = Math.min(...allVals);
  const maxRaw = Math.max(...allVals);
  const valRange = Math.max(options.unit === '°C' ? 1 : 5, maxRaw - minRaw);
  const yMin = options.unit === '%RH' ? Math.max(0, Math.floor(minRaw - valRange * 0.12)) : Math.floor((minRaw - valRange * 0.12) * 2) / 2;
  const yMax = options.unit === '%RH' ? Math.min(100, Math.ceil(maxRaw + valRange * 0.12)) : Math.ceil((maxRaw + valRange * 0.12) * 2) / 2;

  // Layout legend items cleanly at bottom
  const legendItems = [
    ...options.series.map((s) => ({ label: s.code, color: s.color, dashed: false })),
    {
      label: `Alert Limits (${options.limits.lower} / ${options.limits.upper} ${options.unit})`,
      color: '#dc2626',
      dashed: true,
    },
  ];

  const pad = { top: 68, right: 98, bottom: 82, left: 66 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const getX = (ms: number) => pad.left + ((ms - minTime) / timeSpan) * plotW;
  const getY = (val: number) => pad.top + (1 - (val - yMin) / Math.max(0.1, yMax - yMin)) * plotH;

  // Clip plot area for shading & lines
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();

  // Out-of-limit light red shading
  const upperY = getY(options.limits.upper);
  const lowerY = getY(options.limits.lower);

  ctx.fillStyle = 'rgba(220, 38, 38, 0.08)';
  if (upperY > pad.top) {
    ctx.fillRect(pad.left, pad.top, plotW, Math.min(plotH, upperY - pad.top));
  }
  if (lowerY < pad.top + plotH) {
    const startY = Math.max(pad.top, lowerY);
    ctx.fillRect(pad.left, startY, plotW, pad.top + plotH - startY);
  }
  ctx.restore();

  // Horizontal gridlines & Y ticks
  const ySteps = 6;
  const rawStep = (yMax - yMin) / ySteps;
  const tickStep = options.unit === '%RH' ? Math.max(2, Math.round(rawStep)) : Math.max(0.5, Math.round(rawStep * 2) / 2);

  for (let val = yMin; val <= yMax + 0.001; val += tickStep) {
    const y = getY(val);
    if (y < pad.top - 2 || y > pad.top + plotH + 2) continue;

    ctx.strokeStyle = '#edf0f4';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#334155';
    ctx.font = `500 10px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${val.toFixed(1)}${options.unit === '°C' ? '°C' : '%'}`, pad.left - 8, y + 3.5);
  }

  // Vertical gridlines & X ticks (DD/MM/YYYY HH:mm)
  const xTickCount = 5;
  for (let i = 0; i < xTickCount; i++) {
    const tMs = minTime + (i / (xTickCount - 1)) * timeSpan;
    const x = getX(tMs);

    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();

    ctx.fillStyle = '#334155';
    ctx.font = `500 10px ${fontFamily}`;
    ctx.textAlign = i === 0 ? 'left' : i === xTickCount - 1 ? 'right' : 'center';
    ctx.fillText(formatDateTimeDDMMYYYY(new Date(tMs)), x, pad.top + plotH + 18);
  }

  // Axes baseline
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  // Alert limit lines & right labels
  const drawLimitLine = (val: number, label: string) => {
    const y = getY(val);
    if (y >= pad.top && y <= pad.top + plotH) {
      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#bd4d42';
      ctx.font = `600 10px ${fontFamily}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, pad.left + plotW + 6, y + 3.5);
    }
  };
  drawLimitLine(options.limits.upper, `UTL ${options.limits.upper}${options.unit}`);
  drawLimitLine(options.limits.lower, `LTL ${options.limits.lower}${options.unit}`);

  // Draw data lines inside clipped plot region and track global min/max
  let globalMin: { val: number; ms: number; code: string } | null = null;
  let globalMax: { val: number; ms: number; code: string } | null = null;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();

  for (const s of options.series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < s.timestamps.length; i++) {
      const ms = s.timestamps[i].getTime();
      const val = s.values[i];
      if (!Number.isFinite(val)) continue;
      if (ms < minTime || ms > maxTime) continue;

      const x = getX(ms);
      const y = getY(val);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }

      if (!globalMin || val < globalMin.val) globalMin = { val, ms, code: s.code };
      if (!globalMax || val > globalMax.val) globalMax = { val, ms, code: s.code };
    }
    ctx.stroke();
  }
  ctx.restore();

  // Draw global min/max point markers & labels
  const drawExtremeMarker = (
    pt: { val: number; ms: number; code: string },
    kind: 'Max' | 'Min',
    color: string
  ) => {
    const x = getX(pt.ms);
    const y = getY(pt.val);
    const text = `${kind}: ${pt.val.toFixed(2)}${options.unit} (${pt.code})`;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = `600 10px ${fontFamily}`;
    const textW = ctx.measureText(text).width;
    const boxW = textW + 12;
    const boxH = 20;
    let boxX = x - boxW / 2;
    boxX = Math.max(pad.left + 4, Math.min(pad.left + plotW - boxW - 4, boxX));
    const boxY = kind === 'Max' ? Math.max(pad.top + 4, y - boxH - 8) : Math.min(pad.top + plotH - boxH - 4, y + 8);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, boxX + 6, boxY + 13.5);
  };

  if (globalMax) drawExtremeMarker(globalMax, 'Max', '#dc2626');
  if (globalMin) drawExtremeMarker(globalMin, 'Min', '#2864dc');

  // Render wrapped Legend row at bottom
  let curX = 24;
  let curY = height - 30;
  ctx.font = `600 10.5px ${fontFamily}`;

  for (const item of legendItems) {
    const itemW = 24 + ctx.measureText(item.label).width + 14;
    if (curX + itemW > width - 24) {
      curX = 24;
      curY += 16;
    }

    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 2;
    if (item.dashed) {
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(curX, curY - 3.5);
      ctx.lineTo(curX + 14, curY - 3.5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(curX + 5, curY - 3.5, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = '#334155';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, curX + 18, curY);
    curX += itemW;
  }

  // Export Canvas as PNG Uint8Array
  return new Promise<Uint8Array | null>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(() => resolve(null));
    }, 'image/png');
  });
}

export function downloadPngBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
