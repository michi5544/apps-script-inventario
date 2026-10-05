/**
 * Empleados.gs
 * Lógica de negocio para el catálogo de empleados (rol Administrador).
 */

/**
 * Devuelve todos los empleados activos, ordenados por nombre.
 * Uso típico: poblar el selector de "elige tu nombre" en la pantalla del empleado.
 */
function listarEmpleadosActivos() {
  const empleados = findRecordsWhere_(SHEET_NAMES.EMPLEADOS, function (e) {
    return e.activo === true;
  });
  return empleados.sort(function (a, b) {
    return a.nombre_empleado.localeCompare(b.nombre_empleado);
  });
}

/**
 * Devuelve todos los empleados (activos e inactivos), para la vista de administración.
 */
function listarTodosLosEmpleados() {
  return readTable_(SHEET_NAMES.EMPLEADOS);
}

/**
 * Busca un empleado por su id_empleado.
 */
function obtenerEmpleadoPorId(idEmpleado) {
  const empleado = findRecordBy_(SHEET_NAMES.EMPLEADOS, 'id_empleado', idEmpleado);
  if (!empleado) {
    throw new Error('No existe un empleado con id_empleado = ' + idEmpleado);
  }
  return empleado;
}

/**
 * Busca un empleado por correo, útil si se decide habilitar login por correo más adelante.
 */
function obtenerEmpleadoPorCorreo(correo) {
  return findRecordBy_(SHEET_NAMES.EMPLEADOS, 'correo', correo);
}

/**
 * Crea un nuevo empleado. Valida que el correo no esté repetido (si se proporciona).
 *
 * datos esperado: { nombre_empleado, correo }
 */
function crearEmpleado(datos) {
  if (!datos.nombre_empleado) {
    throw new Error('El campo "nombre_empleado" es obligatorio.');
  }

  if (datos.correo) {
    const existente = obtenerEmpleadoPorCorreo(datos.correo);
    if (existente) {
      throw new Error('Ya existe un empleado registrado con el correo "' + datos.correo + '".');
    }
  }

  const nuevoEmpleado = {
    nombre_empleado: datos.nombre_empleado,
    correo: datos.correo || '',
    activo: true
  };

  return insertRecord_(SHEET_NAMES.EMPLEADOS, nuevoEmpleado, 'id_empleado');
}

/**
 * Edita los datos de un empleado.
 */
function editarEmpleado(idEmpleado, cambios) {
  const empleado = obtenerEmpleadoPorId(idEmpleado);

  if (cambios.correo && cambios.correo !== empleado.correo) {
    const existente = obtenerEmpleadoPorCorreo(cambios.correo);
    if (existente) {
      throw new Error('Ya existe otro empleado con el correo "' + cambios.correo + '".');
    }
  }

  updateRecord_(SHEET_NAMES.EMPLEADOS, empleado._rowIndex, cambios);
  return obtenerEmpleadoPorId(idEmpleado);
}

/**
 * Desactiva un empleado (borrado lógico).
 * IMPORTANTE: antes de desactivar, se debe verificar que no tenga stock
 * pendiente asignado, o el inventario quedaría "atrapado" con un empleado inactivo.
 */
function desactivarEmpleado(idEmpleado) {
  const stockPendiente = findRecordsWhere_(SHEET_NAMES.STOCK_EMPLEADO, function (s) {
    return s.id_empleado == idEmpleado && Number(s.cantidad_asignada) > 0;
  });

  if (stockPendiente.length > 0) {
    throw new Error('No se puede desactivar: el empleado tiene stock pendiente asignado. Debe devolverlo al inventario general primero.');
  }

  const empleado = obtenerEmpleadoPorId(idEmpleado);
  updateRecord_(SHEET_NAMES.EMPLEADOS, empleado._rowIndex, { activo: false });
  return true;
}

/**
 * Reactiva un empleado previamente desactivado.
 */
function reactivarEmpleado(idEmpleado) {
  const empleado = obtenerEmpleadoPorId(idEmpleado);
  updateRecord_(SHEET_NAMES.EMPLEADOS, empleado._rowIndex, { activo: true });
  return true;
}