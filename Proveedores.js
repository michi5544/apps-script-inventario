/**
 * Proveedores.gs
 * Catálogo de proveedores (rol Administrador).
 *
 * Hoja Proveedores: id_proveedor | nombre_proveedor | activo
 *
 * - Productos.id_proveedor        proveedor habitual del producto
 * - Movimientos_Stock.id_proveedor proveedor real de cada ingreso de mercancía
 *
 * Para crear la hoja y las columnas en un Spreadsheet existente, ejecuta una vez
 * desde el editor de Apps Script la función migrarProveedores().
 */

function listarProveedoresActivos() {
  return findRecordsWhere_(SHEET_NAMES.PROVEEDORES, function (p) {
    return p.activo === true;
  }).map(serializarProveedor_).sort(compararPorNombreProveedor_);
}

function listarTodosLosProveedores() {
  return readTable_(SHEET_NAMES.PROVEEDORES).map(serializarProveedor_).sort(compararPorNombreProveedor_);
}

function obtenerProveedorPorId(idProveedor) {
  const proveedor = findRecordBy_(SHEET_NAMES.PROVEEDORES, 'id_proveedor', idProveedor);
  if (!proveedor) {
    throw new Error('No existe un proveedor con id_proveedor = ' + idProveedor);
  }
  return proveedor;
}

/**
 * Crea un proveedor. El nombre es obligatorio y único (sin distinguir mayúsculas).
 * datos esperado: { nombre_proveedor }
 */
function crearProveedor(datos) {
  const nombre = normalizarNombreProveedor_(datos && datos.nombre_proveedor);
  validarNombreProveedorUnico_(nombre, null);

  const insertado = insertRecord_(SHEET_NAMES.PROVEEDORES, {
    nombre_proveedor: nombre,
    activo: true
  }, 'id_proveedor');
  return serializarProveedor_(insertado);
}

function editarProveedor(idProveedor, cambios) {
  const proveedor = obtenerProveedorPorId(idProveedor);
  const nombre = normalizarNombreProveedor_(cambios && cambios.nombre_proveedor);
  validarNombreProveedorUnico_(nombre, proveedor.id_proveedor);

  updateRecord_(SHEET_NAMES.PROVEEDORES, proveedor._rowIndex, { nombre_proveedor: nombre });
  return serializarProveedor_(obtenerProveedorPorId(idProveedor));
}

/**
 * Desactiva un proveedor (borrado lógico). Conserva el historial de ingresos y
 * los productos que lo referencian, pero ya no se puede elegir en formularios nuevos.
 */
function desactivarProveedor(idProveedor) {
  const proveedor = obtenerProveedorPorId(idProveedor);
  updateRecord_(SHEET_NAMES.PROVEEDORES, proveedor._rowIndex, { activo: false });
  return true;
}

function reactivarProveedor(idProveedor) {
  const proveedor = obtenerProveedorPorId(idProveedor);
  updateRecord_(SHEET_NAMES.PROVEEDORES, proveedor._rowIndex, { activo: true });
  return true;
}

/**
 * Verifica que se haya elegido un proveedor existente y activo.
 * idPermitidoInactivo: id que se tolera aunque esté inactivo (al editar un
 * producto que ya tenía ese proveedor y no se está cambiando).
 * @returns {Object} el proveedor
 */
function exigirProveedorValido_(idProveedor, idPermitidoInactivo) {
  if (idProveedor === undefined || idProveedor === null || idProveedor === '') {
    throw new Error('Debes seleccionar un proveedor.');
  }
  const proveedor = obtenerProveedorPorId(idProveedor);
  const toleradoInactivo = idPermitidoInactivo !== undefined && idPermitidoInactivo !== null &&
    idPermitidoInactivo !== '' && String(idPermitidoInactivo) === String(proveedor.id_proveedor);

  if (proveedor.activo !== true && !toleradoInactivo) {
    throw new Error('El proveedor "' + proveedor.nombre_proveedor + '" está inactivo. Reactívalo o elige otro.');
  }
  return proveedor;
}

/* ───────────────────────── Funciones internas ───────────────────────── */

function normalizarNombreProveedor_(nombre) {
  const limpio = String(nombre === undefined || nombre === null ? '' : nombre).replace(/\s+/g, ' ').trim();
  if (!limpio) {
    throw new Error('El nombre del proveedor es obligatorio.');
  }
  if (limpio.length > 80) {
    throw new Error('El nombre del proveedor no puede superar 80 caracteres.');
  }
  return limpio;
}

function validarNombreProveedorUnico_(nombre, idExcluido) {
  const clave = nombre.toLowerCase();
  const repetido = readTable_(SHEET_NAMES.PROVEEDORES).filter(function (p) {
    return String(p.nombre_proveedor).trim().toLowerCase() === clave &&
      (idExcluido === null || p.id_proveedor != idExcluido);
  })[0];

  if (repetido) {
    throw new Error('Ya existe un proveedor llamado "' + repetido.nombre_proveedor + '".');
  }
}

function compararPorNombreProveedor_(a, b) {
  return String(a.nombre_proveedor).localeCompare(String(b.nombre_proveedor));
}

function serializarProveedor_(proveedor) {
  const copia = Object.assign({}, proveedor);
  delete copia._rowIndex;
  return copia;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRACIÓN (ejecutar una sola vez desde el editor de Apps Script)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Prepara el Spreadsheet para proveedores:
 *  1) crea la hoja Proveedores (id_proveedor | nombre_proveedor | activo),
 *  2) agrega la columna id_proveedor a Productos y a Movimientos_Stock.
 * Es seguro ejecutarla varias veces: solo agrega lo que falta.
 * @returns {string} resumen de lo realizado
 */
function migrarProveedores() {
  exigirAdmin_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const acciones = [];

  if (!ss.getSheetByName(SHEET_NAMES.PROVEEDORES)) {
    const hoja = ss.insertSheet(SHEET_NAMES.PROVEEDORES);
    hoja.getRange(1, 1, 1, 3).setValues([['id_proveedor', 'nombre_proveedor', 'activo']]);
    hoja.setFrozenRows(1);
    acciones.push('Hoja "' + SHEET_NAMES.PROVEEDORES + '" creada');
  }

  [SHEET_NAMES.PRODUCTOS, SHEET_NAMES.MOVIMIENTOS].forEach(function (nombreHoja) {
    if (!columnaExiste_(nombreHoja, 'id_proveedor')) {
      const hoja = getSheet_(nombreHoja);
      hoja.getRange(1, hoja.getLastColumn() + 1).setValue('id_proveedor');
      acciones.push('Columna id_proveedor agregada a "' + nombreHoja + '"');
    }
  });

  return acciones.length ? acciones.join('. ') + '.' : 'Todo estaba listo; no hubo cambios.';
}
