// =====================================================================
//  FUNCIONES COMPARTIDAS (app del técnico y panel de administración)
// =====================================================================

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

// Guarda los datos en el celular para trabajar sin internet.
// Las escrituras hechas sin conexión quedan en cola y se suben solas.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("No se pudo activar el modo sin conexión:", err.code);
});

// ---------- Utilidades ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

function escaparHtml(txt) {
  return String(txt ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function fechaLegible(valor) {
  if (!valor) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}

function hoyISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function aviso(mensaje, tipo = "info") {
  let caja = $("#avisos");
  if (!caja) {
    caja = document.createElement("div");
    caja.id = "avisos";
    caja.setAttribute("role", "status");
    document.body.appendChild(caja);
  }
  const el = document.createElement("div");
  el.className = `aviso aviso-${tipo}`;
  el.textContent = mensaje;
  caja.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function copiaProfunda(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------- Estado de conexión ----------
function vigilarConexion(el) {
  const pintar = () => {
    const enLinea = navigator.onLine;
    el.textContent = enLinea ? "En línea" : "Sin conexión";
    el.classList.toggle("sin-conexion", !enLinea);
  };
  window.addEventListener("online", pintar);
  window.addEventListener("offline", pintar);
  pintar();
}

// ---------- Formatos por versión ----------
// Cada informe guarda la versión del formato con la que se hizo.
// Las versiones publicadas nunca se modifican, así los informes viejos
// se ven siempre igual a como se firmaron.
const _formatosEnMemoria = {};

async function obtenerFormato(version) {
  version = Number(version || 0);
  if (version === 0) return FORMATO_BASE;
  if (_formatosEnMemoria[version]) return _formatosEnMemoria[version];

  const local = localStorage.getItem(`formato_v${version}`);
  if (local) {
    try {
      _formatosEnMemoria[version] = JSON.parse(local);
      return _formatosEnMemoria[version];
    } catch (e) { /* se ignora y se busca en la base de datos */ }
  }

  const snap = await db.collection("formatos").doc(String(version)).get();
  if (!snap.exists) throw new Error(`No se encontró la versión ${version} del formato.`);
  const f = snap.data();
  delete f.publicado;
  guardarFormatoLocal(f);
  return f;
}

function guardarFormatoLocal(formato) {
  _formatosEnMemoria[formato.version] = formato;
  try {
    localStorage.setItem(`formato_v${formato.version}`, JSON.stringify(formato));
  } catch (e) {
    console.warn("No se pudo guardar el formato en el dispositivo:", e);
  }
}

// Escucha la versión vigente y avisa cada vez que cambia.
function escucharFormatoVigente(alCambiar) {
  const guardada = Number(localStorage.getItem("formato_vigente") || 0);
  obtenerFormato(guardada).then(alCambiar).catch(() => alCambiar(FORMATO_BASE));

  return db.collection("config").doc("actual").onSnapshot(async (snap) => {
    const version = snap.exists ? Number(snap.data().version || 0) : 0;
    try {
      const f = await obtenerFormato(version);
      localStorage.setItem("formato_vigente", String(version));
      alCambiar(f);
    } catch (e) {
      console.warn(e);
    }
  }, (err) => console.warn("Sin acceso a la configuración:", err.code));
}

// ---------- Descarga y envío del PDF ----------
function nombreArchivoPdf(informe) {
  const entidad = (informe.campos?.entidad || "").replace(/[^\wÁÉÍÓÚÑáéíóúñ-]+/g, "_");
  return `Informe_${informe.numero || "sin_numero"}${entidad ? "_" + entidad : ""}.pdf`;
}

// ---------- Fotos ----------
// Reduce la foto a máximo 1024 px y la guarda como JPEG (~100-150 KB)
function comprimirFoto(archivo, maximo = 1280) {
  // Reduce la foto hasta que pese ~150 KB o menos (una foto de celular pesa 3-5 MB)
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => {
      let esc = Math.min(1, maximo / Math.max(img.width, img.height));
      let calidad = 0.72, url = "";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      for (let intento = 0; intento < 6; intento++) {
        canvas.width = Math.round(img.width * esc);
        canvas.height = Math.round(img.height * esc);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL("image/jpeg", calidad);
        if (url.length <= 200000) break;          // 200.000 caracteres ≈ 150 KB
        if (calidad > 0.56) calidad -= 0.08; else esc *= 0.85;
      }
      URL.revokeObjectURL(img.src);
      resolver(url);
    };
    img.onerror = rechazar;
    img.src = URL.createObjectURL(archivo);
  });
}

// Las fotos se guardan aparte, en informes/{id}/fotos. Si el informe no
// las trae en memoria, se descargan (o se leen del celular sin internet).
async function cargarFotos(informe) {
  if (Array.isArray(informe.fotos)) return informe.fotos;
  if (!informe.numFotos) return [];
  // El filtro por técnico es obligatorio: las reglas solo permiten leer las fotos propias
  const snap = await db.collection("informes").doc(informe.id).collection("fotos")
    .where("tecnicoUid", "==", informe.tecnicoUid).get();
  informe.fotos = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  return informe.fotos;
}

// Texto rojo arriba de cada página (vista previa, informe pendiente)
function marcarPdf(doc, texto) {
  for (let pagina = 1; pagina <= doc.getNumberOfPages(); pagina++) {
    doc.setPage(pagina);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(179, 38, 30);
    doc.text(texto, 215.9 / 2, 8, { align: "center" });
  }
  return doc;
}

// ---------- Estado de un informe y su color ----------
//   rojo: pendiente (falta firma o terminar el servicio)
//   amarillo: por enviar o esperando número · verde: enviado
function estadoDeInforme(informe) {
  if (informe.estado === "pendiente") return { clase: "rojo", texto: "Pendiente" };
  if (informe._pendiente) return { clase: "amarillo", texto: "Por enviar" };
  if (!informe.numero) return { clase: "amarillo", texto: "Esperando número" };
  return { clase: "verde", texto: "Enviado" };
}

async function prepararPdf(informe) {
  const formato = await obtenerFormato(informe.formatoVersion);
  await cargarFotos(informe);
  const doc = generarPDF(informe, formato);
  return informe.estado === "pendiente" ? marcarPdf(doc, "INFORME PENDIENTE - SIN FINALIZAR") : doc;
}

async function descargarPdf(informe) {
  const doc = await prepararPdf(informe);
  doc.save(nombreArchivoPdf(informe));
}

// ---------- Ver el informe sin descargarlo ----------
// El PDF se dibuja página por página dentro de la app con pdf.js, así se ve
// igual en el computador y en el celular (Android no muestra PDF en la página).
let cargaPdfJs = null;
function cargarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!cargaPdfJs) {
    cargaPdfJs = new Promise((resolver, rechazar) => {
      const s = document.createElement("script");
      s.src = "js/libs/pdfjs.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/libs/pdfjs.worker.min.js";
        resolver(window.pdfjsLib);
      };
      s.onerror = () => { cargaPdfJs = null; rechazar(new Error("No se pudo abrir el visor. Revisa la conexión.")); };
      document.head.appendChild(s);
    });
  }
  return cargaPdfJs;
}

let visorActual = 0;
async function verPdf(informe) {
  if (!informe) return;
  const dialogo = $("#dialogo-visor"), paginas = $("#visor-paginas");
  const turno = ++visorActual;
  $("#visor-titulo").textContent = informe.numero ? `Informe ${informe.numero}` : "Informe sin número";
  $("#visor-descargar").onclick = () => descargarPdf(informe).catch((err) => aviso(err.message, "error"));
  paginas.innerHTML = `<p class="nota visor-cargando">Preparando el informe…</p>`;
  if (!dialogo.open) dialogo.showModal();
  try {
    const [doc, pdfjs] = await Promise.all([prepararPdf(informe), cargarPdfJs()]);
    const pdf = await pdfjs.getDocument({ data: doc.output("arraybuffer") }).promise;
    if (turno !== visorActual || !dialogo.open) return;
    paginas.innerHTML = "";
    const ancho = Math.max(280, paginas.clientWidth - 24);
    for (let n = 1; n <= pdf.numPages; n++) {
      const pagina = await pdf.getPage(n);
      if (turno !== visorActual || !dialogo.open) return;
      const base = pagina.getViewport({ scale: 1 });
      const escala = (ancho / base.width) * Math.min(2, window.devicePixelRatio || 1);
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.floor(vista.width);
      lienzo.height = Math.floor(vista.height);
      lienzo.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
      paginas.appendChild(lienzo);
      await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vista }).promise;
    }
  } catch (err) {
    console.error(err);
    if (turno === visorActual) paginas.innerHTML = `<p class="nota visor-cargando">No se pudo mostrar el informe: ${escaparHtml(err.message || String(err))}</p>`;
  }
}

function cerrarVisor() {
  visorActual++;
  $("#dialogo-visor").close();
  $("#visor-paginas").innerHTML = "";
}
document.addEventListener("click", (e) => { if (e.target.id === "visor-cerrar") cerrarVisor(); });
document.addEventListener("close", (e) => { if (e.target.id === "dialogo-visor") { visorActual++; $("#visor-paginas").innerHTML = ""; } }, true);

async function compartirPdf(informe) {
  const doc = await prepararPdf(informe);
  const archivo = new File([doc.output("blob")], nombreArchivoPdf(informe), { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    await navigator.share({ files: [archivo], title: `Informe ${informe.numero || "sin número"}` });
  } else {
    doc.save(archivo.name);
    aviso("Tu dispositivo no permite compartir directo. El PDF se descargó.");
  }
}

// ---------- Actualizaciones de la app ----------
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");

      const ofrecer = (worker) => {
        const barra = $("#barra-actualizacion");
        if (!barra) return;
        barra.hidden = false;
        $("button", barra).onclick = () => worker.postMessage("ACTUALIZAR");
      };

      if (reg.waiting && navigator.serviceWorker.controller) ofrecer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nuevo = reg.installing;
        nuevo.addEventListener("statechange", () => {
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) ofrecer(nuevo);
        });
      });

      // Busca actualizaciones al abrir, al volver a la app, cuando vuelve
      // la conexión y cada 30 minutos
      const buscar = () => navigator.onLine && reg.update().catch(() => {});
      buscar();
      window.addEventListener("online", buscar);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && buscar());
      setInterval(buscar, 30 * 60 * 1000);

      let recargando = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (recargando) return;
        recargando = true;
        location.reload();
      });
    } catch (e) {
      console.warn("Service worker no registrado:", e);
    }
  });
}

// Prefijo del técnico que hizo el informe. Los informes viejos no lo
// guardaban: se toma del número (EL-0041 -> EL).
function prefijoTecnico(informe) {
  if (informe.tecnicoPrefijo) return informe.tecnicoPrefijo;
  const m = /^([A-Z]{2,4})-\d+$/.exec(informe.numero || "");
  return m && m[1] !== "IST" ? m[1] : "";
}
