const horarioAdmin = {
  marcaciones: [],
  sitios: [],
  dejarDeEscuchar: () => {}
};

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------
//  Marcaciones del personal
// ---------------------------------------------------------------------
function iniciarHorarioAdmin() {
  const hoy = hoyISO();
  $("#m-desde").value = hoy.slice(0, 8) + "01";   // primer día del mes
  $("#m-hasta").value = hoy;
  escucharMarcacionesAdmin();
  const quitarSitios = escucharSitios();
  return () => { horarioAdmin.dejarDeEscuchar(); quitarSitios(); };
}

function escucharMarcacionesAdmin() {
  horarioAdmin.dejarDeEscuchar();
  const desde = $("#m-desde").value, hasta = $("#m-hasta").value;
  if (!desde || !hasta || desde > hasta) {
    horarioAdmin.marcaciones = [];
    horarioAdmin.dejarDeEscuchar = () => {};
    return pintarMarcaciones();
  }
  horarioAdmin.dejarDeEscuchar = db.collection("marcaciones")
    .where("dia", ">=", desde).where("dia", "<=", hasta)
    .onSnapshot((snap) => {
      horarioAdmin.marcaciones = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      pintarMarcaciones();
      if ($("#dialogo-jornada").open) pintarJornada();
    }, (err) => aviso("No se pudieron cargar las marcaciones: " + err.code, "error"));
}
$("#m-desde").addEventListener("change", escucharMarcacionesAdmin);
$("#m-hasta").addEventListener("change", escucharMarcacionesAdmin);
$("#m-persona").addEventListener("change", pintarMarcaciones);

// Llena la lista de personas con los usuarios habilitados
function pintarPersonasHorario() {
  const elegido = $("#m-persona").value;
  $("#m-persona").innerHTML = `<option value="">Todas</option>` + admin.usuarios.map((u) =>
    `<option value="${escaparHtml(u.uid)}">${escaparHtml(u.nombre)}</option>`).join("");
  $("#m-persona").value = elegido;
  const enDialogo = $("#j-persona").value;
  $("#j-persona").innerHTML = admin.usuarios.map((u) =>
    `<option value="${escaparHtml(u.uid)}">${escaparHtml(u.nombre)}</option>`).join("");
  if (enDialogo) $("#j-persona").value = enDialogo;
}

// Texto que describe cómo se hizo una marcación
function origenMarcacion(m) {
  const como = m.metodo === "qr" ? "QR" : m.metodo === "admin" ? "Agregada por el administrador" : "Sin QR";
  const donde = m.metodo === "admin" ? "" : m.sitioNombre || m.nota;
  return como + (donde ? " · " + donde : "") + (m.corregido && m.metodo !== "admin" ? " · corregida" : "");
}

// Una fila por persona y día: primera entrada, última salida y horas trabajadas
function jornadas() {
  const persona = $("#m-persona").value;
  const grupos = new Map();
  horarioAdmin.marcaciones
    .filter((m) => !persona || m.tecnicoUid === persona)
    .forEach((m) => {
      const clave = `${m.dia}|${m.tecnicoUid}`;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(m);
    });

  return [...grupos.values()].map((lista) => {
    lista.sort((a, b) => (a.fechaLocal || "").localeCompare(b.fechaLocal || ""));
    let minutos = 0, abierta = null, sueltas = 0;
    lista.forEach((m) => {
      if (m.tipo === "entrada") {
        if (abierta) sueltas++; else abierta = m.fechaLocal;
      } else if (abierta) {
        minutos += (new Date(m.fechaLocal) - new Date(abierta)) / 60000;
        abierta = null;
      } else sueltas++;
    });
    const entrada = lista.find((m) => m.tipo === "entrada");
    const salida = [...lista].reverse().find((m) => m.tipo === "salida");
    const ultima = lista[lista.length - 1];
    return {
      dia: lista[0].dia,
      uid: lista[0].tecnicoUid,
      nombre: admin.usuarios.find((u) => u.uid === lista[0].tecnicoUid)?.nombre || lista[0].tecnicoNombre || "Sin nombre",
      entrada: entrada ? horaCorta(entrada.fechaLocal) : "",
      salida: salida && ultima.tipo === "salida" ? horaCorta(salida.fechaLocal) : "",
      minutos: Math.max(0, Math.round(minutos)),
      faltaSalida: !!abierta,
      revisar: sueltas > 0,
      detalle: lista.map((m) => `${m.tipo === "entrada" ? "Entrada" : "Salida"} ${horaCorta(m.fechaLocal)} · ${origenMarcacion(m)}`)
    };
  }).sort((a, b) => b.dia.localeCompare(a.dia) || a.nombre.localeCompare(b.nombre));
}

function horasLegibles(minutos) {
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
}

function pintarMarcaciones() {
  const filas = jornadas();
  const total = filas.reduce((t, f) => t + f.minutos, 0);
  $("#m-resumen").textContent = filas.length
    ? `${filas.length} jornada(s) · ${horasLegibles(total)} en total`
    : "";
  $("#m-cuerpo").innerHTML = filas.length ? filas.map((f) => `
    <tr>
      <td style="white-space:nowrap">${escaparHtml(fechaLegible(f.dia))}</td>
      <td>${escaparHtml(f.nombre)}</td>
      <td style="white-space:nowrap"><strong>${horasLegibles(f.minutos)}</strong>${f.revisar ? ' <span class="etiqueta">Revisar</span>' : ""}</td>
      <td style="white-space:nowrap">${escaparHtml(f.entrada || "—")}</td>
      <td style="white-space:nowrap">${f.faltaSalida ? '<span class="etiqueta">Falta salida</span>' : escaparHtml(f.salida || "—")}</td>
      <td><button class="boton pequeno" type="button" data-corregir="${escaparHtml(f.uid)}|${escaparHtml(f.dia)}">Corregir</button></td>
      <td class="nota" style="white-space:nowrap">${f.detalle.map(escaparHtml).join("<br>")}</td>
    </tr>`).join("") : `<tr><td colspan="7" class="vacio">No hay marcaciones en estas fechas.</td></tr>`;
}

$("#m-csv").addEventListener("click", () => {
  const filas = jornadas();
  if (!filas.length) return aviso("No hay marcaciones para exportar.");
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = filas.map((f) => [
    fechaLegible(f.dia), f.nombre, f.entrada, f.salida,
    Math.floor(f.minutos / 60), f.minutos % 60,         // horas y minutos en números enteros
    f.faltaSalida ? "Falta salida" : f.revisar ? "Revisar marcaciones" : "",
    f.detalle.join(" | ")
  ].map(celda).join(";"));
  const encabezado = ["Fecha", "Persona", "Primera entrada", "Última salida", "Horas", "Minutos", "Observación", "Marcaciones"];
  const csv = "﻿" + [encabezado.map(celda).join(";"), ...lineas].join("\r\n");
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  enlace.download = `horario_siatet_${$("#m-desde").value}_a_${$("#m-hasta").value}.csv`;
  enlace.click();
});

// ---------------------------------------------------------------------
//  Corrección de marcaciones (solo el administrador)
//  Sirve para arreglar una hora, borrar una marcación repetida o agregar
//  la que alguien olvidó. Cada cambio queda marcado como corregido.
// ---------------------------------------------------------------------
function abrirJornada(uid, dia) {
  $("#j-persona").value = uid || $("#m-persona").value || admin.usuarios[0]?.uid || "";
  $("#j-dia").value = dia || $("#m-hasta").value;
  $("#j-dia").min = $("#m-desde").value;
  $("#j-dia").max = $("#m-hasta").value;
  $("#j-hora").value = "";
  pintarJornada();
  $("#dialogo-jornada").showModal();
}

function marcacionesDeJornada() {
  const uid = $("#j-persona").value, dia = $("#j-dia").value;
  return horarioAdmin.marcaciones.filter((m) => m.tecnicoUid === uid && m.dia === dia)
    .sort((a, b) => (a.fechaLocal || "").localeCompare(b.fechaLocal || ""));
}

function horaDeCampo(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function pintarJornada() {
  const lista = marcacionesDeJornada();
  $("#j-resumen").textContent = lista.length
    ? `${lista.length} marcación(es) ese día.`
    : "No hay marcaciones ese día. Agrega las que falten.";
  $("#j-lista").innerHTML = lista.map((m) => `
    <div class="jornada-fila" data-id="${escaparHtml(m.id)}">
      <select data-j="tipo" aria-label="Tipo de marcación">
        <option value="entrada" ${m.tipo === "entrada" ? "selected" : ""}>Entrada</option>
        <option value="salida" ${m.tipo === "salida" ? "selected" : ""}>Salida</option>
      </select>
      <input type="time" data-j="hora" value="${horaDeCampo(m.fechaLocal)}" aria-label="Hora">
      <button class="boton pequeno" type="button" data-j="guardar">Guardar</button>
      <button class="boton pequeno peligro" type="button" data-j="borrar">Borrar</button>
      <span class="nota">${escaparHtml(origenMarcacion(m))}</span>
    </div>`).join("");
  // La siguiente marcación que falta suele ser la contraria a la última
  const ultima = lista[lista.length - 1];
  $("#j-tipo").value = ultima && ultima.tipo === "entrada" ? "salida" : "entrada";
}

// Une la fecha (AAAA-MM-DD) con la hora (HH:MM) en la hora del dispositivo
function fechaConHora(dia, hora) {
  const fecha = new Date(`${dia}T${hora}:00`);
  return isNaN(fecha) ? null : fecha.toISOString();
}

function quienCorrige() {
  const yo = auth.currentUser;
  return admin.usuarios.find((u) => u.uid === yo?.uid)?.nombre || yo?.email || "Administrador";
}

function fechaDeJornadaValida() {
  const dia = $("#j-dia").value;
  if (!dia || dia < $("#m-desde").value || dia > $("#m-hasta").value) {
    aviso("Elige una fecha dentro del rango que estás consultando (Desde y Hasta).", "error");
    return false;
  }
  return true;
}

$("#m-agregar").addEventListener("click", () => {
  if (!admin.usuarios.length) return aviso("Aún no hay usuarios registrados.", "error");
  abrirJornada();
});
$("#m-cuerpo").addEventListener("click", (e) => {
  const dato = e.target.dataset?.corregir;
  if (!dato) return;
  const [uid, dia] = dato.split("|");
  abrirJornada(uid, dia);
});
$("#j-persona").addEventListener("change", pintarJornada);
$("#j-dia").addEventListener("change", pintarJornada);
$("#j-cerrar").addEventListener("click", () => $("#dialogo-jornada").close());

$("#j-lista").addEventListener("click", async (e) => {
  const accion = e.target.dataset?.j;
  const fila = e.target.closest(".jornada-fila");
  if (!fila || (accion !== "guardar" && accion !== "borrar")) return;
  const marcacion = horarioAdmin.marcaciones.find((m) => m.id === fila.dataset.id);
  if (!marcacion) return;
  const ref = db.collection("marcaciones").doc(marcacion.id);
  try {
    if (accion === "borrar") {
      if (!confirm(`¿Borrar la ${marcacion.tipo} de las ${horaCorta(marcacion.fechaLocal)}? Esta acción no se puede deshacer.`)) return;
      await ref.delete();
      return aviso("Marcación borrada.", "ok");
    }
    const fechaLocal = fechaConHora(marcacion.dia, $('[data-j="hora"]', fila).value);
    if (!fechaLocal) return aviso("Escribe una hora válida.", "error");
    await ref.update({
      tipo: $('[data-j="tipo"]', fila).value,
      fechaLocal,
      corregido: true,
      corregidoPor: quienCorrige(),
      corregidoEn: firebase.firestore.FieldValue.serverTimestamp(),
      // Se conserva la hora que marcó la persona la primera vez
      horaOriginal: marcacion.horaOriginal || marcacion.fechaLocal
    });
    aviso("Marcación corregida.", "ok");
  } catch (err) {
    aviso("No se pudo guardar el cambio: " + err.message, "error");
  }
});

$("#j-nueva").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fechaDeJornadaValida()) return;
  const uid = $("#j-persona").value, dia = $("#j-dia").value;
  const persona = admin.usuarios.find((u) => u.uid === uid);
  const fechaLocal = fechaConHora(dia, $("#j-hora").value);
  if (!persona) return aviso("Elige la persona.", "error");
  if (!fechaLocal) return aviso("Escribe la hora de la marcación.", "error");
  try {
    await db.collection("marcaciones").doc().set({
      tecnicoUid: uid,
      tecnicoNombre: persona.nombre,
      tipo: $("#j-tipo").value,
      metodo: "admin",
      sitioId: "", sitioNombre: "", nota: "",
      dia,
      fechaLocal,
      corregido: true,
      corregidoPor: quienCorrige(),
      creadoServidor: firebase.firestore.FieldValue.serverTimestamp()
    });
    $("#j-hora").value = "";
    aviso("Marcación agregada.", "ok");
  } catch (err) {
    aviso("No se pudo agregar la marcación: " + err.message, "error");
  }
});

// ---------------------------------------------------------------------
//  Códigos QR por sitio
// ---------------------------------------------------------------------
function escucharSitios() {
  return db.collection("sitios").onSnapshot((snap) => {
    horarioAdmin.sitios = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
    $("#cuerpo-sitios").innerHTML = horarioAdmin.sitios.length ? horarioAdmin.sitios.map((s) => `
      <tr>
        <td>${escaparHtml(s.nombre)}</td>
        <td>${s.activo === false ? '<span class="etiqueta">Desactivado</span>' : "Vigente"}</td>
        <td><div class="acciones-fila">
          <button class="boton pequeno" data-ver-qr="${escaparHtml(s.id)}" ${s.activo === false ? "disabled" : ""}>Ver código</button>
          <button class="boton pequeno ${s.activo === false ? "" : "peligro"}" data-alternar="${escaparHtml(s.id)}">${s.activo === false ? "Activar" : "Desactivar"}</button>
        </div></td>
      </tr>`).join("") : `<tr><td colspan="3" class="vacio">Aún no has creado ningún código.</td></tr>`;
  }, (err) => aviso("No se pudieron cargar los sitios: " + err.code, "error"));
}

function claveAleatoria() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const azar = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(azar, (n) => letras[n % letras.length]).join("");
}

$("#form-sitio").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("#s-nombre").value.trim();
  if (!nombre) return aviso("Escribe el nombre del sitio.", "error");
  if (horarioAdmin.sitios.some((s) => (s.nombre || "").toLowerCase() === nombre.toLowerCase())) {
    return aviso("Ya existe un sitio con ese nombre.", "error");
  }
  try {
    const ref = db.collection("sitios").doc();
    const sitio = { nombre, clave: claveAleatoria(), activo: true };
    await ref.set({ ...sitio, creado: firebase.firestore.FieldValue.serverTimestamp() });
    $("#s-nombre").value = "";
    aviso(`Código creado para ${nombre}.`, "ok");
    mostrarQr({ ...sitio, id: ref.id });
  } catch (err) {
    aviso("No se pudo crear el código: " + err.message, "error");
  }
});

$("#cuerpo-sitios").addEventListener("click", async (e) => {
  const idVer = e.target.dataset?.verQr;
  const idAlternar = e.target.dataset?.alternar;
  if (idVer) mostrarQr(horarioAdmin.sitios.find((s) => s.id === idVer));
  if (idAlternar) {
    const sitio = horarioAdmin.sitios.find((s) => s.id === idAlternar);
    const desactivar = sitio.activo !== false;
    if (desactivar && !confirm(`¿Desactivar el código de ${sitio.nombre}? Nadie podrá marcar con él hasta que lo actives de nuevo.`)) return;
    try {
      await db.collection("sitios").doc(sitio.id).update({ activo: !desactivar });
    } catch (err) {
      aviso("No se pudo cambiar el sitio: " + err.message, "error");
    }
  }
});

// Dibuja el código con el nombre del sitio, listo para imprimir
function mostrarQr(sitio) {
  const qr = qrcode(0, "M");
  qr.addData(`SIATET:${sitio.id}:${sitio.clave}`);
  qr.make();

  const lienzo = $("#qr-lienzo");
  const ctx = lienzo.getContext("2d");
  const modulos = qr.getModuleCount();
  const lado = 720, margen = 60, pie = 150;
  const celda = Math.floor((lado - margen * 2) / modulos);
  const inicio = Math.round((lado - celda * modulos) / 2);
  lienzo.width = lado;
  lienzo.height = lado + pie;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.fillStyle = "#000000";
  for (let fila = 0; fila < modulos; fila++) {
    for (let col = 0; col < modulos; col++) {
      if (qr.isDark(fila, col)) ctx.fillRect(inicio + col * celda, inicio + fila * celda, celda, celda);
    }
  }
  ctx.fillStyle = "#1F2326";
  ctx.textAlign = "center";
  let tamano = 46;
  ctx.font = `700 ${tamano}px Barlow, sans-serif`;
  while (ctx.measureText(sitio.nombre).width > lado - 60 && tamano > 22) {
    tamano -= 2;
    ctx.font = `700 ${tamano}px Barlow, sans-serif`;
  }
  ctx.fillText(sitio.nombre, lado / 2, lado + 30);
  ctx.fillStyle = "#5E666B";
  ctx.font = "500 28px Barlow, sans-serif";
  ctx.fillText("SIATET · Registro de horario", lado / 2, lado + 84);

  $("#qr-titulo").textContent = sitio.nombre;
  $("#qr-descargar").onclick = () => {
    const enlace = document.createElement("a");
    enlace.href = lienzo.toDataURL("image/png");
    enlace.download = `QR_horario_${sitio.nombre.replace(/[^\wÁÉÍÓÚÑáéíóúñ-]+/g, "_")}.png`;
    enlace.click();
  };
  $("#dialogo-qr").showModal();
}
$("#qr-cerrar").addEventListener("click", () => $("#dialogo-qr").close());
