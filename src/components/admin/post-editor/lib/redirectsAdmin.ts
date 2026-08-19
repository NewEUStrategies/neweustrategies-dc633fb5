// Czyste reguły MENEDŻERA PRZEKIEROWAŃ (/admin/redirects) - zapytania listy,
// filtry, walidacja formularza, ładunek zapisu, eksport CSV i etykiety.
//
// Wyniesione 1:1 z `src/routes/admin.redirects.tsx`, gdzie mieszkały w ciele
// komponentu: w `queryFn`, w `useMemo`, w ternary w JSX-ie i w handlerach
// `setState`. Sprawdzenie ich wymagało dotąd wyrenderowania całej trasy razem
// z routerem, react-query, i18n, Radiksem i klientem Supabase - czyli
// w praktyce nie były sprawdzane wcale, mimo że rozstrzygają rzeczy, które
// widać wprost w produkcji: DOKĄD poleci ruch po starym adresie, czy przycisk
// zapisu w ogóle wolno kliknąć i co wyląduje w kolumnie `target_path`.
//
// Umiejscowienie pod `components/admin/post-editor/lib`, bo menedżer
// przekierowań jest DRUGĄ POŁOWĄ zmiany sluga w edytorze wpisu: zapis treści
// zakłada regułę `source: "slug_change"` (patrz `captureAutoRedirect`
// w `src/lib/content.functions.ts`), a ten panel jest jedynym miejscem, gdzie
// redaktor te reguły ogląda, poprawia i kasuje.
//
// Semantyka normalizacji ścieżek NIE jest tu powtórzona - jest jedna,
// w `@/lib/seo/redirects`, wspólna z middlewarem serwującym 301-ki i z importem
// CSV po stronie serwera. Ten moduł tylko ją SKŁADA w reguły formularza.
import { uiLang, type UiLang } from "@/lib/i18n/format";
import {
  isRedirectStatusCode,
  normalizeSourcePath,
  normalizeTargetPath,
  serializeRedirectsCsv,
  type RedirectStatusCode,
} from "@/lib/seo/redirects";

/** Wiersz reguły w tabeli panelu (kolumny pobierane przez listę). */
export interface RedirectRow {
  id: string;
  source_path: string;
  target_path: string;
  status_code: number;
  is_enabled: boolean;
  source: string;
  note: string | null;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
}

/** Wiersz monitora 404 (zakładka „Ostatnie 404”). */
export interface Seo404Row {
  path: string;
  hits: number;
  first_seen: string;
  last_seen: string;
  last_referrer: string | null;
}

/** Stan okna edytora reguły - dokładnie to, czym sterują pola formularza. */
export interface RedirectEditorState {
  /** `null` = nowa reguła; wypełnione = edycja istniejącej. */
  id: string | null;
  source_path: string;
  target_path: string;
  status_code: RedirectStatusCode;
  is_enabled: boolean;
  note: string;
}

// ---------------------------------------------------------------------------
// Zapytania
// ---------------------------------------------------------------------------

/**
 * Kolumny listy reguł. Stała, bo ten sam zestaw czyta tabela (`hit_count`,
 * `last_hit_at`), etykieta pochodzenia (`source`), filtr wyszukiwania (`note`)
 * ORAZ eksport CSV - usunięcie którejkolwiek psuje kolumnę na ekranie albo
 * cichaczem wycina pole z pliku eksportu, nie samo zapytanie.
 */
export const REDIRECTS_LIST_COLUMNS =
  "id, source_path, target_path, status_code, is_enabled, source, note, hit_count, last_hit_at, created_at";

/**
 * Sufit listy reguł. Panel NIE stronicuje, więc ta liczba jest jedyną
 * granicą: instalacja po migracji z WordPressa potrafi mieć kilka tysięcy
 * przekierowań, a wiersze ponad limitem po prostu nie istnieją dla filtra,
 * eksportu CSV i licznika „X / Y” w nagłówku.
 */
export const REDIRECTS_LIST_LIMIT = 2000;

/** Kolumny monitora 404. */
export const HITS_404_COLUMNS = "path, hits, first_seen, last_seen, last_referrer";

/** Sufit monitora 404 - lista jest posortowana malejąco po liczbie trafień. */
export const HITS_404_LIMIT = 300;

/**
 * Minimalny kontrakt łańcucha PostgREST używany przez oba zapytania panelu.
 * Generyczny po SOBIE (`Self`), bo builder Supabase zwraca `this`: produkcja
 * podaje prawdziwy builder BEZ rzutu (wynik nadal da się `await`), a test
 * podaje atrapę z `src/test/supabaseChain.ts`.
 */
export interface RedirectsQueryBuilder<Self> {
  order(column: string, options: { ascending: boolean }): Self;
  limit(count: number): Self;
}

/**
 * Porządek i sufit listy reguł: NAJNOWSZE NA GÓRZE.
 *
 * Sortowanie po `created_at` malejąco, a nie po `source_path`, bo panel jest
 * używany zaraz po dodaniu reguły („czy się zapisała?”) - przy porządku
 * alfabetycznym świeży wpis lądowałby w losowym miejscu tysiąca wierszy.
 */
export function applyRedirectsListQuery<B extends RedirectsQueryBuilder<B>>(q: B): B {
  return q.order("created_at", { ascending: false }).limit(REDIRECTS_LIST_LIMIT);
}

/**
 * Porządek i sufit monitora 404: NAJCZĘŚCIEJ TRAFIANE NA GÓRZE. Lista jest
 * kolejką roboczą („co naprawić najpierw”), więc sortowanie po dacie zepchnęłoby
 * adres z tysiącem trafień pod pojedyncze wejścia bota z dzisiaj.
 */
export function applyHits404Query<B extends RedirectsQueryBuilder<B>>(q: B): B {
  return q.order("hits", { ascending: false }).limit(HITS_404_LIMIT);
}

/**
 * Klucze unieważniane po KAŻDEJ mutacji panelu (zapis, kasowanie, przełącznik
 * aktywności, import CSV, odrzucenie wpisu 404).
 *
 * Dwa, nie jeden: reguły i monitor 404 to OSOBNE zapytania, a
 * `invalidateQueries` dopasowuje po prefiksie TABLICY - `["admin-redirects"]`
 * nie trafia w `["admin-seo-404"]`, bo to inny napis, nie dłuższy klucz.
 * Pominięcie drugiego zostawia w zakładce 404 adresy, dla których reguła już
 * istnieje, i redaktor tworzy ją drugi raz.
 */
export const REDIRECTS_INVALIDATE_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["admin-redirects"],
  ["admin-seo-404"],
];

/**
 * Domeny własne wyciągnięte z odpowiedzi tabeli `tenants` - allowlista hostów
 * dla CELU ABSOLUTNEGO w podglądzie formularza.
 *
 * Wiersz bez domeny (`null`) NIE MOŻE trafić na listę: `normalizeTargetPath`
 * porównuje hosty po `canonicalHost`, a pusty wpis nie ma czego porównać -
 * przepuszczony dokładałby do allowlisty pozycję, która nigdy nie pasuje,
 * albo (przy zmianie porównania) pasowałaby do wszystkiego.
 */
export function tenantDomainsOf(
  rows: readonly { domain: string | null }[] | null | undefined,
): string[] {
  return (rows ?? []).map((row) => row.domain).filter((domain): domain is string => !!domain);
}

// ---------------------------------------------------------------------------
// Stan edytora
// ---------------------------------------------------------------------------

/**
 * Stan nowej reguły. 301 (trwałe) jest domyślne, bo panel powstał do migracji
 * z WordPressa: 302 nie przenosi mocy linków, więc domyślne „tymczasowe”
 * cicho kosztowałoby pozycje w wyszukiwarce przy każdej regule dodanej
 * w pośpiechu.
 */
export const EMPTY_REDIRECT_EDITOR: RedirectEditorState = {
  id: null,
  source_path: "",
  target_path: "",
  status_code: 301,
  is_enabled: true,
  note: "",
};

/**
 * Kod odpowiedzi z bazy/selecta sprowadzony do obsługiwanego zestawu.
 *
 * Kolumna `status_code` jest zwykłym `int` - wiersz z importu albo ze starszej
 * migracji może nieść cokolwiek. Bez tego sprowadzenia Radiksowy `Select`
 * dostałby wartość spoza swojej listy, pokazał PUSTE pole i przy pierwszym
 * zapisie wysłał `undefined` zamiast kodu.
 */
export function coerceRedirectStatusCode(value: number): RedirectStatusCode {
  return isRedirectStatusCode(value) ? value : 301;
}

/** Czy reguła oznacza „treść usunięta” (410 Gone), a nie przeniesienie. */
export function isGoneCode(statusCode: number): boolean {
  return statusCode === 410;
}

/**
 * Czy formularz pokazuje pole celu. Przy 410 cel nie ma znaczenia (serwer
 * zapisuje „/” jako zapchajdziurę), a widoczne pole obiecywałoby redaktorowi,
 * że gdzieś przeniesie ruch - podczas gdy 410 oznajmia, że treści już nie ma.
 */
export function showsTargetField(statusCode: number): boolean {
  return !isGoneCode(statusCode);
}

/** Otwarcie edytora na istniejącym wierszu tabeli. */
export function editorStateFromRow(row: RedirectRow): RedirectEditorState {
  return {
    id: row.id,
    source_path: row.source_path,
    target_path: row.target_path,
    status_code: coerceRedirectStatusCode(row.status_code),
    is_enabled: row.is_enabled,
    note: row.note ?? "",
  };
}

/**
 * „Utwórz przekierowanie” z monitora 404: nowa reguła z adresem, który wraca
 * czterysta czwórką, wstawionym w ŹRÓDŁO. Cel zostaje pusty - to jedyna
 * decyzja, której panel nie może zgadnąć za redaktora.
 */
export function editorStateFromHit(hit: Seo404Row): RedirectEditorState {
  return { ...EMPTY_REDIRECT_EDITOR, source_path: hit.path };
}

/** Zmiana kodu w selekcie (Radix oddaje `string`). */
export function withStatusCode(editor: RedirectEditorState, selected: string): RedirectEditorState {
  return { ...editor, status_code: coerceRedirectStatusCode(Number(selected)) };
}

// ---------------------------------------------------------------------------
// Walidacja formularza
// ---------------------------------------------------------------------------

/** Wynik walidacji szkicu reguły - podgląd obu pól i bramka przycisku zapisu. */
export interface RedirectDraftValidity {
  /** Znormalizowane źródło albo `null`, gdy nie da się go użyć. */
  source: string | null;
  /** Znormalizowany cel albo `null` (nie do użycia LUB host spoza allowlisty). */
  target: string | null;
  /** Czy przycisk zapisu wolno odblokować. */
  canSave: boolean;
}

/**
 * Walidacja szkicu reguły - ta sama para funkcji, którą serwer wykonuje
 * PONOWNIE w `upsertRedirect`, więc podgląd w oknie i wynik zapisu nie mogą
 * się rozjechać.
 *
 * `allowedHosts` steruje wyłącznie CELEM ABSOLUTNYM: bez allowlisty każdy
 * `https://…` jest odrzucany, bo reguła przekierowania z dowolnym hostem to
 * gotowy otwarty redirect (ruch marki wychodzi na cudzą domenę z błogosławieństwem
 * 301). Przy 410 cel nie jest wymagany - patrz `showsTargetField`.
 */
export function redirectDraftValidity(
  editor: RedirectEditorState | null,
  allowedHosts: readonly string[],
): RedirectDraftValidity {
  if (!editor) return { source: null, target: null, canSave: false };
  const source = normalizeSourcePath(editor.source_path);
  const target = normalizeTargetPath(editor.target_path, allowedHosts);
  const targetRequired = showsTargetField(editor.status_code);
  return { source, target, canSave: !!source && (!targetRequired || !!target) };
}

/** Podpowiedź pod polem: nic, podgląd znormalizowanej wartości albo błąd. */
export type NormalizationHint =
  { kind: "none" } | { kind: "normalized"; text: string } | { kind: "invalid" };

/**
 * Podpowiedź pod polem adresu.
 *
 * Puste pole nie pokazuje NICZEGO (świeżo otwarte okno nie może krzyczeć
 * „nieprawidłowy adres”), a wypełnione pokazuje albo postać, w której adres
 * NAPRAWDĘ trafi do bazy, albo informację, że tej wartości nie da się zapisać.
 * Podgląd jest tu jedynym miejscem, gdzie redaktor widzi, że „/Stary-Wpis/”
 * zostanie zapisane jako „/stary-wpis” - a od tego zależy, czy reguła w ogóle
 * kiedykolwiek trafi.
 */
export function normalizationHint(raw: string, normalized: string | null): NormalizationHint {
  if (!raw.trim()) return { kind: "none" };
  return normalized ? { kind: "normalized", text: `→ ${normalized}` } : { kind: "invalid" };
}

/**
 * Ładunek dla `upsertRedirect`.
 *
 * Dwie reguły, których nie widać w formularzu:
 *   * pusty cel jedzie jako „/” - przy 410 pole celu jest schowane, więc bez
 *     tej podmiany walidator serwera dostałby pusty string i odrzucił zapis
 *     reguły, którą redaktor właśnie poprawnie wypełnił;
 *   * pusta notatka jedzie jako `null`, a nie „” - kolumna jest nullowalna,
 *     a pusty string zapisany jako wartość rozjeżdża filtr wyszukiwania i
 *     eksport CSV z wierszem bez notatki.
 */
export function redirectUpsertInput(editor: RedirectEditorState): {
  id?: string;
  fields: {
    source_path: string;
    target_path: string;
    status_code: RedirectStatusCode;
    is_enabled: boolean;
    note: string | null;
  };
} {
  return {
    id: editor.id ?? undefined,
    fields: {
      source_path: editor.source_path,
      target_path: editor.target_path || "/",
      status_code: editor.status_code,
      is_enabled: editor.is_enabled,
      note: editor.note || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Lista: filtr i etykiety
// ---------------------------------------------------------------------------

/** Stan filtrów listy reguł. */
export interface RedirectsListFilter {
  /** Fraza z pola szukania (surowa - `trim` robi filtr). */
  search: string;
  status: "all" | "enabled" | "disabled";
}

/** Wybór z selecta statusu; nieznana wartość znaczy „wszystkie”. */
export function statusFilterFromSelect(selected: string): RedirectsListFilter["status"] {
  if (selected === "enabled") return "enabled";
  if (selected === "disabled") return "disabled";
  return "all";
}

/**
 * Filtr listy reguł: najpierw stan aktywności, potem fraza.
 *
 * Fraza szuka w OBU adresach i w notatce - nie tylko w źródle. Po migracji
 * z WordPressa redaktor zwykle wie, DOKĄD reguła miała prowadzić („/o-nas”),
 * a nie jak brzmiał stary adres z 2013 roku; szukanie wyłącznie po źródle
 * zostawiałoby go z pustą listą przy poprawnie wpisanej frazie.
 */
export function filterRedirects(
  rows: readonly RedirectRow[] | null | undefined,
  filter: RedirectsListFilter,
): RedirectRow[] {
  const needle = filter.search.trim().toLowerCase();
  return (rows ?? []).filter((row) => {
    if (filter.status === "enabled" && !row.is_enabled) return false;
    if (filter.status === "disabled" && row.is_enabled) return false;
    if (!needle) return true;
    return (
      row.source_path.toLowerCase().includes(needle) ||
      row.target_path.toLowerCase().includes(needle) ||
      (row.note ?? "").toLowerCase().includes(needle)
    );
  });
}

/**
 * Klucz komunikatu pustej tabeli. Rozróżnienie jest tu istotne: „brak
 * przekierowań” zachęca do dodania pierwszego, a przy 2000 reguł odfiltrowanych
 * do zera byłoby po prostu nieprawdą - redaktor uznałby, że skasował sobie
 * cały zestaw.
 */
export function redirectsEmptyStateKey(
  totalCount: number,
): "admin.list.noResults" | "admin.redirects.empty" {
  return totalCount > 0 ? "admin.list.noResults" : "admin.redirects.empty";
}

/**
 * Etykiety pochodzenia reguły. Rejestr, a nie ternary po języku, bo wartość
 * `source` przychodzi z bazy (`manual | slug_change | wp_import | csv_import |
 * quick_404`, patrz migracja `20260702130000_seo_toolkit.sql`).
 */
const SOURCE_LABELS: Readonly<Record<string, Readonly<Record<UiLang, string>>>> = {
  manual: { pl: "ręczne", en: "manual" },
  slug_change: { pl: "zmiana sluga", en: "slug change" },
  wp_import: { pl: "import WP", en: "WP import" },
  csv_import: { pl: "import CSV", en: "CSV import" },
  quick_404: { pl: "z monitora 404", en: "from 404 monitor" },
};

/**
 * Etykieta pochodzenia. Nieznana wartość wraca SUROWA, a nie jako „inne”:
 * kolumna `source` jest zwykłym tekstem, więc nowy producent reguł (kolejny
 * importer) ma być widoczny w panelu od razu, a nie zlewać się z resztą do
 * czasu dopisania tłumaczenia.
 */
export function redirectSourceLabel(source: string, language: string | undefined): string {
  return SOURCE_LABELS[source]?.[uiLang(language)] ?? source;
}

/**
 * Stempel czasu w tabeli: „2026-08-18 09:31”, myślnik dla braku.
 *
 * Ucięcie do 16 znaków zdejmuje sekundy i strefę, więc wartość jest czytana
 * jako UTC-owa - świadomie, bo kolumny `last_hit_at`/`last_seen` służą do
 * porównania „która reguła żyje”, a nie do rozliczeń czasowych.
 */
export function formatRedirectStamp(iso: string | null): string {
  if (!iso) return "-";
  return iso.slice(0, 16).replace("T", " ");
}

// ---------------------------------------------------------------------------
// Import / eksport CSV
// ---------------------------------------------------------------------------

/** Plik do pobrania z eksportu CSV. */
export interface RedirectsCsvDownload {
  filename: string;
  mimeType: string;
  content: string;
}

/**
 * Eksport CSV.
 *
 * Bierze CAŁĄ listę reguł, nie wynik filtra: plik jest kopią zapasową mapy
 * przekierowań (i wsadem dla `parseRedirectsCsv` przy przenosinach między
 * instalacjami), więc wyeksportowanie „tego, co akurat widać” dałoby plik,
 * który po ponownym imporcie MILCZĄCO gubi resztę reguł.
 *
 * `charset=utf-8` w typie MIME nie jest ozdobą: mapy po migracji z WordPressa
 * są pełne polskich slugów, a Excel bez tej deklaracji rozjeżdża je na cp1250.
 */
export function redirectsCsvDownload(rows: readonly RedirectRow[]): RedirectsCsvDownload {
  return {
    filename: "redirects.csv",
    mimeType: "text/csv;charset=utf-8",
    content: serializeRedirectsCsv(rows),
  };
}

/** Ogon komunikatu importu: ile wierszy pominięto. */
const SKIPPED_ROWS_LABELS: Readonly<Record<UiLang, string>> = {
  pl: "pominiętych wierszy",
  en: "rows skipped",
};

/**
 * Dopisek do komunikatu po imporcie CSV.
 *
 * Pusty, gdy plik wszedł w całości. Gdy `parseRedirectsCsv` odsiał wiersze
 * (zły adres, nieobsługiwany kod, przekierowanie na samo siebie), redaktor MUSI
 * to zobaczyć w tym samym toaście co liczbę zaimportowanych - inaczej odczyta
 * „zaimportowano 812” jako komplet i nie sprawdzi, że 40 starych adresów nadal
 * daje 404.
 */
export function importSkippedSuffix(issueCount: number, language: string | undefined): string {
  if (issueCount <= 0) return "";
  return ` (${issueCount} ${SKIPPED_ROWS_LABELS[uiLang(language)]})`;
}
