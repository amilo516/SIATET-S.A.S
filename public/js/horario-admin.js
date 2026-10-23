const horarioAdmin = {
  marcaciones: [],
  novedades: {},                      // { "AAAA-MM-DD|uid": "texto" }
  reglas: { ...REGLAS_HORAS_BASE },   // horario fijo (horas.js)
  sitios: [],
  dejarDeEscuchar: () => {}
};

const NOVEDADES_SUGERIDAS = ["Incapacidad", "Permiso", "Vacaciones", "Licencia", "Calamidad doméstica",
  "Descanso compensatorio", "Festivo", "Viaje", "No asistió"];

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------
//  Datos
// ---------------------------------------------------------------------
function iniciarHorarioAdmin() {
  const hoy = hoyISO();
  $("#m-desde").value = hoy.slice(0, 8) + "01";   // primer día del mes
  $("#m-hasta").value = hoy;
  $("#j-sugerencias").innerHTML = NOVEDADES_SUGERIDAS.map((n) => `<option value="${escaparHtml(n)}">`).join("");
  escucharMarcacionesAdmin();
  const quitarSitios = escucharSitios();
  return () => { horarioAdmin.dejarDeEscuchar(); quitarSitios(); };
}

function correrDia(dia, n) {
  const [ano, mes, d] = dia.split("-").map(Number);
  return claveDeFecha(new Date(ano, mes - 1, d + n));
}

function escucharMarcacionesAdmin() {
  horarioAdmin.dejarDeEscuchar();
  const desde = $("#m-desde").value, hasta = $("#m-hasta").value;
  if (!desde || !hasta || desde > hasta) {
    horarioAdmin.marcaciones = [];
    horarioAdmin.novedades = {};
    horarioAdmin.dejarDeEscuchar = () => {};
    return pintarMarcaciones();
  }
  const repintar = () => {
    pintarMarcaciones();
    if ($("#dialogo-jornada").open) pintarJornada();
  };
  // Se pide un día antes y uno después para unir los turnos que pasan de medianoche
  const quitarMarcaciones = db.collection("marcaciones")
    .where("dia", ">=", correrDia(desde, -1)).where("dia", "<=", correrDia(hasta, 1))
    .onSnapshot((snap) => {
      horarioAdmin.marcaciones = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      repintar();
    }, (err) => aviso("No se pudieron cargar las marcaciones: " + err.code, "error"));
  const quitarNovedades = db.collection("novedades")
    .where("dia", ">=", desde).where("dia", "<=", hasta)
    .onSnapshot((snap) => {
      horarioAdmin.novedades = {};
      snap.docs.forEach((d) => {
        const n = d.data();
        if (n.texto) horarioAdmin.novedades[`${n.dia}|${n.tecnicoUid}`] = n.texto;
      });
      repintar();
    }, (err) => console.warn("Sin acceso a las novedades:", err.code));
  horarioAdmin.dejarDeEscuchar = () => { quitarMarcaciones(); quitarNovedades(); };
}
$("#m-desde").addEventListener("change", escucharMarcacionesAdmin);
$("#m-hasta").addEventListener("change", escucharMarcacionesAdmin);
$("#m-persona").addEventListener("change", pintarMarcaciones);

// Llena las listas de personas con los usuarios habilitados
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
  const km = m.km !== undefined && m.km !== null && m.km !== "" ? ` · ${Number(m.km).toLocaleString("es-CO")} km` : "";
  return como + (donde ? " · " + donde : "") + km + (m.corregido && m.metodo !== "admin" ? " · corregida" : "");
}

// ---------------------------------------------------------------------
//  Tabla de horas
// ---------------------------------------------------------------------
function jornadas() {
  const persona = $("#m-persona").value;
  const desde = $("#m-desde").value, hasta = $("#m-hasta").value;
  return calcularJornadas(horarioAdmin.marcaciones, horarioAdmin.reglas, horarioAdmin.novedades)
    .filter((j) => j.dia >= desde && j.dia <= hasta && (!persona || j.uid === persona))
    .map((j) => ({ ...j, nombre: admin.usuarios.find((u) => u.uid === j.uid)?.nombre || j.nombre || "Sin nombre" }))
    .sort((a, b) => b.dia.localeCompare(a.dia) || a.nombre.localeCompare(b.nombre));
}

function horasLegibles(minutos) {
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
function diaConNombre(dia) {
  const [ano, mes, d] = dia.split("-").map(Number);
  return `${DIAS_CORTOS[new Date(ano, mes - 1, d).getDay()]} ${fechaLegible(dia)}`;
}

const kmLegible = (km) => (km === null || km === undefined ? "" : Number(km).toLocaleString("es-CO"));

function observacionesDeJornada(j) {
  return [
    j.entradaTarde ? "Entrada tarde" : "",
    j.faltaSalida ? "Falta salida" : "",
    j.revisar ? "Revisar marcaciones" : "",
    j.revisarKm ? "Revisar kilometraje" : "",
    j.festivo ? "Festivo" : "",
    j.almuerzoDescontado ? `Almuerzo descontado (${j.almuerzoDescontado} min)` : "",
    j.jornadaContinua ? "Jornada continua" : "",
    j.salidaOtroDia ? "Salió al día siguiente" : ""
  ].filter(Boolean);
}

// Resumen por persona en las fechas consultadas
function resumenPorPersona(filas) {
  const grupos = new Map();
  filas.forEach((j) => {
    if (!grupos.has(j.uid)) grupos.set(j.uid, { nombre: j.nombre, lista: [] });
    grupos.get(j.uid).lista.push(j);
  });
  return [...grupos.values()]
    .map((g) => ({ nombre: g.nombre, pendientes: g.lista.filter((j) => j.faltaSalida || j.revisar || j.revisarKm).length, ...sumarJornadas(g.lista) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const celdaHoras = (minutos) => `<td class="num">${minutos ? horasYMinutos(minutos) : "—"}</td>`;
const encabezadoHoras = () => CATEGORIAS_HORAS
  .map((c) => `<th class="num" title="${escaparHtml(c.nombre)}">${escaparHtml(c.corto)}</th>`).join("");

function pintarMarcaciones() {
  const filas = jornadas();
  const total = sumarJornadas(filas);
  $("#m-resumen").textContent = filas.length
    ? `${filas.length} día(s) · ${horasLegibles(total.minutos)} trabajadas · ${kmLegible(total.km)} km`
    : "";

  $("#m-encabezado").innerHTML = `<th>Fecha</th><th>Persona</th><th class="num">Total</th>${encabezadoHoras()}`
    + `<th>Entrada</th><th>Salida</th><th class="num">Km recorridos</th><th>Novedad</th><th></th><th>Observaciones</th><th>Marcaciones</th>`;
  $("#m-cuerpo").innerHTML = filas.length ? filas.map((j) => `
    <tr>
      <td style="white-space:nowrap">${escaparHtml(diaConNombre(j.dia))}</td>
      <td>${escaparHtml(j.nombre)}</td>
      <td class="num"><strong>${horasYMinutos(j.minutos)}</strong></td>
      ${CATEGORIAS_HORAS.map((c) => celdaHoras(j[c.id])).join("")}
      <td style="white-space:nowrap"${j.entradaTarde ? ` class="tarde" title="Entró después de las 7:00 a. m."` : ""}>${j.entrada ? escaparHtml(horaCorta(j.entrada)) : "—"}</td>
      <td style="white-space:nowrap">${j.salida ? escaparHtml(horaCorta(j.salida)) : "—"}</td>
      <td class="num" title="${j.kmInicial !== null ? `De ${kmLegible(j.kmInicial)} a ${kmLegible(j.kmFinal)}` : "Sin lecturas"}">${j.kmRecorridos !== null ? kmLegible(j.kmRecorridos) : "—"}</td>
      <td>${j.novedad ? `<span class="etiqueta">${escaparHtml(j.novedad)}</span>` : ""}</td>
      <td><button class="boton pequeno" type="button" data-corregir="${escaparHtml(j.uid)}|${escaparHtml(j.dia)}">Corregir</button></td>
      <td style="white-space:nowrap">${observacionesDeJornada(j).map((o) =>
        `<span class="etiqueta${/Falta|Revisar|tarde/.test(o) ? "" : " neutra"}">${escaparHtml(o)}</span>`).join(" ")}</td>
      <td class="nota" style="white-space:nowrap">${j.marcaciones.map((m) =>
        escaparHtml(`${m.tipo === "entrada" ? "Entrada" : "Salida"} ${horaCorta(m.fechaLocal)} · ${origenMarcacion(m)}`)).join("<br>")}</td>
    </tr>`).join("") : `<tr><td colspan="${CATEGORIAS_HORAS.length + 11}" class="vacio">No hay marcaciones ni novedades en estas fechas.</td></tr>`;

  const personas = resumenPorPersona(filas);
  $("#m-encabezado-resumen").innerHTML = `<th>Persona</th><th class="num">Días</th><th class="num">Total</th>${encabezadoHoras()}`
    + `<th class="num">Km</th><th class="num">Novedades</th><th></th>`;
  $("#m-cuerpo-resumen").innerHTML = personas.length ? personas.map((r) => `
    <tr>
      <td>${escaparHtml(r.nombre)}</td>
      <td class="num">${r.dias}</td>
      <td class="num"><strong>${horasYMinutos(r.minutos)}</strong></td>
      ${CATEGORIAS_HORAS.map((c) => celdaHoras(r[c.id])).join("")}
      <td class="num">${r.km ? kmLegible(r.km) : "—"}</td>
      <td class="num">${r.novedades || "—"}</td>
      <td>${r.pendientes ? `<span class="etiqueta">${r.pendientes} día(s) por revisar</span>` : ""}</td>
    </tr>`).join("") : `<tr><td colspan="${CATEGORIAS_HORAS.length + 6}" class="vacio">No hay datos en estas fechas.</td></tr>`;
}

// ---------------------------------------------------------------------
//  Exportar a Excel
// ---------------------------------------------------------------------
function descargarCsv(nombre, encabezado, lineas) {
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [encabezado, ...lineas].map((fila) => fila.map(celda).join(";")).join("\r\n");
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  enlace.download = nombre;
  enlace.click();
}

// Detalle: una fila por persona y día; cada tipo de hora en horas:minutos
$("#m-csv").addEventListener("click", () => {
  const filas = jornadas();
  if (!filas.length) return aviso("No hay datos para exportar.");
  descargarCsv(`horario_detalle_${$("#m-desde").value}_a_${$("#m-hasta").value}.csv`,
    ["Fecha", "Día", "Persona", "Entrada", "Salida", "Total", ...CATEGORIAS_HORAS.map((c) => c.nombre),
      "Almuerzo descontado (min)", "Km inicial", "Km final", "Km recorridos", "Novedad", "Observaciones", "Marcaciones"],
    filas.map((j) => [
      fechaLegible(j.dia), diaConNombre(j.dia).slice(0, 3), j.nombre,
      j.entrada ? horaCorta(j.entrada) : "", j.salida ? horaCorta(j.salida) : "",
      horasYMinutos(j.minutos), ...CATEGORIAS_HORAS.map((c) => horasYMinutos(j[c.id])),
      j.almuerzoDescontado || 0, j.kmInicial ?? "", j.kmFinal ?? "", j.kmRecorridos ?? "", j.novedad,
      observacionesDeJornada(j).join(", "),
      j.marcaciones.map((m) => `${m.tipo === "entrada" ? "Entrada" : "Salida"} ${horaCorta(m.fechaLocal)} · ${origenMarcacion(m)}`).join(" | ")
    ]));
});

// Resumen para la nómina: una fila por persona, horas y minutos en números enteros
$("#m-csv-resumen").addEventListener("click", () => {
  const filas = jornadas();
  const personas = resumenPorPersona(filas);
  if (!personas.length) return aviso("No hay datos para exportar.");
  const partes = (minutos) => [Math.floor(minutos / 60), minutos % 60];
  descargarCsv(`horario_resumen_${$("#m-desde").value}_a_${$("#m-hasta").value}.csv`,
    ["Persona", "Días trabajados", "Total (horas)", "Total (minutos)",
      ...CATEGORIAS_HORAS.flatMap((c) => [`${c.nombre} (horas)`, `${c.nombre} (minutos)`]),
      "Km recorridos", "Novedades", "Días por revisar"],
    personas.map((r) => [r.nombre, r.dias, ...partes(r.minutos),
      ...CATEGORIAS_HORAS.flatMap((c) => partes(r[c.id])), r.km,
      filas.filter((j) => j.nombre === r.nombre && j.novedad).map((j) => `${fechaLegible(j.dia)}: ${j.novedad}`).join(" | "),
      r.pendientes]));
});

// ---------------------------------------------------------------------
//  Corrección de un día (solo el administrador)
//  Arreglar una hora o el kilometraje, borrar una marcación repetida,
//  agregar la que faltó, marcar jornada continua y escribir la novedad.
// ---------------------------------------------------------------------
function abrirJornada(uid, dia) {
  $("#j-persona").value = uid || $("#m-persona").value || admin.usuarios[0]?.uid || "";
  $("#j-dia").value = dia || $("#m-hasta").value;
  $("#j-dia").min = $("#m-desde").value;
  $("#j-dia").max = $("#m-hasta").value;
  $("#j-hora").value = "";
  $("#j-km").value = "";
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
  const uid = $("#j-persona").value, dia = $("#j-dia").value;
  $("#j-resumen").textContent = lista.length
    ? `${lista.length} marcación(es) ese día.`
    : "No hay marcaciones ese día. Agrega las que falten o escribe la novedad.";
  $("#j-lista").innerHTML = lista.map((m) => `
    <div class="jornada-fila" data-id="${escaparHtml(m.id)}">
      <select data-j="tipo" aria-label="Tipo de marcación">
        <option value="entrada" ${m.tipo === "entrada" ? "selected" : ""}>Entrada</option>
        <option value="salida" ${m.tipo === "salida" ? "selected" : ""}>Salida</option>
      </select>
      <input type="time" data-j="hora" value="${horaDeCampo(m.fechaLocal)}" aria-label="Hora">
      <input type="number" data-j="km" min="0" step="1" value="${m.km ?? ""}" placeholder="Km" aria-label="Kilometraje">
      <button class="boton pequeno" type="button" data-j="guardar">Guardar</button>
      <button class="boton pequeno peligro" type="button" data-j="borrar">Borrar</button>
      <span class="nota">${escaparHtml(origenMarcacion(m))}</span>
    </div>`).join("");

  const jornada = calcularJornadas(horarioAdmin.marcaciones, horarioAdmin.reglas)
    .find((j) => j.uid === uid && j.dia === dia);
  $("#j-almuerzo").hidden = !(jornada && jornada.puedeDescontarAlmuerzo);
  $("#j-continua").checked = !!(jornada && jornada.jornadaContinua);
  $("#j-almuerzo-nota").textContent = jornada && jornada.almuerzoDescontado
    ? `Se le descuentan ${jornada.almuerzoDescontado} min de almuerzo porque no lo marcó.` : "";
  $("#j-novedad").value = horarioAdmin.novedades[`${dia}|${uid}`] || "";

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

const leerKm = (el) => (el.value.trim() === "" ? null : Math.max(0, Math.round(Number(el.value))));

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
      km: leerKm($('[data-j="km"]', fila)),
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

// Jornada continua: se guarda en las marcaciones del día para que no se descuente el almuerzo
$("#j-continua").addEventListener("change", async (e) => {
  try {
    const lote = db.batch();
    marcacionesDeJornada().forEach((m) => lote.update(db.collection("marcaciones").doc(m.id), { sinAlmuerzo: e.target.checked }));
    await lote.commit();
    aviso(e.target.checked ? "Día marcado como jornada continua." : "Se vuelve a descontar el almuerzo.", "ok");
  } catch (err) {
    aviso("No se pudo guardar el cambio: " + err.message, "error");
  }
});

// Novedad del día (un documento por persona y día en "novedades")
$("#j-guardar-novedad").addEventListener("click", async () => {
  if (!fechaDeJornadaValida()) return;
  const uid = $("#j-persona").value, dia = $("#j-dia").value;
  const texto = $("#j-novedad").value.trim();
  const ref = db.collection("novedades").doc(`${uid}_${dia}`);
  try {
    if (texto) {
      await ref.set({ tecnicoUid: uid, dia, texto, registradoPor: quienCorrige(),
        actualizado: firebase.firestore.FieldValue.serverTimestamp() });
      aviso("Novedad guardada.", "ok");
    } else {
      await ref.delete();
      aviso("Novedad quitada.", "ok");
    }
  } catch (err) {
    aviso("No se pudo guardar la novedad: " + err.message, "error");
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
      km: leerKm($("#j-km")),
      dia,
      fechaLocal,
      corregido: true,
      corregidoPor: quienCorrige(),
      creadoServidor: firebase.firestore.FieldValue.serverTimestamp()
    });
    $("#j-hora").value = "";
    $("#j-km").value = "";
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
