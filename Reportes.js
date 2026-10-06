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

  // Una sola lectura de Ventas para todos los productos.
  // Las ventas devueltas por el cliente no cuentan (ni unidades ni ganancia).
  var ventasPorProducto = resumenVentasPorProducto_(inicioDia, finDia);

  return productos.map(function (producto) {
    var entradasHoy = sumarMovimientosEnRango_(
      producto.id_producto, TIPO_MOVIMIENTO.INGRESO_PROVEEDOR, inicioDia, finDia
    );
    var resumenVentas = ventasPorProducto[producto.id_producto] || { unidades: 0, ganancia: 0 };
    var ventasHoy = resumenVentas.unidades;

    // Reconstruye el sobrante de ayer sin necesidad de snapshot:
    // stock_total actual MENOS lo que entró/salió HOY.
    var movHoy = sumarTodosLosMovimientosEnRango_(producto.id_producto, inicioDia, finDia);
    var existenciaInicial = Number(producto.stock_total) - movHoy.entradas + movHoy.salidas;

    var existenciasCierre = existenciaInicial + entradasHoy - ventasHoy;

    return {
      codigo_producto:    producto.codigo_producto,
      nombre_producto:    producto.nombre_producto,
      unidad_medida:      producto.unidad_medida,
      existencia_inicial: existenciaInicial,
      entradas:           entradasHoy,
      ventas:             ventasHoy,
      existencias_cierre: existenciasCierre,
      ganancia_dia:       redondear2_(resumenVentas.ganancia)
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

  var ventasPorProducto = resumenVentasPorProducto_(inicioMes, finMes);

  return productos.map(function (producto) {
    var entradasMes = sumarMovimientosEnRango_(
      producto.id_producto, TIPO_MOVIMIENTO.INGRESO_PROVEEDOR,   inicioMes, finMes
    );
    var salidasMes  = sumarMovimientosEnRango_(
      producto.id_producto, TIPO_MOVIMIENTO.ASIGNACION_EMPLEADO, inicioMes, finMes
    );
    var resumenVentas = ventasPorProducto[producto.id_producto] || { unidades: 0, ganancia: 0 };

    var margenUnitario   = Number(producto.precio_venta) - Number(producto.precio_costo);
    var inversionActual  = redondear2_(Number(producto.precio_costo) * Number(producto.stock_total));
    // Realizada: usa el costo y precio de cada venta (no los valores actuales del catálogo)
    var gananciaRealizada= redondear2_(resumenVentas.ganancia);
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
 * Por producto, en un rango de fechas y con filtro opcional por empleado:
 *   cantidad_bruta / monto_bruto       todo lo vendido
 *   cantidad_devuelta / monto_devuelto lo que el cliente devolvió
 *   cantidad_total / monto_total       NETO (bruto - devuelto)
 *   ganancia_total                     ganancia neta con el costo de cada venta
 * Devuelve array ordenado de mayor a menor cantidad neta.
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

  var costoActual = mapaCostoActual_();
  var acumulado = {};

  ventas.forEach(function (venta) {
    var key = venta.id_producto;
    if (!acumulado[key]) {
      acumulado[key] = {
        id_producto:       venta.id_producto,
        codigo_producto:   venta.codigo_producto || '',
        nombre_producto:   venta.nombre_producto || '—',
        cantidad_bruta:    0,
        monto_bruto:       0,
        cantidad_devuelta: 0,
        monto_devuelto:    0,
        cantidad_total:    0,
        monto_total:       0,
        ganancia_total:    0
      };
    }
    var acc      = acumulado[key];
    var cantidad = Number(venta.cantidad_vendida);
    var monto    = cantidad * Number(venta.precio_venta_aplicado);

    acc.cantidad_bruta += cantidad;
    acc.monto_bruto    += monto;

    if (esVentaDevuelta_(venta)) {
      acc.cantidad_devuelta += cantidad;
      acc.monto_devuelto    += monto;
    } else {
      acc.cantidad_total += cantidad;
      acc.monto_total    += monto;
      acc.ganancia_total += cantidad * (Number(venta.precio_venta_aplicado) - costoUnitarioDeVenta_(venta, costoActual));
    }
  });

  return Object.keys(acumulado).map(function (key) {
    var acc = acumulado[key];
    acc.monto_bruto    = redondear2_(acc.monto_bruto);
    acc.monto_devuelto = redondear2_(acc.monto_devuelto);
    acc.monto_total    = redondear2_(acc.monto_total);
    acc.ganancia_total = redondear2_(acc.ganancia_total);
    return acc;
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

// ─────────────────────────────────────────────────────────────────────────────
// 5) PANEL (DASHBOARD) DE INVENTARIO
// ─────────────────────────────────────────────────────────────────────────────
/** Existencias totales (bodega + campo) iguales o menores a este valor = "stock bajo". */
var UMBRAL_STOCK_BAJO = 5;
var DIAS_SERIE_DASHBOARD = 30;

/**
 * Datos para el panel visual de inventario, en una sola lectura de cada hoja:
 *  - productos: existencias en bodega y en campo (con vendedores), valor al costo
 *    y estado (critico = 0, bajo = hasta UMBRAL_STOCK_BAJO, optimo = más).
 *  - serie: por cada uno de los últimos 30 días, unidades ingresadas de
 *    proveedor y unidades vendidas netas (sin devoluciones).
 *
 * @returns {{umbral:number, productos:Array<Object>, serie:Array<Object>}}
 */
function reporteDashboardInventario() {
  var tz = Session.getScriptTimeZone();
  var productos = listarProductosActivos();

  var enCampo = {};
  readTable_(SHEET_NAMES.STOCK_EMPLEADO).forEach(function (s) {
    enCampo[s.id_producto] = (enCampo[s.id_producto] || 0) + (Number(s.cantidad_asignada) || 0);
  });

  var items = productos.map(function (p) {
    var bodega = Number(p.stock_total) || 0;
    var campo  = enCampo[p.id_producto] || 0;
    var costo  = Number(p.precio_costo) || 0;
    var total  = bodega + campo;

    return {
      id_producto:     p.id_producto,
      codigo_producto: p.codigo_producto,
      nombre_producto: p.nombre_producto,
      unidad_medida:   p.unidad_medida,
      stock_bodega:    bodega,
      stock_campo:     campo,
      existencias:     total,
      precio_costo:    costo,
      precio_venta:    Number(p.precio_venta) || 0,
      valor_bodega:    redondear2_(bodega * costo),
      valor_campo:     redondear2_(campo * costo),
      estado:          total <= 0 ? 'critico' : (total <= UMBRAL_STOCK_BAJO ? 'bajo' : 'optimo')
    };
  });

  // Serie diaria de los últimos N días (hoy incluido)
  var hoy = new Date();
  var serie = [];
  var indice = {};
  for (var i = DIAS_SERIE_DASHBOARD - 1; i >= 0; i--) {
    var dia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i);
    var clave = Utilities.formatDate(dia, tz, 'yyyy-MM-dd');
    indice[clave] = serie.length;
    serie.push({ fecha: clave, entradas: 0, ventas: 0 });
  }

  readTable_(SHEET_NAMES.MOVIMIENTOS).forEach(function (m) {
    if (m.tipo_movimiento !== TIPO_MOVIMIENTO.INGRESO_PROVEEDOR) return;
    var fecha = new Date(m.fecha_movimiento);
    if (isNaN(fecha.getTime())) return;
    var pos = indice[Utilities.formatDate(fecha, tz, 'yyyy-MM-dd')];
    if (pos !== undefined) serie[pos].entradas += Number(m.cantidad) || 0;
  });

  readTable_(SHEET_NAMES.VENTAS).forEach(function (v) {
    if (esVentaDevuelta_(v)) return;
    var fecha = new Date(v.fecha_venta);
    if (isNaN(fecha.getTime())) return;
    var pos = indice[Utilities.formatDate(fecha, tz, 'yyyy-MM-dd')];
    if (pos !== undefined) serie[pos].ventas += Number(v.cantidad_vendida) || 0;
  });

  return { umbral: UMBRAL_STOCK_BAJO, productos: items, serie: serie };
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

/** Valor de estado_devolucion que escribe registrarDevolucionCliente (Movimientos.js). */
var ESTADO_VENTA_DEVUELTA = 'Devuelto_Cliente';

function esVentaDevuelta_(venta) {
  return venta.estado_devolucion === ESTADO_VENTA_DEVUELTA;
}

/** Mapa id_producto -> precio de costo ACTUAL (respaldo para ventas sin costo guardado). */
function mapaCostoActual_() {
  var mapa = {};
  listarTodosLosProductos().forEach(function (p) {
    mapa[p.id_producto] = Number(p.precio_costo) || 0;
  });
  return mapa;
}

/**
 * Costo unitario de una venta: el guardado al momento de venderla
 * (precio_costo_aplicado) o, si la venta es antigua y no lo tiene, el costo actual.
 */
function costoUnitarioDeVenta_(venta, costoActual) {
  var c = venta.precio_costo_aplicado;
  if (c !== '' && c !== null && c !== undefined && !isNaN(Number(c))) return Number(c);
  return costoActual[venta.id_producto] || 0;
}

/**
 * Lee la hoja Ventas UNA vez y resume por producto, dentro del rango, las
 * unidades netas y la ganancia neta. Las ventas devueltas se excluyen.
 * @returns {Object} { id_producto: { unidades, ganancia } }
 */
function resumenVentasPorProducto_(fechaInicio, fechaFin) {
  var costoActual = mapaCostoActual_();
  var resumen = {};

  readTable_(SHEET_NAMES.VENTAS).forEach(function (v) {
    var fecha = new Date(v.fecha_venta);
    if (isNaN(fecha.getTime()) || fecha < fechaInicio || fecha > fechaFin) return;
    if (esVentaDevuelta_(v)) return;

    var r = resumen[v.id_producto] || (resumen[v.id_producto] = { unidades: 0, ganancia: 0 });
    var cantidad = Number(v.cantidad_vendida);
    r.unidades += cantidad;
    r.ganancia += cantidad * (Number(v.precio_venta_aplicado) - costoUnitarioDeVenta_(v, costoActual));
  });

  return resumen;
}

/**
 * Redondea a 2 decimales evitando errores de coma flotante.
 * (ej. 0.1 + 0.2 = 0.30000000000000004)
 */
function redondear2_(numero) {
  return Math.round(numero * 100) / 100;
}
