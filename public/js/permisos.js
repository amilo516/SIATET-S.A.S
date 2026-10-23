const permisos = {
  lista: [],
  firma: null      // recuadro de firma del formulario
};

function escucharPermisos() {
  return db.collection("permisos").where("tecnicoUid", "==", estado.usuario.uid).limit(60)
    .onSnapshot({ includeMetadataChanges: true }, (snap) => {
      permisos.lista = snap.docs
        .map((d) => ({ ...d.data(), id: d.id, _pendiente: d.metadata.hasPendingWrites }))
        .sort((a, b) => (b.creadoLocal || "").localeCompare(a.creadoLocal || ""));
      pintarPermisos();
    }, (err) => console.warn("Sin acceso a los permisos:", err.code));
}

// ---------------------------------------------------------------------
//  Lista de solicitudes
// ---------------------------------------------------------------------
function abrirPermisos() {
  mostrar("permisos");
  menu.marcar("permisos");
  pintarPermisos();
}

function pintarPermisos() {
  const ul = $("#per-lista");
  if (!permisos.lista.length) {
    ul.innerHTML = `<li class="vacio">Aún no has pedido permisos.</li>`;
    return;
  }
  ul.innerHTML = permisos.lista.map((p) => {
    const est = estadoDePermiso(p);
    return `
    <li><button class="informe-item estado-${est.clase}" data-id="${escaparHtml(p.id)}">
      <span class="num">${escaparHtml(fechaHoraLegible(p.desde))} · ${escaparHtml(tiempoDePermiso(p, p.estado === "aprobado"))}</span>
      <span class="chip ${est.clase}">${est.texto}</span>
      <span class="det">${escaparHtml(p.descripcion || "")}</span>
    </button></li>`;
  }).join("");
}

$("#per-lista").addEventListener("click", (e) => {
  const boton = e.target.closest(".informe-item");
  const p = boton && permisos.lista.find((x) => x.id === boton.dataset.id);
  if (!p) return;
  const est = estadoDePermiso(p);
  $("#pdl-titulo").textContent = `Permiso · ${est.texto}`;
  $("#pdl-detalle").textContent = [
    `Desde ${fechaHoraLegible(p.desde)} hasta ${fechaHoraLegible(p.hasta)}`,
    p.estado === "aprobado" ? `Concedido: ${tiempoDePermiso(p, true)}` : `Pedido: ${tiempoDePermiso(p)}`,
    p.descripcion,
    p.respuestaNota ? `Respuesta de la empresa: ${p.respuestaNota}` : "",
    p.estado === "solicitado" || !p.estado ? "Aún no ha sido respondido." : ""
  ].filter(Boolean).join(" · ");
  $("#pdl-pdf").onclick = () => descargarPdfPermiso(p, estado.formato.logo).catch((err) => aviso(err.message, "error"));
  $("#pdl-retirar").hidden = p.estado === "aprobado" || p.estado === "negado";
  $("#pdl-retirar").onclick = async () => {
    if (!confirm("¿Retirar esta solicitud de permiso? Se borra y la empresa ya no la verá.")) return;
    $("#dialogo-permiso").close();
    try {
      await db.collection("permisos").doc(p.id).delete();
      aviso("Solicitud retirada.", "ok");
    } catch (err) {
      aviso("No se pudo retirar: " + err.message, "error");
    }
  };
  $("#dialogo-permiso").showModal();
});
$("#pdl-cerrar").addEventListener("click", () => $("#dialogo-permiso").close());

// ---------------------------------------------------------------------
//  Formulario
// ---------------------------------------------------------------------
$("#per-nuevo").addEventListener("click", () => {
  const form = $("#form-permiso");
  form.reset();
  $$(".invalido", form).forEach((el) => el.classList.remove("invalido"));
  $("#per-nombre").value = estado.perfil.nombre || "";
  $("#per-cargo").value = localStorage.getItem(`cargo_${estado.usuario.uid}`) || "";
  $("#per-elaboracion").value = hoyISO();
  if (!permisos.firma) permisos.firma = crearLienzoFirma($("#per-lienzo"));
  permisos.firma.limpiar();
  mostrar("permiso");
  requestAnimationFrame(() => permisos.firma.ajustar());
});
$("#per-cancelar").addEventListener("click", abrirPermisos);
$("#per-borrar-firma").addEventListener("click", () => permisos.firma.limpiar());
window.addEventListener("resize", () => {
  if (permisos.firma && !$("#pantalla-permiso").hidden) permisos.firma.ajustar();
});

// Sugiere los días y las horas a partir de las fechas (se pueden cambiar)
function sugerirTiempo() {
  const desde = new Date($("#per-desde").value), hasta = new Date($("#per-hasta").value);
  if (isNaN(desde) || isNaN(hasta) || hasta <= desde) return;
  const horas = (hasta - desde) / 3600000;
  const mismoDia = $("#per-desde").value.slice(0, 10) === $("#per-hasta").value.slice(0, 10);
  $("#per-dias").value = mismoDia ? 0 : Math.round(horas / 24);
  $("#per-horas").value = mismoDia ? Math.round(horas * 2) / 2 : 0;
}
$("#per-desde").addEventListener("change", sugerirTiempo);
$("#per-hasta").addEventListener("change", sugerirTiempo);

$("#form-permiso").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  $$(".invalido", form).forEach((el) => el.classList.remove("invalido"));
  const faltan = $$("[required]", form).filter((el) => el.type !== "radio" && !el.value.trim());
  faltan.forEach((el) => el.classList.add("invalido"));
  if (faltan.length) {
    faltan[0].focus();
    return aviso("Completa los campos marcados con *.", "error");
  }
  const desde = $("#per-desde").value, hasta = $("#per-hasta").value;
  if (hasta <= desde) {
    $("#per-hasta").classList.add("invalido");
    return aviso("La fecha y hora de “Hasta” debe ser después de “Desde”.", "error");
  }
  const dias = Number($("#per-dias").value || 0), horas = Number($("#per-horas").value || 0);
  if (dias <= 0 && horas <= 0) return aviso("Escribe cuántos días u horas necesitas.", "error");
  const responsabilidad = form.elements["per-responsabilidad"].value;
  const descuento = form.elements["per-descuento"].value;
  if (!responsabilidad || !descuento) return aviso("Marca SÍ o NO en las dos autorizaciones.", "error");
  if (permisos.firma.isEmpty()) return aviso("Falta tu firma.", "error");

  const cargo = $("#per-cargo").value.trim();
  localStorage.setItem(`cargo_${estado.usuario.uid}`, cargo);
  db.collection("permisos").doc().set({
    estado: "solicitado",
    tecnicoUid: estado.usuario.uid,
    tecnicoCorreo: estado.usuario.email,
    nombre: $("#per-nombre").value.trim(),
    cargo,
    fechaElaboracion: $("#per-elaboracion").value,
    desde, hasta, dias, horas,
    descripcion: $("#per-descripcion").value.trim(),
    observaciones: $("#per-observaciones").value.trim(),
    autorizaResponsabilidad: responsabilidad,
    autorizaDescuento: descuento,
    firmaTrabajador: permisos.firma.toDataURL("image/png"),
    creadoLocal: new Date().toISOString(),
    creadoServidor: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((err) => {
    console.error(err);
    aviso(`La solicitud no se pudo enviar (${err.code}). Avísale al administrador.`, "error");
  });

  abrirPermisos();
  aviso(descuento === "NO"
    ? "Solicitud enviada. Como marcaste NO al descuento, presenta la justificación en 3 días hábiles."
    : "Solicitud enviada. Aquí verás cuando la respondan.", "ok");
});
