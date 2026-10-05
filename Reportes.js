/**
 * Reportes.gs
 * Genera los 4 reportes definidos en el análisis: Control Diario,
 * Inventario General Mensual, Ventas por Producto, y Stock por Empleado.
 *
 * Ningún reporte escribe datos: solo lee y calcula.
 * Toda la lógica de cálculo vive aquí; el HTML solo muestra tablas/gráficos.
 *
 * IMPORTANTE: ninguna de estas funciones se expone directamente al cliente.
 * Se acceden a través de los wrappers apiXxx() en Code.gs.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1) REPORTE DE CONTROL DIARIO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Para una fecha dada, por cada producto activo devuelve:
 * existencia inicial del día (sobrante de ayer), entradas, ventas,
 * existencias al cierre y ganancia del día.
 *
 * @param {string} fecha  'YYYY-MM-DD'
 * @returns {Array<Object>}
 */
function reporteControlDiario(fecha) {
  var productos = listarProductosActivos();
  var inicioDia = new Date(fecha + 'T00:00:00');
  var finDia    = new Date(fecha + 'T23:59:59');

  return productos.map(function (producto) {
    var entradasHoy = sumarMovimientosEnRango_(
      producto.id_producto, TIPO_MOVIMIENTO.INGRESO_PROVEEDOR, inicioDia, finDia
    );
    var ventasHoy = sumarVentasEnRango_(producto.id_producto, inicioDia, finDia);

    // Reconstruye el sobrante de ayer sin necesidad de snapshot:
    // stock_total actual MENOS lo que entró/salió HOY.
    var movHoy = sumarTodosLosMovimientosEnRango_(producto.id_producto, inicioDia, finDia);
    var existenciaInicial = Number(producto.stock_total) - movHoy.entradas + movHoy.salidas;

    var margenUnitario  = Number(producto.precio_venta) - Number(producto.precio_costo);
    var gananciaDelDia  = ventasHoy * margenUnitario;
    var existenciasCierre = existenciaInicial + entradasHoy - ventasHoy;

    return {
      codigo_producto:    producto.codigo_producto,
      nombre_producto:    producto.nombre_producto,
      unidad_medida:      producto.unidad_medida,
      existencia_inicial: existenciaInicial,
      entradas:           entradasHoy,
      ventas:             ventasHoy,
      existencias_cierre: existenciasCierre,
      ganancia_dia:       redondear2_(gananciaDelDia)
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) REPORTE DE INVENTARIO GENERAL MENSUAL
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Para un mes dado, por cada producto activo devuelve:
 * unidad de medida, entradas/salidas acumuladas, existencias,
 * inversión, ganancia realizada y ganancia potencial.
 *
 * Entradas  = movimientos Ingreso_Proveedor   (confirmado con el usuario)
 * Salidas   = movimientos Asignacion_Empleado (confirmado con el usuario)
 *
 * @param {number} anio
 * @param {number} mes   1-12
 * @returns {Array<Object>}
 */
function reporteInventarioMensual(anio, mes) {
  var productos  = listarProductosActivos();
  var inicioMes  = new Date(anio, mes - 1, 1,  0,  0,  0);
  var finMes     = new Date(anio, mes,     0, 23, 59, 59);

  return productos.map(function (producto) {
    var entradasMes = sumarMovimientosEnRango_(
      producto.id_producto, TIPO_MOVIMIENTO.INGRESO_PROVEEDOR,   inicioMes, finMes
    );
    var salidasMes  = sumarMovimientosEnRango_(
      producto.id_producto, TIPO_MOVIMIENTO.ASIGNACION_EMPLEADO, inicioMes, finMes
    );
    var ventasMes   = sumarVentasEnRango_(producto.id_producto, inicioMes, finMes);

    var margenUnitario   = Number(producto.precio_venta) - Number(producto.precio_costo);
    var inversionActual  = redondear2_(Number(producto.precio_costo) * Number(producto.stock_total));
    var gananciaRealizada= redondear2_(ventasMes * margenUnitario);
    var gananciaPotencial= redondear2_(Number(producto.stock_total) * margenUnitario);

    return {
      codigo_producto:    producto.codigo_producto,
      nombre_producto:    producto.nombre_producto,
      unidad_medida:      producto.unidad_medida,
      entradas:           entradasMes,
      salidas:            salidasMes,
      existencias:        Number(producto.stock_total),
      inversion:          inversionActual,
      ganancia_realizada: gananciaRealizada,
      ganancia_potencial: gananciaPotencial
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) REPORTE DE VENTAS POR PRODUCTO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cantidad total vendida y monto por producto en un rango de fechas,
 * con filtro opcional por empleado.
 * Devuelve array ordenado de mayor a menor cantidad.
 *
 * @param {string}      fechaDesde  'YYYY-MM-DD'
 * @param {string}      fechaHasta  'YYYY-MM-DD'
 * @param {string|null} idEmpleado  null = todos
 * @returns {Array<Object>}
 */
function reporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado) {
  var ventas = idEmpleado
    ? listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta)
    : listarTodasLasVentas(fechaDesde, fechaHasta);

  var acumulado = {};
  ventas.forEach(function (venta) {
    var key = venta.id_producto;
    if (!acumulado[key]) {
      acumulado[key] = {
        id_producto:     venta.id_producto,
        codigo_producto: venta.codigo_producto || '',
        nombre_producto: venta.nombre_producto || '—',
        cantidad_total:  0,
        monto_total:     0
      };
    }
    acumulado[key].cantidad_total += Number(venta.cantidad_vendida);
    acumulado[key].monto_total    += Number(venta.cantidad_vendida) * Number(venta.precio_venta_aplicado);
  });

  return Object.keys(acumulado).map(function (key) {
    acumulado[key].monto_total = redondear2_(acumulado[key].monto_total);
    return acumulado[key];
  }).sort(function (a, b) {
    return b.cantidad_total - a.cantidad_total;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) REPORTE DE STOCK POR EMPLEADO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Detalle de lo que cada empleado activo tiene asignado actualmente.
 * Útil para conciliación física de inventario en campo.
 *
 * @returns {Array<Object>}
 */
function reporteStockPorEmpleado() {
  var empleados = listarEmpleadosActivos();

  return empleados.map(function (empleado) {
    var stock = listarStockDeEmpleado(empleado.id_empleado);
    var valorTotal = stock.reduce(function (total, item) {
      return total + (item.cantidad_disponible * Number(item.precio_venta));
    }, 0);

    return {
      id_empleado:          empleado.id_empleado,
      nombre_empleado:      empleado.nombre_empleado,
      productos:            stock,
      total_productos:      stock.length,
      valor_total_asignado: redondear2_(valorTotal)
    };
  });
}

/* ─────────────────────────── Funciones internas ─────────────────────────── */

/**
 * Suma la cantidad de movimientos de un tipo específico para un producto
 * dentro de un rango de fechas (inclusive).
 */
function sumarMovimientosEnRango_(idProducto, tipoMovimiento, fechaInicio, fechaFin) {
  var movimientos = findRecordsWhere_(SHEET_NAMES.MOVIMIENTOS, function (m) {
    if (m.id_producto != idProducto || m.tipo_movimiento !== tipoMovimiento) return false;
    var fecha = new Date(m.fecha_movimiento);
    return fecha >= fechaInicio && fecha <= fechaFin;
  });

  return movimientos.reduce(function (total, m) {
    return total + Number(m.cantidad);
  }, 0);
}

/**
 * Suma TODOS los movimientos de un producto en un rango, separando
 * entradas de salidas — para reconstruir la existencia inicial del día.
 *
 * Entradas al stock_total: Ingreso_Proveedor, Devolucion_Empleado, Devolucion_Cliente
 * Salidas  del stock_total: Asignacion_Empleado
 */
function sumarTodosLosMovimientosEnRango_(idProducto, fechaInicio, fechaFin) {
  var movimientos = findRecordsWhere_(SHEET_NAMES.MOVIMIENTOS, function (m) {
    if (m.id_producto != idProducto) return false;
    var fecha = new Date(m.fecha_movimiento);
    return fecha >= fechaInicio && fecha <= fechaFin;
  });

  var tiposEntrada = [
    TIPO_MOVIMIENTO.INGRESO_PROVEEDOR,
    TIPO_MOVIMIENTO.DEVOLUCION_EMPLEADO,
    TIPO_MOVIMIENTO.DEVOLUCION_CLIENTE
  ];

  var entradas = 0;
  var salidas  = 0;
  movimientos.forEach(function (m) {
    if (tiposEntrada.indexOf(m.tipo_movimiento) !== -1) {
      entradas += Number(m.cantidad);
    } else if (m.tipo_movimiento === TIPO_MOVIMIENTO.ASIGNACION_EMPLEADO) {
      salidas += Number(m.cantidad);
    }
  });

  return { entradas: entradas, salidas: salidas };
}

/**
 * Suma las unidades vendidas de un producto dentro de un rango de fechas.
 */
function sumarVentasEnRango_(idProducto, fechaInicio, fechaFin) {
  var ventas = findRecordsWhere_(SHEET_NAMES.VENTAS, function (v) {
    if (v.id_producto != idProducto) return false;
    var fecha = new Date(v.fecha_venta);
    return fecha >= fechaInicio && fecha <= fechaFin;
  });

  return ventas.reduce(function (total, v) {
    return total + Number(v.cantidad_vendida);
  }, 0);
}

/**
 * Redondea a 2 decimales evitando errores de coma flotante.
 * (ej. 0.1 + 0.2 = 0.30000000000000004)
 */
function redondear2_(numero) {
  return Math.round(numero * 100) / 100;
}
