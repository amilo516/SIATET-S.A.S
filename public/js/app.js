// =====================================================================
//  APP DEL TÉCNICO
// =====================================================================

const estado = {
  usuario: null,
  perfil: null,
  formato: FORMATO_BASE,
  formatoFormulario: null,   // versión con la que se abrió el formulario actual
  informes: [],              // informes que vienen de la base de datos (o su copia local)
  respaldos: {},             // copia de seguridad hasta que el servidor confirme
  firmas: {},
  ultimoGuardado: null,
  desuscribir: []
};

const PANTALLAS = ["cargando", "ingreso", "inicio", "formulario", "guardado"];
function mostrar(nombre) {
  PANTALLAS.forEach((p) => ($(`#pantalla-${p}`).hidden = p !== nombre));
  $("#btn-cancelar").hidden = nombre !== "formulario";
  window.scrollTo(0, 0);
  if (nombre === "formulario") requestAnimationFrame(ajustarLienzos);
}

vigilarConexion($("#estado-red"));
registrarServiceWorker();

// ---------------------------------------------------------------------
//  Sesión
// ---------------------------------------------------------------------
$("#form-ingreso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const correo = $("#ing-correo").value.trim();
  const clave = $("#ing-clave").value;
  if (!navigator.onLine) return aviso("Para ingresar la primera vez necesitas internet.", "error");
  try {
    await auth.signInWithEmailAndPassword(correo, clave);
  } catch (err) {
    const mensajes = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/wrong-password": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "Ese correo no está registrado.",
      "auth/too-many-requests": "Demasiados intentos. Espera unos minutos."
    };
    aviso(mensajes[err.code] || "No se pudo ingresar: " + err.message, "error");
  }
});

$("#btn-salir").addEventListener("click", async () => {
  const pendientes = listaCompleta().filter((i) => i._pendiente).length;
  if (pendientes) {
    return aviso(`Tienes ${pendientes} informe(s) sin enviar. Conéctate a internet antes de cerrar sesión.`, "error");
  }
  if (!confirm("¿Cerrar sesión en este dispositivo?")) return;
  await auth.signOut();
});

auth.onAuthStateChanged(async (usuario) => {
  estado.desuscribir.forEach((fn) => fn());
  estado.desuscribir = [];
  estado.usuario = usuario;

  if (!usuario) return mostrar("ingreso");
  mostrar("cargando");

  estado.perfil = await cargarPerfil(usuario);
  if (!estado.perfil) {
    aviso("Tu usuario no está habilitado. Pide al administrador que te registre.", "error");
    await auth.signOut();
    return;
  }

  // El administrador va directo al panel, salvo que venga a llenar un informe
  const modoTecnico = new URLSearchParams(location.search).get("modo") === "tecnico";
  if (estado.perfil.rol === "admin" && !modoTecnico) {
    location.replace("admin.html");
    return;
  }

  $("#btn-panel").hidden = estado.perfil.rol !== "admin";
  estado.respaldos = leerRespaldos();
  $("#saludo").textContent = `Hola, ${estado.perfil.nombre.split(" ")[0]}`;

  estado.desuscribir.push(escucharFormatoVigente((f) => {
    estado.formato = f;
    $("#info-formato").textContent = `Formato versión ${f.version}`;
  }));
  estado.desuscribir.push(escucharInformes());

  revisarRespaldos();
  mostrar("inicio");
});

async function cargarPerfil(usuario) {
  const clave = `perfil_${usuario.uid}`;
  try {
    const snap = await db.collection("usuarios").doc(usuario.uid).get();
    if (snap.exists) {
      const perfil = { nombre: usuario.email, prefijo: "INF", ...snap.data() };
      localStorage.setItem(clave, JSON.stringify(perfil));
      return perfil;
    }
    if (snap.metadata.fromCache) throw new Error("sin datos en el dispositivo");
    return null;
  } catch (e) {
    const local = localStorage.getItem(clave);
    return local ? JSON.parse(local) : null;
  }
}

// ---------------------------------------------------------------------
//  Lista de informes y estado de sincronización
// ---------------------------------------------------------------------
function escucharInformes() {
  const base = db.collection("informes").where("tecnicoUid", "==", estado.usuario.uid);
  let desuscribir = () => {};

  const alRecibir = (snap) => {
    estado.informes = snap.docs.map((d) => ({
      ...d.data(),
      id: d.id,
      _pendiente: d.metadata.hasPendingWrites
    }));
    estado.informes.sort((a, b) => (b.creadoLocal || "").localeCompare(a.creadoLocal || ""));
    // Si el servidor ya confirmó el informe, se borra la copia de seguridad
    snap.docs.forEach((d) => {
      if (!d.metadata.hasPendingWrites && !d.metadata.fromCache) quitarRespaldo(d.id);
    });
    pintarLista();
  };

  const conOrden = base.orderBy("creadoLocal", "desc").limit(60);
  desuscribir = conOrden.onSnapshot({ includeMetadataChanges: true }, alRecibir, (err) => {
    // Si el índice aún no existe se usa la consulta simple
    console.warn("Consulta ordenada no disponible:", err.code);
    desuscribir = base.limit(200).onSnapshot({ includeMetadataChanges: true }, alRecibir);
  });
  return () => desuscribir();
}

function listaCompleta() {
  const ids = new Set(estado.informes.map((i) => i.id));
  const soloLocales = Object.values(estado.respaldos)
    .filter((r) => r.tecnicoUid === estado.usuario?.uid && !ids.has(r.id))
    .map((r) => ({ ...r, _pendiente: true }));
  return [...soloLocales, ...estado.informes]
    .sort((a, b) => (b.creadoLocal || "").localeCompare(a.creadoLocal || ""));
}

function pintarLista() {
  const lista = listaCompleta();
  const pendientes = lista.filter((i) => i._pendiente).length;
  $("#resumen-sync").textContent = lista.length
    ? `${lista.length} informe(s) recientes${pendientes ? ` · ${pendientes} por enviar` : " · todos enviados"}`
    : "";

  const ul = $("#lista-informes");
  if (!lista.length) {
    ul.innerHTML = `<li class="vacio">Aún no tienes informes. Toca “Nuevo informe” para empezar.</li>`;
    return;
  }
  ul.innerHTML = lista.map((i) => `
    <li><button class="informe-item" data-id="${escaparHtml(i.id)}">
      <span class="num">${escaparHtml(i.numero)} · ${escaparHtml(i.campos?.entidad || "Sin entidad")}</span>
      <span class="chip ${i._pendiente ? "pendiente" : "sincronizado"}">${i._pendiente ? "Por enviar" : "Enviado"}</span>
      <span class="det">${escaparHtml(fechaLegible(i.campos?.fecha))} · ${escaparHtml(i.campos?.equipo || "")}</span>
    </button></li>`).join("");
}

$("#lista-informes").addEventListener("click", (e) => {
  const btn = e.target.closest(".informe-item");
  if (!btn) return;
  const informe = listaCompleta().find((i) => i.id === btn.dataset.id);
  if (!informe) return;
  $("#dlg-titulo").textContent = `Informe ${informe.numero}`;
  $("#dlg-detalle").textContent = [
    fechaLegible(informe.campos?.fecha), informe.campos?.entidad, informe.campos?.equipo,
    informe._pendiente ? "Guardado en el celular, se enviará cuando haya internet." : "Guardado en la base de datos."
  ].filter(Boolean).join(" · ");
  $("#dlg-descargar").onclick = () => descargarPdf(informe).catch((err) => aviso(err.message, "error"));
  $("#dlg-compartir").onclick = () => compartirPdf(informe).catch((err) => err.name !== "AbortError" && aviso(err.message, "error"));
  $("#dialogo-informe").showModal();
});
$("#dlg-cerrar").addEventListener("click", () => $("#dialogo-informe").close());

// ---------------------------------------------------------------------
//  Copia de seguridad local (por si el envío falla)
// ---------------------------------------------------------------------
function leerRespaldos() {
  try { return JSON.parse(localStorage.getItem("respaldo_informes") || "{}"); }
  catch (e) { return {}; }
}
function escribirRespaldos() {
  try { localStorage.setItem("respaldo_informes", JSON.stringify(estado.respaldos)); }
  catch (e) { console.warn("Sin espacio para la copia de seguridad", e); }
}
function quitarRespaldo(id) {
  if (!estado.respaldos[id]) return;
  delete estado.respaldos[id];
  escribirRespaldos();
}

// Revisa si los informes guardados sin conexión ya llegaron al servidor.
async function revisarRespaldos() {
  if (!navigator.onLine || !estado.usuario) return;
  for (const r of Object.values(estado.respaldos)) {
    if (r.tecnicoUid !== estado.usuario.uid) continue;
    try {
      const snap = await db.collection("informes").doc(r.id).get({ source: "server" });
      if (snap.exists) quitarRespaldo(r.id);
      else enviarInforme(r);
    } catch (e) {
      console.warn("No se pudo verificar el informe", r.numero, e.code);
    }
  }
  pintarLista();
}
window.addEventListener("online", () => setTimeout(revisarRespaldos, 3000));

function enviarInforme(informe) {
  const { id, _pendiente, ...datos } = informe;
  datos.creadoServidor = firebase.firestore.FieldValue.serverTimestamp();
  // No se espera la respuesta: sin internet queda en cola y se sube sola.
  return db.collection("informes").doc(id).set(datos)
    .then(() => {
      quitarRespaldo(id);
      pintarLista();
      if (estado.ultimoGuardado?.id === id) pintarEstadoGuardado(false);
    })
    .catch((err) => {
      console.error(err);
      aviso(`El informe ${informe.numero} no se pudo enviar (${err.code}). Sigue guardado en el celular.`, "error");
    });
}

// ---------------------------------------------------------------------
//  Numeración: PREFIJO-0001 por técnico, así no se repiten sin conexión
// ---------------------------------------------------------------------
function siguienteNumero() {
  const prefijo = (estado.perfil.prefijo || "INF").toUpperCase();
  let mayor = Number(localStorage.getItem(`ultimo_${prefijo}`) || 0);
  listaCompleta().forEach((i) => {
    const m = new RegExp(`^${prefijo}-(\\d+)$`).exec(i.numero || "");
    if (m) mayor = Math.max(mayor, Number(m[1]));
  });
  const n = mayor + 1;
  return { numero: `${prefijo}-${String(n).padStart(4, "0")}`, prefijo, n };
}

// ---------------------------------------------------------------------
//  Formulario (se construye según la versión vigente del formato)
// ---------------------------------------------------------------------
const claveBorrador = () => `borrador_${estado.usuario.uid}`;

function construirFormulario(formato, datos = {}) {
  estado.formatoFormulario = formato;
  const emp = formato.empresa || {};
  const [primera = "", ...resto] = (emp.nombre || "").split(" ");
  const f = formato.firmas || FORMATO_BASE.firmas;
  const req = (o) => (o ? ' <span class="req">*</span>' : "");
  const val = (o, k) => escaparHtml(o?.[k] ?? "");

  const campos = (formato.campos || []).map((c) => {
    const tipo = c.tipo === "fecha" ? "date" : c.tipo === "numero" ? "number" : "text";
    const valor = datos.campos?.[c.id] ?? (c.tipo === "fecha" ? hoyISO() : "");
    return `<div class="celda ${c.ancho === "media" ? "media" : ""}">
      <label for="c_${c.id}">${escaparHtml(c.etiqueta)}${req(c.obligatorio)}</label>
      <input id="c_${c.id}" data-campo="${escaparHtml(c.id)}" type="${tipo}" value="${escaparHtml(valor)}" ${c.obligatorio ? "required" : ""}>
    </div>`;
  }).join("");

  const secciones = (formato.secciones || []).map((s) => `
    <div class="seccion">
      <label for="s_${s.id}">${escaparHtml(s.titulo)}${req(s.obligatorio)}</label>
      <textarea id="s_${s.id}" data-seccion="${escaparHtml(s.id)}" ${s.obligatorio ? "required" : ""}>${val(datos.secciones, s.id)}</textarea>
    </div>`).join("");

  $("#hoja").innerHTML = `
    <div class="hoja-encabezado">
      <div>
        <div class="hoja-nombre"><span class="s">${escaparHtml(primera.charAt(0))}</span>${escaparHtml(primera.slice(1))} <span class="resto">${escaparHtml(resto.join(" "))}</span></div>
        <div class="hoja-desc">${escaparHtml([emp.descripcion, emp.nit ? "NIT. " + emp.nit : ""].filter(Boolean).join(". "))}</div>
      </div>
      ${formato.logo ? `<img src="${formato.logo}" alt="">` : ""}
    </div>
    <div class="hoja-titulo">${escaparHtml(formato.titulo)}</div>
    <div class="hoja-numero" id="hoja-numero"></div>
    <div class="tabla-datos">${campos}</div>
    ${secciones}
    <div class="firmas">
      <div class="firma">
        <h3>${escaparHtml(f.tecnicoTitulo)}</h3>
        <div class="lienzo-firma" id="lienzo-tecnico"><canvas></canvas><div class="guia"></div><div class="pista">Firma aquí</div></div>
        <button type="button" class="boton pequeno" data-borrar="tecnico">Borrar firma</button>
        <label class="campo"><span>Nombre(s) del técnico <span class="req">*</span></span>
          <input type="text" id="tecnicoNombres" value="${escaparHtml(datos.tecnicoNombres ?? estado.perfil.nombre)}" required></label>
      </div>
      <div class="firma">
        <h3>${escaparHtml(f.clienteTitulo)}</h3>
        <div class="lienzo-firma" id="lienzo-cliente"><canvas></canvas><div class="guia"></div><div class="pista">Firma del cliente</div></div>
        <button type="button" class="boton pequeno" data-borrar="cliente">Borrar firma</button>
        <label class="campo"><span>${escaparHtml(f.clienteNombreEtiqueta)} <span class="req">*</span></span>
          <input type="text" id="clienteNombre" value="${val(datos, "clienteNombre")}" required></label>
        <label class="campo"><span>${escaparHtml(f.clienteDocEtiqueta)}</span>
          <input type="text" id="clienteDoc" value="${val(datos, "clienteDoc")}"></label>
      </div>
    </div>`;

  $("#hoja-numero").textContent = `N° ${siguienteNumero().numero}`;
  crearFirma("tecnico", datos.firmaTecnicoPuntos);
  crearFirma("cliente", datos.firmaClientePuntos);
}

function crearFirma(quien, puntos) {
  const caja = $(`#lienzo-${quien}`);
  const pad = new SignaturePad($("canvas", caja), { penColor: "#12305E", minWidth: 0.8, maxWidth: 2.4 });
  pad._puntosIniciales = puntos || null;
  pad.addEventListener("endStroke", () => {
    caja.classList.add("firmado");
    guardarBorrador();
  });
  estado.firmas[quien] = pad;
}

function ajustarLienzos() {
  Object.entries(estado.firmas).forEach(([quien, pad]) => {
    const canvas = pad.canvas;
    if (!canvas.offsetWidth) return;
    const datos = pad.isEmpty() ? pad._puntosIniciales : pad.toData();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
    pad.clear();
    if (datos && datos.length) {
      pad.fromData(datos);
      $(`#lienzo-${quien}`).classList.add("firmado");
    }
  });
}
window.addEventListener("resize", () => {
  if (!$("#pantalla-formulario").hidden) ajustarLienzos();
});

$("#hoja").addEventListener("click", (e) => {
  const quien = e.target.dataset?.borrar;
  if (!quien) return;
  estado.firmas[quien].clear();
  estado.firmas[quien]._puntosIniciales = null;
  $(`#lienzo-${quien}`).classList.remove("firmado");
  guardarBorrador();
});

function leerFormulario() {
  const campos = {}, secciones = {};
  $$("[data-campo]").forEach((el) => (campos[el.dataset.campo] = el.value.trim()));
  $$("[data-seccion]").forEach((el) => (secciones[el.dataset.seccion] = el.value.trim()));
  return {
    campos,
    secciones,
    tecnicoNombres: $("#tecnicoNombres").value.trim(),
    clienteNombre: $("#clienteNombre").value.trim(),
    clienteDoc: $("#clienteDoc").value.trim()
  };
}

// Borrador automático: si se cierra la app o se va la batería, no se pierde lo escrito
let temporizadorBorrador;
function guardarBorrador() {
  clearTimeout(temporizadorBorrador);
  temporizadorBorrador = setTimeout(() => {
    if ($("#pantalla-formulario").hidden) return;
    const borrador = {
      ...leerFormulario(),
      formatoVersion: estado.formatoFormulario.version,
      firmaTecnicoPuntos: estado.firmas.tecnico?.isEmpty() ? null : estado.firmas.tecnico.toData(),
      firmaClientePuntos: estado.firmas.cliente?.isEmpty() ? null : estado.firmas.cliente.toData()
    };
    try { localStorage.setItem(claveBorrador(), JSON.stringify(borrador)); } catch (e) { /* sin espacio */ }
  }, 600);
}
$("#hoja").addEventListener("input", guardarBorrador);

async function abrirFormulario() {
  let borrador = null;
  try { borrador = JSON.parse(localStorage.getItem(claveBorrador()) || "null"); } catch (e) { /* nada */ }

  if (borrador) {
    const formato = await obtenerFormato(borrador.formatoVersion).catch(() => estado.formato);
    construirFormulario(formato, borrador);
    aviso("Se recuperó el informe que dejaste sin terminar.");
  } else {
    construirFormulario(estado.formato);
  }
  mostrar("formulario");
}

$("#btn-nuevo").addEventListener("click", abrirFormulario);
$("#btn-otro").addEventListener("click", abrirFormulario);
$("#btn-volver").addEventListener("click", () => mostrar("inicio"));

$("#btn-cancelar").addEventListener("click", () => {
  if (!confirm("¿Descartar este informe? Se borrará lo que escribiste.")) return;
  localStorage.removeItem(claveBorrador());
  mostrar("inicio");
});

// ---------------------------------------------------------------------
//  Guardar
// ---------------------------------------------------------------------
$("#form-informe").addEventListener("submit", (e) => {
  e.preventDefault();

  $$(".invalido").forEach((el) => el.classList.remove("invalido"));
  const faltan = $$("#hoja [required]").filter((el) => !el.value.trim());
  faltan.forEach((el) => el.classList.add("invalido"));
  if (faltan.length) {
    faltan[0].focus();
    return aviso("Completa los campos marcados con *.", "error");
  }
  if (estado.firmas.tecnico.isEmpty()) return aviso("Falta la firma del técnico.", "error");
  if (estado.firmas.cliente.isEmpty()) return aviso("Falta la firma del cliente.", "error");

  const { numero, prefijo, n } = siguienteNumero();
  const id = db.collection("informes").doc().id;
  const informe = {
    id,
    numero,
    ...leerFormulario(),
    firmaTecnico: estado.firmas.tecnico.toDataURL("image/png"),
    firmaCliente: estado.firmas.cliente.toDataURL("image/png"),
    formatoVersion: estado.formatoFormulario.version,
    tecnicoUid: estado.usuario.uid,
    tecnicoCorreo: estado.usuario.email,
    creadoLocal: new Date().toISOString()
  };

  // 1) copia de seguridad en el celular  2) envío a la base de datos (con cola offline)
  estado.respaldos[id] = informe;
  escribirRespaldos();
  localStorage.setItem(`ultimo_${prefijo}`, String(n));
  localStorage.removeItem(claveBorrador());
  enviarInforme(informe);

  estado.ultimoGuardado = informe;
  $("#guardado-titulo").textContent = `Informe ${numero} guardado`;
  pintarEstadoGuardado(true);
  pintarLista();
  mostrar("guardado");
});

function pintarEstadoGuardado(pendiente) {
  $("#guardado-estado").textContent = pendiente
    ? (navigator.onLine
        ? "Enviando a la base de datos…"
        : "Quedó guardado en el celular. Se enviará solo cuando haya internet.")
    : "Enviado a la base de datos.";
}

$("#btn-descargar").addEventListener("click", () =>
  descargarPdf(estado.ultimoGuardado).catch((err) => aviso(err.message, "error")));
$("#btn-compartir").addEventListener("click", () =>
  compartirPdf(estado.ultimoGuardado).catch((err) => err.name !== "AbortError" && aviso(err.message, "error")));

// ---------------------------------------------------------------------
//  Instalación
// ---------------------------------------------------------------------
let eventoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  $("#btn-instalar").hidden = false;
});
$("#btn-instalar").addEventListener("click", async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $("#btn-instalar").hidden = true;
});
window.addEventListener("appinstalled", () => aviso("App instalada.", "ok"));

const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
$("#nota-ios").hidden = !(esIOS && !instalada);