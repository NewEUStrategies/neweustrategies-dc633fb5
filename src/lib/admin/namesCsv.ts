// Import/eksport CSV słownika imion - CZYSTE FUNKCJE, zero I/O i zero stanu.
//
// PO CO OSOBNY MODUŁ. Cała ta logika mieszkała w `src/routes/admin.names.tsx`
// (1365 linii, 0% pokrycia), gdzie dawała się sprawdzić WYŁĄCZNIE przez
// klikanie po zamontowanej trasie: żeby dowieść, że plik z BOM-em albo
// z przecinkiem wewnątrz cudzysłowów mapuje się na właściwe kolumny, trzeba
// było zbudować `File`, podać go do ukrytego inputu i czytać wynik z tabeli
// podglądu. Reguły mapowania kolumn, dedupe po `key` i normalizacja kraju są
// jednak FUNKCJAMI - jedno wejście, jedno wyjście - więc tutaj sprawdza je
// tabela `it.each`, a trasa dowodzi już tylko SKLEJENIA (że woła te funkcje
// i respektuje ich wynik).
//
// CZEGO TU NIE MA I MIEĆ NIE BĘDZIE: dostępu do bazy, toastów, tłumaczeń,
// `Date`, losowości. Funkcje zwracają dane albo `null`; decyzję o komunikacie
// podejmuje trasa. Dzięki temu ten sam kod obsłuży kiedyś import wsadowy
// ze skryptu, bez montowania Reacta.
//
// UWAGA - TO JEST PRZENIESIENIE, NIE POPRAWKA. Zachowanie jest ZNAK W ZNAK
// takie, jak w trasie przed wyprowadzeniem, razem z jego wadami (separator
// `;`, BOM). Wady są opisane `it.fails` w
// `src/lib/admin/__tests__/namesCsv.test.ts` - naprawa to osobna praca,
// bo zmienia wynik importu, a refaktor nie może.
import { normalize, type Gender } from "@/lib/greetings/greetings";

/**
 * Kraj pochodzenia imienia: kod ISO + etykieta PL/EN + aliasy wejściowe.
 *
 * `aliases` to nie ozdoba, a sedno importu: użytkownicy wpisują w kolumnie
 * `origin` przymiotnik językowy („polskie", „german"), nazwę w dowolnym
 * z dwóch języków albo kod - a w bazie musi wylądować JEDEN kanoniczny kod,
 * inaczej filtr kraju rozjeżdża się na trzy warianty tego samego kraju.
 */
export interface NameOriginCountry {
  readonly code: string;
  readonly pl: string;
  readonly en: string;
  readonly aliases?: readonly string[];
}

export const NAME_ORIGIN_COUNTRIES: readonly NameOriginCountry[] = [
  {
    code: "PL",
    pl: "Polska",
    en: "Poland",
    aliases: ["polish", "polski", "polskie", "pl", "polonia", "pologne", "polen"],
  },
  {
    code: "US",
    pl: "USA",
    en: "United States",
    aliases: [
      "usa",
      "us",
      "u.s.",
      "u.s.a.",
      "united states of america",
      "america",
      "american",
      "stany zjednoczone",
      "stany",
      "estados unidos",
    ],
  },
  {
    code: "GB",
    pl: "Wielka Brytania",
    en: "United Kingdom",
    aliases: [
      "english",
      "angielski",
      "british",
      "britain",
      "great britain",
      "uk",
      "u.k.",
      "gb",
      "england",
      "anglia",
      "brytyjski",
    ],
  },
  {
    code: "DE",
    pl: "Niemcy",
    en: "Germany",
    aliases: ["german", "niemiecki", "de", "deutschland", "allemagne"],
  },
  {
    code: "FR",
    pl: "Francja",
    en: "France",
    aliases: ["french", "francuski", "fr", "francais", "français"],
  },
  {
    code: "IT",
    pl: "Włochy",
    en: "Italy",
    aliases: ["italian", "włoski", "wloski", "it", "italia", "italie"],
  },
  {
    code: "ES",
    pl: "Hiszpania",
    en: "Spain",
    aliases: ["spanish", "hiszpański", "hiszpanski", "es", "espana", "españa", "espagne"],
  },
  { code: "PT", pl: "Portugalia", en: "Portugal", aliases: ["portuguese", "portugalski", "pt"] },
  {
    code: "UA",
    pl: "Ukraina",
    en: "Ukraine",
    aliases: ["ukrainian", "ukraiński", "ukrainski", "ua"],
  },
  { code: "CZ", pl: "Czechy", en: "Czechia", aliases: ["czech", "czech republic", "czeski", "cz"] },
  { code: "SK", pl: "Słowacja", en: "Slovakia", aliases: ["slovak", "słowacki", "slowacki", "sk"] },
  { code: "LT", pl: "Litwa", en: "Lithuania", aliases: ["lithuanian", "litewski", "lt"] },
  {
    code: "BY",
    pl: "Białoruś",
    en: "Belarus",
    aliases: ["belarusian", "białoruski", "bialoruski", "by"],
  },
  {
    code: "RU",
    pl: "Rosja",
    en: "Russia",
    aliases: ["russian", "rosyjski", "ru", "russian federation"],
  },
  { code: "GR", pl: "Grecja", en: "Greece", aliases: ["greek", "grecki", "gr", "hellas"] },
  {
    code: "TR",
    pl: "Turcja",
    en: "Turkey",
    aliases: ["turkish", "turecki", "tr", "türkiye", "turkiye"],
  },
  {
    code: "JP",
    pl: "Japonia",
    en: "Japan",
    aliases: ["japanese", "japoński", "japonski", "jp", "nippon"],
  },
  { code: "CN", pl: "Chiny", en: "China", aliases: ["chinese", "chiński", "chinski", "cn", "prc"] },
  { code: "IN", pl: "Indie", en: "India", aliases: ["hindi", "indian", "indyjski", "in"] },
  {
    code: "SA",
    pl: "Arabia Saudyjska",
    en: "Saudi Arabia",
    aliases: ["arabic", "arabski", "arab", "sa"],
  },
  {
    code: "SE",
    pl: "Szwecja",
    en: "Sweden",
    aliases: ["swedish", "szwedzki", "scandinavian", "skandynawski", "se", "sverige"],
  },
  { code: "NO", pl: "Norwegia", en: "Norway", aliases: ["norwegian", "norweski", "no", "norge"] },
  {
    code: "FI",
    pl: "Finlandia",
    en: "Finland",
    aliases: ["finnish", "fiński", "finski", "fi", "suomi"],
  },
  {
    code: "DK",
    pl: "Dania",
    en: "Denmark",
    aliases: ["danish", "duński", "dunski", "dk", "danmark"],
  },
  {
    code: "NL",
    pl: "Holandia",
    en: "Netherlands",
    aliases: ["dutch", "holenderski", "nl", "holland", "the netherlands", "nederland"],
  },
  {
    code: "IE",
    pl: "Irlandia",
    en: "Ireland",
    aliases: ["irish", "irlandzki", "ie", "eire", "éire"],
  },
  { code: "RO", pl: "Rumunia", en: "Romania", aliases: ["romanian", "rumuński", "rumunski", "ro"] },
  {
    code: "HU",
    pl: "Węgry",
    en: "Hungary",
    aliases: ["hungarian", "węgierski", "wegierski", "hu", "magyarorszag", "magyarország"],
  },
  {
    code: "BG",
    pl: "Bułgaria",
    en: "Bulgaria",
    aliases: ["bulgarian", "bułgarski", "bulgarski", "bg"],
  },
  {
    code: "AT",
    pl: "Austria",
    en: "Austria",
    aliases: ["austrian", "austriacki", "at", "österreich", "osterreich"],
  },
  {
    code: "CH",
    pl: "Szwajcaria",
    en: "Switzerland",
    aliases: ["swiss", "szwajcarski", "ch", "schweiz", "suisse"],
  },
  {
    code: "BE",
    pl: "Belgia",
    en: "Belgium",
    aliases: ["belgian", "belgijski", "be", "belgique", "belgie", "belgië"],
  },
  { code: "CA", pl: "Kanada", en: "Canada", aliases: ["canadian", "kanadyjski", "ca"] },
  { code: "AU", pl: "Australia", en: "Australia", aliases: ["australian", "australijski", "au"] },
  {
    code: "BR",
    pl: "Brazylia",
    en: "Brazil",
    aliases: ["brazilian", "brazylijski", "br", "brasil"],
  },
  {
    code: "MX",
    pl: "Meksyk",
    en: "Mexico",
    aliases: ["mexican", "meksykański", "meksykanski", "mx", "mejico", "méjico"],
  },
  {
    code: "AR",
    pl: "Argentyna",
    en: "Argentina",
    aliases: ["argentinian", "argentyński", "argentynski", "ar"],
  },
  {
    code: "KR",
    pl: "Korea Południowa",
    en: "South Korea",
    aliases: ["korean", "koreański", "koreanski", "kr", "korea", "republic of korea"],
  },
  {
    code: "VN",
    pl: "Wietnam",
    en: "Vietnam",
    aliases: ["vietnamese", "wietnamski", "vn", "viet nam"],
  },
  { code: "TH", pl: "Tajlandia", en: "Thailand", aliases: ["thai", "tajski", "th"] },
  { code: "ID", pl: "Indonezja", en: "Indonesia", aliases: ["indonesian", "indonezyjski", "id"] },
  {
    code: "PH",
    pl: "Filipiny",
    en: "Philippines",
    aliases: ["filipino", "filipiński", "filipinski", "ph"],
  },
  {
    code: "ZA",
    pl: "RPA",
    en: "South Africa",
    aliases: ["south african", "południowoafrykański", "za", "rpa"],
  },
  { code: "EG", pl: "Egipt", en: "Egypt", aliases: ["egyptian", "egipski", "eg"] },
  {
    code: "IL",
    pl: "Izrael",
    en: "Israel",
    aliases: ["israeli", "izraelski", "hebrew", "hebrajski", "il"],
  },
  { code: "IR", pl: "Iran", en: "Iran", aliases: ["iranian", "persian", "perski", "ir"] },
  {
    code: "PK",
    pl: "Pakistan",
    en: "Pakistan",
    aliases: ["pakistani", "pakistański", "pakistanski", "pk", "urdu"],
  },
  {
    code: "RS",
    pl: "Serbia",
    en: "Serbia",
    aliases: [
      "serbian",
      "serbski",
      "rs",
      "srbija",
      "balkan",
      "bałkany",
      "balkany",
      "balkański",
      "balkanski",
    ],
  },
  { code: "OTHER", pl: "Inny", en: "Other", aliases: ["other", "inny"] },
];

/**
 * Normalizacja wejścia kraju: bez diakrytyków, bez kropek i podkreśleń,
 * pojedyncze spacje, małe litery. `u.s.a.` i `USA`, `Türkiye` i `turkiye`
 * muszą trafić w ten sam wiersz tabeli.
 */
export function normalizeCountryInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dowolne wejście (nazwa PL/EN, kod ISO, przymiotnik językowy) -> kanoniczny
 * wpis tabeli krajów. `null`, gdy nic nie pasuje: WTEDY trasa zapisuje surową
 * wartość, żeby nie zgubić informacji wpisanej przez człowieka.
 */
export function resolveCountry(input: string | null | undefined): NameOriginCountry | null {
  if (!input) return null;
  const q = normalizeCountryInput(input);
  if (!q) return null;
  for (const c of NAME_ORIGIN_COUNTRIES) {
    if (normalizeCountryInput(c.code) === q) return c;
    if (normalizeCountryInput(c.pl) === q) return c;
    if (normalizeCountryInput(c.en) === q) return c;
    if (c.aliases?.some((a) => normalizeCountryInput(a) === q)) return c;
  }
  return null;
}

/**
 * Wartość do zapisu w kolumnach `origin`/`origin_country`: kod ISO, gdy kraj
 * rozpoznany, w przeciwnym razie surowe wejście (nigdy pusty napis - patrz
 * `parseNameCsvRow`, gdzie puste wejście staje się `null`).
 */
export function resolveOriginCode(origin: string | null | undefined): string | null {
  return resolveCountry(origin)?.code ?? origin ?? null;
}

/** Kolumny CSV w kolejności kanonicznej - nagłówek eksportu i szablonu. */
export const NAMES_CSV_COLUMNS = [
  "key",
  "display_name",
  "vocative",
  "instrumental",
  "genitive",
  "dative",
  "english_form",
  "gender",
  "is_compound",
  "origin",
  "notes",
] as const;

/**
 * Cytowanie pola CSV. Średnik jest tu w klasie znaków SPECJALNIE: arkusze
 * w polskiej lokalizacji czytają `;` jako separator, więc pole je zawierające
 * musi wyjść w cudzysłowach, inaczej eksport rozpada się przy powtórnym
 * otwarciu w Excelu.
 */
export function escapeCsvValue(value: string): string {
  if (value === "") return "";
  if (/[",\n\r;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Pola wiersza słownika, które czyta eksport i dedupe.
 *
 * Kształt jest JAWNY, a nie `Tables<"name_dictionary">`, bo ten moduł nie ma
 * prawa wiedzieć o kliencie bazy - a trasa i tak przekazuje tu swój `NameRow`
 * wyprowadzony z typów generowanych, więc niezgodność kolumny nadal jest
 * błędem kompilacji (tylko po stronie wywołania).
 *
 * `is_compound` jest `boolean | null`, choć w wygenerowanych typach kolumna
 * jest NOT NULL: szerszy typ przyjmuje węższy, a `null` z historycznych
 * wierszy nie wywala dedupe.
 */
export interface NameDictionaryFields {
  readonly name: string;
  readonly name_normalized: string;
  readonly key: string | null;
  readonly display_name: string | null;
  readonly gender: Gender;
  readonly origin_country: string | null;
  readonly origin: string | null;
  readonly vocative_pl: string | null;
  readonly instrumental_pl: string | null;
  readonly genitive_pl: string | null;
  readonly dative_pl: string | null;
  readonly vocative_en: string | null;
  readonly english_form: string | null;
  readonly is_compound: boolean | null;
  readonly notes: string | null;
}

/**
 * Serializacja słownika do CSV. Kolumny stare (`name`, `name_normalized`,
 * `vocative_en`, `origin_country`) są ZAPASEM dla nowych - eksport ma być
 * kompletny także dla wierszy sprzed migracji na `key`/`display_name`.
 */
export function serializeNamesCsv(rows: readonly NameDictionaryFields[]): string {
  const head = NAMES_CSV_COLUMNS.join(",");
  const body = rows.map((r) =>
    [
      r.key ?? r.name_normalized,
      r.display_name ?? r.name,
      r.vocative_pl ?? "",
      r.instrumental_pl ?? "",
      r.genitive_pl ?? "",
      r.dative_pl ?? "",
      r.english_form ?? r.vocative_en ?? "",
      r.gender,
      r.is_compound ? "true" : "false",
      r.origin ?? r.origin_country ?? "",
      r.notes ?? "",
    ]
      .map((v) => escapeCsvValue(String(v)))
      .join(","),
  );
  return [head, ...body].join("\n");
}

/** Klucz dedupe wiersza słownika: `key`, a dla wierszy przedmigracyjnych - `name_normalized`. */
export function nameRowKey(row: Pick<NameDictionaryFields, "key" | "name_normalized">): string {
  return row.key ?? row.name_normalized;
}

/**
 * Indeks słownika po kluczu dedupe. Przy duplikacie w BAZIE wygrywa wiersz
 * PÓŹNIEJSZY (`Map` nadpisuje) - tak samo jak przed wyprowadzeniem.
 */
export function indexNamesByKey<T extends Pick<NameDictionaryFields, "key" | "name_normalized">>(
  rows: readonly T[],
): Map<string, T> {
  return new Map(rows.map((row) => [nameRowKey(row), row] as const));
}

/**
 * Minimalny parser CSV: cudzysłowy, `""` jako cudzysłów wewnątrz pola,
 * przecinki i przełamania linii wewnątrz cudzysłowów, CRLF i LF.
 *
 * Wiersze, w których KAŻDA komórka jest pusta po obcięciu spacji, wypadają -
 * to jedyny sposób, żeby stopka arkusza (`,,,,`) i ogon pliku nie tworzyły
 * pustych wpisów w słowniku.
 */
export function parseCsvMatrix(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur);
        cur = "";
        out.push(row);
        row = [];
      } else {
        cur += ch;
      }
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Wiersz CSV po zmapowaniu na pola słownika - jeszcze bez kontaktu z bazą. */
export interface ParsedNameCsvRow {
  readonly key: string;
  readonly display_name: string;
  readonly vocative_pl: string | null;
  readonly instrumental_pl: string | null;
  readonly genitive_pl: string | null;
  readonly dative_pl: string | null;
  readonly english_form: string | null;
  readonly gender: Gender;
  readonly is_compound: boolean;
  readonly origin: string | null;
  readonly notes: string | null;
}

/**
 * Nagłówek CSV do postaci używanej przy dopasowaniu kolumn: bez spacji
 * brzegowych, małymi literami. Kolejność kolumn NIE MA znaczenia - dopasowanie
 * idzie po nazwie, nie po pozycji.
 */
export function normalizeCsvHeaders(cells: readonly string[]): string[] {
  return cells.map((h) => h.trim().toLowerCase());
}

/**
 * Jeden wiersz CSV -> pola słownika. `null`, gdy nie da się ustalić imienia
 * (brak `display_name` i `name`) - taki wiersz nie ma czego wstawić.
 *
 * Aliasy nazw kolumn są dwujęzyczne i bezdiakrytyczne (`wolacz`/`wołacz`,
 * `zlozone`/`złożone`), bo pliki przychodzą i z arkuszy polskich, i z eksportów
 * angielskich.
 */
export function parseNameCsvRow(
  headers: readonly string[],
  cells: readonly string[],
): ParsedNameCsvRow | null {
  const get = (h: string) => {
    const idx = headers.indexOf(h);
    return idx >= 0 ? (cells[idx] ?? "").trim() : "";
  };
  const display = get("display_name") || get("name");
  if (!display) return null;
  const rawGender = get("gender").toLowerCase();
  const gender: Gender =
    rawGender === "female" || rawGender === "f" || rawGender === "ż" || rawGender === "z"
      ? "female"
      : rawGender === "neutral" || rawGender === "n"
        ? "neutral"
        : "male";
  const key = (get("key") || normalize(display)).toLowerCase();
  const truthy = (s: string) => /^(1|true|tak|yes|y|t)$/i.test(s);
  const rawOrigin = get("origin") || get("origin_country") || get("country") || get("kraj") || null;
  const resolved = resolveCountry(rawOrigin);
  return {
    key,
    display_name: display,
    vocative_pl: get("vocative") || get("vocative_pl") || get("wolacz") || get("wołacz") || null,
    instrumental_pl:
      get("instrumental") || get("instrumental_pl") || get("narzednik") || get("narzędnik") || null,
    genitive_pl:
      get("genitive") || get("genitive_pl") || get("dopelniacz") || get("dopełniacz") || null,
    dative_pl: get("dative") || get("dative_pl") || get("celownik") || null,
    english_form: get("english_form") || get("vocative_en") || get("english") || null,
    gender,
    is_compound:
      truthy(get("is_compound")) ||
      truthy(get("compound")) ||
      truthy(get("zlozone")) ||
      truthy(get("złożone")),
    origin: resolved?.code ?? (rawOrigin || null),
    notes: get("notes") || null,
  };
}

/** Cały plik CSV po zmapowaniu: wykryte nagłówki + wiersze nadające się do zapisu. */
export interface ParsedNamesCsv {
  readonly headers: readonly string[];
  readonly rows: readonly ParsedNameCsvRow[];
}

/**
 * Plik CSV -> nagłówki + wiersze. PUSTE `headers` znaczy „plik bez ani jednego
 * niepustego wiersza" - to jedyny sygnał, po którym trasa rozpoznaje pusty
 * plik, bo `parseCsvMatrix` nigdy nie zwraca wiersza o zerowej liczbie komórek.
 */
export function parseNamesCsv(text: string): ParsedNamesCsv {
  const matrix = parseCsvMatrix(text);
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = normalizeCsvHeaders(matrix[0]);
  const rows = matrix
    .slice(1)
    .map((cells) => parseNameCsvRow(headers, cells))
    .filter((row): row is ParsedNameCsvRow => row !== null);
  return { headers, rows };
}

/**
 * Pola, których obecność decyduje o klasyfikacji duplikatu: „scal” czy „pomiń”.
 *
 * Lista jest KRÓTSZA niż ładunek z `buildNameMergePatch` (nie ma tu
 * `vocative_en`, `origin_country`, `is_compound`) - dokładnie tak, jak było
 * w trasie. Ta różnica jest źródłem rozjazdu podglądu z zapisem, opisanego
 * `it.fails` w teście modułu.
 */
export const NAME_MERGE_CHECK_FIELDS = [
  "vocative_pl",
  "instrumental_pl",
  "genitive_pl",
  "dative_pl",
  "english_form",
  "origin",
  "notes",
] as const;

/** Nazwa pola z `NAME_MERGE_CHECK_FIELDS` - wspólna dla wiersza CSV i wiersza słownika. */
export type NameMergeCheckField = (typeof NAME_MERGE_CHECK_FIELDS)[number];

/**
 * „Puste” w rozumieniu dedupe: `null`, brak wartości albo pusty napis.
 *
 * `false` NIE jest puste - i to nie przeoczenie, a przeniesiona jeden do
 * jednego reguła z trasy. Konsekwencja dla `is_compound` jest opisana przy
 * `buildNameMergePatch`.
 */
function isBlank(value: string | boolean | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

/** Co import zrobi z jednym wierszem CSV. */
export type NameImportAction = "add" | "merge" | "skip";

/**
 * Klasyfikacja wiersza CSV wobec słownika: DODAJ (brak klucza), SCAL (klucz
 * jest, ale wiersz wnosi wartość do pustej kolumny), POMIŃ (nic nowego).
 *
 * To jest dedupe po `key` Z UZUPEŁNIANIEM: duplikat nie jest odrzucany
 * z automatu - jeśli późniejszy wiersz ma wołacz, którego w słowniku brakuje,
 * wchodzi do scalenia.
 */
export function classifyNameImportRow(
  existing: NameDictionaryFields | undefined,
  row: ParsedNameCsvRow,
): NameImportAction {
  if (!existing) return "add";
  const bringsSomething = NAME_MERGE_CHECK_FIELDS.some(
    (field) => !isBlank(row[field]) && isBlank(existing[field]),
  );
  return bringsSomething ? "merge" : "skip";
}

/**
 * Łatka scalenia - WYŁĄCZNIE pola, które w słowniku są puste. Import nigdy
 * nie nadpisuje danych wpisanych ręcznie przez redakcję; to reguła produktu,
 * nie ostrożność.
 */
export interface NameMergePatch {
  vocative_pl?: string | null;
  instrumental_pl?: string | null;
  genitive_pl?: string | null;
  dative_pl?: string | null;
  english_form?: string | null;
  vocative_en?: string | null;
  origin?: string | null;
  origin_country?: string | null;
  is_compound?: boolean;
  notes?: string | null;
}

/**
 * Buduje łatkę scalenia dla istniejącego wiersza słownika.
 *
 * `english_form` z CSV trafia do DWÓCH kolumn (`english_form` i historycznej
 * `vocative_en`), a kod kraju do `origin` i `origin_country` - każda para jest
 * uzupełniana NIEZALEŻNIE, bo w bazie bywa wypełniona tylko jedna z nich.
 *
 * GAŁĄŹ PRAKTYCZNIE NIEOSIĄGALNA W PRODUKCJI: `is_compound`. W wygenerowanych
 * typach kolumna jest `boolean` NOT NULL, a `isBlank(false) === false`, więc
 * dla realnego wiersza warunek „w słowniku puste” nigdy nie wypada prawdziwie
 * i flaga złożoności nie zostaje uzupełniona z CSV. Kod zostaje bez zmian
 * (to refaktor), a test dowodzi obu ramion na wierszu z `null` - jedynym,
 * jaki może wynikać z danych przedmigracyjnych.
 */
export function buildNameMergePatch(
  existing: NameDictionaryFields,
  row: ParsedNameCsvRow,
): NameMergePatch {
  const patch: NameMergePatch = {};
  const iso = resolveOriginCode(row.origin);
  const fillText = (
    column: "vocative_pl" | "instrumental_pl" | "genitive_pl" | "dative_pl" | "notes",
    value: string | null,
  ) => {
    if (isBlank(value)) return;
    if (isBlank(existing[column])) patch[column] = value;
  };
  fillText("vocative_pl", row.vocative_pl);
  fillText("instrumental_pl", row.instrumental_pl);
  fillText("genitive_pl", row.genitive_pl);
  fillText("dative_pl", row.dative_pl);
  if (!isBlank(row.english_form)) {
    if (isBlank(existing.english_form)) patch.english_form = row.english_form;
    if (isBlank(existing.vocative_en)) patch.vocative_en = row.english_form;
  }
  if (!isBlank(iso)) {
    if (isBlank(existing.origin)) patch.origin = iso;
    if (isBlank(existing.origin_country)) patch.origin_country = iso;
  }
  if (row.is_compound && isBlank(existing.is_compound)) patch.is_compound = true;
  fillText("notes", row.notes);
  return patch;
}

/** Ładunek wstawienia nowego wiersza słownika z wiersza CSV. */
export interface NameInsertPayload {
  readonly name: string;
  readonly name_normalized: string;
  readonly key: string;
  readonly display_name: string;
  readonly gender: Gender;
  readonly origin_country: string | null;
  readonly origin: string | null;
  readonly vocative_pl: string | null;
  readonly instrumental_pl: string | null;
  readonly genitive_pl: string | null;
  readonly dative_pl: string | null;
  readonly english_form: string | null;
  readonly vocative_en: string | null;
  readonly is_compound: boolean;
  readonly notes: string | null;
}

/**
 * Wiersz CSV -> ładunek INSERT. Kraj idzie do OBU kolumn jako kanoniczny kod
 * ISO, żeby „Polska” z jednego pliku i „Poland” z drugiego dały ten sam wpis.
 */
export function buildNameInsertPayload(row: ParsedNameCsvRow): NameInsertPayload {
  const iso = resolveOriginCode(row.origin);
  return {
    name: row.display_name,
    name_normalized: normalize(row.display_name),
    key: row.key,
    display_name: row.display_name,
    gender: row.gender,
    origin_country: iso,
    origin: iso,
    vocative_pl: row.vocative_pl,
    instrumental_pl: row.instrumental_pl,
    genitive_pl: row.genitive_pl,
    dative_pl: row.dative_pl,
    english_form: row.english_form,
    vocative_en: row.english_form,
    is_compound: row.is_compound,
    notes: row.notes,
  };
}

/** Podsumowanie planu importu - to, co widzi administrator PRZED zapisem. */
export interface NameImportPlan {
  /** Akcja per wiersz, w kolejności wejściowej - tabela podglądu czyta to wprost. */
  readonly actions: readonly NameImportAction[];
  readonly willAdd: number;
  readonly willMerge: number;
  readonly willSkip: number;
}

/**
 * Plan importu dla całego pliku wobec aktualnego słownika.
 *
 * Liczy WIERSZE WEJŚCIOWE, nie klucze unikalne - dwa wiersze o tym samym
 * kluczu dają dwie akcje. Tak liczyła trasa i tak zostaje; rozjazd tego
 * licznika z faktycznym wynikiem zapisu jest opisany `it.fails` w teście
 * modułu.
 */
export function planNamesImport(
  rows: readonly ParsedNameCsvRow[],
  existingByKey: ReadonlyMap<string, NameDictionaryFields>,
): NameImportPlan {
  const actions = rows.map((row) => classifyNameImportRow(existingByKey.get(row.key), row));
  return {
    actions,
    willAdd: actions.filter((a) => a === "add").length,
    willMerge: actions.filter((a) => a === "merge").length,
    willSkip: actions.filter((a) => a === "skip").length,
  };
}
