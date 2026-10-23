const incapacidades = {
  lista: [],
  archivos: []      // archivos ya preparados del formulario { nombre, tipo, datos }
};

function escucharIncapacidades() {
  return db.collection("incapacidades").where("tecnicoUid", "==", estado.usuario.uid).limit(60)
    .onSnapshot({ includeMetadataChanges: true }, (snap) => {
      const anteriores = Object.fromEntries(incapacidades.lista.map((i) => [i.id, i._archivos]));
      incapacidades.lista = snap.docs
        .map((d) => ({ ...d.data(), id: d.id, _pendiente: d.metadata.hasPendingWrites, _archivos: anteriores[d.id] }))
        .sort((a, b) => (b.creadoLocal || "").localeCompare(a.creadoLocal || ""));
      pintarIncapacidades();
    }, (err) => console.warn("Sin acceso a las incapacidades:", err.code));
}

// ---------------------------------------------------------------------
//  Lista
// ---------------------------------------------------------------------
function abrirIncapacidades() {
  mostrar("incapacidades");
  menu.marcar("incapacidades");
  pintarIncapacidades();
}

function pintarIncapacidades() {
  const ul = $("#inc-lista");
  if (!incapacidades.lista.length) {
    ul.innerHTML = `<li class="vacio">No has registrado incapacidades.</li>`;
    return;
  }
  ul.innerHTML = incapacidades.lista.map((inc) => {
    const est = estadoDeIncapacidad(inc);
    return `
    <li><button class="informe-item estado-${est.clase}" data-id="${escaparHtml(inc.id)}">
      <span class="num">${escaparHtml(resumenIncapacidad(inc))}</span>
      <span class="chip ${est.clase}">${est.texto}</span>
      <span class="det">${escaparHtml([inc.tipo, inc.entidad].filter(Boolean).join(" · "))}</span>
    </button></li>`;
  }).join("");
}

$("#inc-lista").addEventListener("click", (e) => {
  const boton = e.target.closest(".informe-item");
  const inc = boton && incapacidades.lista.find((x) => x.id === boton.dataset.id);
  if (!inc) return;
  const est = estadoDeIncapacidad(inc);
  $("#idl-titulo").textContent = `Incapacidad · ${est.texto}`;
  $("#idl-detalle").textContent = [
    resumenIncapacidad(inc),
    inc.tipo, inc.entidad, inc.numero ? `N.º ${inc.numero}` : "", inc.observaciones,
    inc.estado === "avalada" ? `Avalada por ${inc.revisadoPor || "la empresa"}` : "",
    inc.estado === "rechazada" ? `Rechazada por ${inc.revisadoPor || "la empresa"}` : "",
    inc.respuestaNota ? `Nota de la empresa: ${inc.respuestaNota}` : "",
    !inc.estado || inc.estado === "enviada" ? "Aún no ha sido revisada." : ""
  ].filter(Boolean).join(" · ");
  pintarArchivosIncapacidad(inc, $("#idl-documentos"));
  $("#idl-retirar").hidden = inc.estado === "avalada" || inc.estado === "rechazada";
  $("#idl-retirar").onclick = async () => {
    if (!confirm("¿Retirar esta incapacidad? Se borra con su documento y la empresa ya no la verá.")) return;
    $("#dialogo-incapacidad").close();
    try {
      const archivos = await db.collection("incapacidades").doc(inc.id).collection("archivos")
        .where("tecnicoUid", "==", inc.tecnicoUid).get();
      const lote = db.batch();
      archivos.docs.forEach((d) => lote.delete(d.ref));
      lote.delete(db.collection("incapacidades").doc(inc.id));
      await lote.commit();
      aviso("Incapacidad retirada.", "ok");
    } catch (err) {
      aviso("No se pudo retirar: " + err.message, "error");
    }
  };
  $("#dialogo-incapacidad").showModal();
});
$("#idl-cerrar").addEventListener("click", () => $("#dialogo-incapacidad").close());

// ---------------------------------------------------------------------
//  Formulario
// ---------------------------------------------------------------------
$("#inc-nueva").addEventListener("click", () => {
  const form = $("#form-incapacidad");
  form.reset();
  $$(".invalido", form).forEach((el) => el.classList.remove("invalido"));
  $("#inc-nombre").value = estado.perfil.nombre || "";
  $("#inc-tipo").innerHTML = TIPOS_INCAPACIDAD.map((t) => `<option>${escaparHtml(t)}</option>`).join("");
  incapacidades.archivos = [];
  pintarArchivosElegidos();
  contarDias();
  mostrar("incapacidad");
});
$("#inc-cancelar").addEventListener("click", abrirIncapacidades);

function contarDias() {
  const dias = diasDeIncapacidad($("#inc-desde").value, $("#inc-hasta").value);
  $("#inc-dias").textContent = dias > 0 ? `${dias} día${dias === 1 ? "" : "s"} de incapacidad` : "";
}
$("#inc-desde").addEventListener("change", () => {
  if (!$("#inc-hasta").value || $("#inc-hasta").value < $("#inc-desde").value) $("#inc-hasta").value = $("#inc-desde").value;
  contarDias();
});
$("#inc-hasta").addEventListener("change", contarDias);

function pintarArchivosElegidos() {
  const ul = $("#inc-archivos");
  const total = incapacidades.archivos.reduce((s, a) => s + a.datos.length, 0);
  ul.innerHTML = incapacidades.archivos.map((a, i) => `
    <li class="archivo-elegido">
      ${a.tipo === "application/pdf"
        ? `<span class="archivo-icono">PDF</span>`
        : `<img src="data:${a.tipo};base64,${a.datos}" alt="">`}
      <span class="archivo-nombre">${escaparHtml(a.nombre)}<br><span class="nota">${pesoLegible(a.datos.length)}</span></span>
      <button class="boton pequeno" type="button" data-quitar="${i}">Quitar</button>
    </li>`).join("");
  $("#inc-archivos-nota").textContent = incapacidades.archivos.length
    ? `${incapacidades.archivos.length} archivo(s) · ${pesoLegible(total)}`
    : "Adjunta el PDF escaneado o una foto de cada página. Puedes tomar la foto con la cámara.";
}

$("#inc-archivos").addEventListener("click", (e) => {
  const i = e.target.dataset?.quitar;
  if (i === undefined) return;
  incapacidades.archivos.splice(Number(i), 1);
  pintarArchivosElegidos();
});

async function agregarArchivos(lista) {
  for (const archivo of lista) {
    if (incapacidades.archivos.length >= LIMITES_INCAPACIDAD.archivos) {
      aviso(`Máximo ${LIMITES_INCAPACIDAD.archivos} archivos por incapacidad.`, "error");
      break;
    }
    try {
      $("#inc-archivos-nota").textContent = `Preparando ${archivo.name}…`;
      const listo = await prepararArchivoIncapacidad(archivo);
      const total = incapacidades.archivos.reduce((s, a) => s + a.datos.length, 0) + listo.datos.length;
      if (total > LIMITES_INCAPACIDAD.totalCaracteres) {
        aviso("Los archivos pesan demasiado juntos (máx. 5 MB). Quita alguno o envía fotos en vez del PDF.", "error");
        break;
      }
      incapacidades.archivos.push(listo);
    } catch (err) {
      aviso(err.message, "error");
    }
  }
  pintarArchivosElegidos();
}
$("#inc-elegir").addEventListener("change", (e) => { agregarArchivos([...e.target.files]); e.target.value = ""; });
$("#inc-camara").addEventListener("change", (e) => { agregarArchivos([...e.target.files]); e.target.value = ""; });

$("#form-incapacidad").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  $$(".invalido", form).forEach((el) => el.classList.remove("invalido"));
  const faltan = $$("[required]", form).filter((el) => !el.value.trim());
  faltan.forEach((el) => el.classList.add("invalido"));
  if (faltan.length) {
    faltan[0].focus();
    return aviso("Completa los campos marcados con *.", "error");
  }
  const desde = $("#inc-desde").value, hasta = $("#inc-hasta").value;
  if (hasta < desde) {
    $("#inc-hasta").classList.add("invalido");
    return aviso("La fecha final no puede ser antes de la inicial.", "error");
  }
  const dias = diasDeIncapacidad(desde, hasta);
  if (dias > 180) return aviso("Revisa las fechas: son más de 180 días.", "error");
  if (!incapacidades.archivos.length) return aviso("Adjunta el documento de la incapacidad.", "error");

  const ref = db.collection("incapacidades").doc();
  const lote = db.batch();
  lote.set(ref, {
    estado: "enviada",
    tecnicoUid: estado.usuario.uid,
    tecnicoCorreo: estado.usuario.email,
    nombre: $("#inc-nombre").value.trim(),
    tipo: $("#inc-tipo").value,
    entidad: $("#inc-entidad").value.trim(),
    numero: $("#inc-numero").value.trim(),
    desde, hasta, dias,
    observaciones: $("#inc-observaciones").value.trim(),
    numArchivos: incapacidades.archivos.length,
    creadoLocal: new Date().toISOString(),
    creadoServidor: firebase.firestore.FieldValue.serverTimestamp()
  });
  trozosDeArchivos(incapacidades.archivos, estado.usuario.uid)
    .forEach((t) => lote.set(ref.collection("archivos").doc(), { ...t, incapacidadId: ref.id }));
  lote.commit().catch((err) => {
    console.error(err);
    aviso(`La incapacidad no se pudo enviar (${err.code}). Avísale al administrador.`, "error");
  });

  incapacidades.archivos = [];
  abrirIncapacidades();
  aviso(navigator.onLine
    ? "Incapacidad enviada. Aquí verás cuando la empresa le dé el aval."
    : "Incapacidad guardada. Se envía sola cuando tengas internet.", "ok");
});
