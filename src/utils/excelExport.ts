import ExcelJS from 'exceljs';
import { StudyAnalysisOutput, getSensorDisplayLabel } from './importers.ts';
import { EquipmentRecord, parsePointsJson } from '../store/metrologyStore.ts';
import {
  formatDateTimeDDMMYYYY,
  formatDateDDMMYYYY,
  formatDateMMYYYY,
  getCalibrationDueInfo,
} from './dateFormat.ts';
import { CHART_SERIES_COLORS, renderChartToPngBytes } from './chartPng.ts';

function sanitizeExcelSheetName(raw: string, usedNames: Set<string>): string {
  let cleaned = raw.replace(/[\[\]:*?/\\]/g, '_').trim() || 'Sheet';
  cleaned = cleaned.substring(0, 31);
  let candidate = cleaned;
  let suffix = 1;
  while (usedNames.has(candidate.toLowerCase())) {
    const sfx = `_${suffix}`;
    candidate = `${cleaned.substring(0, 31 - sfx.length)}${sfx}`;
    suffix++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E3A8A' },
};

const SUBHEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEDF3FF' },
};

const ZEBRA_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};

const HOT_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF1F2' },
};

const COLD_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEFF6FF' },
};

const WARN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFBEB' },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};

function styleHeaderRow(row: ExcelJS.Row, colCount: number): void {
  row.height = 24;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'center', wrapText: true };
    cell.border = THIN_BORDER;
  }
}

function styleDataCell(cell: ExcelJS.Cell, align: 'left' | 'center' | 'right' = 'right', numFmt?: string): void {
  cell.font = { name: 'Inter', size: 10, color: { argb: 'FF1E293B' } };
  cell.alignment = { vertical: 'middle', horizontal: align };
  cell.border = THIN_BORDER;
  if (numFmt) cell.numFmt = numFmt;
}

/**
 * Converts a local Date to an ExcelJS Date value shifted so Excel renders the exact local wall-clock time
 * (ExcelJS writes Dates as UTC serial numbers).
 */
function toExcelWallClockDate(d: Date): Date {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

/**
 * Generates the comprehensive JNMI Thermal Mapping .xlsx workbook using ExcelJS.
 * Includes:
 * - Summary sheet (metadata, Temperature results table, all-sensors PNG chart, warnings)
 * - Humidity Summary sheet (when RH is active, with all-sensors RH PNG chart)
 * - Per-sensor Temperature sheets (stats + individual chart PNG + full raw/corrected data with frozen headers)
 * - Per-sensor Humidity sheets (when RH is active, same structure)
 * - Equipment Information & Calibration Snapshot traceability sheets
 */
export async function exportStudyReportWorkbook(output: StudyAnalysisOutput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thermal Mapping Analysis - JNMI / RSS';
  wb.created = new Date();

  const usedSheetNames = new Set<string>();
  const durationHours = (output.end.getTime() - output.start.getTime()) / (3600 * 1000);
  const periodStr = `${formatDateTimeDDMMYYYY(output.start)} – ${formatDateTimeDDMMYYYY(output.end)}`;

  const hasHumidity =
    output.mode === 'temperature_and_humidity' &&
    Boolean(output.humidityLimits) &&
    output.loggerResults.some((r) => r.humidity !== null);

  const labelFor = (code: string | null | undefined) =>
    getSensorDisplayLabel(code, output.assignedSnapshots, output.acquisitionSystem);

  // Pre-render all chart PNGs in parallel when running in browser DOM
  const tempAllChartPromise = renderChartToPngBytes({
    title: `${output.studyName} — Temperature Distribution (All Sensors)`,
    subtitle: `Period: ${periodStr}  |  Limits: ${output.temperatureLimits.lower}°C to ${output.temperatureLimits.upper}°C`,
    unit: '°C',
    limits: output.temperatureLimits,
    series: output.series.map((s, idx) => ({
      code: labelFor(s.equipmentCode),
      color: CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length],
      timestamps: s.timestamps,
      values: s.correctedTemperatures,
    })),
  });

  const humAllChartPromise =
    hasHumidity && output.humidityLimits
      ? renderChartToPngBytes({
          title: `${output.studyName} — Relative Humidity Distribution (All Sensors)`,
          subtitle: `Period: ${periodStr}  |  Limits: ${output.humidityLimits.lower}%RH to ${output.humidityLimits.upper}%RH`,
          unit: '%RH',
          limits: output.humidityLimits,
          series: output.series
            .filter((s) => s.correctedHumidities && s.correctedHumidities.length > 0)
            .map((s, idx) => ({
              code: labelFor(s.equipmentCode),
              color: CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length],
              timestamps: s.timestamps,
              values: s.correctedHumidities,
            })),
        })
      : Promise.resolve(null);

  const perSensorTempChartPromises = output.series.map((s, idx) =>
    renderChartToPngBytes({
      title: `${labelFor(s.equipmentCode)} — Corrected Temperature Profile`,
      subtitle: `${output.studyName}  |  Period: ${periodStr}`,
      unit: '°C',
      limits: output.temperatureLimits,
      series: [
        {
          code: labelFor(s.equipmentCode),
          color: CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length],
          timestamps: s.timestamps,
          values: s.correctedTemperatures,
        },
      ],
    })
  );

  const perSensorHumChartPromises = output.series.map((s, idx) =>
    hasHumidity && output.humidityLimits && s.correctedHumidities.length > 0
      ? renderChartToPngBytes({
          title: `${labelFor(s.equipmentCode)} — Corrected Relative Humidity Profile`,
          subtitle: `${output.studyName}  |  Period: ${periodStr}`,
          unit: '%RH',
          limits: output.humidityLimits,
          series: [
            {
              code: labelFor(s.equipmentCode),
              color: CHART_SERIES_COLORS[idx % CHART_SERIES_COLORS.length],
              timestamps: s.timestamps,
              values: s.correctedHumidities,
            },
          ],
        })
      : Promise.resolve(null)
  );

  const [tempAllChartPng, humAllChartPng, perSensorTempPngs, perSensorHumPngs] = await Promise.all([
    tempAllChartPromise,
    humAllChartPromise,
    Promise.all(perSensorTempChartPromises),
    Promise.all(perSensorHumChartPromises),
  ]);

  // -----------------------------------------------------------------------
  // 1. SUMMARY SHEET
  // -----------------------------------------------------------------------
  const wsSummary = wb.addWorksheet(sanitizeExcelSheetName('Summary', usedSheetNames));
  wsSummary.columns = [
    { width: 22 }, // A: Sensor / Field
    { width: 14 }, // B: Spot Role
    { width: 12 }, // C: MKT
    { width: 12 }, // D: Mean
    { width: 12 }, // E: Min
    { width: 12 }, // F: Max
    { width: 12 }, // G: Std Dev
    { width: 18 }, // H: Safe Range
    { width: 15 }, // I: Time in Range %
    { width: 16 }, // J: Out-of-Range min
    { width: 14 }, // K: Below min
    { width: 12 }, // L: % Below
    { width: 14 }, // M: Above min
    { width: 12 }, // N: % Above
  ];

  // Title banner
  wsSummary.mergeCells('A1:N1');
  const titleCell = wsSummary.getCell('A1');
  titleCell.value = `THERMAL MAPPING STUDY SUMMARY — ${output.studyName.toUpperCase()}`;
  titleCell.fill = HEADER_FILL;
  titleCell.font = { name: 'Inter', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsSummary.getRow(1).height = 28;

  // Study Metadata Key-Value grid (rows 3 to 9)
  const metaPairs: [string, string | number, string, string | number][] = [
    ['Study Name', output.studyName, 'Study Period', periodStr],
    ['Acquisition System', output.acquisitionSystem, 'Sensor Kit', output.sensorKit || 'Not applicable'],
    ['Sampling Interval', `${output.samplingIntervalMinutes} min`, 'Total Duration', `${durationHours.toFixed(2)} hours`],
    [
      'Temperature Limits',
      `${output.temperatureLimits.lower} °C to ${output.temperatureLimits.upper} °C`,
      'RH Limits',
      output.humidityLimits ? `${output.humidityLimits.lower} %RH to ${output.humidityLimits.upper} %RH` : 'N/A',
    ],
    [
      'Overall Temp Mean',
      `${output.globalTemperatureMean.toFixed(2)} °C`,
      'Sensors Analyzed',
      `${output.loggerResults.length}`,
    ],
    [
      'Hot Spot Sensor',
      labelFor(output.hotSpotCode),
      'Cold Spot Sensor',
      labelFor(output.coldSpotCode),
    ],
    [
      'Report Generated',
      formatDateTimeDDMMYYYY(new Date()),
      'Software Version',
      '1.0.0 (JNMI / RSS)',
    ],
  ];

  metaPairs.forEach((pair, idx) => {
    const r = idx + 3;
    const row = wsSummary.getRow(r);
    row.height = 20;

    wsSummary.getCell(r, 1).value = pair[0];
    wsSummary.getCell(r, 1).fill = SUBHEADER_FILL;
    wsSummary.getCell(r, 1).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
    wsSummary.getCell(r, 1).border = THIN_BORDER;

    wsSummary.mergeCells(r, 2, r, 6);
    wsSummary.getCell(r, 2).value = pair[1];
    wsSummary.getCell(r, 2).font = { name: 'Inter', size: 10, color: { argb: 'FF1E293B' } };
    for (let c = 2; c <= 6; c++) wsSummary.getCell(r, c).border = THIN_BORDER;

    wsSummary.mergeCells(r, 7, r, 8);
    wsSummary.getCell(r, 7).value = pair[2];
    wsSummary.getCell(r, 7).fill = SUBHEADER_FILL;
    wsSummary.getCell(r, 7).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
    wsSummary.getCell(r, 7).border = THIN_BORDER;
    wsSummary.getCell(r, 8).border = THIN_BORDER;

    wsSummary.mergeCells(r, 9, r, 14);
    wsSummary.getCell(r, 9).value = pair[3];
    wsSummary.getCell(r, 9).font = { name: 'Inter', size: 10, color: { argb: 'FF1E293B' } };
    for (let c = 9; c <= 14; c++) wsSummary.getCell(r, c).border = THIN_BORDER;
  });

  // Temperature Results Table Header (Row 11)
  const tempTableHeaderRowIdx = 11;
  const tempHeaders = [
    'Sensor',
    'Spot Role',
    'MKT (°C)',
    'Mean (°C)',
    'Min (°C)',
    'Max (°C)',
    'Std Dev',
    'Safe Range',
    'Time in Range (%)',
    'Out-of-Range (min)',
    'Below Alert (min)',
    '% Below',
    'Above Alert (min)',
    '% Above',
  ];
  const headerRow = wsSummary.getRow(tempTableHeaderRowIdx);
  tempHeaders.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(headerRow, tempHeaders.length);

  // Freeze through the Temperature Results Table header row
  wsSummary.views = [{ state: 'frozen', ySplit: tempTableHeaderRowIdx }];

  output.loggerResults.forEach((lr, idx) => {
    const r = tempTableHeaderRowIdx + 1 + idx;
    const row = wsSummary.getRow(r);
    row.height = 20;

    const isHot = output.loggerResults.length > 1 && lr.equipmentCode === output.hotSpotCode;
    const isCold = output.loggerResults.length > 1 && lr.equipmentCode === output.coldSpotCode;
    const spotLabel = isHot && isCold ? 'Hot / Cold' : isHot ? 'Hot Spot' : isCold ? 'Cold Spot' : 'Normal';

    const t = lr.temperature;
    const vals = [
      labelFor(lr.equipmentCode),
      spotLabel,
      Number(t.mkt.toFixed(2)),
      Number(t.mean.toFixed(2)),
      Number(t.minimum.toFixed(2)),
      Number(t.maximum.toFixed(2)),
      Number(t.sample_standard_deviation.toFixed(3)),
      `${output.temperatureLimits.lower.toFixed(1)} to ${output.temperatureLimits.upper.toFixed(1)} °C`,
      Math.round(t.in_range_percent),
      Number(t.out_of_range_minutes.toFixed(1)),
      Number(t.below_minutes.toFixed(1)),
      Math.round(t.below_percent),
      Number(t.above_minutes.toFixed(1)),
      Math.round(t.above_percent),
    ];

    vals.forEach((val, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = val;
      if (colIdx === 0) styleDataCell(cell, 'left');
      else if (colIdx === 1 || colIdx === 7) styleDataCell(cell, 'center');
      else if (colIdx === 6) styleDataCell(cell, 'right', '0.000');
      else if (colIdx === 8 || colIdx === 11 || colIdx === 13) styleDataCell(cell, 'right', '0');
      else if (colIdx === 9 || colIdx === 10 || colIdx === 12) styleDataCell(cell, 'right', '0.0');
      else styleDataCell(cell, 'right', '0.00');

      if (isHot) cell.fill = HOT_FILL;
      else if (isCold) cell.fill = COLD_FILL;
      else if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  });

  let nextSummaryRow = tempTableHeaderRowIdx + 1 + output.loggerResults.length;

  // Overall Summary Footer Row in Temperature table
  const totRow = wsSummary.getRow(nextSummaryRow);
  totRow.height = 22;
  const globalMinT = Math.min(...output.loggerResults.map((l) => l.temperature.minimum));
  const globalMaxT = Math.max(...output.loggerResults.map((l) => l.temperature.maximum));
  const totVals: (string | number)[] = [
    `Overall (${output.loggerResults.length} Sensors)`,
    `Hot: ${labelFor(output.hotSpotCode)} / Cold: ${labelFor(output.coldSpotCode)}`,
    '',
    Number(output.globalTemperatureMean.toFixed(2)),
    Number(globalMinT.toFixed(2)),
    Number(globalMaxT.toFixed(2)),
    '',
    `${output.temperatureLimits.lower.toFixed(1)} to ${output.temperatureLimits.upper.toFixed(1)} °C`,
    '',
    '',
    '',
    '',
    '',
    '',
  ];
  totVals.forEach((v, colIdx) => {
    const cell = totRow.getCell(colIdx + 1);
    cell.value = v;
    cell.fill = SUBHEADER_FILL;
    cell.font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: colIdx === 0 ? 'left' : colIdx === 1 || colIdx === 7 ? 'center' : 'right' };
    if (typeof v === 'number') cell.numFmt = '0.00';
  });

  nextSummaryRow += 2;

  // Embed All-Sensors Temperature Chart PNG inside Summary Sheet
  if (tempAllChartPng) {
    const imgId = wb.addImage({
      buffer: tempAllChartPng as unknown as ExcelJS.Buffer,
      extension: 'png',
    });
    wsSummary.addImage(imgId, {
      tl: { col: 0, row: nextSummaryRow - 1 },
      ext: { width: 960, height: 403 },
    });
    nextSummaryRow += 22;
  }

  // Analysis Warnings section in Summary Sheet
  wsSummary.mergeCells(nextSummaryRow, 1, nextSummaryRow, 14);
  const warnHeader = wsSummary.getCell(nextSummaryRow, 1);
  warnHeader.value = `Analysis Warnings & Validation Notes (${output.warnings.length})`;
  warnHeader.fill = WARN_FILL;
  warnHeader.font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF92400E' } };
  for (let c = 1; c <= 14; c++) wsSummary.getCell(nextSummaryRow, c).border = THIN_BORDER;
  wsSummary.getRow(nextSummaryRow).height = 22;
  nextSummaryRow++;

  const allWarnings = [...output.warnings];
  if (output.expiredCertificateConfirmed) {
    allWarnings.unshift('Expired certificate use was explicitly confirmed by the operator before execution.');
  }
  if (allWarnings.length === 0) {
    allWarnings.push('No timestamp rounding, extrapolation, or validation warnings detected.');
  }

  for (const w of allWarnings) {
    wsSummary.mergeCells(nextSummaryRow, 1, nextSummaryRow, 14);
    const cell = wsSummary.getCell(nextSummaryRow, 1);
    cell.value = `• ${w}`;
    cell.font = { name: 'Inter', size: 10, color: { argb: 'FF334155' } };
    for (let c = 1; c <= 14; c++) wsSummary.getCell(nextSummaryRow, c).border = THIN_BORDER;
    wsSummary.getRow(nextSummaryRow).height = 19;
    nextSummaryRow++;
  }

  // -----------------------------------------------------------------------
  // 2. HUMIDITY SUMMARY SHEET (when RH is used)
  // -----------------------------------------------------------------------
  if (hasHumidity && output.humidityLimits) {
    const humResults = output.loggerResults.filter((lr) => lr.humidity !== null);
    const wsHum = wb.addWorksheet(sanitizeExcelSheetName('Humidity Summary', usedSheetNames));
    wsHum.columns = [
      { width: 22 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 12 },
      { width: 12 }, { width: 18 }, { width: 15 }, { width: 16 }, { width: 14 },
      { width: 12 }, { width: 14 }, { width: 12 },
    ];

    wsHum.mergeCells('A1:M1');
    const hTitle = wsHum.getCell('A1');
    hTitle.value = `RELATIVE HUMIDITY SUMMARY — ${output.studyName.toUpperCase()}`;
    hTitle.fill = HEADER_FILL;
    hTitle.font = { name: 'Inter', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    hTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsHum.getRow(1).height = 28;

    const humMeta: [string, string, string, string][] = [
      ['Study Period', periodStr, 'RH Limits', `${output.humidityLimits.lower} %RH to ${output.humidityLimits.upper} %RH`],
      [
        'Overall Mean RH',
        output.globalHumidityMean !== null ? `${output.globalHumidityMean.toFixed(2)} %RH` : '—',
        'Sensors Analyzed',
        `${humResults.length}`,
      ],
      ['Highest RH Sensor', labelFor(output.humHighSpotCode), 'Lowest RH Sensor', labelFor(output.humLowSpotCode)],
    ];

    humMeta.forEach((pair, idx) => {
      const r = idx + 3;
      wsHum.getRow(r).height = 20;
      wsHum.getCell(r, 1).value = pair[0];
      wsHum.getCell(r, 1).fill = SUBHEADER_FILL;
      wsHum.getCell(r, 1).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
      wsHum.getCell(r, 1).border = THIN_BORDER;

      wsHum.mergeCells(r, 2, r, 6);
      wsHum.getCell(r, 2).value = pair[1];
      for (let c = 2; c <= 6; c++) wsHum.getCell(r, c).border = THIN_BORDER;

      wsHum.mergeCells(r, 7, r, 8);
      wsHum.getCell(r, 7).value = pair[2];
      wsHum.getCell(r, 7).fill = SUBHEADER_FILL;
      wsHum.getCell(r, 7).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
      wsHum.getCell(r, 7).border = THIN_BORDER;
      wsHum.getCell(r, 8).border = THIN_BORDER;

      wsHum.mergeCells(r, 9, r, 13);
      wsHum.getCell(r, 9).value = pair[3];
      for (let c = 9; c <= 13; c++) wsHum.getCell(r, c).border = THIN_BORDER;
    });

    const humHeaderRowIdx = 7;
    const humHeaders = [
      'Sensor',
      'Spot Role',
      'Mean (%RH)',
      'Min (%RH)',
      'Max (%RH)',
      'Std Dev',
      'Safe Range',
      'Time in Range (%)',
      'Out-of-Range (min)',
      'Below Alert (min)',
      '% Below',
      'Above Alert (min)',
      '% Above',
    ];
    const hRow = wsHum.getRow(humHeaderRowIdx);
    humHeaders.forEach((h, i) => {
      hRow.getCell(i + 1).value = h;
    });
    styleHeaderRow(hRow, humHeaders.length);
    wsHum.views = [{ state: 'frozen', ySplit: humHeaderRowIdx }];

    humResults.forEach((lr, idx) => {
      const r = humHeaderRowIdx + 1 + idx;
      const row = wsHum.getRow(r);
      row.height = 20;
      const h = lr.humidity!;
      const isHigh = humResults.length > 1 && lr.equipmentCode === output.humHighSpotCode;
      const isLow = humResults.length > 1 && lr.equipmentCode === output.humLowSpotCode;
      const role = isHigh ? 'Highest RH' : isLow ? 'Lowest RH' : 'Normal';

      const vals = [
        labelFor(lr.equipmentCode),
        role,
        Number(h.mean.toFixed(2)),
        Number(h.minimum.toFixed(2)),
        Number(h.maximum.toFixed(2)),
        Number(h.sample_standard_deviation.toFixed(3)),
        `${output.humidityLimits!.lower.toFixed(1)} to ${output.humidityLimits!.upper.toFixed(1)} %RH`,
        Math.round(h.in_range_percent),
        Number(h.out_of_range_minutes.toFixed(1)),
        Number(h.below_minutes.toFixed(1)),
        Math.round(h.below_percent),
        Number(h.above_minutes.toFixed(1)),
        Math.round(h.above_percent),
      ];

      vals.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        if (colIdx === 0) styleDataCell(cell, 'left');
        else if (colIdx === 1 || colIdx === 6) styleDataCell(cell, 'center');
        else if (colIdx === 5) styleDataCell(cell, 'right', '0.000');
        else if (colIdx === 7 || colIdx === 10 || colIdx === 12) styleDataCell(cell, 'right', '0');
        else if (colIdx === 8 || colIdx === 9 || colIdx === 11) styleDataCell(cell, 'right', '0.0');
        else styleDataCell(cell, 'right', '0.00');

        if (isHigh) cell.fill = HOT_FILL;
        else if (isLow) cell.fill = COLD_FILL;
        else if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
      });
    });

    let nextHumRow = humHeaderRowIdx + humResults.length + 2;
    if (humAllChartPng) {
      const imgId = wb.addImage({
        buffer: humAllChartPng as unknown as ExcelJS.Buffer,
        extension: 'png',
      });
      wsHum.addImage(imgId, {
        tl: { col: 0, row: nextHumRow - 1 },
        ext: { width: 960, height: 403 },
      });
    }
  }

  // -----------------------------------------------------------------------
  // 3. INDIVIDUAL SENSOR SHEETS (TEMPERATURE)
  // -----------------------------------------------------------------------
  output.series.forEach((s, idx) => {
    const lr = output.loggerResults.find((l) => l.equipmentCode === s.equipmentCode)!;
    const snap = output.assignedSnapshots.find((a) => a.equipmentCode === s.equipmentCode);
    const t = lr.temperature;
    const hasSeconds = s.timestamps.some((ts) => ts.getSeconds() !== 0);
    const timeFmt = hasSeconds ? 'hh:mm:ss' : 'hh:mm';
    const dateTimeFmt = hasSeconds ? 'dd/mm/yyyy hh:mm:ss' : 'dd/mm/yyyy hh:mm';

    const displayLabel = labelFor(s.equipmentCode);
    const wsSensor = wb.addWorksheet(sanitizeExcelSheetName(displayLabel, usedSheetNames));
    wsSensor.columns = [
      { width: 8 },  // A: No.
      { width: 14 }, // B: Date
      { width: 12 }, // C: Time
      { width: 22 }, // D: Date & Time
      { width: 18 }, // E: Raw Value
      { width: 16 }, // F: Correction
      { width: 22 }, // G: Corrected Value
      { width: 12 }, // H: LTL
      { width: 12 }, // I: UTL
      { width: 16 }, // J: Status
      { width: 4 },  // K: Spacer before chart
    ];

    wsSensor.mergeCells('A1:J1');
    const sTitle = wsSensor.getCell('A1');
    const channelSuffix = snap?.sourceChannel ? ` (${snap.sourceChannel})` : '';
    sTitle.value = `SENSOR REPORT: ${displayLabel}${channelSuffix} — TEMPERATURE`;
    sTitle.fill = HEADER_FILL;
    sTitle.font = { name: 'Inter', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    sTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    wsSensor.getRow(1).height = 26;

    // Sensor Statistics & Study Period Block (Rows 3-6 across A..J)
    const statRows: {
      c1Label: string; c1Val: number | string;
      c2Label: string; c2Val: number | string;
      c3Label: string; c3Val: number | string;
      c4Label: string; c4Val: number | string;
    }[] = [
      {
        c1Label: 'MKT (°C)', c1Val: Number(t.mkt.toFixed(2)),
        c2Label: 'Mean (°C)', c2Val: Number(t.mean.toFixed(2)),
        c3Label: 'Std Dev (°C)', c3Val: Number(t.sample_standard_deviation.toFixed(3)),
        c4Label: 'Study Period', c4Val: periodStr,
      },
      {
        c1Label: 'Min (°C)', c1Val: Number(t.minimum.toFixed(2)),
        c2Label: 'Max (°C)', c2Val: Number(t.maximum.toFixed(2)),
        c3Label: 'Time in Range (%)', c3Val: `${Math.round(t.in_range_percent)}%`,
        c4Label: 'Readings in Period', c4Val: s.timestamps.length,
      },
      {
        c1Label: 'Out-of-Range (min)', c1Val: Number(t.out_of_range_minutes.toFixed(1)),
        c2Label: 'Below Alert (min)', c2Val: Number(t.below_minutes.toFixed(1)),
        c3Label: 'Above Alert (min)', c3Val: Number(t.above_minutes.toFixed(1)),
        c4Label: 'Temp Limits', c4Val: `${output.temperatureLimits.lower} to ${output.temperatureLimits.upper} °C`,
      },
      {
        c1Label: 'Serial No', c1Val: snap?.serialNumber || '—',
        c2Label: 'Traceability', c2Val: snap?.traceability || '—',
        c3Label: 'Cal / Due', c3Val: `${formatDateMMYYYY(snap?.calibrationDate)} / ${formatDateMMYYYY(snap?.dueDate)}`,
        c4Label: 'Instrument', c4Val: snap?.sensorName || snap?.description || displayLabel,
      },
    ];

    statRows.forEach((sr, rIdx) => {
      const r = 3 + rIdx;
      wsSensor.getRow(r).height = 19;
      const pairs: [number, number, number, string, number | string][] = [
        [1, 2, 2, sr.c1Label, sr.c1Val],
        [3, 4, 4, sr.c2Label, sr.c2Val],
        [5, 6, 6, sr.c3Label, sr.c3Val],
        [7, 8, 10, sr.c4Label, sr.c4Val],
      ];
      pairs.forEach(([lCol, vStart, vEnd, label, val]) => {
        const lbl = wsSensor.getCell(r, lCol);
        lbl.value = label;
        lbl.fill = SUBHEADER_FILL;
        lbl.font = { name: 'Inter', size: 9.5, bold: true, color: { argb: 'FF1E3A8A' } };
        lbl.alignment = { vertical: 'middle', horizontal: 'left' };
        lbl.border = THIN_BORDER;

        if (vEnd > vStart) {
          wsSensor.mergeCells(r, vStart, r, vEnd);
        }
        const valCell = wsSensor.getCell(r, vStart);
        valCell.value = val;
        styleDataCell(valCell, typeof val === 'number' ? 'right' : 'center');
        for (let c = vStart; c <= vEnd; c++) {
          wsSensor.getCell(r, c).border = THIN_BORDER;
        }
      });
    });

    // Place the sensor chart PNG cleanly beside the readings table (Column L, Row 3)
    // so all logged readings are immediately visible starting at Row 8 without obstruction.
    const sensorPng = perSensorTempPngs[idx];
    if (sensorPng) {
      const imgId = wb.addImage({
        buffer: sensorPng as unknown as ExcelJS.Buffer,
        extension: 'png',
      });
      wsSensor.addImage(imgId, {
        tl: { col: 11, row: 2 },
        ext: { width: 760, height: 320 },
      });
    }

    const dataHeaderRowIdx = 8;
    const dHeaders = [
      'No.',
      'Date (DD/MM/YYYY)',
      hasSeconds ? 'Time (HH:mm:ss)' : 'Time (HH:mm)',
      hasSeconds ? 'Date & Time (DD/MM/YYYY HH:mm:ss)' : 'Date & Time (DD/MM/YYYY HH:mm)',
      'Raw Temperature (°C)',
      'Correction (°C)',
      'Corrected Temperature (°C)',
      'LTL (°C)',
      'UTL (°C)',
      'Limit Status',
    ];
    const dHeaderRow = wsSensor.getRow(dataHeaderRowIdx);
    dHeaders.forEach((h, i) => {
      dHeaderRow.getCell(i + 1).value = h;
    });
    styleHeaderRow(dHeaderRow, dHeaders.length);
    wsSensor.views = [{ state: 'frozen', ySplit: dataHeaderRowIdx }];

    for (let i = 0; i < s.timestamps.length; i++) {
      const row = wsSensor.getRow(dataHeaderRowIdx + 1 + i);
      row.height = 19;
      const wallDate = toExcelWallClockDate(s.timestamps[i]);
      const val = s.correctedTemperatures[i];
      const status =
        val < output.temperatureLimits.lower
          ? 'Below LTL'
          : val > output.temperatureLimits.upper
          ? 'Above UTL'
          : 'In Range';

      row.getCell(1).value = i + 1;
      styleDataCell(row.getCell(1), 'center');

      row.getCell(2).value = wallDate;
      styleDataCell(row.getCell(2), 'center', 'dd/mm/yyyy');

      row.getCell(3).value = wallDate;
      styleDataCell(row.getCell(3), 'center', timeFmt);

      row.getCell(4).value = wallDate;
      styleDataCell(row.getCell(4), 'center', dateTimeFmt);

      row.getCell(5).value = s.originalTemperatures[i];
      styleDataCell(row.getCell(5), 'right', '0.00');

      row.getCell(6).value = s.temperatureCorrections[i];
      styleDataCell(row.getCell(6), 'right', '0.000');

      row.getCell(7).value = val;
      styleDataCell(row.getCell(7), 'right', '0.00');

      row.getCell(8).value = output.temperatureLimits.lower;
      styleDataCell(row.getCell(8), 'right', '0.0');

      row.getCell(9).value = output.temperatureLimits.upper;
      styleDataCell(row.getCell(9), 'right', '0.0');

      row.getCell(10).value = status;
      styleDataCell(row.getCell(10), 'center');

      if (status !== 'In Range') {
        row.getCell(7).fill = HOT_FILL;
        row.getCell(10).fill = HOT_FILL;
      } else if (i % 2 === 1) {
        for (let c = 1; c <= 10; c++) row.getCell(c).fill = ZEBRA_FILL;
      }
    }
  });

  // -----------------------------------------------------------------------
  // 4. INDIVIDUAL SENSOR HUMIDITY SHEETS (WHEN RH USED)
  // -----------------------------------------------------------------------
  if (hasHumidity && output.humidityLimits) {
    output.series.forEach((s, idx) => {
      const lr = output.loggerResults.find((l) => l.equipmentCode === s.equipmentCode);
      if (!lr?.humidity || !s.correctedHumidities || s.correctedHumidities.length === 0) return;

      const h = lr.humidity;
      const snap = output.assignedSnapshots.find((a) => a.equipmentCode === s.equipmentCode);
      const hasSeconds = s.timestamps.some((ts) => ts.getSeconds() !== 0);
      const timeFmt = hasSeconds ? 'hh:mm:ss' : 'hh:mm';
      const dateTimeFmt = hasSeconds ? 'dd/mm/yyyy hh:mm:ss' : 'dd/mm/yyyy hh:mm';

      const displayLabel = labelFor(s.equipmentCode);
      const wsHumSensor = wb.addWorksheet(sanitizeExcelSheetName(`${displayLabel} RH`, usedSheetNames));
      wsHumSensor.columns = [
        { width: 8 },  // A: No.
        { width: 14 }, // B: Date
        { width: 12 }, // C: Time
        { width: 22 }, // D: Date & Time
        { width: 18 }, // E: Raw RH
        { width: 16 }, // F: Correction
        { width: 22 }, // G: Corrected RH
        { width: 12 }, // H: LRL
        { width: 12 }, // I: URL
        { width: 16 }, // J: Status
        { width: 4 },  // K: Spacer before chart
      ];

      wsHumSensor.mergeCells('A1:J1');
      const hTitle = wsHumSensor.getCell('A1');
      const channelSuffix = snap?.sourceChannel ? ` (${snap.sourceChannel})` : '';
      hTitle.value = `SENSOR REPORT: ${displayLabel}${channelSuffix} — RELATIVE HUMIDITY (%RH)`;
      hTitle.fill = HEADER_FILL;
      hTitle.font = { name: 'Inter', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
      hTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      wsHumSensor.getRow(1).height = 26;

      const statRows: {
        c1Label: string; c1Val: number | string;
        c2Label: string; c2Val: number | string;
        c3Label: string; c3Val: number | string;
        c4Label: string; c4Val: number | string;
      }[] = [
        {
          c1Label: 'Mean (%RH)', c1Val: Number(h.mean.toFixed(2)),
          c2Label: 'Std Dev (%RH)', c2Val: Number(h.sample_standard_deviation.toFixed(3)),
          c3Label: 'Time in Range (%)', c3Val: `${Math.round(h.in_range_percent)}%`,
          c4Label: 'Study Period', c4Val: periodStr,
        },
        {
          c1Label: 'Min (%RH)', c1Val: Number(h.minimum.toFixed(2)),
          c2Label: 'Max (%RH)', c2Val: Number(h.maximum.toFixed(2)),
          c3Label: 'Out-of-Range (min)', c3Val: Number(h.out_of_range_minutes.toFixed(1)),
          c4Label: 'Readings in Period', c4Val: s.timestamps.length,
        },
        {
          c1Label: 'Below Alert (min)', c1Val: Number(h.below_minutes.toFixed(1)),
          c2Label: 'Above Alert (min)', c2Val: Number(h.above_minutes.toFixed(1)),
          c3Label: 'RH Limits', c3Val: `${output.humidityLimits!.lower} to ${output.humidityLimits!.upper} %RH`,
          c4Label: 'Serial No', c4Val: snap?.serialNumber || '—',
        },
        {
          c1Label: 'Traceability', c1Val: snap?.traceability || '—',
          c2Label: 'Cal / Due', c2Val: `${formatDateMMYYYY(snap?.calibrationDate)} / ${formatDateMMYYYY(snap?.dueDate)}`,
          c3Label: 'Instrument', c3Val: snap?.sensorName || snap?.description || displayLabel,
          c4Label: 'Mode', c4Val: 'Relative Humidity (%RH)',
        },
      ];

      statRows.forEach((sr, rIdx) => {
        const r = 3 + rIdx;
        wsHumSensor.getRow(r).height = 19;
        const pairs: [number, number, number, string, number | string][] = [
          [1, 2, 2, sr.c1Label, sr.c1Val],
          [3, 4, 4, sr.c2Label, sr.c2Val],
          [5, 6, 6, sr.c3Label, sr.c3Val],
          [7, 8, 10, sr.c4Label, sr.c4Val],
        ];
        pairs.forEach(([lCol, vStart, vEnd, label, val]) => {
          const lbl = wsHumSensor.getCell(r, lCol);
          lbl.value = label;
          lbl.fill = SUBHEADER_FILL;
          lbl.font = { name: 'Inter', size: 9.5, bold: true, color: { argb: 'FF1E3A8A' } };
          lbl.alignment = { vertical: 'middle', horizontal: 'left' };
          lbl.border = THIN_BORDER;

          if (vEnd > vStart) {
            wsHumSensor.mergeCells(r, vStart, r, vEnd);
          }
          const valCell = wsHumSensor.getCell(r, vStart);
          valCell.value = val;
          styleDataCell(valCell, typeof val === 'number' ? 'right' : 'center');
          for (let c = vStart; c <= vEnd; c++) {
            wsHumSensor.getCell(r, c).border = THIN_BORDER;
          }
        });
      });

      const humPng = perSensorHumPngs[idx];
      if (humPng) {
        const imgId = wb.addImage({
          buffer: humPng as unknown as ExcelJS.Buffer,
          extension: 'png',
        });
        wsHumSensor.addImage(imgId, {
          tl: { col: 11, row: 2 },
          ext: { width: 760, height: 320 },
        });
      }

      const dataHeaderRowIdx = 8;
      const dHeaders = [
        'No.',
        'Date (DD/MM/YYYY)',
        hasSeconds ? 'Time (HH:mm:ss)' : 'Time (HH:mm)',
        hasSeconds ? 'Date & Time (DD/MM/YYYY HH:mm:ss)' : 'Date & Time (DD/MM/YYYY HH:mm)',
        'Raw RH (%RH)',
        'Correction (%RH)',
        'Corrected RH (%RH)',
        'LRL (%RH)',
        'URL (%RH)',
        'Limit Status',
      ];
      const dHeaderRow = wsHumSensor.getRow(dataHeaderRowIdx);
      dHeaders.forEach((hd, i) => {
        dHeaderRow.getCell(i + 1).value = hd;
      });
      styleHeaderRow(dHeaderRow, dHeaders.length);
      wsHumSensor.views = [{ state: 'frozen', ySplit: dataHeaderRowIdx }];

      for (let i = 0; i < s.timestamps.length; i++) {
        const row = wsHumSensor.getRow(dataHeaderRowIdx + 1 + i);
        row.height = 19;
        const wallDate = toExcelWallClockDate(s.timestamps[i]);
        const val = s.correctedHumidities[i];
        const status =
          val < output.humidityLimits!.lower
            ? 'Below LRL'
            : val > output.humidityLimits!.upper
            ? 'Above URL'
            : 'In Range';

        row.getCell(1).value = i + 1;
        styleDataCell(row.getCell(1), 'center');

        row.getCell(2).value = wallDate;
        styleDataCell(row.getCell(2), 'center', 'dd/mm/yyyy');

        row.getCell(3).value = wallDate;
        styleDataCell(row.getCell(3), 'center', timeFmt);

        row.getCell(4).value = wallDate;
        styleDataCell(row.getCell(4), 'center', dateTimeFmt);

        row.getCell(5).value = s.originalHumidities[i];
        styleDataCell(row.getCell(5), 'right', '0.00');

        row.getCell(6).value = s.humidityCorrections[i];
        styleDataCell(row.getCell(6), 'right', '0.000');

        row.getCell(7).value = val;
        styleDataCell(row.getCell(7), 'right', '0.00');

        row.getCell(8).value = output.humidityLimits!.lower;
        styleDataCell(row.getCell(8), 'right', '0.0');

        row.getCell(9).value = output.humidityLimits!.upper;
        styleDataCell(row.getCell(9), 'right', '0.0');

        row.getCell(10).value = status;
        styleDataCell(row.getCell(10), 'center');

        if (status !== 'In Range') {
          row.getCell(7).fill = HOT_FILL;
          row.getCell(10).fill = HOT_FILL;
        } else if (i % 2 === 1) {
          for (let c = 1; c <= 10; c++) row.getCell(c).fill = ZEBRA_FILL;
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // 5. EQUIPMENT INFORMATION & CALIBRATION SNAPSHOT SHEETS
  // -----------------------------------------------------------------------
  const wsEquip = wb.addWorksheet(sanitizeExcelSheetName('Equipment Information', usedSheetNames));
  wsEquip.columns = [
    { width: 8 }, { width: 18 }, { width: 28 }, { width: 18 },
    { width: 22 }, { width: 16 }, { width: 16 },
  ];
  const eqHeaders = ['No.', 'Equipment Code', 'Description / Sensor Name', 'Serial No.', 'Traceability', 'Cal. Date', 'Due Date'];
  const eqHeadRow = wsEquip.getRow(1);
  eqHeaders.forEach((h, i) => {
    eqHeadRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(eqHeadRow, eqHeaders.length);
  wsEquip.views = [{ state: 'frozen', ySplit: 1 }];

  output.assignedSnapshots.forEach((snap, idx) => {
    const r = wsEquip.getRow(idx + 2);
    const vals = [
      idx + 1,
      labelFor(snap.equipmentCode),
      snap.sensorName || snap.description || 'Temperature Instrument',
      snap.serialNumber || '—',
      snap.traceability || '—',
      formatDateMMYYYY(snap.calibrationDate),
      formatDateMMYYYY(snap.dueDate),
    ];
    vals.forEach((v, cIdx) => {
      const cell = r.getCell(cIdx + 1);
      cell.value = v;
      styleDataCell(cell, cIdx === 0 ? 'center' : 'left');
      if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  });

  const wsCal = wb.addWorksheet(sanitizeExcelSheetName('Calibration Snapshot', usedSheetNames));
  wsCal.columns = [{ width: 18 }, { width: 22 }, { width: 30 }, { width: 16 }, { width: 16 }];
  const calHeaders = ['Equipment / Sensor', 'Channel', 'Correction Convention', 'Indication', 'Correction'];
  const calHeadRow = wsCal.getRow(1);
  calHeaders.forEach((h, i) => {
    calHeadRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(calHeadRow, calHeaders.length);
  wsCal.views = [{ state: 'frozen', ySplit: 1 }];

  let calRowIdx = 2;
  for (const snap of output.assignedSnapshots) {
    const channelName = snap.sourceChannel ? `Temperature (${snap.sourceChannel})` : 'Temperature';
    const displayLabel = labelFor(snap.equipmentCode);
    for (const pt of snap.temperatureCurve.points) {
      const row = wsCal.getRow(calRowIdx);
      const vals = [displayLabel, channelName, snap.temperatureCurve.convention, pt.indication, pt.correction];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        styleDataCell(cell, cIdx >= 3 ? 'right' : 'left', cIdx >= 3 ? '0.000' : undefined);
        if (calRowIdx % 2 === 1) cell.fill = ZEBRA_FILL;
      });
      calRowIdx++;
    }
    if (snap.humidityCurve) {
      for (const pt of snap.humidityCurve.points) {
        const row = wsCal.getRow(calRowIdx);
        const vals = [displayLabel, 'Relative Humidity', snap.humidityCurve.convention, pt.indication, pt.correction];
        vals.forEach((v, cIdx) => {
          const cell = row.getCell(cIdx + 1);
          cell.value = v;
          styleDataCell(cell, cIdx >= 3 ? 'right' : 'left', cIdx >= 3 ? '0.000' : undefined);
          if (calRowIdx % 2 === 1) cell.fill = ZEBRA_FILL;
        });
        calRowIdx++;
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/**
 * Exports the entire Data Loggers Registry to a cleanly formatted .xlsx workbook.
 */
export async function exportDataLoggersRegistryWorkbook(equipment: EquipmentRecord[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thermal Mapping Analysis - JNMI / RSS';
  wb.created = new Date();

  const wsList = wb.addWorksheet('Data Loggers Registry');
  wsList.columns = [
    { width: 16 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 18 },
    { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 18 },
    { width: 14 }, { width: 28 },
  ];

  const headers = [
    'Equipment Code',
    'Description',
    'Serial Number',
    'Manufacturer',
    'Traceability',
    'Cal Date',
    'Cal Due',
    'Cal Due Status',
    'Days Left',
    'Temp Points',
    'RH Points',
    'Notes',
  ];
  const hRow = wsList.getRow(1);
  headers.forEach((h, i) => {
    hRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(hRow, headers.length);
  wsList.views = [{ state: 'frozen', ySplit: 1 }];

  equipment.forEach((eq, idx) => {
    const dueInfo = getCalibrationDueInfo(eq.due_date);
    const tempPts = parsePointsJson(eq.temperature_points_json);
    const humPts = parsePointsJson(eq.humidity_points_json);

    const row = wsList.getRow(idx + 2);
    const vals: (string | number)[] = [
      eq.equipment_code,
      eq.description || '—',
      eq.serial_number || '—',
      eq.manufacturer || '—',
      eq.traceability || '—',
      formatDateDDMMYYYY(eq.calibration_date),
      dueInfo.formattedDate,
      dueInfo.tier === 'expired' ? 'Expired' : dueInfo.tier === 'expiring' ? 'Due Soon (<=60d)' : dueInfo.tier === 'valid' ? 'Valid (>60d)' : 'Not Recorded',
      dueInfo.daysRemaining ?? '—',
      tempPts.length,
      humPts.length,
      eq.notes || '',
    ];

    vals.forEach((v, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = v;
      styleDataCell(cell, cIdx === 8 || cIdx === 9 || cIdx === 10 ? 'right' : cIdx >= 5 && cIdx <= 7 ? 'center' : 'left');
      if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  });

  // Second sheet: Correction Points
  const wsPts = wb.addWorksheet('Correction Points');
  wsPts.columns = [{ width: 18 }, { width: 18 }, { width: 28 }, { width: 16 }, { width: 16 }];
  const ptHeaders = ['Equipment Code', 'Channel', 'Convention', 'Indication', 'Correction'];
  const ptHeadRow = wsPts.getRow(1);
  ptHeaders.forEach((h, i) => {
    ptHeadRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(ptHeadRow, ptHeaders.length);
  wsPts.views = [{ state: 'frozen', ySplit: 1 }];

  let rIdx = 2;
  for (const eq of equipment) {
    const tempPts = parsePointsJson(eq.temperature_points_json);
    const humPts = parsePointsJson(eq.humidity_points_json);
    for (const pt of tempPts) {
      const row = wsPts.getRow(rIdx);
      const vals = [eq.equipment_code, 'Temperature (°C)', eq.temperature_convention || 'indication_plus_correction', pt.indication, pt.correction];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        styleDataCell(cell, cIdx >= 3 ? 'right' : 'left', cIdx >= 3 ? '0.000' : undefined);
      });
      rIdx++;
    }
    for (const pt of humPts) {
      const row = wsPts.getRow(rIdx);
      const vals = [eq.equipment_code, 'Relative Humidity (%RH)', eq.humidity_convention || 'indication_plus_correction', pt.indication, pt.correction];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        styleDataCell(cell, cIdx >= 3 ? 'right' : 'left', cIdx >= 3 ? '0.000' : undefined);
      });
      rIdx++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/**
 * Exports all SuperDAQ Kits, registered PT100 sensors, and correction curves to a formatted .xlsx workbook.
 */
export async function exportSuperDaqRegistryWorkbook(
  kits: { kit_code: string; name: string; serial_number: string; status: string }[],
  sensors: {
    sensor_code: string;
    kit_code: string;
    name: string;
    channel_identifier: string;
    serial_number: string;
    position: string;
    calibration_date: string;
    due_date: string;
    certificate_number: string;
    provider: string;
    traceability: string;
    temperature_convention: string;
    temperature_points_json: string;
    notes: string;
  }[]
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Thermal Mapping Analysis - JNMI / RSS';
  wb.created = new Date();

  const kitByCode = new Map(kits.map((k) => [k.kit_code, k]));

  const wsList = wb.addWorksheet('SuperDAQ Registry');
  wsList.columns = [
    { width: 16 }, // Kit Code
    { width: 26 }, // Kit Name
    { width: 16 }, // Channel Identifier
    { width: 20 }, // Sensor Code
    { width: 28 }, // Sensor Name
    { width: 14 }, // Serial Number
    { width: 18 }, // Position
    { width: 16 }, // Traceability
    { width: 13 }, // Cal Date
    { width: 13 }, // Cal Due
    { width: 16 }, // Cal Due Status
    { width: 12 }, // Days Left
    { width: 13 }, // Temp Points
    { width: 26 }, // Notes
  ];

  const headers = [
    'Kit Code',
    'Kit Name',
    'Channel Identifier',
    'Sensor Code',
    'Description / Name',
    'Serial Number',
    'Position',
    'Traceability',
    'Cal Date',
    'Cal Due',
    'Cal Due Status',
    'Days Left',
    'Temp Points',
    'Notes',
  ];
  const hRow = wsList.getRow(1);
  headers.forEach((h, i) => {
    hRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(hRow, headers.length);
  wsList.views = [{ state: 'frozen', ySplit: 1 }];

  sensors.forEach((s, idx) => {
    const kit = kitByCode.get(s.kit_code);
    const dueInfo = getCalibrationDueInfo(s.due_date);
    const tempPts = parsePointsJson(s.temperature_points_json);

    const row = wsList.getRow(idx + 2);
    const vals: (string | number)[] = [
      s.kit_code,
      kit?.name || s.kit_code,
      s.channel_identifier,
      s.sensor_code,
      s.name || 'PT100 Temperature Sensor',
      s.serial_number || '—',
      s.position || '—',
      s.traceability || '—',
      formatDateDDMMYYYY(s.calibration_date),
      dueInfo.formattedDate,
      dueInfo.tier === 'expired'
        ? 'Expired'
        : dueInfo.tier === 'expiring'
        ? 'Due Soon (<=60d)'
        : dueInfo.tier === 'valid'
        ? 'Valid (>60d)'
        : 'Not Recorded',
      dueInfo.daysRemaining ?? '—',
      tempPts.length,
      s.notes || '',
    ];

    vals.forEach((v, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.value = v;
      styleDataCell(
        cell,
        cIdx === 11 || cIdx === 12 ? 'right' : cIdx >= 8 && cIdx <= 10 ? 'center' : 'left'
      );
      if (idx % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  });

  // Second sheet: Correction Points
  const wsPts = wb.addWorksheet('Correction Points');
  wsPts.columns = [
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 28 },
    { width: 16 },
    { width: 16 },
  ];
  const ptHeaders = [
    'Kit Code',
    'Channel Identifier',
    'Sensor Code',
    'Convention',
    'Indication (°C)',
    'Correction (°C)',
  ];
  const ptHeadRow = wsPts.getRow(1);
  ptHeaders.forEach((h, i) => {
    ptHeadRow.getCell(i + 1).value = h;
  });
  styleHeaderRow(ptHeadRow, ptHeaders.length);
  wsPts.views = [{ state: 'frozen', ySplit: 1 }];

  let rIdx = 2;
  for (const s of sensors) {
    const tempPts = parsePointsJson(s.temperature_points_json);
    for (const pt of tempPts) {
      const row = wsPts.getRow(rIdx);
      const vals = [
        s.kit_code,
        s.channel_identifier,
        s.sensor_code,
        s.temperature_convention || 'indication_plus_correction',
        pt.indication,
        pt.correction,
      ];
      vals.forEach((v, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        cell.value = v;
        styleDataCell(cell, cIdx >= 4 ? 'right' : 'left', cIdx >= 4 ? '0.000' : undefined);
      });
      rIdx++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

