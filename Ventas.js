/**
 * Ventas.gs
 * CRUD de ventas. Incluye soporte para órdenes multi-línea (id_orden).
 *
 * CAMBIO DE MODELO: se agregó la columna id_orden a la hoja Ventas.
 * Esquema actualizado:
 *   id_venta | id_orden | id_producto | id_empleado | cantidad_vendida |
 *   fecha_venta | precio_venta_aplicado | estado_devolucion
 *
 * Una orden agrupa N filas de Ventas con el mismo id_orden.
 * Esto permite registrar una venta de múltiples productos en una sola
 * operación desde el carrito del empleado.
 *
 * NOTA IMPORTANTE: agregar la columna id_orden a la hoja Ventas en Sheets
 * ANTES de desplegar esta versión. Insertar como segunda columna (B), después
 * de id_venta. Si la columna no existe, getNextId_ y readTable_ fallarán
 * silenciosamente o devolverán datos corridos.
 */

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR ORDEN DE VENTA (multi-producto)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registra una orden completa de venta con N líneas de producto.
 * Todos los registros comparten el mismo id_orden.
 *
 * @param {number} idEmpleado
 * @param {Array}  lineas     [{id_producto, cantidad_vendida, precio_venta_aplicado}]
 * @returns {Object} { id_orden, lineas: [...ventas serializadas] }
 */
function registrarOrdenVenta(idEmpleado, lineas) {
  if (!lineas || lineas.length === 0) {
    throw new Error('La orden no tiene líneas de producto.');
  }

  var idOrden = getNextIdOrden_();

  var ventasRegistradas = lineas.map(function (linea) {
    var idProducto       = linea.id_producto;
    var cantidadVendida  = Number(linea.cantidad_vendida);
    var precioAplicado   = Number(linea.precio_venta_aplicado);

    // Validar stock disponible del empleado antes de registrar
    var stockEmpleado = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
      return s.id_producto == idProducto && s.id_empleado == idEmpleado;
    });

    if (stockEmpleado.length === 0) {
      throw new Error('El empleado no tiene asignado el producto ID ' + idProducto + '.');
    }

    var disponible = Number(stockEmpleado[0].cantidad_asignada);
    if (cantidadVendida > disponible) {
      throw new Error('Stock insuficiente para el producto ID ' + idProducto +
        '. Disponible: ' + disponible + ', solicitado: ' + cantidadVendida + '.');
    }

    // Descontar del stock del empleado
    restarStockEmpleado_(idProducto, idEmpleado, cantidadVendida);

    // Insertar fila en Ventas
    var idVenta = getNextId_(SHEET_NAMES.VENTAS);
    var nuevaVenta = {
      id_venta:              idVenta,
      id_orden:              idOrden,
      id_producto:           idProducto,
      id_empleado:           idEmpleado,
      cantidad_vendida:      cantidadVendida,
      fecha_venta:           new Date(),
      precio_venta_aplicado: precioAplicado,
      estado_devolucion:     'Ninguna'
    };

    insertRecord_(SHEET_NAMES.VENTAS, nuevaVenta);
    return serializarVenta_(nuevaVenta);
  });

  return {
    id_orden: idOrden,
    lineas:   ventasRegistradas
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR VENTA SIMPLE (una sola línea — mantener por compatibilidad)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registra una venta de un solo producto.
 * Internamente crea una orden de una sola línea.
 * Se mantiene para no romper código existente que la llame.
 *
 * @param {number} idEmpleado
 * @param {number} idProducto
 * @param {number} cantidadVendida
 * @param {number} precioVentaAplicado
 * @returns {Object} venta serializada
 */
function registrarVenta(idEmpleado, idProducto, cantidadVendida, precioVentaAplicado) {
  var resultado = registrarOrdenVenta(idEmpleado, [{
    id_producto:           idProducto,
    cantidad_vendida:      cantidadVendida,
    precio_venta_aplicado: precioVentaAplicado
  }]);
  return resultado.lineas[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTAR VENTAS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Lista todas las ventas de un empleado, con filtro opcional de fechas.
 * @param {number}  idEmpleado
 * @param {string=} fechaDesde  'YYYY-MM-DD' (opcional)
 * @param {string=} fechaHasta  'YYYY-MM-DD' (opcional)
 */
function listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta) {
  var ventas = findRecordsWhere_(SHEET_NAMES.VENTAS, function (v) {
    if (v.id_empleado != idEmpleado) return false;
    return estaEnRango_(v.fecha_venta, fechaDesde, fechaHasta);
  });

  return ventas.map(function (v) {
    return serializarVenta_(enriquecerVenta_(v));
  });
}

/**
 * Lista todas las ventas de todos los empleados, con filtro opcional de fechas.
 * @param {string=} fechaDesde  'YYYY-MM-DD' (opcional)
 * @param {string=} fechaHasta  'YYYY-MM-DD' (opcional)
 */
function listarTodasLasVentas(fechaDesde, fechaHasta) {
  var ventas = findRecordsWhere_(SHEET_NAMES.VENTAS, function (v) {
    return estaEnRango_(v.fecha_venta, fechaDesde, fechaHasta);
  });

  return ventas.map(function (v) {
    return serializarVenta_(enriquecerVenta_(v));
  });
}

/**
 * Calcula el total vendido (monto) por empleado en un rango de fechas.
 */
function calcularTotalVendidoPorEmpleado(idEmpleado, fechaDesde, fechaHasta) {
  var ventas = listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta);
  return ventas.reduce(function (total, v) {
    return total + (Number(v.cantidad_vendida) * Number(v.precio_venta_aplicado));
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES INTERNAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera el próximo id_orden leyendo el máximo actual de la hoja Ventas.
 * Usa prefijo "ORD-" para distinguirlo visualmente de id_venta.
 */
function getNextIdOrden_() {
  var ventas = readTable_(SHEET_NAMES.VENTAS);
  var maxNum = 0;
  ventas.forEach(function (v) {
    if (v.id_orden && String(v.id_orden).indexOf('ORD-') === 0) {
      var num = parseInt(String(v.id_orden).replace('ORD-', ''), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });
  return 'ORD-' + String(maxNum + 1).padStart(4, '0');
}

/**
 * Verifica si una fecha cae dentro del rango [fechaDesde, fechaHasta].
 * Si no se pasan fechas, acepta cualquier registro.
 */
function estaEnRango_(fechaValor, fechaDesde, fechaHasta) {
  if (!fechaDesde && !fechaHasta) return true;
  var fecha = new Date(fechaValor);
  if (isNaN(fecha.getTime())) return false;
  if (fechaDesde) {
    var desde = new Date(fechaDesde + 'T00:00:00');
    if (fecha < desde) return false;
  }
  if (fechaHasta) {
    var hasta = new Date(fechaHasta + 'T23:59:59');
    if (fecha > hasta) return false;
  }
  return true;
}

/**
 * Enriquece un registro de venta con nombre_producto y nombre_empleado
 * haciendo lookup en sus respectivas hojas.
 */
function enriquecerVenta_(venta) {
  var producto = findRecordBy_(SHEET_NAMES.PRODUCTOS, 'id_producto', venta.id_producto);
  var empleado = findRecordBy_(SHEET_NAMES.EMPLEADOS, 'id_empleado', venta.id_empleado);
  venta.nombre_producto  = producto ? producto.nombre_producto  : '—';
  venta.codigo_producto  = producto ? producto.codigo_producto  : '—';
  venta.nombre_empleado  = empleado ? empleado.nombre_empleado  : '—';
  return venta;
}

/**
 * Serializa una venta para el puente google.script.run:
 * convierte Date → string y elimina _rowIndex.
 * Incluye id_orden en el objeto devuelto.
 */
function serializarVenta_(venta) {
  var obj = {};
  for (var key in venta) {
    if (key === '_rowIndex') continue;
    if (venta[key] instanceof Date) {
      obj[key] = Utilities.formatDate(
        venta[key], 'America/El_Salvador', 'yyyy-MM-dd HH:mm:ss'
      );
    } else {
      obj[key] = venta[key];
    }
  }
  // Garantizar que id_orden siempre esté presente aunque sea vacío
  if (!obj.id_orden) obj.id_orden = '';
  return obj;
}