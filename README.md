# 4. Ejercicio integrador 4 — Meal Planner: Planificador semanal de comidas

# INTEGRANTES :

- Osorio Blancas José Carlos (100%)
- Marcelo Valer Alessandro Percy (100%)

## 4.1 Nombre de la aplicación

**Meal Planner** — Planificador semanal de comidas

---

## 4.2 Problema que resuelve

Los estudiantes pueden utilizar una aplicación sencilla para buscar recetas y organizar una planificación semanal de comidas.

---

## 4.3 Objetivo de aprendizaje

Aplicar de forma integrada DOM, eventos, funciones JavaScript, callbacks, Promesas y Fetch, construyendo una aplicación interactiva basada en datos externos.

---

## 4.4 Funcionalidades principales

* Buscar recetas por ingrediente (en español o en inglés).
* Mostrar nombre, categoría e imagen.
* Visualizar información básica de una receta.
* Agregar una receta a un día de la semana.
* Eliminar una receta del plan.
* Mostrar el menú semanal.
* Gestionar estados de carga, resultados y errores.

---

## 4.5 Datos que debe gestionar

Ingrediente, Nombre de receta, Categoría, Área/origen, Imagen, Identificador, Día de la semana, Receta seleccionada y Plan semanal.

---

## 4.6 API pública sugerida

[TheMealDB], mediante sus endpoints públicos.

---

## 4.7 Requisitos funcionales

* **RF01.** Permitir introducir un ingrediente.
* **RF02.** Consultar recetas mediante Fetch.
* **RF03.** Mostrar las recetas encontradas.
* **RF04.** Permitir seleccionar una receta.
* **RF05.** Permitir asignar una receta a un día de la semana.
* **RF06.** Mostrar el menú semanal.
* **RF07.** Permitir eliminar recetas del menú.

---

## 4.8 Requisitos técnicos

| Tecnología | Aplicación |
| :--- | :--- |
| **HTML5** | Formulario, resultados y planificación |
| **CSS3** | Tarjetas, calendario semanal y estados |
| **JavaScript** | Lógica de búsqueda y planificación |
| **DOM** | Creación y modificación de recetas |
| **Callbacks** | Eventos de búsqueda, botones y selección |
| **Promesas** | Control de operaciones asíncronas |
| **Fetch** | Consulta de recetas |
| **Estados UI** | Cargando, resultados, vacío y error |
| **Manejo de errores** | Problemas de API o consultas sin resultados |

## 4.9 Flujo general

1. Usuario introduce ingrediente
2. Fetch
3. Promesa
4. Resultados
5. Selección de receta
6. Selección de día
7. Actualización del DOM
8. Menú semanal

## 4.10 Estructura de archivos

```
meal-planner/
│
├── index.html
├── css/
│   └── estilos.css
└── js/
    ├── app.js
    ├── api.js
    └── planner.js
```
## 4.11 Evidencias

* Búsqueda por ingrediente.
* Visualización de resultados.
* Selección de una receta.
* Asignación a un día.
* Visualización del menú semanal.
* Eliminación de una receta.
* Consulta sin resultados.
* Manejo de errores.
* Identificación de Fetch.
* Identificación de Promesas.
* Identificación de callbacks.
* Explicación de la actualización del DOM.

## 5. Resumen del funcionamiento del programa

Meal Planner es una aplicación web de una sola página que permite buscar recetas por ingrediente y organizar un menú semanal. El usuario escribe un ingrediente y la aplicación consulta la API de TheMealDB con `fetch`; mientras espera se muestra el estado de carga y, al terminar, las recetas encontradas en tarjetas con su nombre, categoría, área de origen e imagen, desde donde se puede abrir el detalle con ingredientes e instrucciones. Después se selecciona una receta, se elige el día de la semana correspondiente y se agrega al plan, que luego puede editarse quitando recetas o vaciándose por completo, y se conserva aunque se recargue la página.

La búsqueda acepta el ingrediente **en español o en inglés**. Como TheMealDB solo reconoce nombres de ingrediente en inglés y con el nombre exacto de su base de datos, `api.js` incluye un diccionario de 345 términos en español que se traducen al nombre oficial en inglés (por ejemplo, *pollo* → `chicken`, *carne de res* → `beef`, *papas* → `potatoes`) y valida cada término contra el catálogo de ingredientes que publica la propia API. La resolución de una búsqueda es una cadena de tres pasos: (1) se prueban los candidatos en inglés contra `filter.php?i=`; (2) si ninguno devuelve recetas, se busca el término tal como lo escribió la persona usuaria en `search.php?s=`, que busca por nombre de receta y también encuentra recetas con nombre en español; (3) si tampoco hay coincidencias, se rechazan las sugerencias «¿quizás quisiste decir?» calculadas por distancia de edición contra el catálogo de ingredientes, que se descarga una sola vez y se guarda en `localStorage`.

El proyecto se organiza en tres archivos JavaScript: `api.js` realiza las consultas a la API, traduce el término de búsqueda y maneja los errores, `planner.js` guarda el plan semanal y notifica cada cambio, y `app.js` gestiona los eventos del usuario y la actualización del DOM para mostrar los resultados, los estados de la interfaz y el menú semanal.