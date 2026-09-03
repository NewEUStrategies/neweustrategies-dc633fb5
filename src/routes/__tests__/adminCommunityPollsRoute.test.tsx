/**
 * Trasa `/admin/community/polls` ZAMONTOWANA - moderacja ankiet: lista, filtr
 * statusu, podgląd wyników, otwieranie i zamykanie głosowania, kasowanie oraz
 * kreator nowej ankiety. Przed tym plikiem 0/78 linii i 0/39 funkcji.
 *
 * GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE.
 * Zlecenie brzmiało „użytkownik bez roli sztabowej nie widzi panelu". Zanim
 * powstał ten plik, sprawdziłem, gdzie ten warunek FAKTYCZNIE mieszka:
 *
 *   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
 *      renderu dla wszystkich tras panelu: `useAuth()` daje `isStaff`, efekt
 *      robi `navigate({ to: "/login" })`, a komponent zwraca `null`.
 *   2. `src/routes/admin.community.tsx` - tylko podnawigacja i `<Outlet/>`,
 *      zero warunku roli.
 *   3. TA trasa - zero warunku roli. Nie ma `useAuth`, nie ma `beforeLoad`,
 *      nie ma `redirect` ani `<Navigate/>`.
 *   4. `src/lib/admin/community.ts` - `fetchAdminPolls`, `createPoll`,
 *      `deletePoll`, `updatePollStatus` i `fetchPollResults` idą ZWYKŁYM
 *      klientem Supabase (`supabase.from(...)`), a nie serwerową funkcją
 *      z middleware. Autorytetem ostatecznym jest więc RLS.
 *
 * Dlatego NIE MA tu testu „bez roli nie widzi panelu" udającego dowód na
 * poziomie tej trasy: taki test albo mierzyłby atrapę `useAuth`, której ta
 * trasa nawet nie woła, albo przechodziłby zawsze. Zamiast tego są asercje
 * mierzące TO, CO JEST: render nie zależy od roli, warunek roli stoi
 * w layoucie `/admin`, a warstwa danych nie ma bramki poza bazą. Dowodu na sam
 * layout tu NIE DUBLUJEMY - pilnuje go `adminRouteAuthority.gate.test.ts` dla
 * wszystkich tras panelu naraz; tutaj zostaje druga połowa kontraktu: że TA
 * trasa faktycznie wisi pod `/admin` i nie dokłada własnej, rozjeżdżającej się
 * bramki.
 *
 * WIELOTENANTOWOŚĆ. Panel nie wysyła ŻADNEGO predykatu tenanta - `fetchAdminPolls`
 * buduje `from("polls").select("*")` bez `eq("tenant_id", ...)`. Rozdział danych
 * robi w całości polityka `polls staff all`
 * (`supabase/migrations/20260713097000_polls_contributor_program.sql`), która
 * wiąże `tenant_id = current_tenant_id()` z rolą `admin`/`editor`. Test
 * renderujący na atrapie NIE MOŻE tego udowodnić - może udowodnić dokładnie
 * dwie rzeczy i obie tu są: (a) panel nie dokłada własnego, konkurencyjnego
 * filtra tenanta, (b) renderuje wyłącznie wiersze, które oddała warstwa danych,
 * i nie dorabia niczego z cache'u ani z poprzedniego montowania.
 *
 * ANTI-ANCHORING - WYJĄTEK DLA SZTABU. `src/lib/community/publicQueries.ts`
 * opisuje regułę dla CZYTELNIKA: „dopóki użytkownik nie zagłosuje (a ankieta
 * jest otwarta i nie jest się staffem), visible=false i liczb nie ma - rozkład
 * głosów nie może zakotwiczać wyboru". Panel sztabu jest jawnym wyjątkiem od
 * tej reguły (`get_poll_results`: `v_staff` omija bramkę), bo moderator musi
 * widzieć rozkład, żeby ocenić, czy ankieta nie jest zmanipulowana. Ten plik
 * dowodzi, że panel z tego wyjątku korzysta: pokazuje liczby dla ankiety
 * OTWARTEJ, bez oddawania głosu.
 *
 * CO JESZCZE DOWODZI TEN PLIK: `head()`, trzy stany listy (ładowanie, pustka,
 * odmowa), filtr statusu jadący do warstwy danych, bramkę potwierdzenia przy
 * kasowaniu, unieważnienia cache po każdej mutacji, komplet walidacji kreatora
 * (dwa pytania, minimum dwie kompletne opcje, puste odrzucone) i dostępność.
 *
 * CO JEST ATRAPĄ I DLACZEGO: wyłącznie granica danych
 * (`@/lib/admin/community`) i toasty (`sonner`). i18n, router, react-query
 * i Radix są PRAWDZIWE, więc asercje mierzą napisy ze słownika, a nie literały
 * wpisane w teście. `react-i18next` świadomie NIE jest atrapowany - fabryka
 * takiego mocka sięga po `@/lib/i18n`, czyli moduł importujący właśnie
 * mockowany pakiet, i zakleszcza plik (ostrzeżenie z nagłówka `@/test/i18nReal`).
 *
 * GRANICA DOWODU: reguły bazy (RLS `polls staff all`, RPC `get_poll_results`,
 * CHECK na liczbie opcji 2..8) egzekwuje Postgres i dowodzi ich pgTAP
 * (`supabase/tests/community_polls_contrib_test.sql`). Test na atrapie dowodzi
 * tylko tego, że panel woła to, co mówi, i pokazuje to, co dostał.
 *
 * RODO: żadnych prawdziwych osób ani treści - pytania, opcje i identyfikatory
 * są zmyślone i oczywiście fikcyjne.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { CreatePollInput, PollRow, PollStatus } from "@/lib/admin/community";

const h = vi.hoisted(() => ({
  polls: [] as PollRow[],
  /** Lista nigdy nie odpowiada - do dowodu o stanie ładowania. */
  listHangs: false,
  /** Odczyt listy odrzucony - do dowodu o stanie błędu. */
  listFails: false,
  listCalls: [] as (PollStatus | "all" | undefined)[],
  results: {} as Record<string, number>,
  resultCalls: [] as string[],
  created: [] as CreatePollInput[],
  createFailsWith: null as string | null,
  deleted: [] as string[],
  deleteFails: false,
  statusCalls: [] as { id: string; status: PollStatus }[],
  statusFails: false,
  toastSuccess: [] as string[],
  toastError: [] as string[],
}));

// Granica danych. Atrapa jest tu na miejscu: te funkcje budują zapytania
// PostgREST i mają własny przedmiot dowodu, a przedmiotem dowodu TRASY jest to,
// co robi Z WYNIKIEM i CO wysyła - nie jak to jedzie do bazy.
vi.mock("@/lib/admin/community", () => ({
  fetchAdminPolls: async (status?: PollStatus | "all"): Promise<PollRow[]> => {
    h.listCalls.push(status);
    if (h.listHangs) await new Promise<void>(() => {});
    if (h.listFails) throw new Error("test: odczyt ankiet odrzucony");
    return h.polls;
  },
  fetchPollResults: async (pollId: string): Promise<Record<string, number>> => {
    h.resultCalls.push(pollId);
    return h.results;
  },
  createPoll: async (input: CreatePollInput): Promise<PollRow> => {
    h.created.push(input);
    if (h.createFailsWith) throw new Error(h.createFailsWith);
    return {
      id: "poll-nowa",
      tenant_id: "tenant-testowy",
      question_pl: input.question_pl,
      question_en: input.question_en,
      options: input.options,
      status: input.status,
      ends_at: input.ends_at,
      post_id: null,
      created_by: null,
      created_at: "2026-09-01T09:00:00.000Z",
      updated_at: "2026-09-01T09:00:00.000Z",
    };
  },
  deletePoll: async (id: string): Promise<void> => {
    h.deleted.push(id);
    if (h.deleteFails) throw new Error("test: kasowanie odrzucone");
  },
  updatePollStatus: async (id: string, status: PollStatus): Promise<void> => {
    h.statusCalls.push({ id, status });
    if (h.statusFails) throw new Error("test: zmiana statusu odrzucona");
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toastSuccess.push(message),
    error: (message: string) => h.toastError.push(message),
  },
}));

import { renderRoute, routeHead } from "@/test/routeHarness";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { Route as PollsAdminRoute } from "@/routes/admin.community.polls";

const t = realT("pl");
const PATH = "/admin/community/polls";
const ROUTE_FILE = "src/routes/admin.community.polls.tsx";
const DATA_FILE = "src/lib/admin/community.ts";
const POLLS_MIGRATION = "supabase/migrations/20260713097000_polls_contributor_program.sql";

/** Wiersz `polls` w kształcie bazy - bez wymyślania własnego kształtu. */
function pollRow(over: Partial<PollRow> = {}): PollRow {
  return {
    id: "poll-1",
    tenant_id: "tenant-testowy",
    question_pl: "Czy zmyślone konsultacje mają sens?",
    question_en: "Do fictional consultations make sense?",
    options: [
      { label_pl: "Tak", label_en: "Yes" },
      { label_pl: "Nie", label_en: "No" },
    ],
    status: "open",
    ends_at: null,
    post_id: null,
    created_by: null,
    created_at: "2026-08-01T09:00:00.000Z",
    updated_at: "2026-08-01T09:00:00.000Z",
    ...over,
  };
}

/** Klient z wyłączonymi ponowieniami - test odmowy nie ma na co czekać. */
function testClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mountPolls(queryClient?: QueryClient) {
  return renderRoute({
    route: PollsAdminRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: queryClient ?? testClient(),
  });
}

/**
 * Wiersz listy po widocznym pytaniu.
 *
 * Namierzanie po TREŚCI, nie po pozycji w liście: przestawienie sortowania nie
 * może zamienić testu w fałszywy dowód, że kasujemy tę ankietę, o którą chodzi.
 */
function pollRowElement(question: string): HTMLElement {
  const row = screen.getByText(question).closest("li");
  if (!row) throw new Error(`test: wiersz ankiety „${question}" nie ma kontenera <li>`);
  return row;
}

/**
 * Przyciski akcji wiersza. STRAŻNIK, nie rzutowanie: wszystkie trzy są
 * przyciskami IKONOWYMI bez nazwy dostępnej (patrz `it.fails` w sekcji
 * „defekty zastane"), więc jedyne stabilne namierzenie to pozycja w wierszu -
 * a to wymaga sprawdzenia w runtime, że wiersz faktycznie ma tyle przycisków.
 */
function rowButton(question: string, index: number): HTMLElement {
  const buttons = within(pollRowElement(question)).getAllByRole("button");
  const button = buttons[index];
  if (!button) {
    throw new Error(
      `test: wiersz „${question}" ma ${buttons.length} przycisków, brak indeksu ${index}`,
    );
  }
  return button;
}

/** Kolejność przycisków w wierszu jest kontraktem tego pliku, nie zgadywanką. */
const RESULTS_BUTTON = 0;
const STATUS_BUTTON = 1;
const TRASH_BUTTON = 2;

/**
 * Czeka na wiersz i klika jego przycisk. Czekanie jest częścią helpera, a nie
 * obowiązkiem każdego testu: lista jedzie przez react-query, więc synchroniczny
 * odczyt trafia w stan „Ładowanie...".
 */
async function clickRowButton(question: string, index: number): Promise<void> {
  await screen.findByText(question);
  fireEvent.click(rowButton(question, index));
}

/** Otwiera listę Radiksa klawiaturą - pointer events nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

/** Atrapa natywnego `confirm` - happy-dom go nie implementuje. */
const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);

beforeEach(() => {
  h.polls = [];
  h.listHangs = false;
  h.listFails = false;
  h.listCalls = [];
  h.results = {};
  h.resultCalls = [];
  h.created = [];
  h.createFailsWith = null;
  h.deleted = [];
  h.deleteFails = false;
  h.statusCalls = [];
  h.statusFails = false;
  h.toastSuccess = [];
  h.toastError = [];
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  // Definiujemy na OBU obiektach: komponent woła gołe `confirm(...)`, więc
  // liczy się `globalThis`, a helpery testowe sięgają po `window`.
  Object.defineProperty(globalThis, "confirm", {
    configurable: true,
    writable: true,
    value: confirmSpy,
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: confirmSpy,
  });
});

afterEach(() => cleanup());

describe("ankiety - sklejenie trasy i gdzie stoi bramka uprawnień", () => {
  it("head() ustawia tytuł karty przeglądarki", async () => {
    // Panel ma kilkadziesiąt podstron; bez tytułu operator z otwartymi
    // zakładkami widzi kilka identycznych kart. Czytamy DWIEMA drogami:
    // wprost (kontrakt funkcji) i przez zamontowany router (to, co faktycznie
    // trafiłoby do `<HeadContent/>`).
    expect(routeHead(PollsAdminRoute).meta).toContainEqual({
      title: "Polls · Community · Admin",
    });

    const { meta } = await mountPolls();
    expect(meta()).toContainEqual({ title: "Polls · Community · Admin" });
  });

  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: komponent nie woła `useAuth` i nie przekierowuje, więc
    // renderuje się w harnessie, w którym żadnej sesji nie ma. To NIE jest
    // dziura - to podział pracy: jedna bramka w layoucie zamiast stu
    // czterdziestu kopii w trasach. Gdyby ktoś dołożył warunek roli TUTAJ, ten
    // test zapali się pierwszy i wymusi aktualizację opisu.
    await mountPolls();
    expect(
      await screen.findByRole("heading", { name: t("adminCommunity.polls.polls") }),
    ).toBeInTheDocument();
  });

  it("plik trasy nie zawiera warunku roli ani przekierowania", () => {
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).not.toMatch(/isStaff|isAdmin|isSuperAdmin|useAuth/);
    expect(source).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
  });

  it("trasa wisi pod `/admin`, więc chroni ją bramka `isStaff` z layoutu", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej trasy, a harness
    // montuje pojedynczą trasę pod zastępczym korzeniem, więc renderem nie da
    // się go tu dosięgnąć. To ta sama technika, której używa bramka
    // `src/routes/__tests__/adminRouteAuthority.gate.test.ts`.
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).toMatch(/createFileRoute\("\/admin\/community\/polls"\)/);
    const layout = readFileSync("src/routes/admin.tsx", "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
  });

  it("dane panelu idą zwykłym klientem Supabase - autorytetem jest RLS, nie middleware", () => {
    // Świadome NEGATYWNE ustalenie. Gdyby te funkcje były serwerowymi
    // (`createServerFn`), dowód uprawnień robiłoby się przez
    // `serverFnMiddlewareNames` z `@/test/serverFnHarness`. Nie są: czytają
    // `supabase.from("polls")` w przeglądarce, więc jedyną barierą jest
    // polityka `polls staff all`, a jej dowód mieszka w pgTAP.
    const layer = readFileSync(DATA_FILE, "utf8");
    expect(layer).toMatch(/export async function fetchAdminPolls/);
    expect(layer).toMatch(/export async function createPoll/);
    expect(layer).toMatch(/export async function deletePoll/);
    expect(layer).toMatch(/export async function updatePollStatus/);
    expect(layer).not.toMatch(/createServerFn/);
  });
});

describe("ankiety - rozdział tenantów", () => {
  it("panel nie dokłada własnego filtra tenanta - do warstwy jedzie SAM status", async () => {
    // Gdyby panel filtrował tenanta po stronie klienta, mielibyśmy dwa
    // niezależne źródła prawdy o tym, czyje to dane, i pierwsza rozbieżność
    // (np. przełączenie tenanta w sesji) skończyłaby się pokazaniem cudzych
    // ankiet ALBO ukryciem własnych. Rozdział ma być JEDEN i ma być w bazie.
    await mountPolls();
    await waitFor(() => expect(h.listCalls.length).toBeGreaterThan(0));
    expect(h.listCalls).toEqual(["all"]);

    const layer = readFileSync(DATA_FILE, "utf8");
    const fetchBody = layer.slice(
      layer.indexOf("export async function fetchAdminPolls"),
      layer.indexOf("export async function updatePollStatus"),
    );
    expect(fetchBody).not.toMatch(/tenant/);
  });

  it("rozdziału pilnuje polityka `polls staff all` wiążąca tenanta z rolą", () => {
    // To jest miejsce, w którym „dane jednego tenanta nie pojawiają się
    // w panelu drugiego" jest EGZEKWOWANE. Czytamy migrację, bo renderem na
    // atrapie klienta nie da się tego dosięgnąć.
    const migration = readFileSync(POLLS_MIGRATION, "utf8");
    expect(migration).toMatch(/CREATE POLICY "polls staff all" ON public\.polls/);
    expect(migration).toMatch(/tenant_id = \(SELECT public\.current_tenant_id\(\)\)/);
    expect(migration).toMatch(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'::app_role\)/);
  });

  it("panel renderuje WYŁĄCZNIE wiersze oddane przez warstwę - nic nie dorabia", async () => {
    // Druga połowa dowodu, ta dostępna renderem: gdy warstwa (czyli w praktyce
    // RLS) oddaje jeden wiersz, panel pokazuje jeden wiersz i ani znaku więcej.
    h.polls = [pollRow({ id: "poll-wlasna", question_pl: "Ankieta tenanta A" })];
    await mountPolls();
    expect(await screen.findByText("Ankieta tenanta A")).toBeInTheDocument();
    expect(screen.queryByText("Ankieta tenanta B")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("ankiety - trzy stany listy", () => {
  it("w trakcie pobierania mówi, że ładuje - nie udaje pustej bazy", async () => {
    h.listHangs = true;
    await mountPolls();
    expect(await screen.findByText(t("adminCommunity.polls.loading"))).toBeInTheDocument();
    // Pustka i ładowanie są WZAJEMNIE WYKLUCZAJĄCE - inaczej moderator
    // zobaczyłby „brak ankiet" na bazie pełnej głosowań.
    expect(screen.queryByText(t("adminCommunity.polls.noPolls"))).toBeNull();
  });

  it("pusta baza mówi wprost, że ankiet nie ma", async () => {
    await mountPolls();
    expect(await screen.findByText(t("adminCommunity.polls.noPolls"))).toBeInTheDocument();
  });

  it("wiersz pokazuje pytanie, plakietkę statusu i datę końca", async () => {
    h.polls = [
      pollRow({
        question_pl: "Czy przenieść zmyślone konsultacje na wrzesień?",
        status: "draft",
        ends_at: "2026-09-30T12:00:00.000Z",
      }),
    ];
    await mountPolls();
    await screen.findByText("Czy przenieść zmyślone konsultacje na wrzesień?");
    const row = pollRowElement("Czy przenieść zmyślone konsultacje na wrzesień?");
    expect(within(row).getByText("draft")).toBeInTheDocument();
    // Data końca to informacja o oknie głosowania - bez niej moderator nie wie,
    // czy ankieta jeszcze zbiera głosy.
    const ends = t("adminCommunity.polls.ends");
    const endsText = new Date("2026-09-30T12:00:00.000Z").toLocaleDateString();
    expect(within(row).getByText(`${ends}${endsText}`)).toBeInTheDocument();
  });

  it("ankieta bez daty końca nie udaje, że okno głosowania jest zamknięte", async () => {
    h.polls = [pollRow({ question_pl: "Ankieta bezterminowa", ends_at: null })];
    await mountPolls();
    await screen.findByText("Ankieta bezterminowa");
    const row = pollRowElement("Ankieta bezterminowa");
    expect(within(row).queryByText(new RegExp(t("adminCommunity.polls.ends")))).toBeNull();
  });

  it("pytanie bez wersji PL spada na EN zamiast renderować pustkę", async () => {
    // `pickLocalized` jest kanonicznym pickerem bliźniaczych kolumn: brak
    // tłumaczenia ma dać drugi język, nie pusty wiersz, w który nie da się
    // kliknąć.
    h.polls = [pollRow({ question_pl: "   ", question_en: "English-only question" })];
    await mountPolls();
    expect(await screen.findByText("English-only question")).toBeInTheDocument();
  });
});

describe("ankiety - wyniki widoczne dla sztabu (wyjątek od anti-anchoringu)", () => {
  const question = "Czy zmyślone konsultacje mają sens?";

  it("otwarcie wyników pyta bazę o wyniki TEJ ankiety", async () => {
    h.polls = [pollRow({ id: "poll-wyniki", question_pl: question })];
    await mountPolls();
    await clickRowButton(question, RESULTS_BUTTON);
    await waitFor(() => expect(h.resultCalls).toEqual(["poll-wyniki"]));
  });

  it("panel sztabu WIDZI rozkład głosów ankiety OTWARTEJ, bez oddania głosu", async () => {
    // To jest jawny wyjątek od reguły anti-anchoringu opisanej
    // w `src/lib/community/publicQueries.ts`: czytelnik przed oddaniem głosu
    // liczb nie dostaje, moderator dostaje zawsze - bo bez rozkładu nie oceni,
    // czy ankieta nie jest zmanipulowana. Ankieta jest tu `open`, a „głosu"
    // w panelu w ogóle nie da się oddać.
    h.polls = [pollRow({ id: "poll-wyniki", question_pl: question, status: "open" })];
    h.results = { "0": 7, "1": 3 };
    await mountPolls();
    await clickRowButton(question, RESULTS_BUTTON);

    const row = pollRowElement(question);
    // Procenty liczone z sumy, nie z liczby opcji: 7/10 i 3/10.
    expect(await within(row).findByText("7 · 70%")).toBeInTheDocument();
    expect(within(row).getByText("3 · 30%")).toBeInTheDocument();
  });

  it("ankieta bez głosów mówi to wprost, zamiast rysować zerowe słupki bez podpisu", async () => {
    h.polls = [pollRow({ id: "poll-pusta", question_pl: question })];
    h.results = {};
    await mountPolls();
    await clickRowButton(question, RESULTS_BUTTON);
    expect(await screen.findByText(t("adminCommunity.polls.noVotes"))).toBeInTheDocument();
  });

  it("powtórny klik zwija wyniki - przełącznik, nie jednokierunkowe otwarcie", async () => {
    h.polls = [pollRow({ id: "poll-wyniki", question_pl: question })];
    h.results = { "0": 4 };
    await mountPolls();
    await clickRowButton(question, RESULTS_BUTTON);
    await screen.findByText("4 · 100%");
    await clickRowButton(question, RESULTS_BUTTON);
    await waitFor(() => expect(screen.queryByText("4 · 100%")).toBeNull());
  });
});

describe("ankiety - otwieranie i zamykanie głosowania", () => {
  it("szkic dostaje przycisk OTWÓRZ, otwarta ankieta przycisk ZAMKNIJ", async () => {
    // Odwrotny przycisk to nie kosmetyka: „zamknij" na szkicu zamroziłby
    // ankietę, która nigdy nie zbierała głosów, a „otwórz" na otwartej byłby
    // pustym zapisem.
    h.polls = [
      pollRow({ id: "poll-szkic", question_pl: "Szkic ankiety", status: "draft" }),
      pollRow({ id: "poll-otwarta", question_pl: "Otwarta ankieta", status: "open" }),
    ];
    await mountPolls();
    await screen.findByText("Szkic ankiety");

    await clickRowButton("Szkic ankiety", STATUS_BUTTON);
    await waitFor(() => expect(h.statusCalls).toContainEqual({ id: "poll-szkic", status: "open" }));

    await clickRowButton("Otwarta ankieta", STATUS_BUTTON);
    await waitFor(() =>
      expect(h.statusCalls).toContainEqual({ id: "poll-otwarta", status: "closed" }),
    );
  });

  it("ankieta zamknięta daje się otworzyć ponownie", async () => {
    h.polls = [
      pollRow({ id: "poll-zamknieta", question_pl: "Zamknięta ankieta", status: "closed" }),
    ];
    await mountPolls();
    await screen.findByText("Zamknięta ankieta");
    await clickRowButton("Zamknięta ankieta", STATUS_BUTTON);
    await waitFor(() => expect(h.statusCalls).toEqual([{ id: "poll-zamknieta", status: "open" }]));
  });

  it("zmiana statusu UNIEWAŻNIA listę i potwierdza się operatorowi", async () => {
    // Bez unieważnienia lista po zamknięciu ankiety nadal pokazuje ją jako
    // otwartą (`staleTime: 15_000`), więc moderator klika drugi raz.
    h.polls = [pollRow({ id: "poll-otwarta", question_pl: "Otwarta ankieta", status: "open" })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountPolls(queryClient);
    await screen.findByText("Otwarta ankieta");

    await clickRowButton("Otwarta ankieta", STATUS_BUTTON);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-polls"] }));
    expect(h.toastSuccess).toContain(t("adminCommunity.polls.saved"));
  });

  it("odmowa bazy przy zmianie statusu kończy się toastem błędu, nie ciszą", async () => {
    h.polls = [pollRow({ id: "poll-otwarta", question_pl: "Otwarta ankieta", status: "open" })];
    h.statusFails = true;
    await mountPolls();
    await screen.findByText("Otwarta ankieta");

    await clickRowButton("Otwarta ankieta", STATUS_BUTTON);
    await waitFor(() => expect(h.toastError).toContain(t("adminCommunity.polls.failed")));
    expect(h.toastSuccess).toEqual([]);
  });
});

describe("ankiety - kasowanie wymaga potwierdzenia", () => {
  const question = "Ankieta do skasowania";

  it("klik w kosz TYLKO pyta - odmowa zatrzymuje kasowanie", async () => {
    // Kasowanie ankiety zabiera razem z nią wszystkie oddane głosy (kaskada FK
    // na `poll_votes`), więc jedno przypadkowe kliknięcie nie może wystarczyć.
    h.polls = [pollRow({ id: "poll-do-kasacji", question_pl: question })];
    confirmSpy.mockReturnValue(false);
    await mountPolls();
    await screen.findByText(question);

    await clickRowButton(question, TRASH_BUTTON);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Pytanie jedzie ze SŁOWNIKA, nie z literału wpisanego w komponencie.
    expect(confirmSpy).toHaveBeenCalledWith(t("adminCommunity.polls.delete"));
    expect(h.deleted).toEqual([]);
  });

  it("dopiero potwierdzenie kasuje ankietę, unieważnia listę i potwierdza to operatorowi", async () => {
    h.polls = [pollRow({ id: "poll-do-kasacji", question_pl: question })];
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountPolls(queryClient);
    await screen.findByText(question);

    await clickRowButton(question, TRASH_BUTTON);
    await waitFor(() => expect(h.deleted).toEqual(["poll-do-kasacji"]));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-polls"] }));
    expect(h.toastSuccess).toContain(t("adminCommunity.polls.deleted"));
  });

  it("odrzucone kasowanie mówi o błędzie zamiast udawać sukces", async () => {
    h.polls = [pollRow({ id: "poll-do-kasacji", question_pl: question })];
    h.deleteFails = true;
    await mountPolls();
    await screen.findByText(question);

    await clickRowButton(question, TRASH_BUTTON);
    await waitFor(() => expect(h.toastError).toContain(t("adminCommunity.polls.failed")));
    expect(h.toastSuccess).toEqual([]);
  });
});

describe("ankiety - filtr statusu", () => {
  it("wybór statusu jedzie do warstwy danych jako osobne zapytanie", async () => {
    await mountPolls();
    await screen.findByText(t("adminCommunity.polls.noPolls"));
    expect(h.listCalls).toEqual(["all"]);

    const trigger = screen.getByRole("combobox");
    fireEvent.click(
      within(openSelect(trigger)).getByRole("option", { name: t("adminCommunity.polls.draft") }),
    );

    // Filtr jest częścią klucza zapytania, więc zmiana musi POBRAĆ dane
    // ponownie - inaczej moderator widzi listę „wszystkich" pod etykietą
    // „szkice".
    await waitFor(() => expect(h.listCalls).toContain("draft"));
  });
});

describe("ankiety - kreator nowej ankiety", () => {
  const openCreator = async () => {
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.newPoll") }));
    return screen.findByRole("dialog");
  };

  const createButton = () => screen.getByRole("button", { name: t("adminCommunity.polls.create") });

  /** Wpisuje treść do pola opcji - PL i EN mają osobne zastępniki. */
  const fillOption = (index: number, pl: string, en: string) => {
    fireEvent.change(screen.getByPlaceholderText(`PL #${index}`), { target: { value: pl } });
    fireEvent.change(screen.getByPlaceholderText(`EN #${index}`), { target: { value: en } });
  };

  const fillQuestions = () => {
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "  Pytanie zmyślone PL  " } });
    fireEvent.change(inputs[1]!, { target: { value: "  Fictional question EN  " } });
  };

  it("kreator startuje z DWOMA pustymi opcjami - ankieta jednoopcyjna nie jest ankietą", async () => {
    await mountPolls();
    await openCreator();
    expect(screen.getByPlaceholderText("PL #1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("PL #2")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("PL #3")).toBeNull();
  });

  it("pusty formularz ma zablokowany przycisk tworzenia", async () => {
    await mountPolls();
    await openCreator();
    expect(createButton()).toBeDisabled();
  });

  it("same pytania bez kompletnych opcji NIE wystarczą", async () => {
    // CHECK bazy wymaga 2..8 opcji. Panel, który wysłałby jedną, dostałby
    // odmowę z Postgresa - a operator zobaczyłby surowy błąd zamiast podpowiedzi.
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    expect(createButton()).toBeDisabled();
  });

  it("opcja wypełniona SAMYMI SPACJAMI nie liczy się jako opcja", async () => {
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "   ", "   ");
    expect(createButton()).toBeDisabled();
  });

  it("opcja z jedną tylko wersją językową nie liczy się jako opcja", async () => {
    // Bliźniacze kolumny mają być komplet: opcja bez `label_en` renderuje się
    // czytelnikowi anglojęzycznemu jako pusty przycisk do kliknięcia.
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "");
    expect(createButton()).toBeDisabled();
  });

  it("pytanie w jednym tylko języku nie wystarczy", async () => {
    await mountPolls();
    await openCreator();
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "Pytanie zmyślone PL" } });
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");
    expect(createButton()).toBeDisabled();
  });

  it("komplet pytań i dwóch opcji wysyła PRZYCIĘTE wartości i domyślny status `draft`", async () => {
    const queryClient = testClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await mountPolls(queryClient);
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");
    expect(createButton()).toBeEnabled();

    fireEvent.click(createButton());
    await waitFor(() => expect(h.created).toHaveLength(1));
    // Białe znaki z wklejenia nie mogą wejść do bazy: CHECK
    // `btrim(question_pl) <> ''` przepuściłby „  ", a czytelnik zobaczyłby
    // pustą ankietę.
    expect(h.created[0]).toEqual({
      question_pl: "Pytanie zmyślone PL",
      question_en: "Fictional question EN",
      options: [
        { label_pl: "Tak", label_en: "Yes" },
        { label_pl: "Nie", label_en: "No" },
      ],
      ends_at: null,
      // Nowa ankieta domyślnie NIE jest otwarta - inaczej literówka w pytaniu
      // trafiłaby do czytelników, zanim ktokolwiek ją przejrzy.
      status: "draft",
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-polls"] }));
    expect(h.toastSuccess).toContain(t("adminCommunity.polls.created"));
  });

  it("dodana, ale niewypełniona opcja NIE trafia do bazy", async () => {
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.addOption") }));
    expect(screen.getByPlaceholderText("PL #3")).toBeInTheDocument();

    fireEvent.click(createButton());
    await waitFor(() => expect(h.created).toHaveLength(1));
    // Pusta opcja w bazie to pusty przycisk w ankiecie czytelnika.
    expect(h.created[0]?.options).toHaveLength(2);
  });

  it("po ósmej opcji przycisk dodawania jest zablokowany - CHECK bazy kończy się na ośmiu", async () => {
    await mountPolls();
    await openCreator();
    const addOption = screen.getByRole("button", { name: t("adminCommunity.polls.addOption") });
    for (let i = 0; i < 6; i += 1) fireEvent.click(addOption);
    expect(screen.getByPlaceholderText("PL #8")).toBeInTheDocument();
    expect(addOption).toBeDisabled();
  });

  it("trzecią opcję da się usunąć, dwóch pierwszych nie - to minimum ankiety", async () => {
    await mountPolls();
    await openCreator();
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.addOption") }));
    fillOption(3, "Może", "Maybe");

    // Przy trzech opcjach każdy wiersz dostaje krzyżyk; po usunięciu jednej
    // krzyżyki znikają, bo dwie opcje to dno kontraktu.
    const dialog = screen.getByRole("dialog");
    const removeBefore = within(dialog)
      .getAllByRole("button")
      .filter((b) => b.textContent === "");
    expect(removeBefore.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(removeBefore[2]!);

    await waitFor(() => expect(screen.queryByPlaceholderText("PL #3")).toBeNull());
    const removeAfter = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .filter((b) => b.textContent === "");
    expect(removeAfter).toHaveLength(0);
  });

  it("data końca zamienia się na ISO, a puste pole na `null`", async () => {
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");
    const endsAt = screen
      .getByRole("dialog")
      .querySelector<HTMLInputElement>('input[type="datetime-local"]');
    if (!endsAt) throw new Error("test: kreator nie ma pola daty końca");
    fireEvent.change(endsAt, { target: { value: "2026-10-01T12:00" } });

    fireEvent.click(createButton());
    await waitFor(() => expect(h.created).toHaveLength(1));
    // Baza trzyma `timestamptz`; napis z `datetime-local` bez konwersji byłby
    // interpretowany jako czas lokalny serwera, nie operatora.
    expect(h.created[0]?.ends_at).toBe(new Date("2026-10-01T12:00").toISOString());
  });

  it("status `open` z kreatora publikuje ankietę od razu", async () => {
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");

    const dialog = screen.getByRole("dialog");
    const statusTrigger = within(dialog).getByRole("combobox");
    fireEvent.click(
      within(openSelect(statusTrigger)).getByRole("option", {
        name: t("adminCommunity.polls.statusOpen"),
      }),
    );

    fireEvent.click(createButton());
    await waitFor(() => expect(h.created).toHaveLength(1));
    expect(h.created[0]?.status).toBe("open");
  });

  it("sukces zamyka okno i czyści formularz - drugie kliknięcie nie duplikuje ankiety", async () => {
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.created).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await openCreator();
    expect(screen.getByPlaceholderText("PL #1")).toHaveValue("");
    expect(createButton()).toBeDisabled();
  });

  it("odmowa bazy pokazuje JEJ komunikat, nie ogólne „Błąd”", async () => {
    // Komunikat z Postgresa („polls: options must be 2..8") mówi operatorowi,
    // co poprawić; ogólny „Błąd" nie mówi nic.
    h.createFailsWith = "polls: zmyślona odmowa bazy";
    await mountPolls();
    await openCreator();
    fillQuestions();
    fillOption(1, "Tak", "Yes");
    fillOption(2, "Nie", "No");
    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastError).toContain("polls: zmyślona odmowa bazy"));
    // Okno zostaje otwarte - operator ma poprawić to, co odrzucono.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("anulowanie zamyka okno i nic nie wysyła", async () => {
    await mountPolls();
    await openCreator();
    fillQuestions();
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.created).toEqual([]);
  });
});

describe("ankiety - dostępność", () => {
  it("pusty panel ma naruszenia axe WYŁĄCZNIE na filtrze statusu", async () => {
    // Widok pusty jest tu drugim punktem pomiaru: nie ma w nim ani jednego
    // wiersza, więc każde naruszenie pochodzi z RAMY panelu, nie z listy. Lista
    // jest PRZYPIĘTA, a nie wyciszona regułą - dowolne nowe naruszenie wywali
    // ten test zamiast schować się pod flagą.
    const { container } = await mountPolls();
    await screen.findByText(t("adminCommunity.polls.noPolls"));
    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    expect(violations[0]?.nodes).toHaveLength(1);
    expect(violations[0]?.nodes[0]?.html).toContain('role="combobox"');
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZASTANE. Każdy `it.fails` ma obok KONTROLĘ DODATNIĄ, która opisuje
// stan dzisiejszy: naprawa defektu zapali kontrolę i wymusi aktualizację obu.
// ---------------------------------------------------------------------------

describe("ankiety - defekty zastane", () => {
  /**
   * ZŁAMANY KONTRAKT: ODMOWA ODCZYTU JEST NIEODRÓŻNIALNA OD PUSTEJ BAZY.
   * `PollsAdmin` rozgałęzia się tylko na `q.isLoading` i `(q.data ?? []).length
   * === 0`, więc gdy `fetchAdminPolls` rzuci (odmowa RLS, awaria sieci), panel
   * pokazuje „Brak ankiet" - czyli twierdzi, że ankiet NIE MA. To ten sam błąd
   * klasy, co „0 zamiast -" na kafelku statystyk: komunikat o pustce brzmi jak
   * informacja o stanie świata, a jest informacją o nieudanym odczycie.
   * Konsekwencja jest praktyczna: moderator, który po awarii zobaczy „Brak
   * ankiet", tworzy ankietę drugi raz.
   *
   * OCZEKIWANY KONTRAKT: `q.isError` ma własną gałąź - komunikat o odmowie
   * i możliwość ponowienia, nigdy „Brak ankiet".
   *
   * Zapisane jako `it.fails`: naprawa wymaga zmiany pliku trasy (nowa gałąź
   * i nowy klucz i18n), a ten plik nie zmienia zachowania produkcyjnego.
   */
  it.fails("odmowa odczytu listy NIE udaje pustej bazy", async () => {
    h.listFails = true;
    await mountPolls();
    await waitFor(() => expect(h.listCalls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(t("adminCommunity.polls.noPolls"))).toBeNull());
  });

  it("kontrola dodatnia: dziś odmowa pokazuje dokładnie „Brak ankiet”", async () => {
    h.listFails = true;
    await mountPolls();
    expect(await screen.findByText(t("adminCommunity.polls.noPolls"))).toBeInTheDocument();
  });

  it("kontrola dodatnia: przy UDANYM pustym odczycie „Brak ankiet” jest prawdą", async () => {
    // Bez tej kontroli `it.fails` wyżej dałoby się „naprawić" przez usunięcie
    // komunikatu o pustce - a wtedy panel przestałby mówić cokolwiek na
    // poprawnie pustej bazie.
    h.polls = [];
    await mountPolls();
    expect(await screen.findByText(t("adminCommunity.polls.noPolls"))).toBeInTheDocument();
  });

  /**
   * ZŁAMANY KONTRAKT: PANEL SZTABU NIE MA PRAWA ODCZYTU GŁOSÓW.
   * Wyjątek anti-anchoringowy „staff widzi wyniki" jest zaimplementowany
   * W RPC `get_poll_results` (`v_staff := has_role(...)` omija bramkę
   * widoczności). Panel admina tego RPC NIE WOŁA - `fetchPollResults`
   * w `src/lib/admin/community.ts` czyta tabelę wprost:
   * `supabase.from("poll_votes").select("option_idx").eq("poll_id", ...)`.
   * A na `poll_votes` istnieje DOKŁADNIE JEDNA polityka SELECT - „poll votes
   * own read" z `user_id = auth.uid()`. Nie ma polityki sztabowej.
   *
   * KONSEKWENCJA: moderator dostaje z bazy wyłącznie WŁASNY głos, więc panel
   * pokazuje „Brak głosów" albo rozkład 1:0 dla ankiety z tysiącem głosów.
   * Wyjątek dla sztabu istnieje na papierze (w RPC) i nie działa na ekranie,
   * dla którego go napisano.
   *
   * OCZEKIWANY KONTRAKT: albo `poll_votes` dostaje politykę sztabową analogiczną
   * do „polls staff all" (tenant + `has_role admin|editor`), albo panel czyta
   * wyniki przez `get_poll_results` / `get_poll_results_bulk`, które ten wyjątek
   * już implementują.
   *
   * Renderem tego nie widać - atrapa `fetchPollResults` zawsze odda to, co jej
   * każemy - więc dowód idzie odczytem migracji, tą samą techniką, której
   * używa `adminRouteAuthority.gate.test.ts`.
   */
  it.fails("sztab ma prawo odczytu głosów - polityka sztabowa na `poll_votes`", () => {
    const migration = readFileSync(POLLS_MIGRATION, "utf8");
    const pollVotesPolicies = migration
      .split("\n")
      .filter((line) => /CREATE POLICY .* ON public\.poll_votes/.test(line));
    expect(pollVotesPolicies.join("\n")).toMatch(/staff/);
  });

  it("kontrola dodatnia: dziś `poll_votes` ma tylko „own read”, a siostrzana `polls` ma politykę sztabu", () => {
    const migration = readFileSync(POLLS_MIGRATION, "utf8");
    const pollVotesPolicies = migration
      .split("\n")
      .filter((line) => /CREATE POLICY .* ON public\.poll_votes/.test(line));
    // Dokładnie jedna polityka i jest to polityka WŁASNEGO głosu.
    expect(pollVotesPolicies).toEqual(['CREATE POLICY "poll votes own read" ON public.poll_votes']);
    // Kontrola narzędzia: ten sam odczyt ZNAJDUJE politykę sztabową tam, gdzie
    // ona jest - więc `it.fails` wyżej nie pada na zepsutym wyrażeniu.
    expect(migration).toMatch(/CREATE POLICY "polls staff all" ON public\.polls/);
    // I druga połowa: panel faktycznie czyta tabelę, a nie RPC z wyjątkiem.
    const layer = readFileSync(DATA_FILE, "utf8");
    const adminResults = layer.slice(
      layer.indexOf("export async function fetchPollResults"),
      layer.indexOf("// ------- Contributors --------"),
    );
    expect(adminResults).toMatch(/from\("poll_votes"\)/);
    expect(adminResults).not.toMatch(/get_poll_results/);
  });

  /**
   * ZŁAMANY KONTRAKT: KREATOR ZAPISUJE OPCJE W KSZTAŁCIE, KTÓREGO STRONA
   * PUBLICZNA NIE CZYTA.
   * Kreator wysyła `options: [{ label_pl, label_en }]`
   * (`admin.community.polls.tsx:228-231, 251`), a publiczna karta ankiety czyta
   * `opt.pl` / `opt.en` (`src/components/community/PollCard.tsx:52`,
   * typ `PublicPoll` w `src/lib/community/publicQueries.ts`). Ten sam kształt
   * `{pl, en}` produkują ziarna pgTAP i klubowy RPC
   * (`supabase/tests/community_polls_contrib_test.sql`,
   * `20260808220000_discussion_clubs_a20_poll_and_reference_club.sql`).
   *
   * KONSEKWENCJA jest dwustronna:
   *   * ankieta założona w panelu renderuje czytelnikowi PUSTE etykiety opcji
   *     (`opt.en || opt.pl` na obiekcie bez tych pól to `undefined`),
   *   * ankieta założona kanonicznie renderuje MODERATOROWI „#1"/„#2", bo
   *     `pickLocalized(opt, "label", lang)` nic nie znajduje i wchodzi
   *     zapasowa etykieta pozycyjna (dowód niżej, w kontroli dodatniej).
   *
   * OCZEKIWANY KONTRAKT: jeden kształt opcji w całym repo - `{pl, en}`, ten,
   * który czyta strona publiczna i który produkuje baza.
   *
   * Zapisane jako `it.fails`: naprawa dotyka trasy, warstwy danych i migracji
   * (przepisanie istniejących wierszy), a ten plik nie zmienia zachowania
   * produkcyjnego.
   */
  it.fails("kreator zapisuje opcje w kształcie czytanym przez stronę publiczną", async () => {
    await mountPolls();
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.newPoll") }));
    await screen.findByRole("dialog");
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "Pytanie zmyślone PL" } });
    fireEvent.change(inputs[1]!, { target: { value: "Fictional question EN" } });
    fireEvent.change(screen.getByPlaceholderText("PL #1"), { target: { value: "Tak" } });
    fireEvent.change(screen.getByPlaceholderText("EN #1"), { target: { value: "Yes" } });
    fireEvent.change(screen.getByPlaceholderText("PL #2"), { target: { value: "Nie" } });
    fireEvent.change(screen.getByPlaceholderText("EN #2"), { target: { value: "No" } });
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.create") }));

    await waitFor(() => expect(h.created).toHaveLength(1));
    expect(h.created[0]?.options).toEqual([
      { pl: "Tak", en: "Yes" },
      { pl: "Nie", en: "No" },
    ]);
  });

  it("kontrola dodatnia: dziś kreator wysyła `label_pl`/`label_en`, a publiczna karta czyta `pl`/`en`", async () => {
    await mountPolls();
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.newPoll") }));
    await screen.findByRole("dialog");
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "Pytanie zmyślone PL" } });
    fireEvent.change(inputs[1]!, { target: { value: "Fictional question EN" } });
    fireEvent.change(screen.getByPlaceholderText("PL #1"), { target: { value: "Tak" } });
    fireEvent.change(screen.getByPlaceholderText("EN #1"), { target: { value: "Yes" } });
    fireEvent.change(screen.getByPlaceholderText("PL #2"), { target: { value: "Nie" } });
    fireEvent.change(screen.getByPlaceholderText("EN #2"), { target: { value: "No" } });
    fireEvent.click(screen.getByRole("button", { name: t("adminCommunity.polls.create") }));

    await waitFor(() => expect(h.created).toHaveLength(1));
    expect(h.created[0]?.options).toEqual([
      { label_pl: "Tak", label_en: "Yes" },
      { label_pl: "Nie", label_en: "No" },
    ]);
    const publicCard = readFileSync("src/components/community/PollCard.tsx", "utf8");
    expect(publicCard).toMatch(/opt\.en \|\| opt\.pl/);
  });

  /**
   * Druga strona tej samej rozbieżności, tym razem widoczna RENDEREM: ankieta
   * z opcjami w kanonicznym kształcie `{pl, en}` (taki produkują ziarna pgTAP
   * i klubowy RPC) pokazuje w panelu etykiety pozycyjne „#1"/„#2" zamiast
   * treści opcji. Moderator ocenia rozkład głosów, nie wiedząc, na co ludzie
   * głosowali.
   */
  it.fails("panel pokazuje treść opcji zapisanych w kanonicznym kształcie `{pl, en}`", async () => {
    h.polls = [
      pollRow({
        id: "poll-kanoniczna",
        question_pl: "Ankieta z bazy",
        options: [
          { pl: "Zgoda", en: "Agree" },
          { pl: "Sprzeciw", en: "Disagree" },
        ],
      }),
    ];
    h.results = { "0": 2, "1": 1 };
    await mountPolls();
    await clickRowButton("Ankieta z bazy", RESULTS_BUTTON);
    expect(await screen.findByText("Zgoda")).toBeInTheDocument();
  });

  it("kontrola dodatnia: dziś takie opcje renderują się jako „#1”/„#2”", async () => {
    h.polls = [
      pollRow({
        id: "poll-kanoniczna",
        question_pl: "Ankieta z bazy",
        options: [
          { pl: "Zgoda", en: "Agree" },
          { pl: "Sprzeciw", en: "Disagree" },
        ],
      }),
    ];
    h.results = { "0": 2, "1": 1 };
    await mountPolls();
    await clickRowButton("Ankieta z bazy", RESULTS_BUTTON);
    expect(await screen.findByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    // Kontrola narzędzia: w kształcie panelowym te same etykiety WIDAĆ, więc
    // `it.fails` wyżej nie pada na zepsutym zapytaniu do DOM.
    cleanup();
    h.polls = [
      pollRow({
        id: "poll-panelowa",
        question_pl: "Ankieta z panelu",
        options: [{ label_pl: "Zgoda", label_en: "Agree" }],
      }),
    ];
    await mountPolls();
    await clickRowButton("Ankieta z panelu", RESULTS_BUTTON);
    expect(await screen.findByText("Zgoda")).toBeInTheDocument();
  });

  /**
   * ZŁAMANY KONTRAKT: TRZY PRZYCISKI OPERACYJNE WIERSZA NIE MAJĄ NAZWY
   * DOSTĘPNEJ. `<Button size="sm" variant="ghost"><Trash2/></Button>` nie ma
   * ani `aria-label`, ani `title`, ani tekstu, a ikona `lucide-react` nic nie
   * wnosi do drzewa dostępności. Czytnik ekranu czyta trzy razy „przycisk",
   * a jeden z nich KASUJE ankietę razem ze wszystkimi głosami.
   *
   * OCZEKIWANY KONTRAKT: każdy przycisk operacyjny ma nazwę dostępną (klucze
   * w słowniku już są: `adminCommunity.polls.delete`, `.open`, `.closed`).
   */
  it.fails("panel z wierszami nie ma naruszeń axe", async () => {
    h.polls = [pollRow({ question_pl: "Ankieta z przyciskami" })];
    const { container } = await mountPolls();
    await screen.findByText("Ankieta z przyciskami");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("kontrola dodatnia: dziś naruszenia to DOKŁADNIE cztery bezimienne przyciski", async () => {
    h.polls = [pollRow({ question_pl: "Ankieta z przyciskami" })];
    const { container } = await mountPolls();
    await screen.findByText("Ankieta z przyciskami");
    const violations = await axeViolations(container);
    // Reguły NIE wyciszamy - lista jest PRZYPIĘTA, więc każde nowe naruszenie
    // wywali tę kontrolę zamiast schować się pod flagą (`it.fails` wyżej jest
    // czerwony niezależnie od powodu i sam by tego nie pokazał).
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    const html = violations[0]?.nodes.map((n) => n.html) ?? [];
    expect(html).toHaveLength(4);
    // Jeden z nich to filtr statusu, trzy pozostałe to ikonowe przyciski wiersza
    // (wynik i18n nie ma z tym nic wspólnego - te przyciski nie mają ŻADNEGO
    // tekstu do przetłumaczenia).
    expect(html.filter((node) => node.includes('role="combobox"'))).toHaveLength(1);
    const row = pollRowElement("Ankieta z przyciskami");
    const rowButtons = within(row).getAllByRole("button");
    expect(rowButtons).toHaveLength(3);
    for (const button of rowButtons) {
      const name =
        button.getAttribute("aria-label") ??
        button.getAttribute("title") ??
        (button.textContent ?? "").trim();
      expect(name).toBe("");
    }
  });
});
