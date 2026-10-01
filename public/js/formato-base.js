// =====================================================================
//  FORMATO BASE (versión 0)
//  Es una copia del formato en papel. La app lo usa mientras no se haya
//  publicado ninguna versión desde el panel de administración.
//  Los cambios del día a día se hacen desde admin.html, NO aquí.
// =====================================================================
const FORMATO_BASE = {
  version: 0,
  titulo: "INFORME SERVICIO TECNICO",
  empresa: {
    nombre: "SIATET S.A.S.",
    descripcion: "SOLUCIONES INTEGRALES Y ASISTENCIA TECNICA",
    nit: "901 328 628-2",
    correo: "siatetneiva@gmail.com",
    telefono: ""
  },
  logo: "",              // imagen en base64; se carga desde el panel
  marcaDeAgua: true,     // usa el logo como marca de agua en el PDF
  colores: {
    marco: "#DCE9CF",    // verde claro del borde
    borde: "#3E5B3A",    // línea verde oscura
    acento: "#E3A33B"    // naranja de la marca
  },
  // ancho: "media" = comparte fila con otro campo; "completa" = fila entera
  // tipo: "texto" | "fecha" | "numero"
  campos: [
    { id: "fecha",      etiqueta: "Fecha",                tipo: "fecha", ancho: "completa", obligatorio: true },
    { id: "entidad",    etiqueta: "Entidad contratante",  tipo: "texto", ancho: "media",    obligatorio: true },
    { id: "sede",       etiqueta: "Sede",                 tipo: "texto", ancho: "media",    obligatorio: false },
    { id: "equipo",     etiqueta: "Equipo",               tipo: "texto", ancho: "completa", obligatorio: true },
    { id: "marca",      etiqueta: "Marca",                tipo: "texto", ancho: "media",    obligatorio: false },
    { id: "serie",      etiqueta: "Nº Serie",             tipo: "texto", ancho: "media",    obligatorio: false },
    { id: "modelo",     etiqueta: "Modelo",               tipo: "texto", ancho: "media",    obligatorio: false },
    { id: "ubicacion",  etiqueta: "Ubicación",            tipo: "texto", ancho: "media",    obligatorio: false }
  ],
  // alto = alto mínimo del recuadro en el PDF (milímetros)
  secciones: [
    { id: "diagnostico",   titulo: "Diagnóstico",              alto: 32, obligatorio: true },
    { id: "servicio",      titulo: "Servicio realizado",       alto: 34, obligatorio: true },
    { id: "repuestos",     titulo: "Suministro de repuestos",  alto: 22, obligatorio: false },
    { id: "observaciones", titulo: "Observaciones",            alto: 22, obligatorio: false }
  ],
  firmas: {
    tecnicoTitulo: "TECNICO SIATET",
    clienteTitulo: "RECIBI CONFORME",
    clienteNombreEtiqueta: "Nombre de quien recibe",
    clienteDocEtiqueta: "Cédula / cargo"
  }
};
