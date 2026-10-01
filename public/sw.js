// =====================================================================
//  SERVICE WORKER: guarda la app en el celular para abrirla sin internet.
//
//  CADA VEZ QUE CAMBIES EL CÓDIGO DE LA APP, sube el número de VERSION
//  (por ejemplo 1.0.1). Así los celulares detectan la actualización.
// =====================================================================
const VERSION = "1.0.3";
const CACHE = `siatet-app-${VERSION}`;

const ARCHIVOS = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./css/estilos.css",
  "./fonts/barlow-latin-400-normal.woff2",
  "./fonts/barlow-latin-500-normal.woff2",
  "./fonts/barlow-latin-600-normal.woff2",
  "./fonts/barlow-latin-700-normal.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./js/libs/firebase-app-compat.js",
  "./js/libs/firebase-auth-compat.js",
  "./js/libs/firebase-firestore-compat.js",
  "./js/libs/jspdf.umd.min.js",
  "./js/libs/signature_pad.umd.min.js",
  "./js/firebase-config.js",
  "./js/formato-base.js",
  "./js/comun.js",
  "./js/pdf.js",
  "./js/app.js",
  "./js/admin.js"
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(ARCHIVOS.map((url) => new Request(url, { cache: "reload" })))
    )
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c.startsWith("siatet-app-") && c !== CACHE).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

// La app pide actualizar cuando el técnico toca "Actualizar"
self.addEventListener("message", (evento) => {
  if (evento.data === "ACTUALIZAR") self.skipWaiting();
});

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;

  const url = new URL(peticion.url);
  // Firebase y otros servicios externos se manejan solos
  if (url.origin !== self.location.origin) return;
  // Rutas internas de Firebase Hosting
  if (url.pathname.startsWith("/__/")) return;

  evento.respondWith(
    caches.match(peticion, { ignoreSearch: true }).then((guardada) => {
      if (guardada) return guardada;
      return fetch(peticion).catch(() => {
        if (peticion.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Sin conexión" });
      });
    })
  );
});