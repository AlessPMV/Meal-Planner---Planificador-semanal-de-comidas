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
     · GET https://www.themealdb.com/api/json/v1/1/search.php?s={texto}
         → busca por NOMBRE de receta y sí trae strCategory. La base de datos
           también contiene recetas con nombre en español («Pollo en pepitoria»,
           «Arroz con Leche»), así que sirve como segunda estrategia.
     · GET https://www.themealdb.com/api/json/v1/1/list.php?i=list
         → catálogo oficial de los 992 ingredientes en inglés. Solo se pide
           cuando una búsqueda no encuentra nada, para proponer sugerencias.

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
  var CLAVE_CATALOGO = 'meal-planner.ingredientes.v1';
  var MAX_SUGERENCIAS = 5;

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

  /* ---------------------------------------------------------------------
     2. Traducción ES → EN y catálogo oficial de ingredientes
     ---------------------------------------------------------------------
     TheMealDB solo reconoce ingredientes en inglés y con el nombre exacto
     que usa en su base de datos: filter.php?i=chicken funciona, pero
     ?i=pollo devuelve null. Por eso la búsqueda se resuelve en tres pasos:

       1. resolverConsulta() traduce al inglés los términos que aparecen en
          DICCIONARIO y, si no hay traducción, propone el término original
          junto con alguna variante en singular.
       2. probarCandidatos() consulta filter.php?i= con cada candidato y se
          queda con el primero que devuelva recetas.
       3. Si ninguno funciona, se cae a search.php?s= con el término tal
          como lo escribió el usuario: ese endpoint busca por NOMBRE de
          receta y la base de datos también contiene recetas en español.

     Las claves del diccionario están escritas ya normalizadas (sin acentos y
     en minúsculas) porque normalizarTexto() se aplica también a lo que
     escribe la persona usuaria. Los valores son nombres de ingredient de
     TheMealDB; verificado contra list.php?i=list (992 ingredientes).
     --------------------------------------------------------------------- */

  /**
   * Normaliza texto para poder compararlo: minúsculas, sin acentos y sin
   * espacios repetidos. No toca el término original que se envía a la API.
   * @param {string} texto
   * @returns {string}
   */
  function normalizarTexto(texto) {
    return String(texto == null ? '' : texto)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  var DICCIONARIO = {
    // --- Carnes y aves ---
    pollo: 'chicken',
    'pollo entero': 'chicken',
    'pollo asado': 'chicken',
    'carne de pollo': 'chicken',
    pechuga: 'chicken breast',
    'pechuga de pollo': 'chicken breast',
    pechugas: 'chicken breasts',
    'muslo de pollo': 'chicken thighs',
    'muslos de pollo': 'chicken thighs',
    'alitas de pollo': 'chicken wings',
    alitas: 'chicken wings',
    'pollo molido': 'ground chicken',

    'carne de res': 'beef',
    res: 'beef',
    bistec: 'flank steak',
    entrecot: 'sirloin steak',
    chuleton: 'beef cutlet',
    'filete de res': 'beef fillet',
    'carne molida': 'ground beef',
    'carne picada': 'minced beef',

    cerdo: 'pork',
    costilla: 'pork back ribs',
    'costillas de cerdo': 'pork back ribs',
    'chuleta de cerdo': 'pork chops',
    'chuletas de cerdo': 'pork chops',
    panceta: 'pork belly slices',
    'panceta de cerdo': 'pork belly slices',
    pernil: 'pork shoulder',
    tocino: 'streaky bacon',
    bacon: 'streaky bacon',
    chorizo: 'chorizo',
    salchicha: 'sausages',
    salchichas: 'sausages',
    jamon: 'ham',
    'jamon cocido': 'ham',
    'jamon serrano': 'serrano ham',
    'jamon iberico': 'jamón ibérico',

    pavo: 'turkey',
    'pavo molido': 'turkey mince',
    cordero: 'lamb',
    'chuleta de cordero': 'lamb loin chops',
    'cordero molido': 'lamb mince',
    'pierna de cordero': 'lamb leg',
    'paletilla de cordero': 'lamb shoulder',
    ternera: 'veal',
    rinones: 'lamb kidney',
    pate: 'black pudding',

    // --- Pescado y mariscos ---
    salmon: 'salmon',
    'salmon ahumado': 'smoked salmon',
    atun: 'tuna',
    bacalao: 'salt cod',
    'bacalao salado': 'salt cod',
    caballa: 'mackerel',
    merluza: 'hake',
    llena: 'hake',
    calamar: 'squid',
    langostino: 'king prawns',
    langostinos: 'king prawns',
    gamba: 'prawns',
    gambas: 'prawns',
    camaron: 'prawns',
    camarones: 'prawns',
    langosta: 'lobster',
    mejillon: 'mussels',
    mejillones: 'mussels',
    almeja: 'clams',
    almejas: 'clams',
    ostra: 'oysters',
    ostras: 'oysters',
    sardinas: 'sardines',
    'pescado blanco': 'white fish',

    // --- Lácteos ---
    leche: 'milk',
    'leche entera': 'whole milk',
    'leche semidesnatada': 'semi-skimmed milk',
    'leche de coco': 'coconut milk',
    'leche de soja': 'soya milk',
    'leche de almendra': 'almond milk',
    nata: 'cream',
    'nata liquida': 'cream',
    'nata para cocinar': 'heavy cream',
    'nata montada': 'double cream',
    mantequilla: 'butter',
    'mantequilla sin sal': 'unsalted butter',
    'mantequilla derretida': 'melted butter',
    queso: 'cheese',
    'queso cheddar': 'mature cheddar',
    'queso parmesano': 'parmesan',
    'queso mozzarella': 'mozzarella',
    'queso feta': 'feta',
    'queso crema': 'cream cheese',
    'queso de cabra': 'goats cheese',
    'queso azul': 'stilton cheese',
    yogur: 'yogurt',
    'yogur griego': 'greek yogurt',
    'suero de leche': 'buttermilk',
    ricotta: 'ricotta',
    mascarpone: 'mascarpone',

    // --- Huevos ---
    huevo: 'egg',
    huevos: 'egg',
    yema: 'egg yolks',
    yemas: 'egg yolks',
    clara: 'egg white',
    claras: 'egg white',

    // --- Verduras ---
    tomate: 'tomato',
    tomates: 'tomato',
    'tomate triturado': 'chopped tomatoes',
    'tomate en lata': 'canned tomatoes',
    'pure de tomate': 'tomato puree',
    'salsa de tomate': 'tomato sauce',
    ketchup: 'tomato ketchup',
    cebolla: 'onion',
    cebollas: 'onions',
    cebolleta: 'spring onions',
    'cebolla morada': 'red onions',
    'cebolla amarilla': 'yellow onion',
    ajo: 'garlic',
    ajos: 'garlic',
    'diente de ajo': 'garlic clove',
    'ajo picado': 'minced garlic',
    'ajo en polvo': 'garlic powder',
    papa: 'potatoes',
    papas: 'potatoes',
    patata: 'potatoes',
    patatas: 'potatoes',
    'papas fritas': 'fries',
    zanahoria: 'carrots',
    zanahorias: 'carrots',
    brocoli: 'broccoli',
    col: 'cabbage',
    'col blanca': 'white cabbage',
    'col morada': 'red cabbage',
    'col china': 'chinese cabbage',
    lechuga: 'lettuce',
    'lechuga iceberg': 'iceberg lettuce',
    'lechuga romana': 'little gem lettuce',
    espinaca: 'spinach',
    espinacas: 'spinach',
    apio: 'celery',
    apionabo: 'celeriac',
    pepino: 'cucumber',
    pepinos: 'cucumber',
    'pepino en vinagre': 'dill pickles',
    berenjena: 'aubergine',
    calabacin: 'courgettes',
    alcacachofa: 'jerusalem artichokes',
    calabaza: 'squash',
    'calabaza moscada': 'butternut squash',
    pumpkin: 'pumpkin',
    maiz: 'sweetcorn',
    elote: 'corn on the cob',
    chicharo: 'peas',
    chicharros: 'peas',
    guisante: 'peas',
    guisantes: 'peas',
    soja: 'soya bean',
    tofu: 'tofu',
    haba: 'broad beans',
    habas: 'broad beans',
    judia: 'kidney beans',
    judias: 'kidney beans',
    'judia blanca': 'cannellini beans',
    'judia pinta': 'pinto beans',
    frijol: 'kidney beans',
    frijoles: 'kidney beans',
    'frijol negro': 'black beans',
    garbanzo: 'chickpeas',
    garbanzos: 'chickpeas',
    lenteja: 'lentils',
    lentejas: 'lentils',
    aceituna: 'green olives',
    aceitunas: 'green olives',
    oliva: 'black olives',
    olivas: 'black olives',
    champinon: 'mushrooms',
    champinones: 'mushrooms',

    // --- Frutas ---
    manzana: 'apples',
    manzanas: 'apples',
    pera: 'pears',
    peras: 'pears',
    platano: 'banana',
    platanos: 'banana',
    naranja: 'orange',
    naranjas: 'orange',
    limon: 'lemon',
    limones: 'lemons',
    'zumo de limon': 'lemon juice',
    'jugo de limon': 'lemon juice',
    'limon verde': 'lime',
    lima: 'lime',
    'uvas pasas': 'raisins',
    ciruela: 'prunes',
    ciruelas: 'prunes',
    durazno: 'peaches',
    melocoton: 'peaches',
    fresa: 'strawberries',
    fresas: 'strawberries',
    frambuesa: 'raspberries',
    frambuesas: 'raspberries',
    arandano: 'blueberries',
    arandanos: 'blueberries',
    mora: 'blackberries',
    moras: 'blackberries',
    coco: 'coconut',
    'coco rallado': 'desiccated coconut',
    mango: 'mango',
    papaya: 'green papaya',
    pina: 'pineapple chunks',
    ananas: 'pineapple chunks',
    higo: 'figs',
    higos: 'figs',
    datil: 'pitted dates',
    datiles: 'pitted dates',
    granada: 'pomegranate',
    toronja: 'grapefruit',
    'jugo de naranja': 'orange juice',

    // --- Frutos secos y cacao ---
    nuez: 'walnuts',
    nueces: 'walnuts',
    almendra: 'almonds',
    almendras: 'flaked almonds',
    avellana: 'shelled hazelnuts',
    avellanas: 'shelled hazelnuts',
    anacardo: 'cashews',
    anacardos: 'cashews',
    cacahuete: 'peanuts',
    cacahuetes: 'peanuts',
    'cacahuete tostado': 'roasted peanut',
    'crema de cacahuete': 'peanut butter',
    pistacho: 'pistachio',
    pistachos: 'pistachio',
    cacao: 'cocoa',
    'cacao en polvo': 'cocoa powder',
    chocolate: 'plain chocolate',
    'chocolate negro': 'dark chocolate',
    'chocolate con leche': 'milk chocolate',
    'chocolate blanco': 'white chocolate',
    'chips de chocolate': 'chocolate chips',
    'chocolate con chispas': 'chocolate chips',
    nutella: 'nutella',
    caramelo: 'caramel',

    // --- Azúcares y dulces ---
    azucar: 'sugar',
    'azucar moreno': 'brown sugar',
    'azucar de cana': 'caster sugar',
    'azucar glas': 'icing sugar',
    'azucar impalpable': 'powdered sugar',
    miel: 'honey',
    'jarabe de arce': 'maple syrup',
    vainilla: 'vanilla',
    'extracto de vainilla': 'vanilla extract',
    gelatina: 'gelatine leafs',
    natillas: 'custard',
    'crema inglesa': 'custard',

    // --- Especias, salsas y técnicas ---
    pimienta: 'pepper',
    'pimienta negra': 'black pepper',
    'pimienta cayena': 'cayenne pepper',
    'pimienta de jamaica': 'allspice',
    pimenton: 'paprika',
    'pimenton ahumado': 'smoked paprika',
    sal: 'salt',
    'sal marina': 'sea salt',
    'sal kosher': 'kosher salt',
    canela: 'cinnamon',
    'canela en rama': 'cinnamon stick',
    'clavo de olor': 'cloves',
    comino: 'cumin',
    'comino molido': 'ground cumin',
    cilantro: 'coriander',
    perejil: 'parsley',
    'perejil picado': 'chopped parsley',
    oregano: 'oregano',
    tomillo: 'thyme',
    romero: 'rosemary',
    laurel: 'bay leaf',
    eneldo: 'dill',
    menta: 'mint',
    albahaca: 'basil',
    azafran: 'saffron',
    curcuma: 'turmeric',
    cardamomo: 'cardamom',
    'nuez moscada': 'nutmeg',
    mostaza: 'mustard',
    'mostaza en polvo': 'mustard powder',
    'mostaza de dijon': 'dijon mustard',
    vinagre: 'vinegar',
    'vinagre de manzana': 'apple cider vinegar',
    'vinagre balsamico': 'balsamic vinegar',
    'vinagre blanco': 'white vinegar',
    mayonesa: 'mayonnaise',
    'salsa de soja': 'soy sauce',
    'salsa de ostras': 'oyster sauce',
    'salsa barbecue': 'barbeque sauce',
    harissa: 'harissa spice',
    curry: 'curry powder',
    masala: 'garam masala',

    // --- Pan, pasta, arroz y granos ---
    pan: 'bread',
    'pan integral': 'wholegrain bread',
    'pan rallado': 'breadcrumbs',
    'miga de pan': 'breadcrumbs',
    'pan de pita': 'pita bread',
    pasta: 'spaghetti',
    espaguetis: 'spaghetti',
    macarrones: 'macaroni',
    penne: 'penne rigate',
    fettuccine: 'fettuccine',
    lasana: 'lasagne sheets',
    tortilla: 'tortillas',
    'tortillas de maiz': 'corn tortillas',
    'tortilla de harina': 'flour tortilla',
    arroz: 'rice',
    'arroz integral': 'brown rice',
    'arroz basmati': 'basmati rice',
    'arroz jazmin': 'jasmine rice',
    'arroz para paella': 'paella rice',
    quinoa: 'quinoa',
    avena: 'oats',
    'copos de avena': 'rolled oats',
    trigo: 'whole wheat',
    centeno: 'rye',
    harina: 'flour',
    'harina de trigo': 'wheat flour',
    semolina: 'semolina',
    levadura: 'yeast',

    // --- Aceites, caldos y bebidas ---
    aceite: 'oil',
    'aceite de oliva': 'olive oil',
    'aceite de oliva virgen extra': 'extra virgin olive oil',
    'aceite de girasol': 'sunflower oil',
    'aceite vegetal': 'vegetable oil',
    'manteca de cerdo': 'lard',
    sebo: 'suet',
    caldo: 'chicken stock',
    'caldo de pollo': 'chicken stock',
    'caldo de carne': 'beef stock',
    'caldo de res': 'beef stock',
    'caldo de verduras': 'vegetable stock',
    'caldo de pescado': 'fish stock',
    agua: 'water',
    vino: 'white wine',
    'vino tinto': 'red wine',
    'vino blanco': 'white wine',
    cerveza: 'beer',
    ron: 'rum',
    conac: 'brandy',
    brandy: 'brandy',
    sherry: 'sherry',
    cider: 'cider',
    sidra: 'cider'
  };

  /**
   * Genera las variantes que se prueban cuando el término NO está en el
   * diccionario: el término tal cual y, si parece plural, su singular.
   * @param {string} original
   * @returns {string[]}
   */
  function variantes(original) {
    var lista = [original];
    var minus = original.toLowerCase();

    if (/[ñ¿¡]/.test(original)) {
      return lista;   // palabra marcadamente española: no conviene variantarla
    }
    if (/ies$/.test(minus)) {
      lista.push(original.replace(/ies$/i, 'y'));
    } else if (/(oes|ses|xes|zes)$/.test(minus)) {
      lista.push(original.replace(/es$/i, ''));
    } else if (/s$/.test(minus) && minus.length > 3) {
      lista.push(original.replace(/s$/i, ''));
    }

    return lista;
  }

  /**
   * Decide qué se consulta en la API a partir de lo que escribió la persona
   * usuaria. No hace ninguna petición: solo prepara los candidatos.
   * @param {string} ingrediente
   * @returns {{original:string, normalizado:string, traducida:boolean, candidatos:string[]}}
   */
  function resolverConsulta(ingrediente) {
    var original = String(ingrediente == null ? '' : ingrediente).trim();
    var normalizado = normalizarTexto(original);
    var traduccion = normalizado === '' ? null : DICCIONARIO[normalizado];

    var candidatos;
    if (traduccion) {
      candidatos = Array.isArray(traduccion) ? traduccion.slice() : [traduccion];
    } else {
      candidatos = variantes(original);
    }

    return {
      original: original,
      normalizado: normalizado,
      traducida: !!traduccion,
      candidatos: candidatos.slice(0, 2)
    };
  }

  var catalogoEnMemoria = null;
  var catalogoEnCurso = null;

  /**
   * Descarga (una sola vez) el catálogo oficial de ingredientes y lo guarda
   * en localStorage. Solo se usa para proponer sugerencias cuando una
   * búsqueda no encuentra nada, de modo que no se descarga en cada visita.
   * @returns {Promise<string[]>}
   */
  function cargarCatalogo() {
    if (catalogoEnMemoria) {
      return Promise.resolve(catalogoEnMemoria);
    }
    if (catalogoEnCurso) {
      return catalogoEnCurso;
    }

    try {
      var guardado = global.localStorage.getItem(CLAVE_CATALOGO);
      if (guardado) {
        var lista = JSON.parse(guardado);
        if (Array.isArray(lista) && lista.length > 100) {
          catalogoEnMemoria = lista;
          return Promise.resolve(lista);
        }
      }
    } catch (error) {
      // localStorage puede estar bloqueado: se seguirá pidiendo a la API.
    }

    catalogoEnCurso = pedir(BASE + 'list.php?i=list')
      .then(function (datos) {
        var crudos = (datos && datos.meals) || [];
        catalogoEnMemoria = crudos
          .map(function (m) { return m && m.strIngredient; })
          .filter(Boolean);

        try {
          global.localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(catalogoEnMemoria));
        } catch (error) {
          // La caché es opcional: si falla, la búsqueda sigue funcionando.
        }
        return catalogoEnMemoria;
      })
      .then(function (lista) {
        catalogoEnCurso = null;
        return lista;
      }, function (error) {
        catalogoEnCurso = null;
        throw error;
      });

    return catalogoEnCurso;
  }

  /**
   * Distancia de edición (Levenshtein) entre dos cadenas ya normalizadas.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  function distancia(a, b) {
    var fila = a;
    var columna = b;
    var auxiliar;
    var i;
    var j;

    if (fila.length > columna.length) {
      auxiliar = fila;
      fila = columna;
      columna = auxiliar;
    }

    var anterior = [];
    for (i = 0; i <= fila.length; i++) {
      anterior[i] = i;
    }

    for (j = 1; j <= columna.length; j++) {
      var actual = [j];
      for (i = 1; i <= fila.length; i++) {
        var coste = fila.charAt(i - 1) === columna.charAt(j - 1) ? 0 : 1;
        actual[i] = Math.min(
          actual[i - 1] + 1,
          anterior[i] + 1,
          anterior[i - 1] + coste
        );
      }
      anterior = actual;
    }

    return anterior[fila.length];
  }

  function umbralSimilaridad(longitud) {
    if (longitud <= 4) { return 1; }
    if (longitud <= 7) { return 2; }
    return 3;
  }

  /**
   * Nombres que se comparan con lo que escribió la persona usuaria:
   * los ingredientes del catálogo oficial (para corregir inglés mal tecleado)
   * y las palabras en español del diccionario (para corregir «pola» → pollo).
   * Cada entrada guarda el término con el que se comparó y el nombre en
   * inglés que realmente acepta la API.
   * @param {string[]} catalogo
   * @returns {Array<{texto:string, resultado:string}>}
   */
  function universoDeNombres(catalogo) {
    var universo = [];
    var vistos = {};

    function agregar(texto, resultado) {
      if (!texto || !resultado) { return; }
      var clave = normalizarTexto(texto);
      if (clave === '' || vistos[clave]) { return; }
      vistos[clave] = true;
      universo.push({ texto: texto, resultado: resultado });
    }

    (catalogo || []).forEach(function (nombre) { agregar(nombre, nombre); });
    Object.keys(DICCIONARIO).forEach(function (clave) {
      var destino = DICCIONARIO[clave];
      (Array.isArray(destino) ? destino : [destino]).forEach(function (nombre) {
        agregar(clave, nombre);
      });
    });

    return universo;
  }

  /**
   * Devuelve los términos de ingredient más parecidos al que se escribió, ya
   * convertidos al nombre que acepta TheMealDB.
   * @param {string} termino
   * @param {Array<{texto:string, resultado:string}>} universo
   * @returns {string[]}
   */
  function similares(termino, universo) {
    var base = normalizarTexto(termino);
    if (base === '' || !Array.isArray(universo)) { return []; }

    var encontrados = [];
    universo.forEach(function (item) {
      var destino = normalizarTexto(item.texto);
      if (destino === '' || destino === base) { return; }
      var d = distancia(base, destino);
      if (d > umbralSimilaridad(base.length)) { return; }
      encontrados.push({ nombre: item.resultado, diferencia: d });
    });

    encontrados.sort(function (x, y) {
      return x.diferencia - y.diferencia ||
        x.nombre.length - y.nombre.length ||
        (x.nombre < y.nombre ? -1 : 1);
    });

    var sugeridas = [];
    var vistas = {};
    encontrados.forEach(function (item) {
      if (sugeridas.length >= MAX_SUGERENCIAS) { return; }
      var clave = normalizarTexto(item.nombre);
      if (vistas[clave]) { return; }
      vistas[clave] = true;
      sugeridas.push(item.nombre);
    });

    return sugeridas;
  }

  /**
   * Sugerencias para una búsqueda sin resultados. Si el catálogo no se puede
   * cargar (sin red, timeout…) devuelve un arreglo vacío: la búsqueda fallida
   * se comunica igual, solo que sin pistas.
   * @param {string} termino
   * @returns {Promise<string[]>}
   */
  function sugerir(termino) {
    return cargarCatalogo()
      .then(function (catalogo) { return similares(termino, universoDeNombres(catalogo)); })
      .catch(function () { return []; });
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
   * Busca por ingrediente en inglés con el endpoint filter.php.
   * Devuelve un arreglo vacío (no un error) cuando ese ingrediente no existe,
   * para que la cadena de estrategias pueda seguir probando otras opciones.
   * @param {string} consulta
   * @returns {Promise<object[]>}
   */
  function filtrarPorIngrediente(consulta) {
    return pedir(BASE + 'filter.php?i=' + encodeURIComponent(consulta))
      .then(function (datos) {
        var crudas = (datos && datos.meals) || [];
        if (crudas.length === 0) { return []; }

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
   * Segunda estrategia: búsqueda por NOMBRE de receta con el término original.
   * Este endpoint ya devuelve strCategory, así que no necesita enriquecimiento.
   * @param {string} termino
   * @returns {Promise<object[]>}
   */
  function buscarPorNombre(termino) {
    return pedir(BASE + 'search.php?s=' + encodeURIComponent(termino))
      .then(function (datos) {
        var crudas = (datos && datos.meals) || [];
        return crudas.slice(0, MAX_RESULTADOS).map(function (m) {
          return resumen(normalizar(m));
        });
      });
  }

  /**
   * Prueba los candidatos en orden (traducción al inglés o término original)
   * y devuelve el primero que traiga recetas. Un candidato que falla por red
   * no interrumpe la búsqueda: se pasa al siguiente.
   * @param {string[]} candidatos
   * @returns {Promise<{recetas:object[], consulta:string}|null>}
   */
  function probarCandidatos(candidatos) {
    var indice = 0;

    function siguiente() {
      if (indice >= candidatos.length) {
        return Promise.resolve(null);
      }
      var candidato = candidatos[indice];
      indice++;

      return filtrarPorIngrediente(candidato)
        .then(function (recetas) {
          if (recetas.length) {
            return { recetas: recetas, consulta: candidato };
          }
          return siguiente();
        })
        .catch(function () {
          return siguiente();
        });
    }

    return siguiente();
  }

  /**
   * RF02 — Busca recetas aceptando el ingrediente en español o en inglés.
   *
   * Cadena de resolución:
   *   1. traducción ES → EN (DICCIONARIO) y variantes, contra filter.php?i=
   *   2. búsqueda por nombre con el término original, contra search.php?s=
   *   3. error SIN_RESULTADOS con sugerencias del catálogo oficial
   *
   * @param {string} ingrediente
   * @returns {Promise<{recetas:object[], original:string, consulta:string,
   *                    estrategia:string, traducida:boolean}>}
   */
  function buscarRecetas(ingrediente) {
    var original = String(ingrediente == null ? '' : ingrediente).trim();

    if (original === '') {
      return Promise.reject(
        new Error('Escribe un ingrediente antes de buscar, por ejemplo «pollo» o «chicken».')
      );
    }

    var plan = resolverConsulta(original);

    return probarCandidatos(plan.candidatos)
      .then(function (encontrado) {
        if (encontrado) {
          return {
            recetas: encontrado.recetas,
            original: original,
            consulta: encontrado.consulta,
            estrategia: 'ingrediente',
            traducida: plan.traducida
          };
        }

        return buscarPorNombre(original).then(function (recetas) {
          if (recetas.length) {
            return {
              recetas: recetas,
              original: original,
              consulta: original,
              estrategia: 'nombre',
              traducida: false
            };
          }

          return sugerir(original).then(function (sugerencias) {
            var vacio = new Error(
              'No encontramos recetas para «' + original + '». Prueba con otro ingrediente, en español o en inglés.'
            );
            vacio.codigo = 'SIN_RESULTADOS';
            vacio.sugerencias = sugerencias;
            throw vacio;
          });
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
    buscarRecetas: buscarRecetas,
    obtenerDetalle: obtenerDetalle,
    normalizar: normalizar,
    BASE: BASE
  };
})(window);