import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const SYSTEM_COLUMNS = ["status", "status_detail", "executed_at"];

function normalizeHeader(value) {
  return String(value ?? "").trim();
}

export function readWorkbook(excelPath) {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Excel file not found: ${excelPath}`);
  }

  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`Excel file has no worksheet: ${excelPath}`);
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });

  const headerRow = rows[0] || [];
  const headers = headerRow.map(normalizeHeader);
  if (headers.every((header) => !header)) {
    throw new Error(`Excel header row is empty: ${excelPath}`);
  }

  return {
    workbook,
    sheetName,
    sheet,
    headers,
    rows
  };
}

export function validateExcelFile(excelPath) {
  const workbookData = readWorkbook(excelPath);
  return {
    headers: workbookData.headers,
    sheetName: workbookData.sheetName
  };
}

function ensureSystemColumns(workbookData) {
  let changed = false;
  for (const column of SYSTEM_COLUMNS) {
    if (!workbookData.headers.includes(column)) {
      workbookData.headers.push(column);
      changed = true;
    }
  }

  if (changed) {
    workbookData.rows[0] = workbookData.headers;
    workbookData.sheet = XLSX.utils.aoa_to_sheet(workbookData.rows);
    workbookData.workbook.Sheets[workbookData.sheetName] = workbookData.sheet;
  }
}

export function listPendingRows(excelPath) {
  const workbookData = readWorkbook(excelPath);
  ensureSystemColumns(workbookData);

  const headerIndex = new Map(workbookData.headers.map((header, index) => [header, index]));
  const statusIndex = headerIndex.get("status");
  const pendingRows = [];

  for (let rowIndex = 1; rowIndex < workbookData.rows.length; rowIndex += 1) {
    const row = workbookData.rows[rowIndex];
    if (!row || row.every((cell) => String(cell ?? "").trim() === "")) {
      continue;
    }

    const statusValue = String(row[statusIndex] ?? "").trim().toLowerCase();
    if (statusValue) {
      continue;
    }

    const values = {};
    workbookData.headers.forEach((header, columnIndex) => {
      values[header] = row[columnIndex] ?? "";
    });
    pendingRows.push({
      rowNumber: rowIndex + 1,
      values
    });
  }

  return pendingRows;
}

export function writeRowResult(excelPath, rowNumber, { status, statusDetail, executedAt }) {
  const workbookData = readWorkbook(excelPath);
  ensureSystemColumns(workbookData);
  const rowIndex = rowNumber - 1;
  while (workbookData.rows.length <= rowIndex) {
    workbookData.rows.push([]);
  }

  const headerIndex = new Map(workbookData.headers.map((header, index) => [header, index]));
  const row = workbookData.rows[rowIndex] || [];
  row[headerIndex.get("status")] = status;
  row[headerIndex.get("status_detail")] = statusDetail;
  row[headerIndex.get("executed_at")] = executedAt;
  workbookData.rows[rowIndex] = row;

  const newSheet = XLSX.utils.aoa_to_sheet(workbookData.rows);
  workbookData.workbook.Sheets[workbookData.sheetName] = newSheet;
  XLSX.writeFile(workbookData.workbook, excelPath);
}

export function getExcelFilePath(folderPath, excelFilenameStandard) {
  return path.join(folderPath, excelFilenameStandard);
}

export function readAllRows(excelPath) {
  const workbookData = readWorkbook(excelPath);
  ensureSystemColumns(workbookData);

  const rows = [];
  for (let rowIndex = 1; rowIndex < workbookData.rows.length; rowIndex += 1) {
    const row = workbookData.rows[rowIndex];
    if (!row || row.every((cell) => String(cell ?? "").trim() === "")) {
      continue;
    }
    const values = {};
    workbookData.headers.forEach((header, columnIndex) => {
      values[header] = row[columnIndex] ?? "";
    });
    rows.push({
      rowNumber: rowIndex + 1,
      values
    });
  }

  return {
    headers: workbookData.headers,
    rows
  };
}

function persistWorkbook(workbookData, excelPath) {
  const newSheet = XLSX.utils.aoa_to_sheet(workbookData.rows);
  workbookData.workbook.Sheets[workbookData.sheetName] = newSheet;
  XLSX.writeFile(workbookData.workbook, excelPath);
}

export function addRowValues(excelPath, values) {
  const workbookData = readWorkbook(excelPath);
  ensureSystemColumns(workbookData);

  const newRow = workbookData.headers.map((header) => {
    const value = values[header];
    if (value === undefined || value === null) return "";
    return value;
  });

  if (workbookData.headers.includes("TT")) {
    const ttIndex = workbookData.headers.indexOf("TT");
    if (newRow[ttIndex] === "" || newRow[ttIndex] === undefined) {
      const dataRows = workbookData.rows.slice(1).filter((r) => r && r.some((c) => String(c ?? "").trim() !== ""));
      newRow[ttIndex] = dataRows.length + 1;
    }
  }

  workbookData.rows.push(newRow);
  persistWorkbook(workbookData, excelPath);
  return { rowNumber: workbookData.rows.length };
}

export function updateRowValues(excelPath, rowNumber, values) {
  const workbookData = readWorkbook(excelPath);
  ensureSystemColumns(workbookData);
  const rowIndex = rowNumber - 1;
  if (rowIndex < 1 || rowIndex >= workbookData.rows.length) {
    throw new Error(`Row ${rowNumber} not found`);
  }
  const row = workbookData.rows[rowIndex] || [];
  workbookData.headers.forEach((header, columnIndex) => {
    if (Object.prototype.hasOwnProperty.call(values, header)) {
      row[columnIndex] = values[header] ?? "";
    } else if (row[columnIndex] === undefined) {
      row[columnIndex] = "";
    }
  });
  workbookData.rows[rowIndex] = row;
  persistWorkbook(workbookData, excelPath);
}

export function deleteRowAt(excelPath, rowNumber) {
  const workbookData = readWorkbook(excelPath);
  ensureSystemColumns(workbookData);
  const rowIndex = rowNumber - 1;
  if (rowIndex < 1 || rowIndex >= workbookData.rows.length) {
    throw new Error(`Row ${rowNumber} not found`);
  }
  workbookData.rows.splice(rowIndex, 1);

  if (workbookData.headers.includes("TT")) {
    const ttIndex = workbookData.headers.indexOf("TT");
    let counter = 1;
    for (let i = 1; i < workbookData.rows.length; i += 1) {
      const r = workbookData.rows[i];
      if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
      r[ttIndex] = counter;
      counter += 1;
    }
  }

  persistWorkbook(workbookData, excelPath);
}

