/* ==========================================================================
   Meal Planner — js/api.js
   --------------------------------------------------------------------------
   Capa de acceso a datos (TheMealDB). Es la ÚNICA parte de la aplicación que
   realiza peticiones de red. Todo lo que expone devuelve PROMESAS.

   Endpoints públicos utilizados:
     · GET https://www.themealdb.com/api/json/v1/1/filter.php?i={ingrediente}
         → devuelve un arreglo resumido (idMeal, strMeal, strMealThumb, strArea)
           pero NO incluye la categoría.
     · GET https://www.themealdb.com/api/json/v1/1/lookup.php?i={idMeal}
         → devuelve el detalle completo (strCategory, strInstructions,
           strIngredient1..20, strMeasure1..20, strTags, strYoutube).

   Por eso, tras filtrar por ingrediente se lanza una consulta de detalle por
   cada receta mediante Promise.allSettled para completar la categoría: si
   alguna de esas consultas falla, la búsqueda principal NO se cae.

   Variables: window.MealAPI
   ========================================================================== */

(function (global) {
  'use strict';

  var BASE = 'https://www.themealdb.com/api/json/v1/1/';
  var TIMEOUT_MS = 10000;   // tiempo máximo de espera por petición
  var MAX_RESULTADOS = 12;  // máximo de tarjetas mostradas al usuario

  /* ---------------------------------------------------------------------
     Utilidades internas
     --------------------------------------------------------------------- */

  /**
   * Realiza una petición HTTP con fetch y devuelve el JSON.
   * Cubre los errores típicos: timeout, red caída y estado HTTP incorrecto.
   * @param {string} url
   * @returns {Promise<object>}
   */
  function pedir(url) {
    var controlador = new AbortController();
    var temporizador = global.setTimeout(function () {
      controlador.abort();
    }, TIMEOUT_MS);

    return fetch(url, { signal: controlador.signal })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          var error = new Error(
            'TheMealDB respondió con el estado HTTP ' + respuesta.status + '. Inténtalo de nuevo en unos minutos.'
          );
          error.codigo = 'HTTP_' + respuesta.status;
          throw error;
        }
        return respuesta.json();
      })
      .catch(function (error) {
        if (error.name === 'AbortError') {
          var porTiempo = new Error(
            'La solicitud a TheMealDB tardó más de ' + (TIMEOUT_MS / 1000) + ' segundos y se canceló.'
          );
          porTiempo.codigo = 'TIMEOUT';
          throw porTiempo;
        }
        if (error instanceof TypeError) {
          var sinRed = new Error(
            'No se pudo conectar con TheMealDB. Revisa tu conexión a internet e inténtalo otra vez.'
          );
          sinRed.codigo = 'SIN_CONEXION';
          throw sinRed;
        }
        throw error;
      })
      .then(function (datos) {
        global.clearTimeout(temporizador);
        return datos;
      })
      .catch(function (error) {
        global.clearTimeout(temporizador);
        throw error;
      });
  }

  /**
   * Convierte un objeto crudo de TheMealDB al modelo interno de la aplicación.
   * Si un campo no existe (por ejemplo strCategory en filter.php) usa un
   * valor por defecto legible, de modo que la interfaz nunca queda "undefined".
   * @param {object} crudo
   * @returns {{idMeal:string,nombre:string,categoria:string,area:string,imagen:string,etiquetas:string[],instrucciones:string,ingredientes:Array,video:string}}
   */
  function normalizar(crudo) {
    var m = crudo || {};
    var ingredientes = [];
    var i;

    for (i = 1; i <= 20; i++) {
      var nombre = m['strIngredient' + i];
      var medida = m['strMeasure' + i];
      if (nombre && String(nombre).trim() !== '') {
        ingredientes.push({
          ingrediente: String(nombre).trim(),
          medida: medida ? String(medida).trim() : ''
        });
      }
    }

    return {
      idMeal: m.idMeal ? String(m.idMeal) : '',
      nombre: m.strMeal || 'Receta sin nombre',
      categoria: m.strCategory || 'Sin categoría',
      area: m.strArea || 'Sin origen',
      imagen: m.strMealThumb || '',
      etiquetas: (m.strTags || '')
        .split(',')
        .map(function (t) { return t.trim(); })
        .filter(Boolean),
      instrucciones: (m.strInstructions || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      ingredientes: ingredientes,
      video: m.strYoutube || ''
    };
  }

  /**
   * Reduce una receta al subconjunto de datos que necesita el plan semanal.
   * @param {object} receta
   * @returns {object}
   */
  function resumen(receta) {
    return {
      idMeal: receta.idMeal,
      nombre: receta.nombre,
      categoria: receta.categoria,
      area: receta.area,
      imagen: receta.imagen
    };
  }

  /* ---------------------------------------------------------------------
     API pública del módulo
     --------------------------------------------------------------------- */

  /**
   * RF02 — Busca recetas por ingrediente mediante Fetch.
   * @param {string} ingrediente
   * @returns {Promise<Array<object>>} Promesa que resuelve con las recetas normalizadas.
   */
  function buscarPorIngrediente(ingrediente) {
    var limpio = String(ingrediente == null ? '' : ingrediente).trim();

    if (limpio === '') {
      return Promise.reject(
        new Error('Escribe un ingrediente antes de buscar, por ejemplo «chicken» o «egg».')
      );
    }

    return pedir(BASE + 'filter.php?i=' + encodeURIComponent(limpio))
      .then(function (datos) {
        var crudas = datos && datos.meals;

        if (!crudas || crudas.length === 0) {
          var vacio = new Error(
            'No encontramos recetas que incluyan «' + limpio + '». Prueba con otro ingrediente.'
          );
          vacio.codigo = 'SIN_RESULTADOS';
          throw vacio;
        }

        var lista = crudas.slice(0, MAX_RESULTADOS).map(function (m) {
          return normalizar(m);
        });

        // Enriquecimiento: la categoría no viene en filter.php, se pide con lookup.php.
        return Promise.allSettled(
          lista.map(function (receta) {
            return pedir(BASE + 'lookup.php?i=' + encodeURIComponent(receta.idMeal))
              .then(function (detalle) {
                var crudo = detalle && detalle.meals && detalle.meals[0];
                return crudo ? normalizar(crudo) : receta;
              });
          })
        ).then(function (respuestas) {
          respuestas.forEach(function (respuesta, indice) {
            // Un fallo puntual en el enriquecimiento no debe romper la búsqueda.
            if (respuesta.status === 'fulfilled' && respuesta.value) {
              lista[indice] = respuesta.value;
            }
          });
          return lista.map(resumen);
        });
      });
  }

  /**
   * Obtiene el detalle completo de una receta (ingredientes, instrucciones,
   * etiquetas, categoría y video). Se usa en la ventana de detalle.
   * @param {string|number} idMeal
   * @returns {Promise<object>}
   */
  function obtenerDetalle(idMeal) {
    if (!idMeal) {
      return Promise.reject(new Error('No se recibió el identificador de la receta.'));
    }

    return pedir(BASE + 'lookup.php?i=' + encodeURIComponent(idMeal)).then(function (datos) {
      var crudo = datos && datos.meals && datos.meals[0];
      if (!crudo) {
        var fallo = new Error('No se pudo cargar el detalle de esa receta.');
        fallo.codigo = 'SIN_RESULTADOS';
        throw fallo;
      }
      return normalizar(crudo);
    });
  }

  global.MealAPI = {
    buscarPorIngrediente: buscarPorIngrediente,
    obtenerDetalle: obtenerDetalle,
    normalizar: normalizar,
    BASE: BASE
  };
})(window);