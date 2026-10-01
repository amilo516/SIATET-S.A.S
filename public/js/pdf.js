// =====================================================================
//  GENERADOR DEL PDF
//  Dibuja el informe con el mismo diseño del formato en papel,
//  usando la versión del formato con la que se hizo el informe.
//  Funciona sin internet.
// =====================================================================

function generarPDF(informe, formato) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "letter" });

  const W = 215.9, H = 279.4;
  const X0 = 20, X1 = W - 20, ANCHO = X1 - X0;
  const LIMITE = H - 22;           // hasta dónde puede llegar el contenido
  const OSCURO = "#2F3336";
  const col = formato.colores || FORMATO_BASE.colores;
  const emp = formato.empresa || {};
  const firmas = formato.firmas || FORMATO_BASE.firmas;

  const limpiar = (t) => String(t ?? "")
    .replace(/[→➜➔⇒]/g, "-")
    .replace(/[^\x00-\u00FF\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u20AC]/g, "");

  const tipoImg = (url) => (/^data:image\/jpe?g/i.test(url) ? "JPEG" : "PNG");

  function imagenAjustada(url, x, y, maxW, maxH, alinear = "izq") {
    if (!url) return;
    try {
      const p = doc.getImageProperties(url);
      const esc = Math.min(maxW / p.width, maxH / p.height);
      const w = p.width * esc, h = p.height * esc;
      const dx = alinear === "centro" ? (maxW - w) / 2 : alinear === "der" ? maxW - w : 0;
      doc.addImage(url, tipoImg(url), x + dx, y + (maxH - h) / 2, w, h, undefined, "FAST");
    } catch (e) {
      console.warn("Imagen no válida en el PDF", e);
    }
  }

  // ---------- Marco verde, marca de agua y pie de página ----------
  function marco() {
    doc.setFillColor(col.marco);
    doc.rect(6, 6, W - 12, H - 12, "F");
    doc.setFillColor("#FFFFFF");
    doc.rect(12, 12, W - 24, H - 24, "F");
    doc.setDrawColor(col.borde);
    doc.setLineWidth(0.7);
    doc.rect(10, 10, W - 20, H - 20);

    if (formato.marcaDeAgua && formato.logo) {
      try {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.07 }));
        imagenAjustada(formato.logo, (W - 130) / 2, (H - 130) / 2, 130, 130, "centro");
        doc.restoreGraphicsState();
      } catch (e) { /* sin marca de agua */ }
    }

    const pie = [emp.correo, emp.telefono].filter(Boolean).join("     ");
    if (pie) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor("#3B6CB5");
      doc.text(limpiar(pie), W / 2, H - 15, { align: "center" });
    }
    doc.setFontSize(7);
    doc.setTextColor("#8A8F93");
    doc.text(limpiar(`N° ${informe.numero || "-"}   Formato v${formato.version}`), X0, H - 15);
  }

  function nuevaPagina() {
    doc.addPage("letter");
    marco();
    doc.setDrawColor(OSCURO);
    doc.setLineWidth(0.3);
    doc.setTextColor(OSCURO);
    return 22;
  }

  // ---------- Encabezado ----------
  function encabezado() {
    const y = 28;
    const nombre = limpiar(emp.nombre || "");
    const [primera, ...resto] = nombre.split(" ");
    let x = X0;

    doc.setFont("helvetica", "bold");
    if (primera) {
      doc.setFontSize(32);
      doc.setTextColor(col.acento);
      doc.text(primera.charAt(0), x, y);
      x += doc.getTextWidth(primera.charAt(0)) + 0.3;
      doc.setFontSize(22);
      doc.setTextColor(OSCURO);
      doc.text(primera.slice(1), x, y);
      x += doc.getTextWidth(primera.slice(1)) + 2;
    }
    if (resto.length) {
      doc.setFontSize(15);
      doc.setTextColor(col.acento);
      doc.text(resto.join(" "), x, y);
    }

    const linea = [emp.descripcion, emp.nit ? `NIT. ${emp.nit}` : ""].filter(Boolean).join(". ");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(OSCURO);
    doc.text(doc.splitTextToSize(limpiar(linea), 135), X0, y + 6);

    imagenAjustada(formato.logo, X1 - 36, 15, 36, 24, "der");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(limpiar(formato.titulo || "INFORME SERVICIO TECNICO"), W / 2, 50, { align: "center" });

    if (informe.numero) {
      doc.setFontSize(9);
      doc.setTextColor(col.borde);
      doc.text(`N° ${limpiar(informe.numero)}`, X1, 50, { align: "right" });
    }
    return 56;
  }

  // ---------- Tabla de datos ----------
  function agruparCampos(campos) {
    const filas = [];
    for (let i = 0; i < campos.length; i++) {
      const c = campos[i], sig = campos[i + 1];
      if (c.ancho === "media" && sig && sig.ancho === "media") {
        filas.push([c, sig]);
        i++;
      } else {
        filas.push([c]);
      }
    }
    return filas;
  }

  function valorCampo(c) {
    const v = informe.campos?.[c.id] ?? "";
    return c.tipo === "fecha" ? fechaLegible(v) : v;
  }

  function tabla(y) {
    const ETQ1 = 44, ETQ2 = 28, MITAD = ANCHO * 0.54;
    doc.setLineWidth(0.3);
    doc.setDrawColor(OSCURO);
    doc.setFontSize(9.5);

    for (const fila of agruparCampos(formato.campos || [])) {
      const celdas = fila.length === 1
        ? [
            { x: X0, w: ETQ1, t: fila[0].etiqueta, etq: true },
            { x: X0 + ETQ1, w: ANCHO - ETQ1, t: valorCampo(fila[0]) }
          ]
        : [
            { x: X0, w: ETQ1, t: fila[0].etiqueta, etq: true },
            { x: X0 + ETQ1, w: MITAD - ETQ1, t: valorCampo(fila[0]) },
            { x: X0 + MITAD, w: ETQ2, t: fila[1].etiqueta, etq: true },
            { x: X0 + MITAD + ETQ2, w: ANCHO - MITAD - ETQ2, t: valorCampo(fila[1]) }
          ];

      let alto = 6.5;
      for (const c of celdas) {
        doc.setFont("helvetica", c.etq ? "bold" : "normal");
        c.lineas = doc.splitTextToSize(limpiar(c.t), c.w - 3);
        alto = Math.max(alto, c.lineas.length * 4 + 2.6);
      }
      if (y + alto > LIMITE) y = nuevaPagina();

      for (const c of celdas) {
        doc.rect(c.x, y, c.w, alto);
        doc.setFont("helvetica", c.etq ? "bold" : "normal");
        doc.setTextColor(OSCURO);
        doc.text(c.lineas, c.x + 1.5, y + 4.6, { lineHeightFactor: 1.2 });
      }
      y += alto;
    }
    return y;
  }

  // ---------- Secciones de texto (se parten entre páginas si hace falta) ----------
  function secciones(y) {
    const LH = 4.6;
    doc.setLineWidth(0.3);
    doc.setDrawColor(OSCURO);

    for (const s of formato.secciones || []) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const texto = limpiar((informe.secciones?.[s.id] || "").trim());
      const restantes = texto ? doc.splitTextToSize(texto, ANCHO - 8) : [];
      let primera = true;

      while (true) {
        const disponible = LIMITE - y;
        const necesario = Math.max(primera ? (s.alto || 20) : 14, 13 + restantes.length * LH);
        let bloque, alto;

        if (necesario <= disponible) {
          bloque = restantes.splice(0);
          alto = necesario;
        } else {
          const cabe = Math.floor((disponible - 13) / LH);
          if (cabe < 3 || restantes.length === 0) { y = nuevaPagina(); continue; }
          bloque = restantes.splice(0, cabe);
          alto = disponible;
        }

        doc.rect(X0, y, ANCHO, alto);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(OSCURO);
        doc.text(limpiar(s.titulo) + (primera ? ":" : " (continuación):"), X0 + 3, y + 5.5);
        doc.setFont("helvetica", "normal");
        bloque.forEach((ln, i) => doc.text(ln, X0 + 4, y + 11.5 + i * LH));

        y += alto;
        primera = false;
        if (!restantes.length) break;
        y = nuevaPagina();
      }
    }
    return y;
  }

  // ---------- Firmas ----------
  function bloqueFirmas(y) {
    if (y + 52 > LIMITE) y = nuevaPagina() + 4;
    y += 8;
    const ANC = 68, xI = X0 + 2, xD = X1 - ANC - 2, ALTO_FIRMA = 26;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(OSCURO);
    doc.text(limpiar(firmas.tecnicoTitulo), xI, y);
    doc.text(limpiar(firmas.clienteTitulo), xD + ANC, y, { align: "right" });

    const yF = y + 3;
    imagenAjustada(informe.firmaTecnico, xI, yF, ANC, ALTO_FIRMA, "centro");
    imagenAjustada(informe.firmaCliente, xD, yF, ANC, ALTO_FIRMA, "centro");
    imagenAjustada(formato.logo, W / 2 - 14, yF + 2, 28, 22, "centro");

    const yL = yF + ALTO_FIRMA + 2;
    doc.setLineWidth(0.4);
    doc.line(xI, yL, xI + ANC, yL);
    doc.line(xD, yL, xD + ANC, yL);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const nombresTec = doc.splitTextToSize(limpiar(informe.tecnicoNombres || ""), ANC);
    doc.text(nombresTec, xI, yL + 4.5, { lineHeightFactor: 1.25 });

    const cliente = [
      informe.clienteNombre,
      informe.clienteDoc ? `${firmas.clienteDocEtiqueta}: ${informe.clienteDoc}` : ""
    ].filter(Boolean).map(limpiar);
    doc.text(doc.splitTextToSize(cliente.join("\n"), ANC), xD, yL + 4.5, { lineHeightFactor: 1.25 });
  }

  // ---------- Armar el documento ----------
  marco();
  let y = encabezado();
  y = tabla(y);
  y = secciones(y);
  bloqueFirmas(y);

  const total = doc.getNumberOfPages();
  if (total > 1) {
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor("#8A8F93");
      doc.text(`Página ${i} de ${total}`, X1, H - 15, { align: "right" });
    }
  }
  return doc;
}
