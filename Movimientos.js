/**
 * Movimientos.gs
 * Orquesta los movimientos de inventario: ingreso de proveedor, asignación a
 * empleado, y devoluciones en ambos sentidos. Es el único módulo autorizado
 * a modificar stock_total (vía ajustarStockTotal_) y Stock_Empleado.
 *
 * Depende de: DataAccess.gs, Productos.gs, Empleados.gs
 */

const TIPO_MOVIMIENTO = {
  INGRESO_PROVEEDOR: 'Ingreso_Proveedor',
  ASIGNACION_EMPLEADO: 'Asignacion_Empleado',
  DEVOLUCION_EMPLEADO: 'Devolucion_Empleado',
  DEVOLUCION_CLIENTE: 'Devolucion_Cliente'
};

/**
 * 1) INGRESO DE PROVEEDOR
 * Suma cantidad al inventario general (stock_total) y registra el movimiento.
 *
 * datos esperado: { id_producto, cantidad, usuario_registro, observaciones }
 */
function registrarIngresoProveedor(datos) {
  validarCantidadPositiva_(datos.cantidad);
  const producto = obtenerProductoPorId(datos.id_producto); // lanza error si no existe

  ajustarStockTotal_(producto.id_producto, Number(datos.cantidad));

  return registrarMovimiento_({
    id_producto: producto.id_producto,
    tipo_movimiento: TIPO_MOVIMIENTO.INGRESO_PROVEEDOR,
    cantidad: Number(datos.cantidad),
    id_empleado: '', // no aplica en este tipo
    usuario_registro: datos.usuario_registro || '',
    observaciones: datos.observaciones || ''
  });
}

/**
 * 2) ASIGNACIÓN A EMPLEADO
 * Resta del inventario general, suma al sub-stock del empleado, y registra el movimiento.
 * Es una operación de dos pasos que debe ser atómica en términos lógicos: si falla
 * la resta del inventario general, nunca debe llegar a sumar al empleado.
 *
 * datos esperado: { id_producto, id_empleado, cantidad, usuario_registro, observaciones }
 */
function registrarAsignacionEmpleado(datos) {
  validarCantidadPositiva_(datos.cantidad);
  const producto = obtenerProductoPorId(datos.id_producto);
  const empleado = obtenerEmpleadoPorId(datos.id_empleado);

  if (empleado.activo !== true) {
    throw new Error('No se puede asignar stock a un empleado inactivo (' + empleado.nombre_empleado + ').');
  }

  const cantidad = Number(datos.cantidad);

  // Paso 1: resta del inventario general (ajustarStockTotal_ ya valida que no quede negativo)
  ajustarStockTotal_(producto.id_producto, -cantidad);

  // Paso 2: suma al sub-stock del empleado
  sumarStockEmpleado_(producto.id_producto, empleado.id_empleado, cantidad);

  // Paso 3: deja constancia del movimiento
  return registrarMovimiento_({
    id_producto: producto.id_producto,
    tipo_movimiento: TIPO_MOVIMIENTO.ASIGNACION_EMPLEADO,
    cantidad: cantidad,
    id_empleado: empleado.id_empleado,
    usuario_registro: datos.usuario_registro || '',
    observaciones: datos.observaciones || ''
  });
}

/**
 * 3) DEVOLUCIÓN DE EMPLEADO → INVENTARIO GENERAL
 * Producto NO vendido que el empleado regresa. Resta de su sub-stock,
 * suma de vuelta al inventario general.
 *
 * datos esperado: { id_producto, id_empleado, cantidad, usuario_registro, observaciones }
 */
function registrarDevolucionEmpleado(datos) {
  validarCantidadPositiva_(datos.cantidad);
  const producto = obtenerProductoPorId(datos.id_producto);
  const empleado = obtenerEmpleadoPorId(datos.id_empleado);
  const cantidad = Number(datos.cantidad);

  // Paso 1: resta del sub-stock del empleado (valida que tenga suficiente disponible)
  restarStockEmpleado_(producto.id_producto, empleado.id_empleado, cantidad);

  // Paso 2: regresa al inventario general
  ajustarStockTotal_(producto.id_producto, cantidad);

  // Paso 3: deja constancia
  return registrarMovimiento_({
    id_producto: producto.id_producto,
    tipo_movimiento: TIPO_MOVIMIENTO.DEVOLUCION_EMPLEADO,
    cantidad: cantidad,
    id_empleado: empleado.id_empleado,
    usuario_registro: datos.usuario_registro || '',
    observaciones: datos.observaciones || ''
  });
}

/**
 * 4) DEVOLUCIÓN DE CLIENTE FINAL → EMPLEADO
 * Producto YA vendido que el cliente regresa. A diferencia de la devolución
 * de empleado, esta parte de una venta existente (no de stock libre), y
 * actualiza el estado de esa venta. El producto regresa al sub-stock del
 * empleado, que es quien decide si lo revende o lo aparta (esa decisión
 * posterior se maneja con otro movimiento si aplica).
 *
 * datos esperado: { id_venta, usuario_registro, observaciones }
 */
function registrarDevolucionCliente(datos) {
  const venta = findRecordBy_(SHEET_NAMES.VENTAS, 'id_venta', datos.id_venta);
  if (!venta) {
    throw new Error('No existe una venta con id_venta = ' + datos.id_venta);
  }
  if (venta.estado_devolucion === 'Devuelto_Cliente') {
    throw new Error('Esta venta ya fue marcada como devuelta anteriormente.');
  }

  const cantidad = Number(venta.cantidad_vendida);

  // Paso 1: el producto regresa físicamente al sub-stock del empleado que la vendió
  sumarStockEmpleado_(venta.id_producto, venta.id_empleado, cantidad);

  // Paso 2: se marca la venta como devuelta (trazabilidad de la transacción original)
  updateRecord_(SHEET_NAMES.VENTAS, venta._rowIndex, { estado_devolucion: 'Devuelto_Cliente' });

  // Paso 3: se registra el movimiento de inventario correspondiente
  return registrarMovimiento_({
    id_producto: venta.id_producto,
    tipo_movimiento: TIPO_MOVIMIENTO.DEVOLUCION_CLIENTE,
    cantidad: cantidad,
    id_empleado: venta.id_empleado,
    usuario_registro: datos.usuario_registro || '',
    observaciones: datos.observaciones || ('Devolución de la venta #' + venta.id_venta)
  });
}

/* ───────────────────────── Funciones internas ───────────────────────── */

/**
 * Inserta el registro de auditoría en Movimientos_Stock.
 * Toda función pública de este archivo debe terminar llamando a esta.
 */
function registrarMovimiento_(datos) {
  const movimiento = {
    id_producto: datos.id_producto,
    tipo_movimiento: datos.tipo_movimiento,
    cantidad: datos.cantidad,
    fecha_movimiento: new Date(),
    id_empleado: datos.id_empleado || '',
    usuario_registro: datos.usuario_registro || '',
    observaciones: datos.observaciones || ''
  };
  return insertRecord_(SHEET_NAMES.MOVIMIENTOS, movimiento, 'id_movimiento');
}

/**
 * Suma cantidad al sub-stock de un empleado para un producto.
 * Si no existe el registro en Stock_Empleado, lo crea.
 */
function sumarStockEmpleado_(idProducto, idEmpleado, cantidad) {
  const registro = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
    return s.id_producto == idProducto && s.id_empleado == idEmpleado;
  })[0];

  if (registro) {
    const nuevaCantidad = Number(registro.cantidad_asignada) + cantidad;
    updateRecord_(SHEET_NAMES.STOCK_EMPLEADO, registro._rowIndex, { cantidad_asignada: nuevaCantidad });
  } else {
    insertRecord_(SHEET_NAMES.STOCK_EMPLEADO, {
      id_producto: idProducto,
      id_empleado: idEmpleado,
      cantidad_asignada: cantidad
    }, 'id_stock_empleado');
  }
}

/**
 * Resta cantidad del sub-stock de un empleado para un producto.
 * Lanza error si no tiene suficiente disponible (evita negativos).
 */
function restarStockEmpleado_(idProducto, idEmpleado, cantidad) {
  const registro = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
    return s.id_producto == idProducto && s.id_empleado == idEmpleado;
  })[0];

  const disponible = registro ? Number(registro.cantidad_asignada) : 0;

  if (disponible < cantidad) {
    const producto = obtenerProductoPorId(idProducto);
    const empleado = obtenerEmpleadoPorId(idEmpleado);
    throw new Error(
      'Stock insuficiente: ' + empleado.nombre_empleado + ' solo tiene ' + disponible +
      ' unidades de "' + producto.nombre_producto + '" (se intentó restar ' + cantidad + ').'
    );
  }

  updateRecord_(SHEET_NAMES.STOCK_EMPLEADO, registro._rowIndex, {
    cantidad_asignada: disponible - cantidad
  });
}

/**
 * Devuelve el stock que un empleado tiene de un producto específico (0 si no tiene registro).
 * Usado por Ventas.gs para validar antes de registrar una venta.
 */
function obtenerStockEmpleado(idProducto, idEmpleado) {
  const registro = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
    return s.id_producto == idProducto && s.id_empleado == idEmpleado;
  })[0];

  return registro ? Number(registro.cantidad_asignada) : 0;
}

/**
 * Devuelve todo el stock asignado a un empleado (todos sus productos),
 * con cantidad > 0 únicamente. Es lo que alimenta el formulario de venta:
 * el desplegable de "productos disponibles" + el cuadro de cantidades.
 */
function listarStockDeEmpleado(idEmpleado) {
  const registros = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
    return s.id_empleado == idEmpleado && Number(s.cantidad_asignada) > 0;
  });

  return registros.map(function (registro) {
    const producto = obtenerProductoPorId(registro.id_producto);
    return {
      id_producto: producto.id_producto,
      codigo_producto: producto.codigo_producto,
      nombre_producto: producto.nombre_producto,
      precio_venta: producto.precio_venta,
      cantidad_disponible: Number(registro.cantidad_asignada)
    };
  });
}

/**
 * Valida que una cantidad sea un número positivo mayor a cero.
 */
function validarCantidadPositiva_(cantidad) {
  const num = Number(cantidad);
  if (isNaN(num) || num <= 0) {
    throw new Error('La cantidad debe ser un número mayor a cero.');
  }
}
