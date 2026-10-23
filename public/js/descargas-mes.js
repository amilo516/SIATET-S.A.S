const NOMBRES_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// "2026-10" -> desde el 1 de octubre hasta el 1 de noviembre (hora de Colombia del equipo)
function rangoDelMes(mes) {
  const [ano, m] = mes.split("-").map(Number);
  return { desde: new Date(ano, m - 1, 1).toISOString(), hasta: new Date(ano, m, 1).toISOString(), ano, m };
}

function mesValido(valor) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor || "");
}

// Lee del servidor todos los documentos guardados en ese mes
async function documentosDelMes(coleccion, mes) {
  const { desde, hasta } = rangoDelMes(mes);
  const snap = await db.collection(coleccion)
    .where("creadoLocal", ">=", desde).where("creadoLocal", "<", hasta)
    .orderBy("creadoLocal").get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

// Evita nombres repetidos dentro del zip
function nombreUnico(nombre, usados) {
  let final = nombre, n = 2;
  while (usados.has(final)) final = nombre.replace(/\.pdf$/, `_${n++}.pdf`);
  usados.add(final);
  return final;
}

async function guardarZip(zip, nombreArchivo) {
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombreArchivo;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 60000);
  return blob.size;
}

const tamanoLegible = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

// Controla el botón y el texto de avance mientras se arma el zip
function avanceDescarga(boton, salida) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  return {
    mostrar: (texto) => (salida.textContent = texto),
    terminar: (texto) => {
      boton.disabled = false;
      boton.textContent = textoOriginal;
      salida.textContent = texto || "";
    }
  };
}

// ---------------------------------------------------------------------
//  Informes
// ---------------------------------------------------------------------
$("#dm-informes").addEventListener("click", async () => {
  const mes = $("#dm-mes-informes").value;
  if (!mesValido(mes)) return aviso("Elige el mes que quieres descargar.", "error");
  if (!navigator.onLine) return aviso("Necesitas internet para descargar los informes del mes.", "error");
  const avance = avanceDescarga($("#dm-informes"), $("#dm-avance-informes"));
  const { ano, m } = rangoDelMes(mes);
  const nombreMes = `${NOMBRES_MESES[m - 1]} de ${ano}`;
  try {
    avance.mostrar(`Buscando los informes de ${nombreMes}…`);
    const lista = await documentosDelMes("informes", mes);
    if (!lista.length) return avance.terminar(`No hay informes guardados en ${nombreMes}.`);

    const zip = new JSZip();
    const usados = new Set(), errores = [];
    for (let k = 0; k < lista.length; k++) {
      const informe = lista[k];
      avance.mostrar(`Preparando el PDF ${k + 1} de ${lista.length}…`);
      try {
        const doc = await prepararPdf(informe);
        const prefijo = informe.estado === "pendiente" ? "PENDIENTE_" : "";
        zip.file(nombreUnico(prefijo + nombreArchivoPdf(informe), usados), doc.output("arraybuffer"));
      } catch (err) {
        errores.push(`${informe.numero || informe.id}: ${err.message}`);
      }
      // Deja respirar a la página para que el texto de avance se vea
      if (k % 5 === 4) await new Promise((r) => setTimeout(r, 0));
    }
    zip.file(`informes_${mes}.csv`, csvInformes(lista));
    if (errores.length) zip.file("no_se_pudieron_generar.txt", errores.join("\r\n"));

    avance.mostrar("Comprimiendo…");
    const tamano = await guardarZip(zip, `Informes_SIATET_${mes}.zip`);
    avance.terminar(`${lista.length - errores.length} informe(s) de ${nombreMes} descargados (${tamanoLegible(tamano)}).`
      + (errores.length ? ` ${errores.length} no se pudieron generar; el detalle va dentro del zip.` : ""));
  } catch (err) {
    console.error(err);
    avance.terminar("");
    aviso("No se pudieron descargar los informes: " + err.message, "error");
  }
});

// ---------------------------------------------------------------------
//  Permisos laborales
// ---------------------------------------------------------------------
$("#dm-permisos").addEventListener("click", async () => {
  const mes = $("#dm-mes-permisos").value;
  if (!mesValido(mes)) return aviso("Elige el mes que quieres descargar.", "error");
  if (!navigator.onLine) return aviso("Necesitas internet para descargar los permisos del mes.", "error");
  const avance = avanceDescarga($("#dm-permisos"), $("#dm-avance-permisos"));
  const { ano, m } = rangoDelMes(mes);
  const nombreMes = `${NOMBRES_MESES[m - 1]} de ${ano}`;
  try {
    avance.mostrar(`Buscando los permisos de ${nombreMes}…`);
    const lista = await documentosDelMes("permisos", mes);
    if (!lista.length) return avance.terminar(`No hay permisos solicitados en ${nombreMes}.`);

    const logo = await cargarLogoPermiso(admin.vigente.logo);
    const zip = new JSZip();
    const usados = new Set();
    lista.forEach((p, k) => {
      avance.mostrar(`Preparando el PDF ${k + 1} de ${lista.length}…`);
      const persona = (p.nombre || "sin_nombre").replace(/[^\wÁÉÍÓÚÑáéíóúñ-]+/g, "_");
      const estado = estadoDePermiso(p).texto.toUpperCase().replace(/\s+/g, "_");
      const nombre = `Permiso_${String(p.desde || "").slice(0, 10)}_${persona}_${estado}.pdf`;
      zip.file(nombreUnico(nombre, usados), generarPdfPermiso(p, logo).output("arraybuffer"));
    });
    zip.file(`permisos_${mes}.csv`, csvPermisos(lista));

    avance.mostrar("Comprimiendo…");
    const tamano = await guardarZip(zip, `Permisos_SIATET_${mes}.zip`);
    avance.terminar(`${lista.length} permiso(s) de ${nombreMes} descargados (${tamanoLegible(tamano)}).`);
  } catch (err) {
    console.error(err);
    avance.terminar("");
    aviso("No se pudieron descargar los permisos: " + err.message, "error");
  }
});

// El mes que viene marcado es el actual
$("#dm-mes-informes").value = $("#dm-mes-permisos").value = hoyISO().slice(0, 7);
