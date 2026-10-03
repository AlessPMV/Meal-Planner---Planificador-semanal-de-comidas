/* ==========================================================================
   Meal Planner — js/planner.js
   --------------------------------------------------------------------------
   Módulo de estado del PLAN SEMANAL. No toca el DOM: solo administra los
   datos y avisa a quien esté suscrito cuando el plan cambia (patrón
   "suscriptor / notificador" basado en callbacks).

   Estructura del estado:
     {
       Lunes:    [receta, receta, ...],
       Martes:   [...],
       Miércoles:[...],
       ...
     }
   Cada receta guardada es un resumen: { idMeal, nombre, categoria, area, imagen }

   Variables: window.Planner
   ========================================================================== */

(function (global) {
  'use strict';

  var DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var CLAVE_ALMACEN = 'meal-planner.plan.v1';
  var CODIGOS = { SIN_RESULTADOS: 'SIN_RESULTADOS' };

  var plan = crearVacio();
  var suscriptores = [];

  /* ---------------------------------------------------------------------
     Construcción, validación y persistencia
     --------------------------------------------------------------------- */

  function crearVacio() {
    var vacio = {};
    DIAS.forEach(function (dia) { vacio[dia] = []; });
    return vacio;
  }

  /**
   * Valida el plan guardado en localStorage: si el JSON está corrupto o
   * incompleto, se descarta y se empieza con un plan vacío (RF: manejo de errores).
   */
  function validar(bruto) {
    if (!bruto || typeof bruto !== 'object') { return null; }

    var limpio = crearVacio();
    var valido = true;

    DIAS.forEach(function (dia) {
      var lista = bruto[dia];
      if (lista === undefined) { return; } // día ausente: se queda vacío
      if (!Array.isArray(lista)) { valido = false; return; }

      limpio[dia] = lista.filter(function (receta) {
        return receta && typeof receta === 'object' && receta.idMeal && receta.nombre;
      }).map(function (receta) {
        return {
          idMeal: String(receta.idMeal),
          nombre: String(receta.nombre),
          categoria: receta.categoria || 'Sin categoría',
          area: receta.area || 'Sin origen',
          imagen: receta.imagen || ''
        };
      });
    });

    return valido ? limpio : null;
  }

  function cargar() {
    try {
      var texto = global.localStorage.getItem(CLAVE_ALMACEN);
      if (!texto) { return plan; }
      var guardado = validar(JSON.parse(texto));
      if (guardado) { plan = guardado; }
    } catch (error) {
      // localStorage puede estar bloqueado (por ejemplo en file:// de Chrome)
      // o el JSON guardado puede estar dañado: la app sigue en memoria.
      if (global.console && console.warn) {
        console.warn('[Planner] No se pudo leer el plan guardado:', error.message);
      }
    }
    return plan;
  }

  function guardar() {
    try {
      global.localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(plan));
      return true;
    } catch (error) {
      if (global.console && console.warn) {
        console.warn('[Planner] No se pudo guardar el plan:', error.message);
      }
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     Callbacks: suscripción y notificación
     --------------------------------------------------------------------- */

  /**
   * Registra un callback que se ejecutará cada vez que el plan cambie.
   * Devuelve la función para cancelar la suscripción.
   * @param {Function} callback
   * @returns {Function}
   */
  function suscribir(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('suscribir() espera una función.');
    }
    suscriptores.push(callback);
    return function () {
      var indice = suscriptores.indexOf(callback);
      if (indice > -1) { suscriptores.splice(indice, 1); }
    };
  }

  function notificar(motivo) {
    suscriptores.slice().forEach(function (callback) {
      try {
        callback(plan, motivo);
      } catch (error) {
        if (global.console && console.error) {
          console.error('[Planner] Error en un suscriptor del plan:', error);
        }
      }
    });
  }

  /* ---------------------------------------------------------------------
     Operaciones del plan (RF05, RF06, RF07)
     --------------------------------------------------------------------- */

  function obtenerPlan() { return plan; }

  function obtenerRecetas(dia) {
    return DIAS.indexOf(dia) > -1 ? plan[dia].slice() : [];
  }

  function existe(dia, idMeal) {
    return DIAS.indexOf(dia) > -1 && plan[dia].some(function (r) { return r.idMeal === String(idMeal); });
  }

  /**
   * RF05 — Agrega una receta al día indicado.
   * @returns {{ok:boolean, motivo?:string}}
   */
  function agregar(dia, receta) {
    if (DIAS.indexOf(dia) === -1) {
      return { ok: false, motivo: 'Ese día de la semana no existe.' };
    }
    if (!receta || !receta.idMeal) {
      return { ok: false, motivo: 'La receta recibida no es válida.' };
    }
    if (existe(dia, receta.idMeal)) {
      return { ok: false, motivo: '«' + receta.nombre + '» ya está en ' + dia.toLowerCase() + '.' };
    }

    plan[dia].push({
      idMeal: String(receta.idMeal),
      nombre: receta.nombre,
      categoria: receta.categoria || 'Sin categoría',
      area: receta.area || 'Sin origen',
      imagen: receta.imagen || ''
    });

    guardar();
    notificar('agregar');
    return { ok: true };
  }

  /**
   * RF07 — Elimina una receta del día indicado.
   * @returns {{ok:boolean, receta?:object, motivo?:string}}
   */
  function eliminar(dia, idMeal) {
    if (DIAS.indexOf(dia) === -1) {
      return { ok: false, motivo: 'Ese día de la semana no existe.' };
    }

    var indice = -1;
    for (var i = 0; i < plan[dia].length; i++) {
      if (plan[dia][i].idMeal === String(idMeal)) { indice = i; break; }
    }

    if (indice === -1) {
      return { ok: false, motivo: 'Esa receta no está en ' + dia.toLowerCase() + '.' };
    }

    var quitada = plan[dia].splice(indice, 1)[0];
    guardar();
    notificar('eliminar');
    return { ok: true, receta: quitada };
  }

  /** Vacía los siete días del plan. */
  function limpiar() {
    plan = crearVacio();
    guardar();
    notificar('limpiar');
    return { ok: true };
  }

  /** RF06 — Métricas del menú para los contadores de la interfaz. */
  function contar() {
    var recetas = 0;
    DIAS.forEach(function (dia) { recetas += plan[dia].length; });
    var diasConRecetas = DIAS.filter(function (dia) { return plan[dia].length > 0; });
    return {
      recetas: recetas,
      dias: diasConRecetas.length,
      completo: recetas > 0 && diasConRecetas.length === DIAS.length
    };
  }

  cargar();

  global.Planner = {
    DIAS: DIAS,
    CODIGOS: CODIGOS,
    obtenerPlan: obtenerPlan,
    obtenerRecetas: obtenerRecetas,
    agregar: agregar,
    eliminar: eliminar,
    limpiar: limpiar,
    contar: contar,
    existe: existe,
    suscribir: suscribir,
    notificar: notificar,
    recargar: cargar
  };
})(window);