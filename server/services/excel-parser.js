/**
 * Excel Parser Service
 *
 * Parse Excel files (.xlsx, .xls) and extract structured data
 * with cell-level provenance for underwriting models.
 */

import ExcelJS from 'exceljs';

/**
 * Parse an Excel file from a buffer
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @returns {Object} Parsed workbook data with cells
 */
export async function parseExcelFile(buffer, filename) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const result = {
    filename,
    sheetCount: workbook.worksheets.length,
    sheets: [],
    cells: []
  };

  for (const worksheet of workbook.worksheets) {
    const sheetInfo = {
      name: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount
    };

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        const cellData = {
          sheetName: worksheet.name,
          cellRef: cell.address,
          row: rowNumber,
          col: colNumber,
          rawValue: getCellRawValue(cell),
          computedValue: getCellComputedValue(cell),
          formula: cell.formula || null,
          dataType: detectCellType(cell),
          labelText: null // Will be filled by findAdjacentLabel
        };

        result.cells.push(cellData);
      });
    });

    result.sheets.push(sheetInfo);
  }

  // Find labels for numeric cells
  enrichWithLabels(result.cells);

  return result;
}

/**
 * Get the raw value of a cell
 */
function getCellRawValue(cell) {
  if (cell.value === null || cell.value === undefined) {
    return null;
  }

  // Handle rich text
  if (typeof cell.value === 'object' && cell.value.richText) {
    return cell.value.richText.map(r => r.text).join('');
  }

  // Handle formula cells
  if (cell.formula) {
    return cell.formula;
  }

  return String(cell.value);
}

/**
 * Get the computed/result value of a cell
 */
function getCellComputedValue(cell) {
  // For formula cells, get the result
  if (cell.formula && cell.result !== undefined) {
    return cell.result;
  }

  // For regular cells, get the value
  if (cell.value === null || cell.value === undefined) {
    return null;
  }

  // Handle rich text
  if (typeof cell.value === 'object' && cell.value.richText) {
    return cell.value.richText.map(r => r.text).join('');
  }

  return cell.value;
}

/**
 * Detect the data type of a cell
 */
function detectCellType(cell) {
  if (cell.formula) return 'FORMULA';
  if (cell.value === null || cell.value === undefined) return 'EMPTY';

  const value = cell.value;

  if (typeof value === 'number') return 'NUMBER';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (value instanceof Date) return 'DATE';

  // Check if it's a date object from Excel
  if (typeof value === 'object' && value.getTime) return 'DATE';

  // Rich text
  if (typeof value === 'object' && value.richText) return 'STRING';

  // Percentage-like strings
  if (typeof value === 'string' && value.match(/^-?\d+\.?\d*%$/)) return 'PERCENTAGE';

  // Currency-like strings
  if (typeof value === 'string' && value.match(/^\$[\d,]+\.?\d*$/)) return 'CURRENCY';

  return 'STRING';
}

/**
 * Enrich cells with label text from adjacent cells
 * Looks left and up for labels
 */
function enrichWithLabels(cells) {
  // Build a lookup map
  const cellMap = new Map();
  for (const cell of cells) {
    const key = `${cell.sheetName}:${cell.row}:${cell.col}`;
    cellMap.set(key, cell);
  }

  for (const cell of cells) {
    // Only look for labels for numeric cells
    if (!['NUMBER', 'FORMULA', 'CURRENCY', 'PERCENTAGE'].includes(cell.dataType)) {
      continue;
    }

    // Look left (same row, column - 1)
    const leftKey = `${cell.sheetName}:${cell.row}:${cell.col - 1}`;
    const leftCell = cellMap.get(leftKey);
    if (leftCell && leftCell.dataType === 'STRING') {
      cell.labelText = leftCell.computedValue || leftCell.rawValue;
      continue;
    }

    // Look up (row - 1, same column)
    const upKey = `${cell.sheetName}:${cell.row - 1}:${cell.col}`;
    const upCell = cellMap.get(upKey);
    if (upCell && upCell.dataType === 'STRING') {
      cell.labelText = upCell.computedValue || upCell.rawValue;
      continue;
    }

    // Look 2 cells left (for indented labels)
    const left2Key = `${cell.sheetName}:${cell.row}:${cell.col - 2}`;
    const left2Cell = cellMap.get(left2Key);
    if (left2Cell && left2Cell.dataType === 'STRING') {
      cell.labelText = left2Cell.computedValue || left2Cell.rawValue;
    }
  }
}

/**
 * Get all sheets in a workbook
 */
export async function getSheetNames(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets.map(ws => ws.name);
}

/**
 * Get a specific sheet's data
 */
export async function getSheetData(buffer, sheetName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    return null;
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const rowData = {
      rowNumber,
      cells: []
    };

    row.eachCell((cell, colNumber) => {
      rowData.cells.push({
        col: colNumber,
        address: cell.address,
        value: getCellComputedValue(cell),
        type: detectCellType(cell),
        formula: cell.formula || null
      });
    });

    rows.push(rowData);
  });

  return {
    name: worksheet.name,
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    rows
  };
}

/**
 * Search for a specific value pattern in the workbook
 */
export async function searchCells(buffer, pattern) {
  const parsed = await parseExcelFile(buffer, 'search');
  const regex = new RegExp(pattern, 'i');

  return parsed.cells.filter(cell => {
    if (!cell.labelText && !cell.rawValue) return false;
    return regex.test(cell.labelText || '') || regex.test(String(cell.rawValue) || '');
  });
}

export default {
  parseExcelFile,
  getSheetNames,
  getSheetData,
  searchCells
};
