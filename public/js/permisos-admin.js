const permisosAdmin = {
  lista: [],
  abierto: null,     // solicitud que se está viendo
  firma: null
};

function escucharPermisosAdmin() {
  return db.collection("permisos").orderBy("creadoLocal", "desc").limit(200)
    .onSnapshot((snap) => {
      permisosAdmin.lista = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      pintarPermisosAdmin();
    }, (err) => aviso("No se pudieron cargar los permisos: " + err.code, "error"));
}

function permisosFiltrados() {
  const estado = $("#pa-estado").value;
  return permisosAdmin.lista.filter((p) => !estado || (p.estado || "solicitado") === estado);
}

function pintarPermisosAdmin() {
  const sinResponder = permisosAdmin.lista.filter((p) => (p.estado || "solicitado") === "solicitado").length;
  // Aviso en el menú con las solicitudes que faltan por responder
  $("#menu-permisos-cuenta").hidden = !sinResponder;
  $("#menu-permisos-cuenta").textContent = sinResponder;
  $("#pa-resumen").textContent = sinResponder ? `${sinResponder} sin responder` : "Todas respondidas";

  const lista = permisosFiltrados();
  $("#pa-cuerpo").innerHTML = lista.length ? lista.map((p) => {
    const est = estadoDePermiso(p);
    return `
    <tr>
      <td style="white-space:nowrap">${escaparHtml(fechaLegible(p.fechaElaboracion))}</td>
      <td>${escaparHtml(p.nombre)}<br><span class="nota">${escaparHtml(p.cargo || "")}</span></td>
      <td>${escaparHtml(fechaHoraLegible(p.desde))}<br><span class="nota">hasta ${escaparHtml(fechaHoraLegible(p.hasta))}</span></td>
      <td>${escaparHtml(tiempoDePermiso(p, p.estado === "aprobado"))}</td>
      <td><span class="chip ${est.clase}">${est.texto}</span></td>
      <td style="white-space:nowrap"><button class="boton pequeno" type="button" data-permiso="${escaparHtml(p.id)}">${p.estado === "aprobado" || p.estado === "negado" ? "Ver" : "Responder"}</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="vacio">No hay solicitudes de permiso.</td></tr>`;
}
$("#pa-estado").addEventListener("change", pintarPermisosAdmin);

// ---------------------------------------------------------------------
//  Ver y responder una solicitud
// ---------------------------------------------------------------------
$("#pa-cuerpo").addEventListener("click", (e) => {
  const id = e.target.dataset?.permiso;
  const p = id && permisosAdmin.lista.find((x) => x.id === id);
  if (!p) return;
  permisosAdmin.abierto = p;
  const fila = (titulo, valor) => valor ? `<div class="dato"><span class="rev-etiqueta">${titulo}</span><span>${escaparHtml(valor)}</span></div>` : "";
  $("#pr-titulo").textContent = `Permiso de ${p.nombre}`;
  $("#pr-datos").innerHTML = [
    fila("Cargo", p.cargo),
    fila("Fecha de elaboración", fechaLegible(p.fechaElaboracion)),
    fila("Desde", fechaHoraLegible(p.desde)),
    fila("Hasta", fechaHoraLegible(p.hasta)),
    fila("Tiempo pedido", tiempoDePermiso(p)),
    fila("Descripción", p.descripcion),
    fila("Observaciones", p.observaciones),
    fila("Asume la responsabilidad fuera de la empresa", p.autorizaResponsabilidad === "SI" ? "Sí" : "No"),
    fila("Autoriza el descuento en nómina", p.autorizaDescuento === "SI" ? "Sí" : "No (debe presentar justificación en 3 días hábiles)")
  ].join("") + (p.firmaTrabajador ? `<div class="dato"><span class="rev-etiqueta">Firma del trabajador</span><img class="rev-firma" src="${p.firmaTrabajador}" alt="Firma del trabajador"></div>` : "");

  $("#pr-dias").value = p.diasConcedidos ?? p.dias ?? 0;
  $("#pr-horas").value = p.horasConcedidas ?? p.horas ?? 0;
  $("#pr-nombre").value = p.empleadorNombre || quienResponde();
  $("#pr-nota").value = p.respuestaNota || "";
  $("#pr-estado").textContent = p.estado === "aprobado" || p.estado === "negado"
    ? `Ya fue ${p.estado}. Puedes cambiar la respuesta si hace falta.` : "";
  $("#dialogo-respuesta").showModal();

  if (!permisosAdmin.firma) permisosAdmin.firma = crearLienzoFirma($("#pr-lienzo"));
  permisosAdmin.firma.limpiar();
  requestAnimationFrame(() => {
    permisosAdmin.firma.ajustar();
    // Se propone la última firma usada en este equipo para no firmar cada vez
    try {
      const guardada = JSON.parse(localStorage.getItem("firma_empleador") || "null");
      if (guardada && guardada.length) {
        permisosAdmin.firma.fromData(guardada);
        $("#pr-lienzo").classList.add("firmado");
      }
    } catch (err) { /* sin firma guardada */ }
  });
});
$("#pr-cerrar").addEventListener("click", () => $("#dialogo-respuesta").close());
$("#pr-borrar-firma").addEventListener("click", () => permisosAdmin.firma.limpiar());
$("#pr-pdf").addEventListener("click", () =>
  descargarPdfPermiso(permisosAdmin.abierto, admin.vigente.logo).catch((err) => aviso(err.message, "error")));

function quienResponde() {
  const yo = auth.currentUser;
  return admin.usuarios.find((u) => u.uid === yo?.uid)?.nombre || "";
}

async function responderPermiso(estado) {
  const p = permisosAdmin.abierto;
  const nombre = $("#pr-nombre").value.trim();
  const nota = $("#pr-nota").value.trim();
  if (!nombre) return aviso("Escribe el nombre de quien responde por la empresa.", "error");
  if (permisosAdmin.firma.isEmpty()) return aviso("Falta la firma del empleador.", "error");
  if (estado === "negado" && !nota) return aviso("Escribe en la nota por qué se niega el permiso.", "error");
  try {
    localStorage.setItem("firma_empleador", JSON.stringify(permisosAdmin.firma.toData()));
    await db.collection("permisos").doc(p.id).update({
      estado,
      diasConcedidos: estado === "aprobado" ? Number($("#pr-dias").value || 0) : 0,
      horasConcedidas: estado === "aprobado" ? Number($("#pr-horas").value || 0) : 0,
      empleadorNombre: nombre,
      firmaEmpleador: permisosAdmin.firma.toDataURL("image/png"),
      respuestaNota: nota,
      resueltoLocal: new Date().toISOString(),
      resueltoServidor: firebase.firestore.FieldValue.serverTimestamp()
    });
    $("#dialogo-respuesta").close();
    aviso(`Permiso ${estado}.`, "ok");
  } catch (err) {
    aviso("No se pudo guardar la respuesta: " + err.message, "error");
  }
}
$("#pr-aprobar").addEventListener("click", () => responderPermiso("aprobado"));
$("#pr-negar").addEventListener("click", () => responderPermiso("negado"));

function csvPermisos(lista) {
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const encabezado = ["Fecha de elaboración", "Nombre", "Cargo", "Desde", "Hasta", "Días pedidos", "Horas pedidas",
    "Días concedidos", "Horas concedidas", "Estado", "Descuento en nómina", "Descripción", "Observaciones", "Respuesta de la empresa", "Respondió"];
  const filas = lista.map((p) => [
    fechaLegible(p.fechaElaboracion), p.nombre, p.cargo, fechaHoraLegible(p.desde), fechaHoraLegible(p.hasta), p.dias, p.horas,
    p.estado === "aprobado" ? p.diasConcedidos : "", p.estado === "aprobado" ? p.horasConcedidas : "",
    estadoDePermiso(p).texto, p.autorizaDescuento, p.descripcion, p.observaciones, p.respuestaNota, p.empleadorNombre
  ].map(celda).join(";"));
  return "﻿" + [encabezado.map(celda).join(";"), ...filas].join("\r\n");
}

$("#pa-csv").addEventListener("click", () => {
  const lista = permisosFiltrados();
  if (!lista.length) return aviso("No hay permisos para exportar.");
  descargarTexto(csvPermisos(lista), `permisos_siatet_${hoyISO()}.csv`);
});
