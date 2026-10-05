/**
 * Productos.gs
 * Lógica de negocio para el catálogo de productos (rol Administrador).
 * Depende de DataAccess.gs — no accede a SpreadsheetApp directamente.
 */

/**
 * Devuelve todos los productos activos, ordenados por nombre.
 * Uso típico: poblar selects en el panel de administrador.
 */
function listarProductosActivos() {
  const productos = findRecordsWhere_(SHEET_NAMES.PRODUCTOS, function (p) {
    return p.activo === true;
  });
  const ordenados = productos.sort(function (a, b) {
    return a.nombre_producto.localeCompare(b.nombre_producto);
  });
  return ordenados.map(serializarProducto_);
}

function listarTodosLosProductos() {
  return readTable_(SHEET_NAMES.PRODUCTOS).map(serializarProducto_);
}

/**
 * Busca un producto por su id_producto (llave técnica).
 */
function obtenerProductoPorId(idProducto) {
  const producto = findRecordBy_(SHEET_NAMES.PRODUCTOS, 'id_producto', idProducto);
  if (!producto) {
    throw new Error('No existe un producto con id_producto = ' + idProducto);
  }
  return producto; // uso interno entre módulos .gs — no pasa por google.script.run directamente
}

/**
 * Busca un producto por su código de negocio (codigo_producto).
 * Útil para validar duplicados al crear uno nuevo.
 */
function obtenerProductoPorCodigo(codigoProducto) {
  return findRecordBy_(SHEET_NAMES.PRODUCTOS, 'codigo_producto', codigoProducto);
}

/**
 * Crea un nuevo producto. Valida que el código de negocio no esté repetido
 * (aunque la llave real es id_producto, el código debe ser único de cara al usuario).
 *
 * datos esperado: { codigo_producto, nombre_producto, descripcion, unidad_medida,
 *                    precio_costo, precio_venta }
 */
function crearProducto(datos) {
  validarDatosProducto_(datos);

  const existente = obtenerProductoPorCodigo(datos.codigo_producto);
  if (existente) {
    throw new Error('Ya existe un producto con el código "' + datos.codigo_producto + '" (' + existente.nombre_producto + ').');
  }

  const nuevoProducto = {
    codigo_producto: datos.codigo_producto,
    nombre_producto: datos.nombre_producto,
    descripcion: datos.descripcion || '',
    unidad_medida: datos.unidad_medida || '',
    precio_costo: Number(datos.precio_costo),
    precio_venta: Number(datos.precio_venta),
    stock_total: 0,
    fecha_creacion: new Date(),
    activo: true
  };

  const insertado = insertRecord_(SHEET_NAMES.PRODUCTOS, nuevoProducto, 'id_producto');
  return serializarProducto_(insertado);
}

function editarProducto(idProducto, cambios) {
  const producto = obtenerProductoPorId(idProducto);

  if (cambios.hasOwnProperty('stock_total')) {
    throw new Error('No se puede editar stock_total directamente. Usa un movimiento de inventario.');
  }

  if (cambios.codigo_producto && cambios.codigo_producto !== producto.codigo_producto) {
    const existente = obtenerProductoPorCodigo(cambios.codigo_producto);
    if (existente) {
      throw new Error('Ya existe otro producto con el código "' + cambios.codigo_producto + '".');
    }
  }

  if (cambios.precio_costo !== undefined) cambios.precio_costo = Number(cambios.precio_costo);
  if (cambios.precio_venta !== undefined) cambios.precio_venta = Number(cambios.precio_venta);

  updateRecord_(SHEET_NAMES.PRODUCTOS, producto._rowIndex, cambios);
  return serializarProducto_(obtenerProductoPorId(idProducto));
}

/**
 * Desactiva un producto (borrado lógico). No se elimina la fila para
 * conservar la trazabilidad en Movimientos_Stock y Ventas.
 */
function desactivarProducto(idProducto) {
  const producto = obtenerProductoPorId(idProducto);
  updateRecord_(SHEET_NAMES.PRODUCTOS, producto._rowIndex, { activo: false });
  return true;
}

/**
 * Reactiva un producto previamente desactivado.
 */
function reactivarProducto(idProducto) {
  const producto = obtenerProductoPorId(idProducto);
  updateRecord_(SHEET_NAMES.PRODUCTOS, producto._rowIndex, { activo: true });
  return true;
}

/**
 * Ajusta el stock_total del producto. Función interna: solo debe ser
 * invocada desde Movimientos.gs, nunca directamente desde la UI.
 * delta puede ser positivo (entrada) o negativo (salida).
 */
function ajustarStockTotal_(idProducto, delta) {
  const producto = obtenerProductoPorId(idProducto);
  const nuevoStock = Number(producto.stock_total) + delta;

  if (nuevoStock < 0) {
    throw new Error('Movimiento inválido: el stock de "' + producto.nombre_producto + '" quedaría negativo (' + nuevoStock + ').');
  }

  updateRecord_(SHEET_NAMES.PRODUCTOS, producto._rowIndex, { stock_total: nuevoStock });
  return nuevoStock;
}

/**
 * Validaciones básicas de campos obligatorios al crear un producto.
 */
function validarDatosProducto_(datos) {
  const camposObligatorios = ['codigo_producto', 'nombre_producto', 'precio_costo', 'precio_venta'];
  camposObligatorios.forEach(function (campo) {
    if (datos[campo] === undefined || datos[campo] === null || datos[campo] === '') {
      throw new Error('El campo "' + campo + '" es obligatorio.');
    }
  });

  if (Number(datos.precio_costo) < 0 || Number(datos.precio_venta) < 0) {
    throw new Error('Los precios no pueden ser negativos.');
  }

  if (Number(datos.precio_venta) < Number(datos.precio_costo)) {
    // No lo bloqueo, solo lo señalo: el cliente podría vender a pérdida intencionalmente
    // (ej. liquidación), pero es información valiosa para el administrador.
    console.warn('Atención: precio_venta es menor que precio_costo para "' + datos.nombre_producto + '".');
  }
}

/**
 * Convierte fecha_creacion de Date a string antes de devolver el producto
 * al cliente. Sin esto, google.script.run falla silenciosamente y devuelve
 * null en lugar del array completo — los objetos Date no viajan bien por
 * el puente cliente-servidor de HtmlService/google.script.run.
 */
function serializarProducto_(producto) {
  const copia = Object.assign({}, producto);
  if (copia.fecha_creacion instanceof Date) {
    copia.fecha_creacion = Utilities.formatDate(copia.fecha_creacion, 'America/El_Salvador', 'yyyy-MM-dd HH:mm:ss');
  }
  delete copia._rowIndex;
  return copia;
}