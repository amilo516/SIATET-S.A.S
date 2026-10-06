function iniciarMenu(alElegir) {
  const menu = $("#menu");
  const fondo = $("#menu-fondo");
  const boton = $("#btn-menu");

  function abrir() {
    menu.classList.add("abierto");
    menu.removeAttribute("inert");
    fondo.hidden = false;
    boton.setAttribute("aria-expanded", "true");
    $("#menu-cerrar").focus();
  }

  function cerrar() {
    if (!menu.classList.contains("abierto")) return;
    menu.classList.remove("abierto");
    menu.setAttribute("inert", "");
    fondo.hidden = true;
    boton.setAttribute("aria-expanded", "false");
  }

  function alternarGrupo(botonGrupo, abierto) {
    const grupo = document.getElementById(botonGrupo.dataset.submenu);
    const abrirlo = abierto ?? grupo.hidden;
    grupo.hidden = !abrirlo;
    botonGrupo.setAttribute("aria-expanded", String(abrirlo));
  }

  boton.addEventListener("click", abrir);
  fondo.addEventListener("click", cerrar);
  $("#menu-cerrar").addEventListener("click", cerrar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("abierto")) {
      cerrar();
      boton.focus();
    }
  });

  menu.addEventListener("click", (e) => {
    const grupo = e.target.closest("[data-submenu]");
    if (grupo) return alternarGrupo(grupo);
    const item = e.target.closest(".menu-item");
    if (!item) return;
    cerrar();
    if (item.dataset.ir) alElegir(item.dataset.ir);
  });

  menu.setAttribute("inert", "");

  return {
    abrir,
    cerrar,
    // Resalta la opción de la pantalla que se está viendo
    marcar(nombre) {
      $$(".menu-item[data-ir]", menu).forEach((item) => {
        const actual = item.dataset.ir === nombre;
        if (actual) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
        const grupo = actual && item.closest(".menu-sub");
        if (grupo) alternarGrupo($(`[data-submenu="${grupo.id}"]`, menu), true);
      });
    },
    // Nombre y rol que se muestran arriba del menú
    usuario(nombre, rol) {
      const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean);
      $("#menu-iniciales").textContent = partes.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
      $("#menu-nombre").textContent = nombre || "";
      $("#menu-rol").textContent = rol === "admin" ? "Administrador" : "Técnico";
    }
  };
}

// Secciones del menú que todavía no están construidas
const SECCIONES_PENDIENTES = {
  "sgsst": {
    titulo: "Gestión SG-SST",
    texto: "Aquí irá la gestión de seguridad y salud en el trabajo. Se habilitará cuando se definan los registros que se van a manejar."
  }
};
