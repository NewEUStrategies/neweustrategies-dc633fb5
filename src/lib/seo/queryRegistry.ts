// Rejestr fraz: co Google NAPRAWDĘ wpisuje, żeby trafić na nasz tekst.
//
// PO CO OSOBNY MODUŁ, skoro panel Search Console już pokazuje frazy. Bo
// pokazuje je OBOK stron, a nie RAZEM z nimi: dwie listy po 25 pozycji, każda
// posortowana po kliknięciach. Z takiej pary nie da się odpowiedzieć na
// jedyne pytanie, które prowadzi do zmiany w tekście - „która fraza przynosi
// wyświetlenia KTÓREMU artykułowi i czemu z niej nie klikają". Google potrafi
// zwrócić obie wymiary naraz (`dimensions: ["page", "query"]`); brakowało
// warstwy, która z tych par zrobi listę zadań.
//
// CAŁA LOGIKA JEST TUTAJ, nie w trasie. Nie z powodu estetyki: progi pokrycia
// dla `src/routes/admin.seo*.tsx` liczą GAŁĘZIE, a gałąź w komponencie
// Reacta dowodzi się tylko przez wyrenderowanie całego ekranu z podstawioną
// bazą. Ta sama reguła jako funkcja jest zwykłym wejściem i wyjściem.

/** Wiersz z Search Console po wymiarach `["page", "query"]`. */
export interface GscPageQueryRow {
  /** `keys[0]` to adres strony, `keys[1]` to fraza. */
  readonly keys: readonly string[];
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

/**
 * Typowy CTR dla pozycji w wynikach - punkty odniesienia, nie obietnica.
 *
 * SKĄD TE LICZBY. To rząd wielkości powtarzalny w publicznych badaniach CTR
 * (Advanced Web Ranking, Sistrix): pierwsza pozycja bierze ok. jedną czwartą
 * kliknięć, trzecia ok. jednej dziesiątej, za dziesiątką zostają promile.
 * Używamy ich WYŁĄCZNIE do pytania „czy ten wynik odstaje od swojej półki",
 * nigdy do prognozy ruchu - dlatego próg alarmu (`CTR_GAP_RATIO`) jest
 * postawiony nisko, na połowie wartości odniesienia.
 */
export const EXPECTED_CTR_BY_POSITION: readonly (readonly [number, number])[] = [
  [1, 0.255],
  [2, 0.152],
  [3, 0.102],
  [4, 0.073],
  [5, 0.053],
  [6, 0.04],
  [7, 0.031],
  [8, 0.024],
  [9, 0.02],
  [10, 0.017],
  [15, 0.01],
  [20, 0.006],
];

/** Poniżej tylu wyświetleń nie orzekamy niczego - próbka jest za mała. */
export const MIN_IMPRESSIONS_FOR_VERDICT = 30;

/** CTR poniżej tej części wartości odniesienia to sygnał, nie szum. */
export const CTR_GAP_RATIO = 0.5;

/**
 * Wartość odniesienia CTR dla pozycji, interpolowana liniowo między punktami
 * tabeli. Poza tabelą zwraca jej skrajne wartości - nie ekstrapolujemy.
 */
export function expectedCtr(position: number): number {
  const table = EXPECTED_CTR_BY_POSITION;
  if (!Number.isFinite(position)) return 0;
  const first = table[0];
  const last = table[table.length - 1];
  if (position <= first[0]) return first[1];
  if (position >= last[0]) return last[1];
  for (let i = 1; i < table.length; i += 1) {
    const [posHi, ctrHi] = table[i];
    if (position <= posHi) {
      const [posLo, ctrLo] = table[i - 1];
      const span = posHi - posLo;
      // Punkty tabeli są różne, więc `span` nigdy nie jest zerem; zapis bez
      // dzielenia przez zero zostawiamy mimo to, bo tabela jest eksportowana
      // i ktoś może ją kiedyś zmienić.
      const ratio = span === 0 ? 0 : (position - posLo) / span;
      return ctrLo + (ctrHi - ctrLo) * ratio;
    }
  }
  return last[1];
}

export type CtrVerdict = "below" | "ok" | "tooFew";

/**
 * Czy ten wynik klika się gorzej, niż wypada na jego pozycji.
 *
 * `tooFew` NIE jest stanem błędu ani brakiem danych - to odmowa orzekania.
 * Przy kilkunastu wyświetleniach jedno kliknięcie przestawia CTR o kilka
 * punktów procentowych, więc każdy werdykt byłby losem, a nie pomiarem.
 */
export function ctrVerdict(input: {
  readonly ctr: number;
  readonly position: number;
  readonly impressions: number;
}): CtrVerdict {
  if (input.impressions < MIN_IMPRESSIONS_FOR_VERDICT) return "tooFew";
  const reference = expectedCtr(input.position);
  if (reference <= 0) return "ok";
  return input.ctr < reference * CTR_GAP_RATIO ? "below" : "ok";
}

/**
 * Ścieżka z adresu zwróconego przez Search Console.
 *
 * GSC oddaje pełny URL z originem; panel potrzebuje ścieżki, żeby dopiąć
 * wiersz do artykułu. Końcowy ukośnik znika, bo `/blog/x` i `/blog/x/` to dla
 * nas ta sama strona, a dla porównania łańcuchów - nie.
 */
export function pathFromPageUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  let path = raw;
  const schemeAt = raw.indexOf("://");
  if (schemeAt !== -1) {
    const afterScheme = raw.slice(schemeAt + 3);
    const slashAt = afterScheme.indexOf("/");
    path = slashAt === -1 ? "/" : afterScheme.slice(slashAt);
  }
  const queryAt = path.search(/[?#]/);
  if (queryAt !== -1) path = path.slice(0, queryAt);
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/** Prefiksy języka zdejmowane przed dopasowaniem do sluga. */
const LOCALE_PREFIXES = ["/en", "/pl"] as const;

/**
 * Ostatni segment ścieżki - to on odpowiada slugowi w bazie.
 *
 * Prefiks języka zdejmujemy PRZED wzięciem segmentu, bo `/en/blog/x` i
 * `/blog/x` to ten sam artykuł w dwóch wersjach; rejestr ma je pokazać jako
 * jedną pozycję do poprawienia, a nie dwie.
 */
export function slugFromPath(path: string): string {
  let rest = path;
  for (const prefix of LOCALE_PREFIXES) {
    if (rest === prefix) return "";
    if (rest.startsWith(`${prefix}/`)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  const segments = rest.split("/").filter(Boolean);
  return segments.length ? segments[segments.length - 1] : "";
}

/** Fraza z jej metrykami, w kontekście jednej strony. */
export interface RegistryQuery {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
  readonly verdict: CtrVerdict;
}

/** Strona z sumą metryk i frazami, które ją przynoszą. */
export interface RegistryPage {
  readonly path: string;
  readonly slug: string;
  readonly clicks: number;
  readonly impressions: number;
  /** CTR liczony z SUM, nie jako średnia CTR-ów - te mają różne wagi. */
  readonly ctr: number;
  /** Pozycja ważona wyświetleniami; fraza z 1000 odsłon waży 1000 razy więcej. */
  readonly position: number;
  readonly verdict: CtrVerdict;
  readonly queries: readonly RegistryQuery[];
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Pary (strona, fraza) w listę stron z ich frazami.
 *
 * DLACZEGO SUMY, A NIE ŚREDNIE. CTR strony to jej kliknięcia podzielone przez
 * jej wyświetlenia. Średnia arytmetyczna CTR-ów fraz dałaby co innego i to
 * co innego byłoby nieprawdą: fraza z trzema wyświetleniami i jednym
 * kliknięciem ma CTR 33% i zawyżyłaby stronę, która realnie klika się w 2%.
 * Tak samo pozycja - ważona wyświetleniami, bo pozycja na frazie, której nikt
 * nie wpisuje, nie opisuje tej strony.
 */
export function groupByPage(rows: readonly GscPageQueryRow[]): RegistryPage[] {
  const byPath = new Map<
    string,
    { clicks: number; impressions: number; posWeighted: number; queries: RegistryQuery[] }
  >();

  for (const row of rows) {
    const pageKey = row.keys[0] ?? "";
    const query = (row.keys[1] ?? "").trim();
    const path = pathFromPageUrl(pageKey);
    if (!path || !query) continue;
    const bucket = byPath.get(path) ?? {
      clicks: 0,
      impressions: 0,
      posWeighted: 0,
      queries: [],
    };
    bucket.clicks += row.clicks;
    bucket.impressions += row.impressions;
    bucket.posWeighted += row.position * row.impressions;
    bucket.queries.push({
      query,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      verdict: ctrVerdict(row),
    });
    byPath.set(path, bucket);
  }

  const pages: RegistryPage[] = [];
  for (const [path, bucket] of byPath) {
    const ctr = safeDiv(bucket.clicks, bucket.impressions);
    const position = safeDiv(bucket.posWeighted, bucket.impressions);
    pages.push({
      path,
      slug: slugFromPath(path),
      clicks: bucket.clicks,
      impressions: bucket.impressions,
      ctr,
      position,
      verdict: ctrVerdict({ ctr, position, impressions: bucket.impressions }),
      queries: [...bucket.queries].sort((a, b) => b.impressions - a.impressions),
    });
  }
  return pages.sort((a, b) => b.impressions - a.impressions);
}

/** Znaki, które w polskich i angielskich frazach nie niosą treści. */
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Słowa za krótkie, żeby o czymkolwiek świadczyć. Nie jest to lista stop-słów
 * dla żadnego języka - to próg długości, który działa tak samo dla „the",
 * „i", „w" i „na", a nie wymaga utrzymywania dwóch słowników.
 */
const MIN_TERM_LENGTH = 3;

function terms(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((word) => word.length >= MIN_TERM_LENGTH);
}

/**
 * Słowa frazy, których NIE MA ani w tytule, ani w opisie.
 *
 * To najkrótsza droga od danych do poprawki: jeśli ludzie trafiają na tekst
 * po słowie, którego w jego tytule nie ma, to tytuł nie mówi o tym, po co oni
 * przyszli - i dlatego nie klikają. Porównanie jest po PREFIKSIE, nie po
 * równości, bo polska odmiana rozjeżdża formy („bezpieczeństwo" w tytule,
 * „bezpieczeństwa" w zapytaniu) i dosłowne porównanie zgłaszałoby braki,
 * których nie ma.
 */
export function missingQueryTerms(query: string, title: string, description: string): string[] {
  const haystack = terms(`${title} ${description}`);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const term of terms(query)) {
    if (seen.has(term)) continue;
    seen.add(term);
    const covered = haystack.some(
      (word) => word.startsWith(term.slice(0, MIN_TERM_LENGTH)) && sharesStem(word, term),
    );
    if (!covered) missing.push(term);
  }
  return missing;
}

/**
 * Czy dwa słowa to prawdopodobnie ta sama podstawa. Porównujemy wspólny
 * początek długości krótszego słowa minus końcówka - to prymitywne, ale
 * przewidywalne, a stemmer dla dwóch języków byłby tu narzędziem większym niż
 * problem: mylna zgodność kosztuje pominiętą sugestię, nie błędny zapis.
 */
function sharesStem(a: string, b: string): boolean {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const stemLength = Math.max(MIN_TERM_LENGTH, shorter.length - 2);
  return longer.startsWith(shorter.slice(0, stemLength));
}

/**
 * Ile kliknięć dzieli ten wynik od CTR typowego dla jego pozycji.
 *
 * To jest liczba, według której sortuje się listę zadań. Nie sortujemy po
 * samym CTR ani po samych wyświetleniach: strona z CTR 0% i dwudziestoma
 * odsłonami jest nieistotna, a strona z CTR 2% przy pozycji 4 i tysiącu
 * odsłon to kilkadziesiąt kliknięć leżących na stole.
 */
export function missedClicks(page: {
  readonly ctr: number;
  readonly position: number;
  readonly impressions: number;
}): number {
  if (page.impressions < MIN_IMPRESSIONS_FOR_VERDICT) return 0;
  const gap = expectedCtr(page.position) - page.ctr;
  return gap <= 0 ? 0 : gap * page.impressions;
}

/**
 * Strony ułożone tak, jak warto się nimi zająć: najpierw te, na których
 * poprawka tytułu odzyska najwięcej kliknięć. Strony bez luki wypadają - lista
 * zadań, na której nie ma czego zrobić, uczy tylko ignorowania listy.
 */
export function rankOpportunities(pages: readonly RegistryPage[]): RegistryPage[] {
  return pages
    .filter((page) => missedClicks(page) >= 1)
    .sort((a, b) => {
      const diff = missedClicks(b) - missedClicks(a);
      return diff !== 0 ? diff : b.impressions - a.impressions;
    });
}

/** Suma metryk całego rejestru - nagłówek ekranu. */
export interface RegistryTotals {
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
  readonly pages: number;
  readonly queries: number;
}

export function summarizeRegistry(pages: readonly RegistryPage[]): RegistryTotals {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  let queries = 0;
  for (const page of pages) {
    clicks += page.clicks;
    impressions += page.impressions;
    posWeighted += page.position * page.impressions;
    queries += page.queries.length;
  }
  return {
    clicks,
    impressions,
    ctr: safeDiv(clicks, impressions),
    position: safeDiv(posWeighted, impressions),
    pages: pages.length,
    queries,
  };
}

/** Frazy z całego rejestru, scalone między stronami i ułożone po wyświetleniach. */
export function flattenQueries(pages: readonly RegistryPage[]): (RegistryQuery & {
  readonly path: string;
})[] {
  const flat = pages.flatMap((page) =>
    page.queries.map((query) => ({ ...query, path: page.path })),
  );
  return flat.sort((a, b) => b.impressions - a.impressions);
}
