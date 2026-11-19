import React, { useState, useEffect, useMemo } from 'react';
import {
  EquipmentRecord,
  SensorKitRecord,
  SuperDaqSensorRecord,
  StudyDraft,
  saveStudyDraft,
  loadStudyDraft,
  clearStudyDraft,
  parsePointsJson,
  isRecordExpired,
} from '../store/metrologyStore.ts';
import {
  parseDataLoggerFile,
  parseSuperDaqFile,
  runMetrologyStudyAnalysis,
  StudyAnalysisOutput,
  MeasurementReading,
} from '../utils/importers.ts';
import { CalibrationCurve } from '../utils/metrology.ts';
import {
  formatDateTimeDDMMYYYY,
  toDateTimeLocalInput,
  getCalibrationDueInfo,
} from '../utils/dateFormat.ts';
import {
  UploadCloud,
  FileSpreadsheet,
  AlertCircle,
  Play,
  ChevronRight,
  ChevronLeft,
  Check,
  Search,
  History,
  Trash2,
  Cpu,
} from 'lucide-react';

interface StudyWorkspaceProps {
  equipment: EquipmentRecord[];
  sensorKits: SensorKitRecord[];
  sensors: SuperDaqSensorRecord[];
  defaultSamplingIntervalMinutes?: number;
  initialStep?: 1 | 2 | 3;
  onAnalysisComplete: (output: StudyAnalysisOutput) => void;
  presetSampleType?: 'data_logger' | 'superdaq' | null;
  onClearPresetSample?: () => void;
}

interface AssignedRow {
  id: string;
  sourceLabel: string;
  formatName: string;
  readings: MeasurementReading[];
  assignedCode: string;
  valid: boolean;
  notes?: string;
}

function extractChannelNumber(str: string): string | null {
  const m = str.match(/(?:ch(?:annel)?[\s_-]*)?(\d+)/i);
  return m ? m[1].replace(/^0+/, '') || '0' : null;
}

function findMatchingSensorForChannel(
  rawChannelLabel: string,
  kitSensors: SuperDaqSensorRecord[]
): SuperDaqSensorRecord | undefined {
  if (!kitSensors || kitSensors.length === 0) return undefined;

  const cleanLabel = rawChannelLabel.includes('·')
    ? rawChannelLabel.split('·').pop()!.trim()
    : rawChannelLabel.trim();

  const normLabel = cleanLabel.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
  const numLabel = extractChannelNumber(cleanLabel);

  const exactMatch = kitSensors.find((s) => {
    const sNorm = s.channel_identifier.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
    return sNorm === normLabel && sNorm.length > 0;
  });
  if (exactMatch) return exactMatch;

  if (numLabel) {
    const numMatch = kitSensors.find((s) => {
      const sNum = extractChannelNumber(s.channel_identifier);
      return sNum === numLabel;
    });
    if (numMatch) return numMatch;
  }

  if (numLabel) {
    const codeMatch = kitSensors.find((s) => {
      const sCodeNorm = s.sensor_code.toLowerCase().replace(/[^a-z0-9]/g, '');
      return sCodeNorm.includes(`ch${numLabel}`) || sCodeNorm.endsWith(`${numLabel}`);
    });
    if (codeMatch) return codeMatch;
  }

  return undefined;
}

const STEP_LABELS: { step: 1 | 2 | 3 | 4; label: string }[] = [
  { step: 1, label: 'Setup' },
  { step: 2, label: 'Select Sensors' },
  { step: 3, label: 'Upload Data' },
  { step: 4, label: 'Results' },
];

export const StudyWorkspace: React.FC<StudyWorkspaceProps> = ({
  equipment,
  sensorKits,
  sensors,
  defaultSamplingIntervalMinutes = 15,
  initialStep = 1,
  onAnalysisComplete,
  presetSampleType,
  onClearPresetSample,
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(initialStep);

  // Sync external initialStep jumps (e.g. clicking stepper from ResultsPreview)
  useEffect(() => {
    setCurrentStep(initialStep);
  }, [initialStep]);

  // Step 1: Setup state
  const [studyName, setStudyName] = useState('Cold Room Thermal Mapping Study');
  const [acquisitionSystem, setAcquisitionSystem] = useState<'data_logger' | 'fluke_superdaq'>('data_logger');
  const [analysisMode, setAnalysisMode] = useState<'temperature' | 'temperature_and_humidity'>('temperature');
  const [selectedKitCode, setSelectedKitCode] = useState<string>(sensorKits[0]?.kit_code || 'KIT_44070036');

  const [startStr, setStartStr] = useState('2025-04-06T17:00');
  const [endStr, setEndStr] = useState('2025-04-13T17:00');

  const [tempLower, setTempLower] = useState('2.0');
  const [tempUpper, setTempUpper] = useState('8.0');
  const [humidityLower, setHumidityLower] = useState('30.0');
  const [humidityUpper, setHumidityUpper] = useState('65.0');
  const [samplingIntervalMode, setSamplingIntervalMode] = useState<'auto' | 'fixed'>('auto');
  const [samplingIntervalStr, setSamplingIntervalStr] = useState(String(defaultSamplingIntervalMinutes));

  // Step 2: Sensor Selection
  const [sensorSearch, setSensorSearch] = useState('');
  const [selectedSensorCodes, setSelectedSensorCodes] = useState<string[]>([]);

  // Step 3: File Upload & Mapping
  const [assignedRows, setAssignedRows] = useState<AssignedRow[]>([]);
  const [confirmExpired, setConfirmExpired] = useState(false);

  // Feedback & Draft Resume
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<StudyDraft | null>(null);
  const [draftCheckDone, setDraftCheckDone] = useState(false);

  // Sync default kit if missing
  useEffect(() => {
    if (sensorKits.length > 0 && !sensorKits.some((k) => k.kit_code === selectedKitCode)) {
      setSelectedKitCode(sensorKits[0].kit_code);
    }
  }, [sensorKits, selectedKitCode]);

  // Sync Settings default sampling interval if untouched
  useEffect(() => {
    setSamplingIntervalStr(String(defaultSamplingIntervalMinutes));
  }, [defaultSamplingIntervalMinutes]);

  // Check for saved study draft on mount
  useEffect(() => {
    if (presetSampleType) {
      setPendingDraft(null);
      setDraftCheckDone(true);
      return;
    }
    const existingDraft = loadStudyDraft();
    if (existingDraft) {
      setPendingDraft(existingDraft);
    }
    setDraftCheckDone(true);
  }, []);

  // Candidate sensors for Step 2
  const candidateSensors = useMemo(() => {
    const q = sensorSearch.trim().toLowerCase();
    if (acquisitionSystem === 'data_logger') {
      return equipment
        .filter(
          (eq) =>
            !q ||
            eq.equipment_code.toLowerCase().includes(q) ||
            eq.description.toLowerCase().includes(q) ||
            eq.serial_number.toLowerCase().includes(q)
        )
        .map((eq) => ({
          code: eq.equipment_code,
          primaryLabel: eq.equipment_code,
          secondaryLabel: eq.description || 'Data Logger',
          serialNumber: eq.serial_number,
          dueDate: eq.due_date,
          tempCount: parsePointsJson(eq.temperature_points_json).length,
          humCount: parsePointsJson(eq.humidity_points_json).length,
        }));
    }

    return sensors
      .filter(
        (s) =>
          s.kit_code.trim().toUpperCase() === selectedKitCode.trim().toUpperCase() ||
          s.kit_code === selectedKitCode
      )
      .filter(
        (s) =>
          !q ||
          s.channel_identifier.toLowerCase().includes(q) ||
          s.sensor_code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.serial_number.toLowerCase().includes(q)
      )
      .map((s) => ({
        code: s.sensor_code,
        primaryLabel: s.channel_identifier,
        secondaryLabel: `${s.name} (${s.sensor_code})`,
        serialNumber: s.serial_number,
        dueDate: s.due_date,
        tempCount: parsePointsJson(s.temperature_points_json).length,
        humCount: 0,
      }));
  }, [acquisitionSystem, equipment, sensors, selectedKitCode, sensorSearch]);

  // Autosave draft whenever user modifies study state (once draft prompt settled or dismissed)
  useEffect(() => {
    if (!draftCheckDone || pendingDraft) return;
    const timer = setTimeout(() => {
      saveStudyDraft({
        studyName,
        acquisitionSystem,
        analysisMode,
        selectedKitCode,
        startStr,
        endStr,
        tempLower,
        tempUpper,
        humidityLower,
        humidityUpper,
        samplingIntervalStr: samplingIntervalMode === 'fixed' ? samplingIntervalStr : 'auto',
        selectedSensorCodes,
        assignedRows: assignedRows.map((r) => ({
          id: r.id,
          sourceLabel: r.sourceLabel,
          formatName: r.formatName,
          assignedCode: r.assignedCode,
          valid: r.valid,
          notes: r.notes,
          readings: r.readings.map((rd) => ({
            timestamp: rd.timestamp.toISOString(),
            temperature: rd.temperature,
            humidity: rd.humidity,
          })),
        })),
        confirmExpired,
        step: currentStep,
        savedAt: new Date().toISOString(),
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [
    draftCheckDone,
    pendingDraft,
    studyName,
    acquisitionSystem,
    analysisMode,
    selectedKitCode,
    startStr,
    endStr,
    tempLower,
    tempUpper,
    humidityLower,
    humidityUpper,
    samplingIntervalMode,
    samplingIntervalStr,
    selectedSensorCodes,
    assignedRows,
    confirmExpired,
    currentStep,
  ]);

  const handleResumeDraft = () => {
    if (!pendingDraft) return;
    setStudyName(pendingDraft.studyName);
    setAcquisitionSystem(pendingDraft.acquisitionSystem);
    setAnalysisMode(pendingDraft.analysisMode);
    setSelectedKitCode(pendingDraft.selectedKitCode);
    setStartStr(pendingDraft.startStr);
    setEndStr(pendingDraft.endStr);
    setTempLower(pendingDraft.tempLower);
    setTempUpper(pendingDraft.tempUpper);
    setHumidityLower(pendingDraft.humidityLower);
    setHumidityUpper(pendingDraft.humidityUpper);
    if (pendingDraft.samplingIntervalStr === 'auto') {
      setSamplingIntervalMode('auto');
    } else {
      setSamplingIntervalMode('fixed');
      setSamplingIntervalStr(pendingDraft.samplingIntervalStr || String(defaultSamplingIntervalMinutes));
    }
    setSelectedSensorCodes(pendingDraft.selectedSensorCodes || []);
    setAssignedRows(
      (pendingDraft.assignedRows || [])
        .filter((r) => r.readings && r.readings.length > 0)
        .map((r) => ({
          ...r,
          readings: r.readings.map((rd) => ({
            timestamp: new Date(rd.timestamp),
            temperature: rd.temperature,
            humidity: rd.humidity,
          })),
        }))
    );
    setConfirmExpired(Boolean(pendingDraft.confirmExpired));
    setCurrentStep(pendingDraft.step || 1);
    setPendingDraft(null);
    setErrorMessage(null);
  };

  const handleDiscardDraft = () => {
    clearStudyDraft();
    setPendingDraft(null);
  };

  // Sample dataset loader
  const loadPreset = async (type: 'data_logger' | 'superdaq') => {
    setLoading(true);
    setErrorMessage(null);
    setFieldErrors({});
    setPendingDraft(null);
    try {
      if (type === 'data_logger') {
        setAcquisitionSystem('data_logger');
        setAnalysisMode('temperature');
        setTempLower('15.0');
        setTempUpper('25.0');
        setStartStr('2025-04-06T17:00');
        setEndStr('2025-04-13T17:00');
        setSamplingIntervalMode('auto');

        const resp = await fetch('/Report_Table.xls');
        const buf = await resp.arrayBuffer();
        const parsed = parseDataLoggerFile(buf, 'Report_Table.xls');

        const matchingCode = equipment.some((e) => e.equipment_code === parsed.instrumentCode)
          ? parsed.instrumentCode!
          : equipment[0]?.equipment_code || 'DL001';

        setSelectedSensorCodes([matchingCode]);
        setAssignedRows([
          {
            id: 'dl-sample-1',
            sourceLabel: 'Report_Table.xls (Instrument: DL001)',
            formatName: parsed.formatName,
            readings: parsed.readings,
            assignedCode: matchingCode,
            valid: true,
            notes: `${parsed.readings.length} readings recorded`,
          },
        ]);
        setCurrentStep(3);
      } else {
        setAcquisitionSystem('fluke_superdaq');
        setAnalysisMode('temperature');
        setTempLower('15.0');
        setTempUpper('25.0');
        setSamplingIntervalMode('auto');

        const activeKitCode =
          selectedKitCode && sensorKits.some((k) => k.kit_code === selectedKitCode)
            ? selectedKitCode
            : sensorKits[0]?.kit_code || 'KIT_44070036';
        setSelectedKitCode(activeKitCode);

        const resp = await fetch('/dat00001.xlsx');
        const buf = await resp.arrayBuffer();
        const parsed = parseSuperDaqFile(buf, 'dat00001.xlsx');

        const kitSensors = sensors.filter(
          (s) => s.kit_code.trim().toUpperCase() === activeKitCode.trim().toUpperCase() || s.kit_code === activeKitCode
        );
        const newRows: AssignedRow[] = [];
        const matchedCodes: string[] = [];

        const firstChannelKey = Object.keys(parsed.channels)[0];
        if (firstChannelKey && parsed.channels[firstChannelKey].length > 0) {
          const chReadings = parsed.channels[firstChannelKey];
          const firstTs = chReadings[0].timestamp;
          const lastTs = chReadings[Math.min(chReadings.length - 1, 50)].timestamp;
          if (firstTs && lastTs) {
            setStartStr(toDateTimeLocalInput(firstTs));
            setEndStr(toDateTimeLocalInput(lastTs));
          }
        }

        Object.entries(parsed.channels).slice(0, 9).forEach(([chLabel, readings], idx) => {
          const matchedSensor = findMatchingSensorForChannel(chLabel, kitSensors);
          if (matchedSensor) matchedCodes.push(matchedSensor.sensor_code);
          newRows.push({
            id: `sq-sample-${idx}`,
            sourceLabel: `${chLabel} (${readings.length} readings)`,
            formatName: 'Fluke SuperDAQ dat00001.xlsx',
            readings,
            assignedCode: matchedSensor ? matchedSensor.sensor_code : '',
            valid: true,
            notes: matchedSensor
              ? `Mapped to ${matchedSensor.name} (${matchedSensor.channel_identifier})`
              : undefined,
          });
        });

        setSelectedSensorCodes(matchedCodes);
        setAssignedRows(newRows);
        setCurrentStep(3);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage(`Failed to load sample dataset: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (presetSampleType) {
      loadPreset(presetSampleType);
      onClearPresetSample?.();
    }
  }, [presetSampleType]);

  // Step 1 validation
  const validateStep1 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!studyName.trim()) {
      errs.studyName = 'Study Name is required.';
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      errs.dates = 'Please enter valid Study Start and Study End dates.';
    } else if (endDate.getTime() <= startDate.getTime()) {
      errs.dates = 'Study End must be strictly later than Study Start.';
    }

    const lowerT = parseFloat(tempLower);
    const upperT = parseFloat(tempUpper);
    if (!Number.isFinite(lowerT) || !Number.isFinite(upperT)) {
      errs.tempLimits = 'Temperature limits must be valid numbers.';
    } else if (lowerT >= upperT) {
      errs.tempLimits = 'Lower Temperature Limit must be strictly less than Upper Limit.';
    }

    if (analysisMode === 'temperature_and_humidity') {
      const lowerH = parseFloat(humidityLower);
      const upperH = parseFloat(humidityUpper);
      if (!Number.isFinite(lowerH) || !Number.isFinite(upperH) || lowerH < 0 || upperH > 100) {
        errs.humLimits = 'RH limits must be numbers between 0 and 100 %RH.';
      } else if (lowerH >= upperH) {
        errs.humLimits = 'Lower RH Limit must be strictly less than Upper Limit.';
      }
    }

    if (samplingIntervalMode === 'fixed') {
      const iv = parseInt(samplingIntervalStr, 10);
      if (!Number.isFinite(iv) || iv < 1 || iv > 1440) {
        errs.interval = 'Sampling interval must be between 1 and 1440 minutes.';
      }
    }

    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setErrorMessage('Please fix the highlighted configuration errors before continuing.');
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  // Step 2 validation
  const validateStep2 = (): boolean => {
    if (selectedSensorCodes.length === 0) {
      setErrorMessage('Please select at least one instrument / sensor for this study.');
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  const handleGoToStep = (target: 1 | 2 | 3) => {
    if (target === 1) {
      setErrorMessage(null);
      setCurrentStep(1);
      return;
    }
    if (target === 2) {
      if (validateStep1()) setCurrentStep(2);
      return;
    }
    if (target === 3) {
      if (!validateStep1()) {
        setCurrentStep(1);
        return;
      }
      if (selectedSensorCodes.length === 0 && assignedRows.length === 0) {
        validateStep2();
        setCurrentStep(2);
        return;
      }
      setErrorMessage(null);
      setCurrentStep(3);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setErrorMessage(null);

    const newRows: AssignedRow[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buf = await file.arrayBuffer();

        if (acquisitionSystem === 'data_logger') {
          const parsed = parseDataLoggerFile(buf, file.name);
          const pool =
            selectedSensorCodes.length > 0
              ? equipment.filter((eq) => selectedSensorCodes.includes(eq.equipment_code))
              : equipment;

          const matched =
            pool.find((eq) => eq.equipment_code.toUpperCase() === parsed.instrumentCode?.toUpperCase()) ||
            equipment.find((eq) => eq.equipment_code.toUpperCase() === parsed.instrumentCode?.toUpperCase());

          newRows.push({
            id: `file-${Date.now()}-${i}`,
            sourceLabel: file.name,
            formatName: parsed.formatName,
            readings: parsed.readings,
            assignedCode: matched ? matched.equipment_code : pool[0]?.equipment_code || '',
            valid: true,
            notes: parsed.instrumentCode ? `Detected ID: ${parsed.instrumentCode}` : `${parsed.readings.length} measurements`,
          });
        } else {
          const parsed = parseSuperDaqFile(buf, file.name);
          const activeKitCode = selectedKitCode || sensorKits[0]?.kit_code || 'KIT_44070036';
          const kitSensors = sensors.filter(
            (s) => s.kit_code.trim().toUpperCase() === activeKitCode.trim().toUpperCase() || s.kit_code === activeKitCode
          );
          const selectedPool =
            selectedSensorCodes.length > 0
              ? kitSensors.filter((s) => selectedSensorCodes.includes(s.sensor_code))
              : kitSensors;

          Object.entries(parsed.channels).forEach(([chLabel, readings], idx) => {
            const matchedSensor =
              findMatchingSensorForChannel(chLabel, selectedPool) ||
              findMatchingSensorForChannel(chLabel, kitSensors);

            newRows.push({
              id: `sq-${Date.now()}-${idx}`,
              sourceLabel: `${file.name} · ${chLabel}`,
              formatName: parsed.formatName,
              readings,
              assignedCode: matchedSensor ? matchedSensor.sensor_code : '',
              valid: true,
              notes: matchedSensor
                ? `Mapped to ${matchedSensor.name} (${matchedSensor.channel_identifier})`
                : `${readings.length} measurements`,
            });
          });
        }
      } catch (err) {
        console.error(err);
        setErrorMessage(`Error parsing ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (newRows.length > 0) {
      setAssignedRows((prev) => [...prev, ...newRows]);
    }
    e.target.value = '';
    setLoading(false);
  };

  // Detect any expired instruments among selected or assigned
  const hasExpiredSelectedOrAssigned = useMemo(() => {
    const codesToCheck = new Set<string>([
      ...selectedSensorCodes,
      ...assignedRows.map((r) => r.assignedCode).filter(Boolean),
    ]);
    for (const code of codesToCheck) {
      if (acquisitionSystem === 'data_logger') {
        const eq = equipment.find((e) => e.equipment_code === code);
        if (eq?.due_date && isRecordExpired(eq.due_date)) return true;
      } else {
        const s = sensors.find((sen) => sen.sensor_code === code);
        if (s?.due_date && isRecordExpired(s.due_date)) return true;
      }
    }
    return false;
  }, [selectedSensorCodes, assignedRows, acquisitionSystem, equipment, sensors]);

  const handleRunAnalysis = () => {
    setErrorMessage(null);
    if (!validateStep1()) {
      setCurrentStep(1);
      return;
    }

    if (assignedRows.length === 0) {
      setErrorMessage('Please upload at least one data file (or load a sample dataset) to analyze.');
      return;
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    const lowerT = parseFloat(tempLower);
    const upperT = parseFloat(tempUpper);
    const lowerH = analysisMode === 'temperature_and_humidity' ? parseFloat(humidityLower) : 0;
    const upperH = analysisMode === 'temperature_and_humidity' ? parseFloat(humidityUpper) : 100;

    const codes = assignedRows.map((r) => r.assignedCode).filter(Boolean);
    if (codes.length !== assignedRows.length) {
      setErrorMessage('Every uploaded file / channel must have an Assigned Registry Record.');
      return;
    }
    if (new Set(codes).size !== codes.length) {
      setErrorMessage('Each Data Logger / Sensor may be assigned to only one file or channel in a study.');
      return;
    }

    let hasExpired = false;
    for (const code of codes) {
      if (acquisitionSystem === 'data_logger') {
        const eq = equipment.find((e) => e.equipment_code === code);
        if (eq?.due_date && isRecordExpired(eq.due_date)) {
          hasExpired = true;
          break;
        }
      } else {
        const s = sensors.find((sen) => sen.sensor_code === code);
        if (s?.due_date && isRecordExpired(s.due_date)) {
          hasExpired = true;
          break;
        }
      }
    }

    if (hasExpired && !confirmExpired) {
      setErrorMessage(
        'One or more assigned instruments have expired calibration certificates. Check the acknowledgment box below before generating results.'
      );
      return;
    }

    const assignedLoggers = assignedRows.map((row) => {
      let tempCurve: CalibrationCurve;
      let humCurve: CalibrationCurve | undefined;
      let displayCode = row.assignedCode;
      let serialNumber = '';
      let description = '';
      let traceability = '';
      let calibrationDate = '';
      let dueDate = '';
      let sourceChannel = '';
      let sensorName = '';

      if (acquisitionSystem === 'data_logger') {
        const eq = equipment.find((e) => e.equipment_code === row.assignedCode);
        displayCode = eq?.equipment_code || row.assignedCode;
        description = eq?.description || 'Data Logger';
        serialNumber = eq?.serial_number || '';
        traceability = eq?.traceability || '';
        calibrationDate = eq?.calibration_date || '';
        dueDate = eq?.due_date || '';

        const pts = eq ? parsePointsJson(eq.temperature_points_json) : [];
        const convention = eq?.temperature_convention || 'indication_plus_correction';
        tempCurve = new CalibrationCurve(
          pts.length >= 2 ? pts : [{ indication: 0, correction: 0 }, { indication: 100, correction: 0 }],
          convention as 'indication_plus_correction' | 'indication_minus_correction'
        );

        if (analysisMode === 'temperature_and_humidity' && eq?.humidity_enabled) {
          const hpts = parsePointsJson(eq.humidity_points_json);
          humCurve = new CalibrationCurve(
            hpts.length >= 2 ? hpts : [{ indication: 0, correction: 0 }, { indication: 100, correction: 0 }],
            (eq.humidity_convention || 'indication_plus_correction') as 'indication_plus_correction' | 'indication_minus_correction'
          );
        }
      } else {
        const sensor = sensors.find((s) => s.sensor_code === row.assignedCode);
        displayCode = sensor?.sensor_code || row.assignedCode;
        sensorName = sensor?.name || 'PT100 Sensor';
        sourceChannel = sensor?.channel_identifier || '';
        serialNumber = sensor?.serial_number || '';
        traceability = sensor?.traceability || '';
        calibrationDate = sensor?.calibration_date || '';
        dueDate = sensor?.due_date || '';

        const pts = sensor ? parsePointsJson(sensor.temperature_points_json) : [];
        const convention = sensor?.temperature_convention || 'indication_plus_correction';
        tempCurve = new CalibrationCurve(
          pts.length >= 2 ? pts : [{ indication: -40, correction: 0 }, { indication: 100, correction: 0 }],
          convention as 'indication_plus_correction' | 'indication_minus_correction'
        );
      }

      return {
        equipmentCode: displayCode,
        readings: row.readings,
        temperatureCurve: tempCurve,
        humidityCurve: humCurve,
        serialNumber,
        description,
        traceability,
        calibrationDate,
        dueDate,
        sourceChannel,
        sensorName,
      };
    });

    try {
      const output = runMetrologyStudyAnalysis({
        studyName: studyName.trim(),
        requestedStart: startDate,
        requestedEnd: endDate,
        samplingIntervalMinutes:
          samplingIntervalMode === 'fixed' ? parseInt(samplingIntervalStr, 10) : undefined,
        mode: analysisMode,
        temperatureLimits: { lower: lowerT, upper: upperT },
        humidityLimits:
          analysisMode === 'temperature_and_humidity'
            ? { lower: lowerH, upper: upperH }
            : undefined,
        acquisitionSystem:
          acquisitionSystem === 'data_logger' ? 'Data Logger' : 'Fluke SuperDAQ',
        sensorKit:
          acquisitionSystem === 'fluke_superdaq'
            ? sensorKits.find((k) => k.kit_code === selectedKitCode)?.name || selectedKitCode
            : '',
        expiredCertificateConfirmed: confirmExpired,
        assignedLoggers,
      });

      onAnalysisComplete(output);
    } catch (err: unknown) {
      console.error(err);
      if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: string[] }).issues)) {
        setErrorMessage((err as { issues: string[] }).issues.join('\n'));
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(String(err));
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-bold text-[#5275ad] dark:text-blue-400 mb-1">
            Mapping Workflow
          </p>
          <h1 className="text-2xl md:text-3xl font-extrabold text-[#182330] dark:text-slate-100 tracking-tight">
            Study Workspace
          </h1>
          <p className="text-xs text-[#647184] dark:text-slate-400 mt-0.5">
            Configure study parameters, select calibrated instruments, upload measurement logs, and review results.
          </p>
        </div>
      </section>

      {/* Autosaved Study Draft Resume Banner */}
      {pendingDraft && (
        <div className="p-4 rounded-xl bg-[#edf3ff] dark:bg-blue-950/40 border border-[#bfd3f8] dark:border-blue-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#2864dc] text-white flex items-center justify-center shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#182330] dark:text-slate-100">
                Saved Study Draft Available: {pendingDraft.studyName}
              </p>
              <p className="text-[11px] text-[#526071] dark:text-slate-300 tabular-nums mt-0.5">
                Saved on {formatDateTimeDDMMYYYY(pendingDraft.savedAt)} · Step {pendingDraft.step} of 4
                {pendingDraft.assignedRows?.length ? ` · ${pendingDraft.assignedRows.length} loaded channel(s)` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-xs font-semibold text-[#667384] dark:text-slate-300 hover:bg-[#f5f7fa] cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Discard</span>
            </button>
            <button
              type="button"
              onClick={handleResumeDraft}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] cursor-pointer shadow-xs"
            >
              <span>Resume Study</span>
            </button>
          </div>
        </div>
      )}

      {/* 4-Step Interactive Stepper */}
      <nav
        aria-label="Study workflow progress"
        className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-3 shadow-xs"
      >
        <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STEP_LABELS.map((item) => {
            const isActive = item.step === currentStep;
            const isCompleted = item.step < currentStep;
            const isDisabled = item.step === 4;

            return (
              <li key={item.step}>
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    if (item.step !== 4) handleGoToStep(item.step);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-[#edf3ff] dark:bg-blue-950/60 border border-[#bfd3f8] dark:border-blue-800 text-[#2864dc] dark:text-blue-300'
                      : isCompleted
                      ? 'bg-[#f8fafc] dark:bg-[#0f172a]/50 border border-[#e5e9ef] dark:border-[#334155] text-[#182330] dark:text-slate-200 hover:border-[#2864dc]/50 cursor-pointer'
                      : isDisabled
                      ? 'bg-transparent border border-transparent text-[#94a3b8] dark:text-slate-500 cursor-default'
                      : 'bg-transparent border border-transparent text-[#647184] dark:text-slate-400 hover:bg-[#f8fafc] dark:hover:bg-[#0f172a]/40 cursor-pointer'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums shrink-0 ${
                      isActive
                        ? 'bg-[#2864dc] text-white'
                        : isCompleted
                        ? 'bg-[#10b981] text-white'
                        : 'bg-[#edf0f4] dark:bg-[#334155] text-[#647184] dark:text-slate-400'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : item.step}
                  </span>
                  <div className="min-w-0">
                    <span className="block text-[10px] uppercase tracking-wider font-bold opacity-75">
                      Step {item.step}
                    </span>
                    <span className="block text-xs font-bold truncate">{item.label}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Error Alert */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-[#fff0ed] dark:bg-red-950/40 text-[#bd4d42] dark:text-red-300 border border-[#f5c6cb] dark:border-red-900 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1 whitespace-pre-line">
            <p className="font-bold">Validation Notice</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STEP 1: STUDY SETUP & ACCEPTANCE PRESETS                          */}
      {/* ================================================================= */}
      {currentStep === 1 && (
        <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 shadow-xs space-y-5 sm:space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#edf0f4] dark:border-[#334155]">
            <div>
              <h2 className="text-base font-bold text-[#182330] dark:text-slate-100">
                Step 1: Study Configuration & Limits
              </h2>
              <p className="text-[11px] text-[#788493] dark:text-slate-400">
                Define study window (24h DD/MM/YYYY HH:mm), acquisition system, and acceptance criteria.
              </p>
            </div>
          </div>

          {/* Core Study Identity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Study Name <span className="text-[#bd4d42]">*</span>
              <input
                type="text"
                value={studyName}
                onChange={(e) => {
                  setStudyName(e.target.value);
                  if (fieldErrors.studyName) setFieldErrors((p) => ({ ...p, studyName: '' }));
                }}
                placeholder="Cold Room Thermal Mapping Study"
                className={`mt-1.5 w-full h-10 px-3 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#2864dc]/25 ${
                  fieldErrors.studyName ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155] focus:border-[#2864dc]'
                }`}
              />
              {fieldErrors.studyName && (
                <span className="text-[11px] text-[#bd4d42] font-normal mt-1 block">{fieldErrors.studyName}</span>
              )}
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Acquisition System
              <select
                value={acquisitionSystem}
                onChange={(e) => {
                  const val = e.target.value as 'data_logger' | 'fluke_superdaq';
                  setAcquisitionSystem(val);
                  if (val === 'fluke_superdaq') setAnalysisMode('temperature');
                  setSelectedSensorCodes([]);
                  setAssignedRows([]);
                }}
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
              >
                <option value="data_logger">Data Logger (Single / Multi-device)</option>
                <option value="fluke_superdaq">Fluke SuperDAQ System (Multi-channel)</option>
              </select>
            </label>

            <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
              Analysis Mode
              <select
                value={analysisMode}
                onChange={(e) =>
                  setAnalysisMode(e.target.value as 'temperature' | 'temperature_and_humidity')
                }
                disabled={acquisitionSystem === 'fluke_superdaq'}
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc] disabled:opacity-60"
              >
                <option value="temperature">Temperature Only</option>
                <option value="temperature_and_humidity">Temperature and Relative Humidity</option>
              </select>
            </label>
          </div>

          {/* SuperDAQ Kit Selector */}
          {acquisitionSystem === 'fluke_superdaq' && (
            <div className="p-3.5 bg-[#f8faff] dark:bg-blue-950/30 rounded-xl border border-[#dce6f7] dark:border-blue-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#2864dc]" />
                <span className="text-xs font-bold text-[#182330] dark:text-slate-100">
                  SuperDAQ Mainframe / Kit Selection
                </span>
              </div>
              <select
                value={selectedKitCode}
                onChange={(e) => {
                  const newKitCode = e.target.value;
                  setSelectedKitCode(newKitCode);
                  setSelectedSensorCodes([]);
                  const targetSensors = sensors.filter(
                    (s) =>
                      s.kit_code.trim().toUpperCase() === newKitCode.trim().toUpperCase() ||
                      s.kit_code === newKitCode
                  );
                  setAssignedRows((prevRows) =>
                    prevRows.map((row) => {
                      const match = findMatchingSensorForChannel(row.sourceLabel, targetSensors);
                      return {
                        ...row,
                        assignedCode: match ? match.sensor_code : '',
                        notes: match
                          ? `Mapped to ${match.name} (${match.channel_identifier})`
                          : row.notes,
                      };
                    })
                  );
                }}
                className="h-9 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] text-xs font-semibold text-[#182330] dark:text-slate-100 bg-white dark:bg-[#0f172a] focus:outline-none focus:border-[#2864dc]"
              >
                {sensorKits
                  .filter((k) => k.status === 'Active')
                  .map((k, index) => (
                    <option key={`${k.kit_code}-${index}`} value={k.kit_code}>
                      {k.name} (S/N: {k.serial_number})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Dates, Limits & Sampling Interval */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2 border-t border-[#edf0f4] dark:border-[#334155]">
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                  Study Start
                  <input
                    type="datetime-local"
                    value={startStr}
                    onChange={(e) => {
                      setStartStr(e.target.value);
                      if (fieldErrors.dates) setFieldErrors((p) => ({ ...p, dates: '' }));
                    }}
                    className={`mt-1.5 w-full h-10 px-3 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc] ${
                      fieldErrors.dates ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155]'
                    }`}
                  />
                </label>

                <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                  Study End
                  <input
                    type="datetime-local"
                    value={endStr}
                    onChange={(e) => {
                      setEndStr(e.target.value);
                      if (fieldErrors.dates) setFieldErrors((p) => ({ ...p, dates: '' }));
                    }}
                    className={`mt-1.5 w-full h-10 px-3 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc] ${
                      fieldErrors.dates ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155]'
                    }`}
                  />
                </label>
              </div>
              {fieldErrors.dates && (
                <p className="text-[11px] text-[#bd4d42] font-medium">{fieldErrors.dates}</p>
              )}

              {/* Sampling Interval */}
              <div className="pt-1">
                <span className="block text-xs font-semibold text-[#334052] dark:text-slate-300 mb-1.5">
                  Sampling Interval (minutes)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={samplingIntervalMode}
                    onChange={(e) => {
                      setSamplingIntervalMode(e.target.value as 'auto' | 'fixed');
                      if (fieldErrors.interval) setFieldErrors((p) => ({ ...p, interval: '' }));
                    }}
                    className="w-full sm:w-auto h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                  >
                    <option value="auto">Auto-detect from uploaded files</option>
                    <option value="fixed">Fixed Interval (min)</option>
                  </select>
                  {samplingIntervalMode === 'fixed' && (
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={samplingIntervalStr}
                      onChange={(e) => {
                        setSamplingIntervalStr(e.target.value);
                        if (fieldErrors.interval) setFieldErrors((p) => ({ ...p, interval: '' }));
                      }}
                      className="w-full sm:w-28 h-10 px-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc]"
                    />
                  )}
                </div>
                {fieldErrors.interval && (
                  <p className="text-[11px] text-[#bd4d42] font-medium mt-1">{fieldErrors.interval}</p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                  Temperature Limits (°C)
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="any"
                      value={tempLower}
                      onChange={(e) => {
                        setTempLower(e.target.value);
                        if (fieldErrors.tempLimits) setFieldErrors((p) => ({ ...p, tempLimits: '' }));
                      }}
                      placeholder="Min (2.0)"
                      className={`w-full h-10 px-2.5 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc] ${
                        fieldErrors.tempLimits ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155]'
                      }`}
                    />
                    <input
                      type="number"
                      step="any"
                      value={tempUpper}
                      onChange={(e) => {
                        setTempUpper(e.target.value);
                        if (fieldErrors.tempLimits) setFieldErrors((p) => ({ ...p, tempLimits: '' }));
                      }}
                      placeholder="Max (8.0)"
                      className={`w-full h-10 px-2.5 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc] ${
                        fieldErrors.tempLimits ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155]'
                      }`}
                    />
                  </div>
                  {fieldErrors.tempLimits && (
                    <span className="text-[11px] text-[#bd4d42] font-normal mt-1 block">
                      {fieldErrors.tempLimits}
                    </span>
                  )}
                </label>

                {analysisMode === 'temperature_and_humidity' && (
                  <label className="text-xs font-semibold text-[#334052] dark:text-slate-300">
                    RH Limits (%RH)
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="any"
                        value={humidityLower}
                        onChange={(e) => {
                          setHumidityLower(e.target.value);
                          if (fieldErrors.humLimits) setFieldErrors((p) => ({ ...p, humLimits: '' }));
                        }}
                        placeholder="Min (30)"
                        className={`w-full h-10 px-2.5 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc] ${
                          fieldErrors.humLimits ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155]'
                        }`}
                      />
                      <input
                        type="number"
                        step="any"
                        value={humidityUpper}
                        onChange={(e) => {
                          setHumidityUpper(e.target.value);
                          if (fieldErrors.humLimits) setFieldErrors((p) => ({ ...p, humLimits: '' }));
                        }}
                        placeholder="Max (65)"
                        className={`w-full h-10 px-2.5 rounded-lg border bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 tabular-nums focus:outline-none focus:border-[#2864dc] ${
                          fieldErrors.humLimits ? 'border-[#bd4d42]' : 'border-[#dce2ea] dark:border-[#334155]'
                        }`}
                      />
                    </div>
                    {fieldErrors.humLimits && (
                      <span className="text-[11px] text-[#bd4d42] font-normal mt-1 block">
                        {fieldErrors.humLimits}
                      </span>
                    )}
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-[#edf0f4] dark:border-[#334155]">
            <button
              type="button"
              onClick={() => handleGoToStep(2)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] transition-colors cursor-pointer shadow-xs"
            >
              <span>Next: Select Sensors</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* STEP 2: SELECT SENSORS                                            */}
      {/* ================================================================= */}
      {currentStep === 2 && (
        <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#edf0f4] dark:border-[#334155]">
            <div>
              <h2 className="text-base font-bold text-[#182330] dark:text-slate-100">
                Step 2: Select Participating {acquisitionSystem === 'data_logger' ? 'Data Loggers' : 'SuperDAQ Sensors'}
              </h2>
              <p className="text-[11px] text-[#788493] dark:text-slate-400">
                Verify calibration certificate validity before assigning measurement files.
              </p>
            </div>
            <span className="text-xs font-bold text-[#2864dc] dark:text-blue-400 tabular-nums">
              {selectedSensorCodes.length} selected
            </span>
          </div>

          {/* Search & Bulk Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#8896a6] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={sensorSearch}
                onChange={(e) => setSensorSearch(e.target.value)}
                placeholder="Search by code, channel, serial no..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedSensorCodes(candidateSensors.map((c) => c.code))}
                className="flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#2864dc] dark:text-blue-400 hover:bg-[#f5f8ff] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                Select All ({candidateSensors.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedSensorCodes([])}
                className="flex-1 sm:flex-initial min-h-[38px] sm:min-h-0 px-3 py-1.5 rounded-lg border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#647184] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Mobile Sensor Selection List (< md) */}
          <div className="md:hidden border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden max-h-[420px] overflow-y-auto divide-y divide-[#edf0f4] dark:divide-[#334155]">
            {candidateSensors.length > 0 ? (
              candidateSensors.map((c) => {
                const checked = selectedSensorCodes.includes(c.code);
                const dueInfo = getCalibrationDueInfo(c.dueDate);
                return (
                  <div
                    key={c.code}
                    onClick={() =>
                      setSelectedSensorCodes((prev) =>
                        prev.includes(c.code)
                          ? prev.filter((x) => x !== c.code)
                          : [...prev, c.code]
                      )
                    }
                    className={`p-3 cursor-pointer transition-colors space-y-1.5 ${
                      checked
                        ? 'bg-[#f4f8ff] dark:bg-blue-950/30'
                        : 'hover:bg-[#fbfcfe] dark:hover:bg-[#0f172a]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedSensorCodes((prev) =>
                              prev.includes(c.code)
                                ? prev.filter((x) => x !== c.code)
                                : [...prev, c.code]
                            )
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 w-4 h-4 rounded border-[#cbd5e1] text-[#2864dc] focus:ring-[#2864dc]"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#2864dc] dark:text-blue-400">
                            {c.primaryLabel}
                          </div>
                          <div className="text-[11px] text-[#334052] dark:text-slate-200 truncate">
                            {c.secondaryLabel}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tabular-nums ${
                          dueInfo.tier === 'expired'
                            ? 'bg-[#fee2e2] dark:bg-red-950/60 text-[#b91c1c] dark:text-red-300'
                            : dueInfo.tier === 'expiring'
                            ? 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                            : dueInfo.tier === 'valid'
                            ? 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                            : 'bg-[#f1f5f9] dark:bg-slate-800 text-[#647184] dark:text-slate-400'
                        }`}
                      >
                        {dueInfo.badgeText}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#647184] dark:text-slate-400 pl-6 tabular-nums">
                      <span>SN: {c.serialNumber || '—'}</span>
                      <span>
                        {c.tempCount} Temp {c.humCount > 0 ? `/ ${c.humCount} RH` : ''} pts
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-10 text-center text-xs text-[#788493] dark:text-slate-400">
                No matching sensors found.
              </div>
            )}
          </div>

          {/* Desktop Sensor Selection Table (>= md) */}
          <div className="hidden md:block border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-hidden max-h-[380px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
                <tr>
                  <th className="py-2.5 px-3 w-10">Select</th>
                  <th className="py-2.5 px-3">Code / Channel</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Serial No</th>
                  <th className="py-2.5 px-3">Cal Due Status</th>
                  <th className="py-2.5 px-3 text-right">Calibration Curve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                {candidateSensors.length > 0 ? (
                  candidateSensors.map((c) => {
                    const checked = selectedSensorCodes.includes(c.code);
                    const dueInfo = getCalibrationDueInfo(c.dueDate);
                    return (
                      <tr
                        key={c.code}
                        onClick={() =>
                          setSelectedSensorCodes((prev) =>
                            prev.includes(c.code)
                              ? prev.filter((x) => x !== c.code)
                              : [...prev, c.code]
                          )
                        }
                        className={`cursor-pointer transition-colors ${
                          checked
                            ? 'bg-[#f4f8ff] dark:bg-blue-950/30'
                            : 'hover:bg-[#fbfcfe] dark:hover:bg-[#0f172a]/50'
                        }`}
                      >
                        <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedSensorCodes((prev) =>
                                prev.includes(c.code)
                                  ? prev.filter((x) => x !== c.code)
                                  : [...prev, c.code]
                              )
                            }
                            className="rounded border-[#cbd5e1] text-[#2864dc] focus:ring-[#2864dc]"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#2864dc] dark:text-blue-400">
                          {c.primaryLabel}
                        </td>
                        <td className="py-2.5 px-3 text-[#334052] dark:text-slate-200 max-w-[240px] truncate">
                          {c.secondaryLabel}
                        </td>
                        <td className="py-2.5 px-3 text-[#647184] dark:text-slate-400 tabular-nums">
                          {c.serialNumber || '—'}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${
                              dueInfo.tier === 'expired'
                                ? 'bg-[#fee2e2] dark:bg-red-950/60 text-[#b91c1c] dark:text-red-300'
                                : dueInfo.tier === 'expiring'
                                ? 'bg-[#fef3c7] dark:bg-amber-950/60 text-[#b45309] dark:text-amber-300'
                                : dueInfo.tier === 'valid'
                                ? 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300'
                                : 'bg-[#f1f5f9] dark:bg-slate-800 text-[#647184] dark:text-slate-400'
                            }`}
                          >
                            {dueInfo.formattedDate} · {dueInfo.badgeText}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[11px] text-[#526071] dark:text-slate-300">
                          {c.tempCount} Temp {c.humCount > 0 ? `/ ${c.humCount} RH` : ''} pts
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[#788493] dark:text-slate-400">
                      No matching sensors found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {hasExpiredSelectedOrAssigned && (
            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[#fff0ed] dark:bg-red-950/30 border border-[#fed7d0] dark:border-red-900 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmExpired}
                onChange={(e) => setConfirmExpired(e.target.checked)}
                className="rounded text-[#bd4d42] focus:ring-[#bd4d42]"
              />
              <span className="text-xs font-medium text-[#913b32] dark:text-red-300">
                One or more selected sensors have expired calibration certificates. I confirm authorized study execution.
              </span>
            </label>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-0 pt-3 border-t border-[#edf0f4] dark:border-[#334155]">
            <button
              type="button"
              onClick={() => handleGoToStep(1)}
              className="w-full sm:w-auto min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#526071] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back to Setup</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (validateStep2()) setCurrentStep(3);
              }}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-semibold hover:bg-[#1e4fae] transition-colors cursor-pointer shadow-xs"
            >
              <span>Next: Upload Data</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* STEP 3: UPLOAD DATA & SENSOR MAPPING                              */}
      {/* ================================================================= */}
      {currentStep === 3 && (
        <section className="bg-white dark:bg-[#1e293b] rounded-xl border border-[#e5e9ef] dark:border-[#334155] p-4 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#edf0f4] dark:border-[#334155]">
            <div>
              <h2 className="text-base font-bold text-[#182330] dark:text-slate-100">
                Step 3: Data File Upload & Channel Mapping
              </h2>
              <p className="text-[11px] text-[#788493] dark:text-slate-400 tabular-nums">
                Study Window: {formatDateTimeDDMMYYYY(new Date(startStr))} – {formatDateTimeDDMMYYYY(new Date(endStr))}
                {' '}· Limits: {tempLower}°C to {tempUpper}°C
              </p>
            </div>
            <span className="text-xs font-semibold text-[#5275ad] dark:text-blue-400 tabular-nums">
              {assignedRows.length} source channel(s) loaded
            </span>
          </div>

          {/* Dropzone */}
          <label className="flex flex-col items-center justify-center text-center p-5 sm:p-6 border-2 border-dashed border-[#dce2ea] dark:border-[#334155] hover:border-[#2864dc] rounded-xl bg-[#fafbfd] dark:bg-[#0f172a] cursor-pointer transition-colors group">
            <UploadCloud className="w-8 h-8 text-[#788493] group-hover:text-[#2864dc] transition-colors" />
            <span className="text-xs font-semibold text-[#182330] dark:text-slate-100 mt-2">
              Tap or drag Excel workbooks here
            </span>
            <span className="text-[11px] text-[#788493] dark:text-slate-400 mt-0.5">
              Supported formats: .xls, .xlsx ({acquisitionSystem === 'data_logger' ? 'Data Logger exports' : 'Fluke SuperDAQ dat workbooks'})
            </span>
            <input
              type="file"
              multiple
              accept=".xls, .xlsx"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {/* Mobile Assignment Cards (< md) */}
          <div className="md:hidden space-y-2.5">
            {assignedRows.length > 0 ? (
              assignedRows.map((row, idx) => {
                const assignedEq =
                  acquisitionSystem === 'data_logger'
                    ? equipment.find((e) => e.equipment_code === row.assignedCode)
                    : null;
                const assignedSensor =
                  acquisitionSystem === 'fluke_superdaq'
                    ? sensors.find((s) => s.sensor_code === row.assignedCode)
                    : null;
                const isExpired =
                  acquisitionSystem === 'data_logger'
                    ? assignedEq?.due_date
                      ? isRecordExpired(assignedEq.due_date)
                      : false
                    : assignedSensor?.due_date
                    ? isRecordExpired(assignedSensor.due_date)
                    : false;

                return (
                  <div
                    key={row.id}
                    className="p-3.5 rounded-xl border border-[#e5e9ef] dark:border-[#334155] bg-[#fafbfd] dark:bg-[#0f172a]/60 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#182330] dark:text-slate-100">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-[#2864dc] shrink-0" />
                          <span className="truncate">{row.sourceLabel}</span>
                        </div>
                        <p className="text-[11px] text-[#647184] dark:text-slate-400 mt-0.5">
                          {row.formatName}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAssignedRows(assignedRows.filter((_, i) => i !== idx))}
                        className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-[#bd4d42] bg-[#fff0ed] dark:bg-red-950/40 rounded-lg p-1.5 cursor-pointer shrink-0"
                        title="Remove channel"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f5ed] dark:bg-emerald-950/60 text-[#32704d] dark:text-emerald-300 tabular-nums">
                        {row.readings.length} readings
                      </span>
                      {isExpired && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] dark:text-red-300">
                          Certificate Expired
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#647184] dark:text-slate-400 mb-1">
                        Assigned Registry Record
                      </span>
                      {acquisitionSystem === 'data_logger' ? (
                        <select
                          value={row.assignedCode}
                          onChange={(e) => {
                            const updated = [...assignedRows];
                            updated[idx] = { ...updated[idx], assignedCode: e.target.value };
                            setAssignedRows(updated);
                          }}
                          className="w-full h-10 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                        >
                          <option value="">Select Data Logger</option>
                          {equipment.map((eq) => (
                            <option key={eq.equipment_code} value={eq.equipment_code}>
                              {eq.equipment_code} — {eq.description}
                              {selectedSensorCodes.includes(eq.equipment_code) ? ' (Selected)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={row.assignedCode}
                          onChange={(e) => {
                            const updated = [...assignedRows];
                            updated[idx] = { ...updated[idx], assignedCode: e.target.value };
                            setAssignedRows(updated);
                          }}
                          className="w-full h-10 px-2.5 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                        >
                          <option value="">Select SuperDAQ Sensor</option>
                          {sensors
                            .filter(
                              (s) =>
                                s.kit_code.trim().toUpperCase() === selectedKitCode.trim().toUpperCase() ||
                                s.kit_code === selectedKitCode
                            )
                            .map((s) => (
                              <option key={s.sensor_code} value={s.sensor_code}>
                                {s.channel_identifier} — {s.name} (SN: {s.serial_number})
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="border border-[#e5e9ef] dark:border-[#334155] rounded-xl py-8 px-4 text-center text-xs text-[#788493] dark:text-slate-400">
                No measurement files loaded yet. Tap above to upload Excel workbooks.
              </div>
            )}
          </div>

          {/* Desktop Assignment Table (>= md) */}
          <div className="hidden md:block border border-[#e5e9ef] dark:border-[#334155] rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8f9fb] dark:bg-[#0f172a] text-[#334155] dark:text-slate-300 uppercase text-[10px] font-bold tracking-wider border-b border-[#e5e9ef] dark:border-[#334155]">
                <tr>
                  <th className="py-2.5 px-3">File / Channel</th>
                  <th className="py-2.5 px-3">Detected Format</th>
                  <th className="py-2.5 px-3">Readings & Cal Status</th>
                  <th className="py-2.5 px-3">Assigned Registry Record</th>
                  <th className="py-2.5 px-3 w-12 text-center">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f4] dark:divide-[#334155]">
                {assignedRows.length > 0 ? (
                  assignedRows.map((row, idx) => {
                    const assignedEq =
                      acquisitionSystem === 'data_logger'
                        ? equipment.find((e) => e.equipment_code === row.assignedCode)
                        : null;
                    const assignedSensor =
                      acquisitionSystem === 'fluke_superdaq'
                        ? sensors.find((s) => s.sensor_code === row.assignedCode)
                        : null;
                    const isExpired =
                      acquisitionSystem === 'data_logger'
                        ? assignedEq?.due_date
                          ? isRecordExpired(assignedEq.due_date)
                          : false
                        : assignedSensor?.due_date
                        ? isRecordExpired(assignedSensor.due_date)
                        : false;

                    return (
                      <tr key={row.id} className="hover:bg-[#fbfcfe] dark:hover:bg-[#0f172a]/50">
                        <td className="py-2.5 px-3 font-semibold text-[#182330] dark:text-slate-100">
                          <div className="flex items-center gap-1.5">
                            <FileSpreadsheet className="w-3.5 h-3.5 text-[#2864dc] shrink-0" />
                            <span>{row.sourceLabel}</span>
                          </div>
                          {row.notes && (
                            <p className="text-[10px] text-[#788493] dark:text-slate-400 font-normal mt-0.5">
                              {row.notes}
                            </p>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[#526071] dark:text-slate-300 text-[11px]">
                          {row.formatName}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#e8f5ed] dark:bg-emerald-950/60 text-[#32704d] dark:text-emerald-300 tabular-nums">
                            {row.readings.length} readings
                          </span>
                          {isExpired && (
                            <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fff0ed] dark:bg-red-950/60 text-[#bd4d42] dark:text-red-300">
                              Certificate Expired
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {acquisitionSystem === 'data_logger' ? (
                            <select
                              value={row.assignedCode}
                              onChange={(e) => {
                                const updated = [...assignedRows];
                                updated[idx] = { ...updated[idx], assignedCode: e.target.value };
                                setAssignedRows(updated);
                              }}
                              className="w-full h-8 px-2 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                            >
                              <option value="">Select Data Logger</option>
                              {equipment.map((eq) => (
                                <option key={eq.equipment_code} value={eq.equipment_code}>
                                  {eq.equipment_code} — {eq.description}
                                  {selectedSensorCodes.includes(eq.equipment_code) ? ' (Selected)' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <select
                              value={row.assignedCode}
                              onChange={(e) => {
                                const updated = [...assignedRows];
                                updated[idx] = { ...updated[idx], assignedCode: e.target.value };
                                setAssignedRows(updated);
                              }}
                              className="w-full h-8 px-2 rounded-lg border border-[#dce2ea] dark:border-[#334155] bg-white dark:bg-[#0f172a] text-xs text-[#182330] dark:text-slate-100 focus:outline-none focus:border-[#2864dc]"
                            >
                              <option value="">Select SuperDAQ Sensor</option>
                              {sensors
                                .filter(
                                  (s) =>
                                    s.kit_code.trim().toUpperCase() === selectedKitCode.trim().toUpperCase() ||
                                    s.kit_code === selectedKitCode
                                )
                                .map((s) => (
                                  <option key={s.sensor_code} value={s.sensor_code}>
                                    {s.channel_identifier} — {s.name} (SN: {s.serial_number})
                                  </option>
                                ))}
                            </select>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setAssignedRows(assignedRows.filter((_, i) => i !== idx))}
                            className="text-[#bd4d42] hover:bg-[#fff0ed] dark:hover:bg-red-950/40 rounded p-1 cursor-pointer"
                            title="Remove channel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-[#788493] dark:text-slate-400">
                      No measurement files loaded yet. Upload files above or use the sample dataset shortcuts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmExpired}
              onChange={(e) => setConfirmExpired(e.target.checked)}
              className="rounded text-[#2864dc] focus:ring-[#2864dc]"
            />
            <span className="text-xs text-[#526071] dark:text-slate-300">
              Acknowledge review of calibration certificate validity for all assigned instruments.
            </span>
          </label>

          {/* Navigation & Run Bar */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 pt-3 border-t border-[#edf0f4] dark:border-[#334155]">
            <button
              type="button"
              onClick={() => handleGoToStep(2)}
              className="w-full sm:w-auto min-h-[42px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-[#dce4ef] dark:border-[#334155] text-xs font-semibold text-[#526071] dark:text-slate-300 hover:bg-[#f5f7fa] dark:hover:bg-[#0f172a] cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back to Select Sensors</span>
            </button>

            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={loading || assignedRows.length === 0}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#2864dc] text-white text-xs font-bold hover:bg-[#1e4fae] disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Run Analysis & View Results</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
