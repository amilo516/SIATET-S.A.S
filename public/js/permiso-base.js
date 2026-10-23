const FORMATO_PERMISO = {
  titulo: "FORMATO SOLICITUD DE PERMISO",
  nit: "NIT: 901328628",
  fechaRealizacion: "11/09/2026",
  version: "01",
  textoResponsabilidad: "Autorizo que despues de que sea concedido el permiso, es responsabilidad del trabajador si algo le llega a suceder, por fuera de la empresa.",
  textoDescuento: "AUTORIZO LA EMPRESA PARA QUE ME DESCUENTE LAS HORAS DE PERMISO EN LA NOMINA QUE CORRESPONDA:",
  textoJustificacion: "EN CASO DE MARCAR \"NO\" SE DEBE PRESENTAR LA DEBIDA JUSTIFICACIÓN AL DPTO ADMINISTRATIVO DE LA EMPRESA EN EL TÉRMINO DE TRES (3) DÍAS HÁBILES."
};

// amarillo: sin responder · verde: aprobado · rojo: negado
function estadoDePermiso(p) {
  if (p.estado === "aprobado") return { clase: "verde", texto: "Aprobado" };
  if (p.estado === "negado") return { clase: "rojo", texto: "Negado" };
  return { clase: "amarillo", texto: p._pendiente ? "Por enviar" : "Solicitado" };
}

// "2026-10-08T14:00" -> "08/10/2026 2:00 p. m."
function fechaHoraLegible(valor) {
  if (!valor) return "";
  const [fecha, hora] = String(valor).split("T");
  if (!hora) return fechaLegible(fecha);
  const d = new Date(valor);
  return `${fechaLegible(fecha)} ${d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })}`;
}

function tiempoDePermiso(p, concedido) {
  const dias = Number((concedido ? p.diasConcedidos : null) ?? p.dias ?? 0);
  const horas = Number((concedido ? p.horasConcedidas : null) ?? p.horas ?? 0);
  return [dias ? `${dias} día(s)` : "", horas ? `${horas} hora(s)` : ""].filter(Boolean).join(" y ") || "Sin tiempo";
}

// ---------- Recuadro para firmar con el dedo ----------
function crearLienzoFirma(caja) {
  const canvas = $("canvas", caja);
  const pad = new SignaturePad(canvas, { penColor: "#12305E", minWidth: 0.8, maxWidth: 2.4 });
  pad.addEventListener("endStroke", () => caja.classList.add("firmado"));
  // Ajusta el lienzo al tamaño en pantalla sin perder lo firmado
  pad.ajustar = () => {
    if (!canvas.offsetWidth) return;
    const datos = pad.toData();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
    pad.clear();
    if (datos.length) pad.fromData(datos);
    caja.classList.toggle("firmado", datos.length > 0);
  };
  pad.limpiar = () => { pad.clear(); caja.classList.remove("firmado"); };
  return pad;
}

// ---------- Logo para el PDF ----------
// Usa el logo del formato de informes; si no hay, el que viene con la app.
let _logoPermiso = null;
function cargarLogoPermiso(logoDelFormato) {
  if (logoDelFormato) return Promise.resolve(logoDelFormato);
  if (_logoPermiso) return Promise.resolve(_logoPermiso);
  return new Promise((resolver) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      _logoPermiso = c.toDataURL("image/png");
      resolver(_logoPermiso);
    };
    img.onerror = () => resolver("");
    img.src = "icons/logo-siatet.png";
  });
}

// ---------- PDF con el mismo diseño del formato (una copia por hoja) ----------
function generarPdfPermiso(p, logo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const X = 18, W = 180, MITAD = 112;       // margen, ancho y columna donde se parte la fila
  const limpiar = (t) => String(t ?? "").replace(/[^\x00-ÿ‘’“”–—]/g, "");
  const aprobado = p.estado === "aprobado";

  const imagen = (url, x, y, w, h) => {
    if (!url) return;
    try {
      const prop = doc.getImageProperties(url);
      const esc = Math.min(w / prop.width, h / prop.height);
      doc.addImage(url, /^data:image\/jpe?g/i.test(url) ? "JPEG" : "PNG",
        x + (w - prop.width * esc) / 2, y + (h - prop.height * esc) / 2, prop.width * esc, prop.height * esc, undefined, "FAST");
    } catch (e) { console.warn("Imagen no válida en el PDF", e); }
  };

  function copia(y) {
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.setTextColor(0);
    const caja = (x, yy, w, h, relleno) => {
      if (relleno) { doc.setFillColor(...relleno); doc.rect(x, yy, w, h, "FD"); } else doc.rect(x, yy, w, h);
    };
    const texto = (t, x, yy, opciones = {}) => {
      doc.setFont("helvetica", opciones.negrita === false ? "normal" : "bold");
      doc.setFontSize(opciones.tam || 7.5);
      doc.text(limpiar(t), x, yy, { align: opciones.align || "left", maxWidth: opciones.ancho });
    };
    const parrafo = (t, x, yy, ancho, lineas) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(doc.splitTextToSize(limpiar(t), ancho).slice(0, lineas), x, yy);
    };
    const centro = X + W / 2;

    // Encabezado
    caja(X, y, 66, 20);
    imagen(logo, X + 12, y + 1, 42, 14);
    texto(FORMATO_PERMISO.nit, X + 33, y + 18.5, { align: "center", tam: 6.5 });
    caja(X + 66, y, W - 66, 10, [242, 242, 242]);
    texto(FORMATO_PERMISO.titulo, X + 66 + (W - 66) / 2, y + 6.2, { align: "center", tam: 8.5 });
    caja(X + 66, y + 10, 62, 10);
    texto(`FECHA DE REALIZACION: ${FORMATO_PERMISO.fechaRealizacion}`, X + 97, y + 16, { align: "center", tam: 7 });
    caja(X + 128, y + 10, W - 128, 10);
    texto(`VERSION: ${FORMATO_PERMISO.version}`, X + 128 + (W - 128) / 2, y + 16, { align: "center", tam: 7 });
    y += 20;

    // Nombre y fecha de elaboración
    caja(X, y, 118, 8); caja(X + 118, y, W - 118, 8);
    texto("NOMBRES Y APELLIDOS:", X + 1, y + 3.2, { tam: 6.5 });
    texto(p.nombre, X + 34, y + 5.6, { negrita: false, tam: 9 });
    texto("FECHA DE ELABORACION:", X + 119, y + 3.2, { tam: 6.5 });
    texto(fechaLegible(p.fechaElaboracion), X + 152, y + 5.6, { negrita: false, tam: 9 });
    y += 8;

    // Cargo
    caja(X, y, W, 6);
    texto("CARGO:", X + 1, y + 4.2, { tam: 6.5 });
    texto(p.cargo, X + 13, y + 4.3, { negrita: false, tam: 9 });
    y += 6;

    // Fechas y tiempo
    caja(X, y, MITAD - X + 0, 14); caja(MITAD, y, X + W - MITAD, 14);
    texto("FECHAS DEL PERMISO:", X + (MITAD - X) / 2, y + 3.5, { align: "center" });
    texto("DESDE", X + 18, y + 7.8); texto(fechaHoraLegible(p.desde), X + 34, y + 7.8, { negrita: false, tam: 8.5 });
    texto("HASTA", X + 18, y + 12); texto(fechaHoraLegible(p.hasta), X + 34, y + 12, { negrita: false, tam: 8.5 });
    texto("TOTAL TIEMPO CONCEDIDO", MITAD + (X + W - MITAD) / 2, y + 3.5, { align: "center" });
    const dias = aprobado ? (p.diasConcedidos ?? p.dias) : p.dias, horas = aprobado ? (p.horasConcedidas ?? p.horas) : p.horas;
    texto("DIAS", MITAD + 8, y + 10.5); texto(String(dias ?? ""), MITAD + 22, y + 10.3, { negrita: false, tam: 9, align: "center" });
    doc.line(MITAD + 16, y + 11.2, MITAD + 28, y + 11.2);
    texto("HORAS", MITAD + 38, y + 10.5); texto(String(horas ?? ""), MITAD + 59, y + 10.3, { negrita: false, tam: 9, align: "center" });
    doc.line(MITAD + 50, y + 11.2, MITAD + 68, y + 11.2);
    y += 14;

    // Descripción
    caja(X, y, W, 4.5); texto("DESCRIPCION DEL PERMISO", centro, y + 3.3, { align: "center" });
    caja(X, y + 4.5, W, 12.5); parrafo(p.descripcion, X + 2, y + 8.3, W - 4, 3);
    y += 17;

    // Observaciones
    caja(X, y, W, 4.5); texto("OBSERVACIONES:", centro, y + 3.3, { align: "center" });
    const observaciones = [p.observaciones, p.respuestaNota ? `Empresa: ${p.respuestaNota}` : ""].filter(Boolean).join(" · ");
    caja(X, y + 4.5, W, 8); parrafo(observaciones, X + 2, y + 8, W - 4, 2);
    y += 12.5;

    // Autorizaciones: la frase arriba y la respuesta marcada debajo
    const respuesta = (valor) => `SI __${valor === "SI" ? "X" : "_"}__      NO __${valor === "NO" ? "X" : "_"}__`;
    caja(X, y, W, 8.5, [0, 176, 240]);
    texto(FORMATO_PERMISO.textoResponsabilidad, centro, y + 3.3, { align: "center", tam: 6.6 });
    texto(respuesta(p.autorizaResponsabilidad), centro, y + 6.9, { align: "center", tam: 7.5 });
    y += 8.5;
    caja(X, y, W, 8.5);
    texto(FORMATO_PERMISO.textoDescuento, centro, y + 3.3, { align: "center", tam: 7 });
    texto(respuesta(p.autorizaDescuento), centro, y + 6.9, { align: "center", tam: 7.5 });
    y += 8.5;
    caja(X, y, W, 8);
    texto(FORMATO_PERMISO.textoJustificacion, centro, y + 3.3, { align: "center", ancho: W - 10, tam: 7 });
    y += 8;

    // Firmas
    caja(X, y, MITAD - X, 15); caja(MITAD, y, X + W - MITAD, 15);
    imagen(p.firmaTrabajador, X + 12, y + 0.8, MITAD - X - 24, 13.4);
    imagen(p.firmaEmpleador, MITAD + 6, y + 0.8, X + W - MITAD - 12, 10);
    if (p.empleadorNombre) texto(p.empleadorNombre, MITAD + (X + W - MITAD) / 2, y + 13.8, { align: "center", negrita: false, tam: 7.5 });
    y += 15;
    caja(X, y, MITAD - X, 5); caja(MITAD, y, X + W - MITAD, 5);
    texto("FIRMA DEL TRABAJADOR", X + (MITAD - X) / 2, y + 3.6, { align: "center" });
    texto("NOMBRE Y FIRMA EMPLEADOR", MITAD + (X + W - MITAD) / 2, y + 3.6, { align: "center" });
    y += 5;

    // Estado de la solicitud (no hace parte del formato en papel)
    const estado = estadoDePermiso(p).texto.toUpperCase();
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(90);
    doc.text(limpiar(`Estado: ${estado}${p.resueltoLocal ? " el " + fechaHoraLegible(p.resueltoLocal.slice(0, 16)) : ""}`), X + W, y + 3, { align: "right" });
    return y;
  }

  copia(12);   // una sola copia: el formato en papel traía dos iguales
  return doc;
}

async function descargarPdfPermiso(p, logoDelFormato) {
  const logo = await cargarLogoPermiso(logoDelFormato);
  const nombre = (p.nombre || "").replace(/[^\wÁÉÍÓÚÑáéíóúñ-]+/g, "_");
  generarPdfPermiso(p, logo).save(`Permiso_${nombre}_${String(p.desde || "").slice(0, 10)}.pdf`);
}
