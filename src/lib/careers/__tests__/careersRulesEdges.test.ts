// OSTATNIE NIEPOKRYTE WARUNKI BIBLIOTEKI REGUŁ REKRUTACJI — sześć modułów,
// dziewiętnaście gałęzi, dwie funkcje bez ani jednego wywołania.
//
// ---------------------------------------------------------------------------
// PO CO TEN PLIK ISTNIEJE
// ---------------------------------------------------------------------------
// Stan wejściowy ZMIERZONY na całym katalogu `src/lib/careers/__tests__`
// (dziewięć plików, 177 przypadków) — linie i instrukcje były już zamknięte,
// więc to, co zostało, to WYŁĄCZNIE warunki:
//
//   funkcje 104/106, gałęzie 240/259, linie 260/260
//   applicationSchema.ts   gałęzie 27/33, linie bez pokrycia 149-150
//   catalog.ts             gałęzie 45/49
//   catalogAdmin.ts        gałęzie  2/4,  linia bez pokrycia 45
//   cvUpload.ts            gałęzie 32/34
//   recruitmentLayer.ts    funkcje 13/15, gałęzie 59/63, linie 98-101
//   recruitmentShared.ts   gałęzie 33/34, linia bez pokrycia 62
//
// Niepokryta gałąź to prawie zawsze warunek, o którym autor testu NIE POMYŚLAŁ
// — nie fragment kodu, którego „nie warto" sprawdzać. Dlatego poniżej każda
// luka ma przypisany moduł ORAZ powód, dla którego dotychczasowe testy jej nie
// widziały. To jest najcenniejsza część tego pliku:
//
//  * `catalog.ts` — `cond-expr@96[0]`, `if@104[1]`. `careerRolesQueryOptions`
//    ma parametr `includeDrafts`, który steruje DWOMA rzeczami naraz: segmentem
//    klucza cache (`"all"` vs `"published"`) i obecnością `eq("is_published")`
//    w zapytaniu. Cała dotychczasowa mierzona ścieżka biegła przez hook strony
//    publicznej (`useCareerContent.test.tsx`, dowód nr 7), który woła wariant
//    BEZ argumentu — wariant panelu (`admin.hiring.tsx:298`) nie miał ani
//    jednego wołania w pomiarze tej warstwy. Nikt nie sprawdził rzeczy
//    najgroźniejszej: czy oba warianty stoją pod ROZŁĄCZNYMI kluczami. Wspólny
//    klucz nie wywala niczego — po prostu operator panelu zostawia w cache
//    listę z brudnopisami, którą następne malowanie strony publicznej oddaje
//    kandydatom jako ofertę.
//  * `catalog.ts` — `binary-expr@107[1]`, `binary-expr@133[1]` (`data ?? []`).
//    Atrapy transportu w istniejących plikach zawsze oddają tablicę, więc
//    normalizacja „brak wierszy → pusta lista" nie miała świadka. Ta gałąź jest
//    miejscem, w którym typ `Promise<CareerRoleRow[]>` staje się PRAWDĄ
//    w czasie wykonania; dziś maskują ją konsumenci (`rolesQuery.data ?? []`
//    w `admin.hiring.tsx:302`, `sectionsQuery.data ?? []` w linii 692), czyli
//    ta sama poprawka wpisana drugi raz. Gdyby jej tu nie było, pod kluczem
//    typowanym na tablicę siedziałby `null`.
//  * `catalogAdmin.ts` — `if@45[0]` i linia 45 (`throw`). `careerSectionsSource.test.ts`
//    woła ten odczyt, ale wyłącznie po to, żeby sprawdzić, JAKĄ RELACJĘ czyta
//    (tabela, nie widok), i podstawia sukces. Odmowa RLS (`career_sections_staff_read`
//    = is_staff + własny najemca) nie była nigdy odegrana — a to jedyna gałąź,
//    która decyduje, czy panel POKAŻE BŁĄD, czy siedem sekcji „domyślnych".
//  * `recruitmentShared.ts` — `if@62[0]`. Bramka schematu w `normalizeCvUrl`.
//    Istniejący test podaje `"javascript:alert(1)"` i dostaje `null` — ale
//    dostaje go z bloku `catch`, nie z tej bramki. Nikt nie sprawdził, KTÓRY
//    warunek naprawdę odsiewa obcy schemat (dowód niżej: robi to KROPKA
//    w nazwie hosta z linii 63 i konstruktor `URL`, nie linia 62).
//  * `recruitmentLayer.ts` — `(anon)@98`, `(anon)@100`, linie 98-101.
//    `engagementLabel` i `locationLabel` nie mają DZIŚ ANI JEDNEGO konsumenta
//    produkcyjnego (znalezisko 3) — dlatego zero wywołań. Testy powierzchni
//    panelu nie mogły ich pokryć, bo panel ich nie woła.
//  * `recruitmentLayer.ts` — `binary-expr@244[1]`, `cond-expr@246[1]`.
//    Fixture `PIPELINE` w `recruitmentLayer.test.ts` ma WSZYSTKIE kolumny
//    wypełnione (`stage_changed_at`, `rating: 4`), a tak wygląda wiersz PO
//    pracy operatora. Wiersz świeżo wstawiony triggerem ma te kolumny puste
//    i to on jest pierwszym, jaki panel rysuje.
//  * `recruitmentLayer.ts` — `binary-expr@258[1]`, `@266[1]`. Wejście
//    `messages` jest w typie OPCJONALNE (karta kontaktu CRM czyta zgłoszenia
//    bez joina), ale każdy istniejący przypadek podaje tablicę; `lang` w każdym
//    fixture jest wypełniony, choć kolumna jest `nullable`.
//  * `applicationSchema.ts` — linie 149-150, `if@149[0]`, `if@150[0]`,
//    `binary-expr@158[1]`. `collectErrors` jest funkcją PRYWATNĄ i wpuszcza do
//    kreatora wyłącznie nazwy z `CAREER_FORM_FIELDS`; oba jej `continue`
//    odpalają się tylko dla błędu na ścieżce, której kreator nie zna
//    (`["cvUrl"]`) albo BEZ ścieżki (wejście spoza kształtu obiektu). Wszystkie
//    dotychczasowe przypadki podawały poprawny obiekt z błędami na polach
//    znanych kreatorowi, więc oba wyjścia awaryjne — i zapas `?? CAREER_FORM_FIELDS[0]`
//    z linii 158 — były niemierzone.
//  * `cvUpload.ts` — `binary-expr@71[1]`. Zapas na brak `crypto.randomUUID`.
//    happy-dom dostarcza `randomUUID`, więc ścieżka starszej przeglądarki
//    (albo kontekstu nie-secure) nie odpalała się nigdy.
//
// ---------------------------------------------------------------------------
// CO JEST PRZEDMIOTEM DOWODU
// ---------------------------------------------------------------------------
//  1. WARIANT PANELU W ODCZYCIE OFERT. `includeDrafts` zdejmuje `eq("is_published")`
//     z łańcucha PostgREST I zmienia segment klucza cache; dwa warianty czytane
//     przez JEDEN klient react-query dają DWA odczyty relacji i dwie różne
//     listy — brudnopis nie przecieka do odczytu publicznego.
//  2. BRAK WIERSZY. Odpowiedź `data: null` z relacji ofert i z widoku sekcji
//     wychodzi z warstwy danych jako `[]`, a `[]` znaczy dla `sectionState`
//     „pokaż" (reguła świeżej instalacji).
//  3. ODMOWA ODCZYTU SEKCJI W PANELU wywraca zapytanie z komunikatem PostgREST
//     (a nie oddaje pustej listy, którą operator nadpisałby brudnopisem).
//  4. BRAMKA SCHEMATU LINKU DO CV. Dla korpusu adresów wrogich (`javascript:`,
//     `data:`, `blob:`, `vbscript:`, `about:`, `tel:`, `file:`, `ftp://`, `ws://`)
//     wynik jest `null` albo adres http(s) — nigdy link innego schematu; plus
//     dowód, KTÓRY warunek to robi.
//  5. ETYKIETY WYMIARU WSPÓŁPRACY I MIEJSCA PRACY w obu językach panelu, z
//     bramką zamkniętego zbioru: każdy `engagement` i każda `location`
//     występująca w `CAREER_ROLES` ma tekst różny od sluga.
//  6. WIERSZ PROCESU ŚWIEŻO WSTAWIONY (bez daty zmiany etapu, bez oceny) daje
//     `null`-e, nie pusty napis i nie `NaN`.
//  7. KONTAKT BEZ JOINA WIADOMOŚCI daje kompletną, pustą warstwę rekrutacyjną;
//     zgłoszenie bez `lang` domyśla się polskiego.
//  8. DWA WYJŚCIA AWARYJNE WALIDACJI: błąd na ścieżce nieznanej kreatorowi
//     (znalezisko 1) i wejście spoza kształtu obiektu — oba kończą się
//     `ok: false` ze wskazaniem pierwszego pola kreatora, a nie wyjątkiem.
//  9. NORMALIZACJA PÓL CV: wejście bez `cvFileName`/`cvUrl` daje w payloadzie
//     PUSTE NAPISY (dowód, że `?? ""` w `superRefine` jest martwe — patrz
//     „gałęzie nieosiągalne").
// 10. ŚCIEŻKA CV BEZ `crypto.randomUUID` jest nadal ścieżką, którą panel
//     potrafi podpisać (`isCareerCvPath`), oraz każdy przyjmowany typ MIME ma
//     własne rozszerzenie.
//
// ---------------------------------------------------------------------------
// CO JEST ATRAPOWANE I DLACZEGO
// ---------------------------------------------------------------------------
// TYLKO `@/integrations/supabase/client` — granica danych, czyli jedyna rzecz,
// której ta warstwa nie posiada. Transport to `supabaseFromStub()`
// z `@/test/supabaseChain`: łańcuch ZAPISUJE ogniwa (stąd dowód nr 1 stoi na
// obecności `eq`, a nie na wierze) i rozwiązuje się dopiero przy `await`,
// a kształt odpowiedzi dają `ok`/`fail`. `fail` niesie błąd DZIEDZICZĄCY po
// `Error` — tak jak `PostgrestError` — inaczej `throw new Error(error.message)`
// mierzyłoby atrapę, nie kod. Odpowiedź relacji ofert jest funkcją łańcucha
// (filtruje po `eq`), więc atrapa odpowiada tak, jak odpowiedziałby PostgREST,
// a nie tak, jak byłoby wygodnie testowi.
//
// `storage.upload` i `rpc` w atrapie klienta zapisują wołanie i oddają sukces:
// izolacja najemcy, kolejność walidacji i fail-closed bez tenanta mają pełny
// dowód w `cvUpload.test.ts` i nie są przedmiotem tego pliku.
//
// CO ZOSTAJE PRAWDZIWE: prawdziwy `@tanstack/react-query` (świeży `QueryClient`
// bez ponowień na każde wołanie — inaczej cache przeciekałby między
// przypadkami, a dowód nr 1 mierzyłby kolejność testów), prawdziwy `zod`
// i CAŁA reguła walidacji, prawdziwe `URL` z happy-dom, prawdziwe słowniki
// PL/EN warstwy rekrutacyjnej, prawdziwy katalog `roles.ts`. Atrapowanie
// któregokolwiek z nich zamieniłoby ten plik w test atrapy: przedmiotem dowodu
// są WARUNKI tych reguł, a nie to, że da się je zawołać.
//
// ---------------------------------------------------------------------------
// ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód)
// ---------------------------------------------------------------------------
//  * Łańcuch zapasowy `rowToOffer`, filtry, liczniki, `sectionState` w pełnym
//    zakresie, kształt katalogu wbudowanego — `catalog.test.ts`.
//  * SKĄD sekcje są czytane (widok publiczny vs tabela panelu) —
//    `careerSectionsSource.test.ts`. Tu odgrywam wyłącznie ODMOWĘ i brak
//    wierszy, nie parę źródeł.
//  * Wybór między trzema listami ofert, język, kształt kluczy cache po stronie
//    hooka — `useCareerContent.test.tsx`.
//  * Izolacja najemcy w ścieżce CV, limit 5 MB, kolejność walidacji, podpis
//    linku — `cvUpload.test.ts`.
//  * Skutek znaleziska 1 WIDZIANY PRZEZ KANDYDATA (toast „popraw 0 pól", brak
//    komunikatu przy polu, skok na krok 1) —
//    `src/components/careers/__tests__/careersApplyFormEdges.test.tsx`,
//    znalezisko 1 tamtego pliku. Tu dowodzę tego samego defektu O WARSTWĘ
//    NIŻEJ, na regule: to `collectErrors` gubi błąd, więc naprawa mieszka tu,
//    a nie w formularzu.
//  * Czy anon NAPRAWDĘ nie widzi brudnopisu i czy personel obcego najemcy
//    NAPRAWDĘ nie przeczyta sekcji — polityki RLS, pgTAP. Atrapa transportu
//    dowodzi wyłącznie tego, O CO warstwa PYTA.
//  * Dostępność (`axeViolations`) — ten plik nie ma DOM-u, nie ma czego
//    mierzyć; dowód mieszka w testach organizmów `src/components/careers`.
//
// ---------------------------------------------------------------------------
// GAŁĘZIE NIEOSIĄGALNE UCZCIWYM TESTEM W TEJ WARSTWIE (zostają niepokryte)
// ---------------------------------------------------------------------------
// A. `applicationSchema.ts` `binary-expr@125[1]`, `@126[1]`, `@131[1]` —
//    prawa strona `(value.cvFileName ?? "")` i `(value.cvUrl ?? "")`
//    w `superRefine`. `superRefine` dostaje wartość PO sparsowaniu obiektu,
//    a oba pola są zadeklarowane jako `trimmed.optional().default("")`, więc
//    `undefined` z wejścia zamienia się na `""` ZANIM dojdzie do tej linii.
//    Zapas jest więc martwy przy dzisiejszym schemacie i obudzi się w dniu,
//    w którym ktoś zdejmie `.default("")`. Dowód, że tak jest, stoi w tym
//    pliku: „wejście bez pól CV…" pokazuje `cvFileName: ""` w payloadzie.
// B. `recruitmentShared.ts` `if@62[0]` — `return null` dla protokołu innego niż
//    http(s). Nieosiągalne STRUKTURALNIE: `withScheme` to albo napis, który
//    przeszedł `/^https?:\/\//i`, albo `"https://" + raw`, więc schemat, jaki
//    parsuje `new URL`, jest zawsze `http:`/`https:`. Zmierzone na całym
//    korpusie z dowodu nr 4: obcy schemat kończy się albo wyjątkiem
//    konstruktora (`javascript:`, `data:`, `blob:`, `about:`, `tel:`,
//    `vbscript:` — po prefiksie dają niepoprawny port), albo hostem BEZ KROPKI
//    (`ftp://x` → host `"ftp"`), który odsiewa linia 63. Ta bramka jest obroną
//    w głąb na wypadek zmiany prefiksowania i jej dowodem jest INWARIANT
//    („wynik jest `null` albo adresem http(s)"), nie wykonanie linii.
// C. `cvUpload.ts` `binary-expr@69[1]` — zapas `?? "pdf"` dla rozszerzenia.
//    Nieosiągalne, dopóki trzyma się sprzężenie: `validateCvFile` przepuszcza
//    plik tylko wtedy, gdy MIME jest na liście `CV_ACCEPTED_MIME` (a każdy MIME
//    z tej listy ma wpis w mapie rozszerzeń — dowód nr 10, drugi przypadek)
//    albo gdy nazwa niesie `pdf`/`doc`/`docx` (wtedy `extensionOf` też nie jest
//    `null`). Gałąź obudzi się w dniu, w którym ktoś doda MIME do
//    `CV_ACCEPTED_MIME` bez wpisu w mapie — i wtedy CV wjedzie do magazynu
//    z MYLĄCYM rozszerzeniem `.pdf`. Test „każdy przyjmowany typ MIME…" jest
//    właśnie strażnikiem tego sprzężenia.
//
// POMIAR PO TYM PLIKU (sześć modułów tej paczki, zakres pomiaru
// `src/lib/careers/**`, uruchomiony cały katalog `src/lib/careers/__tests__` -
// tak, jak liczy je bramka modułu):
//
//   linie 208/208 = 100%   funkcje 81/81 = 100%
//   instrukcje 254/255     gałęzie 212/217 = 97,70%
//
// Cała pozostała różnica to DOKŁADNIE pięć gałęzi i jedna instrukcja z listy
// A-C powyżej (`applicationSchema` 125[1], 126[1], 131[1]; `recruitmentShared`
// `if@62[0]` wraz z `return null` z linii 62; `cvUpload` 69[1]) - nic innego
// nie zostało bez dowodu.
//
// ---------------------------------------------------------------------------
// ZNALEZISKA (kod produkcyjny NIEZMIENIONY; testy asertują stan ISTNIEJĄCY)
// ---------------------------------------------------------------------------
// ZNALEZISKO 1 (potwierdzenie warstwą niżej, nie nowe). Zbyt długi LINK DO CV
//   blokuje wysyłkę CICHO. Reguła `cvUrlLong` (limit 500 znaków) zgłasza się na
//   ścieżce `["cvUrl"]`, a `collectErrors` przepuszcza wyłącznie nazwy
//   z `CAREER_FORM_FIELDS`, gdzie stoi WIRTUALNE pole `cv`, nie `cvUrl`.
//   Zmierzony skutek: `validateApplication` oddaje `ok: false` z PUSTĄ mapą
//   błędów, `hasErrors` na tej mapie daje `false`, a `firstField` spada na
//   zapas z linii 158, czyli `firstName` — kreator odsyła kandydata na krok 0,
//   do pola, które jest poprawne. Klucz `careers.form.errors.cvUrlLong` stoi
//   w słowniku (`i18n-careers.ts:391` i `:815`) i jest nieosiągalny. Skutek
//   widziany przez kandydata jest już przybity w `careersApplyFormEdges.test.tsx`
//   (znalezisko 1); ten plik przybija PRZYCZYNĘ. Naprawa mieszka
//   w `collectErrors`/`CAREER_FIELD_STEP` (mapowanie `cvUrl` → `cv`), więc
//   oblany zostanie ten test, nie formularz.
// ZNALEZISKO 2. `normalizeCvUrl` przepuszcza `mailto:` jako adres https
//   z częścią użytkownika: `"mailto:kandydat@example.com"` →
//   `"https://mailto:kandydat@example.com/"`. Wynika to z prefiksowania: po
//   dołożeniu `https://` fragment `mailto:kandydat` staje się `user:hasło`,
//   a host `example.com` ma kropkę, więc przechodzi bramkę z linii 63. Ryzyko
//   jest małe (schemat pozostaje https, więc `<a href>` nie wykona skryptu),
//   ale operator dostaje w panelu link, który prowadzi do żądania z danymi
//   uwierzytelniającymi w URL-u. Zachowanie zaasertowane jako ISTNIEJĄCE;
//   naprawa (odrzucanie wartości z `user`/`password` w URL-u) mieszkałaby
//   w `normalizeCvUrl`.
// ZNALEZISKO 3. `engagementLabel` i `locationLabel` (`recruitmentLayer.ts:98-101`)
//   nie mają ŻADNEGO konsumenta produkcyjnego — zmierzone `grep` po `src/`:
//   `admin.careers.tsx` importuje `departmentLabel`/`seniorityLabel`/`startLabel`/
//   `stageLabel`, `LeadRecruitmentPanel.tsx` te same cztery, a panel edycji
//   ofert `/admin/hiring` bierze te dwa teksty ze SŁOWNIKA i18n
//   (`t("careers.engagement.<slug>")`, `admin.hiring.tsx:596`). Czyli dla
//   wymiaru współpracy i miejsca pracy istnieją DWA niezależne źródła tekstu
//   i to wbudowane jest dziś martwe. To nie defekt zachowania, ale rozjazd
//   autorytetu: dopisanie wartości do enuma trzeba dziś pamiętać w dwóch
//   miejscach, a jedno z nich nie ma jak się odezwać. Testy dowodzą KONTRAKTU,
//   jaki te dwie funkcje obiecują (pełne pokrycie slugów z `CAREER_ROLES`),
//   żeby przy podłączaniu konsumenta nie okazało się, że słownik jest niepełny.
//
// RODO: żadnych prawdziwych osób ani treści. Kandydatka zmyślona („Ewa
// Nowakowska"), adresy wyłącznie w domenie `example.com`, oferty i slugi
// zmyślone (nie odpowiadają żadnemu prawdziwemu ogłoszeniu), najemca to
// wygenerowany uuid, nazwy plików zmyślone, link do CV w domenie
// `drive.example.com`. Plik nie zawiera treści CV ani danych kandydata.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  /** Granica danych: `supabase.from` podstawiane per przypadek. */
  from: null as null | ((table: string) => unknown),
  /** Odpowiedź `public_tenant_id()` dla `currentTenantFolder()`. */
  tenant: null as unknown,
  uploads: [] as Array<{ bucket: string; path: string; contentType?: string; upsert?: boolean }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.from?.(table),
    // Nazwa RPC i fail-closed bez tenanta mają dowód w `cvUpload.test.ts` -
    // tutaj liczy się wyłącznie to, że tenant JEST, więc wysyłka dochodzi do
    // składania nazwy pliku.
    rpc: async () => ({ data: h.tenant, error: null }),
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          _file: unknown,
          options: { contentType?: string; upsert?: boolean },
        ) => {
          h.uploads.push({ bucket, path, ...options });
          return { data: { path }, error: null };
        },
      }),
    },
  },
}));

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

import {
  CAREER_FIELD_STEP,
  CAREER_FORM_FIELDS,
  CV_ACCEPTED_MIME,
  hasErrors,
  validateApplication,
  validateStep,
  type CareerApplicationInput,
} from "../applicationSchema";
import {
  careerRolesQueryOptions,
  careerSectionsQueryOptions,
  sectionState,
  type CareerRoleRow,
} from "../catalog";
import { careerSectionsAdminQueryOptions } from "../catalogAdmin";
import { CV_BUCKET, uploadCv } from "../cvUpload";
import {
  buildRecruitmentLayer,
  engagementLabel,
  isCareerCvPath,
  locationLabel,
  parseRecruitmentApplications,
  parseRecruitmentPipeline,
  type RecruitmentMessageRow,
  type RecruitmentPipelineRow,
} from "../recruitmentLayer";
// Import PROSTO z modułu publicznego, nie przez re-eksport z `recruitmentLayer`:
// luka siedzi w `recruitmentShared.ts`, czyli w module, który jedzie do chunku
// rozliczanego do PUBLIC, i to jego warunek jest tu przedmiotem dowodu.
import { normalizeCvUrl } from "../recruitmentShared";
import { CAREER_ROLES } from "../roles";

const ROLES_RELATION = "career_roles";
const SECTIONS_VIEW = "career_page_sections_public";
const SECTIONS_TABLE = "career_page_sections";

/** Najemca w ścieżce CV - wygenerowany uuid, nie identyfikator z produkcji. */
const TENANT = "3f7c1d90-4b2a-4c6e-9a11-8e5d2c4b7a63";

let stub: SupabaseFromStub;

function freshClient(): QueryClient {
  // Świeży klient na każde wołanie: cache react-query jest stanem globalnym,
  // a dowód nr 1 mówi o KLUCZACH - przeciek między przypadkami mierzyłby
  // kolejność testów, nie kod.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// ---------------------------------------------------------------------------
// FIXTURE (oferty zmyślone - patrz RODO w nagłówku)
// ---------------------------------------------------------------------------

function roleRow(over: Partial<CareerRoleRow> = {}): CareerRoleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "analityk-danych-cee",
    department: "analysis",
    engagement: "contract",
    seniority: "mid",
    location: "remote",
    sort_order: 10,
    is_published: true,
    title_pl: "Analityk danych CEE",
    title_en: "CEE data analyst",
    summary_pl: "Modele danych dla regionu CEE.",
    summary_en: "Data models for the CEE region.",
    responsibilities_pl: ["Modelowanie danych"],
    responsibilities_en: ["Data modelling"],
    requirements_pl: ["Trzy lata praktyki"],
    requirements_en: ["Three years of practice"],
    ...over,
  };
}

const OPUBLIKOWANA = roleRow();
const BRUDNOPIS = roleRow({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "redaktor-brukselski",
  is_published: false,
  title_pl: "Redaktor brukselski (brudnopis)",
  title_en: "Brussels editor (draft)",
});

/** Atrapa relacji ofert odpowiadająca tak, jak odpowiedziałby PostgREST. */
function odpowiedzOfert(): void {
  stub.setResponse(ROLES_RELATION, (chain) =>
    ok(chain.has("eq") ? [OPUBLIKOWANA] : [OPUBLIKOWANA, BRUDNOPIS]),
  );
}

const KANDYDATKA: CareerApplicationInput = {
  firstName: "Ewa",
  lastName: "Nowakowska",
  email: "ewa.nowakowska@example.com",
  phone: "+48 600 100 200",
  linkedin: "",
  department: "analysis",
  role: "analyst_economy",
  seniority: "mid",
  start: "month",
  message: "",
  cvFileName: "cv-ewa-nowakowska.pdf",
  cvUrl: "",
  consent: true,
};

function cvFile(name: string, type: string, size = 1024): File {
  const file = new File(["treść zmyślona"], name, { type });
  // happy-dom nie liczy `size` z treści, a rozmiar jest tu tylko tłem.
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

beforeEach(() => {
  stub = supabaseFromStub();
  h.from = stub.from;
  h.tenant = TENANT;
  h.uploads = [];
});

afterEach(() => {
  h.from = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// catalog.ts - wariant panelu w odczycie ofert
// ===========================================================================

describe("careerRolesQueryOptions: wariant z brudnopisami", () => {
  it("wariant panelu ZDEJMUJE `eq(is_published)` z zapytania, publiczny go dokłada", async () => {
    // Jeden parametr, dwie różne listy w bazie. Panel MUSI widzieć ofertę,
    // której jeszcze nie opublikował (inaczej nie da się jej dokończyć),
    // a strona publiczna nie może zobaczyć ani jednej nieopublikowanej.
    odpowiedzOfert();

    const panel = await freshClient().fetchQuery(careerRolesQueryOptions(true));
    const publiczne = await freshClient().fetchQuery(careerRolesQueryOptions());

    const [lancuchPanelu, lancuchPubliczny] = stub.chainsFor(ROLES_RELATION);
    expect(lancuchPanelu.has("eq")).toBe(false);
    expect(lancuchPubliczny.argsOf("eq")).toEqual(["is_published", true]);
    expect(panel.map((row) => row.slug)).toEqual(["analityk-danych-cee", "redaktor-brukselski"]);
    expect(publiczne.map((row) => row.slug)).toEqual(["analityk-danych-cee"]);
  });

  it("oba warianty stoją pod ROZŁĄCZNYMI kluczami cache - panel nie podmienia listy publicznej", async () => {
    // Najgroźniejsza gałąź tego modułu i jedyna, której nie widać w diffie.
    // Wspólny klucz nie wywala niczego: po wizycie operatora w /admin/hiring
    // pod kluczem ofert siedziałaby lista Z BRUDNOPISAMI, a następne malowanie
    // /zatrudniamy oddałoby ją kandydatom - z ofertą, której nikt nie
    // opublikował. Dowód stoi na SKUTKU: jeden klient, dwa odczyty relacji,
    // dwie różne listy.
    odpowiedzOfert();
    const client = freshClient();

    const panel = await client.fetchQuery(careerRolesQueryOptions(true));
    const publiczne = await client.fetchQuery(careerRolesQueryOptions());

    expect(careerRolesQueryOptions(true).queryKey).toEqual(["career-roles", "all"]);
    expect(careerRolesQueryOptions().queryKey).toEqual(["career-roles", "published"]);
    expect(stub.chainsFor(ROLES_RELATION)).toHaveLength(2);
    expect(panel).toHaveLength(2);
    expect(publiczne).toEqual([OPUBLIKOWANA]);
  });

  it("odpowiedź bez wierszy (`data: null`) wychodzi z warstwy jako pusta lista", async () => {
    // Normalizacja mieszka W WARSTWIE DANYCH - to ona czyni typ
    // `Promise<CareerRoleRow[]>` prawdą w czasie wykonania. Dziś maskują ją
    // konsumenci (`rolesQuery.data ?? []`), czyli ta sama poprawka wpisana
    // drugi raz; bez niej pod kluczem typowanym na tablicę siedziałby `null`.
    stub.setResponse(ROLES_RELATION, ok(null));

    await expect(freshClient().fetchQuery(careerRolesQueryOptions(true))).resolves.toEqual([]);
  });
});

describe("careerSectionsQueryOptions: widok sekcji strony publicznej", () => {
  it("odpowiedź bez wierszy daje pustą listę, a pusta lista znaczy `pokaż` dla każdej sekcji", async () => {
    // Dwie reguły spotykają się dopiero tutaj: `?? []` w zapytaniu i „brak
    // wiersza znaczy pokaż" w `sectionState`. Gdyby zapytanie oddało `null`,
    // `sectionState` przeszłoby przez `rows?.find` na tej samej odpowiedzi -
    // ale konsument z `.map` po sekcjach dostałby wyjątek na świeżej
    // instalacji, czyli w jedynym momencie, w którym ta ścieżka żyje.
    stub.setResponse(SECTIONS_VIEW, ok(null));

    const rows = await freshClient().fetchQuery(careerSectionsQueryOptions());

    expect(rows).toEqual([]);
    expect(sectionState(rows, "hero", "pl")).toEqual({
      visible: true,
      title: null,
      subtitle: null,
    });
  });
});

// ===========================================================================
// catalogAdmin.ts - odczyt sekcji dla panelu
// ===========================================================================

describe("careerSectionsAdminQueryOptions: awaria odczytu tabeli sekcji", () => {
  it("odmowa RLS WYWRACA zapytanie komunikatem PostgREST, zamiast oddać pustą listę", async () => {
    // Panel czyta TABELĘ przez `career_sections_staff_read` (is_staff + własny
    // najemca). Gdyby odmowa wychodziła jako `[]`, operator zobaczyłby siedem
    // sekcji „bez nadpisań" i pierwszy zapis nadpisałby istniejące nagłówki
    // pustym brudnopisem - cicha utrata treści redakcji. Komunikat musi
    // dojechać, bo react-query rysuje z niego stan błędu.
    stub.setResponse(
      SECTIONS_TABLE,
      fail("permission denied for table career_page_sections", "42501"),
    );

    await expect(freshClient().fetchQuery(careerSectionsAdminQueryOptions())).rejects.toThrow(
      "permission denied for table career_page_sections",
    );
    expect(stub.lastChain(SECTIONS_TABLE)?.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("odpowiedź bez wierszy daje pustą listę - świeży najemca nie ma jeszcze sekcji", async () => {
    stub.setResponse(SECTIONS_TABLE, ok(null));

    await expect(freshClient().fetchQuery(careerSectionsAdminQueryOptions())).resolves.toEqual([]);
  });
});

// ===========================================================================
// recruitmentShared.ts - bramka schematu w linku do CV
// ===========================================================================

describe("normalizeCvUrl: obcy schemat nie wychodzi z normalizacji", () => {
  // Link podaje kandydat, a panel wstawia go w `<a href>` bez pytania. Wynik
  // musi być albo `null`, albo adresem http(s) - trzeciej możliwości nie ma.
  it.each([
    ["javascript:alert(1)", null],
    ["vbscript:msgbox(1)", null],
    ["data:text/html,<script>alert(1)</script>", null],
    ["blob:https://evil.example/x", null],
    ["about:blank", null],
    ["tel:+48600100200", null],
    ["file:///etc/passwd", null],
    ["ftp://files.example.com/cv.pdf", null],
    ["ws://evil.example", null],
    ["mailto:kandydat@example.com", "https://mailto:kandydat@example.com/"],
    ["//evil.example/cv.pdf", "https://evil.example/cv.pdf"],
    ["HTTP://Files.Example.com/cv.pdf", "http://files.example.com/cv.pdf"],
  ] as const)("adres %j normalizuje się do %j", (raw, oczekiwane) => {
    const wynik = normalizeCvUrl(raw);

    expect(wynik).toBe(oczekiwane);
    // Inwariant całej funkcji - i jedyny dowód, jaki da się postawić pod
    // bramką schematu z linii 62 (patrz „gałęzie nieosiągalne", punkt B).
    if (wynik !== null) expect(wynik).toMatch(/^https?:\/\//);
  });

  it("obcy schemat odsiewa KROPKA w nazwie hosta, nie porównanie protokołu", async () => {
    // Ustalenie, które rozstrzyga, gdzie mieszka bezpieczeństwo tej funkcji.
    // `"ftp://files.example.com/cv.pdf"` NIE pasuje do `/^https?:\/\//`, więc
    // dostaje prefiks `https://` - i wtedy `ftp` jest HOSTEM (bez kropki),
    // a nie schematem. Ten sam adres bez `ftp:` przechodzi, co dowodzi, że
    // odrzucenie wzięło się z hosta, nie z protokołu.
    expect(normalizeCvUrl("ftp://files.example.com/cv.pdf")).toBeNull();
    expect(normalizeCvUrl("files.example.com/cv.pdf")).toBe("https://files.example.com/cv.pdf");
  });
});

// ===========================================================================
// recruitmentLayer.ts - etykiety wymiaru współpracy i miejsca pracy
// ===========================================================================

describe("etykiety wymiaru współpracy i miejsca pracy", () => {
  it("wymiar współpracy ma tekst w obu językach panelu, a nieznany slug wychodzi surowo", () => {
    expect(engagementLabel("full_time", "pl")).toBe("Pełny etat");
    expect(engagementLabel("full_time", "en")).toBe("Full time");
    expect(engagementLabel("contract", "pl")).toBe("Kontrakt / B2B");
    expect(engagementLabel("internship", "en")).toBe("Internship");
    // Nieznana wartość z bazy pokazuje się surowo - lepiej „kontrakt_zlecenie"
    // niż puste pole w kolumnie panelu.
    expect(engagementLabel("kontrakt_zlecenie", "pl")).toBe("kontrakt_zlecenie");
    expect(engagementLabel("", "pl")).toBe("");
  });

  it("miejsce pracy ma tekst w obu językach panelu, a brak wartości zostaje pusty", () => {
    expect(locationLabel("brussels", "pl")).toBe("Bruksela");
    expect(locationLabel("brussels", "en")).toBe("Brussels");
    expect(locationLabel("hybrid", "pl")).toBe("Hybrydowo");
    expect(locationLabel("remote", "en")).toBe("Remote");
    expect(locationLabel("ksiezyc", "en")).toBe("ksiezyc");
    expect(locationLabel(undefined, "pl")).toBe("");
  });

  it("każdy wymiar i każde miejsce z katalogu ról ma etykietę w obu językach", () => {
    // Bramka zamkniętego zbioru. Dodanie roli z nowym slugiem (albo wartości do
    // enuma) bez wpisu w słowniku oblewa ten warunek, zamiast pokazać operatorowi
    // goły slug w kolumnie. Kontrola liczności pilnuje, żeby katalog naprawdę
    // ćwiczył wszystkie cztery wartości każdej fasety.
    const wymiary = new Set(CAREER_ROLES.map((role) => role.engagement));
    const miejsca = new Set(CAREER_ROLES.map((role) => role.location));
    expect(wymiary.size).toBe(4);
    expect(miejsca.size).toBe(4);

    for (const role of CAREER_ROLES) {
      expect(engagementLabel(role.engagement, "pl"), role.id).not.toBe(role.engagement);
      expect(engagementLabel(role.engagement, "en"), role.id).not.toBe(role.engagement);
      expect(locationLabel(role.location, "pl"), role.id).not.toBe(role.location);
      expect(locationLabel(role.location, "en"), role.id).not.toBe(role.location);
    }
  });
});

// ===========================================================================
// recruitmentLayer.ts - wiersz procesu świeżo wstawiony i kontakt bez joina
// ===========================================================================

describe("parseRecruitmentPipeline: wiersz sprzed pierwszej decyzji operatora", () => {
  it("brak daty zmiany etapu daje `null`, a nie pusty napis", () => {
    // Tak wygląda wiersz `career_applications` zaraz po wstawieniu: etap jest,
    // reszta kolumn puste. Panel formatuje te wartości datownikiem, a pusty
    // napis wyrenderowałby się jako „Invalid Date" w kolumnie „ostatnia zmiana".
    const pipeline = parseRecruitmentPipeline({ stage: "screening" });

    expect(pipeline).toEqual({
      id: "",
      stage: "screening",
      stageChangedAt: null,
      stageNote: "",
      rating: null,
      rejectionReason: "",
      nextStepAt: null,
      ownerId: null,
      closed: false,
    });
  });

  it("ocena spoza typu liczbowego (`null` z kolumny, napis z jsonb) daje `null`", () => {
    // Gwiazdki w panelu liczą się z tej wartości: napis „4" dałby `NaN`
    // w arytmetyce, a `NaN` renderuje się jako puste miejsce, nie jako brak oceny.
    expect(parseRecruitmentPipeline({ stage: "offer", rating: null })?.rating).toBeNull();
    expect(
      parseRecruitmentPipeline({ stage: "offer", rating: "4" } as unknown as RecruitmentPipelineRow)
        ?.rating,
    ).toBeNull();
    // Kontrola, że to typ, a nie wartość: zero jest oceną i musi przejść.
    expect(parseRecruitmentPipeline({ stage: "offer", rating: 0 })?.rating).toBe(0);
  });
});

describe("warstwa rekrutacyjna kontaktu bez dołączonych wiadomości", () => {
  it("brak listy wiadomości daje pustą listę zgłoszeń, nie wyjątek", () => {
    // `messages` jest w typie OPCJONALNE, bo karta kontaktu CRM czyta warstwę
    // także wtedy, gdy zapytanie o skrzynkę jeszcze nie wróciło albo padło.
    expect(parseRecruitmentApplications(undefined)).toEqual([]);
    expect(parseRecruitmentApplications(null)).toEqual([]);
  });

  it("kontakt bez wiadomości i bez aliasów daje KOMPLETNĄ, pustą warstwę", () => {
    // Kształt jest kontraktem panelu: brakujące pole (np. `linkedins`) daje
    // `undefined.map` w module „Rekrutacja" karty kontaktu.
    expect(buildRecruitmentLayer({})).toEqual({
      hasHistory: false,
      applicationCount: 0,
      firstAppliedAt: null,
      lastAppliedAt: null,
      applications: [],
      roleLabels: [],
      departments: [],
      seniorities: [],
      linkedins: [],
    });
  });

  it("zgłoszenie bez języka domyśla się polskiego", () => {
    // `contact_messages.lang` jest nullable (import CSV i partnerzy CRM piszą
    // wiersze bez języka). Pusta wartość poszłaby do odpowiedzi kandydatowi
    // jako brak języka, a operator odpisuje z panelu w tym, co tu stoi.
    const row: RecruitmentMessageRow = {
      id: "msg-bez-jezyka",
      form_id: "careers",
      created_at: "2026-08-14T10:00:00.000Z",
      custom: { role: "analyst_economy" },
    };

    const [zgloszenie] = parseRecruitmentApplications([row]);

    expect(zgloszenie.lang).toBe("pl");
    expect(zgloszenie.role).toBe("analyst_economy");
  });
});

// ===========================================================================
// applicationSchema.ts - wyjścia awaryjne zbierania błędów
// ===========================================================================

describe("validateApplication: błędy, których kreator nie umie pokazać", () => {
  it("ZNALEZISKO: zbyt długi link do CV oblewa walidację z PUSTĄ mapą błędów", () => {
    // Mechanizm: reguła `cvUrlLong` zgłasza się na ścieżce `["cvUrl"]`, a do
    // kreatora wpuszczane są tylko nazwy z `CAREER_FORM_FIELDS` - gdzie stoi
    // wirtualne pole `cv`, nie `cvUrl`. Skutek widziany przez kandydata jest
    // przybity w `careersApplyFormEdges.test.tsx`; tu stoi PRZYCZYNA.
    expect(CAREER_FORM_FIELDS as readonly string[]).not.toContain("cvUrl");
    const zaDlugi = `https://drive.example.com/${"a".repeat(500)}`;
    expect(zaDlugi.length).toBeGreaterThan(500);

    const wynik = validateApplication({ ...KANDYDATKA, cvUrl: zaDlugi });

    expect(wynik.ok).toBe(false);
    if (wynik.ok) return;
    // Wysyłki nie ma - i to jedyna dobra połowa tego zachowania.
    expect(wynik.errors).toEqual({});
    expect(hasErrors(wynik.errors)).toBe(false);
    // `firstField` spada na zapas z linii 158, czyli na pierwsze pole kreatora:
    // kandydat wraca na krok 0, do pola, które jest poprawne.
    expect(wynik.firstField).toBe("firstName");
    expect(wynik.firstStep).toBe(CAREER_FIELD_STEP.firstName);
    // Walidacja kroku widzi to samo, czyli NIC - dlatego kreator przepuszcza
    // oba kroki i dopiero wysyłka kończy się bez wyjaśnienia.
    expect(validateStep(0, { ...KANDYDATKA, cvUrl: zaDlugi })).toEqual({});
  });

  it("wejście spoza kształtu obiektu oblewa walidację, zamiast rzucić wyjątkiem", () => {
    // Zod zgłasza wtedy jeden błąd BEZ ścieżki (`path: []`), więc `collectErrors`
    // nie ma czego przypisać do pola. Kreator musi z tego wyjść wskazaniem
    // pierwszego kroku - inaczej niepoprawny kształt stanu formularza (regresja
    // w komponencie, hydratacja z pustym stanem) wywraca cały ekran zamiast
    // pokazać walidację.
    const wynik = validateApplication(null as unknown as CareerApplicationInput);

    expect(wynik).toEqual({
      ok: false,
      errors: {},
      firstStep: 0,
      firstField: "firstName",
    });
    expect(validateStep(1, null as unknown as CareerApplicationInput)).toEqual({});
  });

  it("wejście bez pól CV normalizuje je do PUSTYCH napisów - do CRM nie leci `undefined`", () => {
    // Dowód, że `?? \"\"` w `superRefine` jest dziś martwe (punkt A w nagłówku):
    // `trimmed.optional().default(\"\")` zamienia brak pola na pusty napis
    // ZANIM reguła CV je przeczyta. Payload jedzie do `contact_messages.custom`,
    // gdzie `undefined` znika po serializacji - i panel traci nazwę pliku.
    const bezPolCv = { ...KANDYDATKA } as Record<string, unknown>;
    delete bezPolCv.cvFileName;
    delete bezPolCv.cvUrl;

    const brakCV = validateApplication(bezPolCv as CareerApplicationInput);
    expect(brakCV.ok).toBe(false);
    if (!brakCV.ok) {
      expect(brakCV.errors.cv).toBe("careers.form.errors.cvRequired");
      expect(brakCV.firstField).toBe("cv");
    }

    const zLinkiem = validateApplication({
      ...(bezPolCv as CareerApplicationInput),
      cvUrl: "drive.example.com/cv-ewa",
    });
    expect(zLinkiem.ok).toBe(true);
    if (!zLinkiem.ok) return;
    expect(zLinkiem.value.cvFileName).toBe("");
    expect(zLinkiem.value.message).toBe("");
  });
});

// ===========================================================================
// cvUpload.ts - identyfikator pliku i rozszerzenie
// ===========================================================================

describe("uploadCv: przeglądarka bez `crypto.randomUUID`", () => {
  const CZAS = "2026-08-14T09:30:00.000Z";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CZAS));
  });

  it("ścieżka z identyfikatorem zapasowym NADAL przechodzi bramkę `isCareerCvPath`", async () => {
    // `crypto.randomUUID` nie istnieje w kontekście nie-secure (http://) ani
    // w starszym Safari - a formularz karier jest publiczny, więc taki klient
    // do niego dojdzie. Zapas składa identyfikator z czasu i `Math.random`.
    // Ważne jest nie to, że ścieżka powstaje, ale że powstaje ŚCIEŻKA, którą
    // panel potrafi potem podpisać: `signCvUrl` woła się dopiero po bramce
    // kształtu (`isCareerCvPath` w `parseRecruitmentApplications`), więc
    // identyfikator poza jej wzorcem oznaczałby CV wgrane i niedostępne
    // operatorowi - bez żadnego błędu po drodze.
    const prawdziweCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: prawdziweCrypto.getRandomValues.bind(prawdziweCrypto),
    });
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const wynik = await uploadCv(cvFile("cv-ewa-nowakowska.pdf", "application/pdf"));

    expect(wynik.ok).toBe(true);
    const znacznik = new Date(CZAS).getTime();
    const oczekiwana = `${TENANT}/uploads/2026-08-14/${znacznik}-8.pdf`;
    expect(h.uploads).toEqual([
      {
        bucket: CV_BUCKET,
        path: oczekiwana,
        contentType: "application/pdf",
        upsert: false,
      },
    ]);
    if (!wynik.ok) return;
    expect(wynik.path).toBe(oczekiwana);
    expect(isCareerCvPath(wynik.path)).toBe(true);
  });

  it("każdy przyjmowany typ MIME ma WŁASNE rozszerzenie - zapas `.pdf` nie budzi się", async () => {
    // Strażnik sprzężenia, na którym stoi martwota zapasu `?? \"pdf\"`
    // (punkt C w nagłówku): plik z akceptowanym MIME i nazwą BEZ rozszerzenia
    // dostaje rozszerzenie z mapy MIME. Gdyby ktoś dopisał MIME do
    // `CV_ACCEPTED_MIME` bez wpisu w mapie, walidacja by go przepuściła,
    // a plik wjechałby do magazynu jako `.pdf` - mylące rozszerzenie
    // w podpisanym linku, który operator wysyła dalej.
    const oczekiwane: Record<string, string> = {
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    };

    for (const mime of CV_ACCEPTED_MIME) {
      h.uploads = [];
      const wynik = await uploadCv(cvFile("zyciorys-bez-rozszerzenia", mime));

      expect(wynik.ok, mime).toBe(true);
      expect(h.uploads[0].path.split(".").pop(), mime).toBe(oczekiwane[mime]);
      expect(isCareerCvPath(h.uploads[0].path), mime).toBe(true);
    }
  });
});
