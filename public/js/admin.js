// =====================================================================
//  PANEL DE ADMINISTRACIÓN
// =====================================================================

const admin = {
  vigente: FORMATO_BASE,   // versión publicada
  edicion: null,           // copia que se está editando
  editado: false,          // hay cambios sin publicar
  informes: [],
  consecutivo: null,       // último número entregado (null = aún no se ha iniciado)
  usuarios: [],
  desuscribir: []
};

vigilarConexion($("#estado-red"));
registrarServiceWorker();

// ---------- Sesión ----------
$("#btn-salir").addEventListener("click", async () => {
  await auth.signOut();
  location.replace("index.html");
});

auth.onAuthStateChanged(async (usuario) => {
  admin.desuscribir.forEach((fn) => fn());
  admin.desuscribir = [];
  $("#btn-menu").hidden = true;
  if (!usuario) {
    // Hay un solo inicio de sesión, el de la app; desde ahí el administrador llega al panel
    location.replace("index.html");
    return;
  }

  let perfil = null;
  try {
    const snap = await db.collection("usuarios").doc(usuario.uid).get();
    perfil = snap.exists ? snap.data() : null;
  } catch (e) { /* sin permiso */ }

  if (!perfil || perfil.rol !== "admin") {
    // Un técnico que abra este enlace va a su app
    location.replace("index.html");
    return;
  }

  $("#pantalla-panel").hidden = false;
  $("#btn-menu").hidden = false;
  menu.usuario(perfil.nombre || usuario.email, "admin");
  irA("dashboard");

  admin.desuscribir.push(escucharFormatoVigente((f) => {
    admin.vigente = f;
    // Solo se recarga el editor si no hay cambios sin publicar
    if (!admin.editado) cargarEdicion(f);
  }));
  admin.desuscribir.push(escucharInformesAdmin());
  admin.desuscribir.push(escucharConsecutivo());
  admin.desuscribir.push(escucharUsuarios());
  admin.desuscribir.push(iniciarHorarioAdmin());
  admin.desuscribir.push(escucharPermisosAdmin());
  admin.desuscribir.push(escucharIncapacidadesAdmin());
});

// ---------- Menú y secciones ----------
const menu = iniciarMenu(irA);

function irA(seccion) {
  const pendiente = SECCIONES_PENDIENTES[seccion];
  if (pendiente) {
    $("#sec-titulo").textContent = pendiente.titulo;
    $("#sec-texto").textContent = pendiente.texto;
  }
  const panel = pendiente ? "proximamente" : seccion;
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== panel));
  menu.marcar(seccion);
  window.scrollTo(0, 0);
}

// Botones dentro de las secciones que llevan a otra ("Ver todos", "Volver")
$("#pantalla-panel").addEventListener("click", (e) => {
  const boton = e.target.closest("[data-ir]");
  if (boton) irA(boton.dataset.ir);
});

// =====================================================================
//  DASHBOARD
// =====================================================================
const LIMITE_INFORMES = 300;   // informes recientes que carga el panel
const NOMBRES_DIA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function claveDia(fecha) {
  const p = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

function pintarTablero() {
  const ahora = new Date();
  const hoy = claveDia(ahora);
  const mes = hoy.slice(0, 7);
  // Día en que se guardó cada informe, en la hora del dispositivo
  const dias = admin.informes.map((i) => (i.creadoLocal ? claveDia(new Date(i.creadoLocal)) : ""));
  const delMes = admin.informes.filter((_, k) => dias[k].startsWith(mes));
  // Si los 300 informes cargados son todos de este mes, puede haber más
  const hayMas = admin.informes.length >= LIMITE_INFORMES && delMes.length === admin.informes.length;

  $("#d-mes").textContent = `${NOMBRES_MES[ahora.getMonth()]} de ${ahora.getFullYear()}`;
  $("#d-hoy").textContent = dias.filter((d) => d === hoy).length;
  $("#d-total-mes").textContent = delMes.length + (hayMas ? "+" : "");
  $("#d-tecnicos").textContent = admin.usuarios.filter((u) => u.rol !== "admin").length;

  // Informes por día, últimos 7 días
  const semana = [];
  for (let k = 6; k >= 0; k--) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - k);
    const clave = claveDia(fecha);
    semana.push({ nombre: k === 0 ? "Hoy" : NOMBRES_DIA[fecha.getDay()], n: dias.filter((d) => d === clave).length, hoy: k === 0 });
  }
  const mayor = Math.max(1, ...semana.map((d) => d.n));
  $("#d-semana").textContent = `Últimos 7 días · ${semana.reduce((t, d) => t + d.n, 0)}`;
  $("#d-grafica").innerHTML = semana.map((d) => `
    <div class="grafica-dia${d.hoy ? " hoy" : ""}">
      <span class="grafica-valor">${d.n}</span>
      <span class="grafica-palo" style="height:${Math.max(2, Math.round((d.n / mayor) * 110))}px"></span>
      <span class="grafica-nombre">${d.nombre}</span>
    </div>`).join("");

  // Informes por técnico en el mes (incluye a los habilitados que no han hecho ninguno)
  const porTecnico = new Map();
  admin.usuarios.filter((u) => u.rol !== "admin").forEach((u) => porTecnico.set(u.uid, { nombre: u.nombre, n: 0 }));
  delMes.forEach((i) => {
    const fila = porTecnico.get(i.tecnicoUid)
      || { nombre: admin.usuarios.find((u) => u.uid === i.tecnicoUid)?.nombre || i.tecnicoNombres || i.tecnicoCorreo || "Sin nombre", n: 0 };
    fila.n++;
    porTecnico.set(i.tecnicoUid, fila);
  });
  const filas = [...porTecnico.values()].sort((a, b) => b.n - a.n);
  const mayorTecnico = Math.max(1, ...filas.map((f) => f.n));
  $("#d-por-tecnico").innerHTML = filas.length ? filas.map((f) => `
    <div class="avance">
      <div class="avance-texto"><span>${escaparHtml(f.nombre)}</span><strong>${f.n}</strong></div>
      <div class="avance-pista"><div class="avance-relleno" style="width:${Math.round((f.n / mayorTecnico) * 100)}%"></div></div>
    </div>`).join("") : `<p class="vacio">Aún no hay técnicos registrados.</p>`;

  // Últimos informes recibidos
  const ultimos = admin.informes.slice(0, 5);
  $("#d-ultimos").innerHTML = ultimos.length ? ultimos.map((i) => `
    <li><button class="informe-item" data-pdf="${escaparHtml(i.id)}">
      <span class="num">${escaparHtml(i.numero || "Sin número")} · ${escaparHtml(i.campos?.entidad || "Sin entidad")}</span>
      <span class="chip ${estadoDeInforme(i).clase}">${i.estado === "pendiente" ? "Pendiente" : "Ver informe"}</span>
      <span class="det">${escaparHtml([fechaLegible(i.campos?.fecha), i.campos?.equipo, i.tecnicoNombres].filter(Boolean).join(" · "))}</span>
    </button></li>`).join("") : `<li class="vacio">Aún no se ha recibido ningún informe.</li>`;
}

$("#d-ultimos").addEventListener("click", (e) => {
  const boton = e.target.closest("[data-pdf]");
  if (!boton) return;
  const informe = admin.informes.find((i) => i.id === boton.dataset.pdf);
  if (informe) verPdf(informe);
});

// =====================================================================
//  EDITOR DEL FORMATO
// =====================================================================
function leerRuta(obj, ruta) {
  return ruta.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}
function escribirRuta(obj, ruta, valor) {
  const partes = ruta.split(".");
  const ultimo = partes.pop();
  const destino = partes.reduce((o, k) => (o[k] = o[k] || {}), obj);
  destino[ultimo] = valor;
}

function cargarEdicion(formato) {
  admin.edicion = copiaProfunda(formato);
  admin.editado = false;
  // Completa propiedades que falten en versiones antiguas
  for (const k of ["empresa", "colores", "firmas", "fotos"]) {
    admin.edicion[k] = { ...FORMATO_BASE[k], ...(admin.edicion[k] || {}) };
  }
  pintarEditor();
}

function pintarEditor() {
  const f = admin.edicion;
  $$("[data-ruta]").forEach((el) => {
    const v = leerRuta(f, el.dataset.ruta);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  });
  $("#logo-vista").hidden = !f.logo;
  if (f.logo) $("#logo-vista").src = f.logo;
  $("#logo2-vista").hidden = !f.logo2;
  if (f.logo2) $("#logo2-vista").src = f.logo2;
  pintarCampos();
  pintarSecciones();
}

$('[data-panel="formato"]').addEventListener("input", () => (admin.editado = true));

$$("[data-ruta]").forEach((el) => {
  el.addEventListener("input", () => {
    const valor = el.type === "checkbox" ? el.checked
      : el.type === "number" ? Math.max(0, Math.min(3, Number(el.value) || 0)) : el.value;
    escribirRuta(admin.edicion, el.dataset.ruta, valor);
  });
});

const botonesOrden = (i, total) => `
    <button type="button" data-accion="subir" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
    <button type="button" data-accion="bajar" data-i="${i}" ${i === total - 1 ? "disabled" : ""} aria-label="Bajar">↓</button>
    <button type="button" data-accion="quitar" data-i="${i}" class="quitar" aria-label="Quitar">✕</button>`;

function pintarCampos() {
  const lista = admin.edicion.campos;
  $("#editor-campos").innerHTML = lista.map((c, i) => `
    <div class="editor-fila" data-i="${i}">
      <input type="text" data-prop="etiqueta" value="${escaparHtml(c.etiqueta)}" aria-label="Nombre del campo">
      <select data-prop="tipo" aria-label="Tipo">
        <option value="texto" ${c.tipo === "texto" ? "selected" : ""}>Texto</option>
        <option value="fecha" ${c.tipo === "fecha" ? "selected" : ""}>Fecha</option>
        <option value="numero" ${c.tipo === "numero" ? "selected" : ""}>Número</option>
      </select>
      <select data-prop="ancho" aria-label="Ancho">
        <option value="media" ${c.ancho === "media" ? "selected" : ""}>Media fila</option>
        <option value="completa" ${c.ancho === "completa" ? "selected" : ""}>Fila completa</option>
      </select>
      <div class="acciones">
        <label class="oblig"><input type="checkbox" data-prop="obligatorio" ${c.obligatorio ? "checked" : ""}> Obligatorio</label>
        ${botonesOrden(i, lista.length)}
      </div>
    </div>`).join("");
}

function pintarSecciones() {
  const lista = admin.edicion.secciones;
  $("#editor-secciones").innerHTML = lista.map((s, i) => `
    <div class="editor-fila seccion-fila" data-i="${i}">
      <input type="text" data-prop="titulo" value="${escaparHtml(s.titulo)}" aria-label="Título de la sección">
      <input type="number" data-prop="alto" value="${Number(s.alto) || 24}" min="14" max="200" aria-label="Alto en milímetros">
      <div class="acciones">
        <label class="oblig"><input type="checkbox" data-prop="obligatorio" ${s.obligatorio ? "checked" : ""}> Obligatoria</label>
        ${botonesOrden(i, lista.length)}
      </div>
    </div>`).join("");
}

function conectarEditorLista(selector, clave, repintar) {
  const cont = $(selector);
  cont.addEventListener("input", (e) => {
    const fila = e.target.closest(".editor-fila");
    const prop = e.target.dataset.prop;
    if (!fila || !prop) return;
    const item = admin.edicion[clave][Number(fila.dataset.i)];
    item[prop] = e.target.type === "checkbox" ? e.target.checked
      : e.target.type === "number" ? Number(e.target.value) : e.target.value;
  });
  cont.addEventListener("click", (e) => {
    const accion = e.target.dataset?.accion;
    if (!accion) return;
    const lista = admin.edicion[clave];
    const i = Number(e.target.dataset.i);
    if (accion === "subir" && i > 0) [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]];
    if (accion === "bajar" && i < lista.length - 1) [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]];
    if (accion === "quitar") {
      if (!confirm(`¿Quitar “${lista[i].etiqueta || lista[i].titulo}” del formato?`)) return;
      lista.splice(i, 1);
    }
    admin.editado = true;
    repintar();
  });
}
conectarEditorLista("#editor-campos", "campos", pintarCampos);
conectarEditorLista("#editor-secciones", "secciones", pintarSecciones);

// Los ID nuevos nunca se reutilizan, así un campo renombrado conserva sus datos
const nuevoId = (p) => p + Date.now().toString(36);

$("#btn-agregar-campo").addEventListener("click", () => {
  admin.editado = true;
  admin.edicion.campos.push({ id: nuevoId("c"), etiqueta: "Nuevo campo", tipo: "texto", ancho: "media", obligatorio: false });
  pintarCampos();
  $("#editor-campos .editor-fila:last-child input").select();
});
$("#btn-agregar-seccion").addEventListener("click", () => {
  admin.editado = true;
  admin.edicion.secciones.push({ id: nuevoId("s"), titulo: "Nueva sección", alto: 24, obligatorio: false });
  pintarSecciones();
  $("#editor-secciones .editor-fila:last-child input").select();
});

// ---------- Logo ----------
$("#logo-archivo").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  try {
    admin.edicion.logo = await reducirImagen(archivo, 500);
    admin.editado = true;
    pintarEditor();
    aviso("Logo cargado. Publica una nueva versión para aplicarlo.", "ok");
  } catch (err) {
    aviso("No se pudo leer la imagen.", "error");
  }
});
$("#logo-quitar").addEventListener("click", () => {
  admin.edicion.logo = "";
  admin.editado = true;
  pintarEditor();
});

// Segundo logo: se recortan los bordes blancos para que no quede pequeño en el PDF
$("#logo2-archivo").addEventListener("change", async (e) => {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  try {
    admin.edicion.logo2 = await reducirImagen(archivo, 500, true);
    admin.editado = true;
    pintarEditor();
    aviso("Segundo logo cargado. Publica una nueva versión para aplicarlo.", "ok");
  } catch (err) {
    aviso("No se pudo leer la imagen.", "error");
  }
});
$("#logo2-quitar").addEventListener("click", () => {
  admin.edicion.logo2 = "";
  admin.editado = true;
  pintarEditor();
});

// Reduce la imagen para que quepa en la base de datos (máx. ~400 KB)
// Con recortar = true quita los bordes blancos o transparentes alrededor del dibujo
function areaConDibujo(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const fondo = data[i + 3] < 20 || (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235);
      if (fondo) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: img.width, h: img.height };
  const m = 4;   // pequeño margen
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(img.width - 1, x1 + m); y1 = Math.min(img.height - 1, y1 + m);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Vuelve transparente el fondo blanco o gris muy claro (muchos logos vienen en JPG con fondo)
function quitarFondoClaro(canvas) {
  const ctx = canvas.getContext("2d");
  const imagen = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imagen.data;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
    if (min > 232 && max - min < 14) d[i + 3] = 0;
    else if (min > 215 && max - min < 14) d[i + 3] = Math.round(255 * (232 - min) / 17);   // borde suave
  }
  ctx.putImageData(imagen, 0, 0);
}

function reducirImagen(archivo, maximo, recortar = false) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => {
      const area = recortar ? areaConDibujo(img) : { x: 0, y: 0, w: img.width, h: img.height };
      const esc = Math.min(1, maximo / Math.max(area.w, area.h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(area.w * esc);
      canvas.height = Math.round(area.h * esc);
      canvas.getContext("2d").drawImage(img, area.x, area.y, area.w, area.h, 0, 0, canvas.width, canvas.height);
      if (recortar) quitarFondoClaro(canvas);
      let url = canvas.toDataURL("image/png");
      if (url.length > 400000) {
        const ctx = canvas.getContext("2d");
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL("image/jpeg", 0.85);
      }
      URL.revokeObjectURL(img.src);
      resolver(url);
    };
    img.onerror = rechazar;
    img.src = URL.createObjectURL(archivo);
  });
}

// ---------- Vista previa, publicar, descartar ----------
function informeDeEjemplo(formato) {
  const campos = {};
  formato.campos.forEach((c) => {
    campos[c.id] = c.tipo === "fecha" ? hoyISO() : c.tipo === "numero" ? "123" : `Ejemplo de ${c.etiqueta.toLowerCase()}`;
  });
  const secciones = {};
  formato.secciones.forEach((s) => (secciones[s.id] = `Texto de ejemplo para ${s.titulo.toLowerCase()}.`));
  // Fotos grises de ejemplo para ver cómo queda la página de fotos
  const ejemplo = (texto) => {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 480;
    const x = c.getContext("2d");
    x.fillStyle = "#C9CEC8"; x.fillRect(0, 0, 640, 480);
    x.fillStyle = "#2F3336"; x.font = "bold 40px sans-serif"; x.textAlign = "center";
    x.fillText(texto, 320, 250);
    return c.toDataURL("image/jpeg", 0.8);
  };
  const fotos = [];
  if (formato.fotos?.activas) {
    for (let i = 0; i < (formato.fotos.maxAntes || 0); i++) fotos.push({ tipo: "antes", data: ejemplo("Foto antes " + (i + 1)), descripcion: "Descripción de ejemplo" });
    for (let i = 0; i < (formato.fotos.maxDespues || 0); i++) fotos.push({ tipo: "despues", data: ejemplo("Foto después " + (i + 1)), descripcion: "Descripción de ejemplo" });
  }
  return {
    numero: "IST-0001", campos, secciones, fotos,
    tecnicoNombres: "Nombre del técnico", tecnicoPrefijo: "EJ", clienteNombre: "Nombre del cliente", clienteDoc: "1.234.567",
    formatoVersion: formato.version
  };
}

function validarEdicion() {
  const f = admin.edicion;
  if (!f.campos.length) return "El formato necesita al menos un campo.";
  if (f.campos.some((c) => !c.etiqueta.trim())) return "Hay un campo sin nombre.";
  if (f.secciones.some((s) => !s.titulo.trim())) return "Hay una sección sin título.";
  if (JSON.stringify(f).length > 900000) return "El formato es muy pesado. Usa un logo más liviano.";
  return null;
}

$("#btn-vista").addEventListener("click", () => {
  const error = validarEdicion();
  if (error) return aviso(error, "error");
  const f = { ...copiaProfunda(admin.edicion), version: `${admin.vigente.version + 1} (borrador)` };
  const doc = generarPDF(informeDeEjemplo(f), f);
  const ventana = window.open(doc.output("bloburl"), "_blank");
  if (!ventana) doc.save("vista-previa-formato.pdf");
});

$("#btn-publicar").addEventListener("click", async () => {
  const error = validarEdicion();
  if (error) return aviso(error, "error");
  if (!navigator.onLine) return aviso("Necesitas internet para publicar.", "error");

  const nueva = Number(admin.vigente.version || 0) + 1;
  if (!confirm(`¿Publicar la versión ${nueva} del formato? Los técnicos la recibirán al tener internet.`)) return;

  const datos = { ...copiaProfunda(admin.edicion), version: nueva };
  const lote = db.batch();
  lote.set(db.collection("formatos").doc(String(nueva)), {
    ...datos,
    publicado: firebase.firestore.FieldValue.serverTimestamp(),
    publicadoPor: auth.currentUser.email
  });
  lote.set(db.collection("config").doc("actual"), {
    version: nueva,
    actualizado: firebase.firestore.FieldValue.serverTimestamp()
  });

  try {
    $("#btn-publicar").disabled = true;
    await lote.commit();
    guardarFormatoLocal(datos);
    cargarEdicion(datos);
    aviso(`Versión ${nueva} publicada.`, "ok");
  } catch (err) {
    aviso("No se pudo publicar: " + err.message, "error");
  } finally {
    $("#btn-publicar").disabled = false;
  }
});

$("#btn-deshacer").addEventListener("click", () => {
  if (confirm("¿Descartar los cambios sin publicar?")) cargarEdicion(admin.vigente);
});
$("#btn-base").addEventListener("click", () => {
  if (confirm("¿Cargar el formato original en el editor? No se publica hasta que toques Publicar.")) {
    cargarEdicion({ ...FORMATO_BASE, logo: admin.edicion.logo, logo2: admin.edicion.logo2 || "" });
    admin.editado = true;
  }
});

// =====================================================================
//  INFORMES
// =====================================================================
function escucharInformesAdmin() {
  return db.collection("informes").orderBy("creadoLocal", "desc").limit(LIMITE_INFORMES)
    .onSnapshot((snap) => {
      admin.informes = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      pintarInformes();
      pintarTablero();
      admin.informesCargados = true;
      iniciarConsecutivoSiFalta();
    }, (err) => aviso("No se pudieron cargar los informes: " + err.code, "error"));
}

// ---------- Consecutivo único de informes ----------
// contadores/informes guarda el último número entregado. Cada informe nuevo
// recibe el siguiente, sin importar qué técnico lo hizo.
function escucharConsecutivo() {
  return db.collection("contadores").doc("informes").onSnapshot((snap) => {
    admin.consecutivo = snap.exists ? Number(snap.data().ultimo || 0) : null;
    admin.consecutivoLeido = !snap.metadata.fromCache;
    $("#c-ultimo").textContent = admin.consecutivo === null ? "sin iniciar" : String(admin.consecutivo).padStart(4, "0");
    $("#c-siguiente").textContent = admin.consecutivo === null ? "—" : String(admin.consecutivo + 1).padStart(4, "0");
    iniciarConsecutivoSiFalta();
  }, (err) => console.warn("Sin acceso al consecutivo:", err.code));
}

// Número más alto que ya se usó en los informes cargados
function mayorNumeroUsado() {
  return admin.informes.reduce((mayor, i) => {
    const m = /-(\d+)$/.exec(i.numero || "");
    return m ? Math.max(mayor, Number(m[1])) : mayor;
  }, 0);
}

// La primera vez arranca desde el número más alto que ya existe, para no repetir ninguno
async function iniciarConsecutivoSiFalta() {
  if (admin.consecutivo !== null || !admin.consecutivoLeido || !admin.informesCargados || admin.iniciandoConsecutivo) return;
  admin.iniciandoConsecutivo = true;
  try {
    const ultimo = mayorNumeroUsado();
    await db.collection("contadores").doc("informes").set({ ultimo });
    admin.consecutivo = ultimo;
    aviso(`Consecutivo único iniciado. El próximo informe será el ${String(ultimo + 1).padStart(4, "0")}.`, "ok");
  } catch (err) {
    console.warn("No se pudo iniciar el consecutivo:", err.code);
  }
  admin.iniciandoConsecutivo = false;
}

$("#form-consecutivo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const siguiente = Math.floor(Number($("#c-nuevo").value));
  if (!(siguiente >= 1)) return aviso("Escribe el número que debe llevar el próximo informe.", "error");
  const usado = mayorNumeroUsado();
  if (siguiente <= usado && !confirm(`Ya existen informes hasta el ${String(usado).padStart(4, "0")}. Si sigues desde ${String(siguiente).padStart(4, "0")} se van a repetir números. ¿Continuar?`)) return;
  try {
    await db.collection("contadores").doc("informes").set({ ultimo: siguiente - 1 });
    $("#c-nuevo").value = "";
    aviso(`Listo. El próximo informe será el ${String(siguiente).padStart(4, "0")}.`, "ok");
  } catch (err) {
    aviso("No se pudo cambiar el consecutivo: " + err.message, "error");
  }
});

function informesFiltrados() {
  const q = $("#buscar").value.trim().toLowerCase();
  if (!q) return admin.informes;
  return admin.informes.filter((i) =>
    [i.numero, i.campos?.entidad, i.campos?.equipo, i.campos?.sede, i.tecnicoNombres, i.clienteNombre, estadoDeInforme(i).texto]
      .join(" ").toLowerCase().includes(q));
}

function pintarInformes() {
  const lista = informesFiltrados();
  $("#cuerpo-informes").innerHTML = lista.length ? lista.map((i) => `
    <tr>
      <td><strong>${escaparHtml(i.numero || "Sin número")}</strong><br><span class="chip ${estadoDeInforme(i).clase}" title="${escaparHtml(i.motivoPendiente || "")}">${estadoDeInforme(i).texto}</span></td>
      <td>${escaparHtml(fechaLegible(i.campos?.fecha))}</td>
      <td>${escaparHtml(i.campos?.entidad)}${i.campos?.sede ? `<br><span class="nota">${escaparHtml(i.campos.sede)}</span>` : ""}</td>
      <td>${escaparHtml(i.campos?.equipo)}</td>
      <td>${escaparHtml(i.tecnicoNombres)}</td>
      <td style="white-space:nowrap">
        <button class="boton pequeno primario" data-ver="${escaparHtml(i.id)}">Ver</button>
        <button class="boton pequeno" data-pdf="${escaparHtml(i.id)}">PDF</button>
        <button class="boton pequeno peligro" data-borrar="${escaparHtml(i.id)}" aria-label="Borrar">✕</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="6" class="vacio">No hay informes que coincidan.</td></tr>`;
}
$("#buscar").addEventListener("input", pintarInformes);

$("#cuerpo-informes").addEventListener("click", async (e) => {
  const idVer = e.target.dataset?.ver;
  if (idVer) verPdf(admin.informes.find((i) => i.id === idVer));
  const idPdf = e.target.dataset?.pdf;
  const idBorrar = e.target.dataset?.borrar;
  if (idPdf) {
    const informe = admin.informes.find((i) => i.id === idPdf);
    descargarPdf(informe).catch((err) => aviso(err.message, "error"));
  }
  if (idBorrar) {
    const informe = admin.informes.find((i) => i.id === idBorrar);
    if (!confirm(`¿Borrar definitivamente el informe ${informe.numero || "sin número"}? Esta acción no se puede deshacer.`)) return;
    try {
      // Primero se borran sus fotos y luego el informe
      const ref = db.collection("informes").doc(idBorrar);
      const fotos = await ref.collection("fotos").get();
      const lote = db.batch();
      fotos.docs.forEach((d) => lote.delete(d.ref));
      lote.delete(ref);
      await lote.commit();
      aviso(`Informe ${informe.numero} borrado.`, "ok");
    } catch (err) {
      aviso("No se pudo borrar: " + err.message, "error");
    }
  }
});

// Texto del archivo de Excel (CSV) con los informes de la lista
function csvInformes(lista) {
  const idsCampos = [...new Set(lista.flatMap((i) => Object.keys(i.campos || {})))];
  const idsSecciones = [...new Set(lista.flatMap((i) => Object.keys(i.secciones || {})))];
  const nombre = (id, arr, prop) => arr.find((x) => x.id === id)?.[prop] || id;

  const encabezado = ["Número", "Estado",
    ...idsCampos.map((id) => nombre(id, admin.vigente.campos, "etiqueta")),
    ...idsSecciones.map((id) => nombre(id, admin.vigente.secciones, "titulo")),
    "Técnico(s)", "Recibe", "Documento", "Correo técnico", "Versión formato", "Creado"];
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = lista.map((i) => [
    i.numero, i.estado === "pendiente" ? `Pendiente: ${i.motivoPendiente || ""}` : "Finalizado",
    ...idsCampos.map((id) => i.campos?.[id]),
    ...idsSecciones.map((id) => i.secciones?.[id]),
    i.tecnicoNombres, i.clienteNombre, i.clienteDoc, i.tecnicoCorreo, i.formatoVersion, i.creadoLocal
  ].map(celda).join(";"));
  return "﻿" + [encabezado.map(celda).join(";"), ...filas].join("\r\n");
}

function descargarTexto(texto, nombreArchivo) {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  enlace.download = nombreArchivo;
  enlace.click();
}

$("#btn-csv").addEventListener("click", () => {
  const lista = informesFiltrados();
  if (!lista.length) return aviso("No hay informes para exportar.");
  descargarTexto(csvInformes(lista), `informes_siatet_${hoyISO()}.csv`);
});

// =====================================================================
//  USUARIOS
// =====================================================================
// Las cuentas nuevas se crean con una segunda conexión a Firebase,
// así el administrador no pierde su sesión al crear un técnico.
let _authCreacion = null;
async function crearCuenta(correo, clave) {
  if (!_authCreacion) {
    _authCreacion = firebase.initializeApp(FIREBASE_CONFIG, "crear-usuarios").auth();
    await _authCreacion.setPersistence(firebase.auth.Auth.Persistence.NONE);
  }
  const cred = await _authCreacion.createUserWithEmailAndPassword(correo, clave);
  const uid = cred.user.uid;
  await _authCreacion.signOut();
  return uid;
}

let uidEditando = null;

function modoCrear() {
  uidEditando = null;
  $("#form-usuario").reset();
  $("#u-uid").value = "";
  $("#u-titulo").textContent = "Crear usuario";
  $("#u-guardar").textContent = "Crear usuario";
  $("#u-clave-caja").hidden = false;
  $("#u-avanzado").hidden = false;
  $("#u-cancelar").hidden = true;
  $("#u-correo").disabled = false;
}

function modoEditar(u) {
  uidEditando = u.uid;
  $("#u-nombre").value = u.nombre || "";
  $("#u-correo").value = u.correo || "";
  $("#u-prefijo").value = u.prefijo || "";
  $("#u-rol").value = u.rol || "tecnico";
  $("#u-titulo").textContent = `Editar a ${u.nombre || "usuario"}`;
  $("#u-guardar").textContent = "Guardar cambios";
  $("#u-clave-caja").hidden = true;
  $("#u-avanzado").hidden = true;
  $("#u-cancelar").hidden = false;
  $("#u-nombre").focus();
  $("#u-titulo").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#u-cancelar").addEventListener("click", modoCrear);

function escucharUsuarios() {
  return db.collection("usuarios").onSnapshot((snap) => {
    admin.usuarios = snap.docs.map((d) => ({ ...d.data(), uid: d.id }))
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    pintarTablero();
    pintarPersonasHorario();
    pintarMarcaciones();
    const yo = auth.currentUser?.uid;
    $("#cuerpo-usuarios").innerHTML = admin.usuarios.map((u) => `
      <tr>
        <td>${escaparHtml(u.nombre)}${u.uid === yo ? ' <span class="nota">(tú)</span>' : ""}</td>
        <td>${escaparHtml(u.correo)}</td>
        <td>${escaparHtml(u.prefijo)}</td>
        <td>${u.rol === "admin" ? "Administrador" : "Técnico"}</td>
        <td style="white-space:nowrap">
          <button class="boton pequeno" data-editar="${escaparHtml(u.uid)}">Editar</button>
          ${u.correo ? `<button class="boton pequeno" data-clave="${escaparHtml(u.uid)}">Cambiar contraseña</button>` : ""}
          ${u.uid !== yo ? `<button class="boton pequeno peligro" data-quitar="${escaparHtml(u.uid)}">Quitar acceso</button>` : ""}
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="vacio">Aún no hay usuarios.</td></tr>`;
  });
}

$("#cuerpo-usuarios").addEventListener("click", async (e) => {
  const d = e.target.dataset || {};
  const uid = d.editar || d.clave || d.quitar;
  const u = admin.usuarios.find((x) => x.uid === uid);
  if (!u) return;

  if (d.editar) modoEditar(u);

  if (d.clave) {
    if (!confirm(`Se enviará a ${u.correo} un correo para que ${u.nombre} cree una contraseña nueva. ¿Continuar?`)) return;
    try {
      await auth.sendPasswordResetEmail(u.correo);
      aviso(`Correo enviado a ${u.correo}. Que revise también la carpeta de spam.`, "ok");
    } catch (err) {
      aviso("No se pudo enviar el correo: " + err.message, "error");
    }
  }

  if (d.quitar) {
    if (!confirm(`¿Quitar el acceso a ${u.nombre}? Ya no podrá entrar a la app. Sus informes se conservan.`)) return;
    try {
      await db.collection("usuarios").doc(uid).delete();
      aviso(`${u.nombre} ya no tiene acceso.`, "ok");
    } catch (err) {
      aviso("No se pudo quitar el acceso: " + err.message, "error");
    }
  }
});

$("#form-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("#u-nombre").value.trim();
  const correo = $("#u-correo").value.trim().toLowerCase();
  const clave = $("#u-clave").value;
  const prefijo = $("#u-prefijo").value.trim().toUpperCase();
  const rol = $("#u-rol").value;
  const uidManual = $("#u-uid").value.trim();

  if (!nombre) return aviso("Escribe el nombre completo.", "error");
  if (!/^[A-Z]{2,4}$/.test(prefijo)) return aviso("El prefijo debe tener de 2 a 4 letras, sin números.", "error");
  const repetido = admin.usuarios.find((u) => u.prefijo?.toUpperCase() === prefijo && u.uid !== uidEditando);
  if (repetido) return aviso(`El prefijo ${prefijo} ya lo usa ${repetido.nombre}.`, "error");

  const boton = $("#u-guardar");
  boton.disabled = true;
  try {
    let uid = uidEditando;

    if (!uid) {
      if (!navigator.onLine) throw new Error("Necesitas internet para crear usuarios.");
      if (!/^\S+@\S+\.\S+$/.test(correo)) throw new Error("Escribe un correo válido.");
      if (uidManual) {
        uid = uidManual;
      } else {
        if (clave.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
        uid = await crearCuenta(correo, clave);
      }
    }

    await db.collection("usuarios").doc(uid).set({ nombre, correo, prefijo, rol }, { merge: true });

    if (uidEditando) {
      aviso(`Se guardaron los cambios de ${nombre}.`, "ok");
    } else if (!uidManual) {
      alert(`Usuario creado.\n\nEntrégale estos datos a ${nombre}:\nEnlace: ${location.origin}\nCorreo: ${correo}\nContraseña: ${clave}`);
    } else {
      aviso(`${nombre} quedó habilitado.`, "ok");
    }
    modoCrear();
  } catch (err) {
    const mensajes = {
      "auth/email-already-in-use": "Ese correo ya tiene una cuenta en Firebase. Abre “El correo ya tiene cuenta en Firebase” y pega su UID.",
      "auth/invalid-email": "El correo no es válido.",
      "auth/weak-password": "La contraseña es muy débil. Usa al menos 6 caracteres.",
      "auth/operation-not-allowed": "Activa el acceso con correo y contraseña en Firebase > Authentication > Método de acceso.",
      "auth/admin-restricted-operation": "Firebase no permite crear cuentas desde la app. Activa “Habilitar creación (registro)” en Authentication > Configuración > Acciones de usuario."
    };
    aviso(mensajes[err.code] || err.message, "error");
  } finally {
    boton.disabled = false;
  }
});
