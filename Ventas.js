/**
 * Ventas.gs
 * CRUD de ventas. Incluye soporte para órdenes multi-línea (id_orden).
 *
 * Esquema de la hoja Ventas:
 *   id_venta | id_orden | id_producto | id_empleado | cantidad_vendida |
 *   fecha_venta | precio_venta_aplicado | estado_devolucion | precio_costo_aplicado
 *
 * Una orden agrupa N filas de Ventas con el mismo id_orden.
 * Esto permite registrar una venta de múltiples productos en una sola
 * operación desde el carrito del empleado.
 *
 * precio_costo_aplicado guarda el costo del producto EN EL MOMENTO de la venta,
 * para que la ganancia histórica no cambie si luego se modifica el costo.
 * Para agregar esa columna a una hoja existente, ejecuta una vez desde el editor
 * la función migrarVentasAgregarCosto().
 */

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR ORDEN DE VENTA (multi-producto)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registra una orden completa de venta con N líneas de producto.
 * Todos los registros comparten el mismo id_orden.
 *
 * - Valida TODAS las líneas (cantidad entera > 0, producto existente, stock del
 *   empleado) antes de escribir algo, para no dejar órdenes a medias.
 * - El precio de venta y el costo se toman del catálogo en el servidor; no se
 *   confía en el precio que envía el navegador.
 * - Usa un bloqueo para que dos ventas simultáneas no generen ids repetidos
 *   ni descuenten stock dos veces.
 *
 * @param {number} idEmpleado
 * @param {Array}  lineas     [{id_producto, cantidad_vendida}]
 * @returns {Object} { id_orden, lineas: [...ventas serializadas] }
 */
function registrarOrdenVenta(idEmpleado, lineas) {
  if (!lineas || lineas.length === 0) {
    throw new Error('La orden no tiene líneas de producto.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    // 1) Validación completa, sin escribir nada todavía
    var pedidoPorProducto = {};
    var nombrePorProducto = {};

    var normalizadas = lineas.map(function (linea) {
      var cantidad = Number(linea.cantidad_vendida);
      if (!isFinite(cantidad) || cantidad <= 0 || Math.floor(cantidad) !== cantidad) {
        throw new Error('La cantidad vendida debe ser un número entero mayor a cero.');
      }
      var producto = obtenerProductoPorId(linea.id_producto);
      var id = producto.id_producto;
      pedidoPorProducto[id] = (pedidoPorProducto[id] || 0) + cantidad;
      nombrePorProducto[id] = producto.nombre_producto;
      return { producto: producto, cantidad: cantidad };
    });

    var stockEmpleado = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
      return s.id_empleado == idEmpleado;
    });

    Object.keys(pedidoPorProducto).forEach(function (idProducto) {
      var registro = stockEmpleado.filter(function (s) { return s.id_producto == idProducto; })[0];
      if (!registro) {
        throw new Error('El empleado no tiene asignado el producto "' + nombrePorProducto[idProducto] + '".');
      }
      var disponible = Number(registro.cantidad_asignada);
      if (pedidoPorProducto[idProducto] > disponible) {
        throw new Error('Stock insuficiente para "' + nombrePorProducto[idProducto] +
          '". Disponible: ' + disponible + ', solicitado: ' + pedidoPorProducto[idProducto] + '.');
      }
    });

    // 2) Escritura
    var idOrden   = getNextIdOrden_();
    var siguiente = getNextId_(SHEET_NAMES.VENTAS, 'id_venta');
    var ahora     = new Date();

    var ventasRegistradas = normalizadas.map(function (n, i) {
      restarStockEmpleado_(n.producto.id_producto, idEmpleado, n.cantidad);

      var nuevaVenta = {
        id_venta:              siguiente + i,
        id_orden:              idOrden,
        id_producto:           n.producto.id_producto,
        id_empleado:           idEmpleado,
        cantidad_vendida:      n.cantidad,
        fecha_venta:           ahora,
        precio_venta_aplicado: Number(n.producto.precio_venta),
        estado_devolucion:     'Ninguna',
        precio_costo_aplicado: Number(n.producto.precio_costo)
      };

      insertRecord_(SHEET_NAMES.VENTAS, nuevaVenta);
      return serializarVenta_(nuevaVenta);
    });

    return {
      id_orden: idOrden,
      lineas:   ventasRegistradas
    };
  } finally {
    lock.releaseLock();
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// MIGRACIÓN (ejecutar una sola vez desde el editor de Apps Script)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * 1) Agrega la columna precio_costo_aplicado a la hoja Ventas si no existe.
 * 2) Rellena las ventas antiguas con el costo ACTUAL del producto (es una
 *    aproximación: antes no se guardaba el costo de cada venta).
 * 3) Corrige id_venta repetidos (una versión anterior asignaba siempre 1),
 *    conservando el primero de cada id y renumerando el resto.
 *
 * Es seguro ejecutarla varias veces: solo toca celdas vacías o ids repetidos.
 * @returns {string} resumen de lo realizado
 */
function migrarVentasAgregarCosto() {
  exigirAdmin_();

  var sheet   = getSheet_(SHEET_NAMES.VENTAS);
  var headers = getHeaders_(sheet);

  var colCosto = headers.indexOf('precio_costo_aplicado') + 1;
  var columnaNueva = false;
  if (colCosto === 0) {
    colCosto = headers.length + 1;
    sheet.getRange(1, colCosto).setValue('precio_costo_aplicado');
    columnaNueva = true;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 'Columna ' + (columnaNueva ? 'creada' : 'ya existía') + '. No hay ventas que completar.';
  }

  var filas       = lastRow - 1;
  var colProducto = headers.indexOf('id_producto') + 1;
  var colIdVenta  = headers.indexOf('id_venta') + 1;

  var costoActual = {};
  listarTodosLosProductos().forEach(function (p) {
    costoActual[p.id_producto] = Number(p.precio_costo);
  });

  // Costos
  var rangoCosto = sheet.getRange(2, colCosto, filas, 1);
  var costos     = rangoCosto.getValues();
  var productos  = sheet.getRange(2, colProducto, filas, 1).getValues();
  var rellenadas = 0;
  for (var i = 0; i < filas; i++) {
    if (costos[i][0] === '' && productos[i][0] !== '' && costoActual[productos[i][0]] !== undefined) {
      costos[i][0] = costoActual[productos[i][0]];
      rellenadas++;
    }
  }
  rangoCosto.setValues(costos);

  // Ids repetidos
  var corregidos = 0;
  if (colIdVenta > 0) {
    var rangoIds = sheet.getRange(2, colIdVenta, filas, 1);
    var ids      = rangoIds.getValues();
    var vistos   = {};
    var maximo   = 0;
    ids.forEach(function (fila) { maximo = Math.max(maximo, Number(fila[0]) || 0); });

    for (var j = 0; j < filas; j++) {
      var id = ids[j][0];
      if (id === '') continue;
      if (vistos[id]) {
        maximo++;
        ids[j][0] = maximo;
        corregidos++;
      } else {
        vistos[id] = true;
      }
    }
    if (corregidos > 0) rangoIds.setValues(ids);
  }

  return 'Columna ' + (columnaNueva ? 'creada' : 'ya existía') + '. Costos rellenados: ' + rellenadas +
         '. id_venta repetidos corregidos: ' + corregidos + '.';
}
