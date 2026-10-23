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
  fotos: [],                 // fotos del informe que se está llenando
  ultimoGuardado: null,
  editando: null,            // id del informe pendiente que se está continuando
  fotosGuardadas: [],        // fotos que ese informe pendiente ya tenía guardadas
  contadorPropio: null,      // total de informes del técnico (contadores/tecnico_{uid})
  desuscribir: []
};

// ---------------------------------------------------------------------
//  Menú desplegable
// ---------------------------------------------------------------------
const menu = iniciarMenu((destino) => {
  if (destino === "inicio") return mostrar("inicio");
  if (destino === "nuevo") return abrirFormulario();
  if (destino === "horario-qr") return abrirHorario("qr");
  if (destino === "horario-manual") return abrirHorario("manual");
  if (destino === "permisos") return abrirPermisos();
  if (destino === "incapacidades") return abrirIncapacidades();
  mostrarSeccion(destino);
});

function mostrarSeccion(nombre) {
  const seccion = SECCIONES_PENDIENTES[nombre];
  if (!seccion) return mostrar("inicio");
  $("#sec-titulo").textContent = seccion.titulo;
  $("#sec-texto").textContent = seccion.texto;
  mostrar("seccion");
  menu.marcar(nombre);
}
$("#btn-sec-volver").addEventListener("click", () => mostrar("inicio"));

const PANTALLAS = ["cargando", "ingreso", "inicio", "formulario", "revision", "guardado", "seccion", "horario", "permisos", "permiso", "incapacidades", "incapacidad"];
function mostrar(nombre) {
  PANTALLAS.forEach((p) => ($(`#pantalla-${p}`).hidden = p !== nombre));
  // El inicio de sesión ocupa toda la pantalla, sin la barra de arriba
  document.body.classList.toggle("en-login", nombre === "ingreso");
  $("#btn-cancelar").hidden = nombre !== "formulario" && nombre !== "revision";
  // Mientras se llena un informe no hay menú: se sale con "Cancelar" o guardando
  $("#btn-menu").hidden = !["inicio", "guardado", "seccion", "horario", "permisos", "incapacidades"].includes(nombre);
  detenerCamara();   // la cámara del registro de horario no sigue encendida en otra pantalla
  menu.cerrar();
  menu.marcar(nombre === "inicio" ? "inicio" : "");
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
  if (!correo || !clave) return aviso("Escribe tu correo y tu contraseña.", "error");
  const boton = $("#ing-entrar");
  boton.disabled = true;
  boton.textContent = "Ingresando…";
  try {
    await auth.signInWithEmailAndPassword(correo, clave);
    $("#ing-clave").value = "";
  } catch (err) {
    const mensajes = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/wrong-password": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "Ese correo no está registrado.",
      "auth/invalid-email": "El correo no está bien escrito.",
      "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
      "auth/network-request-failed": "No hay conexión con el servidor. Para ingresar la primera vez necesitas internet: revisa los datos o el Wi-Fi e intenta de nuevo."
    };
    aviso(mensajes[err.code] || "No se pudo ingresar: " + err.message, "error");
  }
  boton.disabled = false;
  boton.textContent = "Ingresar";
});

// Ver u ocultar la contraseña
$("#ing-ojo").addEventListener("click", () => {
  const campo = $("#ing-clave"), boton = $("#ing-ojo");
  const mostrarla = campo.type === "password";
  campo.type = mostrarla ? "text" : "password";
  boton.setAttribute("aria-pressed", String(mostrarla));
  boton.setAttribute("aria-label", mostrarla ? "Ocultar la contraseña" : "Mostrar la contraseña");
});

// Firebase envía un correo con el enlace para cambiar la contraseña
$("#ing-olvido").addEventListener("click", async () => {
  const correo = $("#ing-correo").value.trim();
  if (!correo) {
    $("#ing-correo").focus();
    return aviso("Escribe tu correo arriba y vuelve a tocar “¿Olvidaste tu contraseña?”.", "error");
  }
  try {
    await auth.sendPasswordResetEmail(correo);
    aviso(`Si ${correo} está registrado, le llegará un correo para cambiar la contraseña. Revisa también la carpeta de spam.`, "ok");
  } catch (err) {
    const mensajes = {
      "auth/invalid-email": "El correo no está bien escrito.",
      "auth/network-request-failed": "Necesitas internet para pedir el cambio de contraseña.",
      "auth/too-many-requests": "Ya se pidió varias veces. Espera unos minutos."
    };
    aviso(mensajes[err.code] || "No se pudo enviar el correo: " + err.message, "error");
  }
});

// Pie del inicio de sesión: versión instalada y correo de soporte
$("#ing-soporte").textContent = FORMATO_BASE.empresa.correo;
if (window.caches) {
  caches.keys().then((claves) => {
    const version = claves.filter((c) => c.startsWith("siatet-app-")).map((c) => c.replace("siatet-app-", "")).sort().pop();
    if (version) $("#ing-version").textContent = `Versión ${version} · `;
  }).catch(() => { /* sin acceso a la caché */ });
}

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
  menu.usuario(estado.perfil.nombre, estado.perfil.rol);

  estado.desuscribir.push(escucharFormatoVigente((f) => {
    estado.formato = f;
  }));
  estado.desuscribir.push(escucharInformes());
  estado.desuscribir.push(escucharContadorPropio());
  estado.desuscribir.push(escucharHorario());
  estado.desuscribir.push(escucharPermisos());
  estado.desuscribir.push(escucharIncapacidades());

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
    refrescarGuardado();
    asignarNumeros();
  };

  const conOrden = base.orderBy("creadoLocal", "desc").limit(LIMITE_LISTA);
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
  // Primero los pendientes y después el resto, del más reciente al más antiguo
  const esPendiente = (i) => (i.estado === "pendiente" ? 1 : 0);
  return [...soloLocales, ...estado.informes]
    .sort((a, b) => esPendiente(b) - esPendiente(a) || (b.creadoLocal || "").localeCompare(a.creadoLocal || ""));
}

// ---------------------------------------------------------------------
//  Dashboard del técnico: total, este mes y hoy
// ---------------------------------------------------------------------
const LIMITE_LISTA = 60;   // informes recientes que se mantienen en el celular

function pintarTablero(lista) {
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).toISOString();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();
  const desde = (fecha, soloSinNumero) => lista
    .filter((i) => (i.creadoLocal || "") >= fecha && (!soloSinNumero || !i.numero)).length;

  // El total lo lleva el contador del técnico; los informes que aún no tienen
  // número no están contados ahí, así que se suman aparte.
  const contador = estado.contadorPropio;
  const sinNumero = lista.filter((i) => !i.numero).length;
  const total = contador ? Number(contador.total || 0) + sinNumero : Math.max(totalAntiguo(), lista.length);
  const delMes = contador ? Number((contador.meses || {})[claveMes(ahora.toISOString())] || 0) + desde(inicioMes, true) : 0;

  $("#t-total").textContent = Math.max(total, lista.length);
  $("#t-mes").textContent = Math.max(delMes, desde(inicioMes));
  $("#t-hoy").textContent = desde(inicioHoy);
}

function pintarLista() {
  const lista = listaCompleta();
  pintarTablero(lista);
  const porEnviar = lista.filter((i) => i._pendiente).length;
  const pendientes = lista.filter((i) => i.estado === "pendiente").length;
  $("#resumen-sync").textContent = lista.length
    ? [`${lista.length} informe(s) recientes`, pendientes ? `${pendientes} pendiente(s)` : "",
        porEnviar ? `${porEnviar} por enviar` : "todos enviados"].filter(Boolean).join(" · ")
    : "";

  const ul = $("#lista-informes");
  if (!lista.length) {
    ul.innerHTML = `<li class="vacio">Aún no tienes informes. Toca “Nuevo informe” para empezar.</li>`;
    return;
  }
  ul.innerHTML = lista.map((i) => {
    const est = estadoDeInforme(i);
    return `
    <li><button class="informe-item estado-${est.clase}" data-id="${escaparHtml(i.id)}">
      <span class="num">${escaparHtml(i.numero || "Sin número")} · ${escaparHtml(i.campos?.entidad || "Sin entidad")}</span>
      <span class="chip ${est.clase}">${est.texto}</span>
      <span class="det">${escaparHtml([fechaLegible(i.campos?.fecha), i.campos?.equipo, i.estado === "pendiente" ? i.motivoPendiente : ""].filter(Boolean).join(" · "))}</span>
    </button></li>`;
  }).join("");
}

$("#lista-informes").addEventListener("click", (e) => {
  const btn = e.target.closest(".informe-item");
  if (!btn) return;
  const informe = listaCompleta().find((i) => i.id === btn.dataset.id);
  if (!informe) return;
  const pendiente = informe.estado === "pendiente";
  $("#dlg-titulo").textContent = informe.numero ? `Informe ${informe.numero}` : "Informe sin número";
  $("#dlg-detalle").textContent = [
    fechaLegible(informe.campos?.fecha), informe.campos?.entidad, informe.campos?.equipo,
    pendiente ? `Pendiente: ${informe.motivoPendiente || "sin terminar"}.`
      : informe._pendiente ? "Guardado en el celular, se enviará cuando haya internet."
      : informe.numero ? "Guardado en la base de datos." : "Guardado. El número se asigna cuando haya internet."
  ].filter(Boolean).join(" · ");
  const cerrar = () => $("#dialogo-informe").close();
  $("#dlg-continuar").hidden = !pendiente;
  $("#dlg-descargar").hidden = $("#dlg-compartir").hidden = pendiente;
  $("#dlg-ver").onclick = () => { cerrar(); verPdf(informe); };
  $("#dlg-continuar").onclick = () => { cerrar(); continuarPendiente(informe); };
  $("#dlg-copiar").onclick = () => { cerrar(); copiarInforme(informe); };
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
      console.warn("No se pudo verificar el informe", r.id, e.code);
    }
  }
  pintarLista();
}
window.addEventListener("online", () => setTimeout(revisarRespaldos, 3000));

// existente = true cuando se actualiza un informe pendiente que ya estaba guardado
function enviarInforme(informe, { existente = false, fotosABorrar = [] } = {}) {
  const { id, _pendiente, fotos = [], ...datos } = informe;
  datos.numFotos = fotos.length;

  // El informe y sus fotos se envían juntos en un lote: llegan todos o ninguno.
  // Cada foto va en su propio documento (informes/{id}/fotos/{foto}).
  const ref = db.collection("informes").doc(id);
  const lote = db.batch();
  if (existente) {
    // No se tocan el número, el dueño ni la fecha en que se creó
    ["numero", "tecnicoUid", "tecnicoCorreo", "creadoLocal", "creadoServidor"].forEach((k) => delete datos[k]);
    datos.actualizadoServidor = firebase.firestore.FieldValue.serverTimestamp();
    lote.update(ref, datos);
  } else {
    datos.creadoServidor = firebase.firestore.FieldValue.serverTimestamp();
    lote.set(ref, datos);
  }
  fotos.forEach((f, i) => lote.set(ref.collection("fotos").doc(f.id), {
    tipo: f.tipo,
    data: f.data,
    descripcion: f.descripcion || "",
    orden: i,
    tecnicoUid: estado.usuario.uid
  }));
  fotosABorrar.forEach((fotoId) => lote.delete(ref.collection("fotos").doc(fotoId)));

  // No se espera la respuesta: sin internet queda en cola y se sube sola.
  return lote.commit()
    .then(() => {
      quitarRespaldo(id);
      pintarLista();
      refrescarGuardado();
      asignarNumeros();
    })
    .catch((err) => {
      console.error(err);
      aviso(`El informe de ${informe.campos?.entidad || "hoy"} no se pudo enviar (${err.code}). Sigue guardado en el celular.`, "error");
    });
}

// ---------------------------------------------------------------------
//  Numeración: un solo consecutivo para todos los técnicos, con el prefijo
//  IST: IST-0041, IST-0042… El prefijo de cada técnico sale en el PDF,
//  debajo de su nombre.
//
//  El número lo entrega la base de datos (contadores/informes), por eso
//  necesita internet. Sin conexión el informe se guarda sin número y lo
//  recibe solo cuando vuelve la señal, en el orden en que se hicieron.
// ---------------------------------------------------------------------
const PREFIJO_INFORMES = "IST";
const prefijoPropio = () => (estado.perfil.prefijo || "INF").toUpperCase();
const claveMes = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Con la numeración anterior (una por técnico) el número más alto era su total de informes
function totalAntiguo() {
  const prefijo = prefijoPropio();
  let mayor = Number(localStorage.getItem(`ultimo_${prefijo}`) || 0);
  estado.informes.forEach((i) => {
    const m = new RegExp(`^${prefijo}-(\\d+)$`).exec(i.numero || "");
    if (m) mayor = Math.max(mayor, Number(m[1]));
  });
  return mayor;
}

function escucharContadorPropio() {
  return db.collection("contadores").doc(`tecnico_${estado.usuario.uid}`).onSnapshot((snap) => {
    estado.contadorPropio = snap.exists ? snap.data() : null;
    pintarLista();
  }, (err) => console.warn("Sin acceso al contador:", err.code));
}

let asignandoNumeros = false, avisoSinConsecutivo = false;
async function asignarNumeros() {
  if (asignandoNumeros || !navigator.onLine || !estado.usuario) return;
  // Solo los que ya llegaron al servidor, del más antiguo al más reciente
  const pendientes = estado.informes.filter((i) => !i.numero && !i._pendiente)
    .sort((a, b) => (a.creadoLocal || "").localeCompare(b.creadoLocal || ""));
  if (!pendientes.length) return;

  asignandoNumeros = true;
  const uid = estado.usuario.uid, antes = totalAntiguo();
  const refGeneral = db.collection("contadores").doc("informes");
  const refPropio = db.collection("contadores").doc(`tecnico_${uid}`);
  for (const informe of pendientes) {
    const refInforme = db.collection("informes").doc(informe.id);
    try {
      // Todo en una sola operación: así dos técnicos nunca reciben el mismo número
      await db.runTransaction(async (tx) => {
        const general = await tx.get(refGeneral);
        const propio = await tx.get(refPropio);
        const actual = await tx.get(refInforme);
        if (!general.exists) throw new Error("sin-consecutivo");
        if (!actual.exists || actual.data().numero) return;

        const n = Number(general.data().ultimo || 0) + 1;
        const cuenta = propio.exists ? propio.data() : { total: antes, meses: {} };
        const mes = claveMes(informe.creadoLocal);
        const meses = { ...(cuenta.meses || {}) };
        meses[mes] = Number(meses[mes] || 0) + 1;

        tx.update(refGeneral, { ultimo: n });
        tx.set(refPropio, { total: Number(cuenta.total || 0) + 1, meses });
        tx.update(refInforme, { numero: `${PREFIJO_INFORMES}-${String(n).padStart(4, "0")}` });
      });
    } catch (err) {
      console.warn("No se pudo asignar el número:", err.message || err.code);
      if (err.message === "sin-consecutivo" && !avisoSinConsecutivo) {
        avisoSinConsecutivo = true;
        aviso("El administrador aún no ha iniciado el consecutivo. El informe quedó guardado sin número.", "error");
      }
      break;   // se reintenta cuando vuelva a cambiar la lista o la conexión
    }
  }
  asignandoNumeros = false;
}
window.addEventListener("online", () => setTimeout(asignarNumeros, 4000));

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
      <div class="hoja-logos">${formato.logo2 ? `<img src="${formato.logo2}" alt="">` : ""}${formato.logo ? `<img src="${formato.logo}" alt="">` : ""}</div>
    </div>
    <div class="hoja-titulo">${escaparHtml(formato.titulo)}</div>
    <div class="hoja-numero" id="hoja-numero"></div>
    <div class="tabla-datos">${campos}</div>
    ${secciones}
    ${bloqueFotos(formato)}
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

  $("#hoja-numero").textContent = "El número se asigna al guardar";
  crearFirma("tecnico", datos.firmaTecnicoPuntos);
  crearFirma("cliente", datos.firmaClientePuntos);
  estado.fotos = Array.isArray(datos.fotos) ? datos.fotos : [];
  pintarFotos();
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

// ---------------------------------------------------------------------
//  Registro fotográfico
// ---------------------------------------------------------------------
function bloqueFotos(formato) {
  // Los formatos publicados antes de existir las fotos no traen esta parte:
  // en ese caso se usa la configuración base (1 foto de antes y 1 de después).
  const cfg = formato.fotos || FORMATO_BASE.fotos;
  if (!cfg || !cfg.activas) return "";
  const grupo = (tipo, titulo, max) => max > 0 ? `
    <div class="fotos-grupo" data-tipo="${tipo}" data-max="${max}">
      <h4>${titulo} <span class="nota">(máximo ${max})</span></h4>
      <div class="fotos-lista"></div>
      <label class="boton pequeno boton-foto">Tomar o elegir foto
        <input type="file" accept="image/*" data-foto="${tipo}" hidden>
      </label>
    </div>` : "";
  return `<div class="fotos-bloque">
      <h3>REGISTRO FOTOGRÁFICO</h3>
      ${grupo("antes", "Antes del servicio", Number(cfg.maxAntes) || 0)}
      ${grupo("despues", "Después del servicio", Number(cfg.maxDespues) || 0)}
    </div>`;
}

function pintarFotos() {
  $$(".fotos-grupo").forEach((grupo) => {
    const tipo = grupo.dataset.tipo;
    const max = Number(grupo.dataset.max);
    const delTipo = estado.fotos.filter((f) => f.tipo === tipo);
    $(".fotos-lista", grupo).innerHTML = delTipo.map((f) => `
      <div class="foto" data-id="${f.id}">
        <img src="${f.data}" alt="Foto ${tipo === "antes" ? "antes" : "después"} del servicio">
        <input type="text" data-foto-desc="${f.id}" placeholder="Descripción (opcional)" value="${escaparHtml(f.descripcion || "")}">
        <button type="button" class="boton pequeno peligro" data-foto-quitar="${f.id}">Quitar</button>
      </div>`).join("");
    $(".boton-foto", grupo).hidden = delTipo.length >= max;
  });
}

$("#hoja").addEventListener("change", async (e) => {
  const tipo = e.target.dataset?.foto;
  if (!tipo || !e.target.files[0]) return;
  const archivo = e.target.files[0];
  e.target.value = "";
  try {
    const data = await comprimirFoto(archivo);
    estado.fotos.push({ id: "f" + Date.now().toString(36), tipo, data, descripcion: "" });
    pintarFotos();
    guardarBorrador();
  } catch (err) {
    aviso("No se pudo leer la foto. Intenta de nuevo.", "error");
  }
});

$("#hoja").addEventListener("input", (e) => {
  const id = e.target.dataset?.fotoDesc;
  if (!id) return;
  const foto = estado.fotos.find((f) => f.id === id);
  if (foto) foto.descripcion = e.target.value;
});

$("#hoja").addEventListener("click", (e) => {
  const id = e.target.dataset?.fotoQuitar;
  if (!id) return;
  estado.fotos = estado.fotos.filter((f) => f.id !== id);
  pintarFotos();
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
    tecnicoPrefijo: prefijoPropio(),
    clienteNombre: $("#clienteNombre").value.trim(),
    clienteDoc: $("#clienteDoc").value.trim(),
    fotos: estado.fotos.map((f, i) => ({ ...f, descripcion: (f.descripcion || "").trim(), orden: i }))
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
      firmaClientePuntos: estado.firmas.cliente?.isEmpty() ? null : estado.firmas.cliente.toData(),
      fotos: estado.fotos,
      pendienteId: estado.editando,
      fotosGuardadas: estado.fotosGuardadas
    };
    try { localStorage.setItem(claveBorrador(), JSON.stringify(borrador)); } catch (e) { /* sin espacio */ }
  }, 600);
}
$("#hoja").addEventListener("input", guardarBorrador);

function leerBorrador() {
  try { return JSON.parse(localStorage.getItem(claveBorrador()) || "null"); } catch (e) { return null; }
}

async function abrirFormulario() {
  const borrador = leerBorrador();
  if (borrador) {
    const formato = await obtenerFormato(borrador.formatoVersion).catch(() => estado.formato);
    construirFormulario(formato, borrador);
    estado.editando = borrador.pendienteId || null;
    estado.fotosGuardadas = borrador.fotosGuardadas || [];
    aviso("Se recuperó el informe que dejaste sin terminar.");
  } else {
    construirFormulario(estado.formato);
    estado.editando = null;
    estado.fotosGuardadas = [];
  }
  mostrar("formulario");
}

// Si hay un informe a medio llenar, avisa antes de reemplazarlo
function puedeReemplazarBorrador() {
  return !leerBorrador() || confirm("Tienes un informe a medio llenar. Si continúas, se descarta lo que escribiste en ese. ¿Continuar?");
}

// ---------------------------------------------------------------------
//  Copiar un informe: mismos datos para otro equipo igual
// ---------------------------------------------------------------------
function copiarInforme(informe) {
  if (!puedeReemplazarBorrador()) return;
  const formato = estado.formato;
  // Se copia todo menos la fecha (queda la de hoy) y el número de serie (cambia en cada equipo)
  const campos = {};
  let serie = null;
  (formato.campos || []).forEach((c) => {
    const esSerie = /seri/i.test(c.id) || /seri/i.test(c.etiqueta || "");
    if (esSerie) serie = serie || c.id;
    if (c.tipo !== "fecha" && !esSerie && informe.campos?.[c.id] !== undefined) campos[c.id] = informe.campos[c.id];
  });
  construirFormulario(formato, {
    campos,
    secciones: { ...(informe.secciones || {}) },
    tecnicoNombres: informe.tecnicoNombres,
    clienteNombre: informe.clienteNombre,
    clienteDoc: informe.clienteDoc
  });
  estado.editando = null;
  estado.fotosGuardadas = [];
  mostrar("formulario");
  guardarBorrador();
  if (serie) $(`[data-campo="${serie}"]`)?.focus();
  aviso(`Copia de ${informe.numero || "el informe"}. Cambia lo que sea distinto${serie ? ", empezando por la serie," : ""} y pide las firmas.`);
}

// ---------------------------------------------------------------------
//  Informes pendientes: se guardan sin terminar y se continúan después
// ---------------------------------------------------------------------
$("#btn-pendiente").addEventListener("click", () => {
  const datos = leerFormulario();
  const hayAlgo = Object.entries(datos.campos).some(([id, v]) => v && !(estado.formatoFormulario.campos || []).find((c) => c.id === id && c.tipo === "fecha"))
    || Object.values(datos.secciones).some(Boolean);
  if (!hayAlgo) return aviso("Escribe al menos la entidad o el equipo antes de dejarlo pendiente.", "error");
  $("#pen-nota").value = "";
  $("#dialogo-pendiente").showModal();
});
$("#pen-cancelar").addEventListener("click", () => $("#dialogo-pendiente").close());

$("#form-pendiente").addEventListener("submit", (e) => {
  e.preventDefault();
  $("#dialogo-pendiente").close();
  const nota = $("#pen-nota").value.trim();
  const tecnico = estado.firmas.tecnico, cliente = estado.firmas.cliente;
  const existente = !!estado.editando;
  const id = estado.editando || db.collection("informes").doc().id;
  const informe = {
    id,
    ...leerFormulario(),
    estado: "pendiente",
    motivoPendiente: $("#pen-motivo").value + (nota ? `: ${nota}` : ""),
    // Las firmas que ya se hicieron se guardan para no tener que repetirlas
    firmaTecnico: tecnico.isEmpty() ? "" : tecnico.toDataURL("image/png"),
    firmaCliente: cliente.isEmpty() ? "" : cliente.toDataURL("image/png"),
    trazosFirmas: JSON.stringify({
      tecnico: tecnico.isEmpty() ? null : tecnico.toData(),
      cliente: cliente.isEmpty() ? null : cliente.toData()
    }),
    formatoVersion: estado.formatoFormulario.version
  };
  if (!existente) {
    Object.assign(informe, {
      numero: "",
      tecnicoUid: estado.usuario.uid,
      tecnicoCorreo: estado.usuario.email,
      creadoLocal: new Date().toISOString()
    });
    estado.respaldos[id] = informe;
    escribirRespaldos();
  }
  const idsActuales = new Set(informe.fotos.map((f) => f.id));
  enviarInforme(informe, { existente, fotosABorrar: estado.fotosGuardadas.filter((fotoId) => !idsActuales.has(fotoId)) });

  localStorage.removeItem(claveBorrador());
  estado.editando = null;
  estado.fotosGuardadas = [];
  pintarLista();
  mostrar("inicio");
  aviso("Informe guardado como pendiente. Ábrelo desde tu lista para continuarlo.", "ok");
});

async function continuarPendiente(informe) {
  const borrador = leerBorrador();
  if (borrador && borrador.pendienteId !== informe.id && !puedeReemplazarBorrador()) return;
  let fotos = [];
  try {
    fotos = await cargarFotos(informe);
  } catch (err) {
    return aviso("No se pudieron cargar las fotos de este informe. Conéctate a internet e intenta de nuevo.", "error");
  }
  let trazos = {};
  try { trazos = JSON.parse(informe.trazosFirmas || "{}"); } catch (e) { /* sin firmas guardadas */ }
  const formato = await obtenerFormato(informe.formatoVersion).catch(() => estado.formato);
  construirFormulario(formato, {
    campos: informe.campos,
    secciones: informe.secciones,
    tecnicoNombres: informe.tecnicoNombres,
    clienteNombre: informe.clienteNombre,
    clienteDoc: informe.clienteDoc,
    firmaTecnicoPuntos: trazos.tecnico,
    firmaClientePuntos: trazos.cliente,
    fotos: fotos.map((f) => ({ id: f.id, tipo: f.tipo, data: f.data, descripcion: f.descripcion || "" }))
  });
  estado.editando = informe.id;
  estado.fotosGuardadas = fotos.map((f) => f.id);
  $("#hoja-numero").textContent = informe.numero ? `N° ${informe.numero}` : "El número se asigna al guardar";
  mostrar("formulario");
  guardarBorrador();
}

$("#btn-nuevo").addEventListener("click", abrirFormulario);
$("#btn-otro").addEventListener("click", abrirFormulario);
$("#btn-igual").addEventListener("click", () => estado.ultimoGuardado && copiarInforme(estado.ultimoGuardado));
$("#btn-volver").addEventListener("click", () => mostrar("inicio"));

$("#btn-cancelar").addEventListener("click", () => {
  const pregunta = estado.editando
    ? "¿Salir sin guardar los cambios? El informe sigue pendiente como estaba."
    : "¿Descartar este informe? Se borrará lo que escribiste.";
  if (!confirm(pregunta)) return;
  localStorage.removeItem(claveBorrador());
  estado.editando = null;
  estado.fotosGuardadas = [];
  mostrar("inicio");
});

// ---------------------------------------------------------------------
//  Revisar y guardar
//  1) "Revisar y guardar" valida y muestra el informe completo.
//  2) "Confirmar y guardar" lo guarda. Hasta ahí no se ha enviado nada.
// ---------------------------------------------------------------------
let informeEnRevision = null;

// Valida el formulario y arma el informe con lo que hay en pantalla
function armarInforme() {
  $$(".invalido").forEach((el) => el.classList.remove("invalido"));
  const faltan = $$("#hoja [required]").filter((el) => !el.value.trim());
  faltan.forEach((el) => el.classList.add("invalido"));
  if (faltan.length) {
    faltan[0].focus();
    aviso("Completa los campos marcados con *.", "error");
    return null;
  }
  if (estado.firmas.tecnico.isEmpty()) { aviso("Falta la firma del técnico.", "error"); return null; }
  if (estado.firmas.cliente.isEmpty()) { aviso("Falta la firma del cliente.", "error"); return null; }

  return {
    numero: "",          // lo asigna la base de datos después de guardar
    ...leerFormulario(),
    firmaTecnico: estado.firmas.tecnico.toDataURL("image/png"),
    firmaCliente: estado.firmas.cliente.toDataURL("image/png"),
    estado: "finalizado",
    motivoPendiente: "",
    trazosFirmas: "",
    formatoVersion: estado.formatoFormulario.version,
    tecnicoUid: estado.usuario.uid,
    tecnicoCorreo: estado.usuario.email
  };
}

$("#form-informe").addEventListener("submit", (e) => {
  e.preventDefault();
  const informe = armarInforme();
  if (!informe) return;
  informeEnRevision = informe;
  pintarRevision(informe, estado.formatoFormulario);
  mostrar("revision");
});

// Muestra el informe tal como quedó, solo para leer
function pintarRevision(informe, formato) {
  const emp = formato.empresa || {};
  const f = formato.firmas || FORMATO_BASE.firmas;
  const texto = (v) => escaparHtml(v) || '<span class="nota">Sin diligenciar</span>';

  const campos = (formato.campos || []).map((c) => `
    <div class="celda ${c.ancho === "media" ? "media" : ""}">
      <span class="rev-etiqueta">${escaparHtml(c.etiqueta)}</span>
      <span class="rev-valor">${texto(c.tipo === "fecha" ? fechaLegible(informe.campos[c.id]) : informe.campos[c.id])}</span>
    </div>`).join("");

  const secciones = (formato.secciones || []).map((s) => `
    <div class="seccion">
      <span class="rev-etiqueta">${escaparHtml(s.titulo)}</span>
      <p class="rev-texto">${texto(informe.secciones[s.id])}</p>
    </div>`).join("");

  const grupoFotos = (tipo, titulo) => {
    const fotos = informe.fotos.filter((foto) => foto.tipo === tipo);
    return fotos.length ? `
      <h4>${titulo}</h4>
      <div class="fotos-lista">${fotos.map((foto) => `
        <div class="foto">
          <img src="${foto.data}" alt="Foto ${tipo === "antes" ? "antes" : "después"} del servicio">
          ${foto.descripcion ? `<span class="nota">${escaparHtml(foto.descripcion)}</span>` : ""}
        </div>`).join("")}</div>` : "";
  };
  const fotos = informe.fotos.length ? `
    <div class="fotos-bloque">
      <h3>REGISTRO FOTOGRÁFICO</h3>
      ${grupoFotos("antes", "Antes del servicio")}
      ${grupoFotos("despues", "Después del servicio")}
    </div>` : "";

  $("#revision").innerHTML = `
    <div class="hoja-encabezado">
      <div>
        <div class="hoja-nombre">${escaparHtml(emp.nombre || "")}</div>
        <div class="hoja-desc">${escaparHtml([emp.descripcion, emp.nit ? "NIT. " + emp.nit : ""].filter(Boolean).join(". "))}</div>
      </div>
      <div class="hoja-logos">${formato.logo2 ? `<img src="${formato.logo2}" alt="">` : ""}${formato.logo ? `<img src="${formato.logo}" alt="">` : ""}</div>
    </div>
    <div class="hoja-titulo">${escaparHtml(formato.titulo)}</div>
    <div class="hoja-numero">${escaparHtml($("#hoja-numero").textContent)}</div>
    <div class="tabla-datos">${campos}</div>
    ${secciones}
    ${fotos}
    <div class="firmas">
      <div class="firma">
        <h3>${escaparHtml(f.tecnicoTitulo)}</h3>
        <img class="rev-firma" src="${informe.firmaTecnico}" alt="Firma del técnico">
        <span class="rev-valor">${texto(informe.tecnicoNombres)}</span>
        <span class="rev-valor">Prefijo del técnico: ${escaparHtml(prefijoTecnico(informe))}</span>
      </div>
      <div class="firma">
        <h3>${escaparHtml(f.clienteTitulo)}</h3>
        <img class="rev-firma" src="${informe.firmaCliente}" alt="Firma del cliente">
        <span class="rev-valor">${texto(informe.clienteNombre)}</span>
        ${informe.clienteDoc ? `<span class="nota">${escaparHtml(informe.clienteDoc)}</span>` : ""}
      </div>
    </div>`;
}

$("#btn-editar").addEventListener("click", () => mostrar("formulario"));

// PDF de revisión: lleva un aviso arriba para que no se confunda con el informe guardado
$("#btn-pdf-previo").addEventListener("click", () => {
  if (!informeEnRevision) return;
  try {
    const doc = marcarPdf(generarPDF(informeEnRevision, estado.formatoFormulario), "VISTA PREVIA - AÚN NO SE HA GUARDADO");
    const ventana = window.open(doc.output("bloburl"), "_blank");
    if (!ventana) {
      doc.save("Vista_previa_informe.pdf");
      aviso("La vista previa se descargó en PDF.");
    }
  } catch (err) {
    aviso("No se pudo generar la vista previa: " + err.message, "error");
  }
});

$("#btn-confirmar").addEventListener("click", () => {
  if (!informeEnRevision) return mostrar("formulario");
  // Si venía de un informe pendiente se actualiza ese mismo; si no, se crea uno nuevo
  const existente = !!estado.editando;
  const anterior = existente ? listaCompleta().find((i) => i.id === estado.editando) : null;
  const id = estado.editando || db.collection("informes").doc().id;
  const informe = existente
    ? { ...informeEnRevision, id, numero: anterior?.numero || "", creadoLocal: anterior?.creadoLocal || new Date().toISOString() }
    : { ...informeEnRevision, id, numero: "", creadoLocal: new Date().toISOString() };
  informeEnRevision = null;

  // 1) copia de seguridad en el celular  2) envío a la base de datos (con cola offline)
  if (!existente) {
    estado.respaldos[id] = informe;
    escribirRespaldos();
  }
  const idsActuales = new Set(informe.fotos.map((f) => f.id));
  enviarInforme(informe, { existente, fotosABorrar: estado.fotosGuardadas.filter((fotoId) => !idsActuales.has(fotoId)) });
  localStorage.removeItem(claveBorrador());
  estado.editando = null;
  estado.fotosGuardadas = [];

  estado.ultimoGuardado = informe;
  pintarLista();
  refrescarGuardado();
  mostrar("guardado");
});

// Pantalla "Informe guardado": muestra el número apenas la base de datos lo asigna
function refrescarGuardado() {
  if (!estado.ultimoGuardado) return;
  const actual = listaCompleta().find((i) => i.id === estado.ultimoGuardado.id) || estado.ultimoGuardado;
  if (actual.numero) estado.ultimoGuardado = { ...estado.ultimoGuardado, numero: actual.numero };
  const numero = estado.ultimoGuardado.numero;

  $("#guardado-titulo").textContent = numero ? `Informe ${numero} guardado` : "Informe guardado";
  $("#guardado-estado").textContent = numero
    ? "Enviado a la base de datos."
    : navigator.onLine
      ? "Enviando a la base de datos y esperando el número…"
      : "Quedó guardado en el celular. Cuando haya internet se envía y recibe su número. Si descargas el PDF ahora, saldrá sin número.";
}
window.addEventListener("online", refrescarGuardado);
window.addEventListener("offline", refrescarGuardado);

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
