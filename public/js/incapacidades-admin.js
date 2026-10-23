const incapAdmin = {
  lista: [],
  abierta: null
};

function escucharIncapacidadesAdmin() {
  return db.collection("incapacidades").orderBy("creadoLocal", "desc").limit(200)
    .onSnapshot((snap) => {
      const anteriores = Object.fromEntries(incapAdmin.lista.map((i) => [i.id, i._archivos]));
      incapAdmin.lista = snap.docs.map((d) => ({ ...d.data(), id: d.id, _archivos: anteriores[d.id] }));
      pintarIncapacidadesAdmin();
    }, (err) => aviso("No se pudieron cargar las incapacidades: " + err.code, "error"));
}

function incapacidadesFiltradas() {
  const filtro = $("#ia-estado").value;
  return incapAdmin.lista.filter((i) => !filtro || (i.estado || "enviada") === filtro);
}

function pintarIncapacidadesAdmin() {
  const porRevisar = incapAdmin.lista.filter((i) => (i.estado || "enviada") === "enviada").length;
  $("#menu-incapacidades-cuenta").hidden = !porRevisar;
  $("#menu-incapacidades-cuenta").textContent = porRevisar;
  $("#ia-resumen").textContent = porRevisar ? `${porRevisar} por revisar` : "Todas revisadas";

  const lista = incapacidadesFiltradas();
  $("#ia-cuerpo").innerHTML = lista.length ? lista.map((inc) => {
    const est = estadoDeIncapacidad(inc);
    return `
    <tr>
      <td style="white-space:nowrap">${escaparHtml(fechaLegible((inc.creadoLocal || "").slice(0, 10)))}</td>
      <td>${escaparHtml(inc.nombre)}</td>
      <td>${escaparHtml(fechaLegible(inc.desde))}<br><span class="nota">al ${escaparHtml(fechaLegible(inc.hasta))}</span></td>
      <td class="num">${inc.dias || diasDeIncapacidad(inc.desde, inc.hasta)}</td>
      <td>${escaparHtml(inc.tipo || "")}<br><span class="nota">${escaparHtml(inc.entidad || "")}</span></td>
      <td><span class="chip ${est.clase}">${est.texto}</span></td>
      <td style="white-space:nowrap"><button class="boton pequeno" type="button" data-incapacidad="${escaparHtml(inc.id)}">${inc.estado === "avalada" || inc.estado === "rechazada" ? "Ver" : "Revisar"}</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="vacio">No hay incapacidades.</td></tr>`;
}
$("#ia-estado").addEventListener("change", pintarIncapacidadesAdmin);

// ---------------------------------------------------------------------
//  Revisar una incapacidad
// ---------------------------------------------------------------------
$("#ia-cuerpo").addEventListener("click", (e) => {
  const id = e.target.dataset?.incapacidad;
  const inc = id && incapAdmin.lista.find((x) => x.id === id);
  if (inc) abrirIncapacidadAdmin(inc);
});

function abrirIncapacidadAdmin(inc) {
  incapAdmin.abierta = inc;
  const fila = (titulo, valor) => valor ? `<div class="dato"><span class="rev-etiqueta">${titulo}</span><span>${escaparHtml(valor)}</span></div>` : "";
  const est = estadoDeIncapacidad(inc);
  $("#ir-titulo").textContent = `Incapacidad de ${inc.nombre}`;
  $("#ir-datos").innerHTML = [
    fila("Tipo", inc.tipo),
    fila("EPS / ARL", inc.entidad),
    fila("Número de la incapacidad", inc.numero),
    fila("Desde", fechaLegible(inc.desde)),
    fila("Hasta", fechaLegible(inc.hasta)),
    fila("Días", String(inc.dias || diasDeIncapacidad(inc.desde, inc.hasta))),
    fila("Observaciones", inc.observaciones),
    fila("Registrada", inc.creadoLocal ? new Date(inc.creadoLocal).toLocaleString("es-CO") : ""),
    fila("Estado", est.texto + (inc.revisadoPor ? ` · por ${inc.revisadoPor}` : ""))
  ].join("");
  $("#ir-nota").value = inc.respuestaNota || "";
  $("#ir-estado").textContent = inc.estado === "avalada" || inc.estado === "rechazada"
    ? `Ya fue ${inc.estado}. Puedes cambiar la decisión si hace falta.` : "";
  $("#dialogo-incapacidad-admin").showModal();
  pintarArchivosIncapacidad(inc, $("#ir-documentos"));
}
$("#ir-cerrar").addEventListener("click", () => $("#dialogo-incapacidad-admin").close());

function nombreAdmin() {
  const yo = auth.currentUser;
  return admin.usuarios.find((u) => u.uid === yo?.uid)?.nombre || yo?.email || "";
}

// Al dar el aval se pone la novedad "Incapacidad" en cada día del periodo.
// No se pisan las novedades que el administrador haya escrito a mano.
async function marcarNovedadesIncapacidad(inc, poner) {
  const fechas = fechasDeIncapacidad(inc.desde, inc.hasta);
  const refs = fechas.map((dia) => db.collection("novedades").doc(`${inc.tecnicoUid}_${dia}`));
  const actuales = await Promise.all(refs.map((r) => r.get()));
  const lote = db.batch();
  let cambios = 0;
  actuales.forEach((snap, i) => {
    const propia = snap.exists && snap.data().incapacidadId === inc.id;
    if (poner && (!snap.exists || propia)) {
      lote.set(refs[i], {
        tecnicoUid: inc.tecnicoUid, dia: fechas[i], texto: "Incapacidad",
        incapacidadId: inc.id, registradoPor: nombreAdmin(),
        actualizado: firebase.firestore.FieldValue.serverTimestamp()
      });
      cambios++;
    } else if (!poner && propia) {
      lote.delete(refs[i]);
      cambios++;
    }
  });
  if (cambios) await lote.commit();
  return cambios;
}

async function responderIncapacidad(nuevoEstado) {
  const inc = incapAdmin.abierta;
  const nota = $("#ir-nota").value.trim();
  if (nuevoEstado === "rechazada" && !nota) return aviso("Escribe en la nota por qué se rechaza.", "error");
  const botones = $$("#dialogo-incapacidad-admin .fila-botones button");
  botones.forEach((b) => (b.disabled = true));
  try {
    await db.collection("incapacidades").doc(inc.id).update({
      estado: nuevoEstado,
      respuestaNota: nota,
      revisadoPor: nombreAdmin(),
      resueltoLocal: new Date().toISOString(),
      resueltoServidor: firebase.firestore.FieldValue.serverTimestamp()
    });
    let mensaje = nuevoEstado === "avalada" ? "Incapacidad avalada." : "Incapacidad rechazada.";
    try {
      const dias = await marcarNovedadesIncapacidad(inc, nuevoEstado === "avalada");
      if (nuevoEstado === "avalada" && dias) mensaje += ` Se puso la novedad en ${dias} día(s) de las marcaciones.`;
    } catch (err) {
      mensaje += " No se pudieron poner las novedades en las marcaciones: " + err.message;
    }
    $("#dialogo-incapacidad-admin").close();
    aviso(mensaje, "ok");
  } catch (err) {
    aviso("No se pudo guardar: " + err.message, "error");
  } finally {
    botones.forEach((b) => (b.disabled = false));
  }
}
$("#ir-avalar").addEventListener("click", () => responderIncapacidad("avalada"));
$("#ir-rechazar").addEventListener("click", () => responderIncapacidad("rechazada"));

// Borrar la incapacidad con su documento (para liberar espacio o si quedó repetida)
$("#ir-borrar").addEventListener("click", async () => {
  const inc = incapAdmin.abierta;
  if (!confirm(`¿Borrar la incapacidad de ${inc.nombre} (${resumenIncapacidad(inc)}) con su documento? No se puede deshacer.`)) return;
  try {
    await marcarNovedadesIncapacidad(inc, false);
    const archivos = await db.collection("incapacidades").doc(inc.id).collection("archivos").get();
    const lote = db.batch();
    archivos.docs.forEach((d) => lote.delete(d.ref));
    lote.delete(db.collection("incapacidades").doc(inc.id));
    await lote.commit();
    $("#dialogo-incapacidad-admin").close();
    aviso("Incapacidad borrada.", "ok");
  } catch (err) {
    aviso("No se pudo borrar: " + err.message, "error");
  }
});

// ---------------------------------------------------------------------
//  Exportar a Excel
// ---------------------------------------------------------------------
function csvIncapacidades(lista) {
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const encabezado = ["Registrada", "Nombre", "Tipo", "EPS / ARL", "Número", "Desde", "Hasta", "Días",
    "Estado", "Revisó", "Nota de la empresa", "Observaciones"];
  const filas = lista.map((i) => [
    fechaLegible((i.creadoLocal || "").slice(0, 10)), i.nombre, i.tipo, i.entidad, i.numero,
    fechaLegible(i.desde), fechaLegible(i.hasta), i.dias || diasDeIncapacidad(i.desde, i.hasta),
    estadoDeIncapacidad(i).texto, i.revisadoPor, i.respuestaNota, i.observaciones
  ].map(celda).join(";"));
  return "﻿" + [encabezado.map(celda).join(";"), ...filas].join("\r\n");
}

$("#ia-csv").addEventListener("click", () => {
  const lista = incapacidadesFiltradas();
  if (!lista.length) return aviso("No hay incapacidades para exportar.");
  descargarTexto(csvIncapacidades(lista), `incapacidades_siatet_${hoyISO()}.csv`);
});
