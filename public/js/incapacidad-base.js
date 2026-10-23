const TIPOS_INCAPACIDAD = [
  "Enfermedad general",
  "Accidente de trabajo",
  "Enfermedad laboral",
  "Accidente de tránsito",
  "Licencia de maternidad",
  "Licencia de paternidad",
  "Otra"
];

const LIMITES_INCAPACIDAD = {
  archivos: 6,                 // fotos o PDF por incapacidad
  pdfBytes: 3 * 1024 * 1024,   // 3 MB por PDF
  totalCaracteres: 7500000,    // lo que cabe en un solo envío a Firestore
  trozo: 900000                // caracteres por documento de Firestore
};

function estadoDeIncapacidad(inc) {
  if (inc.estado === "avalada") return { clase: "verde", texto: "Avalada" };
  if (inc.estado === "rechazada") return { clase: "rojo", texto: "Rechazada" };
  return { clase: "amarillo", texto: inc._pendiente ? "Por enviar" : "Por revisar" };
}

// Días calendario entre dos fechas "AAAA-MM-DD", contando ambas
function diasDeIncapacidad(desde, hasta) {
  if (!desde || !hasta) return 0;
  const a = new Date(desde + "T00:00:00"), b = new Date(hasta + "T00:00:00");
  return Math.round((b - a) / 86400000) + 1;
}

// Lista de fechas "AAAA-MM-DD" del periodo
function fechasDeIncapacidad(desde, hasta) {
  const fechas = [];
  const d = new Date(desde + "T00:00:00"), fin = new Date(hasta + "T00:00:00");
  while (d <= fin && fechas.length < 400) {
    fechas.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

function pesoLegible(caracteres) {
  const kb = (caracteres * 0.75) / 1024;   // base64 -> bytes
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

// ---------------------------------------------------------------------
//  Preparar un archivo elegido en el celular
//  Las fotos se reducen (máx. 2000 px, ~500 KB) para que sigan siendo
//  legibles. Los PDF se guardan tal cual.
// ---------------------------------------------------------------------
function leerComoDataUrl(archivo) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result);
    lector.onerror = () => rechazar(lector.error);
    lector.readAsDataURL(archivo);
  });
}

function reducirImagenDocumento(archivo) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => {
      let esc = Math.min(1, 2000 / Math.max(img.width, img.height));
      let calidad = 0.8, url = "";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      for (let intento = 0; intento < 8; intento++) {
        canvas.width = Math.round(img.width * esc);
        canvas.height = Math.round(img.height * esc);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL("image/jpeg", calidad);
        if (url.length <= 700000) break;
        if (calidad > 0.6) calidad -= 0.08; else esc *= 0.85;
      }
      URL.revokeObjectURL(img.src);
      resolver(url);
    };
    img.onerror = () => rechazar(new Error("No se pudo leer la imagen."));
    img.src = URL.createObjectURL(archivo);
  });
}

async function prepararArchivoIncapacidad(archivo) {
  const esPdf = archivo.type === "application/pdf" || /\.pdf$/i.test(archivo.name);
  if (esPdf) {
    if (archivo.size > LIMITES_INCAPACIDAD.pdfBytes) {
      throw new Error(`El PDF “${archivo.name}” pesa más de 3 MB. Escanéalo con menos calidad o envía fotos.`);
    }
    const url = await leerComoDataUrl(archivo);
    return { nombre: archivo.name, tipo: "application/pdf", datos: url.slice(url.indexOf(",") + 1) };
  }
  if (!archivo.type.startsWith("image/")) throw new Error(`“${archivo.name}” no es una foto ni un PDF.`);
  const url = await reducirImagenDocumento(archivo);
  const nombre = archivo.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { nombre, tipo: "image/jpeg", datos: url.slice(url.indexOf(",") + 1) };
}

// Parte cada archivo en trozos que caben en un documento de Firestore
function trozosDeArchivos(archivos, tecnicoUid) {
  const trozos = [];
  archivos.forEach((a, orden) => {
    const partes = Math.max(1, Math.ceil(a.datos.length / LIMITES_INCAPACIDAD.trozo));
    for (let parte = 0; parte < partes; parte++) {
      trozos.push({
        tecnicoUid, orden, parte, partes,
        nombre: a.nombre, tipo: a.tipo,
        datos: a.datos.slice(parte * LIMITES_INCAPACIDAD.trozo, (parte + 1) * LIMITES_INCAPACIDAD.trozo)
      });
    }
  });
  return trozos;
}

// ---------------------------------------------------------------------
//  Leer el documento de una incapacidad y mostrarlo
// ---------------------------------------------------------------------
async function cargarArchivosIncapacidad(inc) {
  if (inc._archivos) return inc._archivos;
  // El filtro por dueño es obligatorio: las reglas solo dejan leer los propios
  const snap = await db.collection("incapacidades").doc(inc.id).collection("archivos")
    .where("tecnicoUid", "==", inc.tecnicoUid).get();
  const grupos = {};
  snap.docs.forEach((d) => {
    const t = d.data();
    (grupos[t.orden] = grupos[t.orden] || { nombre: t.nombre, tipo: t.tipo, partes: t.partes, trozos: [] })
      .trozos[t.parte] = t.datos;
  });
  inc._archivos = Object.keys(grupos).sort((a, b) => a - b).map((k) => {
    const g = grupos[k];
    const completo = g.trozos.filter((x) => x !== undefined).length === g.partes;
    return { nombre: g.nombre, tipo: g.tipo, completo, datos: completo ? g.trozos.join("") : "" };
  });
  return inc._archivos;
}

function blobDeArchivo(archivo) {
  const binario = atob(archivo.datos);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: archivo.tipo });
}

function nombreDescargaIncapacidad(inc, archivo, i) {
  const persona = (inc.nombre || "persona").replace(/[^\wÁÉÍÓÚÑáéíóúñ-]+/g, "_");
  const ext = archivo.tipo === "application/pdf" ? "pdf" : "jpg";
  return `Incapacidad_${persona}_${inc.desde || ""}_${i + 1}.${ext}`;
}

// Pinta las fotos y los PDF dentro de un contenedor, con botón para abrir o descargar
async function pintarArchivosIncapacidad(inc, contenedor) {
  contenedor.innerHTML = `<p class="nota">Cargando el documento…</p>`;
  try {
    const archivos = await cargarArchivosIncapacidad(inc);
    if (!archivos.length) {
      contenedor.innerHTML = `<p class="nota">${inc.numArchivos ? "El documento todavía no ha llegado. Se ve cuando el celular de la persona tenga internet." : "No se adjuntó documento."}</p>`;
      return;
    }
    contenedor.innerHTML = "";
    archivos.forEach((a, i) => {
      const caja = document.createElement("div");
      caja.className = "doc-incapacidad";
      if (!a.completo) {
        caja.innerHTML = `<span class="nota">${escaparHtml(a.nombre)}: todavía se está enviando.</span>`;
        contenedor.appendChild(caja);
        return;
      }
      const url = URL.createObjectURL(blobDeArchivo(a));
      const nombre = nombreDescargaIncapacidad(inc, a, i);
      caja.innerHTML = (a.tipo === "application/pdf"
        ? `<div class="doc-pdf"><svg class="icono" aria-hidden="true"><use href="#i-informe"/></svg><span>${escaparHtml(a.nombre)}</span></div>`
        : `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Página ${i + 1} del documento"></a>`)
        + `<div class="fila-botones" style="margin:6px 0 0">
             <a class="boton pequeno" href="${url}" target="_blank" rel="noopener">Abrir</a>
             <a class="boton pequeno" href="${url}" download="${escaparHtml(nombre)}">Descargar</a>
           </div>`;
      contenedor.appendChild(caja);
    });
  } catch (err) {
    contenedor.innerHTML = `<p class="nota">No se pudo cargar el documento (${escaparHtml(err.code || err.message)}).</p>`;
  }
}

function resumenIncapacidad(inc) {
  const dias = inc.dias || diasDeIncapacidad(inc.desde, inc.hasta);
  return `${fechaLegible(inc.desde)} al ${fechaLegible(inc.hasta)} · ${dias} día${dias === 1 ? "" : "s"}`;
}
