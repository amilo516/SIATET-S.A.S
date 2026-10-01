const admin = {
  vigente: FORMATO_BASE,   // versión publicada
  edicion: null,           // copia que se está editando
  editado: false,          // hay cambios sin publicar
  informes: [],
  usuarios: [],
  desuscribir: []
};

vigilarConexion($("#estado-red"));
registrarServiceWorker();

// ---------- Sesión ----------
$("#form-ingreso").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await auth.signInWithEmailAndPassword($("#ing-correo").value.trim(), $("#ing-clave").value);
  } catch (err) {
    aviso("No se pudo ingresar. Revisa el correo y la contraseña.", "error");
  }
});
$("#btn-salir").addEventListener("click", async () => {
  await auth.signOut();
  location.replace("index.html");
});

auth.onAuthStateChanged(async (usuario) => {
  admin.desuscribir.forEach((fn) => fn());
  admin.desuscribir = [];
  $("#btn-salir").hidden = !usuario;

  $("#btn-informe").hidden = !usuario;
  if (!usuario) {
    $("#pantalla-ingreso").hidden = false;
    $("#pantalla-panel").hidden = true;
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

  $("#pantalla-ingreso").hidden = true;
  $("#pantalla-panel").hidden = false;

  admin.desuscribir.push(escucharFormatoVigente((f) => {
    admin.vigente = f;
    $("#version-vigente").textContent = f.version;
    // Solo se recarga el editor si no hay cambios sin publicar
    if (!admin.editado) cargarEdicion(f);
  }));
  admin.desuscribir.push(escucharInformesAdmin());
  admin.desuscribir.push(escucharUsuarios());
});

// ---------- Pestañas ----------
$(".pestanas").addEventListener("click", (e) => {
  const boton = e.target.closest("[data-pestana]");
  if (!boton) return;
  $$(".pestanas button").forEach((b) => b.setAttribute("aria-selected", String(b === boton)));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== boton.dataset.pestana));
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
  for (const k of ["empresa", "colores", "firmas"]) {
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
  pintarCampos();
  pintarSecciones();
}

$('[data-panel="formato"]').addEventListener("input", () => (admin.editado = true));

$$("[data-ruta]").forEach((el) => {
  el.addEventListener("input", () => {
    escribirRuta(admin.edicion, el.dataset.ruta, el.type === "checkbox" ? el.checked : el.value);
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

// Reduce la imagen para que quepa en la base de datos (máx. ~400 KB)
function reducirImagen(archivo, maximo) {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(1, maximo / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * esc);
      canvas.height = Math.round(img.height * esc);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
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
  return {
    numero: "EJ-0001", campos, secciones,
    tecnicoNombres: "Nombre del técnico", clienteNombre: "Nombre del cliente", clienteDoc: "1.234.567",
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
    cargarEdicion({ ...FORMATO_BASE, logo: admin.edicion.logo });
    admin.editado = true;
  }
});

// =====================================================================
//  INFORMES
// =====================================================================
function escucharInformesAdmin() {
  return db.collection("informes").orderBy("creadoLocal", "desc").limit(300)
    .onSnapshot((snap) => {
      admin.informes = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      pintarInformes();
    }, (err) => aviso("No se pudieron cargar los informes: " + err.code, "error"));
}

function informesFiltrados() {
  const q = $("#buscar").value.trim().toLowerCase();
  if (!q) return admin.informes;
  return admin.informes.filter((i) =>
    [i.numero, i.campos?.entidad, i.campos?.equipo, i.campos?.sede, i.tecnicoNombres, i.clienteNombre]
      .join(" ").toLowerCase().includes(q));
}

function pintarInformes() {
  const lista = informesFiltrados();
  $("#cuerpo-informes").innerHTML = lista.length ? lista.map((i) => `
    <tr>
      <td><strong>${escaparHtml(i.numero)}</strong></td>
      <td>${escaparHtml(fechaLegible(i.campos?.fecha))}</td>
      <td>${escaparHtml(i.campos?.entidad)}${i.campos?.sede ? `<br><span class="nota">${escaparHtml(i.campos.sede)}</span>` : ""}</td>
      <td>${escaparHtml(i.campos?.equipo)}</td>
      <td>${escaparHtml(i.tecnicoNombres)}</td>
      <td style="white-space:nowrap">
        <button class="boton pequeno" data-pdf="${escaparHtml(i.id)}">PDF</button>
        <button class="boton pequeno peligro" data-borrar="${escaparHtml(i.id)}" aria-label="Borrar">✕</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="6" class="vacio">No hay informes que coincidan.</td></tr>`;
}
$("#buscar").addEventListener("input", pintarInformes);

$("#cuerpo-informes").addEventListener("click", async (e) => {
  const idPdf = e.target.dataset?.pdf;
  const idBorrar = e.target.dataset?.borrar;
  if (idPdf) {
    const informe = admin.informes.find((i) => i.id === idPdf);
    descargarPdf(informe).catch((err) => aviso(err.message, "error"));
  }
  if (idBorrar) {
    const informe = admin.informes.find((i) => i.id === idBorrar);
    if (!confirm(`¿Borrar definitivamente el informe ${informe.numero}? Esta acción no se puede deshacer.`)) return;
    try {
      await db.collection("informes").doc(idBorrar).delete();
      aviso(`Informe ${informe.numero} borrado.`, "ok");
    } catch (err) {
      aviso("No se pudo borrar: " + err.message, "error");
    }
  }
});

$("#btn-csv").addEventListener("click", () => {
  const lista = informesFiltrados();
  if (!lista.length) return aviso("No hay informes para exportar.");
  const idsCampos = [...new Set(lista.flatMap((i) => Object.keys(i.campos || {})))];
  const idsSecciones = [...new Set(lista.flatMap((i) => Object.keys(i.secciones || {})))];
  const nombre = (id, arr, prop) => arr.find((x) => x.id === id)?.[prop] || id;

  const encabezado = ["Número",
    ...idsCampos.map((id) => nombre(id, admin.vigente.campos, "etiqueta")),
    ...idsSecciones.map((id) => nombre(id, admin.vigente.secciones, "titulo")),
    "Técnico(s)", "Recibe", "Documento", "Correo técnico", "Versión formato", "Creado"];
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = lista.map((i) => [
    i.numero,
    ...idsCampos.map((id) => i.campos?.[id]),
    ...idsSecciones.map((id) => i.secciones?.[id]),
    i.tecnicoNombres, i.clienteNombre, i.clienteDoc, i.tecnicoCorreo, i.formatoVersion, i.creadoLocal
  ].map(celda).join(";"));

  const csv = "\uFEFF" + [encabezado.map(celda).join(";"), ...filas].join("\r\n");
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  enlace.download = `informes_siatet_${hoyISO()}.csv`;
  enlace.click();
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