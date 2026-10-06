/**
 * DataAccess.gs
 * Capa de acceso a datos: lectura/escritura genérica sobre las hojas del Spreadsheet.
 * Ningún módulo de negocio debe usar SpreadsheetApp directamente: todo pasa por aquí.
 */

const SHEET_NAMES = {
  PRODUCTOS: 'Productos',
  EMPLEADOS: 'Empleados',
  MOVIMIENTOS: 'Movimientos_Stock',
  STOCK_EMPLEADO: 'Stock_Empleado',
  VENTAS: 'Ventas',
  PROVEEDORES: 'Proveedores'
};

/**
 * Devuelve la hoja activa por nombre lógico, lanzando error claro si no existe.
 */
function getSheet_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('No se encontró la hoja "' + sheetName + '". Verifica el nombre exacto en el Spreadsheet.');
  }
  return sheet;
}

/**
 * Lee todos los encabezados de una hoja (fila 1) y los devuelve como array.
 */
function getHeaders_(sheet) {
  const lastCol = sheet.getLastColumn();
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

/**
 * Indica si una hoja tiene una columna con ese encabezado.
 */
function columnaExiste_(sheetName, columna) {
  return getHeaders_(getSheet_(sheetName)).indexOf(columna) !== -1;
}

/**
 * Lanza un error claro si falta una columna. Evita que insertRecord_/updateRecord_
 * ignoren en silencio un campo cuyo encabezado no existe en la hoja.
 */
function exigirColumna_(sheetName, columna) {
  if (!columnaExiste_(sheetName, columna)) {
    throw new Error('Falta la columna "' + columna + '" en la hoja "' + sheetName +
      '". Ejecuta migrarProveedores() una vez desde el editor de Apps Script.');
  }
}

/**
 * Convierte todas las filas de datos de una hoja en un array de objetos,
 * usando los encabezados como llaves. Omite filas completamente vacías.
 */
function readTable_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // solo encabezados, sin datos

  const headers = getHeaders_(sheet);
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const result = [];
  values.forEach(function (row, idx) {
    const isEmptyRow = row.every(function (cell) { return cell === '' || cell === null; });
    if (isEmptyRow) return;

    const obj = {};
    headers.forEach(function (header, colIdx) {
      obj[header] = row[colIdx];
    });
    obj._rowIndex = idx + 2; // fila real en la hoja (1-indexed, +1 por encabezado)
    result.push(obj);
  });
  return result;
}

/**
 * Busca un único registro por el valor de una columna (ej. buscar por id_producto).
 * Devuelve null si no encuentra coincidencia.
 */
function findRecordBy_(sheetName, fieldName, value) {
  const rows = readTable_(sheetName);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][fieldName] == value) return rows[i];
  }
  return null;
}

/**
 * Devuelve todos los registros que cumplan una condición (función filtro).
 * Ejemplo: findRecordsWhere_('Ventas', function(r){ return r.id_empleado == 5; });
 */
function findRecordsWhere_(sheetName, predicateFn) {
  return readTable_(sheetName).filter(predicateFn);
}

/**
 * Inserta un nuevo registro (objeto) en la hoja indicada, respetando el orden
 * de columnas que ya existe en el encabezado. Genera el ID autonumérico si
 * el campo idFieldName viene vacío/undefined.
 */
function insertRecord_(sheetName, record, idFieldName) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);

  if (idFieldName && (record[idFieldName] === undefined || record[idFieldName] === null || record[idFieldName] === '')) {
    record[idFieldName] = getNextId_(sheetName, idFieldName);
  }

  const row = headers.map(function (header) {
    return record.hasOwnProperty(header) ? record[header] : '';
  });

  sheet.appendRow(row);
  return record;
}

/**
 * Actualiza un registro existente identificado por _rowIndex (obtenido previamente
 * con readTable_ o findRecordBy_). Solo sobreescribe los campos presentes en `changes`.
 */
function updateRecord_(sheetName, rowIndex, changes) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);

  headers.forEach(function (header, colIdx) {
    if (changes.hasOwnProperty(header)) {
      sheet.getRange(rowIndex, colIdx + 1).setValue(changes[header]);
    }
  });
}

/**
 * Calcula el siguiente ID autonumérico para una hoja, buscando el máximo
 * valor actual en la columna indicada y sumando 1. Empieza en 1 si está vacía.
 */
function getNextId_(sheetName, idFieldName) {
  const rows = readTable_(sheetName);
  if (rows.length === 0) return 1;

  const maxId = rows.reduce(function (max, row) {
    const idVal = Number(row[idFieldName]) || 0;
    return idVal > max ? idVal : max;
  }, 0);

  return maxId + 1;
}

/**
 * Elimina físicamente una fila por su _rowIndex.
 * Úsalo con cuidado: en este sistema casi siempre se prefiere marcar `activo = false`
 * en lugar de borrar, para no perder trazabilidad histórica.
 */
function deleteRecord_(sheetName, rowIndex) {
  const sheet = getSheet_(sheetName);
  sheet.deleteRow(rowIndex);
}