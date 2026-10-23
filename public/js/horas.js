// =====================================================================
//  CÁLCULO DE HORAS PARA LA NÓMINA
//
//  A partir de las marcaciones clasifica el tiempo de cada jornada en:
//    ord      ordinarias: lunes a viernes dentro del horario (7:00 a. m. - 4:00 p. m.)
//             y el sábado las primeras 2 horas trabajadas (42 horas a la semana)
//    ext      extras: fuera del horario, de día
//    extNoc   extras nocturnas: desde las 7:00 p. m. hasta las 6:00 a. m.
//    fes      extras festivas: domingos y festivos, de día
//    fesNoc   extras festivas nocturnas: domingos y festivos, de noche
//
//  El almuerzo: si la persona no marcó la salida y el regreso del almuerzo
//  y trabajó de corrido durante esa franja, se descuenta solo. Un día se
//  puede marcar como "jornada continua" para que no se descuente.
//
//  Las extras de cada día (de todo tipo) se redondean a la hora completa:
//  de 30 minutos en adelante sube a la hora siguiente (1:25 -> 1, 0:30 -> 1).
// =====================================================================
const REGLAS_HORAS_BASE = {
  lvInicio: "07:00",        // horario ordinario de lunes a viernes
  lvFin: "16:00",
  horasSabado: 2,           // horas ordinarias del sábado (las primeras que se trabajen)
  nocheInicio: "19:00",     // desde esta hora las extras son nocturnas
  nocheFin: "06:00",        // hasta esta hora
  almuerzoInicio: "12:00",  // franja de almuerzo que se descuenta si no se marcó
  almuerzoMinutos: 60       // 0 = no descontar
};

const CATEGORIAS_HORAS = [
  { id: "ord", corto: "Ordinarias", nombre: "Horas ordinarias" },
  { id: "ext", corto: "Extras", nombre: "Horas extras" },
  { id: "extNoc", corto: "Extras noct.", nombre: "Horas extras nocturnas" },
  { id: "fes", corto: "Extras fest.", nombre: "Horas extras festivas" },
  { id: "fesNoc", corto: "Extras fest. noct.", nombre: "Horas extras festivas nocturnas" }
];

const MAXIMO_TURNO_MS = 18 * 3600000;   // una entrada y su salida no se unen si pasan más de 18 horas

function claveDeFecha(fecha) {
  const p = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

function minutosDeHora(texto) {
  const [h, m] = String(texto || "0:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ---------------------------------------------------------------------
//  Festivos de Colombia (se calculan para cualquier año)
// ---------------------------------------------------------------------
const _festivosPorAno = {};
function festivosColombia(ano) {
  if (_festivosPorAno[ano]) return _festivosPorAno[ano];
  const dias = new Set();
  const fijo = (mes, dia) => dias.add(claveDeFecha(new Date(ano, mes - 1, dia)));
  // Los que se trasladan al lunes siguiente si no caen en lunes
  const alLunes = (fecha) => {
    const d = new Date(fecha);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    dias.add(claveDeFecha(d));
  };
  fijo(1, 1); fijo(5, 1); fijo(7, 20); fijo(8, 7); fijo(12, 8); fijo(12, 25);
  [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]
    .forEach(([mes, dia]) => alLunes(new Date(ano, mes - 1, dia)));

  // Domingo de Pascua
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascua = new Date(ano, mes - 1, dia);
  const desdePascua = (n) => new Date(ano, mes - 1, dia + n);
  dias.add(claveDeFecha(desdePascua(-3)));   // Jueves Santo
  dias.add(claveDeFecha(desdePascua(-2)));   // Viernes Santo
  alLunes(desdePascua(40));                   // Ascensión
  alLunes(desdePascua(61));                   // Corpus Christi
  alLunes(desdePascua(69));                   // Sagrado Corazón
  return (_festivosPorAno[ano] = dias);
}

function esFestivo(fecha) {
  return festivosColombia(fecha.getFullYear()).has(claveDeFecha(fecha));
}
function esDominicalOFestivo(fecha) {
  return fecha.getDay() === 0 || esFestivo(fecha);
}

// Entrada tarde: la primera entrada del día marcada después de la hora de
// entrada (7:00 a. m.), de lunes a sábado sin contar festivos
function esEntradaTarde(iso, reglas = REGLAS_HORAS_BASE) {
  if (!iso) return false;
  const fecha = new Date(iso);
  if (esDominicalOFestivo(fecha)) return false;
  return fecha.getHours() * 60 + fecha.getMinutes() > minutosDeHora(reglas.lvInicio || REGLAS_HORAS_BASE.lvInicio);
}

// ---------------------------------------------------------------------
//  Jornadas: una por persona y día
//  novedades: { "AAAA-MM-DD|uid": "Incapacidad", ... } (días sin marcaciones también salen)
// ---------------------------------------------------------------------
function calcularJornadas(marcaciones, reglasGuardadas, novedades = {}) {
  const reglas = { ...REGLAS_HORAS_BASE, ...(reglasGuardadas || {}) };
  const nocheInicio = minutosDeHora(reglas.nocheInicio), nocheFin = minutosDeHora(reglas.nocheFin);
  const esNoche = (min) => nocheInicio > nocheFin
    ? min >= nocheInicio || min < nocheFin
    : min >= nocheInicio && min < nocheFin;
  const horarioSemana = [minutosDeHora(reglas.lvInicio), minutosDeHora(reglas.lvFin)];
  const minutosSabado = Math.round(Number(reglas.horasSabado || 0) * 60);

  const jornadas = new Map();
  const jornadaDe = (dia, uid, nombre) => {
    const clave = `${dia}|${uid}`;
    if (!jornadas.has(clave)) {
      jornadas.set(clave, {
        dia, uid, nombre: nombre || "", marcaciones: [], turnos: [],
        faltaSalida: false, revisar: false, almuerzoDescontado: 0, minutos: 0,
        ord: 0, ext: 0, extNoc: 0, fes: 0, fesNoc: 0, novedad: ""
      });
    }
    return jornadas.get(clave);
  };

  // 1) Unir cada entrada con la salida que le sigue (aunque pase de medianoche)
  const porPersona = new Map();
  marcaciones.forEach((m) => {
    if (!porPersona.has(m.tecnicoUid)) porPersona.set(m.tecnicoUid, []);
    porPersona.get(m.tecnicoUid).push(m);
  });
  porPersona.forEach((lista) => {
    lista.sort((a, b) => (a.fechaLocal || "").localeCompare(b.fechaLocal || ""));
    let abierta = null;
    lista.forEach((m) => {
      const jornada = jornadaDe(m.dia, m.tecnicoUid, m.tecnicoNombre);
      jornada.marcaciones.push(m);
      if (m.tipo === "entrada") {
        // Dos entradas seguidas: el mismo día es una marcación repetida; en otro día faltó la salida
        if (abierta) jornadaDe(abierta.dia, abierta.tecnicoUid)[abierta.dia === m.dia ? "revisar" : "faltaSalida"] = true;
        abierta = m;
      } else if (abierta && new Date(m.fechaLocal) - new Date(abierta.fechaLocal) <= MAXIMO_TURNO_MS) {
        jornadaDe(abierta.dia, abierta.tecnicoUid).turnos.push({ inicio: new Date(abierta.fechaLocal), fin: new Date(m.fechaLocal), salida: m });
        abierta = null;
      } else {
        jornada.revisar = true;                       // salida sin entrada
        if (abierta) { jornadaDe(abierta.dia, abierta.tecnicoUid).faltaSalida = true; abierta = null; }
      }
    });
    if (abierta) jornadaDe(abierta.dia, abierta.tecnicoUid).faltaSalida = true;
  });

  // Días con novedad aunque no tengan marcaciones (vacaciones, incapacidad…)
  Object.entries(novedades).forEach(([clave, texto]) => {
    if (!texto) return;
    const [dia, uid] = clave.split("|");
    jornadaDe(dia, uid).novedad = texto;
  });

  // 2) Clasificar el tiempo de cada jornada
  jornadas.forEach((j) => {
    const [ano, mes, dia] = j.dia.split("-").map(Number);
    const fechaDia = new Date(ano, mes - 1, dia);
    j.festivo = esFestivo(fechaDia);
    j.dominical = fechaDia.getDay() === 0 || j.festivo;

    let tramos = j.turnos.map((t) => [Math.floor(t.inicio / 60000), Math.floor(t.fin / 60000)]);

    // Almuerzo no marcado: se descuenta si trabajó de corrido toda la franja
    j.jornadaContinua = j.marcaciones.some((m) => m.sinAlmuerzo);
    const duracionAlmuerzo = Number(reglas.almuerzoMinutos || 0);
    j.puedeDescontarAlmuerzo = j.turnos.length === 1 && duracionAlmuerzo > 0;
    if (j.puedeDescontarAlmuerzo && !j.jornadaContinua) {
      const inicioAlmuerzo = Math.floor(fechaDia / 60000) + minutosDeHora(reglas.almuerzoInicio);
      const finAlmuerzo = inicioAlmuerzo + duracionAlmuerzo;
      const [inicio, fin] = tramos[0];
      if (inicio <= inicioAlmuerzo && fin >= finAlmuerzo) {
        tramos = [[inicio, inicioAlmuerzo], [finAlmuerzo, fin]];
        j.almuerzoDescontado = duracionAlmuerzo;
      }
    }

    let ordinariosSabado = 0;
    tramos.forEach(([inicio, fin]) => {
      for (let minuto = inicio; minuto < fin; minuto++) {
        const momento = new Date(minuto * 60000);
        const delDia = momento.getHours() * 60 + momento.getMinutes();
        const noche = esNoche(delDia);
        let ordinario = false;
        if (esDominicalOFestivo(momento)) {
          j[noche ? "fesNoc" : "fes"]++;
          j.minutos++;
          continue;
        }
        if (momento.getDay() === 6) {
          // Sábado: las primeras horas trabajadas (de día) son ordinarias, sin importar la hora
          ordinario = !noche && ordinariosSabado < minutosSabado;
          if (ordinario) ordinariosSabado++;
        } else {
          ordinario = delDia >= horarioSemana[0] && delDia < horarioSemana[1];
        }
        if (ordinario) j.ord++;
        else j[noche ? "extNoc" : "ext"]++;
        j.minutos++;
      }
    });

    // Extras redondeadas a la hora completa (30 min o más sube)
    ["ext", "extNoc", "fes", "fesNoc"].forEach((k) => (j[k] = redondearAHora(j[k])));
    j.minutos = j.ord + j.ext + j.extNoc + j.fes + j.fesNoc;

    // Kilometraje: primera y última lectura del día
    const lecturas = j.marcaciones.filter((m) => m.km !== undefined && m.km !== null && m.km !== "" && !isNaN(Number(m.km)))
      .map((m) => Number(m.km));
    j.kmInicial = lecturas.length ? lecturas[0] : null;
    j.kmFinal = lecturas.length > 1 ? lecturas[lecturas.length - 1] : null;
    j.kmRecorridos = j.kmFinal !== null && j.kmFinal >= j.kmInicial ? j.kmFinal - j.kmInicial : null;
    j.revisarKm = j.kmFinal !== null && j.kmFinal < j.kmInicial;

    const entrada = j.marcaciones.find((m) => m.tipo === "entrada");
    const ultimoTurno = j.turnos[j.turnos.length - 1];
    j.entrada = entrada ? entrada.fechaLocal : "";
    j.entradaTarde = esEntradaTarde(j.entrada, reglas);
    j.salida = !j.faltaSalida && ultimoTurno ? ultimoTurno.salida.fechaLocal : "";
    j.salidaOtroDia = !!(j.salida && claveDeFecha(new Date(j.salida)) !== j.dia);
  });

  // Una salida que cerró un turno del día anterior no forma una jornada aparte
  return [...jornadas.values()].filter((j) => j.turnos.length || j.faltaSalida || j.revisar || j.novedad
    || j.marcaciones.some((m) => m.tipo === "entrada"));
}

// 85 min -> 60, 30 min -> 60, 29 min -> 0
function redondearAHora(minutos) {
  return Math.round(minutos / 60) * 60;
}

function sumarJornadas(lista) {
  const total = { dias: 0, minutos: 0, ord: 0, ext: 0, extNoc: 0, fes: 0, fesNoc: 0, km: 0, novedades: 0 };
  lista.forEach((j) => {
    if (j.minutos) total.dias++;
    if (j.novedad) total.novedades++;
    total.km += j.kmRecorridos || 0;
    ["minutos", "ord", "ext", "extNoc", "fes", "fesNoc"].forEach((k) => (total[k] += j[k]));
  });
  return total;
}

// 513 minutos -> "8:33"
function horasYMinutos(minutos) {
  return `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, "0")}`;
}

if (typeof module !== "undefined") {
  module.exports = { calcularJornadas, redondearAHora, esEntradaTarde, sumarJornadas, festivosColombia, horasYMinutos, REGLAS_HORAS_BASE };
}
