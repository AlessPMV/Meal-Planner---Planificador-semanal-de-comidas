/* ==========================================================================
   Meal Planner — js/app.js
   --------------------------------------------------------------------------
   Capa de presentación: maneja el DOM, los eventos (callbacks), los estados de
   la interfaz y el flujo completo de búsqueda + planificación.

   Flujo (sección 4.9 del enunciado):
     usuario escribe ingrediente → submit → fetch/promesa de MealAPI →
     estado "cargando" → estado "resultados" | "vacio" | "error" →
     click en tarjeta (selección) → elección de día → Planner.agregar() →
     callback del suscriptor → re-render del menú semanal → eliminar con ✕

   Variables: window.App
   ========================================================================== */

(function (global) {
  'use strict';

  var doc = document;

  /* Imagen usada cuando la foto de la API no carga. */
  var IMAGEN_ALTERNATIVA = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
    '<rect width="400" height="300" fill="#e8d6c4"/>' +
    '<text x="200" y="165" font-size="40" text-anchor="middle" fill="#8b7462">&#127859;</text>' +
    '</svg>'
  );

  /* ---------------------------------------------------------------------
     Referencias al DOM
     --------------------------------------------------------------------- */
  var els = {};

  /* ---------------------------------------------------------------------
     Estado local de la vista
     --------------------------------------------------------------------- */
  var resultados = [];        // recetas de la última búsqueda
  var seleccionada = null;     // RF04: receta elegida por el usuario
  var recetaModal = null;     // receta abierta en la ventana de detalle
  var focoPrevio = null;      // elemento con el foco antes de abrir el modal
  var ultimoIngrediente = ''; // último término buscado (para el botón Reintentar)
  var tokenBusqueda = 0;      // evita que una respuesta vieja pise a una nueva
  var tokenDetalle = 0;
  var temporizadorToast = null;

  /* =====================================================================
     Utilidades de ayuda
     ===================================================================== */

  function crear(etiqueta, clases, texto) {
    var nodo = doc.createElement(etiqueta);
    if (clases) { nodo.className = clases; }
    if (texto !== undefined && texto !== null) { nodo.textContent = texto; }
    return nodo;
  }

  function crearImagen(src, alt, clases) {
    var img = crear('img', clases);
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = alt || '';
    img.addEventListener('error', function () {
      img.src = IMAGEN_ALTERNATIVA;
    }, { once: true });
    img.src = src || IMAGEN_ALTERNATIVA;
    return img;
  }

  function idSegurido(texto) {
    return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function esElemento(objeto) {
    return !!objeto && typeof objeto.closest === 'function';
  }

  /* =====================================================================
     1. Estados de la interfaz (cargando / resultados / vacío / error)
     ===================================================================== */

  /**
   * Cambia el estado visible del panel de resultados.
   * @param {'inicial'|'cargando'|'resultados'|'vacio'|'error'} estado
   * @param {string} [mensaje] texto a mostrar en los estados vacío / error
   */
  function pintarEstado(estado, mensaje) {
    els.panelResultados.setAttribute('data-estado', estado);

    Array.prototype.forEach.call(els.estados.querySelectorAll('.estado'), function (bloque) {
      bloque.hidden = bloque.getAttribute('data-estado') !== estado;
    });

    els.gridResultados.hidden = estado !== 'resultados';

    if (estado === 'vacio' && mensaje) {
      els.mensajeVacio.textContent = mensaje;
    }
    if (estado === 'error' && mensaje) {
      els.mensajeError.textContent = mensaje;
    }
    if (estado === 'resultados') {
      var encontrado = resultados.length;
      els.contextoResultados.hidden = false;
      els.contextoResultados.textContent =
        'Resultados para «' + ultimoIngrediente + '» — ' + encontrado +
        (encontrado === 1 ? ' receta encontrada.' : ' recetas encontradas. Haz clic en una para seleccionarla.');
    } else {
      els.contextoResultados.hidden = true;
      els.contextoResultados.textContent = '';
    }
  }

  /* =====================================================================
     2. Búsqueda (RF01, RF02, RF03)
     ===================================================================== */

  /**
   * Ejecuta la búsqueda de recetas por ingrediente.
   * Encadena una promesa (fetch) con los estados de carga y los resultados.
   */
  function buscar(ingrediente) {
    var limpio = String(ingrediente == null ? '' : ingrediente).trim();

    if (limpio === '') {
      els.inputIngrediente.setAttribute('aria-invalid', 'true');
      mostrarToast('Escribe un ingrediente para buscar recetas.', 'alerta');
      els.inputIngrediente.focus();
      return Promise.resolve();
    }

    els.inputIngrediente.removeAttribute('aria-invalid');
    ultimoIngrediente = limpio;
    var miToken = ++tokenBusqueda;

    resultados = [];
    limpiarSeleccion();
    pintarEstado('cargando');
    renderResultados();
    els.btnBuscar.disabled = true;

    return MealAPI.buscarPorIngrediente(limpio)
      .then(function (recetas) {
        if (miToken !== tokenBusqueda) { return; }   // respuesta obsoleta
        resultados = recetas;
        if (recetas.length > 0) {
          pintarEstado('resultados');
          renderResultados();
        } else {
          pintarEstado('vacio');
        }
      })
      .catch(function (error) {
        if (miToken !== tokenBusqueda) { return; }
        resultados = [];
        renderResultados();
        if (error && error.codigo === 'SIN_RESULTADOS') {
          pintarEstado('vacio', error.message);
        } else {
          pintarEstado('error', error && error.message
            ? error.message
            : 'Ocurrió un error inesperado al consultar la API.');
        }
      })
      .then(function () {
        if (miToken === tokenBusqueda) { els.btnBuscar.disabled = false; }
      });
  }

  /* =====================================================================
     3. Renderizado de resultados (RF03)
     ===================================================================== */

  function renderResultados() {
    els.gridResultados.replaceChildren();

    resultados.forEach(function (receta) {
      var esSeleccionada = !!seleccionada && seleccionada.idMeal === receta.idMeal;

      var item = crear('li', 'receta' + (esSeleccionada ? ' es-seleccionada' : ''));
      item.setAttribute('data-id', receta.idMeal);

      var boton = crear('button', 'receta__boton');
      boton.type = 'button';
      boton.setAttribute('aria-pressed', esSeleccionada ? 'true' : 'false');
      boton.setAttribute('aria-label', 'Seleccionar receta ' + receta.nombre);

      var marco = crear('div', 'receta__marco');
      marco.appendChild(crearImagen(receta.imagen, 'Fotografía de ' + receta.nombre, 'receta__img'));
      marco.appendChild(crear('span', 'receta__insignia', esSeleccionada ? 'Seleccionada' : '#' + receta.idMeal));

      var cuerpo = crear('div', 'receta__cuerpo');
      cuerpo.appendChild(crear('h3', 'receta__nombre', receta.nombre));

      var meta = crear('p', 'receta__meta');
      meta.appendChild(crear('span', 'pastilla pastilla--area', receta.area));
      meta.appendChild(crear('span', 'pastilla pastilla--categoria', receta.categoria));
      cuerpo.appendChild(meta);

      boton.appendChild(marco);
      boton.appendChild(cuerpo);

      var pie = crear('div', 'receta__pie');
      pie.appendChild(crear('span', 'receta__id', 'ID ' + receta.idMeal));
      var verDetalle = crear('button', 'boton--mini', 'Ver detalle');
      verDetalle.type = 'button';
      verDetalle.setAttribute('data-accion', 'detalle');
      verDetalle.setAttribute('data-id', receta.idMeal);
      pie.appendChild(verDetalle);

      item.appendChild(boton);
      item.appendChild(pie);
      els.gridResultados.appendChild(item);
    });
  }

  /* =====================================================================
     4. Selección de receta (RF04) y asignación a un día (RF05)
     ===================================================================== */

  function buscarEnResultados(idMeal) {
    var objetivo = String(idMeal);
    for (var i = 0; i < resultados.length; i++) {
      if (resultados[i].idMeal === objetivo) { return resultados[i]; }
    }
    return null;
  }

  function seleccionar(idMeal) {
    var receta = buscarEnResultados(idMeal);
    if (!receta) { return; }

    seleccionada = receta;
    renderResultados();
    renderSeleccion();

    els.panelSeleccion.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function limpiarSeleccion() {
    seleccionada = null;
    els.seleccionActual.replaceChildren();
    els.panelSeleccion.hidden = true;
    renderResultados();
  }

  function renderSeleccion() {
    els.seleccionActual.replaceChildren();

    if (!seleccionada) {
      els.panelSeleccion.hidden = true;
      return;
    }
    els.panelSeleccion.hidden = false;

    var tarjeta = crear('div', 'seleccion__tarjeta');
    tarjeta.appendChild(crearImagen(seleccionada.imagen, 'Fotografía de ' + seleccionada.nombre, 'seleccion__img'));

    var datos = crear('div', 'seleccion__datos');
    datos.appendChild(crear('h3', 'seleccion__nombre', seleccionada.nombre));

    var ficha = crear('dl', 'seleccion__ficha');
    var pares = [
      ['Categoría', seleccionada.categoria],
      ['Área / origen', seleccionada.area],
      ['Identificador', seleccionada.idMeal]
    ];
    pares.forEach(function (par) {
      ficha.appendChild(crear('dt', null, par[0]));
      ficha.appendChild(crear('dd', null, par[1]));
    });
    datos.appendChild(ficha);

    var verDetalle = crear('button', 'boton boton--mini', 'Ver detalle de la receta');
    verDetalle.type = 'button';
    verDetalle.addEventListener('click', function () { abrirDetalle(seleccionada.idMeal); });
    datos.appendChild(verDetalle);

    tarjeta.appendChild(datos);
    els.seleccionActual.appendChild(tarjeta);
  }

  function agregarSeleccionada(dia) {
    if (!seleccionada) {
      mostrarToast('Primero selecciona una receta de los resultados.', 'alerta');
      return { ok: false };
    }
    var destino = dia || els.selectDia.value;
    var resultado = Planner.agregar(destino, seleccionada);
    if (resultado.ok) {
      mostrarToast('«' + seleccionada.nombre + '» se agregó al ' + destino.toLowerCase() + '.', 'exito');
    } else {
      mostrarToast(resultado.motivo, 'alerta');
    }
    return resultado;
  }

  /* =====================================================================
     5. Menú semanal (RF06, RF07)
     ===================================================================== */

  function renderPlan() {
    var plan = Planner.obtenerPlan();
    els.planSemanal.replaceChildren();

    Planner.DIAS.forEach(function (dia) {
      var recetas = plan[dia] || [];
      var esActivo = els.selectDia.value === dia;

      var columna = crear('section', 'dia' + (recetas.length ? '' : ' es-vacio') + (esActivo ? ' es-dia-activo' : ''));
      columna.setAttribute('data-dia', dia);
      columna.setAttribute('aria-labelledby', 'dia-' + idSegurido(dia));

      var encabezado = crear('header', 'dia__encabezado');
      var nombre = crear('h3', 'dia__nombre', dia);
      nombre.id = 'dia-' + idSegurido(dia);
      var contador = crear('span', 'dia__contador', String(recetas.length));
      contador.setAttribute('aria-label', recetas.length + (recetas.length === 1 ? ' receta' : ' recetas'));
      encabezado.appendChild(nombre);
      encabezado.appendChild(contador);
      columna.appendChild(encabezado);

      if (recetas.length === 0) {
        columna.appendChild(crear('p', 'dia__vacio', 'Sin recetas'));
      } else {
        var lista = crear('ul', 'dia__lista');
        recetas.forEach(function (receta) { lista.appendChild(crearItemPlan(receta, dia)); });
        columna.appendChild(lista);
      }

      els.planSemanal.appendChild(columna);
    });

    var metricas = Planner.contar();
    els.contadorPlan.textContent =
      metricas.recetas + (metricas.recetas === 1 ? ' receta' : ' recetas') +
      ' · ' + metricas.dias + '/' + Planner.DIAS.length + ' días con recetas' +
      (metricas.completo ? ' · ¡semana completa!' : '');
    els.btnVaciarPlan.disabled = metricas.recetas === 0;
  }

  function crearItemPlan(receta, dia) {
    var item = crear('li', 'plan-item');

    item.appendChild(crearImagen(receta.imagen, '', 'plan-item__img'));

    var datos = crear('div', 'plan-item__datos');
    datos.appendChild(crear('p', 'plan-item__nombre', receta.nombre));
    datos.appendChild(crear('p', 'plan-item__meta', receta.categoria + ' · ' + receta.area));
    item.appendChild(datos);

    var quitar = crear('button', 'plan-item__quitar', '✕');
    quitar.type = 'button';
    quitar.setAttribute('data-accion', 'eliminar');
    quitar.setAttribute('data-id', receta.idMeal);
    quitar.setAttribute('aria-label', 'Quitar ' + receta.nombre + ' del ' + dia);
    quitar.title = 'Quitar del plan';
    item.appendChild(quitar);

    return item;
  }

  function marcarDiaActivo() {
    Array.prototype.forEach.call(els.planSemanal.querySelectorAll('.dia'), function (columna) {
      columna.classList.toggle('es-dia-activo', columna.getAttribute('data-dia') === els.selectDia.value);
    });
  }

  /* =====================================================================
     6. Ventana de detalle (Fetch adicional → lookup.php)
     ===================================================================== */

  function abrirDetalle(idMeal) {
    recetaModal = buscarEnResultados(idMeal) || { idMeal: String(idMeal), nombre: 'Receta' };
    focoPrevio = doc.activeElement;

    els.modal.hidden = false;
    doc.body.classList.add('sin-scroll');
    els.modalDia.value = els.selectDia.value || Planner.DIAS[0];
    els.btnModalAgregar.disabled = true;
    renderDetalleCargando();
    els.btnCerrarModal.focus();

    var miToken = ++tokenDetalle;

    return MealAPI.obtenerDetalle(idMeal)
      .then(function (detalle) {
        if (miToken !== tokenDetalle) { return; }
        recetaModal = detalle;
        els.btnModalAgregar.disabled = false;
        renderDetalle(detalle);
      })
      .catch(function (error) {
        if (miToken !== tokenDetalle) { return; }
        renderDetalleError(error && error.message ? error.message : 'No se pudo cargar el detalle.');
      });
  }

  function cerrarModal() {
    if (els.modal.hidden) { return; }
    tokenDetalle++;                       // invalida la petición en curso
    els.modal.hidden = true;
    doc.body.classList.remove('sin-scroll');
    recetaModal = null;
    els.cuerpoModal.replaceChildren();
    if (focoPrevio && typeof focoPrevio.focus === 'function') { focoPrevio.focus(); }
  }

  function renderDetalleCargando() {
    els.tituloModal.textContent = 'Detalle de la receta';
    els.cuerpoModal.replaceChildren();
    var bloque = crear('p', 'cargando-modal');
    bloque.appendChild(crear('span', 'punto-pulsante'));
    bloque.appendChild(doc.createTextNode(' Cargando ingredientes e instrucciones…'));
    els.cuerpoModal.appendChild(bloque);
  }

  function renderDetalleError(mensaje) {
    els.cuerpoModal.replaceChildren();
    var bloque = crear('div', 'estado estado--error');
    bloque.appendChild(crear('p', 'estado__titulo', 'Error al cargar el detalle'));
    bloque.appendChild(crear('p', 'estado__texto', mensaje));
    var reintentar = crear('button', 'boton boton--secundario', 'Reintentar');
    reintentar.type = 'button';
    reintentar.addEventListener('click', function () {
      if (recetaModal) { abrirDetalle(recetaModal.idMeal); }
    });
    bloque.appendChild(reintentar);
    els.cuerpoModal.appendChild(bloque);
  }

  function renderDetalle(detalle) {
    els.tituloModal.textContent = detalle.nombre;
    els.cuerpoModal.replaceChildren();

    if (detalle.imagen) {
      els.cuerpoModal.appendChild(crearImagen(detalle.imagen, 'Fotografía de ' + detalle.nombre, 'detalle__portada'));
    }

    var meta = crear('div', 'detalle__meta');
    meta.appendChild(crear('span', 'pastilla pastilla--categoria', detalle.categoria));
    meta.appendChild(crear('span', 'pastilla pastilla--area', detalle.area));
    meta.appendChild(crear('span', 'pastilla', 'ID ' + detalle.idMeal));
    detalle.etiquetas.forEach(function (etiqueta) {
      meta.appendChild(crear('span', 'pastilla', etiqueta));
    });
    els.cuerpoModal.appendChild(meta);

    els.cuerpoModal.appendChild(crear('h4', 'detalle__titulo-bloque', 'Ingredientes'));
    if (detalle.ingredientes.length === 0) {
      els.cuerpoModal.appendChild(crear('p', 'estado__texto', 'La API no detailó los ingredientes de esta receta.'));
    } else {
      var lista = crear('ul', 'lista-ingredientes');
      detalle.ingredientes.forEach(function (item) {
        var fila = crear('li', 'ingrediente');
        fila.appendChild(crear('span', 'ingrediente__nombre', item.ingrediente));
        fila.appendChild(crear('span', 'ingrediente__medida', item.medida || '—'));
        lista.appendChild(fila);
      });
      els.cuerpoModal.appendChild(lista);
    }

    els.cuerpoModal.appendChild(crear('h4', 'detalle__titulo-bloque', 'Preparación'));
    var pasos = dividirInstrucciones(detalle.instrucciones);
    if (pasos.length === 0) {
      els.cuerpoModal.appendChild(crear('p', 'estado__texto', 'La API no detailó las instrucciones de esta receta.'));
    } else {
      var orden = crear('ol', 'instrucciones');
      pasos.forEach(function (paso) { orden.appendChild(crear('li', null, paso)); });
      els.cuerpoModal.appendChild(orden);
    }

    if (detalle.video) {
      var enlace = crear('a', 'enlace-video', '▶ Ver el video de la receta en YouTube');
      enlace.href = detalle.video;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
      els.cuerpoModal.appendChild(enlace);
    }
  }

  function dividirInstrucciones(texto) {
    var pasos = [];
    String(texto || '').split(/\n+/).forEach(function (parrafo) {
      var limpio = parrafo.trim();
      if (!limpio) { return; }
      if (limpio.length > 160 && limpio.indexOf('. ') > -1) {
        limpio.split('. ').forEach(function (oracion) {
          var frase = oracion.trim();
          if (frase) { pasos.push(/[.!?]$/.test(frase) ? frase : frase + '.'); }
        });
      } else {
        pasos.push(limpio);
      }
    });
    return pasos;
  }

  /* =====================================================================
     7. Notificaciones
     ===================================================================== */

  function ocultarToast() {
    els.toast.classList.remove('es-visible');
    global.setTimeout(function () {
      if (!els.toast.classList.contains('es-visible')) { els.toast.hidden = true; }
    }, 260);
  }

  function mostrarToast(mensaje, tipo) {
    var texto = crear('span', null, mensaje);
    els.toast.replaceChildren(texto);
    els.toast.setAttribute('data-tipo', tipo || 'info');
    els.toast.hidden = false;
    els.toast.classList.remove('es-visible');
    void els.toast.offsetWidth;                 // reinicia la animación CSS
    els.toast.classList.add('es-visible');
    global.clearTimeout(temporizadorToast);
    temporizadorToast = global.setTimeout(ocultarToast, 3400);
  }

  /* =====================================================================
     8. Callbacks (eventos del DOM)
     ===================================================================== */

  function alEnviarBusqueda(evento) {
    evento.preventDefault();
    return buscar(els.inputIngrediente.value);
  }

  function alClicEnChip(evento) {
    if (!esElemento(evento.target)) { return; }
    var chip = evento.target.closest('.chip');
    if (!chip) { return; }
    var ingrediente = chip.getAttribute('data-ingrediente');
    els.inputIngrediente.value = ingrediente;
    return buscar(ingrediente);
  }

  function alClicEnResultados(evento) {
    if (!esElemento(evento.target)) { return; }
    var detalle = evento.target.closest('[data-accion="detalle"]');
    if (detalle) {
      return abrirDetalle(detalle.getAttribute('data-id'));
      return;
    }
    var tarjeta = evento.target.closest('.receta');
    if (tarjeta) { seleccionar(tarjeta.getAttribute('data-id')); }
  }

  function alClicEnPlan(evento) {
    if (!esElemento(evento.target)) { return; }
    var quitar = evento.target.closest('[data-accion="eliminar"]');
    if (!quitar) { return; }
    var columna = quitar.closest('.dia');
    if (!columna) { return; }

    var dia = columna.getAttribute('data-dia');
    var resultado = Planner.eliminar(dia, quitar.getAttribute('data-id'));
    if (resultado.ok) {
      mostrarToast('Se quitó «' + resultado.receta.nombre + '» del ' + dia.toLowerCase() + '.', 'info');
    } else {
      mostrarToast(resultado.motivo, 'alerta');
    }
  }

  function alEnviarAgregar(evento) {
    evento.preventDefault();
    return agregarSeleccionada(els.selectDia.value);
  }

  function alVaciarPlan() {
    var metricas = Planner.contar();
    if (metricas.recetas === 0) { return; }
    var confirmado = global.confirm(
      '¿Seguro que quieres eliminar las ' + metricas.recetas + ' recetas del plan semanal?'
    );
    if (!confirmado) { return; }
    Planner.limpiar();
    mostrarToast('Plan semanal vaciado.', 'info');
  }

  function alClicEnModal(evento) {
    if (evento.target === els.modal) { cerrarModal(); }
  }

  function alTecla(evento) {
    if (evento.key === 'Escape') {
      if (!els.modal.hidden) {
        cerrarModal();
        return;
      }
      return;
    }
    if (evento.key === '/' && esElemento(evento.target)) {
      var etiqueta = evento.target.tagName;
      if (etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT') { return; }
      evento.preventDefault();
      els.inputIngrediente.focus();
      els.inputIngrediente.select();
    }
  }

  function alEscribirIngrediente() {
    els.inputIngrediente.removeAttribute('aria-invalid');
  }

  function alCambiarDia() {
    marcarDiaActivo();
  }

  /* =====================================================================
     9. Inicialización
     ===================================================================== */

  function llenarSelectDias(select) {
    Planner.DIAS.forEach(function (dia, indice) {
      var opcion = crear('option', null, dia);
      opcion.value = dia;
      if (indice === 0) { opcion.selected = true; }
      select.appendChild(opcion);
    });
  }

  function iniciar() {
    els.formBusqueda = doc.getElementById('formBusqueda');
    els.inputIngrediente = doc.getElementById('inputIngrediente');
    els.btnBuscar = doc.getElementById('btnBuscar');
    els.chipsSugeridos = doc.getElementById('chipsSugeridos');
    els.panelResultados = doc.getElementById('panelResultados');
    els.estados = doc.getElementById('estados');
    els.mensajeVacio = doc.getElementById('mensajeVacio');
    els.mensajeError = doc.getElementById('mensajeError');
    els.contextoResultados = doc.getElementById('contextoResultados');
    els.gridResultados = doc.getElementById('gridResultados');
    els.btnReintentar = doc.getElementById('btnReintentar');
    els.panelSeleccion = doc.getElementById('panelSeleccion');
    els.seleccionActual = doc.getElementById('seleccionActual');
    els.formAgregar = doc.getElementById('formAgregar');
    els.selectDia = doc.getElementById('selectDia');
    els.btnAgregar = doc.getElementById('btnAgregar');
    els.btnCancelarSeleccion = doc.getElementById('btnCancelarSeleccion');
    els.planSemanal = doc.getElementById('planSemanal');
    els.contadorPlan = doc.getElementById('contadorPlan');
    els.btnVaciarPlan = doc.getElementById('btnVaciarPlan');
    els.modal = doc.getElementById('modalDetalle');
    els.tituloModal = doc.getElementById('tituloModal');
    els.cuerpoModal = doc.getElementById('cuerpoModal');
    els.btnCerrarModal = doc.getElementById('btnCerrarModal');
    els.modalDia = doc.getElementById('modalDia');
    els.btnModalAgregar = doc.getElementById('btnModalAgregar');
    els.toast = doc.getElementById('toast');

    llenarSelectDias(els.selectDia);
    llenarSelectDias(els.modalDia);

    // Callbacks: búsqueda
    els.formBusqueda.addEventListener('submit', alEnviarBusqueda);
    els.inputIngrediente.addEventListener('input', alEscribirIngrediente);
    els.chipsSugeridos.addEventListener('click', alClicEnChip);
    els.btnReintentar.addEventListener('click', function () { return buscar(ultimoIngrediente); });

    // Callbacks: resultados (delegación de eventos)
    els.gridResultados.addEventListener('click', alClicEnResultados);

    // Callbacks: selección y asignación
    els.formAgregar.addEventListener('submit', alEnviarAgregar);
    els.selectDia.addEventListener('change', alCambiarDia);
    els.btnCancelarSeleccion.addEventListener('click', function () {
      limpiarSeleccion();
      mostrarToast('Selección cancelada.', 'info');
    });

    // Callbacks: plan semanal (delegación de eventos)
    els.planSemanal.addEventListener('click', alClicEnPlan);
    els.btnVaciarPlan.addEventListener('click', alVaciarPlan);

    // Callbacks: modal
    els.btnCerrarModal.addEventListener('click', cerrarModal);
    els.modal.addEventListener('click', alClicEnModal);
    els.btnModalAgregar.addEventListener('click', function () {
      if (!recetaModal) { return; }
      var destino = els.modalDia.value;
      var nombreReceta = recetaModal.nombre;
      var resultado = Planner.agregar(destino, recetaModal);
      if (resultado.ok) {
        cerrarModal();
        mostrarToast('«' + nombreReceta + '» se agregó al ' + destino.toLowerCase() + '.', 'exito');
      } else {
        mostrarToast(resultado.motivo, 'alerta');
      }
    });
    doc.addEventListener('keydown', alTecla);

    // Suscripción al plan: cada cambio re-renderiza el menú semanal (callback).
    Planner.suscribir(function () { renderPlan(); });

    renderPlan();
    pintarEstado('inicial');
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  global.App = {
    iniciar: iniciar,
    buscar: buscar,
    seleccionar: seleccionar,
    agregarSeleccionada: agregarSeleccionada,
    abrirDetalle: abrirDetalle,
    cerrarModal: cerrarModal,
    mostrarToast: mostrarToast,
    obtenerResultados: function () { return resultados; },
    obtenerSeleccion: function () { return seleccionada; }
  };
})(window);