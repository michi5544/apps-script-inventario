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

/* ───────────────────── Funciones puente: Productos ───────────────────── */

function apiListarProductosActivos() {
  return listarProductosActivos();
}

function apiListarTodosLosProductos() {
  return listarTodosLosProductos();
}

function apiCrearProducto(datos) {
  return crearProducto(datos);
}

function apiEditarProducto(idProducto, cambios) {
  return editarProducto(idProducto, cambios);
}

function apiDesactivarProducto(idProducto) {
  return desactivarProducto(idProducto);
}

function apiReactivarProducto(idProducto) {
  return reactivarProducto(idProducto);
}

/* ───────────────────── Funciones puente: Empleados ───────────────────── */

function apiListarEmpleadosActivos() {
  return listarEmpleadosActivos();
}

function apiListarTodosLosEmpleados() {
  return listarTodosLosEmpleados();
}

function apiCrearEmpleado(datos) {
  return crearEmpleado(datos);
}

function apiEditarEmpleado(idEmpleado, cambios) {
  return editarEmpleado(idEmpleado, cambios);
}

function apiDesactivarEmpleado(idEmpleado) {
  return desactivarEmpleado(idEmpleado);
}

function apiReactivarEmpleado(idEmpleado) {
  return reactivarEmpleado(idEmpleado);
}

/* ───────────────────── Funciones puente: Movimientos ───────────────────── */

function apiRegistrarIngresoProveedor(datos) {
  return registrarIngresoProveedor(datos);
}

function apiRegistrarAsignacionEmpleado(datos) {
  return registrarAsignacionEmpleado(datos);
}

function apiRegistrarDevolucionEmpleado(datos) {
  return registrarDevolucionEmpleado(datos);
}

function apiRegistrarDevolucionCliente(datos) {
  return registrarDevolucionCliente(datos);
}

function apiListarStockDeEmpleado(idEmpleado) {
  return listarStockDeEmpleado(idEmpleado);
}

/* ───────────────────── Funciones puente: Ventas ───────────────────── */

function apiRegistrarVenta(datos) {
  return registrarVenta(datos);
}

function apiListarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta) {
  return listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta);
}

function apiListarTodasLasVentas(fechaDesde, fechaHasta) {
  return listarTodasLasVentas(fechaDesde, fechaHasta);
}

function apiCalcularTotalVendidoPorEmpleado(idEmpleado, fechaDesde, fechaHasta) {
  return calcularTotalVendidoPorEmpleado(idEmpleado, fechaDesde, fechaHasta);
}

/* ───────────────────── Funciones puente: Reportes ───────────────────── */

function apiReporteControlDiario(fecha) {
  return reporteControlDiario(fecha);
}

function apiReporteInventarioMensual(anio, mes) {
  return reporteInventarioMensual(anio, mes);
}

function apiReporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado) {
  return reporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado);
}

function apiReporteStockPorEmpleado() {
  return reporteStockPorEmpleado();
}

function apiPruebaSimple() {
  return [1, 2, 3];
}

function apiPruebaProductosSinFecha() {
  var productos = listarProductosActivos();
  return productos.map(function (p) {
    return {
      id_producto: p.id_producto,
      nombre_producto: p.nombre_producto
      // sin fecha_creacion, sin activo, sin _rowIndex
    };
  });
}


function apiReporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado) {
  return reporteVentasPorProducto(fechaDesde, fechaHasta, idEmpleado);
}

function apiReporteControlDiario(fecha) {
  return reporteControlDiario(fecha);
}

function apiReporteInventarioMensual(anio, mes) {
  return reporteInventarioMensual(anio, mes);
}

function apiReporteStockPorEmpleado() {
  return reporteStockPorEmpleado();
}

/* ══════════════════════════════════════════════════════════════════════
   WRAPPER NUEVO — pegar en Code.gs junto al resto de apiXxx()
══════════════════════════════════════════════════════════════════════ */
 
function apiRegistrarOrdenVenta(idEmpleado, lineas) {
  return registrarOrdenVenta(idEmpleado, lineas);
}
 
// ── Los siguientes ya deben existir; verificar que estén en Code.gs ──
 
// function apiListarStockDeEmpleado(idEmpleado) {
//   return listarStockDeEmpleado(idEmpleado);
// }
 
// function apiListarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta) {
//   return listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta);
// }

// ── Nota: listarVentasDeEmpleado y listarTodasLasVentas ya deben
//    tener sus wrappers (apiListarVentasDeEmpleado / apiListarTodasLasVentas).
//    AdminReportes.html los usa. Si aún no existen, agregar:

// function apiListarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta) {
//   return listarVentasDeEmpleado(idEmpleado, fechaDesde, fechaHasta);
// }

// function apiListarTodasLasVentas(fechaDesde, fechaHasta) {
//   return listarTodasLasVentas(fechaDesde, fechaHasta);
// }