// Prosty wołacz dla polskich imion. Nie zastąpi pełnej gramatyki, ale pokrywa
// najczęstsze przypadki użyte w personalizowanych nagłówkach ("Twoje wybory
// dla ciebie, Igorze!"). Fallback: mianownik.
//
// Reguły wywiedzione z popularnych imion PL:
// - żeńskie na -a  -> -o           (Anna → Anno, Maria → Mario)
//   wyjątki:  -ia -> -io           (Julia → Julio, Zofia → Zofio)
//             -ja -> -jo           (Maja → Majo)
// - męskie na spółgłoskę:
//   -ek/-ec        -> -ku/-cu      (Marek → Marku, Piotrek → Piotrku)
//   -ch/-h/-g/-k   -> +u           (Ludwik → Ludwiku)
//   -j/-l/-ń/-ś/-ź/-ć -> +u        (Michał → Michale? nie: -ł spółgł. twarda)
//   pozostałe spółgłoski -> -e z palatalizacją najczęstszą (Piotr → Piotrze,
//   Igor → Igorze, Adam → Adamie, Tomasz → Tomaszu)
// - męskie na -o    -> zachowaj    (Iwo → Iwo)
// - męskie na -y/-i -> zachowaj    (Jerzy → Jerzy)
// - męskie na -a    -> -o          (Kuba → Kubo)

const FEMININE_A_EXCEPTIONS: Record<string, string> = {};

function isVowel(ch: string): boolean {
  return "aeiouyąęó".includes(ch.toLowerCase());
}

function preserveCase(source: string, transformed: string): string {
  if (source === source.toUpperCase()) return transformed.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return transformed[0].toUpperCase() + transformed.slice(1);
  }
  return transformed;
}

function transformOne(nameRaw: string): string {
  const name = nameRaw.trim();
  if (!name) return name;
  const lower = name.toLowerCase();
  const last = lower.slice(-1);
  const last2 = lower.slice(-2);
  const last3 = lower.slice(-3);

  // Wyjątki
  const key = lower;
  if (FEMININE_A_EXCEPTIONS[key]) {
    return preserveCase(name, FEMININE_A_EXCEPTIONS[key]);
  }

  // Zakończenia na -a
  if (last === "a") {
    if (last3 === "ia") return preserveCase(name, lower.slice(0, -1) + "o");
    if (last2 === "ja") return preserveCase(name, lower.slice(0, -1) + "o");
    // Anna -> Anno; Kuba (męskie) -> Kubo
    return preserveCase(name, lower.slice(0, -1) + "o");
  }

  // Zakończenia samogłoskowe (-o, -e, -y, -i, -u) - zwykle bez zmian
  if (isVowel(last)) return name;

  // -ek -> -ku  (Marek -> Marku)
  if (last2 === "ek") return preserveCase(name, lower.slice(0, -2) + "ku");
  // -ec -> -cu  (Wojciec... itd.)
  if (last2 === "ec") return preserveCase(name, lower.slice(0, -2) + "cu");
  // -eusz/-usz -> -szu (Mateusz -> Mateuszu)
  if (last3 === "usz" || last3 === "esz")
    return preserveCase(name, lower.slice(0, -3) + last3.slice(0, 2) + "u");
  // szeleszczące / miękkie -> +u
  if ("chghkjlńśźćż".includes(last)) return preserveCase(name, lower + "u");
  if (last2 === "sz" || last2 === "cz" || last2 === "rz")
    return preserveCase(name, lower + "u");
  // -ł twarda spółgł.: Michał -> Michale
  if (last === "ł") return preserveCase(name, lower.slice(0, -1) + "le");
  // -r -> -rze (Piotr -> Piotrze, Igor -> Igorze)
  if (last === "r") return preserveCase(name, lower + "ze");
  // -t -> -cie (Robert -> Robercie)
  if (last === "t") return preserveCase(name, lower.slice(0, -1) + "cie");
  // -d -> -dzie
  if (last === "d") return preserveCase(name, lower.slice(0, -1) + "dzie");
  // -s -> -sie, -z -> -zie
  if (last === "s") return preserveCase(name, lower.slice(0, -1) + "sie");
  if (last === "z") return preserveCase(name, lower.slice(0, -1) + "zie");
  // pozostałe spółgłoski (m, n, b, p, w, f) -> +ie (Adam -> Adamie)
  return preserveCase(name, lower + "ie");
}

/**
 * Zwraca formę wołacza dla polskich imion (heurystyka). Obsługuje imiona
 * złożone rozdzielone spacją lub myślnikiem (Anna-Maria -> Anno-Mario).
 */
export function toPlVocative(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/(\s|-)/)
    .map((part) => (/^[\s-]$/.test(part) ? part : transformOne(part)))
    .join("");
}
