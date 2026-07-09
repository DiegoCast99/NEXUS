# CLAUDE.md — Instrucciones para Claude Code (proyecto NEXUS)

> Este archivo se lee automáticamente al iniciar cualquier sesión en este proyecto.
> NEXUS es un proyecto **separado e independiente** de Alpha Fitness. No compartir memoria, convenciones ni contexto entre ambos salvo que el usuario lo pida explícitamente.

---

## 🎯 Qué es este proyecto

**Nexus** — "sistema operativo para negocios digitales". Dashboard personal que centraliza finanzas personales, Meta Ads y e-commerce (multi-negocio) en una sola interfaz. Pensado para escalar a más módulos (dropshipping, infoproductos, afiliados, CRM, automatizaciones, IA, analítica) que hoy solo existen como promesa de marketing en la landing.

Propietario/dev: un solo usuario (Diego). NO hay equipo. NO hay git workflow (por ahora).

**Visión del usuario**: este proyecto se va a convertir en producto real, con versión **web**, **app de escritorio** y **app móvil**. De momento el foco es consolidar y seguir construyendo sobre la base web actual.

**Stack actual:**
- Frontend: HTML + CSS + JS vanilla, sin build, sin framework
- Persistencia: 100% `localStorage` (sin backend, sin Firebase, sin base de datos)
- Integraciones reales: Meta Marketing API (fetch directo desde el navegador)
- Sin tests automatizados todavía

**Estado real**: landing + dashboard funcionales para 3 módulos (Finanzas Personales, Meta Ads, E-Commerce genérico). El resto de los "módulos" que aparecen en la landing (Dropshipping, Infoproductos, Afiliados, CRM, Automatizaciones, Analítica, etc.) son solo UI de marketing, sin código funcional detrás.

---

## 📂 Estructura

```
NEXUS/
├── index.html          ← landing page (444 líneas)
├── styles.css           ← estilos landing (2054 líneas)
├── script.js             ← lógica landing: intro, globo 3D, login, marquees (1245 líneas)
├── dashboard.html       ← panel de control (654 líneas)
├── dashboard.css         ← estilos dashboard (1755 líneas)
├── dashboard.js           ← lógica dashboard: Finanzas, Meta Ads, E-commerce (2280 líneas)
├── world-countries.js     ← dataset GeoJSON para el globo del hero (256KB, 1 línea)
├── assets/menu/           ← sprites del mega-menú
└── CLAUDE.md              ← este archivo
```

No hay `package.json`, no hay build pipeline, no hay CI/CD. Todo es manual, igual que Alpha Fitness, pero **sin Firebase ni Netlify configurados todavía**.

---

## 🧠 Memoria técnica

- **Memoria de sesión (auto-memory de Claude Code)**: `/Users/mac/.claude/projects/-Users-mac-Desktop-NEXUS/memory/` — separada de la memoria de Alpha Fitness.
- **Vault Obsidian**: `/Users/mac/Library/Mobile Documents/iCloud~md~obsidian/Documents/Núcleo/NÚCLEO/Nexus/` — carpeta propia, paralela a `Alpha Fitness/`, NO mezclar contenido.

Notas clave del vault (leer cuando sean relevantes a la tarea):

| Cuándo consultar | Nota |
|------------------|------|
| Para entender estado actual antes de empezar | `Estado Actual de Nexus.md` |
| Para saber qué hacer / qué falta | `Pendientes y Mejoras.md` |
| Para ubicar funciones rápido (función → archivo:línea) | `Mapa del Código.md` |
| Antes de tocar Meta Ads o e-commerce (localStorage keys, shapes de datos) | `Modelo de Datos.md` |
| Para entender riesgos de seguridad conocidos | `Seguridad — Deuda y Riesgos.md` |
| Para historial diario | `Jornadas/AAAA-MM-DD.md` |

Índice maestro: `00 - Bitácora Nexus (Índice).md`

---

## ⚙️ Convenciones del proyecto (observadas en el código actual)

### Naming

| Patrón | Significado | Ejemplo |
|--------|-------------|---------|
| `nexus.<dominio>.<subdominio>.v<N>` | localStorage keys versionadas (patrón preferido, usar para keys nuevas) | `nexus.personalFinance.movements.v1` |
| `nexus_<snake>` | localStorage keys legacy sin versión (NO seguir este patrón para keys nuevas, es inconsistencia histórica) | `nexus_meta_ads_platforms`, `nexus_chart_view_mode` |
| `data-<kebab>` | Atributos de comportamiento leídos por JS via `dataset` | `data-view`, `data-panel`, `data-chart-mode` |
| `is-<estado>` | Clases de estado toggleable | `is-active`, `is-open`, `is-hidden`, `is-syncing` |
| Funciones camelCase en inglés | Todo el JS está en inglés (a diferencia de Alpha Fitness que mezcla español) | `loadMovements`, `syncMetaAds`, `drawCashflowChart` |
| Constantes SCREAMING_SNAKE_CASE | Claves de localStorage y config global | `AUTH_KEY`, `STORAGE_KEY`, `META_CONFIG_KEY` |

No hay prefijo de marca unificado en CSS (a diferencia de `alpha-*` en Alpha Fitness) — usa nombres semánticos directos (`.metric-card`, `.panel`, `.field`).

### Gráficos

Todos los gráficos del dashboard (`cashflowChart`, `categoryChart`, `metaTrendChart`, `commerceTrendChart`) están dibujados a mano con **Canvas 2D API**, sin librerías (no Chart.js, no D3). Mantené ese patrón si agregás gráficos nuevos, salvo que decidas migrar a una librería — en ese caso avisale al usuario porque es un cambio de arquitectura.

### Sanitización

Toda data dinámica insertada con `innerHTML` debe pasar por `escapeHtml()` (definida en dashboard.js:620). Ya se usa consistentemente en tablas de movimientos, campañas Meta y pedidos e-commerce — no rompas ese patrón al agregar campos nuevos.

---

## 🔐 Seguridad conocida (ver detalle en el vault)

1. **Login hardcodeado en cliente**: usuario y password en texto plano en `script.js:17-19` y username duplicado en `dashboard.js:2-3`. El gate de acceso al dashboard es trivialmente bypasseable desde la consola del navegador. Aceptable para uso personal/local; **bloqueante si se planea publicar el sitio o dar acceso a otras personas** — avisar al usuario antes de deployar públicamente.
2. **Tokens en texto plano en localStorage**: Meta Ads access token y API tokens de e-commerce se guardan sin cifrar y el token de Meta viaja como query param en cada request a `graph.facebook.com` (visible en logs/DevTools).
3. **Sin expiración de sesión** ni verificación server-side.

Si el proyecto avanza hacia multi-dispositivo (app móvil/escritorio) o se expone públicamente, esto necesita backend real con auth server-side — marcarlo como decisión arquitectónica pendiente.

---

## 🚫 Lo que NO hacer

1. **NO mezclar memoria/contexto con Alpha Fitness** — son proyectos separados, aunque vivan en la misma máquina.
2. **NO crear archivos nuevos sin necesidad** — preferí editar existentes.
3. **NO crear documentación `*.md`** salvo que el usuario lo pida explícitamente (excepción: los archivos de este CLAUDE.md y el vault Obsidian, que sí se mantienen activamente).
4. **NO agregar dependencias/build tooling** sin consultar — el proyecto es vanilla a propósito, por ahora.
5. **NO commitear** — no hay git workflow activo todavía en esta carpeta (revisar si el usuario decide iniciar uno).
6. **NO usar emojis en archivos de código** salvo pedido explícito.
7. **NO deployar ni exponer el login hardcodeado públicamente** sin advertir el riesgo de seguridad al usuario primero.

---

## 💬 Idioma

El usuario habla español. Las respuestas y comentarios van en **español**. El código (nombres de funciones/variables) del proyecto está en **inglés** — mantené esa convención existente en NEXUS (a diferencia de Alpha Fitness, que mezcla español).

---

**Última actualización**: 2026-07-07 (creación inicial del proyecto NEXUS como entidad separada).
