/**
 * Code.gs
 * Punto de entrada de la Web App. Sirve las vistas según el rol elegido
 * y expone las funciones que el frontend invoca vía google.script.run.
 *
 * Despliegue recomendado:
 *   - Ejecutar como: Yo (el propietario/administrador)
 *   - Quién tiene acceso: Cualquiera con una cuenta de Google
 *
 * Esto permite que el empleado entre sin necesidad de tener permisos sobre
 * el Spreadsheet (solo necesita estar logueado en cualquier cuenta Google),
 * mientras que la vista de administrador queda protegida por correo.
 */

/**
 * Lista de correos autorizados como Administrador.
 * Se lee de las Propiedades del script (Configuración del proyecto >
 * Propiedades de la secuencia de comandos) en la clave CORREOS_ADMIN,
 * con los correos separados por coma. Así no quedan en el repositorio.
 */
function obtenerCorreosAdmin() {
  const valor = PropertiesService.getScriptProperties().getProperty('CORREOS_ADMIN') || '';
  return valor.split(',').map(function (c) { return c.trim(); }).filter(String);
}

/**
 * Verifica en el servidor que quien invoca la función es administrador.
 * El frontend (google.script.run) puede ser llamado por cualquiera que conozca
 * la URL, así que cada función de administrador debe empezar con esta llamada.
 * Si el correo no se puede determinar o no está autorizado, lanza un error.
 */
function exigirAdmin_() {
  const correo = Session.getActiveUser().getEmail();
  if (!correo || obtenerCorreosAdmin().indexOf(correo) === -1) {
    throw new Error('Acceso denegado: esta acción es solo para el administrador.');
  }
}

/**
 * Punto de entrada único de la Web App.
 * Parámetros de URL soportados (opcionales):
 *   ?vista=login            (default) pantalla de selección de rol
 *   ?vista=admin            panel de administrador (protegido por correo)
 *   ?vista=empleado         formulario de ventas del empleado
 */
/**
 * Punto de entrada único de la Web App.
 * Parámetros de URL soportados (opcionales):
 *   ?vista=login                          (default) pantalla de selección de rol
 *   ?vista=admin                          panel de administrador (protegido por correo)
 *   ?vista=empleado&id_empleado=N         formulario de ventas del empleado
 */
function doGet(e) {
  const vista = (e && e.parameter && e.parameter.vista) || 'login';
  const urlBase = ScriptApp.getService().getUrl();

  if (vista === 'admin') {
    const correoActivo = Session.getActiveUser().getEmail();
    const autorizado = correoActivo && obtenerCorreosAdmin().indexOf(correoActivo) !== -1;

    if (!autorizado) {
      return HtmlService.createHtmlOutput(
        '<p style="font-family:sans-serif; padding:24px;">' +
        'Acceso restringido. Esta vista solo está disponible para el administrador autorizado, ' +
        'y debes abrir el enlace con tu cuenta de Google con acceso al documento.</p>'
      );
    }
  }

  let plantilla;

  if (vista === 'admin') {
    plantilla = HtmlService.createTemplateFromFile('Admin');
    plantilla.urlBase = urlBase;

  } else if (vista === 'empleado') {
    const idEmpleadoParam = e.parameter.id_empleado;

    if (!idEmpleadoParam) {
      plantilla = HtmlService.createTemplateFromFile('Login');
      plantilla.urlBase = urlBase;
    } else {
      let empleado;
      try {
        empleado = obtenerEmpleadoPorId(idEmpleadoParam);
      } catch (err) {
        empleado = null;
      }

      if (!empleado || empleado.activo !== true) {
        return HtmlService.createHtmlOutput(
          '<p style="font-family:sans-serif; padding:24px;">' +
          'El empleado indicado no existe o ya no está activo. ' +
          'Vuelve a la <a href="' + urlBase + '">pantalla de inicio</a> e intenta de nuevo.</p>'
        );
      }

      plantilla = HtmlService.createTemplateFromFile('Empleado');
      plantilla.idEmpleado = empleado.id_empleado;
      plantilla.nombreEmpleado = empleado.nombre_empleado;
      plantilla.urlBase = urlBase;
    }

  } else {
    plantilla = HtmlService.createTemplateFromFile('Login');
    plantilla.urlBase = urlBase;
  }

  return plantilla.evaluate()
    .setTitle('Control de Inventario')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/**
 * Permite incluir archivos HTML parciales dentro de una plantilla,
 * ej.: <?!= include('Estilos'); ?> dentro de Login.html / Admin.html / Empleado.html
 */
function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

/* ───────────────────── Resolución de rol / identidad ───────────────────── */

/**
 * Devuelve la lista de empleados activos para poblar el selector de
 * "elige tu nombre" en la pantalla de login del empleado (sin contraseña).
 */
function obtenerListaEmpleadosParaLogin() {
  return listarEmpleadosActivos().map(function (e) {
    return { id_empleado: e.id_empleado, nombre_empleado: e.nombre_empleado };
  });
}

/* ───────────────────── Funciones puente: Productos (admin) ───────────────────── */

function apiListarProductosActivos() {
  exigirAdmin_();
  return listarProductosActivos();
}

function apiListarTodosLosProductos() {
  exigirAdmin_();
  return listarTodosLosProductos();
}

function apiCrearProducto(datos) {
  exigirAdmin_();
  return crearProducto(datos);
}

function apiEditarProducto(idProducto, cambios) {
  exigirAdmin_();
  return editarProducto(idProducto, cambios);
}

function apiDesactivarProducto(idProducto) {
  exigirAdmin_();
  return desactivarProducto(idProducto);
}

function apiReactivarProducto(idProducto) {
  exigirAdmin_();
  return reactivarProducto(idProducto);
}

/* ───────────────────── Funciones puente: Proveedores (admin) ───────────────────── */

function apiListarProveedoresActivos() {
  exigirAdmin_();
  return listarProveedoresActivos();
}

function apiListarTodosLosProveedores() {
  exigirAdmin_();
  return listarTodosLosProveedores();
}

function apiCrearProveedor(datos) {
  exigirAdmin_();
  return crearProveedor(datos);
}

function apiEditarProveedor(idProveedor, cambios) {
  exigirAdmin_();
  return editarProveedor(idProveedor, cambios);
}

function apiDesactivarProveedor(idProveedor) {
  exigirAdmin_();
  return desactivarProveedor(idProveedor);
}

function apiReactivarProveedor(idProveedor) {
  exigirAdmin_();
  return reactivarProveedor(idProveedor);
}

/* ───────────────────── Funciones puente: Empleados (admin) ───────────────────── */

function apiListarEmpleadosActivos() {
  exigirAdmin_();
  return listarEmpleadosActivos();
}

function apiListarTodosLosEmpleados() {
  exigirAdmin_();
  return listarTodosLosEmpleados();
}

function apiCrearEmpleado(datos) {
  exigirAdmin_();
  return crearEmpleado(datos);
}

function apiEditarEmpleado(idEmpleado, cambios) {
  exigirAdmin_();
  return editarEmpleado(idEmpleado, cambios);
}

function apiDesactivarEmpleado(idEmpleado) {
  exigirAdmin_();
  return desactivarEmpleado(idEmpleado);
}

function apiReactivarEmpleado(idEmpleado) {
  exigirAdmin_();
  return reactivarEmpleado(idEmpleado);
}

/* ───────────────────── Funciones puente: Movimientos (admin) ───────────────────── */

function apiRegistrarIngresoProveedor(datos) {
  exigirAdmin_();
  return registrarIngresoProveedor(datos);
}

function apiRegistrarAsignacionEmpleado(datos) {
  exigirAdmin_();
  return registrarAsignacionEmpleado(datos);
}

function apiRegistrarDevolucionEmpleado(datos) {
  exigirAdmin_();
  return registrarDevolucionEmpleado(datos);
}

function apiRegistrarDevolucionCliente(datos) {
  exigirAdmin_();
  return registrarDevolucionCliente(datos);
}

/* ───────────────────── Funciones puente: Ventas y reportes (admin) ───────────────────── */

function apiRegistrarVenta(datos) {
  exigirAdmin_();
  return registrarVenta(datos.id_empleado, datos.id_producto, datos.cantidad_vendida, datos.precio_venta_aplicado);
}

function apiListarTodasLasVentas(fechaDesde, fechaHasta) {
  exigirAdmin_();
  return listarTodasLasVentas(fechaDesde, fechaHasta);
}

function apiCalcularTotalVendidoPorEmpleado(idEmpleado, fechaDesde, fechaHasta) {
  exigirAdmin_();
  return calcularTotalVendidoPorEmpleado(idEmpleado, fechaDesde, fechaHasta);
}

function apiReporteControlDiario(fecha) {
  exigirAdmin_();
  return reporteControlDiario(fecha);
}

function apiReporteInventarioMensual(anio, mes) {
  exigirAdmin_();
  return reporteInventarioMensual(anio, mes);
}

function apiReporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado) {
  exigirAdmin_();
  return reporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado);
}

function apiReporteDashboardInventario() {
  exigirAdmin_();
  return reporteDashboardInventario();
}

function apiReporteStockPorEmpleado() {
  exigirAdmin_();
  return reporteStockPorEmpleado();
}

/* ───────────────────── Funciones puente: vista de empleado ─────────────────────
   Las usa el formulario del empleado (sin login por contraseña), por eso no
   exigen administrador. Solo operan sobre un empleado activo. */

function apiListarStockDeEmpleado(idEmpleado) {
  return listarStockDeEmpleado(idEmpleado);
}

function apiListarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta) {
  return listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta);
}

function apiRegistrarOrdenVenta(idEmpleado, lineas) {
  const empleado = obtenerEmpleadoPorId(idEmpleado);
  if (!empleado || empleado.activo !== true) {
    throw new Error('El empleado no existe o no está activo.');
  }
  return registrarOrdenVenta(idEmpleado, lineas);
}
