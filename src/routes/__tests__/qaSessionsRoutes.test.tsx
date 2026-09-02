// Trasy PUBLICZNE `/qa` (lista sesji) i `/qa/$slug` (sesja + pytania).
// Do dziś: `/qa` 0 z 33 linii, `/qa/$slug` 0 z 82 linii i 0 z 22 funkcji.
//
// CO DOWODZI TEN PLIK.
//
// Sesja Q&A jest treścią o najdłuższym życiu w tym module: po zamknięciu
// zostaje w indeksie jako strona z pytaniami i odpowiedziami (markup
// `QAPage`), a wchodzi się na nią wprost z wyszukiwarki. Render samego
// komponentu mija cztery warstwy, w których to się rozstrzyga: loader
// (istnienie adresu i zasiew treści dla crawlera), `head()` (JSON-LD i
// metadane, składane POZA drzewem Reacta), `notFound()` (czy literówka
// w adresie to 404, czy strona z komunikatem awarii pod HTTP 200) i mutacje
// (pytanie idzie WYŁĄCZNIE przez utwardzone RPC).
//
// SZEŚĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NIEISTNIEJĄCY SLUG TO 404, NIE PUSTA STRONA. To była realna wada
//      `/qa/$slug`: loader oddawał `null`, więc każdy literówkowy i każdy
//      usunięty adres wychodził z HTTP 200 i komunikatem
//      `community.common.loadError` - nierozróżnialnym od awarii backendu
//      i zostającym w indeksie jako strona bez treści. NAPRAWIONE.
//   2. AWARIA BACKENDU TO NIE 404. Odwrotny błąd jest droższy: 404 przy
//      blipie bazy WYPISUJE z indeksu działające sesje. Obie gałęzie mają
//      poniżej osobne testy - jedna bez drugiej nie dowodzi niczego.
//   3. PYTANIE IDZIE PRZEZ RPC, NIGDY INSERTEM. `ask_qa_question` trzyma
//      status sesji, limit 5/h i sanitizowany `author_display` (nigdy pełny
//      e-mail). Insert z klienta omijałby wszystkie trzy.
//   4. ANONIMOWOŚĆ JEST DOTRZYMANA. Pytanie oznaczone jako anonimowe nie
//      może pokazać nazwy autora ani w widoku, ani w danych strukturalnych.
//   5. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH.
//   6. SESJA INNEGO OBSZARU ROBOCZEGO NIE POJAWIA SIĘ NA TYM HOŚCIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/community/publicQueries.ts` biegnie tu PRAWDZIWY (atrapowany
//   jest wyłącznie klient PostgREST), więc kolumny, filtry i nazwy RPC są
//   tymi z produkcji.
// - SERWEROWYCH GWARANCJI RPC (rate limit, kolejność priorytet Pro > głosy >
//   starszeństwo, sanityzacja `author_display`): to asercje pgTAP. Tutaj
//   dowodzimy WYŁĄCZNIE tego, co trasa wysyła i co robi z odpowiedzią.
// - BRAKU `<Outlet/>` W `/qa`: ten dług jest ZAMROŻONY jawnie w
//   `src/routes/__tests__/parentRoutesRenderOutlet.gate.test.ts`
//   (`KNOWN_BROKEN` zawiera `src/routes/qa`). Nie dublujemy tamtej bramki -
//   ten plik montuje `/qa/$slug` jako trasę samodzielną, czyli sprawdza jej
//   WŁASNY kontrakt (loader, `head()`, 404, mutacje), który wykonuje się
//   niezależnie od tego, czy rodzic renderuje dziecko.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `qa_sessions` ze WSZYSTKICH obszarów roboczych. */
  sessions: [] as Record<string, unknown>[],
  /** Pytania zwracane przez RPC `list_qa_questions`. */
  questions: [] as Record<string, unknown>[],
  /** Wiersze `posts` - teaser opublikowanego podsumowania sesji. */
  posts: [] as Record<string, unknown>[],
  /** Wiersze `site_settings` (klucz -> wartość) widoczne publicznie. */
  settings: {} as Record<string, unknown>,
  /** Tenant PRZEGLĄDANEJ domeny - atrapa polityki `public_tenant_id()`. */
  tenantId: "tenant-a",
  /** Tabele i RPC, których wywołanie ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Zalogowany użytkownik albo `null`. */
  userId: null as string | null,
  /** Etykiety odczytów W KOLEJNOŚCI - PODSTAWA POMIARU zapytań (blok N5). */
  reads: [] as string[],
  /** Argumenty RPC `ask_qa_question` - dowód, co trasa wysyła do bazy. */
  asked: [] as Record<string, unknown>[],
  /** Wiersze wstawione do `qa_question_votes` (głos na pytanie). */
  voteInserts: [] as Record<string, unknown>[],
  /** Komunikat błędu, jakim ma odpowiedzieć insert głosu (albo `null`). */
  voteError: null as string | null,
  /** Komunikat błędu, jakim ma odpowiedzieć RPC pytania (albo `null`). */
  askError: null as string | null,
  /** Komunikaty pokazane przez `toast.error` / `toast.success`. */
  errorToasts: [] as string[],
  successToasts: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/qa",
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail, pgError } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();

  /** Wszystkie pary `.eq(kolumna, wartość)` łańcucha - `argsOf` daje pierwszą. */
  function filters(calls: ReadonlyArray<{ method: string; args: ReadonlyArray<unknown> }>) {
    const out = new Map<string, unknown>();
    for (const call of calls) {
      if (call.method === "eq" && typeof call.args[0] === "string") {
        out.set(call.args[0], call.args[1]);
      }
    }
    return out;
  }

  stub.setResponse("site_settings", () => {
    h.reads.push("site_settings");
    if (h.broken.has("site_settings")) return fail("test: tabela site_settings niedostepna");
    return ok(Object.entries(h.settings).map(([key, value]) => ({ key, value })));
  });

  stub.setResponse("qa_sessions", (chain) => {
    if (h.broken.has("qa_sessions")) return fail("test: tabela qa_sessions niedostepna");
    // Polityka publiczna: tylko wiersze tenanta przeglądanej domeny.
    const visible = h.sessions.filter((row) => row.tenant_id === h.tenantId);
    const eq = filters(chain.calls);
    if (eq.has("slug")) {
      h.reads.push("qa_sessions:slug");
      return ok(visible.find((row) => row.slug === eq.get("slug")) ?? null);
    }
    h.reads.push("qa_sessions:list");
    return ok(visible.filter((row) => row.status !== "draft"));
  });

  stub.setResponse("posts", (chain) => {
    h.reads.push("posts:summary");
    if (h.broken.has("posts")) return fail("test: tabela posts niedostepna");
    const eq = filters(chain.calls);
    return ok(h.posts.find((row) => row.id === eq.get("id")) ?? null);
  });

  stub.setResponse("qa_question_votes", (chain) => {
    const insert = chain.calls.find((call) => call.method === "insert");
    const row = insert?.args[0];
    if (row && typeof row === "object") h.voteInserts.push(row as Record<string, unknown>);
    return h.voteError === null ? ok(null) : fail(h.voteError);
  });

  return {
    supabase: {
      from: stub.from,
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name === "list_qa_questions") {
          h.reads.push("rpc:list_qa_questions");
          if (h.broken.has("list_qa_questions")) {
            return { data: null, error: pgError("test: RPC pytan niedostepny") };
          }
          return { data: h.questions, error: null };
        }
        if (name === "ask_qa_question") {
          h.asked.push(args ?? {});
          // `pgError`, nie goły obiekt: `PostgrestError` w supabase-js DZIEDZICZY
          // po `Error`, a mapowanie komunikatów w trasie stoi na
          // `e instanceof Error`. Atrapa z gołym obiektem „dowodziłaby", że
          // mapowanie nie działa, choć w produkcji działa.
          if (h.askError !== null) return { data: null, error: pgError(h.askError) };
          return { data: "question-new", error: null };
        }
        if (name === "public_tenant_id") return { data: h.tenantId, error: null };
        return { data: null, error: null };
      },
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.userId === null ? null : { user: { id: h.userId } },
    user: h.userId === null ? null : { id: h.userId },
    roles: [],
    tenantId: null,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));

// Bez tej atrapy mapa `site_settings` żyje w module-owym cache TTL i przecieka
// MIĘDZY testami - pomiar liczby zapytań (blok N5) mierzyłby kolejność testów,
// nie zachowanie trasy.
vi.mock("@/lib/ssrCache", () => ({
  // Przecinek po parametrze typu jest KONIECZNY w `.tsx`.
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => void h.errorToasts.push(message),
    success: (message: string) => void h.successToasts.push(message),
  },
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead } from "@/test/routeHarness";
import type { RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { Route as QaListRoute } from "@/routes/qa";
import { Route as QaSessionRoute } from "@/routes/qa.$slug";

const LIST_PATH = "/qa";
const DETAIL_PATH = "/qa/$slug";
const SLUG = "energia-2026";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SUMMARY_POST_ID = "33333333-3333-4333-8333-333333333333";

// ── fixtures (RODO: wszystkie pytania, sesje i nazwy autorów są ZMYŚLONE) ───

function session(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    tenant_id: "tenant-a",
    slug: SLUG,
    title_pl: "Pytania o energetykę 2026",
    title_en: "Energy questions 2026",
    intro_pl: "Pytania do zespołu energetycznego przed szczytem.",
    intro_en: "Questions for the energy team ahead of the summit.",
    status: "open",
    opens_at: "2026-04-01T10:00:00.000Z",
    closes_at: "2026-04-10T10:00:00.000Z",
    host_user_id: null,
    post_id: null,
    ...patch,
  };
}

function question(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "q1",
    session_id: SESSION_ID,
    author_display: "Marek z Poznania",
    is_anonymous: false,
    body: "Czy magazyny energii zdążą przed zimą?",
    status: "approved",
    answer_body: null,
    answered_at: null,
    created_at: "2026-04-02T09:00:00.000Z",
    votes: 4,
    is_priority: false,
    my_vote: false,
    ...patch,
  };
}

function modules(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { [COMMUNITY_MODULES_KEY]: { qa_enabled: true, polls_enabled: true, ...patch } };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Loader listy `/qa` jako funkcja - STRAŻNIK, nie rzutowanie. */
function listLoader(): (ctx: {
  context: { queryClient: QueryClient };
}) => Promise<{ sessions: unknown[] }> {
  const loader: unknown = QaListRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa /qa nie ma loadera");
  return loader as (ctx: {
    context: { queryClient: QueryClient };
  }) => Promise<{ sessions: unknown[] }>;
}

async function mountList(queryClient?: QueryClient) {
  return renderRoute({
    route: QaListRoute,
    path: LIST_PATH,
    initialEntry: LIST_PATH,
    queryClient,
  });
}

async function mountSession(slug = SLUG, queryClient?: QueryClient) {
  return renderRoute({
    route: QaSessionRoute,
    path: DETAIL_PATH,
    initialEntry: `/qa/${slug}`,
    queryClient,
  });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/**
 * Sparsowane węzły JSON-LD z `head()`. Surowy string nie wystarcza: dowód
 * dotyczy STRUKTURY (typ węzła, liczba pytań, brak nazwy anonima), a asercja
 * na podciągu przechodziłaby też na fragmencie innego węzła.
 */
function jsonLdNodes(head: RouteHeadResult): Record<string, unknown>[] {
  return (head.scripts ?? [])
    .filter((script) => script.type === "application/ld+json")
    .map((script) => {
      const raw = script.children;
      if (typeof raw !== "string") throw new Error("test: wezel JSON-LD bez tresci");
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("test: wezel JSON-LD nie jest obiektem");
      }
      return parsed as Record<string, unknown>;
    });
}

/** Węzeł JSON-LD o danym `@type` - z twardym błędem, gdy go nie ma. */
function jsonLdOfType(head: RouteHeadResult, type: string): Record<string, unknown> {
  const found = jsonLdNodes(head).find((node) => node["@type"] === type);
  if (!found) throw new Error(`test: brak wezla JSON-LD "@type": "${type}"`);
  return found;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.sessions = [session()];
  h.questions = [question()];
  h.posts = [];
  h.settings = modules();
  h.tenantId = "tenant-a";
  h.broken = new Set<string>();
  h.userId = null;
  h.reads = [];
  h.asked = [];
  h.voteInserts = [];
  h.voteError = null;
  h.askError = null;
  h.errorToasts = [];
  h.successToasts = [];
  h.requestUrl = "https://nes.example.org/qa";
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /qa - lista sesji", () => {
  it("pokazuje tytuł sesji, plakietkę statusu i link do szczegółów", async () => {
    // Link jest jedyną drogą z listy do sesji. Plakietka statusu decyduje,
    // czy czytelnik w ogóle klika (zamknięta sesja to archiwum, nie zaproszenie).
    await mountList();

    expect(screen.getByRole("heading", { level: 1, name: "Q&A" })).toBeInTheDocument();
    // Lista jest zasiana loaderem, więc karta jest w PIERWSZYM renderze -
    // to jest dowód, że markup schodzi z serwera, a nie dojeżdża po hydratacji.
    expect(screen.getByText("Otwarta sesja")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pytania o energetykę 2026" })).toHaveAttribute(
      "href",
      `/qa/${SLUG}`,
    );
  });

  it("plakietka rozróżnia otwartą, odpowiadaną, zaplanowaną i zamkniętą sesję", async () => {
    // Cztery statusy z bazy mapują się na trzy zdania - a `answering`
    // (redakcja odpowiada) MUSI czytać się jak otwarta, nie jak „zaplanowana".
    h.sessions = [
      session({ id: "s1", slug: "a", status: "answering", title_pl: "Sesja odpowiadana" }),
      session({ id: "s2", slug: "b", status: "scheduled", title_pl: "Sesja zaplanowana" }),
      session({ id: "s3", slug: "c", status: "closed", title_pl: "Sesja zamknięta" }),
    ];
    await mountList();

    expect(screen.getByText("Otwarta sesja")).toBeInTheDocument();
    expect(screen.getByText("Zaplanowana")).toBeInTheDocument();
    expect(screen.getByText("Zamknięta")).toBeInTheDocument();
  });

  it("SZKICE sesji nie wychodzą na listę publiczną", async () => {
    // Filtr `neq(status, draft)` jest jedyną rzeczą, która trzyma redakcyjną
    // kolejkę poza publicznym adresem. Szkic z roboczym tytułem na liście to
    // wyciek pracy redakcji.
    h.sessions = [session({ status: "draft", title_pl: "SZKIC - nie publikować" })];
    await mountList();

    expect(screen.queryByText("SZKIC - nie publikować")).not.toBeInTheDocument();
    expect(screen.getByText("Brak zaplanowanych sesji Q&A.")).toBeInTheDocument();
  });

  it("po angielsku bierze angielski tytuł i angielskie etykiety", async () => {
    await i18n.changeLanguage("en");
    await mountList();

    expect(
      screen.getByText("Ask experts anything and upvote the best community questions."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Energy questions 2026" })).toBeInTheDocument();
    expect(screen.getByText("Open session")).toBeInTheDocument();
  });

  it("pusta lista daje komunikat redakcyjny, a nie pustą siatkę", async () => {
    h.sessions = [];
    await mountList();

    expect(screen.getByText("Brak zaplanowanych sesji Q&A.")).toBeInTheDocument();
  });

  it("awaria odczytu mówi „nie udało się”, a NIE „brak sesji”", async () => {
    h.broken.add("qa_sessions");
    await mountList();

    expect(await screen.findByText("Nie udało się pobrać danych.")).toBeInTheDocument();
    expect(screen.queryByText("Brak zaplanowanych sesji Q&A.")).toBeNull();
  });

  it("wyłączony moduł Q&A pokazuje ekran „moduł wyłączony”", async () => {
    h.settings = modules({ qa_enabled: false });
    await mountList();

    // Bramka rozstrzyga się na mapie ustawień, która jest odczytem
    // asynchronicznym - do jej powrotu widok stoi na wartościach domyślnych.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 1, name: "Q&A" })).toBeNull(),
    );
    expect(screen.queryByText("Pytania o energetykę 2026")).toBeNull();
  });

  it("sesja innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    h.sessions = [session({ tenant_id: "tenant-b", title_pl: "Sesja obcego obszaru" })];
    await mountList();

    expect(screen.queryByText("Sesja obcego obszaru")).not.toBeInTheDocument();
    expect(screen.getByText("Brak zaplanowanych sesji Q&A.")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ta sama sesja na WŁASNYM hoście renderuje się", async () => {
    h.sessions = [session({ tenant_id: "tenant-b", title_pl: "Sesja obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mountList();

    expect(screen.getByRole("link", { name: "Sesja obcego obszaru" })).toBeInTheDocument();
  });

  it("nie zostawia listy sesji z wadami dostępności", async () => {
    const view = await mountList();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /qa - nagłówek i dane strukturalne listy", () => {
  it("po polsku niesie polski tytuł z marką i krótki og:title", () => {
    const head = routeHead(QaListRoute, { loaderData: { sessions: [] } });

    expect(headTitle(head)).toBe("Sesje Q&A - New European Strategies");
    expect(metaContent(head, "property", "og:title")).toBe("Sesje Q&A");
    expect(metaContent(head, "name", "description")).toBe(
      "Zadawaj pytania ekspertom i głosuj na najlepsze pytania społeczności.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", () => {
    h.requestUrl = "https://nes.example.org/en/qa";
    const head = routeHead(QaListRoute, { loaderData: { sessions: [] } });

    expect(headTitle(head)).toBe("Q&A sessions - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Ask questions to experts and upvote the best community questions.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("kolekcja JSON-LD wymienia sesje TYTUŁEM z języka renderu", () => {
    // To jedyne miejsce, w którym asystent i wyszukiwarka widzą, jakie sesje
    // ma ta strona. Lista z polskimi tytułami na wersji angielskiej to
    // dane strukturalne sprzeczne z treścią.
    const loaderData = {
      sessions: [{ slug: SLUG, titlePl: "Pytania o energetykę", titleEn: "Energy questions" }],
    };
    const pl = jsonLdNodes(routeHead(QaListRoute, { loaderData }));
    expect(JSON.stringify(pl)).toContain("Pytania o energetykę");

    h.requestUrl = "https://nes.example.org/en/qa";
    const en = jsonLdNodes(routeHead(QaListRoute, { loaderData }));
    expect(JSON.stringify(en)).toContain("Energy questions");
    expect(JSON.stringify(en)).not.toContain("Pytania o energetykę");
  });

  it("sesja bez tytułu w danym języku spada na SLUG, nie na pustą pozycję", () => {
    // Pusta nazwa w węźle strukturalnym jest gorsza niż slug: wyszukiwarka
    // dostaje pozycję bez treści i może odrzucić cały węzeł.
    const head = routeHead(QaListRoute, {
      loaderData: { sessions: [{ slug: SLUG, titlePl: "", titleEn: "" }] },
    });

    expect(JSON.stringify(jsonLdNodes(head))).toContain(SLUG);
  });

  it("BEZ danych loadera nagłówek i węzły JSON-LD nadal się składają", () => {
    // `head()` bywa wołane bez ładunku loadera (przerwana nawigacja). Rzut
    // w tym miejscu wywala CAŁY dokument, nie tylko listę.
    const head = routeHead(QaListRoute, {});

    expect(headTitle(head)).toBe("Sesje Q&A - New European Strategies");
    expect(jsonLdNodes(head).length).toBeGreaterThanOrEqual(2);
  });

  it("loader NIE wywraca trasy, gdy odczyt sesji padnie", async () => {
    // Loader ma `try/catch` i oddaje pustą listę - markup listy jest
    // opcjonalny, a metatagi muszą wyjść zawsze.
    h.broken.add("qa_sessions");
    const data = await listLoader()({ context: { queryClient: freshClient() } });

    expect(data.sessions).toEqual([]);
  });
});

describe("trasa /qa/$slug - sesja, pytania i odpowiedzi", () => {
  it("pokazuje tytuł sesji, wprowadzenie i drogę powrotu na listę", async () => {
    // Strona szczegółów jest ślepą uliczką bez linku wstecz, a wchodzi się
    // na nią wprost z wyszukiwarki.
    await mountSession();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pytania o energetykę 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pytania do zespołu energetycznego przed szczytem."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Wróć do listy sesji/ })).toHaveAttribute(
      "href",
      "/qa",
    );
  });

  it("pokazuje pytanie, licznik głosów w polskiej formie i autora", async () => {
    await mountSession();

    expect(await screen.findByText("Czy magazyny energii zdążą przed zimą?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4 głosy" })).toBeInTheDocument();
    expect(screen.getByText(/Marek z Poznania/)).toBeInTheDocument();
  });

  it("pytanie ANONIMOWE nie pokazuje nazwy autora", async () => {
    // Anonimowość jest obietnicą wobec pytającego. Nazwa wyświetlona obok
    // pytania oznaczonego jako anonimowe to naruszenie tej obietnicy.
    h.questions = [question({ is_anonymous: true, author_display: "Marek z Poznania" })];
    await mountSession();

    expect(await screen.findByText(/Anonimowo/)).toBeInTheDocument();
    expect(screen.queryByText(/Marek z Poznania/)).not.toBeInTheDocument();
  });

  it("pytanie PRIORYTETOWE jest oznaczone plakietką", async () => {
    h.questions = [question({ is_priority: true })];
    await mountSession();

    expect(await screen.findByText("Priorytet Pro")).toBeInTheDocument();
  });

  it("odpowiedź redakcji pokazuje się pod pytaniem", async () => {
    h.questions = [
      question({
        status: "answered",
        answer_body: "Magazyny wejdą etapami, pierwszy blok w listopadzie.",
        answered_at: "2026-04-05T12:00:00.000Z",
      }),
    ];
    await mountSession();

    expect(await screen.findByText("Odpowiedź")).toBeInTheDocument();
    expect(
      screen.getByText("Magazyny wejdą etapami, pierwszy blok w listopadzie."),
    ).toBeInTheDocument();
  });

  it("sesja BEZ pytań daje zaproszenie, a nie pustą sekcję", async () => {
    h.questions = [];
    await mountSession();

    expect(
      await screen.findByText("Nikt jeszcze nie zadał pytania - bądź pierwszy."),
    ).toBeInTheDocument();
  });

  it("awaria RPC pytań NIE zabiera tytułu ani wprowadzenia sesji", async () => {
    // Pytania są dodatkiem, sesja jest treścią. Blip RPC nie może zamienić
    // działającej strony w ekran błędu.
    h.broken.add("list_qa_questions");
    await mountSession();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Pytania o energetykę 2026" }),
    ).toBeInTheDocument();
  });

  it("po angielsku bierze angielski tytuł i angielskie wprowadzenie", async () => {
    await i18n.changeLanguage("en");
    await mountSession();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Energy questions 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Questions for the energy team ahead of the summit."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pytania o energetykę 2026")).not.toBeInTheDocument();
  });

  it("PODSUMOWANIE sesji linkuje do opublikowanego wpisu", async () => {
    // Po zamknięciu sesji wiedza ma nie ginąć: baner z linkiem do artykułu
    // jest jedyną drogą z archiwalnej sesji do jej podsumowania.
    h.sessions = [session({ post_id: SUMMARY_POST_ID, status: "closed" })];
    h.posts = [
      {
        id: SUMMARY_POST_ID,
        slug: "energetyka-2026-podsumowanie",
        title_pl: "Energetyka 2026 - podsumowanie",
        title_en: "Energy 2026 - recap",
      },
    ];
    await mountSession();

    expect(
      await screen.findByText("Podsumowanie tej sesji jest dostępne jako artykuł."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Przeczytaj podsumowanie/ })).toHaveAttribute(
      "href",
      "/post/energetyka-2026-podsumowanie",
    );
  });

  it("sesja BEZ podsumowania nie pokazuje pustego banera", async () => {
    await mountSession();
    await screen.findByRole("heading", { level: 1 });

    expect(screen.queryByText("Podsumowanie tej sesji jest dostępne jako artykuł.")).toBeNull();
    // Brak `post_id` = brak zapytania o wpis. Odczyt „na wszelki wypadek"
    // to round-trip na każdej sesji, która podsumowania nie ma.
    expect(h.reads).not.toContain("posts:summary");
  });

  it("nie zostawia strony sesji z wadami dostępności", async () => {
    h.userId = "user-1";
    const view = await mountSession();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /qa/$slug - nieistniejący slug to 404, nie pusta strona", () => {
  it("slug, którego nie ma, kończy się 404 - a nie stroną z komunikatem awarii", async () => {
    // SEDNO NAPRAWY. Wcześniej loader oddawał `null` i trasa wychodziła
    // z HTTP 200: adres literówkowy zostawał w indeksie jako strona bez
    // treści, nierozróżnialna od blipu backendu. Teraz `notFound()` z loadera
    // montuje `notFoundComponent`, a Start ustawia status 404.
    const view = await mountSession("nie-ma-takiej-sesji");

    expect(await screen.findByText("Nie znaleziono takiej sesji Q&A.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "Pytania o energetykę 2026" }),
    ).toBeNull();
    // Droga powrotu na listę zostaje - 404 nie może być ślepą uliczką.
    expect(
      within(view.container).getByRole("link", { name: /Wróć do listy sesji/ }),
    ).toHaveAttribute("href", "/qa");
  });

  it("po angielsku komunikat 404 też jest angielski", async () => {
    await i18n.changeLanguage("en");
    await mountSession("nie-ma-takiej-sesji");

    expect(await screen.findByText("No such Q&A session was found.")).toBeInTheDocument();
  });

  it("SESJA INNEGO OBSZARU ROBOCZEGO daje 404, a nie cudzy tytuł", async () => {
    // Autorytetem jest polityka publiczna: wiersz obcego tenanta NIE WRACA
    // z odczytu. Trasa musi z tego zrobić 404, a nie pustkę i nie cudzą sesję.
    h.sessions = [session({ tenant_id: "tenant-b", title_pl: "Sesja obcego obszaru" })];
    await mountSession();

    expect(await screen.findByText("Nie znaleziono takiej sesji Q&A.")).toBeInTheDocument();
    expect(screen.queryByText("Sesja obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ta sama sesja na WŁASNYM hoście renderuje się", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa
    // zwracała 404 ZAWSZE - a to nie izolacja, tylko awaria.
    h.sessions = [session({ tenant_id: "tenant-b", title_pl: "Sesja obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mountSession();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sesja obcego obszaru" }),
    ).toBeInTheDocument();
  });

  it("AWARIA BACKENDU to NIE 404 - działające sesje nie wypadają z indeksu", async () => {
    // Odwrotność poprzedniego bloku i błąd, który popełnia `programs.$slug`:
    // 404 przy blipie bazy wypisuje z wyszukiwarki adresy, które istnieją.
    // Tu blip daje HTTP 200 i brandowy komunikat awarii.
    h.broken.add("qa_sessions");
    await mountSession();

    expect(await screen.findByText("Nie udało się pobrać danych.")).toBeInTheDocument();
    expect(screen.queryByText("Nie znaleziono takiej sesji Q&A.")).toBeNull();
  });

  it("loader ROZDZIELA obie sytuacje wprost: rzut przy braku, `null` przy awarii", async () => {
    // Asercja na LOADERZE, nie na renderze - to on decyduje o statusie HTTP,
    // a status HTTP jest tym, co widzi crawler.
    const loader: unknown = QaSessionRoute.options.loader;
    if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
    const call = loader as (ctx: {
      context: { queryClient: QueryClient };
      params: { slug: string };
    }) => Promise<unknown>;

    await expect(
      call({ context: { queryClient: freshClient() }, params: { slug: "nie-ma" } }),
    ).rejects.toBeTruthy();

    h.broken.add("qa_sessions");
    await expect(
      call({ context: { queryClient: freshClient() }, params: { slug: SLUG } }),
    ).resolves.toBeNull();
  });
});

describe("trasa /qa/$slug - pytanie idzie przez RPC, nie insertem", () => {
  it("gość nie dostaje formularza, tylko podpowiedź o logowaniu", async () => {
    await mountSession();
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByText("Zaloguj się, aby zadać pytanie lub głosować.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wyślij pytanie" })).toBeNull();
  });

  it("zalogowany w ZAMKNIĘTEJ sesji dostaje komunikat, a nie formularz", async () => {
    // RPC i tak wymusza `status='open'`. Formularz w zamkniętej sesji to
    // obietnica, którą baza odrzuci - i strata pracy pytającego.
    h.userId = "user-1";
    h.sessions = [session({ status: "closed" })];
    await mountSession();

    expect(await screen.findByText("Sesja nie przyjmuje teraz pytań.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wyślij pytanie" })).toBeNull();
  });

  it("wysyła pytanie przez RPC z identyfikatorem sesji i flagą anonimowości", async () => {
    h.userId = "user-1";
    await mountSession();
    const textarea = await screen.findByPlaceholderText("Twoje pytanie...");

    fireEvent.change(textarea, { target: { value: "Kiedy ruszy nowy interkonektor?" } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij pytanie" }));

    await waitFor(() =>
      expect(h.asked).toEqual([
        {
          p_session_id: SESSION_ID,
          p_body: "Kiedy ruszy nowy interkonektor?",
          p_anonymous: false,
        },
      ]),
    );
    expect(h.successToasts).toEqual(["Dziękujemy - pytanie trafiło do moderacji."]);
  });

  it("pytanie krótsze niż pięć znaków NIE idzie do bazy", async () => {
    // Bramka po stronie klienta oszczędza limit 5/h czytelnikowi, który
    // przypadkiem kliknął w puste pole.
    h.userId = "user-1";
    await mountSession();
    const textarea = await screen.findByPlaceholderText("Twoje pytanie...");

    fireEvent.change(textarea, { target: { value: "co?" } });
    expect(screen.getByRole("button", { name: "Wyślij pytanie" })).toBeDisabled();
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);

    expect(h.asked).toEqual([]);
  });

  it("odmowa z limitu 5/h daje komunikat o limicie, nie ogólny błąd", async () => {
    // Trzy różne odpowiedzi bazy to trzy różne zdania. Wspólne „nie udało
    // się" każe czytelnikowi klikać dalej i wypalać limit do końca.
    h.userId = "user-1";
    h.askError = "qa: rate limited";
    await mountSession();
    const textarea = await screen.findByPlaceholderText("Twoje pytanie...");

    fireEvent.change(textarea, { target: { value: "Pytanie ponad limit" } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij pytanie" }));

    await waitFor(() =>
      expect(h.errorToasts).toEqual(["Limit 5 pytań na godzinę - odczekaj chwilę."]),
    );
  });

  it("odmowa „sesja zamknięta” daje komunikat o statusie sesji", async () => {
    h.userId = "user-1";
    h.askError = "qa: session closed";
    await mountSession();
    const textarea = await screen.findByPlaceholderText("Twoje pytanie...");

    fireEvent.change(textarea, { target: { value: "Pytanie po czasie" } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij pytanie" }));

    await waitFor(() => expect(h.errorToasts).toEqual(["Sesja nie przyjmuje teraz pytań."]));
  });

  it("inny błąd bazy daje komunikat ogólny i NIE pokazuje treści błędu z bazy", async () => {
    // Komunikat PostgREST („new row violates row-level security policy")
    // pokazany czytelnikowi to jednocześnie wyciek szczegółów schematu
    // i zdanie, z którym nie da się nic zrobić.
    h.userId = "user-1";
    h.askError = "new row violates row-level security policy for table qa_questions";
    await mountSession();
    const textarea = await screen.findByPlaceholderText("Twoje pytanie...");

    fireEvent.change(textarea, { target: { value: "Pytanie odrzucone przez RLS" } });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij pytanie" }));

    await waitFor(() =>
      expect(h.errorToasts).toEqual(["Nie udało się wysłać pytania. Spróbuj ponownie."]),
    );
    expect(h.errorToasts.join(" ")).not.toContain("row-level");
  });
});

describe("trasa /qa/$slug - głos na pytanie", () => {
  it("gość nie może głosować (przycisk zablokowany)", async () => {
    await mountSession();

    expect(await screen.findByRole("button", { name: "4 głosy" })).toBeDisabled();
  });

  it("zalogowany wstawia głos z JAWNYM tenant_id z RPC", async () => {
    // To jedyne miejsce w tym module, gdzie klient podaje `tenant_id` wprost:
    // RLS insertu wymaga równości z `public_tenant_id()`, a klient nie ma
    // innej drogi, żeby tę wartość znać. Pominięcie jej = odmowa zapisu.
    h.userId = "user-1";
    await mountSession();

    fireEvent.click(await screen.findByRole("button", { name: "4 głosy" }));

    await waitFor(() =>
      expect(h.voteInserts).toEqual([
        { question_id: "q1", user_id: "user-1", tenant_id: "tenant-a" },
      ]),
    );
  });

  it("pytanie, na które już zagłosowano, ma przycisk WCIŚNIĘTY i zablokowany", async () => {
    // `my_vote` z RPC jest jedynym źródłem tej informacji. Bez niego
    // czytelnik klika drugi raz i dostaje błąd duplikatu za coś, co zrobił.
    h.userId = "user-1";
    h.questions = [question({ my_vote: true })];
    await mountSession();

    const button = await screen.findByRole("button", { name: /Zagłosowano/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("DUPLIKAT głosu jest przemilczany, a nie pokazywany jako błąd", async () => {
    // Podwójne kliknięcie (albo dwie karty) to nie awaria. Komunikat błędu
    // za coś, co użytkownik już osiągnął, jest tylko szumem.
    h.userId = "user-1";
    h.voteError = 'duplicate key value violates unique constraint "qa_question_votes_pkey"';
    await mountSession();

    fireEvent.click(await screen.findByRole("button", { name: "4 głosy" }));

    await waitFor(() => expect(h.voteInserts.length).toBe(1));
    expect(h.errorToasts).toEqual([]);
  });

  it("PRAWDZIWA odmowa zapisu głosu daje komunikat błędu", async () => {
    // Kontrola dodatnia do testu wyżej: przemilczany jest WYŁĄCZNIE duplikat,
    // a nie każda odmowa. Bez tej pary „ignorujemy duplikat" mogłoby znaczyć
    // „ignorujemy wszystko", w tym odmowę RLS.
    h.userId = "user-1";
    h.voteError = "new row violates row-level security policy";
    await mountSession();

    fireEvent.click(await screen.findByRole("button", { name: "4 głosy" }));

    await waitFor(() => expect(h.errorToasts).toEqual(["Nie udało się zapisać głosu."]));
  });
});

describe("trasa /qa/$slug - nagłówek i dane strukturalne sesji", () => {
  it("tytuł niesie nazwę sesji, a opis jej wprowadzenie", () => {
    const head = routeHead(QaSessionRoute, {
      params: { slug: SLUG },
      loaderData: {
        titlePl: "Pytania o energetykę 2026",
        titleEn: "Energy questions 2026",
        introPl: "Pytania do zespołu energetycznego.",
        introEn: "Questions for the energy team.",
        openedAt: "2026-04-01T10:00:00.000Z",
        closedAt: null,
        answered: [],
      },
    });

    expect(headTitle(head)).toBe("Pytania o energetykę 2026 - New European Strategies");
    expect(metaContent(head, "property", "og:title")).toBe("Pytania o energetykę 2026");
    expect(metaContent(head, "name", "description")).toBe("Pytania do zespołu energetycznego.");
    expect(metaContent(head, "property", "og:type")).toBe("article");
  });

  it("po angielsku tytuł i opis są angielskie", () => {
    h.requestUrl = `https://nes.example.org/en/qa/${SLUG}`;
    const head = routeHead(QaSessionRoute, {
      params: { slug: SLUG },
      loaderData: {
        titlePl: "Pytania o energetykę 2026",
        titleEn: "Energy questions 2026",
        introPl: "Pytania do zespołu energetycznego.",
        introEn: "Questions for the energy team.",
        openedAt: null,
        closedAt: null,
        answered: [],
      },
    });

    expect(headTitle(head)).toBe("Energy questions 2026 - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe("Questions for the energy team.");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("BEZ danych loadera nagłówek ma zdanie zapasowe w OBU językach", () => {
    // `head()` bywa wołane bez ładunku (404, przerwana nawigacja). Pusty
    // tytuł w indeksie jest gorszy niż tytuł ogólny.
    expect(headTitle(routeHead(QaSessionRoute, { params: { slug: SLUG } }))).toBe(
      "Sesja Q&A - New European Strategies",
    );

    h.requestUrl = `https://nes.example.org/en/qa/${SLUG}`;
    expect(headTitle(routeHead(QaSessionRoute, { params: { slug: SLUG } }))).toBe(
      "Q&A session - New European Strategies",
    );
  });

  it("bardzo długi tytuł sesji jest SKRACANY do limitu SERP", () => {
    // Tytuł ucięty przez wyszukiwarkę w połowie wyrazu czyta się jak błąd.
    const head = routeHead(QaSessionRoute, {
      params: { slug: SLUG },
      loaderData: {
        titlePl:
          "Pytania o europejską politykę energetyczną, magazyny, sieci przesyłowe i ceny hurtowe w roku 2026",
        titleEn: "x",
        introPl: null,
        introEn: null,
        openedAt: null,
        closedAt: null,
        answered: [],
      },
    });

    expect(metaContent(head, "property", "og:title").length).toBeLessThanOrEqual(60);
    expect(metaContent(head, "property", "og:title")).not.toMatch(/\s$/);
  });

  it("węzeł QAPage powstaje TYLKO z pytań, które mają opublikowaną odpowiedź", async () => {
    // Pytanie bez odpowiedzi jest nieważne w rich results, a węzeł z takimi
    // pozycjami bywa odrzucany CAŁY - razem z pytaniami, które odpowiedź mają.
    h.questions = [
      question({ id: "q-open", answer_body: null }),
      question({
        id: "q-answered",
        body: "Czy sieci wytrzymają szczyt zapotrzebowania?",
        answer_body: "Tak, po rozbudowie interkonektorów.",
        answered_at: "2026-04-05T12:00:00.000Z",
      }),
    ];
    const loader: unknown = QaSessionRoute.options.loader;
    if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
    const data = await (
      loader as (ctx: {
        context: { queryClient: QueryClient };
        params: { slug: string };
      }) => Promise<{ answered: { id: string }[] } | null>
    )({
      context: { queryClient: freshClient() },
      params: { slug: SLUG },
    });

    expect(data?.answered.map((q) => q.id)).toEqual(["q-answered"]);
  });

  it("ANONIM nie trafia do danych strukturalnych pod nazwą", async () => {
    // Markup `QAPage` jest publikowany dla wyszukiwarek i asystentów, więc
    // wyciek nazwy autora tą drogą jest równie realny jak w widoku.
    h.questions = [
      question({
        is_anonymous: true,
        author_display: "Marek z Poznania",
        answer_body: "Odpowiedź redakcji.",
        answered_at: "2026-04-05T12:00:00.000Z",
      }),
    ];
    const loader: unknown = QaSessionRoute.options.loader;
    if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
    const data = await (
      loader as (ctx: {
        context: { queryClient: QueryClient };
        params: { slug: string };
      }) => Promise<{ answered: { authorName: string | null }[] } | null>
    )({
      context: { queryClient: freshClient() },
      params: { slug: SLUG },
    });

    expect(data?.answered[0]?.authorName).toBeNull();

    const head = routeHead(QaSessionRoute, { params: { slug: SLUG }, loaderData: data });
    expect(JSON.stringify(jsonLdNodes(head))).not.toContain("Marek z Poznania");
  });

  it("okruszki JSON-LD prowadzą z sesji na listę Q&A w języku renderu", () => {
    const pl = jsonLdOfType(
      routeHead(QaSessionRoute, { params: { slug: SLUG }, loaderData: null }),
      "BreadcrumbList",
    );
    expect(JSON.stringify(pl)).toContain("Sesje Q&A");

    h.requestUrl = `https://nes.example.org/en/qa/${SLUG}`;
    const en = jsonLdOfType(
      routeHead(QaSessionRoute, { params: { slug: SLUG }, loaderData: null }),
      "BreadcrumbList",
    );
    expect(JSON.stringify(en)).toContain("Q&A sessions");
  });

  it("kanoniczny bierze adres z żądania, a pusty adres spada na /qa/<slug>", () => {
    h.requestUrl = `https://nes.example.org/qa/${SLUG}`;
    const withUrl = routeHead(QaSessionRoute, { params: { slug: SLUG }, loaderData: null });
    expect((withUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(
      `https://nes.example.org/qa/${SLUG}`,
    );

    h.requestUrl = "";
    const noUrl = routeHead(QaSessionRoute, { params: { slug: SLUG }, loaderData: null });
    expect((noUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(`/qa/${SLUG}`);
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM WCZYTANIU `/qa/$slug` ───────────────────
//
// POMIAR, NIE OPINIA. `measureFirstPaint` rozdziela FALĘ LOADERA (odczyty
// serwera przed wysłaniem HTML) od FALI KLIENTA (odczyty startujące na
// montażu, czyli round-tripy PO hydratacji, każdy z pełnym opóźnieniem sieci
// czytelnika). Rozdzielenie działa, bo loader zasiewa cache zapytań, a ten
// jedzie do przeglądarki w dehydrowanym ładunku SSR.
//
// BUDŻETY PLATFORMY: ROOT_WARM_BUDGET_MS 2500, SSR_DB_DEADLINE_MS 8000, limit
// 6 równoległych subrequestów na żądanie na Workers. Root loader zużywa część
// tego limitu na rozgrzewkę chrome; do tego `/qa/$slug` ma RODZICA z własnym
// loaderem (`/qa` czyta pełną listę 100 sesji), więc wejście na sesję płaci
// najpierw za listę, której ta strona nie pokazuje. Tym bardziej nie ma tu
// miejsca na round-tripy, które da się usunąć zasiewem.
//
// ZMIERZONE PRZED ZMIANĄ: loader 2 odczyty (`qa_sessions:slug`,
// `rpc:list_qa_questions`), klient 2 odczyty (TE SAME dwa jeszcze raz).
// Loader wołał fetchery WPROST, więc jego praca nie zasilała cache'u
// react-query i przeglądarka pobierała sesję i pytania od nowa - a to treść
// NAD ZGIĘCIEM (tytuł sesji, wprowadzenie, lista pytań).
// ZMIERZONE PO ZMIANIE: loader 2 odczyty, klient 0 odczytów.
//
// CO ZOSTAJE KLIENCKIE I DLACZEGO - ODRZUCENIE Z UZASADNIENIEM.
// `["qa-summary-post", postId]` (teaser podsumowania) ZOSTAJE po stronie
// klienta i nie wchodzi do loadera. Powód nie jest kosmetyczny: ten odczyt
// jest WARUNKOWY (`enabled: !!summaryPostId`) i dotyczy sesji ZAMKNIĘTYCH
// z opublikowanym podsumowaniem, czyli mniejszości adresów; jego wynik to
// jeden baner POD listą pytań. Wciągnięcie go do loadera dołożyłoby trzeci
// subrequest na ścieżce krytycznej KAŻDEJ sesji - w tym wszystkich otwartych,
// które podsumowania nie mają - żeby przyspieszyć element, do którego trzeba
// doscrollować. Zapadka stoi więc na dzisiejszej liczbie: zero odczytów
// klienckich dla sesji bez podsumowania i dokładnie jeden dla sesji z nim.

/** Wynik pomiaru pierwszego wczytania: odczyty serwera kontra odczyty klienta. */
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

type SessionLoader = (ctx: {
  context: { queryClient: QueryClient };
  params: { slug: string };
}) => Promise<unknown>;

function sessionLoader(): SessionLoader {
  const loader: unknown = QaSessionRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as SessionLoader;
}

async function measureFirstPaint(slug = SLUG): Promise<FirstPaintMeasurement> {
  const queryClient = freshClient();
  // ROZGRZEWKA ROOTA, ODTWORZONA WPROST. W produkcji mapę `site_settings`
  // rozgrzewa loader `__root.tsx`, więc `useCommunityModules` w komponencie
  // czyta ją z ciepłego cache'u i NIE jest round-tripem tej trasy. Harness
  // montuje trasę bez roota, więc bez tej linijki pomiar doliczyłby
  // czytelnikowi zapytanie, za które płaci chrome każdej strony.
  await queryClient.ensureQueryData(siteSettingsQueryOptions);
  h.reads = [];

  await sessionLoader()({ context: { queryClient }, params: { slug } });
  const loaderReads = [...h.reads];

  const view = await mountSession(slug, queryClient);
  await screen.findByRole("heading", { level: 1 });
  // Zapytania klienckie startują w efektach montażu - czekamy, aż cache
  // przestanie się zmieniać, inaczej pomiar liczyłby mniej, niż strona robi.
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasa /qa/$slug - zapadka na liczbie zapytań pierwszego wczytania", () => {
  it("loader zasiewa SESJĘ i PYTANIA - to treść nad zgięciem", async () => {
    // Bez zasiewu tytuł sesji, wprowadzenie i lista pytań dojeżdżają PO
    // hydratacji: crawler ich nie widzi, a czytelnik widzi przeskok układu.
    const { loaderReads } = await measureFirstPaint();

    expect(loaderReads).toEqual(["qa_sessions:slug", "rpc:list_qa_questions"]);
  });

  it("po hydratacji NIE pobiera sesji ani pytań drugi raz", async () => {
    // ZAPADKA. Dwa round-tripy za dane, które właśnie przyjechały
    // w dokumencie, to była mierzalna strata na KAŻDYM wejściu z wyszukiwarki.
    const { clientReads } = await measureFirstPaint();

    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toEqual([]);
  });

  it("sesja z PODSUMOWANIEM kosztuje dokładnie JEDEN odczyt kliencki", async () => {
    // Odrzucenie z uzasadnieniem (patrz komentarz nad tym blokiem): baner
    // podsumowania jest pod listą pytań i dotyczy mniejszości adresów.
    h.sessions = [session({ post_id: SUMMARY_POST_ID, status: "closed" })];
    h.posts = [
      {
        id: SUMMARY_POST_ID,
        slug: "energetyka-2026-podsumowanie",
        title_pl: "Energetyka 2026 - podsumowanie",
        title_en: "Energy 2026 - recap",
      },
    ];
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect(loaderReads).not.toContain("posts:summary");
    expect(clientReads).toEqual(["posts:summary"]);
  });

  it("KONTROLA DODATNIA: bez zasiewu klient JEDNAK pobiera sesję i pytania", async () => {
    // Bez tej pary zapadka „zero odczytów klienckich" przechodziłaby też
    // wtedy, gdyby atrapa przestała liczyć wywołania albo komponent przestał
    // czytać dane.
    const view = await mountSession(SLUG, freshClient());
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads).toContain("qa_sessions:slug");
    expect(h.reads).toContain("rpc:list_qa_questions");
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM WCZYTANIU `/qa` ─────────────────────────
//
// ZMIERZONE PRZED ZMIANĄ: loader 1 odczyt (`qa_sessions:list`, wołany WPROST),
// klient 1 odczyt (TEN SAM select jeszcze raz) - a markup listy w wyjściu
// serwera był PUSTY, bo praca loadera nie zasilała cache'u react-query
// i komponent stał na `query.isLoading`.
// ZMIERZONE PO ZMIANIE: loader 2 odczyty (`site_settings` z bramki modułu -
// deduplikowany z rozgrzewką root loadera - oraz `qa_sessions:list`),
// klient 0 odczytów, a lista jest w HTML z serwera.
describe("trasa /qa - zapadka na liczbie zapytań pierwszego wczytania", () => {
  it("loader ZASIEWA listę, więc karty są w PIERWSZYM renderze", async () => {
    // Dowód SSR-owy: crawler i czytelnik z wolną siecią widzą sesje od razu,
    // bez przeskoku układu po hydratacji.
    const queryClient = freshClient();
    await listLoader()({ context: { queryClient } });
    const loaderReads = [...h.reads];

    const view = await mountList(queryClient);
    expect(screen.getByRole("link", { name: "Pytania o energetykę 2026" })).toBeInTheDocument();
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(loaderReads).toEqual(["site_settings", "qa_sessions:list"]);
    expect(h.reads.slice(loaderReads.length)).toEqual([]);
  });

  it("wyłączony moduł kosztuje JEDEN odczyt ustawień i ani jednego więcej", async () => {
    // Bramka rozstrzyga się na mapie, którą rozgrzewa root loader, więc
    // wyłączony moduł nie płaci już za select stu sesji na każde żądanie.
    h.settings = modules({ qa_enabled: false });
    const queryClient = freshClient();
    await listLoader()({ context: { queryClient } });

    expect(h.reads).toEqual(["site_settings"]);
  });

  it("KONTROLA DODATNIA: bez zasiewu lista JEST pobierana z przeglądarki", async () => {
    // Bez tej pary pierwszy test przechodziłby też wtedy, gdyby atrapa
    // przestała liczyć odczyty albo komponent przestał czytać listę.
    const view = await mountList(freshClient());
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads).toContain("qa_sessions:list");
  });
});
