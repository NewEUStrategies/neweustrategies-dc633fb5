/**
 * Wołacz (vocative) dla polskich imion.
 *
 * Używany w e-mailach systemowych, żeby powitanie brzmiało naturalnie
 * ("Cześć, Marku" zamiast "Cześć, Marek"). Zasada bezpieczeństwa: jeśli imię
 * jest nietypowe (obce znaki, inicjały, wielowyrazowe), zwracamy mianownik -
 * lepiej neutralnie niż błędnie.
 */

export type PolishGender = "male" | "female" | "unknown";

/** Wyjątki, których nie da się poprawnie wyprowadzić regułami. */
const IRREGULAR: Record<string, string> = {
  paweł: "Pawle",
  karol: "Karolu",
  michał: "Michale",
  rafał: "Rafale",
  witold: "Witoldzie",
  piotr: "Piotrze",
  marek: "Marku",
  jacek: "Jacku",
  wojtek: "Wojtku",
  darek: "Darku",
  radek: "Radku",
  aleksander: "Aleksandrze",
  kazimierz: "Kazimierzu",
  ignacy: "Ignacy",
  antoni: "Antoni",
  jerzy: "Jerzy",
  maciej: "Macieju",
  andrzej: "Andrzeju",
  bartosz: "Bartoszu",
  łukasz: "Łukaszu",
  tomasz: "Tomaszu",
  grzegorz: "Grzegorzu",
  ola: "Olu",
  ala: "Alu",
  ula: "Ulu",
  ela: "Elu",
  iza: "Izo",
  kuba: "Kubo",
  barnaba: "Barnabo",
};

/** Męskie imiona zakończone na -a. */
const MALE_A = new Set(["kuba", "barnaba", "bonawentura", "aleksy", "kosma"]);

const POLISH_NAME_RE = /^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż'-]+$/;

function isVowel(ch: string): boolean {
  return "aeiouyąęóAEIOUYĄĘÓ".includes(ch);
}

function keepCase(source: string, produced: string): string {
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return produced.charAt(0).toUpperCase() + produced.slice(1);
  }
  return produced.toLowerCase();
}

export function detectPolishGender(name: string): PolishGender {
  const n = name.trim().toLowerCase();
  if (!n) return "unknown";
  if (MALE_A.has(n)) return "male";
  if (n.endsWith("a")) return "female";
  return "male";
}

function femaleVocative(lower: string): string {
  const stem = lower.slice(0, -1);
  // Zdrobnienia z miękkim tematem: Kasia -> Kasiu, Ania -> Aniu, Zosia -> Zosiu.
  if (/(si|ci|ni|zi|dzi|ki|gi)$/.test(stem)) return `${stem}u`;
  // Krótkie zdrobnienia typu Ola/Ala/Ula.
  if (lower.length <= 4 && stem.endsWith("l")) return `${stem}u`;
  return `${stem}o`;
}

function maleVocative(lower: string): string {
  // Temat zakończony -ek gubi "e": Marek -> Marku, Jacek -> Jacku.
  if (lower.endsWith("ek")) return `${lower.slice(0, -2)}ku`;
  if (/(sz|cz|rz|ż|dz|c|j|l|ń|ś|ź|ch)$/.test(lower)) return `${lower}u`;
  if (/[kg]$/.test(lower)) return `${lower}u`;
  if (lower.endsWith("ł")) return `${lower.slice(0, -1)}le`;
  if (lower.endsWith("r")) return `${lower}ze`;
  if (lower.endsWith("st")) return `${lower.slice(0, -2)}ście`;
  if (lower.endsWith("t")) return `${lower.slice(0, -1)}cie`;
  if (lower.endsWith("d")) return `${lower.slice(0, -1)}dzie`;
  if (lower.endsWith("n")) return `${lower}ie`;
  if (/[bpfwmsz]$/.test(lower)) return `${lower}ie`;
  if (isVowel(lower[lower.length - 1] ?? "")) return lower;
  return `${lower}ie`;
}

/**
 * Zwraca imię w wołaczu. Dla nieznanych/obcych form zwraca wejście bez zmian.
 */
export function polishVocative(rawName: string, gender: PolishGender = "unknown"): string {
  const name = rawName.trim();
  if (!name) return "";
  // Tylko pierwszy człon (np. "Anna Maria" -> "Anno").
  const first = name.split(/\s+/)[0] ?? "";
  if (first.length < 2 || !POLISH_NAME_RE.test(first)) return first;

  const lower = first.toLowerCase();
  const irregular = IRREGULAR[lower];
  if (irregular) return keepCase(first, irregular);

  const resolved = gender === "unknown" ? detectPolishGender(first) : gender;
  const produced = resolved === "female" ? femaleVocative(lower) : maleVocative(lower);
  return keepCase(first, produced);
}

/**
 * Powitanie w mailu: PL używa wołacza, EN mianownika.
 * `vocativeOverride` pochodzi ze słownika imion (admin panel) i ma pierwszeństwo.
 */
export function emailGreeting(
  lang: "pl" | "en",
  firstName?: string | null,
  gender: PolishGender = "unknown",
  vocativeOverride?: string | null,
): string {
  const name = (firstName ?? "").trim();
  if (lang === "pl") {
    const vocative = (vocativeOverride ?? "").trim() || polishVocative(name, gender);
    return vocative ? `Dzień dobry, ${vocative}` : "Dzień dobry";
  }
  return name ? `Hi ${name.split(/\s+/)[0]},` : "Hello,";
}

