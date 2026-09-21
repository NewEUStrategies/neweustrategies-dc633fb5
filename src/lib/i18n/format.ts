// Centralne, świadome języka formatowanie dat i liczb dla powierzchni
// publicznej. Wcześniej ~20 plików robiło własne
// `toLocaleDateString(lang === "en" ? "en-US" : "pl-PL")` (z rozjazdem
// en-US/en-GB włącznie) - jedna definicja locale kończy dryf.
// Konwencja domu: wersja EN formatuje po europejsku (en-GB: dzień-miesiąc-rok),
// spójnie z resztą serwisu - nie en-US.
export type UiLang = "pl" | "en";

const LOCALE: Record<UiLang, string> = { pl: "pl-PL", en: "en-GB" };

/**
 * STREFA CZASOWA SERWISU - JEDNO ŹRÓDŁO PRAWDY dla całego repozytorium.
 *
 * PO CO TO ISTNIEJE. SSR biegnie na Cloudflare Workers, gdzie strefą procesu
 * jest UTC i nie da się jej skonfigurować. `Intl.DateTimeFormat` BEZ `timeZone`
 * bierze strefę MASZYNY, a serwer i przeglądarka czytelnika to dwie różne
 * maszyny - więc ta sama data drukuje się inaczej po obu stronach. React 19 przy
 * rozjeździe tekstu porzuca serwerowe poddrzewo i renderuje je od zera na
 * kliencie, czyli traci dokładnie ten HTML, który SSR miał dostarczyć. Przy
 * `hour`/`minute` to dodatkowo po prostu INNA GODZINA (1-2 h), a przy samej
 * dacie - inny DZIEŃ dla wpisów z okna 22:00-24:00 UTC.
 *
 * To jest DOKŁADNIE ten sam defekt, który docstring `formatDateTime` niżej
 * nazywa dla locale („SSR i klient renderują różny tekst") - i którego ten sam
 * plik nie domykał dla strefy.
 *
 * DLACZEGO WARSZAWA, A NIE UTC. Decyzja, nie gust:
 *  1. Repozytorium rozstrzygnęło to już raz - `lib/events/timezone.ts`
 *     (`EVENT_DEFAULT_TZ`) i domyślna wartość `site_settings.general.timezone`
 *     mówią „Europe/Warsaw", bo redakcja siedzi w Warszawie. Trzecia,
 *     sprzeczna odpowiedź w tym pliku byłaby problemem czwartej implementacji.
 *  2. UTC PRZESUWA GRANICĘ DNIA REDAKCYJNEGO o dwie godziny (CEST): analiza
 *     opublikowana 13 lipca o 00:30 czasu warszawskiego dostałaby datę
 *     „12 lipca" - czyli serwis o polityce europejskiej datowałby własny dorobek
 *     na dzień wcześniejszy. Warszawa jest czyimś dniem, UTC nie jest niczyim.
 *  3. Bruksela i Warszawa mają TĘ SAMĄ strefę (CET/CEST, ta sama reguła DST),
 *     więc wybór nie kosztuje czytelnika unijnego ani minuty.
 *  4. Strefa czytelnika NIE JEST opcją: serwer jej w SSR nie zna. To właśnie
 *     robi dzisiejszy kod i to jest naprawiany defekt.
 *
 * CZEGO TA STAŁA NIE ROZSTRZYGA:
 *  * kolumny typu DATE (`entry_date`, `due_on`, `published_on`, `week_start`)
 *    nie mają chwili - te formatuje się w UTC (`DATE_ONLY_TIME_ZONE`,
 *    `formatDateOnly`), wzorzec: `components/post/PostChangelog.tsx`;
 *  * wiersze `public.events` mają WŁASNĄ strefę (`events.timezone`) - idą przez
 *    `formatEventDateTime` z `lib/events/timezone.ts`, nigdy tędy.
 */
export const SITE_TIME_ZONE = "Europe/Warsaw";

/**
 * Kolumny DATE nie mają chwili, więc każda strefa poza UTC potrafi przesunąć je
 * o jeden dzień. UTC to jedyna strefa, która zwraca je w całości.
 */
export const DATE_ONLY_TIME_ZONE = "UTC";

export function uiLocale(lang: string | undefined): string {
  return LOCALE[uiLang(lang)];
}

/**
 * Surowe `i18n.language` (moze byc `undefined`, `"en-US"`, `"pl"`) zawezone do
 * dwoch jezykow interfejsu. Potrzebne wszedzie, gdzie wybieramy TRESC
 * z blizniaczych kolumn (`pickLocalized`) albo klucz w mapie `Record<UiLang, …>`.
 *
 * Istnieje, bo bez niego ta sama linia
 * `(i18n.language ?? "pl").startsWith("en") ? "en" : "pl"` powtarza sie
 * w kazdym komponencie - a to jest ta sama decyzja, ktora `uiLocale` juz raz
 * podejmuje. Jedno miejsce, jedna regula normalizacji.
 */
export function uiLang(lang: string | undefined): UiLang {
  return (lang ?? "pl").startsWith("en") ? "en" : "pl";
}

/**
 * Data artykułu/listingu: "12 lipca 2026" / "12 July 2026".
 *
 * Strefa jest DOMYKANA (`SITE_TIME_ZONE`), o ile wywołujący nie podał własnej -
 * patrz uzasadnienie przy tej stałej. Bez tego wynik zależy od strefy maszyny,
 * a serwer i przeglądarka to dwie różne maszyny.
 */
export function formatDate(
  date: string | number | Date,
  lang: string | undefined,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" },
): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const withZone: Intl.DateTimeFormatOptions =
    opts.timeZone === undefined ? { ...opts, timeZone: SITE_TIME_ZONE } : opts;
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), withZone).format(d);
  } catch {
    // GAŁĄŹ RATUNKOWA MUSI BYĆ W TEJ SAMEJ STREFIE co gałąź główna - inaczej
    // sama degradacja produkuje rozjazd, którego ten plik ma nie dopuszczać.
    // `toISOString()` to UTC, więc dla strefy serwisu byłby innym dniem.
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: SITE_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }
}

/**
 * Data z kolumny DATE (bez chwili): formatowana w UTC, żeby żadna strefa nie
 * przesunęła jej o dzień. Wzorzec przeniesiony z `components/post/PostChangelog.tsx`,
 * który był jedynym miejscem w całym `src/` robiącym to poprawnie.
 */
export function formatDateOnly(
  iso: string,
  lang: string | undefined,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" },
): string {
  const out = formatDate(`${iso.slice(0, 10)}T00:00:00Z`, lang, {
    ...opts,
    timeZone: DATE_ONLY_TIME_ZONE,
  });
  // USZKODZONA wartość wraca SUROWA, nie jako pustka: czytelnik i redaktor mają
  // zobaczyć, co jest w bazie, a nie brak wiersza. Kontrakt przypięty testem
  // w `components/post/__tests__/postDataSurfaces.test.tsx`.
  return out || iso;
}

/**
 * Rok kalendarzowy W STREFIE SERWISU.
 *
 * `new Date().getFullYear()` bierze strefę MASZYNY: na Workers to UTC, w
 * przeglądarce strefa czytelnika. W dwugodzinnym oknie sylwestrowym (CEST) te
 * dwie liczby są RÓŻNE, a stopka z rokiem stoi na każdej stronie serwisu - czyli
 * rozjazd hydratacji obejmujący całe drzewo stopki.
 *
 * CZEGO TA FUNKCJA NIE ZAŁATWIA I TRZEBA TO POWIEDZIEĆ WPROST: dokument
 * zapisany w cache brzegowym PRZED północą 1 stycznia niesie stary rok do
 * końca swojej świeżości. To jest zwykła nieświeżość cache'a (świeżość L1/L2
 * jest ograniczona do minut), nie rozjazd hydratacji - serwer i klient liczą
 * tę samą liczbę dla tej samej chwili.
 */
export function siteYear(nowMs: number = Date.now()): number {
  try {
    return Number.parseInt(
      new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, year: "numeric" }).format(
        new Date(nowMs),
      ),
      10,
    );
  } catch {
    return new Date(nowMs).getUTCFullYear();
  }
}

/** Krótka data listingu: "12.07.2026" / "12/07/2026". */
export function formatDateShort(date: string | number | Date, lang: string | undefined): string {
  return formatDate(date, lang, { year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * Data z godziną: "12.07.2026, 14:30" / "12/07/2026, 14:30".
 *
 * Powstało dla dyskusji i moderacji, gdzie sama data nie wystarcza (dwa wpisy
 * z tego samego dnia trzeba móc uszeregować), a `toLocaleString()` bez locale -
 * którego moduł klubów używał w kilkunastu miejscach - daje wynik zależny od
 * ustawień przeglądarki, więc SSR i klient renderują różny tekst.
 */
export function formatDateTime(date: string | number | Date, lang: string | undefined): string {
  return formatDate(date, lang, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(
  value: number,
  lang: string | undefined,
  opts?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(uiLocale(lang), opts).format(value);
  } catch {
    return String(value);
  }
}
