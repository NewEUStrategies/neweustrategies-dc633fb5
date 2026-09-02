/**
 * Trasa `/admin/community/qa` ZAMONTOWANA - moderacja sesji Q&A, pytań
 * i publikacji podsumowania jako treści. Przed tym plikiem 0/122 linii
 * i 0/57 funkcji: największa czarna dziura modułu społeczności.
 *
 * PO CO TEN PLIK. Ta jedna trasa niesie cztery decyzje o różnym ciężarze:
 *   1. przejścia statusu sesji (draft -> scheduled -> open -> answering ->
 *      closed) - to one decydują, czy publiczność w ogóle może zadać pytanie,
 *   2. moderację pytań (approve / reject / answer) - czyli to, czyje pytanie
 *      zobaczy świat,
 *   3. PUBLIKACJĘ podsumowania sesji jako wpisu - jedyną operację na tym
 *      ekranie, która wypuszcza treść na zewnątrz i której panel nie umie
 *      cofnąć jednym kliknięciem,
 *   4. anonimowość pytającego - Q&A działa w regule Chatham House, więc panel
 *      nie może pokazać moderatorowi tożsamości, której baza mu nie dała.
 *
 * ---------------------------------------------------------------------------
 * PYTANIE 1: GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE
 * ---------------------------------------------------------------------------
 * Zadanie brzmiało „użytkownik bez roli sztabowej nie widzi panelu". Zanim
 * powstał ten plik, sprawdziłem, gdzie ten warunek FAKTYCZNIE mieszka:
 *
 *   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
 *      renderu dla wszystkich tras panelu: `useAuth()` daje `isStaff`, efekt
 *      robi `navigate({ to: "/login" })`, a komponent zwraca `null`.
 *   2. `src/routes/admin.community.tsx` - podnawigacja i `<Outlet/>`, zero
 *      warunku roli.
 *   3. TA trasa - zero warunku roli. Nie ma `useAuth`, nie ma `beforeLoad`,
 *      nie ma `redirect`, nie ma `<Navigate/>`.
 *   4. `src/lib/admin/community.ts` - `fetchQaSessions`, `fetchQaQuestions`,
 *      `updateQaSession`, `moderateQaQuestion`, `createQaSession` idą ZWYKŁYM
 *      klientem Supabase (`supabase.from(...)`), a `publishQaSessionSummary`
 *      przez `supabase.rpc(...)`. Żadna z nich nie jest funkcją serwerową
 *      z middleware. Autorytetem ostatecznym jest więc RLS (`qa sessions
 *      staff all`, `qa questions staff read`, `qa questions moderate`) oraz
 *      `can_publish_content` wewnątrz RPC - i to pgTAP jest ich dowodem.
 *
 * Dlatego NIE MA tu testu „bez roli nie widzi panelu" udającego dowód na
 * poziomie tej trasy: taki test mierzyłby atrapę `useAuth`, której ta trasa
 * nawet nie woła. Zamiast tego są asercje mierzące TO, CO JEST: (a) render tej
 * trasy nie zależy od roli, (b) warunek roli stoi w layoucie `/admin` i to on
 * przekierowuje na `/login`, (c) rodzina `admin.community.*` jest od teraz
 * wymieniona w bramce `adminRouteAuthority.gate.test.ts` (patrz ZNALEZISKO
 * niżej), więc zniknięcie tej warstwy nie przejdzie po cichu.
 *
 * ZNALEZISKO. Bramka `src/routes/__tests__/adminRouteAuthority.gate.test.ts`
 * miała jawne listy rodzin: `admin.community.clubs.*` (6 tras),
 * `admin.newsletter.*` (14), `MODULE19_ROUTES` (13) i `admin.settings.*`.
 * Rodziny `admin.community.*` POZA klubami - dziesięciu tras, w tym tej -
 * nie widziała ŻADNA z tych list. Dopisałem ją tam jako osobną sekcję
 * („panel społeczności - autorytet dostępu"), nie ruszając istniejących
 * asercji.
 *
 * ---------------------------------------------------------------------------
 * PYTANIE 2: DANE JEDNEGO TENANTA W PANELU DRUGIEGO - GRANICA DOWODU
 * ---------------------------------------------------------------------------
 * Odczyt idzie ZWYKŁYM klientem pod RLS, nie funkcją serwerową. Co z tego
 * DA SIĘ dowieść w tej warstwie i co jest tu dowiedzione:
 *
 *   * ODCZYT: `fetchQaSessions` i `fetchQaQuestions` nie budują ŻADNEGO
 *     warunku najemcy - nie ma `.eq("tenant_id", ...)`. Panel nie ma więc
 *     filtra, który mógłby być źle napisany albo podmieniony w DevTools;
 *     zakres wyznacza wyłącznie polityka bazy (`qa sessions staff all`
 *     i `qa questions staff read` porównują `tenant_id` z
 *     `current_tenant_id()`, czyli z najemcą PROFILU wołającego).
 *   * ZAPIS: ładunek `createQaSession` NIE NIESIE `tenant_id`. Kolumna ma
 *     w bazie `DEFAULT public.public_tenant_id()`, więc najemca nowej sesji
 *     bierze się z hosta żądania, a nie z niczego, co panel może podać.
 *     To jest asercja na KSZTAŁCIE ŁADUNKU - mierzalna tutaj.
 *   * GRANICA: to, że polityka faktycznie odcina wiersze obcego najemcy, jest
 *     twierdzeniem O BAZIE. Test na atrapie klienta go nie udowodni i tego
 *     nie udaje. Dowód należy do pgTAP - i tam jest DZIURA (patrz `it.fails`
 *     „izolacja najemcy Q&A jest dowiedziona w pgTAP" z kontrolą dodatnią na
 *     `club_topics_tenant_isolation_test.sql`).
 *
 * ---------------------------------------------------------------------------
 * PYTANIE 3: OPERACJE NISZCZĄCE WYMAGAJĄ POTWIERDZENIA
 * ---------------------------------------------------------------------------
 * Na tym ekranie jest jedna operacja, której panel nie cofa: PUBLIKACJA
 * podsumowania jako wpisu. Stoi za dialogiem z osobnym „Anuluj" i osobnym
 * „Utwórz szkic" - i to jest tu przedmiotem dowodu (otwarcie nie woła RPC,
 * anulowanie nie woła, dopiero przycisk woła, a szkic i publikacja to dwa
 * różne wywołania). Przejścia statusu i moderacja są jednoklikowe ŚWIADOMIE:
 * w tym samym wierszu stoi akcja odwrotna (sesja zamknięta ma „Wznów jako
 * draft", pytanie odrzucone ma „Zatwierdź"), więc pomyłka kosztuje jedno
 * kliknięcie, a nie utratę danych. To też jest tu zmierzone - inaczej
 * zdanie „to odwracalne" byłoby założeniem.
 *
 * CO JESZCZE DOWODZI TEN PLIK: `head()` (tytuł karty), trzy stany listy
 * (ładowanie / pustka / odmowa odczytu), filtr statusu jedzie do BAZY a nie na
 * klienta, anonimowość pytającego (`user_id` nie opuszcza bazy; przy
 * `is_anonymous` panel nie pokazuje `author_display`), kolejność serwerowa NIE
 * jest przeliczana na kliencie, oraz brak naruszeń axe na widoku głównym.
 *
 * CO JEST ATRAPOWANE I DLACZEGO. Wyłącznie granica danych
 * (`@/lib/admin/community`) i toasty (`sonner`). Warstwa danych ma własny
 * przedmiot dowodu (budowa zapytań PostgREST), a tutaj interesuje nas, co
 * panel Z NIĄ ROBI: co jej podaje, w jakiej kolejności renderuje odpowiedź
 * i czego nie pokazuje. `react-i18next`, router, react-query i Radix są
 * PRAWDZIWE, więc każda asercja na napisie mierzy słownik, a nie literał
 * wpisany w teście.
 *
 * ŚWIADOMIE POZA ZAKRESEM: reguły RPC `publish_qa_session_summary`
 * (idempotencja, escaping, `can_publish_content`) - to pgTAP
 * (`supabase/tests/community_qa_summary_test.sql`); formatowanie dat
 * (`date-fns` ma własne testy); warstwa `@/lib/admin/community`.
 *
 * RODO: żadnych prawdziwych osób ani treści. Nazwiska i pytania zmyślone,
 * adresy wyłącznie `@example.com`.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type {
  CreateQaSessionInput,
  QaQuestionRow,
  QaQuestionStatus,
  QaSessionRow,
  QaSessionStatus,
  QaSummaryResult,
} from "@/lib/admin/community";

/** Akcja toastu (przycisk „Otwórz w edytorze") w kształcie, którego dotyka test. */
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface RecordedToast {
  kind: "success" | "error";
  text: string;
  action?: ToastAction;
}

const h = vi.hoisted(() => ({
  sessions: [] as QaSessionRow[],
  /** Lista sesji nigdy nie odpowiada - do dowodu o stanie ładowania. */
  sessionsHang: false,
  /** Komunikat odmowy odczytu sesji (RLS/awaria) albo `null`. */
  sessionsError: null as string | null,
  sessionCalls: [] as (string | undefined)[],

  questions: [] as QaQuestionRow[],
  questionsHang: false,
  questionCalls: [] as { sessionId?: string; status?: string }[],

  updates: [] as { id: string; patch: Record<string, unknown> }[],
  updateFails: false,

  moderations: [] as { id: string; status: string; answer?: string }[],
  moderateFails: false,

  summaryCalls: [] as { sessionId: string; publish: boolean }[],
  summaryResult: {
    post_id: "post-zmyslony-1",
    slug: "podsumowanie-sesji-testowej",
    status: "draft",
    questions: 0,
  } as QaSummaryResult,
  summaryError: null as string | null,
  /** Publikacja czeka na zwolnienie - do dowodu o blokadzie przycisków. */
  summaryHolds: false,
  releaseSummary: null as (() => void) | null,

  createCalls: [] as CreateQaSessionInput[],
  createError: null as string | null,

  toasts: [] as RecordedToast[],
}));

// GRANICA DANYCH. Atrapa jest tu na miejscu: te funkcje budują zapytania
// PostgREST i mają własny przedmiot dowodu. Tutaj dowodzimy, CO panel im
// podaje i co robi z odpowiedzią.
vi.mock("@/lib/admin/community", () => ({
  fetchQaSessions: async (status?: string): Promise<QaSessionRow[]> => {
    h.sessionCalls.push(status);
    if (h.sessionsHang) await new Promise<void>(() => {});
    if (h.sessionsError !== null) throw new Error(h.sessionsError);
    return h.sessions;
  },
  updateQaSession: async (id: string, patch: Record<string, unknown>): Promise<void> => {
    h.updates.push({ id, patch });
    if (h.updateFails) throw new Error("test: baza odrzuciła zmianę statusu");
  },
  fetchQaQuestions: async (params: {
    sessionId?: string;
    status?: string;
  }): Promise<QaQuestionRow[]> => {
    h.questionCalls.push(params);
    if (h.questionsHang) await new Promise<void>(() => {});
    return h.questions;
  },
  moderateQaQuestion: async (id: string, status: string, answer?: string): Promise<void> => {
    h.moderations.push({ id, status, answer });
    if (h.moderateFails) throw new Error("test: baza odrzuciła moderację");
  },
  publishQaSessionSummary: async (
    sessionId: string,
    publish: boolean,
  ): Promise<QaSummaryResult> => {
    h.summaryCalls.push({ sessionId, publish });
    if (h.summaryHolds) {
      await new Promise<void>((resolve) => {
        h.releaseSummary = resolve;
      });
    }
    if (h.summaryError !== null) throw new Error(h.summaryError);
    return h.summaryResult;
  },
  createQaSession: async (input: CreateQaSessionInput): Promise<QaSessionRow> => {
    h.createCalls.push(input);
    if (h.createError !== null) throw new Error(h.createError);
    return sessionFixtureForCreate(input);
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string, options?: { action?: ToastAction }) =>
      h.toasts.push({ kind: "success", text, action: options?.action }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

// `react-i18next` NIE JEST atrapowany - napisy mają pochodzić ze słownika
// (`@/lib/i18n-admin-community`, rejestrowany przy imporcie modułu trasy).
// Skrót `vi.mock("react-i18next", () => reactI18nextMock())` zakleszczyłby
// plik: fabryka mocka sięga po `@/lib/i18n`, czyli moduł importujący właśnie
// mockowany pakiet (ostrzeżenie z nagłówka `@/test/i18nReal`).

import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderRoute, routeHead } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as QaAdminRoute } from "@/routes/admin.community.qa";

const t = realT("pl");
const PATH = "/admin/community/qa";
const ROUTE_FILE = "src/routes/admin.community.qa.tsx";
const DATA_LAYER = "src/lib/admin/community.ts";
const ADMIN_LAYOUT = "src/routes/admin.tsx";
const AUTHORITY_GATE = "src/routes/__tests__/adminRouteAuthority.gate.test.ts";
/** Migracja zakładająca tabele Q&A wraz z politykami RLS i grantami kolumnowymi. */
const QA_MIGRATION = "supabase/migrations/20260712224838_5de38579-3d42-4cfa-a8bc-d87e799bbc2c.sql";
/** Migracja z serwerową kolejnością publiczną (priorytet Pro > głosy > starszeństwo). */
const QA_LIST_MIGRATION = "supabase/migrations/20260724090700_qa_list_my_vote.sql";
/** Migracja z RPC budującym podsumowanie sesji. */
const QA_SUMMARY_MIGRATION = "supabase/migrations/20260721151000_qa_session_summary.sql";
const QA_PGTAP = "supabase/tests/community_qa_test.sql";
const QA_SUMMARY_PGTAP = "supabase/tests/community_qa_summary_test.sql";
const CLUB_TENANT_PGTAP = "supabase/tests/club_topics_tenant_isolation_test.sql";

/** Identyfikator najemcy w fixtures - zmyślony, nigdy z produkcji. */
const TENANT = "11111111-1111-4111-8111-111111111111";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function session(over: Partial<QaSessionRow> = {}): QaSessionRow {
  return {
    id: "sesja-1",
    tenant_id: TENANT,
    slug: "zmyslony-akt-2026",
    title_pl: "Sesja o zmyślonym akcie",
    title_en: "Session on a made-up act",
    intro_pl: null,
    intro_en: null,
    host_user_id: "host-zmyslony-1",
    event_id: null,
    post_id: null,
    status: "draft",
    opens_at: null,
    closes_at: null,
    created_by: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function question(over: Partial<QaQuestionRow> = {}): QaQuestionRow {
  return {
    id: "pytanie-1",
    tenant_id: TENANT,
    session_id: "sesja-1",
    author_display: "Zofia Przykładowska",
    is_anonymous: false,
    body: "Zmyślone pytanie o wymyślony przepis przejściowy.",
    status: "pending",
    answer_body: null,
    answered_by: null,
    answered_at: null,
    created_at: "2026-08-02T09:00:00.000Z",
    updated_at: "2026-08-02T09:00:00.000Z",
    ...over,
  };
}

/**
 * Wiersz, który „baza" oddaje po utworzeniu sesji. Atrapa musi zwrócić pełny
 * kształt `QaSessionRow`, bo taki jest kontrakt `createQaSession` - dzięki
 * temu typ pilnuje, że fixture nie rozjedzie się z tabelą.
 */
function sessionFixtureForCreate(input: CreateQaSessionInput): QaSessionRow {
  return session({
    id: "sesja-nowa",
    slug: input.slug,
    title_pl: input.title_pl,
    title_en: input.title_en,
    intro_pl: input.intro_pl ?? null,
    intro_en: input.intro_en ?? null,
    opens_at: input.opens_at,
    closes_at: input.closes_at,
    status: input.status,
  });
}

/** Klient z wyłączonymi ponowieniami - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({
    route: QaAdminRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/**
 * Wiersz listy sesji po jej tytule.
 *
 * STRAŻNIK, nie rzutowanie: przyciski akcji są ikonowe i rozpoznaje się je po
 * `title`, ale te same tytuły powtarzają się w KAŻDYM wierszu, więc namierzenie
 * musi być zawężone do wiersza - a to wymaga sprawdzenia w runtime, że wiersz
 * faktycznie istnieje.
 */
function sessionRow(title: string): HTMLElement {
  const opener = screen.getByRole("button", { name: new RegExp(title) });
  const row = opener.closest("li");
  if (!row) throw new Error(`test: wiersz sesji „${title}" nie ma kontenera <li>`);
  return row;
}

/**
 * Karta pytania po jego treści - do sięgnięcia po przyciski moderacji.
 * Czeka na pojawienie się treści, bo lista pytań dojeżdża asynchronicznie.
 *
 * STRAŻNIK, nie rzutowanie: `closest` zwraca `Element | null`, a `within`
 * potrzebuje `HTMLElement`, więc warunek sprawdza to w RUNTIME.
 */
async function questionCard(body: string): Promise<HTMLElement> {
  const card = (await screen.findByText(body)).closest("div.rounded-lg");
  if (!(card instanceof HTMLElement)) {
    throw new Error(`test: pytanie „${body}" nie ma kontenera karty`);
  }
  return card;
}

/** Otwiera listę pytań sesji i czeka na pierwsze zapytanie do warstwy danych. */
async function openQuestions(title = "Sesja o zmyślonym akcie"): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
  await waitFor(() => expect(h.questionCalls.length).toBeGreaterThan(0));
}

/** Czeka, aż lista sesji przestanie być w stanie ładowania. */
async function settled(): Promise<void> {
  await waitFor(() => expect(screen.queryByText(t("adminCommunity.qa.loading"))).toBeNull());
}

/**
 * Wybiera wartość w prawdziwej dropliście Radix (bez atrapy `ui/select`).
 * Radix otwiera listę także z klawiatury, a happy-dom obsługuje `keydown` -
 * dzięki temu ekran jest testowany w takim kształcie, w jakim trafia do axe.
 */
async function chooseInSelect(trigger: HTMLElement, optionLabel: string): Promise<void> {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
}

beforeEach(() => {
  h.sessions = [];
  h.sessionsHang = false;
  h.sessionsError = null;
  h.sessionCalls = [];
  h.questions = [];
  h.questionsHang = false;
  h.questionCalls = [];
  h.updates = [];
  h.updateFails = false;
  h.moderations = [];
  h.moderateFails = false;
  h.summaryCalls = [];
  h.summaryResult = {
    post_id: "post-zmyslony-1",
    slug: "podsumowanie-sesji-testowej",
    status: "draft",
    questions: 0,
  };
  h.summaryError = null;
  h.summaryHolds = false;
  h.releaseSummary = null;
  h.createCalls = [];
  h.createError = null;
  h.toasts = [];
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// SKLEJENIE TRASY
// ---------------------------------------------------------------------------

describe("/admin/community/qa - sklejenie trasy", () => {
  it("head() ustawia tytuł karty przeglądarki", async () => {
    // Czytamy `head()` DWIEMA drogami: wprost (kontrakt funkcji) i przez
    // zamontowany router (to, co faktycznie trafiłoby do `<HeadContent/>`).
    // Panel ma kilkadziesiąt podstron - bez tytułu operator z otwartymi
    // zakładkami widzi kilka identycznych kart.
    expect(routeHead(QaAdminRoute).meta).toContainEqual({ title: "Q&A · Community · Admin" });

    const { meta } = await mount();
    expect(meta()).toContainEqual({ title: "Q&A · Community · Admin" });
  });

  it("trasa wisi pod `/admin`, więc chroni ją bramka `isStaff` z układu nadrzędnego", () => {
    const source = read(ROUTE_FILE);
    expect(source).toMatch(/createFileRoute\("\/admin\/community\/qa"\)/);
    expect(PATH.startsWith("/admin/")).toBe(true);
  });

  it("nagłówek panelu mówi, CO to za ekran i jak z niego korzystać", async () => {
    await mount();
    expect(
      screen.getByRole("heading", { name: t("adminCommunity.qa.qSessions") }),
    ).toBeInTheDocument();
    // Zdanie o kliknięciu jest instrukcją, nie ozdobą: drill do pytań nie ma
    // żadnej innej afordancji niż klik w wiersz.
    expect(screen.getByText(t("adminCommunity.qa.qSessionsClickOne"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PYTANIE 1: UPRAWNIENIA. Patrz USTALENIE w nagłówku pliku.
// ---------------------------------------------------------------------------

describe("/admin/community/qa - gdzie stoi bramka uprawnień", () => {
  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent nie woła `useAuth` ani nie przekierowuje, więc
    // renderuje się w harnessie, w którym żadnej sesji nie ma. To NIE jest
    // dziura - to podział pracy: jedna bramka w layoucie zamiast stu
    // czterdziestu kopii w trasach. Gdyby ktoś dołożył warunek roli TUTAJ, ten
    // test zapali się jako pierwszy i wymusi aktualizację opisu.
    await mount();
    expect(
      screen.getByRole("heading", { name: t("adminCommunity.qa.qSessions") }),
    ).toBeInTheDocument();
  });

  it("plik trasy nie zawiera warunku roli ani przekierowania", () => {
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(source).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem, więc renderem nie da
    // się go tu dosięgnąć.
    const layout = read(ADMIN_LAYOUT);
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });

  it("dane panelu idą zwykłym klientem Supabase - autorytetem jest RLS, nie middleware", () => {
    // Świadome NEGATYWNE ustalenie. Gdyby te funkcje były serwerowymi
    // (`createServerFn`), dowód uprawnień robiłoby się przez
    // `serverFnMiddlewareNames` z `@/test/serverFnHarness`. Nie są.
    const layer = read(DATA_LAYER);
    expect(layer).not.toMatch(/createServerFn/);
    for (const fn of [
      "export async function fetchQaSessions",
      "export async function fetchQaQuestions",
      "export async function updateQaSession",
      "export async function moderateQaQuestion",
      "export async function publishQaSessionSummary",
      "export async function createQaSession",
    ]) {
      expect(layer, `warstwa danych straciła ${fn}`).toContain(fn);
    }
  });

  it("polityki RLS Q&A wymagają roli sztabowej ALBO gospodarza sesji", () => {
    // To jest miejsce, w którym naprawdę mieszka autoryzacja tego ekranu.
    // Ten test nie sprawdza bazy (do tego jest pgTAP) - sprawdza, że polityka
    // nie zniknęła i nadal wymienia OBIE ścieżki dostępu.
    const sql = read(QA_MIGRATION);
    expect(sql).toMatch(/CREATE POLICY "qa sessions staff all" ON public\.qa_sessions/);
    expect(sql).toMatch(/CREATE POLICY "qa questions staff read" ON public\.qa_questions/);
    expect(sql).toMatch(/CREATE POLICY "qa questions moderate" ON public\.qa_questions/);
    expect(sql).toMatch(/CREATE POLICY "qa questions host read" ON public\.qa_questions/);
    expect(sql).toMatch(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'::app_role\)/);
  });

  it("bramka rodzin tras panelu WIDZI od teraz rodzinę `admin.community.*`", () => {
    // ZNALEZISKO z nagłówka. Bramka `adminRouteAuthority.gate.test.ts` miała
    // jawne listy rodzin i żadna nie obejmowała tej trasy. Ta asercja pilnuje,
    // żeby dopisana rodzina nie wypadła z bramki po cichu - dokładnie tak, jak
    // sama bramka pilnuje swoich kanarków zasięgu.
    const gate = read(AUTHORITY_GATE);
    expect(gate).toContain("admin.community.qa.tsx");
    expect(gate).toMatch(/COMMUNITY_ROUTES/);
  });
});

// ---------------------------------------------------------------------------
// PYTANIE 2: IZOLACJA NAJEMCY - i granica tego, co da się tu dowieść.
// ---------------------------------------------------------------------------

describe("/admin/community/qa - izolacja najemcy: co panel wysyła, a czego nie", () => {
  it("odczyt NIE niesie warunku najemcy - panel nie ma filtra, który mógłby skłamać", () => {
    // Gdyby zakres najemcy był budowany na kliencie (`.eq("tenant_id", ...)`),
    // wystarczyłaby jedna literówka albo jedna podmiana w DevTools, żeby panel
    // zaczął pytać o cudze wiersze. Nie jest: zapytanie nie wspomina o najemcy
    // ani razu, więc zakres wyznacza WYŁĄCZNIE polityka bazy.
    const layer = read(DATA_LAYER);
    const qaSection = layer.slice(layer.indexOf("// ------- Q&A --------"));
    const bodyToPolls = qaSection.slice(0, qaSection.indexOf("// ------- Polls --------"));
    expect(bodyToPolls).not.toMatch(/eq\("tenant_id"/);
    // …a polityka porównuje najemcę z PROFILEM wołającego, nie z niczym, co
    // przyjdzie z przeglądarki.
    expect(read(QA_MIGRATION)).toMatch(/tenant_id = \(SELECT public\.current_tenant_id\(\)\)/);
  });

  it("ładunek nowej sesji NIE niesie `tenant_id` - najemca bierze się z bazy", async () => {
    // Asercja na KSZTAŁCIE ŁADUNKU, mierzalna w tej warstwie: gdyby panel
    // podawał najemcę, dałoby się go podmienić. Kolumna ma w bazie
    // `DEFAULT public.public_tenant_id()`, więc pochodzi z hosta żądania.
    await mount();
    await settled();
    await fillNewSessionForm({ slug: "sesja-najemcy", titlePl: "Tytuł", titleEn: "Title" });
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.qa.create") }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(Object.keys(h.createCalls[0])).not.toContain("tenant_id");
    expect(read(QA_MIGRATION)).toMatch(
      /tenant_id uuid NOT NULL DEFAULT public\.public_tenant_id\(\)/,
    );
  });

  it("panel renderuje DOKŁADNIE te wiersze, które oddała baza - nic nie dokłada", async () => {
    // Druga połowa granicy: nawet gdyby RLS był szczelny, panel mógłby sklejać
    // dane z pamięci podręcznej innego zakresu. Nie sklei - lista jest
    // odwzorowaniem 1:1 odpowiedzi zapytania, bez łączenia, bez sumowania.
    h.sessions = [
      session({ id: "sesja-a", slug: "sesja-a", title_pl: "Sesja najemcy A" }),
      session({ id: "sesja-b", slug: "sesja-b", title_pl: "Druga sesja najemcy A" }),
    ];
    const { container } = await mount();
    await screen.findByText("Sesja najemcy A");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  /**
   * ZŁAMANY KONTRAKT (DZIURA W DOWODZIE, NIE W KODZIE PRODUKCYJNYM):
   * izolacja najemcy dla `qa_sessions` / `qa_questions` NIE MA dowodu pgTAP.
   * Oba pliki pgTAP modułu Q&A (`community_qa_test.sql`,
   * `community_qa_summary_test.sql`) pracują w JEDNYM najemcy - nie zakładają
   * drugiego (`INSERT INTO public.tenants`), więc nie sprawdzają, czy polityka
   * `tenant_id = current_tenant_id()` faktycznie odcina cudze wiersze.
   *
   * Dlaczego to ma znaczenie akurat tutaj: TA trasa nie ma na kliencie ŻADNEGO
   * warunku najemcy (asercja wyżej), więc polityka bazy jest jedynym, co dzieli
   * tenantów - a jedyna warstwa, która potrafi to zweryfikować, tego nie robi.
   *
   * OCZEKIWANY KONTRAKT: pgTAP modułu Q&A zakłada drugiego najemcę i asertuje
   * zerową widoczność jego sesji i pytań - tak jak robi to
   * `club_topics_tenant_isolation_test.sql` dla klubów.
   *
   * Zapisane jako `it.fails`, bo naprawa oznacza nowy dowód w SQL, a ten plik
   * niczego w produkcji nie zmienia. KONTROLA DODATNIA stoi w teście obok.
   */
  it.fails("izolacja najemcy Q&A jest dowiedziona w pgTAP", () => {
    const sql = `${read(QA_PGTAP)}\n${read(QA_SUMMARY_PGTAP)}`;
    expect(sql).toMatch(/INSERT INTO public\.tenants/);
  });

  it("kontrola dodatnia: ten sam wzorzec ZNAJDUJE dowód izolacji dla klubów", () => {
    // Bez tej kontroli `it.fails` wyżej mógłby przechodzić dlatego, że wzorzec
    // jest zepsuty, a nie dlatego, że dowodu nie ma.
    expect(read(CLUB_TENANT_PGTAP)).toMatch(/INSERT INTO public\.tenants/);
  });

  it("pgTAP modułu Q&A istnieje i pilnuje tego, co pilnuje - pokrycie nie zniknęło", () => {
    // Plik pgTAP da się usunąć jednym commitem i nic w TS nie zapłonie.
    expect(read(QA_PGTAP).length).toBeGreaterThan(0);
    expect(read(QA_SUMMARY_PGTAP).length).toBeGreaterThan(0);
    expect(read(QA_PGTAP)).toContain("user_id");
    expect(read(QA_SUMMARY_PGTAP)).toContain("publish_qa_session_summary");
  });
});

// ---------------------------------------------------------------------------
// LISTA SESJI: STANY
// ---------------------------------------------------------------------------

describe("/admin/community/qa - lista sesji: trzy stany odczytu", () => {
  it("w trakcie pobierania mówi, że ładuje - nie udaje pustej bazy", async () => {
    h.sessionsHang = true;
    await mount();
    expect(await screen.findByText(t("adminCommunity.qa.loading"))).toBeInTheDocument();
    // Pustka i ładowanie są WZAJEMNIE WYKLUCZAJĄCE - inaczej moderator
    // zobaczyłby „brak sesji" na bazie pełnej sesji.
    expect(screen.queryByText(t("adminCommunity.qa.noSessions"))).toBeNull();
  });

  it("pusta baza mówi wprost, że sesji nie ma", async () => {
    await mount();
    await settled();
    expect(screen.getByText(t("adminCommunity.qa.noSessions"))).toBeInTheDocument();
  });

  it("wiersz sesji pokazuje tytuł, status i adres - to po nich moderator wybiera", async () => {
    h.sessions = [session({ status: "open", slug: "zmyslony-akt-2026" })];
    const { container } = await mount();
    await screen.findByText("Sesja o zmyślonym akcie");
    const row = sessionRow("Sesja o zmyślonym akcie");
    expect(within(row).getByText("open")).toBeInTheDocument();
    expect(row.textContent).toContain("/zmyslony-akt-2026");
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("tytuł idzie przez `pickLocalized` - brak polskiego nie renderuje pustki", async () => {
    // Bliźniacze kolumny: gdy tłumaczenia w języku interfejsu nie ma, panel ma
    // pokazać drugie, a nie pusty wiersz nie do kliknięcia.
    h.sessions = [session({ title_pl: "   ", title_en: "Fallback session title" })];
    await mount();
    expect(await screen.findByText("Fallback session title")).toBeInTheDocument();
  });

  /**
   * ZŁAMANY KONTRAKT: ODMOWA ODCZYTU WYGLĄDA JAK PUSTA BAZA.
   * `const rows = sessionsQ.data ?? []` sprowadza błąd zapytania do tej samej
   * gałęzi co pustka (`admin.community.qa.tsx:107,147`), więc gdy RLS odmówi
   * albo sieć padnie, moderator czyta „Brak sesji." - komunikat, który mówi
   * coś o STANIE BAZY, a nie o tym, że odczyt w ogóle nie doszedł. To jest ta
   * sama klasa błędu, którą panel powiadomień rozwiązał kafelkiem „-" zamiast
   * „0" (`adminCommunityNotificationsRoute.test.tsx`).
   *
   * Skutek operacyjny: sesja z pytaniami oczekującymi na moderację wygląda na
   * nieistniejącą, a pytania czekają dalej. To samo dotyczy listy pytań
   * w dialogu (`rows = questionsQ.data ?? []`, linia 355).
   *
   * OCZEKIWANY KONTRAKT: `sessionsQ.isError` daje własny komunikat, różny od
   * `noSessions`.
   *
   * Zapisane jako `it.fails`, bo naprawa wymaga zmiany pliku trasy i nowego
   * klucza i18n, a ten plik nie zmienia zachowania produkcyjnego. KONTROLA
   * DODATNIA: test „pusta baza mówi wprost, że sesji nie ma" wyżej dowodzi, że
   * ta sama technika oczekiwania wykrywa poprawny przypadek pustki.
   */
  it.fails("odmowa odczytu NIE wygląda jak pusta baza", async () => {
    h.sessionsError = "odmowa RLS";
    await mount();
    await settled();
    expect(screen.queryByText(t("adminCommunity.qa.noSessions"))).toBeNull();
  });

  it("odmowa odczytu i tak nie renderuje wierszy widmo", async () => {
    // Połowa kontraktu, która DZIAŁA i której nie wolno stracić przy naprawie
    // powyższego: po odmowie lista jest pusta, a nie wypełniona resztkami.
    h.sessionsError = "odmowa RLS";
    const { container } = await mount();
    await settled();
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FILTR STATUSU
// ---------------------------------------------------------------------------

describe("/admin/community/qa - filtr statusu jest serwerowy", () => {
  it("zmiana filtra jedzie do WARSTWY DANYCH, a nie przesiewa tablicy na kliencie", async () => {
    // Lista jest ucięta na 200 wierszach w zapytaniu (`limit(200)`), więc filtr
    // policzony na kliencie pokazywałby „brak sesji zamkniętych" na bazie,
    // w której są - tylko dalej niż 200 pozycja.
    h.sessions = [session()];
    await mount();
    await screen.findByText("Sesja o zmyślonym akcie");
    expect(h.sessionCalls).toEqual(["all"]);

    await chooseInSelect(screen.getByRole("combobox"), t("adminCommunity.qa.closed"));

    await waitFor(() => expect(h.sessionCalls).toContain("closed"));
  });

  it("droplista startuje na „Wszystkie” - moderator nie traci sesji przez domyślny filtr", async () => {
    await mount();
    await settled();
    expect(screen.getByRole("combobox")).toHaveTextContent(t("adminCommunity.qa.all"));
  });
});

// ---------------------------------------------------------------------------
// PRZEJŚCIA STATUSU SESJI
// ---------------------------------------------------------------------------

describe("/admin/community/qa - przejścia statusu sesji", () => {
  it("wiersz oferuje TYLKO przejścia sensowne dla swojego statusu", async () => {
    // Przycisk oferujący przejście, którego workflow nie przewiduje, kończy się
    // odmową bazy - panel kłamałby o tym, co da się zrobić.
    h.sessions = [
      session({ id: "s-draft", slug: "s-draft", title_pl: "Sesja robocza", status: "draft" }),
      session({ id: "s-open", slug: "s-open", title_pl: "Sesja otwarta", status: "open" }),
      session({
        id: "s-closed",
        slug: "s-closed",
        title_pl: "Sesja zamknięta",
        status: "closed",
      }),
    ];
    await mount();
    await screen.findByText("Sesja robocza");

    const draft = within(sessionRow("Sesja robocza"));
    expect(draft.getByTitle(t("adminCommunity.qa.schedule"))).toBeInTheDocument();
    expect(draft.getByTitle(t("adminCommunity.qa.open2"))).toBeInTheDocument();
    expect(draft.getByTitle(t("adminCommunity.qa.close"))).toBeInTheDocument();
    expect(draft.queryByTitle(t("adminCommunity.qa.startAnswering"))).toBeNull();
    expect(draft.queryByTitle(t("adminCommunity.qa.reopenAsDraft"))).toBeNull();

    const open = within(sessionRow("Sesja otwarta"));
    expect(open.getByTitle(t("adminCommunity.qa.startAnswering"))).toBeInTheDocument();
    expect(open.queryByTitle(t("adminCommunity.qa.schedule"))).toBeNull();

    const closed = within(sessionRow("Sesja zamknięta"));
    expect(closed.queryByTitle(t("adminCommunity.qa.close"))).toBeNull();
    expect(closed.getByTitle(t("adminCommunity.qa.reopenAsDraft"))).toBeInTheDocument();
  });

  it("zaplanowanie sesji zapisuje status `scheduled` i unieważnia OBA liczniki", async () => {
    h.sessions = [session({ status: "draft" })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await screen.findByText("Sesja o zmyślonym akcie");

    fireEvent.click(
      within(sessionRow("Sesja o zmyślonym akcie")).getByTitle(t("adminCommunity.qa.schedule")),
    );

    await waitFor(() =>
      expect(h.updates).toEqual([{ id: "sesja-1", patch: { status: "scheduled" } }]),
    );
    // Bez unieważnienia listy wiersz zostaje w starym statusie i moderator
    // klika drugi raz; bez unieważnienia statystyk kafelek „otwarte sesje"
    // na przeglądzie społeczności kłamie do końca `staleTime`.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-qa-sessions"] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-community-stats"] });
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminCommunity.qa.updated"),
      action: undefined,
    });
  });

  it("otwarcie, rozpoczęcie odpowiadania i zamknięcie zapisują swoje statusy", async () => {
    h.sessions = [
      session({ id: "s-draft", slug: "s-draft", title_pl: "Sesja robocza", status: "draft" }),
      session({ id: "s-open", slug: "s-open", title_pl: "Sesja otwarta", status: "open" }),
    ];
    await mount();
    await screen.findByText("Sesja robocza");

    fireEvent.click(within(sessionRow("Sesja robocza")).getByTitle(t("adminCommunity.qa.open2")));
    fireEvent.click(
      within(sessionRow("Sesja otwarta")).getByTitle(t("adminCommunity.qa.startAnswering")),
    );
    fireEvent.click(within(sessionRow("Sesja otwarta")).getByTitle(t("adminCommunity.qa.close")));

    await waitFor(() => expect(h.updates).toHaveLength(3));
    expect(h.updates).toEqual([
      { id: "s-draft", patch: { status: "open" } },
      { id: "s-open", patch: { status: "answering" } },
      { id: "s-open", patch: { status: "closed" } },
    ]);
  });

  it("sesja zamknięta wraca do szkicu - to czyni zamknięcie odwracalnym", async () => {
    // Zamknięcie jest jednoklikowe ŚWIADOMIE: akcja odwrotna stoi w tym samym
    // wierszu. Ten test przybija tę własność - bez niej „to odwracalne" byłoby
    // założeniem, a nie faktem o interfejsie.
    h.sessions = [session({ status: "closed" })];
    await mount();
    await screen.findByText("Sesja o zmyślonym akcie");

    fireEvent.click(
      within(sessionRow("Sesja o zmyślonym akcie")).getByTitle(
        t("adminCommunity.qa.reopenAsDraft"),
      ),
    );

    await waitFor(() => expect(h.updates).toEqual([{ id: "sesja-1", patch: { status: "draft" } }]));
  });

  it("odmowa bazy kończy się toastem błędu, nie ciszą", async () => {
    h.sessions = [session({ status: "draft" })];
    h.updateFails = true;
    await mount();
    await screen.findByText("Sesja o zmyślonym akcie");

    fireEvent.click(
      within(sessionRow("Sesja o zmyślonym akcie")).getByTitle(t("adminCommunity.qa.schedule")),
    );

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.qa.failed"),
        action: undefined,
      }),
    );
    expect(h.toasts.filter((toast) => toast.kind === "success")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PUBLIKACJA PODSUMOWANIA - jedyna operacja bez cofnięcia na tym ekranie
// ---------------------------------------------------------------------------

describe("/admin/community/qa - podsumowanie sesji jako treść wymaga potwierdzenia", () => {
  const answering = () => session({ status: "answering", title_pl: "Sesja w odpowiadaniu" });

  it("przycisk podsumowania stoi TYLKO przy sesji answering albo closed", async () => {
    // Podsumowanie kompiluje ODPOWIEDZIANE pytania. Przy sesji roboczej nie ma
    // czego kompilować, więc przycisk byłby zaproszeniem do błędu RPC.
    h.sessions = [
      session({ id: "s-draft", slug: "s-draft", title_pl: "Sesja robocza", status: "draft" }),
      session({
        id: "s-ans",
        slug: "s-ans",
        title_pl: "Sesja w odpowiadaniu",
        status: "answering",
      }),
      session({ id: "s-cl", slug: "s-cl", title_pl: "Sesja zamknięta", status: "closed" }),
    ];
    await mount();
    await screen.findByText("Sesja robocza");

    expect(
      within(sessionRow("Sesja robocza")).queryByTitle(t("adminCommunity.qa.recapAsContent")),
    ).toBeNull();
    expect(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    ).toBeInTheDocument();
    expect(
      within(sessionRow("Sesja zamknięta")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    ).toBeInTheDocument();
  });

  it("klik w przycisk TYLKO pyta - publikacja nie startuje z jednego kliknięcia", async () => {
    h.sessions = [answering()];
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");

    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );

    expect(
      await screen.findByText(t("adminCommunity.qa.sessionRecapAsContent")),
    ).toBeInTheDocument();
    // Okno mówi WPROST, co powstanie i w jakim porządku.
    expect(screen.getByText(t("adminCommunity.qa.answeredQuestionsOrderedBy"))).toBeInTheDocument();
    expect(h.summaryCalls).toEqual([]);
  });

  it("anulowanie zamyka pytanie i NIE publikuje niczego", async () => {
    h.sessions = [answering()];
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    await screen.findByText(t("adminCommunity.qa.sessionRecapAsContent"));

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.qa.cancel") }));

    await waitFor(() =>
      expect(screen.queryByText(t("adminCommunity.qa.sessionRecapAsContent"))).toBeNull(),
    );
    expect(h.summaryCalls).toEqual([]);
  });

  it("„Utwórz szkic” i „Opublikuj od razu” to DWA różne wywołania RPC", async () => {
    // Ten podział jest treścią, nie estetyką: szkic trafia do kolejki
    // redakcyjnej, publikacja wypuszcza treść na zewnątrz i powiadamia autorów
    // pytań. Jeden przycisk dla obu byłby pułapką.
    h.sessions = [answering()];
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminCommunity.qa.createDraft") }),
    );

    await waitFor(() => expect(h.summaryCalls).toEqual([{ sessionId: "sesja-1", publish: false }]));
  });

  it("publikacja woła RPC z `publish: true`, unieważnia listę i mówi, ILE pytań weszło", async () => {
    h.sessions = [answering()];
    h.summaryResult = {
      post_id: "post-zmyslony-1",
      slug: "podsumowanie-sesji-testowej",
      status: "published",
      questions: 3,
    };
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(await screen.findByRole("button", { name: t("adminCommunity.qa.publishNow") }));

    await waitFor(() => expect(h.summaryCalls).toEqual([{ sessionId: "sesja-1", publish: true }]));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-qa-sessions"] }),
    );
    // Liczba jedzie przez formy mnogie - „3 pytania", nie surowy klucz.
    const oczekiwany = t("adminCommunity.qa.recapPublished", { count: 3 });
    await waitFor(() => expect(h.toasts.map((toast) => toast.text)).toContain(oczekiwany));
    expect(oczekiwany).toContain("3");
    // Okno znika po wykonaniu - inaczej operator opublikowałby drugi raz.
    await waitFor(() =>
      expect(screen.queryByText(t("adminCommunity.qa.sessionRecapAsContent"))).toBeNull(),
    );
  });

  it("szkic melduje się INNYM komunikatem niż publikacja - to różne skutki", async () => {
    h.sessions = [answering()];
    h.summaryResult = {
      post_id: "post-zmyslony-1",
      slug: "podsumowanie-sesji-testowej",
      status: "draft",
      questions: 1,
    };
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminCommunity.qa.createDraft") }),
    );

    const oczekiwany = t("adminCommunity.qa.recapDraftCreated", { count: 1 });
    await waitFor(() => expect(h.toasts.map((toast) => toast.text)).toContain(oczekiwany));
    expect(h.toasts.map((toast) => toast.text)).not.toContain(
      t("adminCommunity.qa.recapPublished", { count: 1 }),
    );
  });

  it("toast prowadzi do EDYTORA powstałego wpisu - pod slugiem zwróconym przez RPC", async () => {
    // Bez tej akcji operator zostaje z komunikatem „utworzono" i musi sam
    // znaleźć wpis wśród setek szkiców.
    h.sessions = [answering()];
    h.summaryResult = {
      post_id: "post-zmyslony-1",
      slug: "podsumowanie-sesji-testowej",
      status: "draft",
      questions: 2,
    };
    const { currentPath } = await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminCommunity.qa.createDraft") }),
    );

    await waitFor(() => expect(h.toasts).toHaveLength(1));
    const action = h.toasts[0].action;
    if (!action) throw new Error("test: toast podsumowania nie niesie akcji do edytora");
    expect(action.label).toBe(t("adminCommunity.qa.openEditor"));

    action.onClick();
    await waitFor(() => expect(currentPath()).toBe("/admin/posts/podsumowanie-sesji-testowej"));
  });

  it("brak odpowiedzianych pytań tłumaczy SIĘ, zamiast pokazywać błąd bazy", async () => {
    // RPC rzuca `qa: no answered questions`. Surowy komunikat z bazy nie mówi
    // operatorowi, co ma zrobić - a rozwiązanie jest proste i jest w zdaniu.
    h.sessions = [answering()];
    h.summaryError = "qa: no answered questions";
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(await screen.findByRole("button", { name: t("adminCommunity.qa.publishNow") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.qa.noAnsweredQuestionsYet"),
        action: undefined,
      }),
    );
  });

  it("odmowa workflow redakcyjnego wskazuje WYJŚCIE: szkic zamiast publikacji", async () => {
    // `can_publish_content` przepuszcza admina; edytor i gospodarz sesji mogą
    // utworzyć szkic. Komunikat musi nazwać tę drugą drogę, bo ona jest tuż
    // obok - w tym samym oknie.
    h.sessions = [answering()];
    h.summaryError = "qa: publish requires editorial role";
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(await screen.findByRole("button", { name: t("adminCommunity.qa.publishNow") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.qa.publishingRequiresAdminRole"),
        action: undefined,
      }),
    );
  });

  it("nieznana awaria dostaje komunikat ogólny - nie surowy tekst wyjątku", async () => {
    h.sessions = [answering()];
    h.summaryError = "cokolwiek innego z bazy";
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    fireEvent.click(await screen.findByRole("button", { name: t("adminCommunity.qa.publishNow") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.qa.couldNotBuildRecap"),
        action: undefined,
      }),
    );
    expect(h.toasts.map((toast) => toast.text)).not.toContain("cokolwiek innego z bazy");
  });

  it("w trakcie budowania podsumowania WSZYSTKIE trzy przyciski są zablokowane", async () => {
    // Dwa kliknięcia to dwa przebiegi RPC na tej samej sesji. Blokada obejmuje
    // też „Anuluj" - zamknięcie okna w połowie zostawiłoby operatora bez
    // informacji, czy wpis powstał.
    h.sessions = [answering()];
    h.summaryHolds = true;
    await mount();
    await screen.findByText("Sesja w odpowiadaniu");
    fireEvent.click(
      within(sessionRow("Sesja w odpowiadaniu")).getByTitle(t("adminCommunity.qa.recapAsContent")),
    );
    const publish = await screen.findByRole("button", { name: t("adminCommunity.qa.publishNow") });
    fireEvent.click(publish);

    await waitFor(() => expect(publish).toBeDisabled());
    expect(screen.getByRole("button", { name: t("adminCommunity.qa.cancel") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("adminCommunity.qa.createDraft") })).toBeDisabled();
    fireEvent.click(publish);
    expect(h.summaryCalls).toHaveLength(1);

    const release = h.releaseSummary;
    if (!release) throw new Error("test: publikacja nie wystartowała, nie ma czego zwolnić");
    release();
    await waitFor(() => expect(h.toasts.length).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// MODERACJA PYTAŃ
// ---------------------------------------------------------------------------

describe("/admin/community/qa - drill do pytań sesji", () => {
  beforeEach(() => {
    h.sessions = [session({ status: "open" })];
  });

  it("klik w wiersz pyta bazę o pytania TEJ sesji, nie o wszystkie", async () => {
    h.questions = [question()];
    await mount();
    await openQuestions();

    expect(h.questionCalls).toEqual([{ sessionId: "sesja-1", status: "all" }]);
    expect(
      await screen.findByText("Zmyślone pytanie o wymyślony przepis przejściowy."),
    ).toBeInTheDocument();
  });

  it("nagłówek okna niesie tytuł i status sesji - operator wie, co moderuje", async () => {
    await mount();
    await openQuestions();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Sesja o zmyślonym akcie/)).toBeInTheDocument();
    expect(within(dialog).getByText("open")).toBeInTheDocument();
  });

  it("w trakcie pobierania pytań mówi, że ładuje", async () => {
    h.questionsHang = true;
    await mount();
    await openQuestions();
    expect(await screen.findByText(t("adminCommunity.qa.loading"))).toBeInTheDocument();
    expect(screen.queryByText(t("adminCommunity.qa.noQuestions"))).toBeNull();
  });

  it("sesja bez pytań mówi to wprost", async () => {
    await mount();
    await openQuestions();
    expect(await screen.findByText(t("adminCommunity.qa.noQuestions"))).toBeInTheDocument();
  });

  it("filtr statusu pytań też jedzie do bazy", async () => {
    // Lista pytań jest ucięta na 300 wierszach - przesiew na kliencie gubiłby
    // pytania oczekujące w sesji z długim ogonem odrzuconych.
    h.questions = [question()];
    await mount();
    await openQuestions();
    const dialog = await screen.findByRole("dialog");

    await chooseInSelect(within(dialog).getByRole("combobox"), t("adminCommunity.qa.pending"));

    await waitFor(() =>
      expect(h.questionCalls).toContainEqual({ sessionId: "sesja-1", status: "pending" }),
    );
  });

  it("zamknięcie okna wraca do listy sesji", async () => {
    await mount();
    await openQuestions();
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(t("adminCommunity.qa.qSessionsClickOne"))).toBeInTheDocument();
  });
});

describe("/admin/community/qa - moderacja pojedynczego pytania", () => {
  beforeEach(() => {
    h.sessions = [session({ status: "open" })];
  });

  it("zatwierdzenie i odrzucenie zapisują swój status z identyfikatorem pytania", async () => {
    h.questions = [question({ id: "pytanie-do-oceny" })];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));

    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.approve") }));
    await waitFor(() =>
      expect(h.moderations).toContainEqual({
        id: "pytanie-do-oceny",
        status: "approved",
        answer: undefined,
      }),
    );

    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.reject") }));
    await waitFor(() =>
      expect(h.moderations).toContainEqual({
        id: "pytanie-do-oceny",
        status: "rejected",
        answer: undefined,
      }),
    );
  });

  it("panel nie oferuje statusu, w którym pytanie już jest", async () => {
    // Ponowne zatwierdzenie zatwierdzonego to pusty zapis do bazy - i sygnał
    // dla moderatora, że stan karty nic nie znaczy.
    h.questions = [
      question({ id: "p-appr", status: "approved", body: "Pytanie już zatwierdzone." }),
      question({ id: "p-rej", status: "rejected", body: "Pytanie już odrzucone." }),
    ];
    await mount();
    await openQuestions();
    await screen.findByText("Pytanie już zatwierdzone.");

    const approved = within(await questionCard("Pytanie już zatwierdzone."));
    expect(approved.queryByRole("button", { name: t("adminCommunity.qa.approve") })).toBeNull();
    expect(
      approved.getByRole("button", { name: t("adminCommunity.qa.reject") }),
    ).toBeInTheDocument();

    const rejected = within(await questionCard("Pytanie już odrzucone."));
    expect(rejected.queryByRole("button", { name: t("adminCommunity.qa.reject") })).toBeNull();
    // Akcja odwrotna JEST - to ona czyni odrzucenie odwracalnym jednym klikiem.
    expect(
      rejected.getByRole("button", { name: t("adminCommunity.qa.approve") }),
    ).toBeInTheDocument();
  });

  it("pole odpowiedzi jest zwinięte, dopóki moderator go nie rozwinie", async () => {
    h.questions = [question()];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    expect(card.queryByPlaceholderText(t("adminCommunity.qa.answerBody"))).toBeNull();

    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.answer2") }));

    expect(card.getByPlaceholderText(t("adminCommunity.qa.answerBody"))).toBeInTheDocument();
  });

  it("pusta odpowiedź NIE da się zapisać - `answered` bez treści to pusty status", async () => {
    h.questions = [question()];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.answer2") }));

    const save = card.getByRole("button", { name: t("adminCommunity.qa.saveAnswer") });
    expect(save).toBeDisabled();
    // Same białe znaki to nadal pustka - `answer.trim()` jest tu warunkiem sensu.
    fireEvent.change(card.getByPlaceholderText(t("adminCommunity.qa.answerBody")), {
      target: { value: "   " },
    });
    expect(save).toBeDisabled();
  });

  it("zapis odpowiedzi wysyła treść i status `answered`, unieważnia OBA liczniki", async () => {
    h.questions = [question({ id: "pytanie-do-odpowiedzi" })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.answer2") }));
    fireEvent.change(card.getByPlaceholderText(t("adminCommunity.qa.answerBody")), {
      target: { value: "Zmyślona odpowiedź redakcji na zmyślone pytanie." },
    });
    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.saveAnswer") }));

    await waitFor(() =>
      expect(h.moderations).toEqual([
        {
          id: "pytanie-do-odpowiedzi",
          status: "answered",
          answer: "Zmyślona odpowiedź redakcji na zmyślone pytanie.",
        },
      ]),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-qa-questions"] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-community-stats"] });
    expect(h.toasts).toContainEqual({
      kind: "success",
      text: t("adminCommunity.qa.saved"),
      action: undefined,
    });
  });

  it("istniejąca odpowiedź jest widoczna i wchodzi do pola jako punkt wyjścia", async () => {
    // Bez tego edycja odpowiedzi zaczyna się od pustki i moderator kasuje
    // poprzednią treść, nie wiedząc, że ją kasuje.
    h.questions = [
      question({
        status: "answered",
        answer_body: "Zmyślona odpowiedź opublikowana wcześniej.",
      }),
    ];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    expect(card.getByText(t("adminCommunity.qa.answer"))).toBeInTheDocument();
    expect(card.getByText("Zmyślona odpowiedź opublikowana wcześniej.")).toBeInTheDocument();

    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.answer2") }));
    expect(card.getByPlaceholderText(t("adminCommunity.qa.answerBody"))).toHaveValue(
      "Zmyślona odpowiedź opublikowana wcześniej.",
    );
  });

  it("odmowa bazy przy moderacji kończy się toastem błędu", async () => {
    h.questions = [question()];
    h.moderateFails = true;
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    fireEvent.click(card.getByRole("button", { name: t("adminCommunity.qa.approve") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.qa.failed"),
        action: undefined,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// ANONIMOWOŚĆ PYTAJĄCEGO
// ---------------------------------------------------------------------------

describe("/admin/community/qa - anonimowość pytającego (reguła Chatham House)", () => {
  beforeEach(() => {
    h.sessions = [session({ status: "open" })];
  });

  it("`user_id` NIE OPUSZCZA BAZY - ani w typie, ani w liście kolumn, ani w grancie", () => {
    // Trzy warstwy tej samej obietnicy, każda do zerwania osobno:
    //   (1) typ wiersza w panelu jest `Omit<..., "user_id">`,
    //   (2) zapytanie wylicza kolumny WPROST (`select("*")` na tej tabeli by
    //       się nie powiodło, bo grant kolumnowy jest odcięty),
    //   (3) grant w bazie nie wymienia `user_id`.
    const layer = read(DATA_LAYER);
    expect(layer).toMatch(
      /Omit<Database\["public"\]\["Tables"\]\["qa_questions"\]\["Row"\], "user_id">/,
    );
    const columns = layer.slice(layer.indexOf("const QA_QUESTION_COLUMNS"));
    expect(columns.slice(0, columns.indexOf(";"))).not.toContain("user_id");

    const sql = read(QA_MIGRATION);
    const grant = sql.slice(sql.indexOf("GRANT SELECT (id, tenant_id, session_id"));
    expect(grant.slice(0, grant.indexOf("TO anon, authenticated;"))).not.toContain("user_id");
  });

  it("pytanie anonimowe pokazuje „anonimowo”, a nie snapshot tożsamości", async () => {
    // Kluczowy przypadek: baza MOŻE mieć `author_display` z czasów sprzed
    // zmiany trybu, więc panel nie może go pokazać tylko dlatego, że kolumna
    // jest niepusta. Decyduje flaga, nie obecność danych.
    h.questions = [
      question({
        is_anonymous: true,
        author_display: "Zofia Przykładowska",
        body: "Zmyślone pytanie zadane anonimowo.",
      }),
    ];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie zadane anonimowo."));
    expect(card.getByText(t("adminCommunity.qa.anonymously"))).toBeInTheDocument();
    expect(card.queryByText("Zofia Przykładowska")).toBeNull();
  });

  it("pytanie podpisane pokazuje `author_display` - nazwę profilu, nie adres", async () => {
    h.questions = [question({ is_anonymous: false, author_display: "Zofia Przykładowska" })];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    expect(card.getByText("Zofia Przykładowska")).toBeInTheDocument();
    // Nigdzie w karcie nie ma adresu e-mail - `ask_qa_question` snapshotuje
    // nazwę profilu, nie login.
    expect(card.queryByText(/@example\.com/)).toBeNull();
  });

  it("brak nazwy przy pytaniu podpisanym daje „uczestnik”, a nie puste miejsce", async () => {
    h.questions = [question({ is_anonymous: false, author_display: null })];
    await mount();
    await openQuestions();
    const card = within(await questionCard("Zmyślone pytanie o wymyślony przepis przejściowy."));
    expect(card.getByText(t("adminCommunity.qa.participant"))).toBeInTheDocument();
  });

  it("w całym drzewie okna nie ma identyfikatora użytkownika", async () => {
    // Dowód negatywny na poziomie DOM: nawet gdyby ktoś dołożył `user_id` do
    // fixture, panel nie ma go gdzie wyrenderować - ale gdyby dołożył render,
    // ten test zapali się natychmiast.
    h.questions = [question({ is_anonymous: true, author_display: null })];
    await mount();
    await openQuestions();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent ?? "").not.toMatch(/user_id/);
    expect(dialog.innerHTML).not.toMatch(/host-zmyslony-1/);
  });
});

// ---------------------------------------------------------------------------
// KOLEJNOŚĆ - liczona po stronie serwera, nie przeliczana w panelu
// ---------------------------------------------------------------------------

describe("/admin/community/qa - kolejność jest serwerowa", () => {
  it("panel renderuje pytania w kolejności, w jakiej oddała je baza", async () => {
    // Fixture jest ustawiony PRZECIW każdemu naturalnemu porządkowi klienta:
    // pierwszy element jest najmłodszy i alfabetycznie ostatni. Gdyby panel
    // sortował cokolwiek u siebie, ta asercja padnie.
    h.sessions = [session({ status: "open" })];
    h.questions = [
      question({
        id: "p3",
        body: "Zeta - pytanie najmłodsze.",
        created_at: "2026-08-09T10:00:00.000Z",
      }),
      question({
        id: "p1",
        body: "Alfa - pytanie najstarsze.",
        created_at: "2026-08-01T10:00:00.000Z",
      }),
      question({
        id: "p2",
        body: "Beta - pytanie środkowe.",
        created_at: "2026-08-05T10:00:00.000Z",
      }),
    ];
    await mount();
    await openQuestions();
    await screen.findByText("Zeta - pytanie najmłodsze.");

    const dialog = await screen.findByRole("dialog");
    const rendered = [...dialog.querySelectorAll("p.text-sm")].map((node) => node.textContent);
    expect(rendered).toEqual([
      "Zeta - pytanie najmłodsze.",
      "Alfa - pytanie najstarsze.",
      "Beta - pytanie środkowe.",
    ]);
  });

  it("plik trasy nie zawiera ANI JEDNEGO sortowania ani przeliczania głosów", () => {
    const source = read(ROUTE_FILE);
    expect(source).not.toMatch(/\.sort\(/);
    expect(source).not.toMatch(/votes|is_priority|qa_priority/);
  });

  it("porządek publiczny (priorytet Pro > głosy > starszeństwo) mieszka w RPC", () => {
    // Tu jest sedno rozdziału warstw: panel moderacji pokazuje KOLEJKĘ
    // MODERACYJNĄ (najświeższe pierwsze, `order("created_at", desc)`
    // w warstwie danych), a porządek, w którym publiczność widzi pytania,
    // liczy baza - z priorytetem warstwy Pro, którego klient nawet nie zna,
    // bo `user_id` do niego nie dociera.
    const sql = read(QA_LIST_MIGRATION);
    expect(sql).toMatch(
      /ORDER BY\s+public\.user_has_tier_feature\(q\.user_id, 'qa_priority'\) DESC/,
    );
    expect(sql).toMatch(/COALESCE\(v\.votes, 0\) DESC/);
    expect(sql).toMatch(/q\.created_at ASC/);

    const layer = read(DATA_LAYER);
    expect(layer).toContain('.order("created_at", { ascending: false })');
  });

  it("porządek podsumowania (głosy > starszeństwo) też liczy baza, nie panel", () => {
    expect(read(QA_SUMMARY_MIGRATION)).toMatch(/ORDER BY v\.votes DESC, q\.created_at ASC/);
    // Okno publikacji MÓWI o tym operatorowi - to jego jedyne źródło wiedzy
    // o tym, czego się spodziewać we wpisie.
    expect(t("adminCommunity.qa.answeredQuestionsOrderedBy")).toContain("głosów");
  });
});

// ---------------------------------------------------------------------------
// NOWA SESJA
// ---------------------------------------------------------------------------

/** Wypełnia formularz nowej sesji, otwierając go, jeśli trzeba. */
async function fillNewSessionForm(values: {
  slug: string;
  titlePl: string;
  titleEn: string;
}): Promise<HTMLElement> {
  if (!screen.queryByText(t("adminCommunity.qa.newQSession"))) {
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.qa.newSession") }));
    await screen.findByText(t("adminCommunity.qa.newQSession"));
  }
  const dialog = screen.getByRole("dialog");
  const boxes = within(dialog).getAllByRole("textbox");
  // STRAŻNIK, nie rzutowanie: pola formularza nie mają etykiet powiązanych
  // `htmlFor` (patrz `it.fails` o dostępności formularza), więc jedyne stabilne
  // namierzenie to kolejność - a ta wymaga sprawdzenia w runtime.
  if (boxes.length !== 5) {
    throw new Error(`test: formularz nowej sesji ma ${boxes.length} pól tekstowych zamiast pięciu`);
  }
  fireEvent.change(boxes[0], { target: { value: values.slug } });
  fireEvent.change(boxes[1], { target: { value: values.titlePl } });
  fireEvent.change(boxes[2], { target: { value: values.titleEn } });
  return dialog;
}

describe("/admin/community/qa - zakładanie nowej sesji", () => {
  it("przycisk otwiera formularz z kompletem pól dwujęzycznych", async () => {
    await mount();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.qa.newSession") }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(t("adminCommunity.qa.newQSession"))).toBeInTheDocument();
    for (const key of [
      "titlePl",
      "titleEn",
      "introPl",
      "introEn",
      "opensAt",
      "closesAt",
    ] as const) {
      expect(
        within(dialog).getByText(t(`adminCommunity.qa.${key}`)),
        `brak etykiety ${key}`,
      ).toBeInTheDocument();
    }
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(5);
  });

  it("slug jest sanityzowany w locie - adres sesji nie przyjmie spacji ani wielkich liter", async () => {
    // Slug wchodzi do CHECK-a bazy (`^[a-z0-9-]{3,120}$`), więc bez sanityzacji
    // formularz pozwalałby wysłać coś, co baza i tak odrzuci.
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({ slug: "", titlePl: "", titleEn: "" });
    const slug = within(dialog).getAllByRole("textbox")[0];
    fireEvent.change(slug, { target: { value: "Zmyślony AKT 2026" } });
    expect(slug).toHaveValue("zmy-lony-akt-2026");
  });

  it("„Utwórz” jest zablokowane, dopóki brakuje sluga albo któregoś tytułu", async () => {
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({ slug: "", titlePl: "", titleEn: "" });
    const create = within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") });
    expect(create).toBeDisabled();

    const boxes = within(dialog).getAllByRole("textbox");
    fireEvent.change(boxes[0], { target: { value: "ab" } });
    expect(create).toBeDisabled();
    fireEvent.change(boxes[1], { target: { value: "Tytuł PL" } });
    expect(create).toBeDisabled();
    // Dopiero KOMPLET dwujęzyczny odblokowuje zapis - jednojęzyczna sesja
    // renderowałaby pustkę na drugiej wersji serwisu.
    fireEvent.change(boxes[2], { target: { value: "Title EN" } });
    expect(create).toBeEnabled();
  });

  it("zapis przycina białe znaki, a puste wstępy wysyła jako `undefined`", async () => {
    // Różnica między `""` a `undefined` jest tu realna: pusty łańcuch wpisałby
    // do bazy pusty wstęp, a `undefined` zostawia kolumnę `NULL`, co strona
    // publiczna traktuje jako „brak wstępu" i nie renderuje pustego bloku.
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-o-niczym",
      titlePl: "  Tytuł z odstępami  ",
      titleEn: "  Title with spaces  ",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0]).toEqual({
      slug: "sesja-o-niczym",
      title_pl: "Tytuł z odstępami",
      title_en: "Title with spaces",
      intro_pl: undefined,
      intro_en: undefined,
      opens_at: null,
      closes_at: null,
      status: "draft",
    });
  });

  it("wypełnione wstępy i daty jadą do bazy - daty w ISO, nie w formacie pola", async () => {
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-z-datami",
      titlePl: "Tytuł",
      titleEn: "Title",
    });
    const boxes = within(dialog).getAllByRole("textbox");
    fireEvent.change(boxes[3], { target: { value: "Zmyślony wstęp po polsku." } });
    fireEvent.change(boxes[4], { target: { value: "Made-up intro in English." } });

    const dates = dialog.querySelectorAll('input[type="datetime-local"]');
    if (dates.length !== 2) throw new Error("test: formularz nie ma dwóch pól daty");
    fireEvent.change(dates[0], { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(dates[1], { target: { value: "2026-09-08T18:30" } });

    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    const payload = h.createCalls[0];
    expect(payload.intro_pl).toBe("Zmyślony wstęp po polsku.");
    expect(payload.intro_en).toBe("Made-up intro in English.");
    expect(payload.opens_at).toBe(new Date("2026-09-01T10:00").toISOString());
    expect(payload.closes_at).toBe(new Date("2026-09-08T18:30").toISOString());
  });

  it("status startowy da się wybrać, ale tylko z trzech przed-otwarciowych", async () => {
    // `answering` i `closed` nie mają sensu dla sesji, która jeszcze nie
    // istnieje - droplista nie może ich oferować.
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-zaplanowana",
      titlePl: "Tytuł",
      titleEn: "Title",
    });
    const status = within(dialog).getByRole("combobox");
    fireEvent.keyDown(status, { key: "ArrowDown" });
    await screen.findByRole("option", { name: t("adminCommunity.qa.draft2") });
    expect(screen.getAllByRole("option")).toHaveLength(3);
    fireEvent.click(screen.getByRole("option", { name: t("adminCommunity.qa.scheduled2") }));

    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") }));
    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    expect(h.createCalls[0].status).toBe("scheduled");
  });

  it("sukces melduje utworzenie, unieważnia listę, zamyka i CZYŚCI formularz", async () => {
    // Bez czyszczenia druga sesja startuje z danymi pierwszej i operator
    // zakłada duplikat pod nowym slugiem.
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mount(queryClient);
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-pierwsza",
      titlePl: "Tytuł pierwszy",
      titleEn: "First title",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") }));

    await waitFor(() => expect(h.createCalls).toHaveLength(1));
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "success",
        text: t("adminCommunity.qa.created"),
        action: undefined,
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-qa-sessions"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.qa.newSession") }));
    const reopened = await screen.findByRole("dialog");
    for (const box of within(reopened).getAllByRole("textbox")) {
      expect(box).toHaveValue("");
    }
  });

  it("anulowanie zamyka formularz i nie zakłada sesji", async () => {
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-porzucona",
      titlePl: "Tytuł",
      titleEn: "Title",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.cancel") }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.createCalls).toEqual([]);
  });

  it("odmowa bazy pokazuje JEJ komunikat - duplikat sluga da się poprawić", async () => {
    // Tu wyjątkowo pokazujemy tekst z bazy, bo niesie informację, której panel
    // nie zna: który CHECK albo który unikat odrzucił zapis.
    h.createError = "duplicate key value violates unique constraint";
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-duplikat",
      titlePl: "Tytuł",
      titleEn: "Title",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: "duplicate key value violates unique constraint",
        action: undefined,
      }),
    );
    // Okno ZOSTAJE otwarte - poprawka sluga nie wymaga wpisywania wszystkiego
    // od nowa.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("odmowa BEZ komunikatu i tak mówi „Błąd”, a nie pustym toastem", async () => {
    // PostgREST potrafi oddać błąd z pustym `message` (np. przy zerwanym
    // połączeniu). Pusty toast jest gorszy niż brak toastu: operator widzi
    // migające nic i zakłada, że zapis przeszedł.
    h.createError = "";
    await mount();
    await settled();
    const dialog = await fillNewSessionForm({
      slug: "sesja-bez-komunikatu",
      titlePl: "Tytuł",
      titleEn: "Title",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("adminCommunity.qa.create") }));

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("adminCommunity.qa.failed"),
        action: undefined,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// DWUJĘZYCZNOŚĆ
// ---------------------------------------------------------------------------

describe("/admin/community/qa - panel po angielsku", () => {
  const tEn = realT("en");

  it("tytuł sesji idzie z bliźniaczej kolumny EN - i w liście, i w oknie pytań", async () => {
    // Panel społeczności ma wersję angielską, a tytuły sesji leżą w dwóch
    // kolumnach. Gdyby `lang` był na sztywno „pl", redaktor anglojęzyczny
    // moderowałby sesję o tytule, którego nie rozumie - i nie wiedziałby, że
    // wersja EN w ogóle istnieje.
    h.sessions = [
      session({
        status: "open",
        title_pl: "Sesja o zmyślonym akcie",
        title_en: "Session on a made-up act",
      }),
    ];
    await i18n.changeLanguage("en");
    try {
      await mount();
      expect(await screen.findByText("Session on a made-up act")).toBeInTheDocument();
      expect(screen.queryByText("Sesja o zmyślonym akcie")).toBeNull();
      // Etykiety interfejsu też są angielskie - `lang` steruje treścią,
      // a słownik napisami; to dwie różne warstwy tego samego wyboru.
      expect(
        screen.getByRole("heading", { name: tEn("adminCommunity.qa.qSessions") }),
      ).toBeInTheDocument();

      await openQuestions("Session on a made-up act");
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/Session on a made-up act/)).toBeInTheDocument();
    } finally {
      // Przywrócenie języka jest warunkiem izolacji: instancja i18next jest
      // współdzielona przez cały plik.
      await i18n.changeLanguage("pl");
    }
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ
// ---------------------------------------------------------------------------

describe("/admin/community/qa - dostępność", () => {
  /** Widok główny z dwiema sesjami - komplet przycisków akcji w wierszach. */
  async function mountForAxe(): Promise<HTMLElement> {
    h.sessions = [
      session({ id: "s1", slug: "s1", title_pl: "Sesja robocza", status: "draft" }),
      session({ id: "s2", slug: "s2", title_pl: "Sesja zamknięta", status: "closed" }),
    ];
    const { container } = await mount();
    await screen.findByText("Sesja robocza");
    return container;
  }

  it("widok główny ma DOKŁADNIE JEDNO znane naruszenie axe - i ani jednego więcej", async () => {
    // To jest wersja ZIELONA i to ona pilnuje regresji: każde NOWE naruszenie
    // (przycisk ikonowy bez `title`, zła kolejność nagłówków, lista bez
    // semantyki) wywróci tę asercję, bo lista identyfikatorów musi się zgadzać
    // co do joty. Jedyny dopuszczony wpis jest opisany w `it.fails` niżej.
    const violations = await axeViolations(await mountForAxe());
    expect(
      violations.map((violation) => violation.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    // Jeden węzeł, nie pięć: ikonowe przyciski akcji w wierszach mają `title`
    // i axe je akceptuje. Gdyby ktoś dołożył szósty przycisk bez nazwy, ta
    // liczba wzrośnie i test padnie.
    expect(violations[0].nodes).toHaveLength(1);
    expect(violations[0].nodes[0].html).toContain('role="combobox"');
  });

  /**
   * ZŁAMANY KONTRAKT: droplista filtra statusu nie ma nazwy dostępnej.
   * `SelectTrigger` z `@/components/ui/select` renderuje `<button
   * role="combobox">`, a rola `combobox` w ARIA ma `nameFrom: author` - NIE
   * bierze nazwy z treści. Widoczne w środku „Wszystkie" jest więc dla
   * czytnika ekranu WARTOŚCIĄ, nie nazwą kontrolki: użytkownik słyszy
   * „Wszystkie, lista rozwijana" i nie wie, czego dotyczy filtr (statusu sesji?
   * języka? autora?). Na ekranie z drugą, identycznie wyglądającą droplistą
   * w oknie pytań to jest realna dwuznaczność.
   *
   * OCZEKIWANY KONTRAKT: `SelectTrigger` niesie `aria-label` z klucza i18n
   * (albo `aria-labelledby` wskazujące widoczną etykietę).
   *
   * Zapisane jako `it.fails`, bo naprawa wymaga zmiany pliku trasy i nowego
   * klucza i18n, a ten plik nie zmienia zachowania produkcyjnego. KONTROLA
   * DODATNIA stoi w teście wyżej: ta sama maszyneria axe przechodzi po całym
   * widoku i NIE znajduje niczego innego, więc `it.fails` nie jest efektem
   * zepsutego narzędzia.
   */
  it.fails("widok główny nie ma ŻADNYCH naruszeń axe", async () => {
    const violations = await axeViolations(await mountForAxe());
    expect(violations, summarize(violations)).toEqual([]);
  });
});
