/* ============================================================
   NEXUS · POST /.netlify/functions/ml-clone-item
   ------------------------------------------------------------
   Clona UNA publicacion de una cuenta de Mercado Libre a otra.
   El navegador llama esta funcion una vez por producto: asi el
   proceso es reanudable y cada item cabe holgado en el timeout.

   Body:   { "sourceAccount": "mercadolibre",
             "destAccount":   "mercadolibre2",
             "sourceItemId":  "MLU123456789",
             "dryRun":        false }
   Header: Authorization: Bearer <Firebase ID token>

   REGLA DURA: el clon se crea con stock 0. La documentacion de ML
   dice que un item con available_quantity 0 nace con status
   "paused" y sub_status "out_of_stock", asi que no existe ninguna
   ventana en la que alguien pueda comprarlo. El titular carga el
   stock a mano cuando quiere activarlo.

   Ojo con esto: ML reactiva SOLO los items pausados por falta de
   stock en cuanto se les cargan unidades. Por eso el modulo nunca
   escribe stock al clonar — escribir stock ES activar.
   ============================================================ */
const {
  decrypt,
  encrypt,
  readUserField,
  writeUserField,
  uidFromIdToken,
  getIdToken,
  parseBody,
  json,
  mlAccount
} = require("./_shared");

const ML_API = "https://api.mercadolibre.com";
const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_BUFFER_SECS = 300;

// Atributos que NO se reenvian al crear: los calcula ML o viajan en
// un campo propio del cuerpo (condition), y mandarlos da error.
const ATRIBUTOS_PROHIBIDOS = ["ITEM_CONDITION"];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Solo POST." });

  try {
    const idToken = getIdToken(event);
    const uid = uidFromIdToken(idToken);
    const body = parseBody(event);

    const origen = mlAccount(body.sourceAccount);
    const destino = mlAccount(body.destAccount);
    const itemId = String(body.sourceItemId || "").trim();
    const dryRun = body.dryRun === true;

    if (!itemId) return json(400, { error: "Falta el id de la publicacion a clonar." });
    if (origen === destino) return json(400, { error: "El origen y el destino no pueden ser la misma cuenta." });

    const tokenOrigen = await resolverToken(uid, idToken, origen);
    const tokenDestino = await resolverToken(uid, idToken, destino);

    // Mismo pais o no hay clonado posible: las categorias y la moneda
    // de cada site son distintas.
    if (siteDe(tokenOrigen) && siteDe(tokenDestino) && siteDe(tokenOrigen) !== siteDe(tokenDestino)) {
      return json(400, { error: "Las dos cuentas tienen que ser del mismo pais." });
    }

    const avisos = [];

    // ---- 1. Leer la publicacion original -------------------------
    const src = await mlFetch(tokenOrigen, "/items/" + itemId + "?include_attributes=all");
    if (src.status === "closed" || (src.sub_status || []).indexOf("deleted") !== -1) {
      return json(422, { error: "La publicacion original esta cerrada.", code: "src_no_clonable" });
    }

    // ---- 2. Leer la descripcion ----------------------------------
    let descripcion = "";
    try {
      const desc = await mlFetch(tokenOrigen, "/items/" + itemId + "/description");
      descripcion = String(desc.plain_text || desc.text || "").trim();
    } catch (e) {
      avisos.push("sin_descripcion");
    }

    // ---- 3. Armar el cuerpo de creacion --------------------------
    const nuevo = construirCuerpo(src, descripcion, avisos);

    if (dryRun) {
      return json(200, {
        payload: {
          dryRun: true,
          body: nuevo,
          stock: leerStockOriginal(src),
          warnings: avisos
        }
      });
    }

    // ---- 4. Crear en destino (nace pausado, stock 0) -------------
    let creado;
    try {
      creado = await mlFetch(tokenDestino, "/items", "POST", nuevo);
    } catch (error) {
      // Reparacion automatica: si ML se queja de campos puntuales, los
      // sacamos y probamos una sola vez mas. Cada supresion queda como
      // aviso para que el titular sepa que perdio.
      const reparado = repararCuerpo(nuevo, error.mlPayload, avisos);
      if (!reparado) throw error;
      creado = await mlFetch(tokenDestino, "/items", "POST", reparado);
    }

    const nuevoId = creado.id;
    if (!nuevoId) throw new Error("Mercado Libre no devolvio el id de la publicacion nueva.");

    // ---- 5. Garantizar el pausado --------------------------------
    // Con stock 0 deberia venir pausado de fabrica. Si por lo que sea
    // vino activo, se pausa ya: es la unica regla que no se negocia.
    let pausado = creado.status === "paused";
    if (!pausado) {
      for (let intento = 0; intento < 3 && !pausado; intento++) {
        try {
          const r = await mlFetch(tokenDestino, "/items/" + nuevoId, "PUT", { status: "paused" });
          pausado = r.status === "paused";
        } catch (e) {
          await dormir(600 * (intento + 1));
        }
      }
    }

    // ---- 6. Mapear las fotos de cada variante --------------------
    // Las fotos se crearon nuevas en la cuenta destino, asi que los ids
    // de las variantes del original no sirven. Como ML asigna los ids
    // nuevos en el MISMO orden en que se le mandaron las fotos, el
    // mapeo es por posicion.
    if (Array.isArray(src.variations) && src.variations.length) {
      try {
        await mapearFotosDeVariantes(tokenDestino, src, creado, nuevoId, avisos);
      } catch (e) {
        avisos.push("fotos_variantes_sin_mapear");
      }
    }

    if (!pausado) {
      // Se creo pero no se pudo pausar: el cliente lo trata como critico.
      return json(200, {
        payload: {
          newItemId: nuevoId,
          permalink: creado.permalink || "",
          paused: false,
          stock: leerStockOriginal(src),
          warnings: avisos.concat(["no_se_pudo_pausar"])
        }
      });
    }

    return json(200, {
      payload: {
        newItemId: nuevoId,
        permalink: creado.permalink || "",
        paused: true,
        stock: leerStockOriginal(src),
        warnings: avisos
      }
    });
  } catch (error) {
    const estado = error.mlStatus || 0;
    // 429 y 5xx son pasajeros (vale reintentar); 400/422 son de validacion.
    const transitorio = estado === 429 || estado >= 500 || estado === 0;
    return json(transitorio ? 503 : 422, {
      error: error.message || "No se pudo clonar la publicacion.",
      code: error.code || (transitorio ? "transitorio" : "validacion"),
      mlStatus: estado,
      mlPayload: error.mlPayload || null
    });
  }
};

/* ---------- construccion del cuerpo ---------- */

function construirCuerpo(src, descripcion, avisos) {
  const tieneVariantes = Array.isArray(src.variations) && src.variations.length > 0;

  const cuerpo = {
    title: String(src.title || "").slice(0, 60),
    category_id: src.category_id,
    price: src.price,
    currency_id: src.currency_id,
    buying_mode: src.buying_mode || "buy_it_now",
    listing_type_id: src.listing_type_id,
    condition: src.condition || "new"
  };

  if (String(src.title || "").length > 60) avisos.push("titulo_recortado");

  // family_name: en el modelo nuevo de ML ("User Products" / precio por
  // variacion) es OBLIGATORIO al crear. Si la cuenta destino ya esta migrada
  // y no lo mandamos, ML rechaza el cuerpo entero con
  // "does not contains ... [family_name]". Se copia el del original si lo
  // tiene; si no (cuenta origen sin migrar), se usa el titulo como nombre de
  // familia. En cuentas no migradas ML lo acepta igual (es un campo estandar).
  const nombreFamilia = String(src.family_name || src.title || "").trim();
  if (nombreFamilia) cuerpo.family_name = nombreFamilia;

  // Stock 0 = nace pausado. Con variantes hay que ponerlo en cada una.
  if (!tieneVariantes) cuerpo.available_quantity = 0;

  const fotos = (src.pictures || [])
    .map((p) => p.secure_url || p.url)
    .filter((u) => typeof u === "string" && u.indexOf("https://") === 0);
  if (fotos.length) {
    cuerpo.pictures = fotos.map((u) => ({ source: u }));
  } else {
    avisos.push("sin_fotos");
  }

  if (descripcion) cuerpo.description = { plain_text: descripcion };

  const atributos = limpiarAtributos(src.attributes);
  if (atributos.length) cuerpo.attributes = atributos;

  const terminos = limpiarAtributos(src.sale_terms);
  if (terminos.length) cuerpo.sale_terms = terminos;

  if (src.shipping) {
    cuerpo.shipping = {
      mode: src.shipping.mode || "not_specified",
      local_pick_up: !!src.shipping.local_pick_up,
      free_shipping: !!src.shipping.free_shipping
    };
  }

  if (src.video_id) cuerpo.video_id = src.video_id;
  if (src.seller_custom_field) cuerpo.seller_custom_field = src.seller_custom_field;

  if (src.catalog_listing && src.catalog_product_id) {
    cuerpo.catalog_product_id = src.catalog_product_id;
    cuerpo.catalog_listing = true;
    avisos.push("publicacion_de_catalogo");
  }

  if (tieneVariantes) {
    cuerpo.variations = src.variations.map((v) => {
      const variante = {
        attribute_combinations: limpiarAtributos(v.attribute_combinations),
        available_quantity: 0, // igual que arriba: nace sin stock
        price: v.price
      };
      const propios = limpiarAtributos(v.attributes);
      if (propios.length) variante.attributes = propios;
      if (v.seller_custom_field) variante.seller_custom_field = v.seller_custom_field;
      return variante;
    });
  }

  return cuerpo;
}

// Deja los atributos en la forma que acepta la creacion: id + value_id,
// o id + value_name cuando el valor es libre. Los vacios y los que ML
// calcula sola se descartan.
function limpiarAtributos(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((a) => a && a.id && ATRIBUTOS_PROHIBIDOS.indexOf(a.id) === -1)
    .filter((a) => a.value_id || a.value_name)
    .map((a) => (a.value_id
      ? { id: a.id, value_id: String(a.value_id) }
      : { id: a.id, value_name: String(a.value_name) }));
}

function leerStockOriginal(src) {
  const variantes = (src.variations || []).map((v) => ({
    combinacion: (v.attribute_combinations || []).map((c) => c.value_name).filter(Boolean).join(" / "),
    cantidad: v.available_quantity || 0
  }));
  return {
    total: src.available_quantity || variantes.reduce((suma, v) => suma + v.cantidad, 0),
    variantes: variantes
  };
}

/* ---------- reparacion ante rechazo ---------- */

// ML devuelve el detalle en `cause[]`. Buscamos los campos y atributos
// que nombra y los sacamos del cuerpo para reintentar una sola vez.
// Campos que se pueden sacar del cuerpo sin invalidar el clon (se pierde un
// extra y queda avisado). Los esenciales NUNCA se sacan: titulo, categoria,
// precio, moneda, fotos y variantes porque sin ellos el clon no tiene
// sentido; available_quantity/condition/buying_mode porque son obligatorios
// y el stock 0 es justamente la garantia de que el clon nace pausado.
const CAMPOS_DESCARTABLES = [
  "video_id", "seller_custom_field", "sale_terms", "catalog_product_id",
  "catalog_listing", "family_name", "description", "shipping"
];

function repararCuerpo(cuerpo, mlPayload, avisos) {
  if (!mlPayload) return null;
  const listaCausas = [].concat(mlPayload.cause || []);
  const causas = (String(mlPayload.message || "") + " | " + String(mlPayload.error || "") + " | " + listaCausas
    .map((c) => {
      if (!c) return "";
      if (typeof c === "string") return c; // causas como texto suelto
      const refs = Array.isArray(c.references) ? c.references.join(" ") : "";
      return String(c.message || "") + " " + String(c.code || "") + " " + refs;
    })
    .join(" | "))
    .toUpperCase();
  if (!causas.trim()) return null;

  const copia = JSON.parse(JSON.stringify(cuerpo));
  let toco = false;

  // Reparacion generica: ML nombra los campos invalidos en `references` (y a
  // veces dentro del message, como "The fields [x, y] are invalid"). Todo
  // campo nombrado que sea descartable se saca; asi un "body.invalid_fields"
  // se arregla solo aunque el campo no este previsto aca arriba.
  const nombrados = [];
  listaCausas.forEach((c) => {
    if (c && Array.isArray(c.references)) nombrados.push.apply(nombrados, c.references);
  });
  const corchetes = causas.match(/\[([^\]]+)\]/g) || [];
  corchetes.forEach((grupo) => {
    grupo.replace(/[\[\]]/g, "").split(",").forEach((n) => nombrados.push(n.trim()));
  });
  nombrados.forEach((crudo) => {
    const campo = String(crudo || "").toLowerCase().trim();
    if (CAMPOS_DESCARTABLES.indexOf(campo) !== -1 && copia[campo] !== undefined) {
      delete copia[campo];
      if (campo === "catalog_product_id") delete copia.catalog_listing;
      avisos.push("campo_descartado:" + campo);
      toco = true;
    }
  });

  if (copia.video_id && causas.indexOf("VIDEO") !== -1) {
    delete copia.video_id;
    avisos.push("video_descartado");
    toco = true;
  }

  if (copia.catalog_product_id && causas.indexOf("CATALOG") !== -1) {
    delete copia.catalog_product_id;
    delete copia.catalog_listing;
    avisos.push("catalogo_descartado");
    toco = true;
  }

  if (copia.sale_terms && causas.indexOf("SALE_TERMS") !== -1) {
    delete copia.sale_terms;
    avisos.push("garantia_descartada");
    toco = true;
  }

  // Cuenta destino NO migrada que rechaza un family_name explicito: se saca y
  // se reintenta (lo contrario del caso migrado, donde family_name es
  // obligatorio y se manda proactivamente en construirCuerpo).
  if (copia.family_name && causas.indexOf("FAMILY_NAME") !== -1) {
    delete copia.family_name;
    avisos.push("family_name_descartado");
    toco = true;
  }

  // Atributos nombrados explicitamente en las causas.
  if (Array.isArray(copia.attributes)) {
    const quedan = copia.attributes.filter((a) => causas.indexOf(a.id) === -1);
    if (quedan.length !== copia.attributes.length) {
      copia.attributes
        .filter((a) => causas.indexOf(a.id) !== -1)
        .forEach((a) => avisos.push("atributo_descartado:" + a.id));
      copia.attributes = quedan;
      toco = true;
    }
  }

  return toco ? copia : null;
}

/* ---------- fotos de variantes ---------- */

async function mapearFotosDeVariantes(token, src, creado, nuevoId, avisos) {
  const fotosOrigen = src.pictures || [];
  const fotosNuevas = creado.pictures || [];
  const variantesNuevas = creado.variations || [];

  if (!fotosNuevas.length || !variantesNuevas.length) return;

  // id de foto del original -> posicion -> id de foto nueva
  const porPosicion = {};
  fotosOrigen.forEach((foto, i) => {
    if (foto && foto.id && fotosNuevas[i] && fotosNuevas[i].id) {
      porPosicion[foto.id] = fotosNuevas[i].id;
    }
  });

  const conFotos = src.variations.some((v) => (v.picture_ids || []).length);
  if (!conFotos) return;

  // Las variantes nuevas vienen en el mismo orden en que se enviaron.
  const variaciones = variantesNuevas.map((vNueva, i) => {
    const vOrigen = src.variations[i] || {};
    const ids = (vOrigen.picture_ids || [])
      .map((idViejo) => porPosicion[idViejo])
      .filter(Boolean);
    return { id: vNueva.id, picture_ids: ids };
  }).filter((v) => v.picture_ids.length);

  if (!variaciones.length) {
    avisos.push("fotos_variantes_sin_mapear");
    return;
  }

  await mlFetch(token, "/items/" + nuevoId, "PUT", { variations: variaciones });
}

/* ---------- tokens y llamadas ---------- */

async function resolverToken(uid, idToken, cuenta) {
  const field = "secret_" + cuenta;
  const enc = await readUserField(uid, idToken, field);
  if (!enc) {
    const e = new Error("La cuenta " + cuenta + " no esta conectada. Conectala primero.");
    e.code = "sin_token";
    throw e;
  }
  let tokens = JSON.parse(decrypt(enc));

  const ahora = Math.floor(Date.now() / 1000);
  const vence = (tokens.obtained_at || 0) + (tokens.expires_in || 0) - REFRESH_BUFFER_SECS;
  if (ahora >= vence && tokens.refresh_token) {
    tokens = await refrescar(tokens, uid, idToken, field);
  }
  return tokens;
}

async function refrescar(tokens, uid, idToken, field) {
  const appId = process.env.ML_APP_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!appId || !clientSecret) throw new Error("Faltan ML_APP_ID / ML_CLIENT_SECRET.");

  const res = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token
    }).toString()
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const e = new Error("Se vencio la conexion con Mercado Libre. Reconecta la cuenta.");
    e.code = "sin_token";
    throw e;
  }

  const fresco = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || 10800,
    user_id: data.user_id || tokens.user_id,
    obtained_at: Math.floor(Date.now() / 1000)
  };
  await writeUserField(uid, idToken, field, encrypt(JSON.stringify(fresco)));
  return fresco;
}

async function mlFetch(tokens, endpoint, metodo, cuerpo) {
  const opciones = {
    method: (metodo || "GET").toUpperCase(),
    headers: {
      Authorization: "Bearer " + tokens.access_token,
      Accept: "application/json"
    },
    cache: "no-store"
  };
  if (cuerpo && opciones.method !== "GET") {
    opciones.headers["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(cuerpo);
  }

  const res = await fetch(ML_API + endpoint, opciones);
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    // El detalle util de ML suele venir repartido: `message` de cada causa,
    // su `code`, y los NOMBRES DE CAMPO en `references`. Sin references, un
    // "body.invalid_fields" no dice nada; con ellas dice que campo arreglar.
    const detalle = []
      .concat(payload.cause || [])
      .map((c) => {
        if (!c) return "";
        // ML a veces manda las causas como strings sueltos, no objetos.
        // Descartarlas dejaba el error pelado ("body.invalid_fields" a secas).
        if (typeof c === "string") return c;
        const texto = c.message || c.code || "";
        const refs = Array.isArray(c.references) && c.references.length
          ? " [" + c.references.join(", ") + "]"
          : "";
        return texto + refs;
      })
      .filter(Boolean)
      .join(" · ");
    const base = payload.message || "Mercado Libre respondio " + res.status + ".";
    // Sin duplicar: si el detalle ya arranca con el mismo texto que el
    // mensaje general, alcanza con el detalle.
    const e = new Error(!detalle ? base : (detalle.indexOf(base) === 0 ? detalle : base + ": " + detalle));
    e.mlStatus = res.status;
    e.mlPayload = payload;
    throw e;
  }
  return payload;
}

function siteDe(tokens) {
  // El site sale del id de usuario solo en algunos casos; si no lo
  // sabemos, no bloqueamos (la validacion fuerte la hace el frontend).
  return tokens && tokens.site_id ? String(tokens.site_id) : "";
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
