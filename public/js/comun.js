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
  return `Informe_${informe.numero}${entidad ? "_" + entidad : ""}.pdf`;
}

async function descargarPdf(informe) {
  const formato = await obtenerFormato(informe.formatoVersion);
  const doc = generarPDF(informe, formato);
  doc.save(nombreArchivoPdf(informe));
}

async function compartirPdf(informe) {
  const formato = await obtenerFormato(informe.formatoVersion);
  const doc = generarPDF(informe, formato);
  const archivo = new File([doc.output("blob")], nombreArchivoPdf(informe), { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
    await navigator.share({ files: [archivo], title: `Informe ${informe.numero}` });
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

      // Busca actualizaciones al abrir y cada vez que vuelve la conexión
      window.addEventListener("online", () => reg.update());
      setInterval(() => navigator.onLine && reg.update(), 30 * 60 * 1000);

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
