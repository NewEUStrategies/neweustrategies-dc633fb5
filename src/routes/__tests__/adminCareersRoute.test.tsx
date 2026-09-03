/**
 * Trasa `/admin/careers` ZAMONTOWANA - skrzynka zgłoszeń rekrutacyjnych ze
 * strony /zatrudniamy. Przed tym plikiem 0/109 linii, 0/42 funkcji i 0/151
 * gałęzi: najgłębsza czarna dziura modułu „Rekrutacja / kariera" i największa
 * liczba niepokrytych gałęzi w całym module.
 *
 * PO CO TEN PLIK. To jedyny ekran w repo, na którym operator obraca DANYMI
 * OSOBOWYMI KANDYDATA: imieniem, adresem, telefonem, treścią zgłoszenia
 * i PLIKIEM CV z prywatnego bucketu. Cztery decyzje tego ekranu mają skutki,
 * których nie da się cofnąć kliknięciem:
 *   1. DOSTĘP DO CV - panel podpisuje link do pliku w prywatnym buckecie na
 *      podstawie `custom.cv_path`, czyli pola, które przyszło z PUBLICZNEGO
 *      formularza. Bez bramki kształtu jedno podmienione pole w żądaniu daje
 *      podpisany adres do dowolnego obiektu w buckecie - czyli do CV innego
 *      kandydata (uzasadnienie stoi przy `CV_PATH_RE` w `recruitmentShared`).
 *   2. USUNIĘCIE ZGŁOSZENIA - kaskada zabiera wiersz procesu i dziennik,
 *      a trigger `career_cv_enqueue_on_message_delete` kolejkuje plik CV do
 *      wymazania z magazynu. Panel nie ma tu żadnego „cofnij".
 *   3. PRZEJŚCIA ETAPÓW - `stage` razem z `stage_note` jadą JEDNYM UPDATE-em,
 *      bo dziennik decyzji („kogo i dlaczego odrzuciliśmy") pisze trigger
 *      `career_application_log_stage`. Rozdzielenie tych dwóch zapisów
 *      zostawiłoby zmianę etapu bez uzasadnienia w audycie.
 *   4. OZNACZANIE PRZECZYTANE - efekt uboczny SAMEGO otwarcia zgłoszenia,
 *      widoczny w drugiej skrzynce (Contact Center czyta tę samą tabelę).
 *
 * ---------------------------------------------------------------------------
 * PYTANIE 1: GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE
 * ---------------------------------------------------------------------------
 * Sprawdzone przed napisaniem asercji, nie założone:
 *   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
 *      renderu: `useAuth()` daje `isStaff`, efekt robi
 *      `navigate({ to: "/login" })`, a komponent zwraca `null`.
 *   2. TA trasa - zero warunku roli: nie ma `useAuth`, `beforeLoad`,
 *      `redirect` ani `<Navigate/>`.
 *   3. Odczyt i zapis idą ZWYKŁYM klientem Supabase (`supabase.from(...)`),
 *      nie funkcją serwerową z middleware. Autorytetem ostatecznym są więc
 *      polityki `career_applications_staff_read` / `_staff_update`,
 *      `career_application_events_staff_read` oraz polityka bucketu
 *      `career_cv_staff_read` - i to one są tutaj przedmiotem asercji NA
 *      ISTNIENIE (dowód wykonawczy należy do pgTAP, patrz ZNALEZISKO 3).
 * Dlatego NIE MA tu testu „bez roli nie widzi panelu": mierzyłby atrapę
 * `useAuth`, której ta trasa nawet nie woła. Jest zamiast tego dowód
 * pozytywny (render nie pyta o rolę) i dowód, że warunek stoi w layoucie.
 *
 * ---------------------------------------------------------------------------
 * CO JEST PRZEDMIOTEM DOWODU
 * ---------------------------------------------------------------------------
 *   * `head()`: tytuł karty i `robots: noindex` (skrzynka z danymi osobowymi
 *     nie ma czego szukać w indeksie).
 *   * KSZTAŁT ZAPYTANIA LISTY: `form_id = "careers"`, kolejność malejąca po
 *     `created_at`, `limit(500)`, embed `career_applications(...)` w JEDNYM
 *     literale, oraz MINIMALIZACJA DANYCH - panel pobiera dokładnie jedenaście
 *     kolumn, których renderuje, i ani jednej więcej (żadnego `select("*")`).
 *   * FILTRY: który jedzie do BAZY (skrzynka: nowe / wszystkie / archiwum),
 *     a który jest przeliczany na KLIENCIE (etap procesu i szukajka).
 *   * `CvAccess` w całości: kto i jak dostaje podpisany adres, że adres NIE
 *     powstaje bez żądania i NIE trafia do DOM-u, co się dzieje przy odmowie
 *     podpisu, jak zachowuje się ścieżka o nieznanym kształcie i link bez
 *     schematu, oraz jak panel odróżnia „kandydat nie dał CV" od „CV usunięte
 *     przez retencję".
 *   * PRZEJŚCIA ETAPÓW: ładunek UPDATE-u (`stage` + `stage_note` razem), cel
 *     zapisu (`career_applications.id`, a NIE `contact_messages.id`), toast,
 *     czyszczenie notatki, unieważnienia, ocena bez notatki, odmowa bazy oraz
 *     wiersz procesu bez identyfikatora.
 *   * DZIENNIK DECYZJI: po czym jest pytany, w jakiej kolejności, i że panel
 *     go tylko czyta.
 *   * STANY LISTY: ładowanie, pustka, odpowiedź `null`, odmowa odczytu.
 *   * ARCHIWIZACJA i USUNIĘCIE (z potwierdzeniem i z odmową).
 *   * CRM: dopasowanie po `email_norm`, obie gałęzie („zsynchronizowano" /
 *     „brak leada") i link do karty leada.
 *   * DWUJĘZYCZNOŚĆ panelu (wbudowane słowniki PL/EN) - napędzana PRAWDZIWĄ
 *     instancją i18n przez `i18n.changeLanguage`.
 *   * Brak naruszeń axe na obu widokach (lista i otwarte zgłoszenie).
 *
 * ---------------------------------------------------------------------------
 * CO JEST ATRAPOWANE I DLACZEGO (granica atrapy = moduł z własnym dowodem)
 * ---------------------------------------------------------------------------
 *   * `@/integrations/supabase/client` - wspólną atrapą łańcucha PostgREST
 *     (`@/test/supabaseChain`). Granica sieci; tutaj interesuje nas, JAKIE
 *     zapytanie panel składa i co robi z odpowiedzią.
 *   * `@/lib/careers/cvUpload` (`signCvUrl`) - buduje zapytanie do magazynu
 *     i ma własny plik dowodu (`src/lib/careers/__tests__/cvUpload.test.ts`).
 *     Atrapa pozwala dowieść tego, czego tam dowieść nie sposób: że panel woła
 *     podpis DOKŁADNIE dla ścieżki, która przeszła bramkę kształtu, i że
 *     podpisany adres nie wycieka do drzewa DOM.
 *   * `sonner` - toasty jako zapis skutku, nie jako render.
 *
 * CO ZOSTAJE PRAWDZIWE (i dlaczego atrapowanie zamieniłoby ten plik w test
 * atrapy):
 *   * `@/lib/careers/recruitmentLayer` i `recruitmentShared` - to CZYSTE
 *     moduły bez zapytań, których panel używa jako słownika i parsera.
 *     Atrapa `parseRecruitmentPipeline` albo `stageLabel` skasowałaby cały
 *     dowód o tym, że panel pokazuje operatorowi TEKST etapu (a nie kod
 *     enuma), że znosi oba kształty embedu PostgREST (obiekt / tablica) i że
 *     ścieżka CV o nieznanym kształcie nie zostaje podpisana. Ich własne
 *     testy jednostkowe (`recruitmentLayer.test.ts`) dowodzą parsowania
 *     w izolacji; TUTAJ dowodzimy, że panel z nich korzysta.
 *   * `react-i18next`, `@tanstack/react-router`, `@tanstack/react-query`
 *     i komponenty `ui/*`.
 *
 * UWAGA O `realT`. Ta trasa NIE MA ANI JEDNEGO KLUCZA i18n: napisy panelu
 * mieszkają w module w dwóch stałych (`PL`, `EN`), których plik nie
 * eksportuje - taki sam wzorzec, co `admin.crm.$id.tsx`. Asercje na te napisy
 * są więc literałami Z KONIECZNOŚCI, a nie z lenistwa; ich uczciwość pilnuje
 * osobny dowód, że przełączenie języka PRAWDZIWEJ instancji i18n zmienia
 * KAŻDY z nich (czyli że test mierzy wybór słownika, a nie napis wklejony
 * w teście). Napisy pochodzące ze wspólnej warstwy (`stageLabel`,
 * `departmentLabel`, `seniorityLabel`, `startLabel`) są asertowane PRZEZ TE
 * FUNKCJE, więc mierzą słownik. `realT("pl")` jest tu użyty tam, gdzie ma sens:
 * do dowodu, że `aria-label="Refresh"` NIE MA klucza w słowniku (ZNALEZISKO 4).
 *
 * ---------------------------------------------------------------------------
 * ZNALEZISKA (defekty produkcyjne i dziury w dowodzie - kod nietknięty)
 * ---------------------------------------------------------------------------
 * 1. ODMOWA ODCZYTU WYGLĄDA JAK PUSTA SKRZYNKA. `data: rows = []` (linia 296)
 *    sprowadza błąd zapytania do tej samej gałęzi co pustkę, więc gdy RLS
 *    odmówi albo sieć padnie, operator czyta „Brak zgłoszeń." - zdanie o
 *    STANIE BAZY, a nie o tym, że odczyt nie doszedł. Zgłoszenie kandydata
 *    wygląda wtedy na nieistniejące, a termin odpowiedzi biegnie dalej.
 *    Zapisane jako `it.fails` z kontrolą dodatnią; zachowanie ISTNIEJĄCE jest
 *    zaasertowane obok.
 * 2. FILTR ETAPU I SZUKAJKA LICZĄ SIĘ NA KLIENCIE, NA UCIĘTEJ LIŚCIE.
 *    Zapytanie ma `limit(500)`, a `stageFilter` i `q` przesiewają tablicę
 *    w `useMemo` (linie 332-355). Dla najemcy z ponad 500 zgłoszeniami
 *    „Domknięte" i szukanie po nazwisku pokazują wynik z PIERWSZYCH 500
 *    wierszy i milczą o resztzie. To zachowanie jest tu zaasertowane WPROST
 *    (zmiana filtra etapu NIE wywołuje nowego zapytania), żeby nikt nie
 *    pomylił go z filtrem serwerowym.
 * 3. PIPELINE REKRUTACYJNY NIE MA ANI JEDNEGO DOWODU pgTAP. Migracja
 *    `20260814110000_careers_pipeline_and_cv_retention.sql` zakłada cztery
 *    polityki RLS, trzy triggery (bootstrap, touch, dziennik) i kolejkę
 *    usunięć CV, a w `supabase/tests/` nie ma ŻADNEGO pliku wspominającego
 *    `career_applications`. Ta trasa nie ma na kliencie żadnego warunku
 *    najemcy, więc polityka bazy jest jedynym, co dzieli tenantów - i to
 *    właśnie ona jest bez dowodu wykonawczego. Zapisane jako `it.fails`
 *    z kontrolą dodatnią (`career_sections_visibility_public_read_test.sql`).
 * 4. `aria-label="Refresh"` JEST NIEPRZETŁUMACZONYM LITERAŁEM (linia 518) -
 *    jedyna nazwa dostępna na tym ekranie, która nie przechodzi ani przez
 *    słownik i18n, ani przez wbudowane `PL`/`EN`. Osoba czytająca panel
 *    czytnikiem ekranu po polsku słyszy angielskie słowo. Zaasertowane jako
 *    stan istniejący, z dowodem przez `realT`, że klucza w słowniku nie ma.
 * 5. WIERSZ PROCESU BEZ IDENTYFIKATORA POKAZUJE SUROWY KLUCZ. Gdy embed
 *    `career_applications` przyjdzie bez `id`, `parseRecruitmentPipeline`
 *    zwraca pipeline z `id: ""`, panel renderuje pełną sekcję etapów, a próba
 *    zapisu kończy się toastem o treści `no_pipeline_row` - kluczem
 *    technicznym zamiast zdania. Zaasertowane jest zachowanie ISTNIEJĄCE
 *    (żaden UPDATE nie wychodzi do bazy - i to jest w tym dobra połowa).
 * 6. TRASA `admin.careers.tsx` NIE JEST WIDZIANA PRZEZ ŻADNĄ LISTĘ RODZIN
 *    W BRAMCE `adminRouteAuthority.gate.test.ts` (grep: zero trafień na
 *    „careers"). Nie dopisuję jej tam, bo to plik innej paczki roboczej -
 *    zgłaszam w raporcie.
 * 7. ODMOWA ZAPISU „PRZECZYTANE"/ARCHIWIZACJI JEST CAŁKOWICIE CICHA. Mutacja
 *    `patch` (linie 383-398) jest JEDYNĄ z trzech mutacji tego ekranu bez
 *    `onError` - `savePipeline` i `removeApplication` mają swoje. Operator
 *    klika „Archiwizuj", polityka odmawia, i nie pada ani komunikat, ani
 *    zmiana etykiety: zgłoszenie zostaje w kolejce „Nowe" bez śladu porażki.
 * 8. ODMOWA ODCZYTU CRM I DZIENNIKA JEST NIEROZRÓŻNIALNA OD PUSTKI. `data?.[0]
 *    ?? null` (lead) i `data: events = []` (dziennik) sprowadzają błąd do tej
 *    samej gałęzi co brak danych, więc odmowa daje „Brak leada w CRM" (i cichy
 *    duplikat leada w CRM) oraz „Brak zmian etapu." - czyli PUSTY AUDYT decyzji
 *    o kandydacie. To ta sama klasa błędu co ZNALEZISKO 1, tylko dotyczy
 *    dokumentu, po który sięga się przy skardze na proces rekrutacji.
 *
 * ---------------------------------------------------------------------------
 * CZEGO NIE DA SIĘ TU DOWIEŚĆ UCZCIWIE (2 gałęzie z 151, świadomie zostawione)
 * ---------------------------------------------------------------------------
 * `(current?.email ?? "")` w filtrze zapytania o lead (linia 375) i
 * `(current?.pipeline?.id ?? "")` w filtrze dziennika (linia 424) mają
 * nieosiągalną prawą stronę: każde z tych zapytań stoi za `enabled:
 * Boolean(...)` sprawdzającym DOKŁADNIE tę samą wartość, więc `queryFn` nie
 * biegnie, gdy jest nullish. To obrona defensywna bez wejścia - żeby ją
 * wywołać, trzeba by zawołać `queryFn` poza routerem i poza react-query, czyli
 * zmierzyć własną atrapę zamiast panelu. Odpowiednikiem dowodowym są dwa testy
 * mierzące SKUTEK tej bramki: „bez wyboru prawa kolumna prosi o wybór"
 * (zero łańcuchów do `crm_leads` i `career_application_events`) oraz
 * „ZNALEZISKO 5" (brak identyfikatora procesu = zero pytań o dziennik).
 * Pozostałe 149 gałęzi, wszystkie 42 funkcje i wszystkie 109 linii są pokryte.
 *
 * ŚWIADOMIE POZA ZAKRESEM (i gdzie mieszka tamten dowód):
 *   * wykonanie polityk RLS i triggerów (`career_application_log_stage`,
 *     `career_cv_enqueue_on_message_delete`, `career_cv_gc_*`) - pgTAP,
 *     dziś nieistniejący (ZNALEZISKO 3);
 *   * podpisywanie linku w magazynie (`signCvUrl`, `uploadCv`, walidacja
 *     pliku) - `src/lib/careers/__tests__/cvUpload.test.ts`;
 *   * parsowanie warstwy rekrutacyjnej w izolacji -
 *     `src/lib/careers/__tests__/recruitmentLayer.test.ts`;
 *   * bramka roli dla `/admin/*` - `src/routes/admin.tsx` i bramka rodzin
 *     `adminRouteAuthority.gate.test.ts`;
 *   * retencja plików CV (job drenujący kolejkę) - `cvRetention.test.ts`.
 *
 * RODO: wszystkie osoby, adresy, treści i nazwy plików są ZMYŚLONE, adresy
 * wyłącznie w domenie `@example.com`, identyfikatory najemcy i plików to
 * jawne fikcje. Żaden fragment nie pochodzi z produkcji.
 */
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { RecruitmentPipelineRow } from "@/lib/careers/recruitmentLayer";

interface RecordedToast {
  kind: "success" | "error";
  text: string;
}

const h = vi.hoisted(() => ({
  /** Wiersze skrzynki. `null` odtwarza odpowiedź PostgREST bez ciała. */
  rows: [] as unknown[] | null,
  rowsError: null as string | null,
  /** Tabele, których łańcuch NIGDY nie odpowiada - do dowodów o oczekiwaniu. */
  hang: new Set<string>(),

  leads: [] as unknown[] | null,
  leadsError: null as string | null,
  events: [] as unknown[] | null,
  eventsError: null as string | null,

  updateError: null as string | null,
  deleteError: null as string | null,
  pipelineError: null as string | null,

  /** Podpisany adres oddawany przez atrapę magazynu (`null` = odmowa). */
  signed: null as string | null,
  signCalls: [] as string[],
  signHolds: false,
  releaseSign: null as (() => void) | null,

  confirmAnswer: true,
  confirmMessages: [] as string[],
  opened: [] as unknown[][],
  toasts: [] as RecordedToast[],
}));

const stub = vi.hoisted(() => ({ current: null as unknown }));

// GRANICA SIECI. Atrapa jest wspólna dla całego repo (`@/test/supabaseChain`),
// więc test widzi DOKŁADNIE te ogniwa PostgREST, które panel wywołał - w tym
// `is` kontra `not` przy filtrze archiwum i dwa różne `eq` w dwóch zapytaniach.
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const shared = supabaseFromStub();
  stub.current = shared;
  /**
   * Łańcuch, który nigdy nie rozwiązuje `await` - jedyny sposób, żeby dowieść
   * stanu oczekiwania (atrapa wspólna odpowiada synchronicznie, bo taki jest
   * jej kontrakt; ten kształt jest tu wyjątkiem, nie drugim harnessem).
   */
  const hangingChain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "is",
      "not",
      "order",
      "limit",
    ]) {
      builder[method] = () => builder;
    }
    builder.then = () => undefined;
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.hang.has(table) ? hangingChain() : shared.from(table)),
    },
  };
});

// GRANICA MAGAZYNU. `signCvUrl` buduje zapytanie do storage i ma własny plik
// dowodu; tutaj liczy się, CZY i DLA JAKIEJ ścieżki panel je woła.
vi.mock("@/lib/careers/cvUpload", () => ({
  signCvUrl: async (path: string): Promise<string | null> => {
    h.signCalls.push(path);
    if (h.signHolds) {
      await new Promise<void>((resolve) => {
        h.releaseSign = resolve;
      });
    }
    return h.signed;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

// `react-i18next` NIE JEST atrapowany: fabryka `reactI18nextMock()` sięga po
// `@/lib/i18n`, czyli moduł importujący właśnie atrapowany pakiet
// (zakleszczenie - ostrzeżenie z nagłówka `@/test/i18nReal`). Język panelu
// przełączamy na PRAWDZIWEJ instancji.
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { ok, fail, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import {
  CAREER_STAGES,
  CAREER_STAGE_STYLE,
  departmentLabel,
  seniorityLabel,
  stageLabel,
  startLabel,
} from "@/lib/careers/recruitmentLayer";
import { Route as CareersRoute } from "@/routes/admin.careers";

const PATH = "/admin/careers";
const ROUTE_FILE = "src/routes/admin.careers.tsx";
const ADMIN_LAYOUT = "src/routes/admin.tsx";
const AUTHORITY_GATE = "src/routes/__tests__/adminRouteAuthority.gate.test.ts";
/** Migracja z pipeline'em rekrutacyjnym, dziennikiem decyzji i kolejką usunięć CV. */
const PIPELINE_MIGRATION =
  "supabase/migrations/20260814110000_careers_pipeline_and_cv_retention.sql";
/** Migracja zawężająca bucket `career-cv` do najemcy (ścieżka niesie tenanta). */
const CV_SCOPE_MIGRATION = "supabase/migrations/20260814100000_careers_tenant_scope.sql";
const PGTAP_DIR = "supabase/tests";
const CAREER_SECTIONS_PGTAP = "career_sections_visibility_public_read_test.sql";

/** Najemca w fixtures - jawna fikcja, nigdy identyfikator z produkcji. */
const TENANT = "11111111-1111-4111-8111-111111111111";
/** Ścieżka CV w kształcie, który przechodzi bramkę `CV_PATH_RE`. */
const CV_PATH = `${TENANT}/uploads/2026-08-20/abcdef1234.pdf`;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Pliki pgTAP wspominające dany obiekt bazy - do dowodów o istnieniu dowodu. */
function pgtapMentioning(needle: string): string[] {
  return readdirSync(PGTAP_DIR).filter(
    (file) => file.endsWith(".sql") && read(`${PGTAP_DIR}/${file}`).includes(needle),
  );
}

/** Wiersz skrzynki w kształcie, w jakim oddaje go zapytanie panelu. */
interface ApplicationRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  lang: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  custom: Record<string, unknown>;
  career_applications: RecruitmentPipelineRow | RecruitmentPipelineRow[] | null;
}

function pipelineRow(over: Partial<RecruitmentPipelineRow> = {}): RecruitmentPipelineRow {
  return {
    id: "proces-1",
    stage: "new",
    stage_changed_at: "2026-08-20T08:00:00.000Z",
    stage_note: "",
    rating: null,
    rejection_reason: "",
    next_step_at: null,
    owner_id: null,
    ...over,
  } satisfies RecruitmentPipelineRow;
}

function application(over: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "zgloszenie-1",
    name: "Zofia Przykładowska",
    email: "zofia.przykladowska@example.com",
    phone: "+48 000 000 001",
    subject: "Analityk ds. polityki cyfrowej",
    message: "Zmyślone uzasadnienie kandydatury na zmyślone stanowisko.",
    lang: "pl",
    created_at: "2026-08-20T07:00:00.000Z",
    read_at: null,
    archived_at: null,
    custom: {
      role: "analysis-lead",
      role_label: "Analityk ds. polityki cyfrowej",
      department: "analysis",
      seniority: "mid",
      start: "month",
      linkedin: "https://linkedin.example.com/in/zmyslona-zofia",
    },
    career_applications: pipelineRow(),
    ...over,
  } satisfies ApplicationRow;
}

const chainStub = (): SupabaseFromStub => {
  const current = stub.current;
  // STRAŻNIK, nie rzutowanie: fabryka `vi.mock` jest hoistowana i biegnie przed
  // tym plikiem, więc brak atrapy to błąd sklejenia testu, nie „pusty stan".
  if (current === null || typeof current !== "object" || !("chainsFor" in current)) {
    throw new Error("test: atrapa klienta Supabase nie została zarejestrowana");
  }
  return current as SupabaseFromStub;
};

const listChains = (): RecordedChain[] =>
  chainStub()
    .chainsFor("contact_messages")
    .filter((chain) => chain.has("select"));

function lastList(): RecordedChain {
  const chain = listChains().at(-1);
  if (!chain) throw new Error("test: panel nie zapytał o zgłoszenia");
  return chain;
}

const messageUpdates = (): RecordedChain[] =>
  chainStub()
    .chainsFor("contact_messages")
    .filter((chain) => chain.has("update"));
const messageDeletes = (): RecordedChain[] =>
  chainStub()
    .chainsFor("contact_messages")
    .filter((chain) => chain.has("delete"));
const pipelineUpdates = (): RecordedChain[] => chainStub().chainsFor("career_applications");
const eventChains = (): RecordedChain[] => chainStub().chainsFor("career_application_events");
const leadChains = (): RecordedChain[] => chainStub().chainsFor("crm_leads");

/** Klient bez ponowień - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({
    route: CareersRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/** Otwiera zgłoszenie z listy i czeka, aż karta kandydata się pojawi. */
async function openApplication(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("heading", { level: 2, name });
}

/** Czeka, aż lista przestanie być w stanie ładowania. */
async function settled(): Promise<void> {
  await waitFor(() => expect(screen.queryByText("…")).toBeNull());
}

/**
 * Droplista filtra etapu (w kolumnie listy).
 *
 * STRAŻNIK, nie rzutowanie: na ekranie z otwartym zgłoszeniem są DWIE
 * kontrolki o nazwie „Etap procesu" (filtr listy i etap wiersza procesu), więc
 * namierzenie musi być zawężone do `<aside>` - a to wymaga sprawdzenia
 * w runtime, że kolumna listy w ogóle się wyrenderowała.
 */
function stageFilterSelect(): HTMLElement {
  const aside = document.querySelector("aside");
  if (!(aside instanceof HTMLElement)) {
    throw new Error("test: kolumna listy nie wyrenderowała elementu <aside>");
  }
  return within(aside).getByLabelText("Etap procesu");
}

/** STRAŻNIK, nie rzutowanie: `<select>` po identyfikatorze, sprawdzony w runtime. */
function selectById(id: string): HTMLSelectElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLSelectElement)) {
    throw new Error(`test: na ekranie nie ma <select id="${id}">`);
  }
  return node;
}

/**
 * Prawa kolumna (karta zgłoszenia).
 *
 * STRAŻNIK, nie rzutowanie: po angielsku filtr listy („Archive") i akcja karty
 * („Archive") mają IDENTYCZNĄ nazwę dostępną, więc namierzenie akcji musi być
 * zawężone do karty - a to wymaga sprawdzenia w runtime, że karta istnieje.
 */
function detailPane(): HTMLElement {
  const pane = document.querySelector("aside")?.nextElementSibling;
  if (!(pane instanceof HTMLElement)) {
    throw new Error("test: prawa kolumna panelu nie wyrenderowała się");
  }
  return pane;
}

/** STRAŻNIK, nie rzutowanie: wiersz listy po nazwisku kandydata. */
function listRow(name: string): HTMLElement {
  const opener = screen.getByRole("button", { name: new RegExp(name) });
  const row = opener.closest("li");
  if (!row) throw new Error(`test: wiersz „${name}" nie ma kontenera <li>`);
  return row;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.rows = [];
  h.rowsError = null;
  h.hang = new Set<string>();
  h.leads = [];
  h.leadsError = null;
  h.events = [];
  h.eventsError = null;
  h.updateError = null;
  h.deleteError = null;
  h.pipelineError = null;
  h.signed = null;
  h.signCalls = [];
  h.signHolds = false;
  h.releaseSign = null;
  h.confirmAnswer = true;
  h.confirmMessages = [];
  h.opened = [];
  h.toasts = [];

  const shared = chainStub();
  shared.reset();
  shared.setResponse("contact_messages", (chain) => {
    if (chain.has("delete")) return h.deleteError ? fail(h.deleteError) : ok(null);
    if (chain.has("update")) return h.updateError ? fail(h.updateError) : ok(null);
    return h.rowsError ? fail(h.rowsError) : ok(h.rows);
  });
  shared.setResponse("career_applications", () =>
    h.pipelineError ? fail(h.pipelineError) : ok(null),
  );
  shared.setResponse("career_application_events", () =>
    h.eventsError ? fail(h.eventsError) : ok(h.events),
  );
  shared.setResponse("crm_leads", () => (h.leadsError ? fail(h.leadsError) : ok(h.leads)));

  // Komponent woła `window.confirm` i `window.open` wprost; definiujemy na obu
  // obiektach, bo helpery testowe sięgają po `window`, a kod po globalny bind.
  const confirmStub = (message?: string) => {
    h.confirmMessages.push(message ?? "");
    return h.confirmAnswer;
  };
  const openStub = (...args: unknown[]) => {
    h.opened.push(args);
    return null;
  };
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "confirm", {
      configurable: true,
      writable: true,
      value: confirmStub,
    });
    Object.defineProperty(target, "open", {
      configurable: true,
      writable: true,
      value: openStub,
    });
  }
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

// ---------------------------------------------------------------------------
// SKLEJENIE TRASY I AUTORYTET DOSTĘPU
// ---------------------------------------------------------------------------

describe("/admin/careers - sklejenie trasy i gdzie stoi bramka uprawnień", () => {
  it("head() daje tytuł karty i trzyma skrzynkę z danymi osobowymi poza indeksem", async () => {
    // Czytamy `head()` DWIEMA drogami: wprost (kontrakt funkcji) i przez
    // zamontowany router (to, co faktycznie trafiłoby do `<HeadContent/>`).
    // `noindex` nie jest tu ozdobą: skrzynka niesie CV i kontakty kandydatów.
    expect(routeHead(CareersRoute).meta).toEqual([
      { title: "Rekrutacja | Admin" },
      { name: "robots", content: "noindex" },
    ]);

    const { meta } = await mount();
    expect(meta()).toContainEqual({ title: "Rekrutacja | Admin" });
    expect(meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("trasa wisi pod `/admin`, więc chroni ją bramka `isStaff` z układu nadrzędnego", () => {
    expect(read(ROUTE_FILE)).toMatch(/createFileRoute\("\/admin\/careers"\)/);
    expect(PATH.startsWith("/admin/")).toBe(true);
  });

  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent nie woła `useAuth` ani nie przekierowuje, więc
    // renderuje się w harnessie, w którym żadnej sesji nie ma. To podział
    // pracy, nie dziura - jedna bramka w layoucie zamiast kopii w stu trasach.
    // Gdyby ktoś dołożył warunek roli TUTAJ, ten test zapali się pierwszy.
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "Rekrutacja" })).toBeInTheDocument();
  });

  it("plik trasy nie zawiera warunku roli ani przekierowania", () => {
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(source).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem.
    const layout = read(ADMIN_LAYOUT);
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });

  it("dane panelu idą ZWYKŁYM klientem - autorytetem jest RLS, nie middleware", () => {
    // Świadome NEGATYWNE ustalenie: gdyby odczyt szedł funkcją serwerową,
    // dowód uprawnień robiłoby się przez `serverFnMiddlewareNames`. Nie idzie.
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/createServerFn/);
    expect(source).toContain('from("contact_messages")');
    expect(source).toContain('from("career_applications")');
  });

  it("polityki RLS pipeline'u wymagają personelu I zgodności najemcy", () => {
    // Tu naprawdę mieszka autoryzacja tego ekranu. Ten test nie sprawdza bazy
    // (do tego jest pgTAP, którego nie ma - ZNALEZISKO 3), tylko że polityka
    // nie zniknęła i nadal wymienia OBA warunki.
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(
      /CREATE POLICY career_applications_staff_read ON public\.career_applications/,
    );
    expect(sql).toMatch(
      /CREATE POLICY career_applications_staff_update ON public\.career_applications/,
    );
    expect(sql).toMatch(
      /CREATE POLICY career_application_events_staff_read ON public\.career_application_events/,
    );
    expect(sql).toMatch(/public\.is_staff\(\) AND tenant_id = public\.current_tenant_id\(\)/);
  });

  it("dziennik decyzji jest dla klienta TYLKO do czytania - historii nie da się poprawić", () => {
    // Gdyby panel mógł pisać do `career_application_events`, audyt „kogo
    // odrzuciliśmy i dlaczego" dałoby się przepisać po fakcie. Grant jest sam
    // `SELECT`, a wpisy robi trigger.
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(/GRANT SELECT ON public\.career_application_events TO authenticated;/);
    expect(sql).not.toMatch(/GRANT[^;]*INSERT[^;]*ON public\.career_application_events/);
    expect(sql).toMatch(/CREATE TRIGGER trg_career_applications_log_stage/);
    expect(read(ROUTE_FILE)).not.toMatch(/career_application_events"\)\s*\.\s*(insert|update)/);
  });

  it("odczyt bucketu `career-cv` jest zawężony do personelu TEGO najemcy", () => {
    // Panel podpisuje link bez pytania o tenanta, więc jedyną granicą jest
    // polityka magazynu - i ona bierze najemcę z PROFILU wołającego,
    // nie z nagłówka hosta (ten da się podmienić w żądaniu).
    const sql = read(CV_SCOPE_MIGRATION);
    expect(sql).toMatch(/CREATE POLICY "career_cv_staff_read"/);
    expect(sql).toMatch(/bucket_id = 'career-cv'\s*\n\s*AND public\.is_staff\(\)/);
    expect(sql).toMatch(
      /\(storage\.foldername\(name\)\)\[1\] = public\.current_tenant_id\(\)::text/,
    );
  });

  /**
   * ZŁAMANY KONTRAKT (DZIURA W DOWODZIE, NIE W KODZIE): pipeline rekrutacyjny
   * nie ma ANI JEDNEGO pliku pgTAP. Migracja zakłada polityki RLS, trigger
   * bootstrapu wiersza procesu, trigger dziennika decyzji i trigger kolejkujący
   * plik CV do usunięcia - a `supabase/tests/` nie wspomina o
   * `career_applications` ani razu. Ta trasa nie ma na kliencie żadnego
   * warunku najemcy, więc polityka bazy jest jedynym, co dzieli tenantów.
   *
   * OCZEKIWANY KONTRAKT: pgTAP modułu karier zakłada drugiego najemcę,
   * asertuje zerową widoczność jego zgłoszeń i sprawdza, że zmiana etapu
   * zostawia wpis w dzienniku.
   *
   * Zapisane jako `it.fails`, bo naprawa oznacza nowy dowód w SQL, a ten plik
   * niczego w produkcji nie zmienia. KONTROLA DODATNIA stoi w teście obok.
   */
  it.fails("pipeline rekrutacyjny ma dowód wykonawczy w pgTAP", () => {
    expect(pgtapMentioning("career_applications")).not.toEqual([]);
  });

  it("kontrola dodatnia: ta sama technika ZNAJDUJE dowód pgTAP dla sekcji karier", () => {
    // Bez tej kontroli `it.fails` wyżej mógłby przechodzić dlatego, że wzorzec
    // szukania jest zepsuty, a nie dlatego, że dowodu nie ma.
    expect(pgtapMentioning("career_sections")).toContain(CAREER_SECTIONS_PGTAP);
  });

  it("ZNALEZISKO 6 ZAMKNIĘTE: bramka rodzin tras panelu WIDZI rodzinę `admin.careers`", () => {
    // Stan wejściowy tej paczki: `adminRouteAuthority.gate.test.ts` miał jawne
    // listy rodzin (kluby, newsletter, moduł 19, SEO, społeczność) i ŻADNA nie
    // wymieniała tej trasy - więc dołożenie tu własnego, niezgodnego z bazą
    // warunku roli przechodziłoby po cichu. Znalezisko zostało zamknięte w tej
    // samej gałęzi: bramka ma sekcję „panel rekrutacji - autorytet dostępu".
    // Asercja jest teraz POZYTYWNA, bo dowód ma pilnować obecności rodziny,
    // a nie utrwalać jej brak.
    expect(read(AUTHORITY_GATE)).toContain("admin.careers");
    // Kontrola dodatnia dla samego odczytu - żeby zielone nie brało się
    // z pomylonej ścieżki pliku.
    expect(read(AUTHORITY_GATE)).toContain("admin.newsletter.tsx");
  });
});

// ---------------------------------------------------------------------------
// KSZTAŁT ZAPYTANIA LISTY - i minimalizacja danych
// ---------------------------------------------------------------------------

describe("/admin/careers - co panel pyta bazę o zgłoszenia", () => {
  it("pyta wyłącznie o formularz rekrutacyjny, najnowsze pierwsze, z limitem 500", async () => {
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    const chain = lastList();

    expect(chain.argsOf("eq")).toEqual(["form_id", "careers"]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([500]);
  });

  it('pobiera DOKŁADNIE renderowane kolumny plus embed procesu - żadnego `select("*")`', async () => {
    // MINIMALIZACJA DANYCH: `contact_messages` niesie też pola, których ten
    // ekran nie pokazuje (zgoda newsletterowa, adresat, źródło). Lista kolumn
    // jest jawna, więc panel nie ściąga do przeglądarki danych, których nie
    // potrzebuje - i nie da się tego rozszerzyć „przypadkiem".
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    const [selectArg] = lastList().argsOf("select") ?? [];
    if (typeof selectArg !== "string") throw new Error("test: `select()` nie dostał literału");

    expect(selectArg).not.toContain("*");
    const topLevel = selectArg.replace(/career_applications\([^)]*\)/, "").replace(/,$/, "");
    expect(topLevel.split(",")).toEqual([
      "id",
      "name",
      "email",
      "phone",
      "subject",
      "message",
      "lang",
      "created_at",
      "read_at",
      "archived_at",
      "custom",
    ]);
    expect(selectArg).not.toContain("newsletter_opt_in");
    expect(selectArg).not.toContain("recipient");
  });

  it("embed procesu jedzie JEDNYM literałem - konkatenacja cofnęłaby typowanie", async () => {
    // Uzasadnienie stoi w komentarzu produkcyjnym: supabase-js parsuje listę
    // kolumn NA POZIOMIE TYPÓW, a sklejony `string` degraduje wynik do
    // `GenericStringError` i embed przestaje się typować. Dowód jest dwustronny:
    // literał w źródle i jeden ciągły argument w wywołaniu.
    expect(read(ROUTE_FILE)).toContain(
      "career_applications(id,stage,stage_changed_at,stage_note,rating,rejection_reason,next_step_at,owner_id)",
    );
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    const args = lastList().argsOf("select") ?? [];
    expect(args).toHaveLength(1);
  });

  it("domyślny filtr „Nowe” pyta o zgłoszenia bez archiwizacji", async () => {
    await mount();
    await waitFor(() => expect(listChains().length).toBeGreaterThan(0));
    expect(lastList().argsOf("is")).toEqual(["archived_at", null]);
    expect(lastList().has("not")).toBe(false);
  });

  it("filtr „Archiwum” pyta o zgłoszenia Z datą archiwizacji - filtr jest SERWEROWY", async () => {
    // Zapytanie jest ucięte na 500 wierszach, więc archiwum policzone na
    // kliencie znikałoby po pierwszych 500 zgłoszeniach.
    await mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Archiwum" }));

    await waitFor(() => expect(lastList().has("not")).toBe(true));
    expect(lastList().argsOf("not")).toEqual(["archived_at", "is", null]);
    expect(lastList().has("is")).toBe(false);
  });

  it("filtr „Wszystkie” nie zawęża zapytania ani w jedną, ani w drugą stronę", async () => {
    await mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Wszystkie" }));

    await waitFor(() => expect(lastList().has("is")).toBe(false));
    expect(lastList().has("not")).toBe(false);
  });

  it("aktywny filtr jest widoczny - operator wie, czego NIE widzi", async () => {
    // Bez wyróżnienia aktywnej zakładki „brak zgłoszeń" w archiwum czyta się
    // jak „brak zgłoszeń w ogóle".
    const { container } = await mount();
    await settled();
    const active = container.querySelectorAll("button.bg-brand");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("Nowe");

    fireEvent.click(screen.getByRole("button", { name: "Archiwum" }));
    await waitFor(() =>
      expect(container.querySelector("button.bg-brand")).toHaveTextContent("Archiwum"),
    );
  });

  it("przycisk odświeżania wywołuje ponowne zapytanie", async () => {
    await mount();
    await settled();
    const before = listChains().length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(listChains().length).toBeGreaterThan(before));
  });

  it("ZNALEZISKO 4: nazwa przycisku odświeżania jest angielskim literałem bez klucza i18n", () => {
    // `realT` mierzy słownik: brakujący klucz i18next zwraca sam klucz, więc
    // równość dowodzi, że „Refresh" NIE JEST tłumaczone ani przez i18n, ani
    // przez wbudowane `PL`/`EN` (te są w module trasy).
    expect(read(ROUTE_FILE)).toContain('aria-label="Refresh"');
    expect(realT("pl")("Refresh")).toBe("Refresh");
    expect(realT("en")("Refresh")).toBe("Refresh");
  });
});

// ---------------------------------------------------------------------------
// STANY LISTY
// ---------------------------------------------------------------------------

describe("/admin/careers - trzy stany odczytu skrzynki", () => {
  it("w trakcie pobierania mówi, że pracuje - nie udaje pustej skrzynki", async () => {
    h.hang.add("contact_messages");
    await mount();

    expect(await screen.findByText("…")).toBeInTheDocument();
    // Ładowanie i pustka są WZAJEMNIE WYKLUCZAJĄCE - inaczej operator widzi
    // „Brak zgłoszeń." na skrzynce pełnej zgłoszeń.
    expect(screen.queryByText("Brak zgłoszeń.")).toBeNull();
  });

  it("pusta skrzynka mówi to wprost", async () => {
    await mount();
    await settled();
    expect(screen.getByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  it("odpowiedź bez ciała (`data: null`) nie wywraca panelu", async () => {
    // PostgREST potrafi oddać `null` zamiast pustej tablicy. Bez `data ?? []`
    // panel padałby na `.map` i operator dostawał biały ekran.
    h.rows = null;
    await mount();
    await settled();
    expect(screen.getByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  it("odmowa odczytu nie renderuje wierszy widmo", async () => {
    // Połowa kontraktu, która DZIAŁA i której nie wolno stracić przy naprawie
    // ZNALEZISKA 1: po odmowie lista jest pusta, a nie wypełniona resztkami.
    h.rowsError = "odmowa RLS";
    const { container } = await mount();
    await settled();
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  /**
   * ZŁAMANY KONTRAKT (ZNALEZISKO 1): odmowa odczytu wygląda jak pusta
   * skrzynka. `data: rows = []` sprowadza błąd zapytania do gałęzi pustki, więc
   * gdy RLS odmówi albo sieć padnie, operator czyta zdanie o STANIE BAZY.
   * Skutek: zgłoszenie kandydata wygląda na nieistniejące, a termin
   * odpowiedzi biegnie dalej.
   *
   * OCZEKIWANY KONTRAKT: `isError` daje własny komunikat, różny od „Brak
   * zgłoszeń.".
   *
   * `it.fails`, bo naprawa wymaga zmiany pliku trasy. KONTROLA DODATNIA: test
   * „pusta skrzynka mówi to wprost" dowodzi, że ta sama technika oczekiwania
   * wykrywa poprawny przypadek pustki.
   */
  it.fails("odmowa odczytu NIE wygląda jak pusta skrzynka", async () => {
    h.rowsError = "odmowa RLS";
    await mount();
    await settled();
    expect(screen.queryByText("Brak zgłoszeń.")).toBeNull();
  });

  it("wiersz listy niesie nazwisko, datę, rolę, kropkę nieprzeczytanego i etap", async () => {
    h.rows = [application()];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    const row = within(listRow("Zofia Przykładowska"));

    expect(row.getByText("Zofia Przykładowska")).toBeInTheDocument();
    expect(row.getByText("Analityk ds. polityki cyfrowej")).toBeInTheDocument();
    expect(row.getByText(new Date("2026-08-20T07:00:00.000Z").toLocaleDateString()));
    // Etap pokazujemy TEKSTEM ze wspólnej warstwy, nie kodem enuma - i z
    // kolorem, który jest jedyną szybką różnicą między „Nowe" i „Odrzucony".
    const badge = row.getByText(stageLabel("new", "pl"));
    expect(badge.className).toContain(CAREER_STAGE_STYLE.new);
    expect(listRow("Zofia Przykładowska").querySelector("span.bg-brand")).not.toBeNull();
  });

  it("zgłoszenie przeczytane nie ma kropki nieprzeczytanego", async () => {
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    expect(listRow("Zofia Przykładowska").querySelector("span.bg-brand")).toBeNull();
  });

  it("podpis wiersza spada z roli na temat, a z tematu na adres kandydata", async () => {
    // Zgłoszenie spontaniczne nie ma etykiety roli, a zgłoszenie z formularza
    // sprzed zmiany nie ma tematu. Wiersz bez podpisu byłby nie do odróżnienia
    // od sąsiedniego.
    h.rows = [
      application({
        id: "bez-roli",
        name: "Bartosz Zmyślony",
        custom: {},
        subject: "Zgłoszenie spontaniczne",
      }),
      application({
        id: "bez-tematu",
        name: "Cecylia Nieistniejąca",
        email: "cecylia.nieistniejaca@example.com",
        custom: {},
        subject: null,
      }),
    ];
    await mount();
    await screen.findByText("Bartosz Zmyślony");

    expect(within(listRow("Bartosz Zmyślony")).getByText("Zgłoszenie spontaniczne"));
    expect(
      within(listRow("Cecylia Nieistniejąca")).getByText("cecylia.nieistniejaca@example.com"),
    ).toBeInTheDocument();
  });

  it("zgłoszenie bez wiersza procesu nie dostaje plakietki etapu", async () => {
    h.rows = [application({ career_applications: null })];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    expect(within(listRow("Zofia Przykładowska")).queryByText(stageLabel("new", "pl"))).toBeNull();
  });

  it("panel znosi OBA kształty embedu PostgREST - obiekt i jednoelementową tablicę", async () => {
    // PostgREST zwraca zagnieżdżenie raz jako obiekt, raz jako tablicę
    // (zależnie od wykrytej kardynalności). Panel oddaje to parsowanie
    // PRAWDZIWEJ warstwie `parseRecruitmentPipeline`, więc oba kształty
    // muszą dać ten sam wiersz - inaczej etap gubi się przy zmianie planu
    // zapytania, a nie przy zmianie kodu.
    h.rows = [
      application({ id: "obiekt", name: "Dorota Obiektowa", career_applications: pipelineRow() }),
      application({
        id: "tablica",
        name: "Edward Tablicowy",
        career_applications: [pipelineRow({ id: "proces-2", stage: "interview" })],
      }),
    ];
    await mount();
    await screen.findByText("Dorota Obiektowa");

    expect(within(listRow("Dorota Obiektowa")).getByText(stageLabel("new", "pl")));
    expect(
      within(listRow("Edward Tablicowy")).getByText(stageLabel("interview", "pl")),
    ).toBeInTheDocument();
  });

  it("nieznany etap z bazy nie wywraca listy - warstwa spada na „Nowe”", async () => {
    // Enum `career_stage` może dorosnąć w migracji szybciej niż front. Wtedy
    // panel ma pokazać coś sensownego, a nie puste miejsce bez klasy koloru.
    h.rows = [application({ career_applications: pipelineRow({ stage: "zmyslony_etap" }) })];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    expect(within(listRow("Zofia Przykładowska")).getByText(stageLabel("new", "pl")));
  });
});

// ---------------------------------------------------------------------------
// FILTRY LICZONE NA KLIENCIE (ZNALEZISKO 2)
// ---------------------------------------------------------------------------

describe("/admin/careers - filtr etapu i szukajka liczą się na KLIENCIE", () => {
  const trzy = () => [
    application({
      id: "w-toku",
      name: "Filip Wtoku",
      email: "filip.wtoku@example.com",
      career_applications: pipelineRow({ stage: "interview" }),
    }),
    application({
      id: "domkniete",
      name: "Grażyna Domknięta",
      email: "grazyna.domknieta@example.com",
      career_applications: pipelineRow({ id: "proces-3", stage: "rejected" }),
    }),
    application({
      id: "bez-procesu",
      name: "Henryk Bezprocesu",
      email: "henryk.bezprocesu@example.com",
      career_applications: null,
    }),
  ];

  it("ZNALEZISKO 2: zmiana filtra etapu NIE wywołuje nowego zapytania", async () => {
    // To jest sedno znaleziska: lista jest ucięta na 500 wierszach, a etap
    // przesiewa się w `useMemo`. Dla najemcy z dłuższą historią „Domknięte"
    // pokazuje wynik z PIERWSZYCH 500 zgłoszeń i milczy o resztzie. Ten test
    // przybija zachowanie ISTNIEJĄCE, żeby nikt nie pomylił go z filtrem
    // serwerowym - i zapali się, gdy filtr do bazy w końcu pojedzie.
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");
    const before = listChains().length;

    fireEvent.change(stageFilterSelect(), { target: { value: "closed" } });

    await waitFor(() => expect(screen.queryByText("Filip Wtoku")).toBeNull());
    expect(listChains()).toHaveLength(before);
    expect(lastList().calls.map((call) => call.method)).not.toContain("filter");
  });

  it("„W toku” obejmuje etapy otwarte ORAZ zgłoszenia bez wiersza procesu", async () => {
    // Brak wiersza procesu to sygnał awarii triggera bootstrapu, a nie
    // „sprawa zamknięta" - takie zgłoszenie MUSI zostać w kolejce do obróbki.
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(stageFilterSelect(), { target: { value: "open" } });

    await waitFor(() => expect(screen.queryByText("Grażyna Domknięta")).toBeNull());
    expect(screen.getByText("Filip Wtoku")).toBeInTheDocument();
    expect(screen.getByText("Henryk Bezprocesu")).toBeInTheDocument();
  });

  it("„Domknięte” pokazuje tylko etapy, po których biegnie retencja CV", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(stageFilterSelect(), { target: { value: "closed" } });

    await waitFor(() => expect(screen.getByText("Grażyna Domknięta")).toBeInTheDocument());
    expect(screen.queryByText("Filip Wtoku")).toBeNull();
    expect(screen.queryByText("Henryk Bezprocesu")).toBeNull();
  });

  it("wybór konkretnego etapu zawęża listę do tego jednego etapu", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(stageFilterSelect(), { target: { value: "interview" } });

    await waitFor(() => expect(screen.queryByText("Grażyna Domknięta")).toBeNull());
    expect(screen.getByText("Filip Wtoku")).toBeInTheDocument();
    expect(screen.queryByText("Henryk Bezprocesu")).toBeNull();
  });

  it("droplista filtra oferuje trzy zbiorcze pozycje i KAŻDY etap ze wspólnej warstwy", async () => {
    // Lista etapów jest jednym źródłem prawdy z enumem bazy (`CAREER_STAGES`).
    // Gdyby panel miał własną kopię, nowy etap w migracji nie dałby się
    // odfiltrować, a operator nie miałby o tym skąd wiedzieć.
    await mount();
    await settled();
    const options = within(stageFilterSelect()).getAllByRole("option");

    expect(options.map((option) => option.textContent)).toEqual([
      "Wszystkie etapy",
      "W toku",
      "Domknięte",
      ...CAREER_STAGES.map((stage) => stageLabel(stage, "pl")),
    ]);
  });

  it("szukajka przesiewa po nazwisku, adresie, temacie i treści - bez wielkości liter", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");
    const box = screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…");

    fireEvent.change(box, { target: { value: "GRAŻYNA" } });
    await waitFor(() => expect(screen.queryByText("Filip Wtoku")).toBeNull());
    expect(screen.getByText("Grażyna Domknięta")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "filip.wtoku@EXAMPLE.com" } });
    await waitFor(() => expect(screen.getByText("Filip Wtoku")).toBeInTheDocument());
    expect(screen.queryByText("Grażyna Domknięta")).toBeNull();
  });

  it("szukajka sięga też do pól rekrutacyjnych z kolumny `custom`", async () => {
    // Operator szuka „kto aplikował na analizy" albo „kto podał LinkedIn",
    // a nie tylko po nazwisku. Te pola żyją w jsonb, więc muszą być jawnie
    // wymienione w przesiewie.
    h.rows = [
      application({
        custom: {
          role_label: "Analityk ds. polityki cyfrowej",
          department: "analysis",
          seniority: "senior",
          linkedin: "https://linkedin.example.com/in/zmyslona-zofia",
          cv_file_name: "zyciorys-zmyslony.pdf",
        },
      }),
      application({ id: "inny", name: "Ignacy Inny", custom: {}, subject: null }),
    ];
    await mount();
    await screen.findByText("Zofia Przykładowska");
    const box = screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…");

    for (const needle of ["analysis", "senior", "linkedin.example.com", "zyciorys-zmyslony"]) {
      fireEvent.change(box, { target: { value: needle } });
      await waitFor(() => expect(screen.queryByText("Ignacy Inny")).toBeNull());
      expect(screen.getByText("Zofia Przykładowska"), `szukajka nie widzi „${needle}"`);
    }
  });

  it("brak trafień mówi „Brak zgłoszeń.”, a nie pokazuje pustej listy bez słowa", async () => {
    h.rows = trzy();
    await mount();
    await screen.findByText("Filip Wtoku");

    fireEvent.change(screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…"), {
      target: { value: "nikt-taki-nie-aplikował" },
    });

    expect(await screen.findByText("Brak zgłoszeń.")).toBeInTheDocument();
  });

  it("puste zapytanie nie przesiewa niczego - wraca cała strona wyników", async () => {
    h.rows = trzy();
    await mount();
    const box = await screen.findByPlaceholderText("Szukaj: imię, e-mail, rola…");
    fireEvent.change(box, { target: { value: "Filip" } });
    await waitFor(() => expect(screen.queryByText("Grażyna Domknięta")).toBeNull());

    fireEvent.change(box, { target: { value: "   " } });

    await waitFor(() => expect(screen.getByText("Grażyna Domknięta")).toBeInTheDocument());
    expect(screen.getByText("Henryk Bezprocesu")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WYBÓR ZGŁOSZENIA I OZNACZANIE PRZECZYTANE
// ---------------------------------------------------------------------------

describe("/admin/careers - otwarcie zgłoszenia", () => {
  it("bez wyboru prawa kolumna prosi o wybór, a nie pokazuje pustego formularza", async () => {
    h.rows = [application()];
    await mount();
    expect(await screen.findByText("Wybierz zgłoszenie z listy.")).toBeInTheDocument();
    // Zapytanie o lead NIE leci, dopóki nie ma adresu kandydata.
    expect(leadChains()).toHaveLength(0);
    expect(eventChains()).toHaveLength(0);
  });

  it("karta kandydata niesie kontakt, datę i język zgłoszenia", async () => {
    h.rows = [application()];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText(/zofia\.przykladowska@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/\+48 000 000 001/)).toBeInTheDocument();
    // Język zgłoszenia decyduje, w którym języku pisze się odpowiedź.
    expect(screen.getByText("PL")).toBeInTheDocument();
    expect(
      screen.getByText("Zmyślone uzasadnienie kandydatury na zmyślone stanowisko."),
    ).toBeInTheDocument();
  });

  it("brak telefonu nie zostawia wiszącego separatora w linii kontaktu", async () => {
    h.rows = [application({ phone: null })];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const contact = container.querySelector("section p.text-xs");
    expect(contact?.textContent ?? "").toContain("zofia.przykladowska@example.com");
    expect(contact?.textContent ?? "").not.toMatch(/@example\.com\s+·\s+·/);
  });

  it("samo OTWARCIE nieprzeczytanego zgłoszenia zapisuje `read_at` i status", async () => {
    // To jedyny zapis, którego operator nie inicjuje świadomie - a widzi go
    // też Contact Center. Bez niego licznik nieprzeczytanych kłamie.
    h.rows = [application()];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    const [values] = messageUpdates()[0].argsOf("update") ?? [];
    if (typeof values !== "object" || values === null) {
      throw new Error("test: UPDATE nie dostał obiektu wartości");
    }
    expect(Object.keys(values).sort()).toEqual(["read_at", "status"]);
    expect(Reflect.get(values, "status")).toBe("read");
    expect(typeof Reflect.get(values, "read_at")).toBe("string");
    expect(messageUpdates()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);

    // Zgłoszenia rekrutacyjne widać także w Contact Center (ta sama tabela),
    // więc bez DRUGIEJ inwalidacji „przeczytane" rozjeżdża się między
    // skrzynkami do końca sesji.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contact-messages"] });
  });

  it("otwarcie zgłoszenia JUŻ przeczytanego nie pisze do bazy drugi raz", async () => {
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    await mount();
    await openApplication("Zofia Przykładowska");
    await waitFor(() => expect(eventChains().length).toBeGreaterThan(0));
    expect(messageUpdates()).toHaveLength(0);
  });

  it("zgłoszenie wypchnięte przez szukajkę zamyka kartę, a nie pokazuje resztek", async () => {
    // `filtered.find(...) ?? null` - bez tego panel trzymałby na ekranie dane
    // kandydata, którego nie ma już na liście, i operator dopisywałby notatkę
    // „do niewidocznego" zgłoszenia.
    h.rows = [application(), application({ id: "drugi", name: "Jan Zmyślony", custom: {} })];
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(screen.getByPlaceholderText("Szukaj: imię, e-mail, rola…"), {
      target: { value: "Jan Zmyślony" },
    });

    expect(await screen.findByText("Wybierz zgłoszenie z listy.")).toBeInTheDocument();
  });

  it("wybrany wiersz jest wyróżniony na liście", async () => {
    h.rows = [application(), application({ id: "drugi", name: "Jan Zmyślony", custom: {} })];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(listRow("Zofia Przykładowska").querySelector("button.bg-muted")).not.toBeNull();
    expect(listRow("Jan Zmyślony").querySelector("button.bg-muted")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CV KANDYDATA - najdrażliwszy fragment tego ekranu
// ---------------------------------------------------------------------------

describe("/admin/careers - dostęp do CV kandydata", () => {
  const withCustom = (custom: Record<string, unknown>) => [application({ custom })];

  it("brak CV mówi „Brak CV”, a nie zostawia operatora bez informacji", async () => {
    h.rows = withCustom({ role_label: "Analityk ds. polityki cyfrowej" });
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
    expect(h.signCalls).toEqual([]);
  });

  it("CV usunięte przez retencję jest odróżnione od CV, którego nigdy nie było", async () => {
    // Bez tego rozróżnienia operator widzi „Brak CV" i szuka błędu
    // w formularzu, a plik został skasowany zgodnie z polityką RODO - data
    // usunięcia jest tu odpowiedzią na pytanie „gdzie ono jest".
    h.rows = withCustom({ cv_purged_at: "2026-08-30" });
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText("CV: CV usunięte (retencja) · 2026-08-30")).toBeInTheDocument();
    expect(screen.queryByText(/Brak CV/)).toBeNull();
  });

  it("pusta data usunięcia (same odstępy) wraca do „Brak CV”", async () => {
    h.rows = withCustom({ cv_purged_at: "   " });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
  });

  it("plik w buckecie daje PRZYCISK z nazwą pliku - a nie gotowy link", async () => {
    // Kluczowa własność prywatności: dopóki operator nie kliknie, podpisanego
    // adresu NIE MA - ani w drzewie DOM, ani w pamięci przeglądarki. Panel
    // pokazuje tylko nazwę pliku, którą kandydat sam nadał.
    h.rows = withCustom({ cv_path: CV_PATH, cv_file_name: "zyciorys-zmyslony.pdf" });
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const button = screen.getByRole("button", { name: "zyciorys-zmyslony.pdf" });
    expect(button.tagName).toBe("BUTTON");
    expect(h.signCalls).toEqual([]);
    expect(container.querySelector(`a[href*="${CV_PATH}"]`)).toBeNull();
    expect(container.innerHTML).not.toContain("token=");
  });

  it("plik bez nazwy własnej dostaje etykietę „Otwórz CV”", async () => {
    h.rows = withCustom({ cv_path: CV_PATH });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByRole("button", { name: "Otwórz CV" })).toBeInTheDocument();
  });

  it("klik podpisuje DOKŁADNIE ścieżkę ze zgłoszenia i otwiera plik w nowej karcie", async () => {
    h.rows = withCustom({ cv_path: CV_PATH, cv_file_name: "zyciorys-zmyslony.pdf" });
    h.signed = "https://storage.example.com/career-cv/podpisany?token=zmyslony";
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "zyciorys-zmyslony.pdf" }));

    await waitFor(() => expect(h.signCalls).toEqual([CV_PATH]));
    // `noopener,noreferrer` nie jest ozdobą: bez nich otwarty dokument dostaje
    // `window.opener` do panelu admina i referrer z adresem skrzynki.
    await waitFor(() =>
      expect(h.opened).toEqual([
        [
          "https://storage.example.com/career-cv/podpisany?token=zmyslony",
          "_blank",
          "noopener,noreferrer",
        ],
      ]),
    );
    // I najważniejsze: podpisany adres NIE trafia do drzewa DOM, więc nie
    // wycieka ani do zrzutu ekranu, ani do rozszerzenia przeglądarki.
    expect(container.innerHTML).not.toContain("token=zmyslony");
    expect(h.toasts).toEqual([]);
  });

  it("odmowa podpisu kończy się komunikatem, a nie pustym oknem", async () => {
    h.rows = withCustom({ cv_path: CV_PATH });
    h.signed = null;
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Otwórz CV" }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: "Nie udało się wygenerować linku do CV.",
      }),
    );
    expect(h.opened).toEqual([]);
  });

  it("w trakcie podpisywania przycisk jest zablokowany - jedno CV, jedno żądanie", async () => {
    h.rows = withCustom({ cv_path: CV_PATH });
    h.signHolds = true;
    h.signed = "https://storage.example.com/career-cv/podpisany?token=zmyslony";
    await mount();
    await openApplication("Zofia Przykładowska");

    const button = screen.getByRole("button", { name: "Otwórz CV" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(h.signCalls).toHaveLength(1);

    const release = h.releaseSign;
    if (!release) throw new Error("test: podpisywanie nie wystartowało, nie ma czego zwolnić");
    release();
    await waitFor(() => expect(button).toBeEnabled());
    expect(h.opened).toHaveLength(1);
  });

  it("ścieżka o NIEZNANYM kształcie nie jest podpisywana - to bramka przed cudzym CV", async () => {
    // `custom.cv_path` przychodzi z PUBLICZNEGO formularza, a panel podpisuje
    // ją bez pytania. Bez tej bramki wystarczyłoby podmienić pole w żądaniu,
    // żeby wymusić podpisany link do dowolnego obiektu w buckecie - czyli do
    // CV innego kandydata. Panel nie oferuje wtedy ŻADNEGO przycisku.
    for (const zla of [
      "../../innym-tenancie/uploads/2026-08-20/abcdef1234.pdf",
      "uploads/2026-08-20/skrypt.exe",
      "cv.pdf",
      "https://złośliwy.example.com/cv.pdf",
    ]) {
      cleanup();
      h.rows = withCustom({ cv_path: zla });
      await mount();
      await openApplication("Zofia Przykładowska");

      expect(screen.getByText(/^CV:\s*Brak CV$/), `ścieżka „${zla}" nie została odrzucona`);
      expect(screen.queryByRole("button", { name: "Otwórz CV" })).toBeNull();
      expect(h.signCalls).toEqual([]);
    }
  });

  it("ścieżka sprzed zmiany konwencji (bez tenanta) nadal działa", async () => {
    // Plików sprzed konwencji nie przenosimy (UPDATE `storage.objects.name`
    // rozjechałby wiersz z plikiem), więc muszą dalej przechodzić walidację -
    // prawa do nich pilnuje polityka bucketu przez referencję ze zgłoszenia.
    h.rows = withCustom({ cv_path: "uploads/2026-08-20/abcdef1234.pdf" });
    h.signed = "https://storage.example.com/career-cv/legacy?token=zmyslony";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Otwórz CV" }));

    await waitFor(() => expect(h.signCalls).toEqual(["uploads/2026-08-20/abcdef1234.pdf"]));
    expect(read(CV_SCOPE_MIGRATION)).toContain("m.custom ->> 'cv_path' = storage.objects.name");
  });

  it("link zewnętrzny BEZ schematu dostaje absolutny adres, nie ścieżkę w panelu", async () => {
    // „linkedin.example.com/in/x" w `<a href>` jest URL-em RELATYWNYM
    // i prowadziłby do /admin/linkedin.example.com/... - operator klikałby
    // w martwy link zamiast otworzyć profil kandydata.
    h.rows = withCustom({ cv_url: "linkedin.example.com/in/zmyslona-zofia" });
    await mount();
    await openApplication("Zofia Przykładowska");

    const link = screen.getByRole("link", { name: "Otwórz CV" });
    expect(link).toHaveAttribute("href", "https://linkedin.example.com/in/zmyslona-zofia");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(h.signCalls).toEqual([]);
  });

  it("wartość, która nie jest adresem, jest traktowana jak brak CV", async () => {
    h.rows = withCustom({ cv_url: "prześlę mailem" });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz CV" })).toBeNull();
  });

  it("gdy są OBA - plik z bucketu wygrywa nad linkiem zewnętrznym", async () => {
    // Plik w naszym magazynie jest dowodem, który mamy pod kontrolą (i który
    // podlega retencji). Link zewnętrzny może zniknąć bez naszej wiedzy.
    h.rows = withCustom({ cv_path: CV_PATH, cv_url: "https://linkedin.example.com/in/zofia" });
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByRole("button", { name: "Otwórz CV" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz CV" })).toBeNull();
  });

  it("wartości nietekstowe w `custom` nie docierają do CV - jsonb bywa czymkolwiek", async () => {
    // `custom` jest kolumną jsonb, więc może przyjść liczba, tablica albo
    // obiekt. PRAWDZIWA warstwa (`asCustomRecord`) wpuszcza wyłącznie napisy,
    // dzięki czemu `isCareerCvPath` nie dostaje nigdy nie-stringa.
    h.rows = withCustom({ cv_path: 42, cv_url: ["https://example.com/cv.pdf"], cv_purged_at: 7 });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(screen.getByText(/^CV:\s*Brak CV$/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DANE ZGŁOSZENIA I SYNCHRONIZACJA Z CRM
// ---------------------------------------------------------------------------

describe("/admin/careers - dane zgłoszenia i karta leada", () => {
  it("pola rekrutacyjne pokazują TEKST ze wspólnej warstwy, a nie slug z formularza", async () => {
    // Kandydat wybiera slug („analysis", „mid", „month"), a operator musi
    // czytać zdanie. Słowniki żyją w `recruitmentShared` (wspólne z panelem
    // „Rekrutacja" na karcie CRM), więc asercja idzie PRZEZ te funkcje.
    h.rows = [application()];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const list = container.querySelector("dl");
    if (!(list instanceof HTMLElement)) throw new Error("test: brak listy pól zgłoszenia");
    const pairs = [...list.querySelectorAll("div")].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(pairs).toEqual([
      ["Rola", "Analityk ds. polityki cyfrowej"],
      ["Dział", departmentLabel("analysis", "pl")],
      ["Poziom", seniorityLabel("mid", "pl")],
      ["Dostępność", startLabel("month", "pl")],
      ["LinkedIn", "https://linkedin.example.com/in/zmyslona-zofia"],
    ]);
  });

  it("brak etykiety roli spada na slug, a brak jednego i drugiego na „-”", async () => {
    h.rows = [
      application({ id: "slug", name: "Klara Slugowa", custom: { role: "analysis-lead" } }),
      application({ id: "puste", name: "Leon Pustawy", custom: {} }),
    ];
    const { container } = await mount();

    await openApplication("Klara Slugowa");
    expect(container.querySelector("dl")?.textContent ?? "").toContain("analysis-lead");

    await openApplication("Leon Pustawy");
    const pairs = [...(container.querySelectorAll("dl dd") ?? [])].map((dd) => dd.textContent);
    // Pięć razy „-", nie pięć pustych prostokątów: puste pole czyta się jak
    // błąd renderu, a myślnik jak „kandydat tego nie podał".
    expect(pairs).toEqual(["-", "-", "-", "-", "-"]);
  });

  it("nieznany slug pokazujemy SUROWO - lepiej dziwny napis niż puste pole", async () => {
    // Wartość może wjechać do bazy migracją szybciej niż do słownika.
    h.rows = [application({ custom: { department: "zmyslony_dzial", seniority: "principal" } })];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const text = container.querySelector("dl")?.textContent ?? "";
    expect(text).toContain("zmyslony_dzial");
    expect(text).toContain("principal");
  });

  it("lead w CRM szukany jest po `email_norm`, najnowszy pierwszy, jeden wiersz", async () => {
    // Dopasowanie MUSI iść po `email_norm`: `crm_leads.email` trzyma adres tak,
    // jak go wpisał kandydat, więc porównanie z zlowercase'owanym wejściem
    // gubiło każdego, kto użył wielkiej litery - panel pokazywał „Brak leada
    // w CRM" mimo poprawnej synchronizacji. `limit(1)` zamiast `maybeSingle`,
    // bo super admin widzi ten sam adres u wielu najemców.
    h.rows = [application({ email: "  ZOFIA.Przykladowska@Example.COM  " })];
    h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
    await mount();
    await openApplication("Zofia Przykładowska");

    await waitFor(() => expect(leadChains().length).toBeGreaterThan(0));
    const chain = leadChains()[0];
    expect(chain.argsOf("select")).toEqual(["id,stage,updated_at"]);
    expect(chain.argsOf("eq")).toEqual(["email_norm", "zofia.przykladowska@example.com"]);
    expect(chain.argsOf("order")).toEqual(["updated_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([1]);
  });

  it("lead znaleziony daje plakietkę „Zsynchronizowano” i link do jego karty", async () => {
    h.rows = [application()];
    h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Zsynchronizowano z CRM")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Otwórz w CRM" })).toHaveAttribute(
      "href",
      "/admin/crm/lead-1",
    );
    expect(screen.queryByText("Brak leada w CRM")).toBeNull();
  });

  it("brak leada mówi o tym wprost i NIE oferuje martwego przycisku", async () => {
    h.rows = [application()];
    h.leads = [];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak leada w CRM")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz w CRM" })).toBeNull();
  });

  it("odpowiedź CRM bez ciała jest czytana jak brak leada, a nie jak awaria", async () => {
    h.rows = [application()];
    h.leads = null;
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(await screen.findByText("Brak leada w CRM")).toBeInTheDocument();
  });

  it("ZNALEZISKO 8a: ODMOWA odczytu CRM jest nierozróżnialna od braku leada", async () => {
    // Zachowanie ISTNIEJĄCE. `error` leci wyjątkiem z `queryFn`, ale panel
    // czyta wyłącznie `data`, więc odmowa polityki `crm_leads` (albo padnięta
    // sieć) daje ten sam widok, co kontakt bez leada: „Brak leada w CRM"
    // i schowany przycisk „Otwórz w CRM". Operator wyciąga wniosek o STANIE
    // CRM z komunikatu o STANIE ODCZYTU - i zakłada nowego, zdublowanego leada.
    h.rows = [application()];
    h.leadsError = "odmowa RLS na crm_leads";
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak leada w CRM")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Otwórz w CRM" })).toBeNull();
    // Cisza jest tu kompletna: nie ma nawet toastu.
    expect(h.toasts).toEqual([]);
  });

  it("odpowiedź „Odpowiedz” prowadzi na adres kandydata z tematem zgłoszenia", async () => {
    h.rows = [application()];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByRole("link", { name: "Odpowiedz" })).toHaveAttribute(
      "href",
      `mailto:zofia.przykladowska@example.com?subject=${encodeURIComponent("Analityk ds. polityki cyfrowej")}`,
    );
  });

  it("zgłoszenie bez tematu dostaje w mailu tytuł panelu, nie puste pole", async () => {
    h.rows = [application({ subject: null })];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByRole("link", { name: "Odpowiedz" })).toHaveAttribute(
      "href",
      "mailto:zofia.przykladowska@example.com?subject=Rekrutacja",
    );
  });
});

// ---------------------------------------------------------------------------
// ARCHIWIZACJA I USUNIĘCIE
// ---------------------------------------------------------------------------

describe("/admin/careers - archiwizacja zgłoszenia", () => {
  it("archiwizacja zapisuje datę, melduje się i unieważnia OBIE skrzynki", async () => {
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Archiwizuj" }));

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    const [values] = messageUpdates()[0].argsOf("update") ?? [];
    if (typeof values !== "object" || values === null) {
      throw new Error("test: UPDATE nie dostał obiektu wartości");
    }
    expect(Object.keys(values)).toEqual(["archived_at"]);
    expect(typeof Reflect.get(values, "archived_at")).toBe("string");
    expect(messageUpdates()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "success", text: "Zarchiwizowano" }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contact-messages"] });
  });

  it("zgłoszenie zarchiwizowane ma plakietkę i przycisk PRZYWRACAJĄCY, który czyści datę", async () => {
    // Akcja odwrotna stoi w tym samym miejscu - to ona czyni archiwizację
    // jednoklikową bez ryzyka.
    h.rows = [
      application({ read_at: "2026-08-21T09:00:00.000Z", archived_at: "2026-08-22T09:00:00.000Z" }),
    ];
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(screen.getByText("Zarchiwizowano")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Przywróć" }));

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    expect(messageUpdates()[0].argsOf("update")).toEqual([{ archived_at: null }]);
  });

  it("ZNALEZISKO 7: odmowa bazy przy archiwizacji jest CAŁKOWICIE CICHA", async () => {
    // Zachowanie ISTNIEJĄCE. Mutacja `patch` (a więc ARCHIWIZACJA i cichy
    // zapis „przeczytane") jest jedyną z trzech mutacji tego ekranu BEZ
    // `onError` - `savePipeline` i `removeApplication` mają swoje. Skutek:
    // operator klika „Archiwizuj", nic się nie dzieje, żaden komunikat nie
    // pada, a zgłoszenie zostaje w skrzynce „Nowe" wyglądając na obrobione
    // dopiero po odświeżeniu. Toast sukcesu też nie pada - i to jedyne, co
    // odróżnia porażkę od powodzenia.
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    h.updateError = "odmowa RLS na contact_messages";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Archiwizuj" }));

    await waitFor(() => expect(messageUpdates()).toHaveLength(1));
    expect(h.toasts).toEqual([]);
    // Etykieta nie przeskakuje na „Przywróć" - panel nie kłamie o skutku,
    // tylko o nim milczy.
    expect(screen.getByRole("button", { name: "Archiwizuj" })).toBeInTheDocument();
    // Asymetria jest w źródle, nie w interpretacji: dwie pozostałe mutacje
    // tego ekranu mają `onError`, `patch` go nie ma.
    const source = read(ROUTE_FILE);
    const patchBlock = source.slice(
      source.indexOf("const patch = useMutation({"),
      source.indexOf("useEffect(() => {"),
    );
    expect(patchBlock).not.toContain("onError");
    expect(source.slice(source.indexOf("const savePipeline"))).toContain("onError");
  });
});

describe("/admin/careers - usunięcie zgłoszenia (operacja bez cofnięcia)", () => {
  const zapisane = () => [application({ read_at: "2026-08-21T09:00:00.000Z" })];

  it("usunięcie PYTA, a odmowa w oknie nie kasuje niczego", async () => {
    // Kaskada zabiera wiersz procesu i dziennik, a trigger kolejkuje plik CV
    // do wymazania z magazynu. Jedno kliknięcie bez pytania byłoby pułapką.
    h.rows = zapisane();
    h.confirmAnswer = false;
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zgłoszenie" }));

    expect(h.confirmMessages).toEqual([
      "Usunąć zgłoszenie wraz z CV i historią procesu? Tego nie da się cofnąć.",
    ]);
    expect(messageDeletes()).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("potwierdzenie kasuje wiersz po identyfikatorze, melduje kolejkę CV i czyści wybór", async () => {
    h.rows = zapisane();
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zgłoszenie" }));

    await waitFor(() => expect(messageDeletes()).toHaveLength(1));
    expect(messageDeletes()[0].argsOf("eq")).toEqual(["id", "zgloszenie-1"]);
    // Komunikat mówi WPROST, co stało się z plikiem - to jedyne miejsce,
    // w którym operator dowiaduje się o kolejce usunięć.
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "success",
        text: "Zgłoszenie usunięte. Plik CV trafił do kolejki usunięć.",
      }),
    );
    expect(await screen.findByText("Wybierz zgłoszenie z listy.")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-contact-messages"] });
  });

  it("kolejkowanie pliku CV jest po stronie BAZY, nie panelu", async () => {
    // Panel woła jeden DELETE i nie dotyka magazynu - inaczej każda inna
    // ścieżka usunięcia (RPC, service_role, kaskada) zostawiałaby osierocone
    // dane osobowe w buckecie.
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/storage/);
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(/CREATE TRIGGER trg_contact_messages_career_cv_gc/);
    expect(sql).toMatch(/AFTER DELETE ON public\.contact_messages/);
    expect(sql).toMatch(/'application_deleted'/);
  });

  it("odmowa bazy przy usuwaniu kończy się komunikatem, nie ciszą", async () => {
    h.rows = zapisane();
    h.deleteError = "odmowa: brak roli admina";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.click(screen.getByRole("button", { name: "Usuń zgłoszenie" }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: "odmowa: brak roli admina" }),
    );
    // Zgłoszenie ZOSTAJE otwarte - operator widzi, na czym poległ.
    expect(screen.getByRole("heading", { level: 2, name: "Zofia Przykładowska" }));
    expect(read(PIPELINE_MIGRATION)).toMatch(
      /CREATE POLICY career_applications_admin_delete ON public\.career_applications/,
    );
  });

  it("w trakcie usuwania przycisk jest zablokowany - jedno zgłoszenie, jeden DELETE", async () => {
    h.rows = zapisane();
    await mount();
    await openApplication("Zofia Przykładowska");
    h.hang.add("contact_messages");

    const button = screen.getByRole("button", { name: "Usuń zgłoszenie" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(h.confirmMessages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// WARSTWA PROCESU: ETAPY, OCENA, NOTATKA, DZIENNIK
// ---------------------------------------------------------------------------

describe("/admin/careers - warstwa procesu zgłoszenia", () => {
  const zProcesem = (over: Partial<RecruitmentPipelineRow> = {}) => [
    application({ read_at: "2026-08-21T09:00:00.000Z", career_applications: pipelineRow(over) }),
  ];

  it("brak wiersza procesu jest zgłaszany jako AWARIA, nie jako normalny stan", async () => {
    // Wiersz zakłada trigger `career_application_bootstrap` przy wpływie
    // zgłoszenia, więc jego brak znaczy, że trigger nie pobiegł - i że
    // zgłoszenie wypadnie z każdego raportu po etapach.
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z", career_applications: null })];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const alert = screen.getByText("Brak wiersza procesu dla tego zgłoszenia.");
    expect(alert.className).toContain("text-destructive");
    expect(container.querySelector("#career-stage")).toBeNull();
    // Dziennik nie jest wtedy o co pytać.
    expect(eventChains()).toHaveLength(0);
    expect(read(PIPELINE_MIGRATION)).toMatch(/CREATE TRIGGER trg_contact_messages_career_pipeline/);
  });

  it("droplista etapów niesie WSZYSTKIE etapy enuma i wskazuje etap wiersza", async () => {
    h.rows = zProcesem({ stage: "interview" });
    await mount();
    await openApplication("Zofia Przykładowska");

    const select = selectById("career-stage");
    expect(select.value).toBe("interview");
    expect([...select.options].map((option) => option.textContent)).toEqual(
      CAREER_STAGES.map((stage) => stageLabel(stage, "pl")),
    );
  });

  it("zmiana etapu i notatka jadą JEDNYM UPDATE-em na wiersz PROCESU", async () => {
    // Cel zapisu to `career_applications.id`, a NIE `contact_messages.id` -
    // pomyłka tych dwóch identyfikatorów zapisywałaby etap „w nikogo".
    // Notatka jedzie w tym samym UPDATE, bo dziennik pisze trigger: audyt
    // powstaje bez osobnego RPC i bez drugiej rundy do bazy.
    h.rows = zProcesem({ id: "proces-7" });
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openApplication("Zofia Przykładowska");

    fireEvent.change(screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…"), {
      target: { value: "  Zmyślona notatka: świetne dopasowanie do zmyślonej roli.  " },
    });
    fireEvent.change(selectById("career-stage"), { target: { value: "screening" } });

    await waitFor(() => expect(pipelineUpdates()).toHaveLength(1));
    expect(pipelineUpdates()[0].argsOf("update")).toEqual([
      {
        stage: "screening",
        stage_note: "Zmyślona notatka: świetne dopasowanie do zmyślonej roli.",
      },
    ]);
    expect(pipelineUpdates()[0].argsOf("eq")).toEqual(["id", "proces-7"]);

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "success", text: "Etap zmieniony." }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-applications"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-career-events"] });
  });

  it("dziennik decyzji powstaje w TRIGGERZE, więc audytu nie da się ominąć", () => {
    const sql = read(PIPELINE_MIGRATION);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.career_application_log_stage\(\)/);
    expect(sql).toMatch(/INSERT INTO public\.career_application_events/);
    expect(sql).toMatch(/left\(btrim\(COALESCE\(NEW\.stage_note, ''\)\), 2000\)/);
    // Panel nie ma tu żadnego RPC ani drugiego zapisu - to jest ta sama
    // obietnica, tylko po stronie klienta.
    expect(read(ROUTE_FILE)).not.toMatch(/supabase\.rpc/);
  });

  it("po zapisie etapu notatka jest czyszczona - opis jednej decyzji nie wjedzie w drugą", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");
    const note = screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…");

    fireEvent.change(note, { target: { value: "Zmyślona notatka do pierwszej decyzji." } });
    fireEvent.change(selectById("career-stage"), { target: { value: "offer" } });

    await waitFor(() => expect(note).toHaveValue(""));
  });

  it("notatka jest szkicem PER ZGŁOSZENIE - przełączenie kandydata czyści pole", async () => {
    // Bez tego resetu uzasadnienie decyzji o jednym kandydacie wjechałoby
    // do dziennika następnego - i to na trwałe, bo dziennika nie da się
    // poprawić z panelu.
    h.rows = [
      application({ read_at: "2026-08-21T09:00:00.000Z" }),
      application({
        id: "drugi",
        name: "Jan Zmyślony",
        email: "jan.zmyslony@example.com",
        read_at: "2026-08-21T09:00:00.000Z",
        custom: {},
        career_applications: pipelineRow({ id: "proces-2" }),
      }),
    ];
    await mount();
    await openApplication("Zofia Przykładowska");
    fireEvent.change(screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…"), {
      target: { value: "Notatka o pierwszym kandydacie." },
    });

    await openApplication("Jan Zmyślony");

    expect(screen.getByPlaceholderText("Dlaczego ta decyzja? Trafi do dziennika…")).toHaveValue("");
  });

  it("ocena zapisuje SAMĄ ocenę - bez notatki i bez komunikatu o zmianie etapu", async () => {
    // Ocena nie jest przejściem etapu, więc nie ma powodu dopisywać jej do
    // dziennika ani meldować „Etap zmieniony." - to byłby fałszywy wpis
    // w audycie decyzji.
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(selectById("career-rating"), { target: { value: "4" } });

    await waitFor(() => expect(pipelineUpdates()).toHaveLength(1));
    expect(pipelineUpdates()[0].argsOf("update")).toEqual([{ rating: 4 }]);
    expect(h.toasts.map((toast) => toast.text)).not.toContain("Etap zmieniony.");
  });

  it("„Bez oceny” zapisuje NULL, a nie zero - zero byłoby najgorszą oceną", async () => {
    h.rows = zProcesem({ rating: 4 });
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(selectById("career-rating").value).toBe("4");

    fireEvent.change(selectById("career-rating"), { target: { value: "" } });

    await waitFor(() => expect(pipelineUpdates()).toHaveLength(1));
    expect(pipelineUpdates()[0].argsOf("update")).toEqual([{ rating: null }]);
  });

  it("droplista oceny ma pozycję „bez oceny” i pięć stopni", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    expect([...selectById("career-rating").options].map((option) => option.textContent)).toEqual([
      "Bez oceny",
      "★",
      "★★",
      "★★★",
      "★★★★",
      "★★★★★",
    ]);
  });

  it("odmowa zapisu procesu pokazuje komunikat BAZY - to on mówi, który warunek padł", async () => {
    h.rows = zProcesem();
    h.pipelineError = "new row violates row-level security policy";
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(selectById("career-stage"), { target: { value: "hired" } });

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: "new row violates row-level security policy",
      }),
    );
    expect(h.toasts.map((toast) => toast.text)).not.toContain("Etap zmieniony.");
  });

  it("w trakcie zapisu obie droplisty są zablokowane", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");
    h.hang.add("career_applications");

    fireEvent.change(selectById("career-stage"), { target: { value: "offer" } });

    await waitFor(() => expect(selectById("career-stage")).toBeDisabled());
    expect(selectById("career-rating")).toBeDisabled();
  });

  it("ZNALEZISKO 5: wiersz procesu bez identyfikatora blokuje zapis przed wyjściem do bazy", async () => {
    // Zachowanie ISTNIEJĄCE: panel renderuje pełną sekcję etapów (bo pipeline
    // jest obiektem), ale `mutationFn` przerywa na `if (!id)`. Dobra połowa:
    // ŻADEN UPDATE nie wychodzi, więc nikt nie zapisuje etapu „w nikogo".
    // Zła połowa: operator dostaje surowy klucz techniczny `no_pipeline_row`
    // zamiast zdania - i nie wie, że to awaria triggera bootstrapu.
    h.rows = zProcesem({ id: undefined });
    await mount();
    await openApplication("Zofia Przykładowska");

    fireEvent.change(selectById("career-stage"), { target: { value: "rejected" } });

    await waitFor(() =>
      expect(h.toasts).toContainEqual({ kind: "error", text: "no_pipeline_row" }),
    );
    expect(pipelineUpdates()).toHaveLength(0);
    // Bez identyfikatora nie ma też o co pytać dziennika.
    expect(eventChains()).toHaveLength(0);
  });
});

describe("/admin/careers - dziennik decyzji", () => {
  const zProcesem = () => [
    application({ read_at: "2026-08-21T09:00:00.000Z", career_applications: pipelineRow() }),
  ];

  it("dziennik jest pytany po identyfikatorze PROCESU, najnowsze pierwsze, do 50 wpisów", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    await waitFor(() => expect(eventChains().length).toBeGreaterThan(0));
    const chain = eventChains()[0];
    expect(chain.argsOf("select")).toEqual(["id,from_stage,to_stage,note,created_at"]);
    expect(chain.argsOf("eq")).toEqual(["application_id", "proces-1"]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([50]);
  });

  it("pusty dziennik mówi to wprost, zamiast pokazywać nagłówek nad niczym", async () => {
    h.rows = zProcesem();
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak zmian etapu.")).toBeInTheDocument();
    expect(screen.getByText("Dziennik decyzji")).toBeInTheDocument();
  });

  it("odpowiedź dziennika bez ciała czyta się jak pusty dziennik", async () => {
    h.rows = zProcesem();
    h.events = null;
    await mount();
    await openApplication("Zofia Przykładowska");
    expect(await screen.findByText("Brak zmian etapu.")).toBeInTheDocument();
  });

  it("ZNALEZISKO 8b: ODMOWA odczytu dziennika wygląda jak dziennik bez wpisów", async () => {
    // Zachowanie ISTNIEJĄCE i najcięższa wersja tej klasy błędu na tym
    // ekranie: `data: events = []` sprowadza odmowę polityki
    // `career_application_events_staff_read` do zdania „Brak zmian etapu.".
    // Audyt decyzji o kandydacie wygląda wtedy na PUSTY - a to jest dokładnie
    // ten dokument, po który sięga się przy skardze na proces rekrutacji.
    h.rows = zProcesem();
    h.eventsError = "odmowa RLS na career_application_events";
    await mount();
    await openApplication("Zofia Przykładowska");

    expect(await screen.findByText("Brak zmian etapu.")).toBeInTheDocument();
    expect(h.toasts).toEqual([]);
  });

  it("wpis pokazuje przejście TEKSTEM, datę i notatkę operatora", async () => {
    h.rows = zProcesem();
    h.events = [
      {
        id: "wpis-2",
        from_stage: "screening",
        to_stage: "interview",
        note: "Zmyślona notatka: zaproszenie na rozmowę.",
        created_at: "2026-08-22T11:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const entry = await screen.findByText(
      new RegExp(`${stageLabel("screening", "pl")}.*${stageLabel("interview", "pl")}`),
    );
    expect(entry).toBeInTheDocument();
    const item = container.querySelector("ol li");
    expect(item?.textContent ?? "").toContain(
      new Date("2026-08-22T11:00:00.000Z").toLocaleString(),
    );
    expect(item?.textContent ?? "").toContain("Zmyślona notatka: zaproszenie na rozmowę.");
  });

  it("pierwszy wpis (bez etapu wyjściowego) pokazuje „-”, a nie puste miejsce", async () => {
    h.rows = zProcesem();
    h.events = [
      {
        id: "wpis-1",
        from_stage: null,
        to_stage: "screening",
        note: "",
        created_at: "2026-08-21T11:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    const item = await waitFor(() => {
      const node = container.querySelector("ol li");
      if (!node) throw new Error("test: dziennik nie wyrenderował wpisu");
      return node;
    });
    expect(item.textContent ?? "").toContain(`- → ${stageLabel("screening", "pl")}`);
    // Wpis bez notatki nie dokleja wiszącego separatora.
    expect(item.textContent ?? "").not.toMatch(/·\s*$/);
  });

  it("panel renderuje wpisy w kolejności, w jakiej oddała je baza - nic nie sortuje", async () => {
    // Fixture jest ustawiony PRZECIW każdemu naturalnemu porządkowi klienta:
    // pierwszy element jest najstarszy. Gdyby panel sortował u siebie, ta
    // asercja padnie - a kolejność dziennika to kolejność decyzji.
    h.rows = zProcesem();
    h.events = [
      {
        id: "a",
        from_stage: null,
        to_stage: "screening",
        note: "Alfa",
        created_at: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "b",
        from_stage: "screening",
        to_stage: "interview",
        note: "Beta",
        created_at: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "c",
        from_stage: "interview",
        to_stage: "offer",
        note: "Gamma",
        created_at: "2026-08-05T10:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");

    await screen.findByText(/Alfa/);
    const notes = [...container.querySelectorAll("ol li")].map((li) =>
      (li.textContent ?? "").replace(/.*· /, ""),
    );
    expect(notes).toEqual(["Alfa", "Beta", "Gamma"]);
    expect(read(ROUTE_FILE)).not.toMatch(/\.sort\(/);
  });
});

// ---------------------------------------------------------------------------
// DWUJĘZYCZNOŚĆ WBUDOWANEGO SŁOWNIKA
// ---------------------------------------------------------------------------

describe("/admin/careers - wbudowany słownik PL/EN", () => {
  it("po angielsku CAŁY panel mówi po angielsku - napisy nie są przypadkiem testu", async () => {
    // Ten test jest zabezpieczeniem uczciwości reszty pliku: napisy panelu są
    // literałami w module trasy (`PL`/`EN`), więc asercje na nie są literałami
    // w teście. Ten jeden dowód pokazuje, że mierzą WYBÓR SŁOWNIKA po
    // `i18n.language` - gdyby ktoś wpisał polski napis do `EN`, zapali się tu.
    await i18n.changeLanguage("en");
    h.rows = [
      application({
        lang: "en",
        read_at: "2026-08-21T09:00:00.000Z",
        career_applications: pipelineRow({ stage: "screening" }),
      }),
    ];
    h.leads = [];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Recruitment" })).toBeInTheDocument();
    for (const label of ["New", "All", "Archive"]) {
      expect(screen.getByRole("button", { name: label }), `brak filtra „${label}"`);
    }
    expect(screen.getByText("Pick an application from the list.")).toBeInTheDocument();

    await openApplication("Zofia Przykładowska");
    const pane = within(detailPane());
    expect(screen.getByText("No CRM lead")).toBeInTheDocument();
    expect(pane.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(pane.getByRole("button", { name: "Delete application" })).toBeInTheDocument();
    expect(screen.getByText("Decision log")).toBeInTheDocument();
    // Etykiety wspólnej warstwy też przechodzą na angielski - i to przez tę
    // samą funkcję słownikową, nie przez drugą kopię.
    expect(selectById("career-stage").value).toBe("screening");
    expect([...selectById("career-stage").options].map((option) => option.textContent)).toEqual(
      CAREER_STAGES.map((stage) => stageLabel(stage, "en")),
    );
    expect(screen.getByText(seniorityLabel("mid", "en"))).toBeInTheDocument();
  });

  it("nieznany język interfejsu spada na polski, a nie na pustkę", async () => {
    // `i18n.language === "en" ? "en" : "pl"` - panel ma dwa słowniki, a aplikacja
    // może mieć więcej języków niż panel admina.
    await i18n.changeLanguage("de");
    await mount();
    expect(screen.getByRole("heading", { level: 1, name: "Rekrutacja" })).toBeInTheDocument();
  });

  it("nagłówek wyjaśnia, SKĄD biorą się te zgłoszenia", async () => {
    // Bez tego zdania operator nie wie, którym formularzem przyszło zgłoszenie
    // i dlaczego widzi je także w Contact Center.
    await mount();
    expect(
      screen.getByText("Zgłoszenia ze strony „Dołącz do zespołu” (/zatrudniamy)."),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ
// ---------------------------------------------------------------------------

describe("/admin/careers - dostępność", () => {
  it("widok listy nie ma naruszeń axe", async () => {
    h.rows = [application(), application({ id: "drugi", name: "Jan Zmyślony", custom: {} })];
    const { container } = await mount();
    await screen.findByText("Zofia Przykładowska");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("otwarte zgłoszenie z warstwą procesu i dziennikiem nie ma naruszeń axe", async () => {
    // Tu żyją wszystkie kontrolki formularza (dwie droplisty, pole notatki),
    // więc to ten widok decyduje o etykietach i porządku nagłówków.
    h.rows = [application({ read_at: "2026-08-21T09:00:00.000Z" })];
    h.leads = [{ id: "lead-1", stage: "new", updated_at: "2026-08-21T10:00:00.000Z" }];
    h.events = [
      {
        id: "wpis-1",
        from_stage: "new",
        to_stage: "screening",
        note: "Zmyślona notatka.",
        created_at: "2026-08-21T11:00:00.000Z",
      },
    ];
    const { container } = await mount();
    await openApplication("Zofia Przykładowska");
    await screen.findByText(/Zmyślona notatka\./);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
