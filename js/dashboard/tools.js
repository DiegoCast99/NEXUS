/* ============================================================
   NEXUS Dashboard · Herramientas / Publicador Masivo
   ------------------------------------------------------------
   Clona publicaciones de una cuenta de Mercado Libre a otra.

   Dos reglas que mandan sobre todo lo demas:

   1. Los clones se crean con stock 0. ML los deja pausados solos,
      asi que no hay ningun instante en el que se puedan vender.
   2. Escribir stock ES activar (ML reactiva solo los items pausados
      por falta de stock). Por eso el modulo NUNCA escribe stock al
      clonar: recien lo hace cuando el titular aprieta "Activar".

   El bucle de clonado vive aca, no en el DOM: se puede cambiar de
   seccion y sigue corriendo. Se guarda el estado despues de cada
   producto, asi que tambien sobrevive a cerrar la pestaña.
   ============================================================ */
(function () {
  const S = window.NexusDash;
  const { elements, escapeHtml, state, moneyWithCents, mlAccounts, mlAccountById, safeSetItem } = S;

  const JOB_KEY = "nexus.tools.pub.job.v1";
  const HISTORY_KEY = "nexus.tools.pub.history.v1";
  const ACK_KEY = "nexus.tools.pub.ack.v1";

  const PAUSA_ENTRE_ITEMS = 600;   // ms — no saturar la API de ML
  const MAX_REINTENTOS = 3;
  const MAX_HISTORIAL = 15;
  const JOB_HUERFANO_MS = 120000;  // 2 min sin latido = quedo colgado

  /* ---------------- persistencia ---------------- */

  function leerJSON(clave, porDefecto) {
    try {
      const crudo = localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (e) {
      return porDefecto;
    }
  }

  function guardarJob() {
    const job = state.tools.pub.job;
    if (!job) {
      try { localStorage.removeItem(JOB_KEY); } catch (e) {}
      return;
    }
    job.actualizado = Date.now();
    safeSetItem(JOB_KEY, JSON.stringify(job));
  }

  function leerHistorial() {
    const lista = leerJSON(HISTORY_KEY, []);
    return Array.isArray(lista) ? lista : [];
  }

  // Manda el job terminado al historial y lo compacta: solo los conteos
  // y el mapeo origen->destino, que es lo que sirve despues.
  function archivarJob(job) {
    const historial = leerHistorial();
    historial.unshift({
      id: job.id,
      origen: job.origen,
      destino: job.destino,
      creado: job.creado,
      fin: Date.now(),
      ok: contar(job, ["ok", "warn"]),
      warn: contar(job, ["warn"]),
      err: contar(job, ["err"]),
      skip: contar(job, ["skip"]),
      items: job.items.map((it) => ({
        src: it.src, dst: it.dst, titulo: it.titulo, e: it.e, c: it.c, stock: it.stock
      }))
    });
    safeSetItem(HISTORY_KEY, JSON.stringify(historial.slice(0, MAX_HISTORIAL)));
  }

  function contar(job, estados) {
    return job.items.filter((it) => estados.indexOf(it.e) !== -1).length;
  }

  /* ---------------- estado de pantalla ---------------- */

  function pub() { return state.tools.pub; }

  function setMensaje(texto, tipo) {
    const el = elements.pubMessage;
    if (!el) return;
    el.textContent = texto || "";
    el.className = "meta-message" + (tipo ? " is-" + tipo : "");
  }

  function irAPaso(n) {
    pub().paso = n;
    renderPublicador();
  }

  /* ---------------- portada del modulo ---------------- */

  function renderToolsDashboard() {
    const abierta = pub().abierta;
    elements.toolsCards?.classList.toggle("is-hidden", !!abierta);
    if (abierta) renderPublicador();
  }

  function abrirPublicador() {
    pub().abierta = true;
    const nav = window.NexusPlatformNav;
    if (nav) nav.enterPlatform("tools", "Publicador Masivo");
    S.updateTopbarForView("tools");
    recuperarJobPendiente();
    renderToolsDashboard();
  }

  // El boton "Volver" de la barra contextual entra por aca.
  function clearSelectedTool() {
    pub().abierta = false;
    const nav = window.NexusPlatformNav;
    if (nav) nav.exitPlatform();
    S.updateTopbarForView("tools");
    renderToolsDashboard();
    S.animateActivePanel();
  }

  // Un job no puede estar "corriendo" si no hay bucle vivo: si quedo
  // asi por cerrar la pestaña, se degrada a pausado y se ofrece retomar.
  function recuperarJobPendiente() {
    const p = pub();
    if (p.job) return;
    const guardado = leerJSON(JOB_KEY, null);
    if (!guardado || !Array.isArray(guardado.items)) return;
    if (guardado.estado === "running" && Date.now() - (guardado.actualizado || 0) > JOB_HUERFANO_MS) {
      guardado.estado = "paused";
    }
    p.job = guardado;
    p.origen = guardado.origen;
    p.destino = guardado.destino;
    p.paso = (guardado.estado === "done" || guardado.estado === "done_errors") ? 4 : 3;
  }

  /* ---------------- render principal ---------------- */

  function renderPublicador() {
    const p = pub();
    if (!elements.pubPanel) return;

    renderPasos(p.paso);
    renderSelectoresCuenta();

    mostrar(elements.pubSetup, p.paso === 1);
    mostrar(elements.pubSelection, p.paso === 2);
    mostrar(elements.pubProgress, p.paso === 3);
    mostrar(elements.pubResult, p.paso === 4);

    if (p.paso === 2) renderTablaSeleccion();
    if (p.paso === 3) renderProgreso();
    if (p.paso === 4) renderResultado();
  }

  function mostrar(nodo, visible) {
    if (nodo) nodo.classList.toggle("is-hidden", !visible);
  }

  function renderPasos(actual) {
    const caja = elements.pubSteps;
    if (!caja) return;
    const pasos = ["Cuentas", "Seleccion", "Clonado", "Resultado"];
    caja.innerHTML = pasos.map((label, i) => {
      const n = i + 1;
      const clase = n < actual ? "is-done" : (n === actual ? "is-active" : "");
      return '<div class="nx-step ' + clase + '"><i>' + n + "</i><b>" + label + "</b></div>";
    }).join("");
  }

  function renderSelectoresCuenta() {
    const p = pub();
    const cuentas = mlAccounts();
    // Fase 1: solo entre cuentas del mismo pais. Brasil queda a la vista
    // pero deshabilitado para que se entienda que existe y no esta listo.
    const opciones = (seleccion, excluir) => cuentas.map((c) => {
      const brasil = c.id === "mercadolivre";
      const bloqueada = brasil || c.id === excluir;
      return '<option value="' + c.id + '"' +
        (c.id === seleccion ? " selected" : "") +
        (bloqueada ? " disabled" : "") + ">" +
        escapeHtml(c.name) + (brasil ? " (otro pais)" : "") + "</option>";
    }).join("");

    if (elements.pubSource) elements.pubSource.innerHTML = opciones(p.origen, p.destino);
    if (elements.pubTarget) elements.pubTarget.innerHTML = opciones(p.destino, p.origen);
  }

  /* ---------------- carga de catalogos ---------------- */

  // Lectura con reintentos: la API de ML tira 5xx pasajeros cada tanto, y la
  // carga del catalogo son muchas llamadas seguidas — sin esto, un solo 503
  // aborta la carga entera. Solo reintenta lo pasajero (5xx/429/red); un 401
  // (token) o 400 corta de una porque repetirlo no cambia nada.
  async function mlApiLectura(api, endpoint, cuenta) {
    const esperas = [1000, 3000, 8000];
    for (let intento = 0; ; intento++) {
      try {
        return await api.mlApi(endpoint, "GET", null, cuenta);
      } catch (error) {
        const s = error.httpStatus || 0;
        const pasajero = s === 0 || s === 429 || s >= 500;
        if (!pasajero || intento >= esperas.length) throw error;
        await dormir(esperas[intento]);
      }
    }
  }

  async function cargarCatalogo(api, cuenta) {
    const me = await mlApiLectura(api, "/users/me", cuenta);
    const userId = (me.payload || {}).id;
    if (!userId) throw new Error("No se pudo identificar la cuenta " + cuenta + ".");

    let ids = [];
    let offset = 0;
    for (let page = 0; page < 10; page++) {
      const res = await mlApiLectura(api, "/users/" + userId + "/items/search?limit=50&offset=" + offset, cuenta);
      const payload = res.payload || {};
      const lote = payload.results || [];
      ids = ids.concat(lote);
      const total = (payload.paging && payload.paging.total) || 0;
      offset += 50;
      if (!lote.length || offset >= total) break;
    }

    const items = [];
    for (let i = 0; i < ids.length; i += 20) {
      const grupo = ids.slice(i, i + 20);
      const det = await mlApiLectura(
        api,
        "/items?ids=" + grupo.join(",") +
        "&attributes=id,title,price,currency_id,available_quantity,status,secure_thumbnail,thumbnail," +
        "permalink,seller_custom_field,category_id,catalog_listing,pictures,variations",
        cuenta
      );
      (det.payload || []).forEach((row) => {
        const b = row && row.body ? row.body : null;
        if (!b || !b.id) return;
        items.push({
          id: String(b.id),
          title: String(b.title || ""),
          price: Number(b.price) || 0,
          stock: typeof b.available_quantity === "number" ? b.available_quantity : 0,
          status: String(b.status || ""),
          thumbnail: b.secure_thumbnail || b.thumbnail || "",
          permalink: b.permalink || "",
          sku: String(b.seller_custom_field || ""),
          categoria: String(b.category_id || ""),
          catalogo: !!b.catalog_listing,
          fotoId: (b.pictures && b.pictures[0] && b.pictures[0].id) || "",
          variantes: Array.isArray(b.variations) ? b.variations.length : 0
        });
      });
    }
    return items;
  }

  async function cargarPublicaciones() {
    const p = pub();
    if (p.cargando) return;
    if (p.origen === p.destino) {
      setMensaje("El origen y el destino tienen que ser cuentas distintas.", "error");
      return;
    }

    p.cargando = true;
    setMensaje("Cargando publicaciones de las dos cuentas...", "");
    if (elements.pubLoad) elements.pubLoad.disabled = true;

    try {
      const api = S.requireSecureApi();
      const origen = await cargarCatalogo(api, p.origen);
      const destino = await cargarCatalogo(api, p.destino);

      p.srcItems = origen;
      p.dstItems = destino;
      p.seleccion = {};

      // Puntaje de duplicado por producto, contra todo el catalogo destino.
      origen.forEach((item) => {
        item.dup = puntajeDuplicado(item, destino);
        // Lo casi seguro arranca destildado; el resto tildado.
        if (item.dup.puntaje < 50 && item.status !== "closed") p.seleccion[item.id] = true;
      });

      setMensaje("", "");
      irAPaso(2);
    } catch (error) {
      const s = error.httpStatus || 0;
      // "ML API error 503" no le dice nada al titular: se traduce a que paso
      // y que hacer. A este catch un pasajero solo llega tras 4 intentos.
      const msg = (s === 429 || s >= 500)
        ? "Mercado Libre no esta respondiendo (se reintento varias veces). Suele durar unos minutos: proba de nuevo en un rato."
        : (error.message || "No se pudieron cargar las publicaciones.");
      setMensaje(msg, "error");
    } finally {
      p.cargando = false;
      if (elements.pubLoad) elements.pubLoad.disabled = false;
    }
  }

  /* ---------------- deteccion de duplicados ---------------- */

  function normalizar(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function similitud(a, b) {
    const A = new Set(normalizar(a).split(" ").filter(Boolean));
    const B = new Set(normalizar(b).split(" ").filter(Boolean));
    if (!A.size || !B.size) return 0;
    let comunes = 0;
    A.forEach((t) => { if (B.has(t)) comunes++; });
    return comunes / (A.size + B.size - comunes);
  }

  // Suma señales independientes. Cuanto mas alto, mas probable es que
  // ese producto ya exista en la cuenta destino.
  function puntajeDuplicado(item, destino) {
    let mejor = { puntaje: 0, motivo: "", contra: "" };

    destino.forEach((otro) => {
      let puntaje = 0;
      const motivos = [];

      if (item.sku && otro.sku && item.sku === otro.sku) {
        puntaje += 50; motivos.push("mismo SKU");
      }
      const tituloIgual = normalizar(item.title) === normalizar(otro.title);
      if (tituloIgual) {
        puntaje += 30; motivos.push("titulo identico");
      } else if (similitud(item.title, otro.title) >= 0.85) {
        puntaje += 15; motivos.push("titulo muy parecido");
      }
      if (item.fotoId && otro.fotoId && item.fotoId === otro.fotoId) {
        puntaje += 10; motivos.push("misma foto");
      }
      if (item.categoria && item.categoria === otro.categoria && item.price > 0 &&
          Math.abs(item.price - otro.price) / item.price <= 0.05) {
        puntaje += 10; motivos.push("misma categoria y precio");
      }

      if (puntaje > mejor.puntaje) {
        mejor = { puntaje: puntaje, motivo: motivos.join(", "), contra: otro.id };
      }
    });

    return mejor;
  }

  function nivelDup(puntaje) {
    if (puntaje >= 50) return "alto";
    if (puntaje >= 25) return "medio";
    return "";
  }

  /* ---------------- tabla de seleccion ---------------- */

  function itemsVisibles() {
    const p = pub();
    const filtro = normalizar(p.busqueda);
    if (!filtro) return p.srcItems || [];
    return (p.srcItems || []).filter((i) =>
      normalizar(i.title).indexOf(filtro) !== -1 || i.id.toLowerCase().indexOf(filtro) !== -1);
  }

  function renderTablaSeleccion() {
    const p = pub();
    const cuerpo = elements.pubTableBody;
    if (!cuerpo) return;

    const items = itemsVisibles();
    const total = (p.srcItems || []).length;
    const elegidos = Object.keys(p.seleccion).filter((k) => p.seleccion[k]).length;

    if (elements.pubCount) {
      elements.pubCount.innerHTML = "<b>" + elegidos + "</b> de " + total + " seleccionadas";
    }
    if (elements.pubClone) {
      elements.pubClone.disabled = elegidos === 0;
      elements.pubClone.textContent = elegidos ? "Clonar " + elegidos : "Clonar";
    }
    if (elements.pubTargetName) {
      const dst = mlAccountById(p.destino);
      elements.pubTargetName.textContent = dst ? dst.name : p.destino;
    }
    elements.pubEmpty?.classList.toggle("is-visible", items.length === 0);

    cuerpo.innerHTML = items.map((item) => {
      const marcado = !!p.seleccion[item.id];
      const nivel = nivelDup(item.dup.puntaje);
      const claseFila = nivel === "alto" ? "pub-row-error" : (nivel === "medio" ? "pub-row-warn" : "");
      const foto = item.thumbnail
        ? '<img class="order-thumb" src="' + escapeHtml(item.thumbnail) + '" alt="" loading="lazy" />'
        : '<span class="order-thumb order-thumb-empty" aria-hidden="true"></span>';

      let dupCelda = '<span class="pub-dup-none">—</span>';
      if (nivel) {
        dupCelda = '<span class="type-pill ' + (nivel === "alto" ? "expense" : "pub-warn") + '" title="' +
          escapeHtml(item.dup.motivo) + '">' + (nivel === "alto" ? "Ya existe" : "Posible") + "</span>";
      }

      return '<tr data-pub-row="' + escapeHtml(item.id) + '" class="' + claseFila + '">' +
        "<td>" +
          '<button class="bulk-check' + (marcado ? " is-on" : "") + '" type="button" role="checkbox" ' +
          'aria-checked="' + marcado + '" data-pub-check="' + escapeHtml(item.id) + '" ' +
          'aria-label="Seleccionar publicacion"></button>' +
        "</td>" +
        '<td class="order-product"><div class="order-product-cell">' + foto +
          '<div class="order-product-info"><b>' + escapeHtml(item.title) + "</b>" +
          '<small class="order-stock">' + escapeHtml(item.id) +
          (item.variantes ? " · " + item.variantes + " variantes" : "") +
          (item.catalogo ? " · catalogo" : "") + "</small></div>" +
        "</div></td>" +
        "<td>" + moneyWithCents.format(item.price) + "</td>" +
        '<td class="num">' + item.stock + "</td>" +
        "<td>" + dupCelda + "</td>" +
      "</tr>";
    }).join("");

    if (elements.pubCheckAll) {
      const todas = items.length > 0 && items.every((i) => p.seleccion[i.id]);
      const algunas = items.some((i) => p.seleccion[i.id]);
      elements.pubCheckAll.classList.toggle("is-on", todas);
      elements.pubCheckAll.classList.toggle("is-partial", !todas && algunas);
    }
  }

  function alternarSeleccion(id) {
    const p = pub();
    p.seleccion[id] = !p.seleccion[id];
    renderTablaSeleccion();
  }

  function alternarTodas() {
    const p = pub();
    const items = itemsVisibles();
    const todas = items.length > 0 && items.every((i) => p.seleccion[i.id]);
    items.forEach((i) => { p.seleccion[i.id] = !todas; });
    renderTablaSeleccion();
  }

  /* ---------------- confirmacion y arranque ---------------- */

  function confirmarClonado() {
    const p = pub();

    // Un trabajo por vez. Sin este guard, un doble clic crea un job nuevo que
    // pisa al que se esta procesando: el bucle sigue con el viejo (que ya no
    // mira nadie) y el nuevo queda marcado "running" sin nadie que lo corra,
    // o sea la pantalla congelada con la barra a cero.
    if (p.corriendo) return;
    if (p.job && (p.job.estado === "running" || p.job.estado === "paused")) {
      setMensaje("Ya hay una importacion en curso. Terminala o cancelala antes de empezar otra.", "error");
      return;
    }

    const elegidos = (p.srcItems || []).filter((i) => p.seleccion[i.id]);
    if (!elegidos.length) return;

    const origen = mlAccountById(p.origen);
    const destino = mlAccountById(p.destino);
    const conAlerta = elegidos.filter((i) => nivelDup(i.dup.puntaje)).length;
    const yaAvisado = leerJSON(ACK_KEY, null) === "1";

    let texto = "Se van a crear " + elegidos.length + " publicaciones en " +
      (destino ? destino.name : p.destino) + ", copiadas de " + (origen ? origen.name : p.origen) + ".\n\n" +
      "Todas se crean PAUSADAS y sin stock. No se pueden vender hasta que vos las actives a mano.\n";

    if (conAlerta) {
      texto += "\n" + conAlerta + " de ellas estan marcadas como posible duplicado.\n";
    }
    if (!yaAvisado) {
      texto += "\nAviso: Mercado Libre modera publicaciones duplicadas entre cuentas del mismo titular. " +
        "Es una decision tuya de negocio.\n";
    }
    texto += "\n¿Arrancamos?";

    if (!window.confirm(texto)) return;
    safeSetItem(ACK_KEY, "1");
    if (elements.pubClone) elements.pubClone.disabled = true;

    p.job = {
      id: "job_" + Date.now(),
      estado: "running",
      origen: p.origen,
      destino: p.destino,
      creado: Date.now(),
      actualizado: Date.now(),
      items: elegidos.map((i) => ({
        src: i.id,
        titulo: i.title,
        dst: null,
        e: "pending",
        c: null,
        r: 0,
        stock: null
      }))
    };
    guardarJob();
    irAPaso(3);
    correrJob();
  }

  /* ---------------- el bucle ---------------- */

  async function correrJob() {
    const p = pub();
    if (p.corriendo) return;          // cerrojo: nada de dos bucles
    const job = p.job;
    if (!job) return;

    p.corriendo = true;
    p.pausaPedida = false;
    job.estado = "running";
    guardarJob();
    renderProgreso();

    const api = S.requireSecureApi();
    const yaClonados = mapaHistorico(job.origen, job.destino);

    try {
      for (let i = 0; i < job.items.length; i++) {
        const item = job.items[i];
        if (p.pausaPedida) {
          job.estado = "paused";
          guardarJob();
          renderProgreso();
          return;
        }
        if (item.e === "ok" || item.e === "warn" || item.e === "skip" || item.e === "err") continue;

        // Nunca duplicar: si ese producto ya se clono antes entre estas
        // dos cuentas, se saltea y se adopta el id que ya existia.
        if (yaClonados[item.src]) {
          item.dst = yaClonados[item.src];
          item.e = "skip";
          item.c = "ya_clonado";
          guardarJob();
          renderProgreso();
          continue;
        }

        item.e = "cloning";
        renderProgreso();

        const corte = await clonarUno(api, job, item);
        guardarJob();
        renderProgreso();

        if (corte) {
          // Error que no tiene sentido repetir 150 veces (token vencido,
          // limite de publicaciones): se pausa el trabajo entero.
          job.estado = "paused";
          guardarJob();
          renderProgreso();
          return;
        }

        // Espaciado para no saturar la API de ML. Despues del ultimo no tiene
        // sentido esperar: solo retrasaria la pantalla de resultado.
        if (i < job.items.length - 1) await dormir(PAUSA_ENTRE_ITEMS);
      }

      job.estado = contar(job, ["err"]) ? "done_errors" : "done";
      guardarJob();
      archivarJob(job);
      p.job = job;
      irAPaso(4);
    } finally {
      p.corriendo = false;
    }
  }

  // Devuelve true si hay que cortar el trabajo entero.
  async function clonarUno(api, job, item) {
    for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
      try {
        const res = await api.mlCloneItem(job.origen, job.destino, item.src);
        const payload = res.payload || {};
        item.dst = payload.newItemId || null;
        item.stock = payload.stock || null;
        item.permalink = payload.permalink || "";
        const avisos = payload.warnings || [];

        if (payload.paused === false) {
          item.e = "err";
          item.c = "quedo_activa";
          return false;
        }
        item.e = avisos.length ? "warn" : "ok";
        item.c = avisos.length ? avisos.join(", ") : null;
        return false;
      } catch (error) {
        const codigo = error.code || "";

        if (codigo === "sin_token") {
          item.e = "pending";
          item.c = "sin_conexion";
          return true;
        }
        // Pasajero: reintentar con espera creciente.
        if (esTransitorio(error) && intento < MAX_REINTENTOS) {
          item.r = intento + 1;
          renderProgreso();
          await dormir([2000, 8000, 30000][intento] || 30000);
          continue;
        }
        item.e = "err";
        item.c = (error.message || "error").slice(0, 220);
        // El rechazo completo de ML queda visible en la fila de error (y en
        // consola): sin el detalle crudo, un "body.invalid_fields" no dice
        // que campo tocar y el diagnostico es a ciegas.
        if (error.payload) {
          try {
            item.detalle = JSON.stringify(error.payload).slice(0, 600);
            console.warn("[publicador] rechazo de ML para " + item.src + ":", error.payload);
          } catch (e2) {}
        }
        return false;
      }
    }
    return false;
  }

  function esTransitorio(error) {
    if (error && error.code === "transitorio") return true;
    const s = error && error.httpStatus;
    return s === 503 || s === 429 || (s >= 500 && s < 600);
  }

  // Todos los pares origen->destino ya clonados, de todo el historial.
  function mapaHistorico(origen, destino) {
    const mapa = {};
    leerHistorial().forEach((job) => {
      if (job.origen !== origen || job.destino !== destino) return;
      (job.items || []).forEach((it) => {
        if (it.dst && (it.e === "ok" || it.e === "warn")) mapa[it.src] = it.dst;
      });
    });
    return mapa;
  }

  function pedirPausa() {
    pub().pausaPedida = true;
    setMensaje("Se va a pausar cuando termine la publicacion en curso...", "");
  }

  function reanudar() {
    setMensaje("", "");
    correrJob();
  }

  /* ---------------- progreso ---------------- */

  function renderProgreso() {
    const p = pub();
    const job = p.job;
    if (!job || !elements.pubProgressFill) return;

    // Red de seguridad: un trabajo no puede estar "corriendo" si no hay bucle
    // vivo. Si pasa igual, se degrada a pausado y aparece "Reanudar" — mucho
    // mejor que una barra congelada sin salida.
    if (job.estado === "running" && !p.corriendo) job.estado = "paused";

    const total = job.items.length;
    const listos = job.items.filter((i) => i.e !== "pending" && i.e !== "cloning").length;
    const errores = contar(job, ["err"]);
    const pct = total ? Math.round((listos / total) * 100) : 0;

    elements.pubProgressFill.style.width = pct + "%";
    elements.pubProgressFill.parentElement?.setAttribute("aria-valuenow", String(listos));
    elements.pubProgressFill.parentElement?.setAttribute("aria-valuemax", String(total));

    const bloque = elements.pubProgressBlock;
    if (bloque) {
      bloque.classList.toggle("is-done", listos === total && !errores);
      bloque.classList.toggle("has-errors", errores > 0);
    }
    if (elements.pubProgressCount) {
      elements.pubProgressCount.textContent = listos + " / " + total +
        (errores ? " · " + errores + " con error" : "");
    }

    const pausado = job.estado === "paused";
    mostrar(elements.pubPause, !pausado && job.estado === "running");
    mostrar(elements.pubResume, pausado);

    // Solo las excepciones: lo que sale bien no genera ni una fila.
    const problemas = job.items.filter((i) => i.e === "err" || i.e === "warn" || i.e === "skip");
    if (elements.pubProgressDetail) {
      elements.pubProgressDetail.innerHTML = problemas.length
        ? problemas.map((i) => filaExcepcion(i)).join("")
        : '<span class="pub-quiet">Sin novedades por ahora.</span>';
    }
  }

  // Los codigos internos no le dicen nada al titular: se traducen a algo que
  // explique que paso y, si hace falta, que tiene que hacer.
  const MOTIVOS = {
    ya_clonado: "ya estaba clonada en la cuenta destino",
    quedo_activa: "se creo pero NO se pudo pausar: abrila y pausala ya",
    sin_conexion: "se corto la conexion con la cuenta; reconectala y reanuda",
    video_descartado: "se publico sin el video (Mercado Libre lo rechazo)",
    sin_descripcion: "el original no tenia descripcion",
    sin_fotos: "el original no tenia fotos",
    titulo_recortado: "el titulo se recorto a 60 caracteres",
    catalogo_descartado: "se publico fuera del catalogo",
    garantia_descartada: "se publico sin los datos de garantia",
    publicacion_de_catalogo: "es publicacion de catalogo: revisa como quedo",
    fotos_variantes_sin_mapear: "las variantes quedaron sin foto propia"
  };

  function traducirMotivo(codigo) {
    if (!codigo) return "";
    return String(codigo).split(", ").map((c) => {
      if (MOTIVOS[c]) return MOTIVOS[c];
      if (c.indexOf("atributo_descartado:") === 0) {
        return "se publico sin el atributo " + c.split(":")[1];
      }
      if (c.indexOf("campo_descartado:") === 0) {
        return "se publico sin el campo " + c.split(":")[1] + " (la cuenta destino no lo acepta)";
      }
      return c; // mensaje textual de ML: mejor crudo que inventado
    }).join(" · ");
  }

  function filaExcepcion(item) {
    const critico = item.c === "quedo_activa";
    const clase = item.e === "err" ? "pub-issue-error" : "pub-issue-warn";
    const etiqueta = critico ? "Atencion" : (item.e === "err" ? "Error" : (item.e === "skip" ? "Omitida" : "Aviso"));
    const motivo = traducirMotivo(item.c);
    const enlace = critico && item.permalink
      ? ' <a href="' + escapeHtml(item.permalink) + '" target="_blank" rel="noopener">Abrir en ML</a>'
      : "";
    const crudo = item.detalle
      ? '<small class="pub-issue-raw">' + escapeHtml(item.detalle) + "</small>"
      : "";
    return '<span class="pub-issue-row ' + clase + (critico ? " pub-issue-critico" : "") + '"><b>' +
      etiqueta + "</b> " + escapeHtml(item.titulo) +
      (motivo ? " — " + escapeHtml(motivo) : "") + enlace + crudo + "</span>";
  }

  /* ---------------- resultado ---------------- */

  function renderResultado() {
    const job = pub().job;
    if (!job || !elements.pubResultStats) return;

    const ok = contar(job, ["ok"]);
    const warn = contar(job, ["warn"]);
    const err = contar(job, ["err"]);
    const skip = contar(job, ["skip"]);

    elements.pubResultStats.innerHTML = [
      tarjeta("Clonadas", ok + warn, "clonadas y pausadas"),
      tarjeta("Con aviso", warn, "revisá el detalle"),
      tarjeta("Con error", err, "no se crearon"),
      tarjeta("Omitidas", skip, "ya existían")
    ].join("");

    const problemas = job.items.filter((i) => i.e !== "ok");
    if (elements.pubResultIssues) {
      elements.pubResultIssues.innerHTML = problemas.length
        ? problemas.map((i) => filaExcepcion(i)).join("")
        : '<span class="pub-quiet">Todo salió limpio. No hay nada para revisar.</span>';
    }

    const activables = job.items.filter((i) => i.dst && (i.e === "ok" || i.e === "warn"));
    const conStock = activables.filter((i) => i.stock && i.stock.total > 0);
    if (elements.pubActivate) {
      elements.pubActivate.disabled = conStock.length === 0;
      elements.pubActivate.textContent = conStock.length
        ? "Activar " + conStock.length + " con stock"
        : "Activar con stock";
    }
    if (elements.pubResultNote) {
      const n = activables.length;
      elements.pubResultNote.textContent = n
        ? (n === 1
            ? "La publicación nueva está pausada y sin stock."
            : "Las " + n + " publicaciones nuevas están pausadas y sin stock.") +
          " Si no hacés nada, se quedan así."
        : "";
    }
  }

  function tarjeta(titulo, valor, pie) {
    return '<div class="metric-card"><span>' + titulo + "</span><strong>" + valor +
      "</strong><small>" + pie + "</small></div>";
  }

  /* ---------------- activacion ---------------- */

  // Activar = escribir el stock original. ML reactiva solo los items que
  // pauso por falta de stock, asi que no hace falta tocar el status.
  async function activarConStock() {
    const job = pub().job;
    if (!job) return;

    const objetivo = job.items.filter((i) => i.dst && (i.e === "ok" || i.e === "warn") && i.stock && i.stock.total > 0);
    if (!objetivo.length) return;

    const destino = mlAccountById(job.destino);
    if (!window.confirm(
      "Se van a ACTIVAR " + objetivo.length + " publicaciones en " + (destino ? destino.name : job.destino) +
      ", cargándoles el mismo stock que tienen en la cuenta de origen.\n\n" +
      "A partir de ese momento se pueden vender. ¿Confirmás?"
    )) return;

    if (elements.pubActivate) elements.pubActivate.disabled = true;
    setMensaje("Activando publicaciones...", "");

    const api = S.requireSecureApi();
    let hechas = 0;
    const fallos = [];

    for (const item of objetivo) {
      try {
        if (item.stock.variantes && item.stock.variantes.length) {
          // Con variantes hay que cargar el stock de cada una: se lee el
          // clon y se emparejan por el nombre de la combinacion.
          const actual = await api.mlApi("/items/" + item.dst + "?attributes=variations", "GET", null, job.destino);
          const variantes = ((actual.payload || {}).variations || []).map((v) => {
            const etiqueta = (v.attribute_combinations || []).map((c) => c.value_name).filter(Boolean).join(" / ");
            const origen = item.stock.variantes.find((o) => o.combinacion === etiqueta);
            return { id: v.id, available_quantity: origen ? origen.cantidad : 0 };
          });
          await api.mlApi("/items/" + item.dst, "PUT", { variations: variantes }, job.destino);
        } else {
          await api.mlApi("/items/" + item.dst, "PUT", { available_quantity: item.stock.total }, job.destino);
        }
        item.e = "activa";
        hechas++;
      } catch (error) {
        fallos.push(item.titulo + ": " + (error.message || "error"));
      }
    }

    guardarJob();
    setMensaje(
      hechas + " publicaciones activadas." + (fallos.length ? " " + fallos.length + " fallaron." : ""),
      fallos.length ? "error" : "success"
    );
    renderResultado();
  }

  /* ---------------- historial ---------------- */

  function renderHistorial() {
    const cuerpo = elements.pubHistoryBody;
    if (!cuerpo) return;
    const historial = leerHistorial();

    elements.pubHistoryEmpty?.classList.toggle("is-visible", historial.length === 0);

    cuerpo.innerHTML = historial.map((job) => {
      const origen = mlAccountById(job.origen);
      const destino = mlAccountById(job.destino);
      const fecha = new Date(job.creado);
      const estado = job.err
        ? '<span class="type-pill expense">Con errores</span>'
        : '<span class="type-pill income">Completado</span>';
      return "<tr>" +
        "<td>" + fecha.toLocaleDateString("es-419") + " " +
          fecha.toLocaleTimeString("es-419", { hour: "2-digit", minute: "2-digit" }) + "</td>" +
        "<td>" + escapeHtml((origen ? origen.name : job.origen) + " → " + (destino ? destino.name : job.destino)) + "</td>" +
        '<td class="num">' + job.ok + "</td>" +
        '<td class="num">' + job.err + "</td>" +
        '<td class="num">' + job.skip + "</td>" +
        "<td>" + estado + "</td>" +
      "</tr>";
    }).join("");
  }

  /* ---------------- eventos ---------------- */

  function bindTools() {
    elements.toolsCards?.addEventListener("click", (event) => {
      if (event.target.closest("[data-tool='publicador']")) abrirPublicador();
    });

    elements.pubSource?.addEventListener("change", (e) => {
      pub().origen = e.target.value;
      renderSelectoresCuenta();
    });
    elements.pubTarget?.addEventListener("change", (e) => {
      pub().destino = e.target.value;
      renderSelectoresCuenta();
    });

    elements.pubLoad?.addEventListener("click", cargarPublicaciones);
    elements.pubClone?.addEventListener("click", confirmarClonado);
    elements.pubBack?.addEventListener("click", () => irAPaso(1));
    elements.pubPause?.addEventListener("click", pedirPausa);
    elements.pubResume?.addEventListener("click", reanudar);
    elements.pubActivate?.addEventListener("click", activarConStock);
    elements.pubNewJob?.addEventListener("click", () => {
      pub().job = null;
      guardarJob();
      irAPaso(1);
    });
    elements.pubCheckAll?.addEventListener("click", alternarTodas);
    elements.pubSearch?.addEventListener("input", (e) => {
      pub().busqueda = e.target.value;
      renderTablaSeleccion();
    });

    elements.pubTableBody?.addEventListener("click", (event) => {
      const check = event.target.closest("[data-pub-check]");
      if (check) alternarSeleccion(check.getAttribute("data-pub-check"));
    });
  }

  // Carga diferida: el historial se arma recien al abrir su seccion.
  window.addEventListener("nexus:section", (event) => {
    const d = (event && event.detail) || {};
    if (d.module !== "tools") return;
    if (d.section === "historial") renderHistorial();
    if (d.section === "publicador") renderPublicador();
  });

  function dormir(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  Object.assign(S, {
    renderToolsDashboard,
    clearSelectedTool,
    bindTools,
    renderHistorial
  });
})();
