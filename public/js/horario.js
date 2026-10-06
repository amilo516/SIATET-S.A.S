const horario = {
  modo: "qr",
  marcaciones: [],     // marcaciones recientes del usuario
  sitios: null,        // sitios con código QR (null = aún no se han cargado)
  flujo: null,         // cámara encendida
  temporizador: null,
  ultimoAviso: 0
};

const LIMITE_MARCACIONES = 40;
const FORMATO_QR = /^SIATET:([\w-]+):([\w-]+)$/;

// ---------------------------------------------------------------------
//  Datos
// ---------------------------------------------------------------------
function escucharHorario() {
  const base = db.collection("marcaciones").where("tecnicoUid", "==", estado.usuario.uid);
  const alRecibir = (snap) => {
    horario.marcaciones = snap.docs
      .map((d) => ({ ...d.data(), id: d.id, _pendiente: d.metadata.hasPendingWrites }))
      .sort((a, b) => (b.fechaLocal || "").localeCompare(a.fechaLocal || ""));
    pintarHorario();
  };

  let quitar = base.orderBy("fechaLocal", "desc").limit(LIMITE_MARCACIONES)
    .onSnapshot({ includeMetadataChanges: true }, alRecibir, (err) => {
      // Si el índice aún no existe se usa la consulta simple
      console.warn("Consulta ordenada de marcaciones no disponible:", err.code);
      quitar = base.limit(200).onSnapshot({ includeMetadataChanges: true }, alRecibir,
        (e) => console.warn("Sin acceso a las marcaciones:", e.code));
    });

  const quitarSitios = db.collection("sitios").onSnapshot(
    (snap) => (horario.sitios = snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    (err) => console.warn("Sin acceso a los sitios:", err.code));

  return () => { quitar(); quitarSitios(); };
}

function marcacionesDeHoy() {
  const hoy = hoyISO();
  return horario.marcaciones.filter((m) => m.dia === hoy)
    .sort((a, b) => (a.fechaLocal || "").localeCompare(b.fechaLocal || ""));
}

// Si lo último de hoy fue una entrada, lo que sigue es la salida
function siguienteTipo() {
  const hoy = marcacionesDeHoy();
  const ultima = hoy[hoy.length - 1];
  return ultima && ultima.tipo === "entrada" ? "salida" : "entrada";
}

function horaLegible(iso) {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

// Suma el tiempo entre cada entrada y la salida que le sigue (en minutos)
function minutosTrabajados(delDia) {
  let total = 0, entrada = null;
  delDia.forEach((m) => {
    if (m.tipo === "entrada") entrada = entrada || m.fechaLocal;
    else if (entrada) {
      total += (new Date(m.fechaLocal) - new Date(entrada)) / 60000;
      entrada = null;
    }
  });
  return Math.max(0, Math.round(total));
}

function duracionLegible(minutos) {
  const h = Math.floor(minutos / 60), m = minutos % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function registrarMarcacion({ metodo, sitio = null, nota = "" }) {
  const ultima = horario.marcaciones[0];
  if (ultima && Date.now() - new Date(ultima.fechaLocal) < 60000) {
    aviso("Ya marcaste hace un momento. Espera un minuto para marcar de nuevo.", "error");
    return false;
  }

  const tipo = siguienteTipo();
  const ahora = new Date();
  db.collection("marcaciones").doc().set({
    tecnicoUid: estado.usuario.uid,
    tecnicoNombre: estado.perfil.nombre,
    tipo,
    metodo,
    sitioId: sitio ? sitio.id : "",
    sitioNombre: sitio ? sitio.nombre : "",
    nota,
    dia: hoyISO(),
    fechaLocal: ahora.toISOString(),
    creadoServidor: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((err) => {
    console.error(err);
    aviso(`La marcación no se pudo guardar (${err.code}). Avísale al administrador.`, "error");
  });

  const donde = sitio ? ` · ${sitio.nombre}` : "";
  aviso(`${tipo === "entrada" ? "Entrada" : "Salida"} marcada: ${horaLegible(ahora)}${donde}`, "ok");
  return true;
}

// ---------------------------------------------------------------------
//  Pantalla
// ---------------------------------------------------------------------
function abrirHorario(modo) {
  horario.modo = modo;
  mostrar("horario");
  menu.marcar(modo === "qr" ? "horario-qr" : "horario-manual");
  pintarHorario();
}

function pintarHorario() {
  if ($("#pantalla-horario").hidden) return;
  const esQr = horario.modo === "qr";
  const tipo = siguienteTipo();
  const hoy = marcacionesDeHoy();
  const entrada = hoy.find((m) => m.tipo === "entrada");
  const ultima = hoy[hoy.length - 1];
  const salida = ultima && ultima.tipo === "salida" ? ultima : null;

  $("#h-titulo").textContent = esQr ? "Marcar con código QR" : "Marcar sin QR";
  $("#h-fecha").textContent = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  $("#h-entrada").textContent = entrada ? horaLegible(entrada.fechaLocal) : "Sin marcar";
  $("#h-salida").textContent = salida ? horaLegible(salida.fechaLocal) : "Sin marcar";

  const minutos = minutosTrabajados(hoy);
  $("#h-estado").textContent = !hoy.length ? "Hoy no has marcado."
    : tipo === "salida" ? `En turno desde las ${horaLegible(ultima.fechaLocal)}${minutos ? ` · ${duracionLegible(minutos)} en turnos anteriores` : ""}`
    : `Tiempo trabajado hoy: ${duracionLegible(minutos)}`;

  $("#h-modo-qr").hidden = !esQr;
  $("#h-modo-manual").hidden = esQr;
  $("#h-escanear").textContent = `Escanear código para marcar ${tipo}`;
  $("#h-marcar").textContent = `Marcar ${tipo}`;

  const lista = horario.marcaciones.slice(0, 12);
  $("#h-lista").innerHTML = lista.length ? lista.map((m) => `
    <li class="informe-item marcacion">
      <span class="num">${m.tipo === "entrada" ? "Entrada" : "Salida"} · ${escaparHtml(horaLegible(m.fechaLocal))}</span>
      <span class="chip ${m._pendiente ? "pendiente" : "sincronizado"}">${m._pendiente ? "Por enviar" : "Enviada"}</span>
      <span class="det">${escaparHtml([fechaLegible(m.dia), m.metodo === "qr" ? "Con QR" : m.metodo === "admin" ? "Agregada por el administrador" : "Sin QR", m.sitioNombre || m.nota, m.corregido && m.metodo !== "admin" ? "Corregida por el administrador" : ""].filter(Boolean).join(" · "))}</span>
    </li>`).join("") : `<li class="vacio">Aún no tienes marcaciones.</li>`;
}

// ---------------------------------------------------------------------
//  Marcar sin QR
// ---------------------------------------------------------------------
$("#h-modo-manual").addEventListener("submit", (e) => {
  e.preventDefault();
  const campo = $("#h-nota");
  const nota = campo.value.trim();
  campo.classList.toggle("invalido", !nota);
  if (!nota) {
    campo.focus();
    return aviso("Escribe el lugar o el motivo por el que marcas sin código QR.", "error");
  }
  if (registrarMarcacion({ metodo: "manual", nota })) campo.value = "";
});

// ---------------------------------------------------------------------
//  Marcar con código QR (cámara)
// ---------------------------------------------------------------------
$("#h-escanear").addEventListener("click", abrirCamara);
$("#h-cancelar-camara").addEventListener("click", detenerCamara);

async function abrirCamara() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return aviso("Este dispositivo no permite usar la cámara desde la app. Usa “Marcar sin QR”.", "error");
  }
  try {
    horario.flujo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, audio: false
    });
  } catch (err) {
    const sinPermiso = err.name === "NotAllowedError" || err.name === "SecurityError";
    return aviso(sinPermiso
      ? "La app no tiene permiso para usar la cámara. Actívalo en los ajustes del navegador o usa “Marcar sin QR”."
      : "No se pudo abrir la cámara. Intenta de nuevo o usa “Marcar sin QR”.", "error");
  }
  const video = $("#h-video");
  video.srcObject = horario.flujo;
  $("#h-camara").hidden = false;
  $("#h-escanear").hidden = true;
  try { await video.play(); } catch (e) { /* el navegador lo inicia solo */ }
  leerCuadro();
}

function detenerCamara() {
  clearTimeout(horario.temporizador);
  if (horario.flujo) horario.flujo.getTracks().forEach((pista) => pista.stop());
  horario.flujo = null;
  $("#h-video").srcObject = null;
  $("#h-camara").hidden = true;
  $("#h-escanear").hidden = false;
}

// Toma una imagen de la cámara unas 6 veces por segundo y busca un código QR
const lienzoQr = document.createElement("canvas");
function leerCuadro() {
  if (!horario.flujo) return;
  const video = $("#h-video");
  if (video.readyState >= 2 && video.videoWidth) {
    const escala = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    lienzoQr.width = Math.round(video.videoWidth * escala);
    lienzoQr.height = Math.round(video.videoHeight * escala);
    const ctx = lienzoQr.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, lienzoQr.width, lienzoQr.height);
    const imagen = ctx.getImageData(0, 0, lienzoQr.width, lienzoQr.height);
    const codigo = jsQR(imagen.data, imagen.width, imagen.height, { inversionAttempts: "dontInvert" });
    if (codigo && codigo.data && procesarCodigo(codigo.data)) return;
  }
  horario.temporizador = setTimeout(leerCuadro, 160);
}

// Devuelve true si el código sirvió y ya no hay que seguir leyendo
function procesarCodigo(texto) {
  const avisarUnaVez = (mensaje) => {
    if (Date.now() - horario.ultimoAviso < 3500) return;
    horario.ultimoAviso = Date.now();
    aviso(mensaje, "error");
  };

  const partes = FORMATO_QR.exec(texto.trim());
  if (!partes) {
    avisarUnaVez("Ese código no es de registro de horario de SIATET.");
    return false;
  }
  if (!horario.sitios) {
    avisarUnaVez("Aún no se han descargado los sitios. Conéctate a internet una vez y vuelve a intentar.");
    return false;
  }
  const sitio = horario.sitios.find((s) => s.id === partes[1] && s.clave === partes[2]);
  if (!sitio || sitio.activo === false) {
    avisarUnaVez("Ese código ya no está vigente. Pide al administrador el código actual.");
    return false;
  }
  detenerCamara();
  registrarMarcacion({ metodo: "qr", sitio });
  return true;
}

// Si la app pasa a segundo plano se apaga la cámara
document.addEventListener("visibilitychange", () => {
  if (document.hidden && horario.flujo) detenerCamara();
});
