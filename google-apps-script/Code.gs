/**
 * ============================================================================
 * Jordan National Metrology Institute (JNMI) & Royal Scientific Society (RSS)
 * Thermal Mapping Analysis - Google Sheets Master Database & Live Sync Script
 * ============================================================================
 * 
 * Instructions to enable Live 2-Way Synchronization (Read & Write):
 * 1. In your Google Spreadsheet, click: Extensions -> Apps Script
 * 2. Delete existing code, paste this entire script into Code.gs, and click Save (Ctrl+S).
 * 3. Click: Deploy -> New Deployment
 *    - Select type: Web App
 *    - Description: Thermal Mapping Master DB API
 *    - Execute as: Me (your Google account)
 *    - Who has access: Anyone (allows applet to save/update/delete)
 * 4. Click "Deploy", copy the Web App URL (ends with /exec), and paste it into
 *    the "Application Settings" in your Thermal Mapping app.
 * 5. Ensure sheet access is: Share -> General access -> "Anyone with the link – Editor" (or Viewer if using Web App)
 */

/**
 * Automatically creates custom menu on spreadsheet open
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔬 Thermal Mapping JNMI')
    .addItem('1. Initialize Standard Sheets & Headers', 'initializeMasterSheets')
    .addItem('2. Populate Sample Lab Baseline Data', 'populateSampleData')
    .addSeparator()
    .addItem('3. Validate Calibration Data & Dates', 'validateMasterData')
    .addItem('4. Get Applet Connection Link (GViz CSV)', 'showConnectionInfo')
    .addItem('5. Setup Live 2-Way Web App API', 'showWebAppInstructions')
    .addToUi();
}

/**
 * Helper: Find sheet by candidate names (supports both spaces and underscores)
 */
function findSheet(ss, candidateNames) {
  for (var i = 0; i < candidateNames.length; i++) {
    var sh = ss.getSheetByName(candidateNames[i]);
    if (sh) return sh;
  }
  return null;
}

/**
 * Helper: Find column index by candidate header names (0-indexed)
 */
function findColIndex(headers, candidateNames) {
  var normCandidates = candidateNames.map(function(c) {
    return String(c).toLowerCase().replace(/[^a-z0-9]/g, '');
  });
  for (var i = 0; i < headers.length; i++) {
    var normHeader = String(headers[i] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (var j = 0; j < normCandidates.length; j++) {
      if (normHeader === normCandidates[j]) return i;
    }
  }
  return -1;
}

/**
 * Normalizes ISO YYYY-MM-DD or standard Date to DD/MM/YYYY for laboratory display
 */
function formatToSheetDate(dateStr) {
  if (!dateStr) return '';
  var str = String(dateStr).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return str;
  var parts = str.split(/[-/]/);
  if (parts.length === 3 && parts[0].length === 4) {
    return parts[2].padStart(2, '0') + '/' + parts[1].padStart(2, '0') + '/' + parts[0];
  }
  var d = new Date(str);
  if (!isNaN(d.getTime())) {
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    return day + '/' + month + '/' + d.getFullYear();
  }
  return str;
}

/**
 * 1. Sets up the required sheets with styled header rows, frozen rows, and formatting
 */
function initializeMasterSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var sheetDefinitions = [
    {
      name: 'Data Loggers',
      headers: [
        'Instrument Description',
        'Equipment Code',
        'Serial Number',
        'Manufacturer',
        'Traceability',
        'Calibration Date',
        'Calibration Due Date',
        'Notes'
      ],
      colWidths: [220, 140, 150, 140, 140, 130, 140, 220]
    },
    {
      name: 'Data loggers corrections',
      headers: [
        'Equipment Code',
        'Measurement Type',
        'Indication',
        'Correction',
        'Unit'
      ],
      colWidths: [140, 150, 120, 120, 90]
    },
    {
      name: 'Super DAQ',
      headers: [
        'Kit Name / Description',
        'Kit Serial Number',
        'Sensor Name',
        'Serial Number',
        'Sensor Code',
        'SuperDAQ Channel Identifier',
        'Calibration Date',
        'Calibration Due Date',
        'Traceability'
      ],
      colWidths: [220, 150, 200, 120, 140, 160, 130, 140, 140]
    },
    {
      name: 'Super DAQ corrections',
      headers: [
        'Kit Name / Description',
        'SuperDAQ Channel Identifier',
        'Indication (°C)',
        'Correction (°C)'
      ],
      colWidths: [240, 180, 130, 130]
    },
    {
      name: 'Sensor Kits',
      headers: [
        'Kit Serial Number',
        'Kit Name',
        'Status',
        'Notes'
      ],
      colWidths: [160, 260, 110, 240]
    },
    {
      name: 'Settings',
      headers: [
        'Setting Key',
        'Setting Value'
      ],
      colWidths: [220, 320]
    }
  ];

  sheetDefinitions.forEach(function (def) {
    var sh = findSheet(ss, [def.name, def.name.replace(/\s+/g, '_')]);
    if (!sh) {
      sh = ss.insertSheet(def.name);
    }
    var currentRows = sh.getLastRow();
    if (currentRows === 0) {
      sh.appendRow(def.headers);
      var headerRange = sh.getRange(1, 1, 1, def.headers.length);
      headerRange.setBackground('#1f4b8f');
      headerRange.setFontColor('#ffffff');
      headerRange.setFontWeight('bold');
      headerRange.setHorizontalAlignment('center');
      sh.setFrozenRows(1);
    }
  });

  ui.alert('Setup Complete', 'All standard worksheets have been initialized.', ui.ButtonSet.OK);
}

/**
 * 2. Populates sample baseline data
 */
function populateSampleData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  var confirm = ui.alert(
    'Populate Sample Data?',
    'This will insert initial baseline records (DL001, DL002, and SuperDAQ Kit with calibration points).',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var dlSheet = findSheet(ss, ['Data Loggers', 'Data_Loggers']);
  if (dlSheet && dlSheet.getLastRow() <= 1) {
    dlSheet.appendRow(['Data Logger (DL001)', 'DL001', '84435686', 'Testo', 'UME/Turkey', '01/01/2026', '01/01/2028', 'Cold storage primary']);
    dlSheet.appendRow(['Data Logger (DL002)', 'DL002', '84433070', 'Testo', 'UME/Turkey', '01/01/2026', '01/01/2028', 'Cold storage secondary']);
  }

  ui.alert('Sample Data Populated', 'Baseline records have been inserted.', ui.ButtonSet.OK);
}

/**
 * 3. Metrological data integrity validation check
 */
function validateMasterData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var issues = [];

  var dlSheet = findSheet(ss, ['Data Loggers', 'Data_Loggers']);
  if (dlSheet) {
    var data = dlSheet.getDataRange().getValues();
    if (data.length > 1) {
      var headers = data[0];
      var codeIdx = findColIndex(headers, ['equipment_code', 'equipment code', 'code']);
      var dueIdx = findColIndex(headers, ['calibration_due_date', 'due date', 'due_date']);
      for (var r = 1; r < data.length; r++) {
        var code = data[r][codeIdx];
        var dueStr = data[r][dueIdx];
        if (!code) continue;
        if (!dueStr) {
          issues.push('Row ' + (r + 1) + ' (' + code + '): Missing Calibration Due Date.');
        }
      }
    }
  }

  if (issues.length === 0) {
    ui.alert('Validation Passed', 'All data logger records and calibration dates are valid.', ui.ButtonSet.OK);
  } else {
    ui.alert('Validation Warnings (' + issues.length + ')', issues.slice(0, 10).join('\n'), ui.ButtonSet.OK);
  }
}

/**
 * 4. Shows connection parameters dialog
 */
function showConnectionInfo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var id = ss.getId();
  var ui = SpreadsheetApp.getUi();

  var htmlOutput = HtmlService.createHtmlOutput(
    '<div style="font-family: Arial, sans-serif; padding: 15px; color: #182330;">' +
    '<h3 style="margin-top:0; color: #1f4b8f;">Thermal Mapping Connection Parameters</h3>' +
    '<p>Spreadsheet ID:</p>' +
    '<div style="background: #f0f4fb; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 13px; font-weight: bold; border: 1px solid #d2dff2;">' + id + '</div>' +
    '<p style="margin-top: 15px; font-size: 12px; color: #526071;">Ensure <strong>Share</strong> is set to <strong>"Anyone with the link – Viewer"</strong> (or Editor for 2-way sync).</p>' +
    '</div>'
  ).setWidth(500).setHeight(260);

  ui.showModalDialog(htmlOutput, 'Google Sheets Connection Link');
}

/**
 * 5. Shows instructions for setting up 2-way Web App API
 */
function showWebAppInstructions() {
  var ui = SpreadsheetApp.getUi();
  var htmlOutput = HtmlService.createHtmlOutput(
    '<div style="font-family: Arial, sans-serif; padding: 15px; color: #182330; line-height: 1.5;">' +
    '<h3 style="margin-top:0; color: #1f4b8f;">Enable 2-Way Real-Time Database Sync</h3>' +
    '<ol style="font-size: 12px; padding-left: 20px;">' +
    '<li>Click <strong>Deploy &rarr; New Deployment</strong> (top right).</li>' +
    '<li>Choose <strong>Web app</strong> as the type.</li>' +
    '<li>Set <strong>Execute as:</strong> <em>Me</em>.</li>' +
    '<li>Set <strong>Who has access:</strong> <em>Anyone</em>.</li>' +
    '<li>Click <strong>Deploy</strong> and copy the generated <strong>Web app URL</strong> (ending in <code>/exec</code>).</li>' +
    '<li>Paste that URL into the <strong>Application Settings</strong> in the Thermal Mapping app!</li>' +
    '</ol>' +
    '<p style="font-size: 11px; color: #059669; font-weight: bold;">Any devices, edits, calibrations, or deletions in the app will now automatically save directly into this Google Sheet!</p>' +
    '</div>'
  ).setWidth(520).setHeight(320);

  ui.showModalDialog(htmlOutput, '2-Way Google Sheets API Deployment');
}

/**
 * ============================================================================
 * 6. Live 2-Way Web App Endpoints: doPost & doGet
 * ============================================================================
 */
function doPost(e) {
  var result;
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }
    result = handleSheetMutation(payload);
  } catch (err) {
    result = { status: 'error', message: err.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = e && e.parameter && e.parameter.action ? e.parameter.action : 'info';

  if (action === 'save_equipment' || action === 'delete_equipment' || action === 'save_kit' || action === 'delete_kit' || action === 'save_sensor' || action === 'delete_sensor') {
    var payload = {};
    if (e.parameter.payload) {
      try {
        payload = JSON.parse(e.parameter.payload);
      } catch (err) {
        payload = e.parameter;
      }
    } else {
      payload = e.parameter;
    }
    payload.action = action;
    var res = handleSheetMutation(payload);
    return ContentService.createTextOutput(JSON.stringify(res))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'info') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var infoObj = {
      status: 'success',
      spreadsheetId: ss.getId(),
      spreadsheetName: ss.getName(),
      spreadsheetUrl: ss.getUrl()
    };
    return ContentService.createTextOutput(JSON.stringify(infoObj))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify(exportAllMasterDataAsJson()))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Core Router for In-Sheet Mutations (Add, Edit, Delete)
 */
function handleSheetMutation(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = payload.action;

  if (action === 'save_equipment') {
    return saveEquipmentRecord(ss, payload.record);
  }
  if (action === 'delete_equipment') {
    return deleteEquipmentRecord(ss, payload.equipment_code || payload.code);
  }
  if (action === 'save_kit') {
    return saveKitRecord(ss, payload.kit);
  }
  if (action === 'delete_kit') {
    return deleteKitRecord(ss, payload.kit_code || payload.kitCode, payload.serial_number, payload.kit_name || payload.name);
  }
  if (action === 'save_sensor') {
    return saveSensorRecord(ss, payload.sensor);
  }
  if (action === 'delete_sensor') {
    return deleteSensorRecord(ss, payload.sensor_code || payload.sensorCode, payload.channel_identifier, payload.kit_name);
  }

  return { status: 'error', message: 'Unknown action: ' + action };
}

/**
 * Saves (Inserts or Updates) a Data Logger record and its calibration points
 */
function saveEquipmentRecord(ss, rec) {
  if (!rec || !rec.equipment_code) {
    return { status: 'error', message: 'Equipment code is required' };
  }

  var code = String(rec.equipment_code).trim().toUpperCase();
  var dlSheet = findSheet(ss, ['Data Loggers', 'Data_Loggers']);
  if (!dlSheet) {
    dlSheet = ss.insertSheet('Data Loggers');
    dlSheet.appendRow(['Instrument Description', 'Equipment Code', 'Serial Number', 'Manufacturer', 'Traceability', 'Calibration Date', 'Calibration Due Date', 'Notes']);
  }

  var data = dlSheet.getDataRange().getValues();
  var headers = data[0] || ['Instrument Description', 'Equipment Code', 'Serial Number', 'Manufacturer', 'Traceability', 'Calibration Date', 'Calibration Due Date', 'Notes'];
  var codeIdx = findColIndex(headers, ['equipment_code', 'equipment code', 'code']);
  if (codeIdx === -1) codeIdx = 1;

  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][codeIdx]).trim().toUpperCase() === code) {
      rowIndex = r + 1; // 1-based row index
      break;
    }
  }

  var desc = rec.description || ('Data Logger (' + code + ')');
  var sn = rec.serial_number || '';
  var mfg = rec.manufacturer || 'Testo';
  var trace = rec.traceability || 'UME/Turkey';
  var calDate = formatToSheetDate(rec.calibration_date);
  var dueDate = formatToSheetDate(rec.due_date);
  var notes = rec.notes || 'Updated from Thermal Mapping application';

  var rowValues = [desc, code, sn, mfg, trace, calDate, dueDate, notes];

  if (rowIndex > 0) {
    dlSheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    dlSheet.appendRow(rowValues);
  }

  // Update calibration points in Data loggers corrections if provided
  if (rec.temperature_points || rec.humidity_points) {
    saveLoggerCorrections(ss, code, rec.temperature_points || [], rec.humidity_points || []);
  }

  return {
    status: 'success',
    message: 'Equipment ' + code + ' saved successfully into Google Sheet',
    equipment_code: code
  };
}

/**
 * Saves calibration correction points for a data logger
 */
function saveLoggerCorrections(ss, code, tempPoints, humPoints) {
  var dlcSheet = findSheet(ss, ['Data loggers corrections', 'Data_Logger_Corrections', 'DataLoggerCorrections']);
  if (!dlcSheet) return;

  var data = dlcSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var headers = data[0];
  var codeIdx = findColIndex(headers, ['equipment_code', 'equipment code', 'code']);

  // If normalized table with Equipment_Code column
  if (codeIdx !== -1) {
    // Delete existing rows for this equipment
    for (var r = data.length - 1; r >= 1; r--) {
      if (String(data[r][codeIdx]).trim().toUpperCase() === code) {
        dlcSheet.deleteRow(r + 1);
      }
    }
    // Append new temperature points
    for (var t = 0; t < tempPoints.length; t++) {
      dlcSheet.appendRow([code, 'Temperature', tempPoints[t].indication, tempPoints[t].correction, 'C']);
    }
    // Append new humidity points
    for (var h = 0; h < humPoints.length; h++) {
      dlcSheet.appendRow([code, 'Humidity', humPoints[h].indication, humPoints[h].correction, '%RH']);
    }
  } else {
    // Exact format of the live sheet: Column 1 is "Data Logger - DL001 - (-20 C)", Column 2 is correction
    for (var r = data.length - 1; r >= 1; r--) {
      var cell0 = String(data[r][0] || '').trim();
      if (cell0.indexOf(' - ' + code + ' - ') !== -1 || cell0.indexOf(code) !== -1) {
        dlcSheet.deleteRow(r + 1);
      }
    }
    for (var t = 0; t < tempPoints.length; t++) {
      var indStr = tempPoints[t].indication >= 0 ? (' ' + tempPoints[t].indication) : String(tempPoints[t].indication);
      dlcSheet.appendRow(['Data Logger - ' + code + ' - (' + indStr + ' C)', tempPoints[t].correction]);
    }
    for (var h = 0; h < humPoints.length; h++) {
      var hIndStr = humPoints[h].indication >= 0 ? (' ' + humPoints[h].indication) : String(humPoints[h].indication);
      dlcSheet.appendRow(['Data Logger - ' + code + ' - (' + hIndStr + ' %RH)', humPoints[h].correction]);
    }
  }
}

/**
 * Deletes a Data Logger record and its calibration points
 */
function deleteEquipmentRecord(ss, rawCode) {
  if (!rawCode) return { status: 'error', message: 'No equipment code provided' };
  var code = String(rawCode).trim().toUpperCase();

  var dlSheet = findSheet(ss, ['Data Loggers', 'Data_Loggers']);
  var deleted = false;

  if (dlSheet) {
    var data = dlSheet.getDataRange().getValues();
    var headers = data[0];
    var codeIdx = findColIndex(headers, ['equipment_code', 'equipment code', 'code']);
    if (codeIdx === -1) codeIdx = 1;

    for (var r = data.length - 1; r >= 1; r--) {
      if (String(data[r][codeIdx]).trim().toUpperCase() === code) {
        dlSheet.deleteRow(r + 1);
        deleted = true;
      }
    }
  }

  // Also remove from Data loggers corrections
  var dlcSheet = findSheet(ss, ['Data loggers corrections', 'Data_Logger_Corrections']);
  if (dlcSheet) {
    var cData = dlcSheet.getDataRange().getValues();
    var cHeaders = cData[0];
    var cCodeIdx = findColIndex(cHeaders, ['equipment_code', 'equipment code', 'code']);
    if (cCodeIdx !== -1) {
      for (var cr = cData.length - 1; cr >= 1; cr--) {
        if (String(cData[cr][cCodeIdx]).trim().toUpperCase() === code) {
          dlcSheet.deleteRow(cr + 1);
        }
      }
    } else {
      for (var cr = cData.length - 1; cr >= 1; cr--) {
        var cell0 = String(cData[cr][0] || '').trim();
        if (cell0.indexOf(' - ' + code + ' - ') !== -1 || cell0.indexOf(code) !== -1) {
          dlcSheet.deleteRow(cr + 1);
        }
      }
    }
  }

  return {
    status: 'success',
    message: deleted ? ('Equipment ' + code + ' deleted from Google Sheet') : ('Equipment ' + code + ' was not found in sheet')
  };
}

/**
 * Saves a SuperDAQ Sensor Kit
 */
function saveKitRecord(ss, kit) {
  if (!kit) return { status: 'error', message: 'No kit data provided' };
  var sn = String(kit.serial_number || kit.kit_code || '').replace(/^KIT_/, '').trim();
  var name = kit.name || 'Super DAQ System with PT100 Sensors';
  var status = kit.status || 'Active';
  var notes = kit.notes || 'Updated from Thermal Mapping application';

  var kitSheet = findSheet(ss, ['Sensor Kits', 'Sensor_Kits']);
  if (kitSheet) {
    var data = kitSheet.getDataRange().getValues();
    var headers = data[0];
    var snIdx = findColIndex(headers, ['kit_serial_number', 'kit serial number', 'serial_number']);
    if (snIdx === -1) snIdx = 0;

    var rowIndex = -1;
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][snIdx]).trim() === sn) {
        rowIndex = r + 1;
        break;
      }
    }
    if (rowIndex > 0) {
      kitSheet.getRange(rowIndex, 1, 1, 4).setValues([[sn, name, status, notes]]);
    } else {
      kitSheet.appendRow([sn, name, status, notes]);
    }
  }

  // Also ensure rows in Super DAQ sheet carry the new kit name if matching serial number
  var sdqSheet = findSheet(ss, ['Super DAQ', 'SuperDAQ', 'SuperDAQ_Sensors']);
  if (sdqSheet && sn) {
    var sData = sdqSheet.getDataRange().getValues();
    var sHeaders = sData[0];
    var sSnIdx = findColIndex(sHeaders, ['kit_serial_number', 'kit serial number', 'kit serial']);
    var sNameIdx = findColIndex(sHeaders, ['kit_name', 'kit name / description', 'kit description']);
    if (sSnIdx !== -1 && sNameIdx !== -1) {
      for (var sr = 1; sr < sData.length; sr++) {
        if (String(sData[sr][sSnIdx]).trim() === sn) {
          sdqSheet.getRange(sr + 1, sNameIdx + 1).setValue(name);
        }
      }
    }
  }

  return { status: 'success', message: 'Kit ' + (sn || name) + ' saved successfully into Google Sheet' };
}

/**
 * Deletes a SuperDAQ Sensor Kit and its sensors
 */
function deleteKitRecord(ss, kitCode, rawSn, kitName) {
  var sn = String(rawSn || kitCode || '').replace(/^KIT_/, '').trim();
  var name = String(kitName || '').trim();

  // 1. Delete from Sensor Kits
  var kitSheet = findSheet(ss, ['Sensor Kits', 'Sensor_Kits']);
  if (kitSheet) {
    var data = kitSheet.getDataRange().getValues();
    var headers = data[0];
    var snIdx = findColIndex(headers, ['kit_serial_number', 'kit serial number', 'serial_number']);
    var nameIdx = findColIndex(headers, ['kit_name', 'kit name / description', 'kit description']);

    for (var r = data.length - 1; r >= 1; r--) {
      var matchSn = sn && snIdx !== -1 && String(data[r][snIdx]).trim() === sn;
      var matchName = name && nameIdx !== -1 && String(data[r][nameIdx]).trim().toLowerCase() === name.toLowerCase();
      var matchCode = kitCode && String(data[r][0] || '').trim().indexOf(kitCode) !== -1;
      if (matchSn || matchName || matchCode) {
        kitSheet.deleteRow(r + 1);
      }
    }
  }

  // 2. Delete sensors from Super DAQ
  var sdqSheet = findSheet(ss, ['Super DAQ', 'SuperDAQ_Sensors']);
  if (sdqSheet) {
    var sData = sdqSheet.getDataRange().getValues();
    var sHeaders = sData[0];
    var sNameIdx = findColIndex(sHeaders, ['kit_name', 'kit name / description', 'kit description']);
    var sSnIdx = findColIndex(sHeaders, ['kit_serial_number', 'kit serial number', 'kit serial']);

    for (var sr = sData.length - 1; sr >= 1; sr--) {
      var sMatchName = name && sNameIdx !== -1 && String(sData[sr][sNameIdx]).trim().toLowerCase() === name.toLowerCase();
      var sMatchSn = sn && sSnIdx !== -1 && String(sData[sr][sSnIdx]).trim() === sn;
      if (sMatchName || sMatchSn) {
        sdqSheet.deleteRow(sr + 1);
      }
    }
  }

  // 3. Delete calibration points from Super DAQ corrections
  var sdqcSheet = findSheet(ss, ['Super DAQ corrections', 'SuperDAQ_Corrections']);
  if (sdqcSheet) {
    var cData = sdqcSheet.getDataRange().getValues();
    var cHeaders = cData[0];
    var cNameIdx = findColIndex(cHeaders, ['kit_name', 'kit name / description', 'kit description']);
    if (cNameIdx === -1) cNameIdx = 0;

    for (var cr = cData.length - 1; cr >= 1; cr--) {
      var cMatchName = name && String(cData[cr][cNameIdx] || '').trim().toLowerCase() === name.toLowerCase();
      var cMatchSn = sn && String(cData[cr][0] || '').trim() === sn;
      var cMatchCode = kitCode && String(cData[cr][0] || '').trim().indexOf(kitCode) !== -1;
      if (cMatchName || cMatchSn || cMatchCode) {
        sdqcSheet.deleteRow(cr + 1);
      }
    }
  }

  return { status: 'success', message: 'SuperDAQ Kit ' + (name || sn) + ' and its corrections deleted from Google Sheet' };
}

/**
 * Saves a SuperDAQ PT100 Sensor
 */
function saveSensorRecord(ss, sensor) {
  if (!sensor) return { status: 'error', message: 'No sensor data provided' };
  var sdqSheet = findSheet(ss, ['Super DAQ', 'SuperDAQ_Sensors', 'SuperDAQ']);
  if (!sdqSheet) return { status: 'error', message: 'Super DAQ worksheet not found' };

  var kitSn = String(sensor.kit_serial_number || sensor.kit_code || '44070036').replace(/^KIT_/, '').trim();
  var chId = sensor.channel_identifier || 'Ch 101 (C)';
  var name = sensor.name || 'Resistance Thermometer (PT 100)';
  var sn = sensor.serial_number || '';
  var sCode = sensor.sensor_code || chId;
  var calDate = formatToSheetDate(sensor.calibration_date);
  var dueDate = formatToSheetDate(sensor.due_date);
  var trace = sensor.traceability || 'UME/Turkey';

  var data = sdqSheet.getDataRange().getValues();
  var headers = data[0];
  var chIdx = findColIndex(headers, ['channel_identifier', 'superdaq channel identifier', 'channel']);
  var kitSnIdx = findColIndex(headers, ['kit_serial_number', 'kit serial number', 'kit serial']);

  var rowIndex = -1;
  for (var r = 1; r < data.length; r++) {
    var matchCh = chIdx !== -1 && String(data[r][chIdx]).trim().toLowerCase() === chId.toLowerCase();
    var matchKit = kitSnIdx === -1 || !kitSn || String(data[r][kitSnIdx]).trim() === kitSn;
    if (matchCh && matchKit) {
      rowIndex = r + 1;
      break;
    }
  }

  var kitName = sensor.kit_name || 'Super DAQ System with PT100 Sensors';
  var rowVals = [kitName, kitSn, name, sn, sCode, chId, calDate, dueDate, trace];
  if (rowIndex > 0) {
    sdqSheet.getRange(rowIndex, 1, 1, rowVals.length).setValues([rowVals]);
  } else {
    sdqSheet.appendRow(rowVals);
  }

  // Update calibration points in Super DAQ corrections using Kit Name / Description
  if (sensor.temperature_points && Array.isArray(sensor.temperature_points)) {
    saveSuperDaqSensorCorrections(ss, kitName, chId, sensor.temperature_points);
  }

  return { status: 'success', message: 'Sensor ' + chId + ' saved successfully into Google Sheet' };
}

/**
 * Saves calibration correction points for a SuperDAQ sensor linked by Kit Name / Description
 */
function saveSuperDaqSensorCorrections(ss, kitName, chId, points) {
  var sdqcSheet = findSheet(ss, ['Super DAQ corrections', 'SuperDAQ_Corrections', 'SuperDAQCorrections']);
  if (!sdqcSheet) return;

  var data = sdqcSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var headers = data[0];
  var kitNameIdx = findColIndex(headers, ['kit_name', 'kit name / description', 'kit description', 'kit name']);
  if (kitNameIdx === -1) kitNameIdx = 0;
  var chIdx = findColIndex(headers, ['channel_identifier', 'superdaq channel identifier', 'channel']);
  if (chIdx === -1) chIdx = 1;

  // Remove existing points for this Kit Name + Channel Identifier
  for (var r = data.length - 1; r >= 1; r--) {
    var rowKit = String(data[r][kitNameIdx] || '').trim().toLowerCase();
    var rowCh = String(data[r][chIdx] || '').trim().toLowerCase();
    if (rowKit === kitName.trim().toLowerCase() && rowCh === chId.trim().toLowerCase()) {
      sdqcSheet.deleteRow(r + 1);
    }
  }

  // Append new calibration points
  for (var i = 0; i < points.length; i++) {
    var indStr = points[i].indication >= 0 ? (' ' + points[i].indication) : String(points[i].indication);
    sdqcSheet.appendRow([kitName, chId, indStr + ' C', points[i].correction]);
  }
}

/**
 * Deletes a SuperDAQ PT100 Sensor
 */
function deleteSensorRecord(ss, sensorCode, chId, kitName) {
  var sdqSheet = findSheet(ss, ['Super DAQ', 'SuperDAQ_Sensors']);
  if (!sdqSheet) return { status: 'error', message: 'Super DAQ worksheet not found' };

  var data = sdqSheet.getDataRange().getValues();
  var headers = data[0];
  var chIdx = findColIndex(headers, ['channel_identifier', 'superdaq channel identifier', 'channel']);
  var codeIdx = findColIndex(headers, ['sensor_code', 'sensor code']);

  for (var r = data.length - 1; r >= 1; r--) {
    var matchCh = chId && chIdx !== -1 && String(data[r][chIdx]).trim().toLowerCase() === chId.toLowerCase();
    var matchCode = sensorCode && codeIdx !== -1 && String(data[r][codeIdx]).trim() === sensorCode;
    if (matchCh || matchCode) {
      sdqSheet.deleteRow(r + 1);
    }
  }

  // Also clean from Super DAQ corrections
  var sdqcSheet = findSheet(ss, ['Super DAQ corrections', 'SuperDAQ_Corrections']);
  if (sdqcSheet && chId) {
    var cData = sdqcSheet.getDataRange().getValues();
    var cHeaders = cData[0];
    var cChIdx = findColIndex(cHeaders, ['channel_identifier', 'superdaq channel identifier', 'channel']);
    var cNameIdx = findColIndex(cHeaders, ['kit_name', 'kit name / description', 'kit description']);
    if (cChIdx === -1) cChIdx = 1;

    for (var cr = cData.length - 1; cr >= 1; cr--) {
      var matchCCh = String(cData[cr][cChIdx] || '').trim().toLowerCase() === chId.toLowerCase();
      var matchCKit = !kitName || cNameIdx === -1 || String(cData[cr][cNameIdx] || '').trim().toLowerCase() === kitName.toLowerCase();
      if (matchCCh && matchCKit) {
        sdqcSheet.deleteRow(cr + 1);
      }
    }
  }

  return { status: 'success', message: 'Sensor ' + (chId || sensorCode) + ' deleted from Google Sheet' };
}

/**
 * Helper: Exports master worksheets as JSON payload
 */
function exportAllMasterDataAsJson() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function sheetToObjects(sheetNameCandidates) {
    var sh = findSheet(ss, sheetNameCandidates);
    if (!sh) return [];
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var items = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (row.every(function (c) { return c === '' || c === null; })) continue;
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) {
          obj[headers[c]] = row[c];
        }
      }
      items.push(obj);
    }
    return items;
  }

  return {
    status: 'success',
    spreadsheetId: ss.getId(),
    syncedAt: new Date().toISOString(),
    dataLoggers: sheetToObjects(['Data Loggers', 'Data_Loggers']),
    dataLoggerCorrections: sheetToObjects(['Data loggers corrections', 'Data_Logger_Corrections']),
    sensorKits: sheetToObjects(['Sensor Kits', 'Sensor_Kits']),
    superDaqSensors: sheetToObjects(['Super DAQ', 'SuperDAQ_Sensors', 'SuperDAQ']),
    superDaqCorrections: sheetToObjects(['Super DAQ corrections', 'SuperDAQ_Corrections']),
    settings: sheetToObjects(['Settings'])
  };
}
