/**
 * Wołacz (vocative) dla polskich imion.
 *
 * Używany w e-mailach systemowych, żeby powitanie brzmiało naturalnie
 * ("Cześć, Marku" zamiast "Cześć, Marek"). Zasada bezpieczeństwa: jeśli imię
 * jest nietypowe (obce znaki, inicjały, wielowyrazowe), zwracamy mianownik -
 * lepiej neutralnie niż błędnie.
 *
 * To JEDYNY silnik wołacza w repo: nagłówek widgetu "Tailored must-reads"
 * (`toPlVocative` w `./plVocative`) deleguje tu odmianę każdego członu.
 * Wcześniej widget miał własne reguły i ten sam użytkownik dostawał w mailu
 * "Mateuszu", a na stronie "Mateusu".
 */

export type PolishGender = "male" | "female" | "unknown";

/**
 * Wyjątki, których nie da się poprawnie wyprowadzić regułami.
 *
 * Czytamy WYŁĄCZNIE przez `irregularVocative` (Object.hasOwn): zwykły odczyt
 * `IRREGULAR[imię]` trafiał w Object.prototype, więc imię "Constructor" dawało
 * funkcję zamiast napisu i wołacz rzucał TypeError (a z nim cały mail).
 */
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
  // Ruchome "e" (Kacper, Kacpra) - reguła -r -> -rze dałaby "Kacperze".
  kacper: "Kacprze",
};

function irregularVocative(lower: string): string | undefined {
  return Object.hasOwn(IRREGULAR, lower) ? IRREGULAR[lower].toLowerCase() : undefined;
}

/** Męskie imiona zakończone na -a. */
const MALE_A = new Set(["kuba", "barnaba", "bonawentura", "kosma"]);

const POLISH_NAME_RE = /^[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż'-]+$/;

/** Miękkie spółgłoski przed samogłoską piszemy przez "i": Staś -> Stasiu. */
const SOFT_BEFORE_VOWEL: ReadonlyMap<string, string> = new Map([
  ["ś", "si"],
  ["ź", "zi"],
  ["ć", "ci"],
  ["ń", "ni"],
]);

/**
 * Przenosi wielkość liter z mianownika na wołacz. Wspólny początek zachowuje
 * litery źródła znak po znaku (McDonald -> McDonaldzie, O'Brien -> O'Brienie);
 * dopisana końcówka jest wielka tylko dla imienia pisanego WERSALIKAMI
 * (ANNA -> ANNO). Dawne `keepCase` zmniejszało wszystko poza pierwszą literą,
 * więc "Anna-Maria" wychodziła jako "Anna-mario".
 */
function restoreCase(source: string, producedLower: string): string {
  let same = 0;
  while (
    same < source.length &&
    same < producedLower.length &&
    source[same].toLowerCase() === producedLower[same]
  ) {
    same++;
  }
  const tail = producedLower.slice(same);
  const allCaps = source === source.toUpperCase();
  return source.slice(0, same) + (allCaps ? tail.toUpperCase() : tail);
}

export function detectPolishGender(name: string): PolishGender {
  const n = name.trim().toLowerCase();
  if (!n) return "unknown";
  if (MALE_A.has(n)) return "male";
  if (n.endsWith("a")) return "female";
  return "male";
}

function femaleVocative(lower: string): string {
  // Żeńskie imiona spoza wzorca -a (Nicole, Karin, Miriam) są nieodmienne -
  // bez tego rodzaj "female" ze słownika dawał "Nicolo" i "Kario".
  if (!lower.endsWith("a")) return lower;
  const stem = lower.slice(0, -1);
  // Zdrobnienia z miękkim tematem: Kasia -> Kasiu, Zosia -> Zosiu, Jadzia ->
  // Jadziu. W rodzimej pisowni -sia/-cia/-zia to zawsze zdrobnienie (pełne
  // imiona piszemy przez -j-: Lucja, Felicja, Anastazja).
  if (/(si|ci|zi)$/.test(stem)) return `${stem}u`;
  // -nia bywa zdrobnieniem (Ania, Bronia, Gienia -> -niu) albo pełnym imieniem
  // (Stefania, Melania, Eugenia -> -nio). Zdrobnienie jest dwusylabowe: przed
  // "-nia" stoi jedna samogłoska. "i" przed inną samogłoską tylko zmiękcza
  // (Gie-nia), ale przed spółgłoską tworzy sylabę (Ki-nia -> Kiniu).
  if (/^(?:[^aeiouyąęó]|i(?=[aeouyąęó]))*[aeiouyąęó]nia$/.test(lower)) return `${stem}u`;
  // Krótkie zdrobnienia typu Ola/Ala/Ula.
  if (lower.length <= 4 && stem.endsWith("l")) return `${stem}u`;
  return `${stem}o`;
}

function maleVocative(lower: string): string {
  // Męskie na -a odmieniają się jak żeńskie twardotematowe: Kosma -> Kosmo,
  // Bonawentura -> Bonawenturo (wcześniej wracały w mianowniku).
  if (lower.endsWith("a")) return `${lower.slice(0, -1)}o`;
  // Temat zakończony -ek gubi "e": Marek -> Marku, Jacek -> Jacku.
  if (lower.endsWith("ek")) return `${lower.slice(0, -2)}ku`;
  const soft = SOFT_BEFORE_VOWEL.get(lower.slice(-1));
  if (soft) return `${lower.slice(0, -1)}${soft}u`;
  // Twarde -h odmienia się jak -ch: Noah -> Noahu.
  if (/(sz|cz|rz|dz|[żcjlkgh])$/.test(lower)) return `${lower}u`;
  if (lower.endsWith("ł")) return `${lower.slice(0, -1)}le`;
  if (lower.endsWith("r")) return `${lower}ze`;
  if (lower.endsWith("st")) return `${lower.slice(0, -2)}ście`;
  if (lower.endsWith("t")) return `${lower.slice(0, -1)}cie`;
  if (lower.endsWith("d")) return `${lower.slice(0, -1)}dzie`;
  if (/[nbpfwmszvxq]$/.test(lower)) return `${lower}ie`;
  // Samogłoska na końcu (Jerzy, Antoni, Iwo) - wołacz równy mianownikowi.
  return lower;
}

/** Wołacz pojedynczego członu imienia (bez spacji i łączników). */
function vocativeWord(word: string, gender: PolishGender): string {
  if (word.length < 2 || !POLISH_NAME_RE.test(word)) return word;
  const lower = word.toLowerCase();
  const resolved = gender === "unknown" ? detectPolishGender(lower) : gender;
  const produced =
    irregularVocative(lower) ??
    (resolved === "female" ? femaleVocative(lower) : maleVocative(lower));
  return restoreCase(word, produced);
}

/**
 * Odmienia KAŻDY człon rozdzielony spacją lub łącznikiem ("Anna-Maria" ->
 * "Anno-Mario", "Jan Paweł" -> "Janie Pawle"); separatory zostają bez zmian,
 * a człony nietypowe (inicjały, cyfry, obce znaki) wracają w mianowniku.
 */
export function polishVocativeParts(text: string, gender: PolishGender = "unknown"): string {
  return text
    .split(/(\s|-)/)
    .map((part) => vocativeWord(part, gender))
    .join("");
}

/**
 * Zwraca imię w wołaczu. Dla nieznanych/obcych form zwraca wejście bez zmian.
 */
export function polishVocative(rawName: string, gender: PolishGender = "unknown"): string {
  // Tylko pierwszy człon (np. "Anna Maria" -> "Anno").
  // `split` zawsze zwraca co najmniej jeden element (dla "" - [""]).
  const first = rawName.trim().split(/\s+/)[0];
  return polishVocativeParts(first, gender);
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
