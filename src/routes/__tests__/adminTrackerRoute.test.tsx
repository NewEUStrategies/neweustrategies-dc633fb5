// Trasy `/admin/tracker` i `/admin/tracker-guide` ZAMONTOWANE - panel dossier
// legislacyjnych UE (CRUD dossier, stanowiska państw, powiązania aktów, wpisy
// osi czasu) i jego dokumentacja.
//
// ─────────────────────────────────────────────────────────────────────────────
// USTALENIE, KTÓREGO SZUKAŁO ZADANIE: DLACZEGO TA TRASA OMIJA
// `src/lib/tracker/queries.ts`, choć biblioteka stoi na 100%.
//
// Biblioteka jest WARSTWĄ PUBLICZNEGO ODCZYTU, nie warstwą danych trackera.
// Trzy z czterech odczytów panelu NIE MOGĄ jej użyć, a jeden mógł - i po tej
// pracy używa:
//
//   1. LISTA DOSSIER - NIE MOŻE. `fetchPublishedItems` ma na sztywno
//      `.eq("status", "published")`, a panel istnieje po to, żeby redagować
//      SZKICE (`EMPTY_ITEM.status === "draft"`). Do tego biblioteka porządkuje
//      po `importance desc, updated_at desc` i tnie okno do
//      `TRACKER_PAGE_SIZE`, a panel chce najświeżej ruszanych na górze
//      (`updated_at desc`, limit 200). Użycie biblioteki schowałoby przed
//      redakcją dokładnie te wiersze, po które tu wchodzi.
//   2. POWIĄZANIA AKTÓW - NIE MOGĄ. `fetchRelatedItems` osadza drugą stronę
//      krawędzi i ODFILTROWUJE wszystko, co nie jest `published`. Panel
//      dowiązuje szkic do szkicu, więc dostałby puste listy i „brak
//      powiązań" nad krawędziami, które istnieją.
//   3. WPISY OSI CZASU - NIE MOGĄ. Panel tylko PISZE do `eu_policy_updates`
//      (biblioteka ma tam wyłącznie odczyt), a wszystkie zapisy trackera to
//      zapisy redakcyjne pod RLS, z `tenant_id` pinowanym triggerem - w
//      bibliotece publicznego odczytu nie mają czego robić. Jedyne mutacje
//      biblioteki (`followItem` / `unfollowItem`) są czynnością CZYTELNIKA.
//   4. STANOWISKA PAŃSTW - MOGŁY I TERAZ UŻYWAJĄ. `fetchPositions(itemId)` to
//      dokładnie zapytanie panelu: ta sama tabela, ta sama lista kolumn
//      (`POSITION_FIELDS` == literał, który stał w trasie) i ten sam filtr po
//      dossier. Różnica to wyłącznie `.order("country_code")`, a panel indeksuje
//      wynik po kodzie kraju (`rowFor`), więc kolejność jest dla niego
//      nieobserwowalna. Duplikat usunięty; klucz cache ZOSTAŁ w przestrzeni
//      `["admin", ...]`, bo panel czyta stanowiska dossier nieopublikowanych
//      i jego wynik nie może wpaść do wpisu współdzielonego ze stroną
//      publiczną (`["tracker", "positions", id]`).
//
// PODWÓJNE UNIEWAŻNIANIE JEST WIĘC KONSEKWENCJĄ, NIE NIEDBALSTWEM: skoro panel
// ma własną przestrzeń kluczy, każdy zapis musi ruszyć DWA prefiksy - swój
// i publiczny. I to publiczny W CAŁOŚCI, w jakiej zapis go zmienia: wpis osi
// czasu z etapem przestawia TRIGGEREM etap dossier (strona, lista, statystyki,
// feed zmian), a stanowiska czyta też macierz explorera pod kluczem
// `positions-bulk`. Do tej pracy oba zapisy unieważniały tylko klucz własnego
// dossier - testy regresyjne niżej dowodzą tego po STANIE cache'u.
// ─────────────────────────────────────────────────────────────────────────────
//
// DWIE REGUŁY EDYTORA (od tej pracy):
//   * KAŻDE POLE TRAFIA DO SWOJEJ KOLUMNY. Pola tekstowe mają jeden binder
//     (różnią się tylko kluczem), więc zamiana kluczy nie daje błędu - tylko
//     dossier z treścią w złej kolumnie. Test tabelaryczny wypełnia wszystkie
//     pola RÓŻNYMI wartościami i porównuje CAŁY ładunek.
//   * KAŻDE POLE MA NAZWĘ DOSTĘPNĄ. Etykiety stały obok pól bez `htmlFor`, więc
//     edytor był dla czytnika ekranu listą bezimiennych pól; `getByLabelText`
//     w teście tabelarycznym jest też dowodem tej naprawy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOSTĘPU: `/admin` przepuszcza tylko `isStaff`, a prawo zapisu do tabel
//   `eu_policy_*` egzekwuje RLS; warstw pilnuje
//   `src/routes/__tests__/adminRouteAuthority.gate.test.ts`. Ta trasa nie ma
//   własnej bramki roli - i nie czyta nawet tenanta, bo `tenant_id` pinują
//   triggery bazy (`tg_eu_policy_position_pin`, `tg_eu_policy_link_pin`,
//   `tg_eu_policy_update_applied`). Test na to jest niżej: panel NIE MOŻE
//   wysyłać tenanta z klienta, bo klient go nie zna.
// - `runTrackerTickNow`: funkcja serwerowa z własnym zestawem middleware
//   i testami w `src/lib/__tests__/trackerAdminFunctions.test.ts`; tutaj jest
//   atrapą, bo przedmiotem dowodu jest komunikat po jej powrocie.
// - ETAPÓW I OBSZARÓW: `STAGE_LABELS`, `POLICY_AREAS`, `EU_COUNTRIES`,
//   `STANCE_META` to dane słownikowe z własnymi asercjami.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Wynik funkcji serwerowej ticka; `null` = ma odrzucić. */
  tickResult: { push: { sent: 0 } } as { push: { sent: number } } | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-tracker", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-tracker-guide", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  h.db = db;
  return { supabase: { from: db.from } };
});
// Funkcja serwerowa ticka: `useServerFn` opakowuje ją transportem RPC, którego
// w teście jednostkowym nie ma. Atrapa oddaje sam kontrakt wartości zwrotnej.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => async () => {
    if (h.tickResult === null) throw new Error("test: tick padł");
    return h.tickResult;
  },
}));
vi.mock("@/lib/tracker-admin.functions", () => ({ runTrackerTickNow: () => undefined }));
vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});
// Wybór daty kamienia milowego ma własny organizm (kalendarz Radix + maska);
// tutaj przedmiotem dowodu jest ładunek zapisu, więc pole staje się natywnym
// `<input>` zachowującym `value`/`onChange`.
vi.mock("@/components/admin/blocks/AdminDatePicker", async () => {
  const react = await import("react");
  return {
    AdminDatePicker: ({ value, onChange }: { value?: string; onChange?: (next: string) => void }) =>
      react.createElement("input", {
        "aria-label": "milestone-date",
        value: value ?? "",
        onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
      }),
  };
});
// Harness montuje JEDNĄ trasę, więc `/admin/tracker-guide` nie istnieje
// w drzewie - `Link` zamieniamy na zwykły odnośnik i asertujemy CEL.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const react = await import("react");
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children?: ReactNode }) =>
      react.createElement("a", { href: to }, children as never),
  };
});

import { ok, fail } from "@/test/supabaseChain";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as TrackerRoute } from "@/routes/admin.tracker";
import { Route as TrackerGuideRoute } from "@/routes/admin.tracker-guide";
import { EU_COUNTRIES } from "@/lib/tracker/euCountries";

const PATH = "/admin/tracker";
const GUIDE_PATH = "/admin/tracker-guide";
const SLUG = "akt-o-odpornosci";

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nie została ustawiona");
  return h.db;
}

/** Dossier legislacyjne. Tytuły i sprawozdawcy WYMYŚLENI (RODO w fixtures). */
function item(patch: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    tenant_id: "11111111-1111-4111-8111-111111111111",
    slug: "akt-o-odpornosci",
    title_pl: "Akt o odporności cyfrowej",
    title_en: "Digital Resilience Act",
    summary_pl: "Wymogi ciągłości działania.",
    summary_en: "Continuity requirements.",
    policy_area: "general",
    stage: "proposal",
    importance: 2,
    reference: "COM(2026) 100",
    source_url: null,
    rapporteur: null,
    committee: null,
    lead_dg: null,
    next_milestone_pl: null,
    next_milestone_en: null,
    next_milestone_at: null,
    status: "draft",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...patch,
  };
}

async function mount() {
  return renderRoute({ route: TrackerRoute, path: PATH, initialEntry: PATH });
}

function chainsFor(table: string): RecordedChain[] {
  return db().chainsFor(table);
}

/** Łańcuch danej tabeli zawierający dane ogniwo - twardy błąd, gdy go nie ma. */
function chainWith(table: string, method: string): RecordedChain {
  const found = chainsFor(table).find((c) => c.has(method));
  if (!found) throw new Error(`test: brak łańcucha "${table}" z ogniwem "${method}"`);
  return found;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

/** Pierwszy argument ogniwa `method` z łańcucha tabeli - twardy błąd, gdy go nie ma. */
function payloadOf(table: string, method: string): unknown {
  return chainWith(table, method).argsOf(method)?.[0];
}

/**
 * Zasiewa w kliencie zapytań wpisy PUBLICZNEJ przestrzeni trackera - takie,
 * jakie zostawia w tej samej sesji wizyta na stronie dossier, liście, feedzie
 * zmian i w explorerze. Brak obserwatorów = brak refetchu, więc `isInvalidated`
 * po zapisie jest czystym dowodem, KTÓRE z nich zapis unieważnił.
 */
const PUBLIC_ENTRIES = {
  item: ["tracker", "item", SLUG],
  items: ["tracker", "items", "all", "all", 12],
  updates: ["tracker", "updates", ITEM_ID],
  recent: ["tracker", "recent-updates", 40],
  stats: ["tracker", "stats"],
  positions: ["tracker", "positions", ITEM_ID],
  positionsBulk: ["tracker", "positions-bulk", `${ITEM_ID},${OTHER_ITEM_ID}`],
} as const;

function seedPublicCache(client: QueryClient): void {
  for (const key of Object.values(PUBLIC_ENTRIES)) client.setQueryData(key, []);
}

function invalidated(client: QueryClient, key: readonly unknown[]): boolean | undefined {
  return client.getQueryState(key)?.isInvalidated;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tickResult = { push: { sent: 0 } };
  db().reset();
  db().setResponse("eu_policy_items", (chain) => (chain.has("select") ? ok([item()]) : ok([])));
  db().setResponse("eu_policy_positions", () => ok([]));
  db().setResponse("eu_policy_links", () => ok([]));
  db().setResponse("eu_policy_updates", () => ok([]));
});

afterEach(() => cleanup());

describe("admin.tracker - sklejenie trasy i lista dossier", () => {
  it("czyta dossier BEZ filtra publikacji - panel istnieje dla szkiców", async () => {
    // To jest powód, dla którego trasa nie może użyć `fetchPublishedItems`.
    // Filtr `status = 'published'` w tym miejscu ukryłby przed redakcją
    // wszystkie szkice - czyli wszystko, co jest w robocie.
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);

    const chain = chainWith("eu_policy_items", "select");
    const statusFilters = chain.calls
      .filter((c) => c.method === "eq")
      .filter((c) => c.args[0] === "status");
    expect(statusFilters).toEqual([]);
    expect(chain.calls.filter((c) => c.method === "order").map((c) => c.args[0])).toEqual([
      "updated_at",
    ]);
  });

  it("klucz cache listy siedzi w PRZESTRZENI PANELU, nie w publicznej", async () => {
    // Wynik zawiera szkice. Wpadnięcie do klucza `["tracker", ...]` oznaczałoby,
    // że publiczna lista trackera w tej samej sesji przeglądarki pokazuje
    // dossier, których nikt nie opublikował.
    const view = await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);

    const keys = view.queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey);
    expect(keys).toContainEqual(["admin", "tracker-items"]);
    for (const key of keys) {
      expect(Array.isArray(key) && key[0] === "tracker", `klucz ${JSON.stringify(key)}`).toBe(
        false,
      );
    }
  });

  it("pusta lista nie wywala panelu i zostawia drogę dodania dossier", async () => {
    db().setResponse("eu_policy_items", () => ok([]));
    await mount();

    expect(await screen.findByText("adminTracker.euLegislativeTracker")).toBeInTheDocument();
    expect(button("adminTracker.newDossier")).toBeInTheDocument();
  });

  it("awaria odczytu listy nie wywala panelu - nagłówek i akcje zostają", async () => {
    // Panel, który przy odmowie RLS pokazuje biały ekran, odcina operatora
    // także od przycisku „uruchom tick teraz" - czyli od jedynej ręcznej
    // drogi odświeżenia danych trackera.
    db().setResponse("eu_policy_items", () => fail("test: eu_policy_items niedostępne", "42501"));
    await mount();

    expect(await screen.findByText("adminTracker.euLegislativeTracker")).toBeInTheDocument();
    expect(button("adminTracker.runTickNow")).toBeInTheDocument();
  });

  it("prowadzi do własnej dokumentacji panelu", async () => {
    // Instrukcja konfiguracji źródeł jest osobną trasą; link do niej jest
    // jedynym wejściem, bo w nawigacji panelu jej nie ma.
    await mount();

    expect(screen.getByRole("link", { name: /adminTracker\.howWorks/ })).toHaveAttribute(
      "href",
      GUIDE_PATH,
    );
  });

  it("panel nie zostawia w nagłówku pustego tytułu", async () => {
    const meta = await routeMeta(TrackerRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("admin.tracker - ręczny tick pobrania", () => {
  it("udany tick mówi, ILE powiadomień poszło w świat", async () => {
    // Operator uruchamia tick, żeby dowiedzieć się, czy zmiany dojechały.
    // Komunikat bez liczby powiadomień nie odpowiada na to pytanie.
    h.tickResult = { push: { sent: 3 } };
    await mount();
    fireEvent.click(button("adminTracker.runTickNow"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminTracker.tickComplete(count=3)"),
    );
  });

  it("nieudany tick pokazuje błąd i NIE udaje sukcesu", async () => {
    h.tickResult = null;
    await mount();
    fireEvent.click(button("adminTracker.runTickNow"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("test: tick padł"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("admin.tracker - zapis dossier", () => {
  async function openNew() {
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.newDossier"));
    return screen.findByText("adminTracker.newDossier", { selector: "div" });
  }

  it("nowe dossier jedzie INSERTEM, a puste pola tekstowe jako `null`, nie pusty ciąg", async () => {
    // `nullifyEmpty` jest tu jedyną barierą: pusty ciąg w kolumnie referencji
    // wychodzi na stronie publicznej jako pusty nawias przy tytule dossier,
    // a w kolumnie daty kamienia - jako błąd rzutowania na `date`.
    await openNew();
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "akt-o-danych" } });
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_items").some((c) => c.has("insert"))).toBe(true),
    );
    const payload = chainWith("eu_policy_items", "insert").argsOf("insert")?.[0];
    expect(payload).toMatchObject({ slug: "akt-o-danych", status: "draft" });
    expect(payload).toMatchObject({ reference: null, next_milestone_at: null, source_url: null });
  });

  it("ładunek dossier NIE niesie `tenant_id` - obszar roboczy pina baza", async () => {
    // Klient nie zna tenanta na tej trasie (nie czyta `useRequiredTenant`),
    // a `tg_eu_policy_*` przypina go po stronie bazy. Pole podane z klienta
    // byłoby polem, którym da się celować w cudzy obszar roboczy.
    await openNew();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "akt-o-danych" } });
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_items").some((c) => c.has("insert"))).toBe(true),
    );
    const payload = chainWith("eu_policy_items", "insert").argsOf("insert")?.[0];
    expect(Object.keys(payload as Record<string, unknown>)).not.toContain("tenant_id");
  });

  it("edycja jedzie UPDATE po identyfikatorze dossier, nie INSERTEM", async () => {
    // Zapis edycji wykonany insertem tworzy DRUGIE dossier o tym samym slugu -
    // czyli dwie strony publiczne tego samego aktu.
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.edit"));
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_items").some((c) => c.has("update"))).toBe(true),
    );
    expect(chainWith("eu_policy_items", "update").argsOf("eq")).toEqual(["id", ITEM_ID]);
    expect(chainsFor("eu_policy_items").some((c) => c.has("insert"))).toBe(false);
  });

  it("udany zapis unieważnia OBA prefiksy: panelu i publiczny", async () => {
    // KONSEKWENCJA rozdzielenia przestrzeni kluczy (patrz nagłówek pliku):
    // bez drugiego unieważnienia publiczna lista trackera w tej samej sesji
    // pokazuje dossier w starym etapie - a etap jest tym, po co ludzie
    // wchodzą na tracker.
    const view = await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button("adminTracker.edit"));
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminTracker.dossierSaved"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "tracker-items"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tracker"] });
  });

  it("błąd zapisu pokazuje komunikat i NIE chwali", async () => {
    db().setResponse("eu_policy_items", (chain) =>
      chain.has("select") ? ok([item()]) : fail("test: odmowa polityki RLS", "42501"),
    );
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.edit"));
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("admin.tracker - pola edytora dossier", () => {
  async function openNew() {
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.newDossier"));
    await screen.findByLabelText("Slug");
  }

  /** [etykieta pola, wpisana wartość] - wartości RÓŻNE, żeby zamiana kluczy była widoczna. */
  const TEXT_FIELDS = [
    ["Slug", "  akt-o-danych  "],
    ["adminTracker.reference", " COM(2026) 7 "],
    ["adminTracker.titlePl", " Akt o danych "],
    ["adminTracker.titleEn", " Data Act "],
    ["adminTracker.summaryPl", "Streszczenie PL"],
    ["adminTracker.summaryEn", "Summary EN"],
    ["adminTracker.rapporteur", "Anna Nowak (S&D)"],
    ["adminTracker.leadCommittee", "ITRE"],
    ["adminTracker.commissionDg", "DG CNECT"],
    ["adminTracker.nextMilestonePl", "Głosowanie plenarne"],
    ["adminTracker.nextMilestoneEn", "Plenary vote"],
    ["adminTracker.sourceUrl", " https://example.org/akt "],
  ] as const;

  it("każde pole edytora trafia do SWOJEJ kolumny ładunku - przycięte", async () => {
    await openNew();
    for (const [label, value] of TEXT_FIELDS) change(screen.getByLabelText(label), value);
    change(screen.getByLabelText("adminTracker.area"), "digital");
    change(screen.getByLabelText("adminTracker.stage"), "trilogue");
    change(screen.getByLabelText("adminTracker.importance"), "3");
    change(screen.getByLabelText("Status"), "published");
    change(screen.getByLabelText("milestone-date"), "2026-11-05");
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_items").some((c) => c.has("insert"))).toBe(true),
    );
    // `toEqual` na CAŁYM ładunku: brak pola to błąd, nadmiarowe pole (np.
    // `tenant_id`) też. `importance` jedzie liczbą - kolumna jest `integer`
    // z CHECK 1..3, a ciąg „3" byłby rzutowaniem po stronie bazy.
    expect(payloadOf("eu_policy_items", "insert")).toEqual({
      slug: "akt-o-danych",
      reference: "COM(2026) 7",
      title_pl: "Akt o danych",
      title_en: "Data Act",
      summary_pl: "Streszczenie PL",
      summary_en: "Summary EN",
      policy_area: "digital",
      stage: "trilogue",
      importance: 3,
      status: "published",
      rapporteur: "Anna Nowak (S&D)",
      committee: "ITRE",
      lead_dg: "DG CNECT",
      next_milestone_pl: "Głosowanie plenarne",
      next_milestone_en: "Plenary vote",
      next_milestone_at: "2026-11-05",
      source_url: "https://example.org/akt",
    });
  });

  it("edycja BEZ zmian oddaje wartości dossier i nie zamienia `null` w pusty ciąg", async () => {
    // `itemToDraft` zamienia `null` na "" (pola formularza), a `nullifyEmpty`
    // z powrotem. Pęknięcie którejś połowy zapisuje przy KAŻDYM „zapisz"
    // puste ciągi w kolumnach opcjonalnych - a pusty `next_milestone_at` to
    // błąd rzutowania na `date`.
    db().setResponse("eu_policy_items", (chain) =>
      chain.has("select")
        ? ok([item({ rapporteur: "Ewa Wiśniewska (EPP)", next_milestone_at: "2026-12-01" })])
        : ok([]),
    );
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.edit"));

    expect(screen.getByLabelText("adminTracker.titlePl")).toHaveValue("Akt o odporności cyfrowej");
    fireEvent.click(button("adminTracker.save"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_items").some((c) => c.has("update"))).toBe(true),
    );
    expect(payloadOf("eu_policy_items", "update")).toMatchObject({
      slug: SLUG,
      reference: "COM(2026) 100",
      rapporteur: "Ewa Wiśniewska (EPP)",
      next_milestone_at: "2026-12-01",
      source_url: null,
      committee: null,
      lead_dg: null,
      next_milestone_pl: null,
    });
  });

  it("anulowanie zamyka edytor BEZ zapisu", async () => {
    await openNew();
    change(screen.getByLabelText("Slug"), "porzucony-szkic");
    fireEvent.click(button("adminTracker.cancel"));

    expect(screen.queryByLabelText("Slug")).toBeNull();
    expect(chainsFor("eu_policy_items").some((c) => c.has("insert") || c.has("update"))).toBe(
      false,
    );
  });
});

describe("admin.tracker - stanowiska państw członkowskich", () => {
  async function openPositions() {
    const view = await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.positions"));
    await screen.findByRole("dialog", { name: "adminTracker.memberStatePositions" });
    // Okno startuje w stanie wczytywania (przycisk zapisu jest wtedy
    // zablokowany), więc czekamy na PIERWSZY wiersz kraju - inaczej klik
    // w „zapisz" trafiałby w martwy przycisk i test nie dowodziłby niczego.
    await screen.findByText(EU_COUNTRIES[0].pl);
    return view;
  }

  it("okno zamknięte NIE pyta bazy o stanowiska", async () => {
    // `enabled: open` jest tu oszczędnością o realnej wadze: lista dossier
    // ma do 200 wierszy, a każdy wiersz ma ten przycisk. Odczyt bez warunku
    // to 200 zapytań na wejście do panelu.
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);

    expect(chainsFor("eu_policy_positions")).toEqual([]);
  });

  it("otwarcie okna czyta stanowiska TEGO dossier - przez bibliotekę", async () => {
    // Po zmianie odczyt idzie `fetchPositions` z `src/lib/tracker/queries.ts`:
    // ta sama tabela, ta sama lista kolumn, ten sam filtr, plus porządek po
    // kodzie kraju (dla panelu nieobserwowalny - indeksuje po kodzie).
    await openPositions();

    await waitFor(() => expect(chainsFor("eu_policy_positions").length).toBe(1));
    const chain = chainWith("eu_policy_positions", "select");
    expect(chain.argsOf("eq")).toEqual(["item_id", ITEM_ID]);
    expect(String(chain.argsOf("select")?.[0])).toBe(
      "item_id,country_code,stance,note_pl,note_en,updated_at",
    );
  });

  it("zapis stanowisk pomija kraje bez stanowiska i podaje ZEROWY tenant jako zaślepkę", async () => {
    // Kolumna `tenant_id` jest w typie wymagana, a wartość z klienta nadpisuje
    // trigger `tg_eu_policy_position_pin`. Zaślepka MUSI być zerowym UUID-em:
    // podanie tam czegokolwiek innego (np. tenanta z sesji) wyglądałoby jak
    // deklaracja obszaru roboczego, a przy zmianie triggera BYŁOBY nią.
    await openPositions();
    const selects = screen
      .getAllByRole("combobox")
      .filter((el) => el.querySelector('option[value="none"]'));
    expect(selects.length).toBe(EU_COUNTRIES.length);
    fireEvent.change(selects[0], { target: { value: "support" } });
    fireEvent.click(button("adminTracker.savePositions"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_positions").some((c) => c.has("upsert"))).toBe(true),
    );
    const upsert = chainWith("eu_policy_positions", "upsert");
    const rows = upsert.argsOf("upsert")?.[0];
    expect(Array.isArray(rows) ? rows.length : -1).toBe(1);
    expect(Array.isArray(rows) ? rows[0] : null).toMatchObject({
      item_id: ITEM_ID,
      country_code: EU_COUNTRIES[0].code,
      stance: "support",
      tenant_id: ZERO_UUID,
    });
    expect(upsert.argsOf("upsert")?.[1]).toEqual({ onConflict: "item_id,country_code" });
  });

  it("zapis stanowisk unieważnia OBA prefiksy - panelu i publiczny", async () => {
    const view = await openPositions();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    fireEvent.click(button("adminTracker.savePositions"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminTracker.positionsSaved"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "tracker-positions", ITEM_ID] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tracker", "positions", ITEM_ID] });
  });

  it("zapis stanowisk unieważnia też MACIERZ explorera (`positions-bulk`)", async () => {
    // Regresja: explorer czyta stanowiska wielu dossier pod kluczem
    // `["tracker", "positions-bulk", <id,...>]`, którego prefiks
    // `["tracker", "positions"]` NIE łapie (inny drugi element). Macierz
    // w tej samej sesji pokazywała stanowisko sprzed zapisu.
    const view = await openPositions();
    seedPublicCache(view.queryClient);
    fireEvent.click(button("adminTracker.savePositions"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminTracker.positionsSaved"));
    expect(invalidated(view.queryClient, PUBLIC_ENTRIES.positions)).toBe(true);
    expect(invalidated(view.queryClient, PUBLIC_ENTRIES.positionsBulk)).toBe(true);
  });

  it("wyczyszczenie ISTNIEJĄCEGO stanowiska to DELETE tego kraju, a nie upsert 'none'", async () => {
    // „none" jest wyłącznie etykietą interfejsu; w bazie stanowisko „brak"
    // to BRAK WIERSZA. Kraje, które stanowiska nie miały i nadal nie mają,
    // nie mogą trafić ani do upsertu, ani do usunięcia.
    const [first, second] = EU_COUNTRIES;
    db().setResponse("eu_policy_positions", (chain) =>
      chain.has("select")
        ? ok([
            {
              item_id: ITEM_ID,
              country_code: first.code,
              stance: "support",
              note_pl: null,
              note_en: null,
            },
            {
              item_id: ITEM_ID,
              country_code: second.code,
              stance: "oppose",
              note_pl: "Sprzeciw",
              note_en: null,
            },
          ])
        : ok([]),
    );
    await openPositions();
    const stance = screen.getByLabelText(`${first.code} - adminTracker.stance`);
    await waitFor(() => expect(stance).toHaveValue("support"));
    change(stance, "none");
    fireEvent.click(button("adminTracker.savePositions"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_positions").some((c) => c.has("delete"))).toBe(true),
    );
    const del = chainWith("eu_policy_positions", "delete");
    expect(del.argsOf("eq")).toEqual(["item_id", ITEM_ID]);
    expect(del.argsOf("in")).toEqual(["country_code", [first.code]]);
    // Drugi kraj ZOSTAJE - z notatką z bazy, nie z pustym draftem.
    const rows = payloadOf("eu_policy_positions", "upsert");
    expect(rows).toEqual([
      {
        item_id: ITEM_ID,
        country_code: second.code,
        stance: "oppose",
        note_pl: "Sprzeciw",
        note_en: null,
        tenant_id: ZERO_UUID,
      },
    ]);
  });

  it("notatki stanowiska jadą PRZYCIĘTE, a puste jako `null`", async () => {
    const code = EU_COUNTRIES[0].code;
    await openPositions();
    change(screen.getByLabelText(`${code} - adminTracker.stance`), "support");
    change(screen.getByLabelText(`${code} - adminTracker.notePl`), "  Popiera z zastrzeżeniami  ");
    change(screen.getByLabelText(`${code} - adminTracker.noteEn`), "   ");
    fireEvent.click(button("adminTracker.savePositions"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_positions").some((c) => c.has("upsert"))).toBe(true),
    );
    expect(payloadOf("eu_policy_positions", "upsert")).toEqual([
      expect.objectContaining({
        country_code: code,
        note_pl: "Popiera z zastrzeżeniami",
        note_en: null,
      }),
    ]);
  });

  it("błąd zapisu stanowisk daje komunikat i NIE zamyka okna", async () => {
    // Zamknięcie okna po błędzie wyrzuca 27 wierszy wpisanych stanowisk.
    db().setResponse("eu_policy_positions", (chain) =>
      chain.has("upsert") ? fail("test: odmowa zapisu stanowisk", "42501") : ok([]),
    );
    await openPositions();
    change(screen.getByLabelText(`${EU_COUNTRIES[0].code} - adminTracker.stance`), "support");
    fireEvent.click(button("adminTracker.savePositions"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("test: odmowa zapisu stanowisk"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "adminTracker.memberStatePositions" }),
    ).toBeInTheDocument();
  });

  it("anulowanie okna stanowisk zamyka je BEZ zapisu", async () => {
    await openPositions();
    change(screen.getByLabelText(`${EU_COUNTRIES[0].code} - adminTracker.stance`), "support");
    fireEvent.click(button("adminTracker.cancel"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chainsFor("eu_policy_positions").some((c) => c.has("upsert"))).toBe(false);
  });
});

describe("admin.tracker - powiązania aktów", () => {
  async function openLinks() {
    db().setResponse("eu_policy_items", (chain) =>
      chain.has("select")
        ? ok([item(), item({ id: OTHER_ITEM_ID, slug: "akt-o-danych", title_pl: "Akt o danych" })])
        : ok([]),
    );
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(screen.getAllByRole("button", { name: "adminTracker.links" })[0]);
    return screen.findByRole("dialog", { name: "adminTracker.relatedFiles" });
  }

  it("czyta powiązania BEZ filtra publikacji drugiej strony krawędzi", async () => {
    // To jest powód, dla którego trasa nie może użyć `fetchRelatedItems`:
    // tamta funkcja odfiltrowuje wszystko, co nie jest `published`, więc panel
    // dowiązujący szkic do szkicu widziałby „brak powiązań" nad istniejącą
    // krawędzią - i redakcja dodałaby ją po raz drugi.
    await openLinks();

    await waitFor(() => expect(chainsFor("eu_policy_links").length).toBe(1));
    const chain = chainWith("eu_policy_links", "select");
    expect(String(chain.argsOf("select")?.[0])).toBe("related_item_id, relation");
    expect(chain.argsOf("eq")).toEqual(["item_id", ITEM_ID]);
  });

  it("dodanie powiązania bez wybranego dossier jest ZABLOKOWANE i nie puka do bazy", async () => {
    // Barierą jest wyłączony przycisk (`disabled={!targetId}`); `if (!targetId)`
    // w mutacji to druga linia obrony. Upsert z pustym `related_item_id` to
    // naruszenie klucza obcego, czyli błąd bazy w miejscu, w którym wystarczy
    // nic nie robić.
    await openLinks();
    await waitFor(() => expect(chainsFor("eu_policy_links").length).toBe(1));

    expect(button("adminTracker.addLink")).toBeDisabled();
    fireEvent.click(button("adminTracker.addLink"));
    expect(chainsFor("eu_policy_links").some((c) => c.has("upsert"))).toBe(false);
  });

  it("kandydaci do powiązania NIE obejmują samego dossier ani już powiązanych", async () => {
    // Krawędź do samego siebie nie ma sensu, a ponowne dodanie istniejącej
    // przestawiłoby po cichu jej typ relacji (upsert po `item_id,related_item_id`).
    const THIRD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    db().setResponse("eu_policy_items", (chain) =>
      chain.has("select")
        ? ok([
            item(),
            item({ id: OTHER_ITEM_ID, slug: "akt-o-danych", title_pl: "Akt o danych" }),
            item({ id: THIRD_ID, slug: "akt-o-chmurze", title_pl: "Akt o chmurze" }),
          ])
        : ok([]),
    );
    db().setResponse("eu_policy_links", (chain) =>
      chain.has("select") ? ok([{ related_item_id: OTHER_ITEM_ID, relation: "amends" }]) : ok([]),
    );
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(screen.getAllByRole("button", { name: "adminTracker.links" })[0]);
    await screen.findByRole("button", { name: "adminTracker.remove" });

    const dialog = screen.getByRole("dialog", { name: "adminTracker.relatedFiles" });
    const target = within(dialog).getByLabelText("adminTracker.dossier");
    const offered = Array.from(target.querySelectorAll("option")).map((o) => o.value);
    expect(offered).toEqual([THIRD_ID]);
    // Istniejąca krawędź jest pokazana TYTUŁEM drugiej strony, z typem relacji.
    expect(within(dialog).getByText("Akt o danych")).toBeInTheDocument();
    expect(within(dialog).getByText("amends", { selector: "span" })).toBeInTheDocument();
  });

  it("dodanie powiązania niesie OBA końce, relację i zerowy tenant; sukces czyści wybór", async () => {
    // Zaślepka tenanta z tych samych powodów co przy stanowiskach - nadpisuje
    // ją trigger `tg_eu_policy_link_pin`. Unieważnienie obejmuje klucz panelu
    // i publiczną listę „powiązane akty" TEGO dossier.
    db().setResponse("eu_policy_items", (chain) =>
      chain.has("select")
        ? ok([item(), item({ id: OTHER_ITEM_ID, slug: "akt-o-danych", title_pl: "Akt o danych" })])
        : ok([]),
    );
    const view = await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(screen.getAllByRole("button", { name: "adminTracker.links" })[0]);
    await waitFor(() => expect(chainsFor("eu_policy_links").length).toBe(1));
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    change(screen.getByLabelText("adminTracker.dossier"), OTHER_ITEM_ID);
    change(screen.getByLabelText("adminTracker.relation"), "implements");
    fireEvent.click(button("adminTracker.addLink"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_links").some((c) => c.has("upsert"))).toBe(true),
    );
    const upsert = chainWith("eu_policy_links", "upsert");
    expect(upsert.argsOf("upsert")).toEqual([
      {
        item_id: ITEM_ID,
        related_item_id: OTHER_ITEM_ID,
        relation: "implements",
        tenant_id: ZERO_UUID,
      },
      { onConflict: "item_id,related_item_id" },
    ]);
    await waitFor(() => expect(button("adminTracker.addLink")).toBeDisabled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "tracker-links", ITEM_ID] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tracker", "links", ITEM_ID] });
  });

  it("błąd dodania powiązania daje komunikat i zostawia wybór", async () => {
    db().setResponse("eu_policy_links", (chain) =>
      chain.has("upsert") ? fail("test: dossier innego obszaru", "P0001") : ok([]),
    );
    await openLinks();
    await waitFor(() => expect(chainsFor("eu_policy_links").length).toBe(1));
    change(screen.getByLabelText("adminTracker.dossier"), OTHER_ITEM_ID);
    fireEvent.click(button("adminTracker.addLink"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("test: dossier innego obszaru"));
    expect(screen.getByLabelText("adminTracker.dossier")).toHaveValue(OTHER_ITEM_ID);
  });

  it("usunięcie powiązania filtruje po OBU końcach krawędzi", async () => {
    // `delete().eq("item_id", ...)` bez drugiego końca zdjąłby WSZYSTKIE
    // powiązania dossier, a panel pokazałby to jako usunięcie jednego wiersza.
    db().setResponse("eu_policy_links", (chain) =>
      chain.has("select") ? ok([{ related_item_id: OTHER_ITEM_ID, relation: "related" }]) : ok([]),
    );
    await openLinks();
    await screen.findByRole("button", { name: "adminTracker.remove" });
    fireEvent.click(button("adminTracker.remove"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_links").some((c) => c.has("delete"))).toBe(true),
    );
    const del = chainWith("eu_policy_links", "delete");
    expect(del.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["item_id", ITEM_ID],
      ["related_item_id", OTHER_ITEM_ID],
    ]);
  });
});

describe("admin.tracker - powiązania aktów: odmowa i zamknięcie", () => {
  async function openLinksWithEdge() {
    db().setResponse("eu_policy_items", (chain) =>
      chain.has("select")
        ? ok([item(), item({ id: OTHER_ITEM_ID, slug: "akt-o-danych", title_pl: "Akt o danych" })])
        : ok([]),
    );
    await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(screen.getAllByRole("button", { name: "adminTracker.links" })[0]);
    await screen.findByRole("dialog", { name: "adminTracker.relatedFiles" });
  }

  it("odmowa usunięcia powiązania daje komunikat, a krawędź zostaje na liście", async () => {
    db().setResponse("eu_policy_links", (chain) =>
      chain.has("delete")
        ? fail("test: odmowa usunięcia krawędzi", "42501")
        : ok([{ related_item_id: OTHER_ITEM_ID, relation: "related" }]),
    );
    await openLinksWithEdge();
    fireEvent.click(await screen.findByRole("button", { name: "adminTracker.remove" }));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("test: odmowa usunięcia krawędzi"),
    );
    const dialog = screen.getByRole("dialog", { name: "adminTracker.relatedFiles" });
    expect(within(dialog).getByText("Akt o danych")).toBeInTheDocument();
  });

  it("krawędź do dossier SPOZA listy panelu pokazuje identyfikator i da się ją usunąć", async () => {
    // Lista panelu ma limit 200 wierszy, a druga strona krawędzi bywa starsza.
    // Bez zapasowej etykiety wiersz byłby pusty - redakcja nie wiedziałaby,
    // co usuwa, ani nie miałaby jak zdjąć krawędzi do dossier, którego nie widzi.
    const FAR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    db().setResponse("eu_policy_links", (chain) =>
      chain.has("select") ? ok([{ related_item_id: FAR_ID, relation: "supersedes" }]) : ok([]),
    );
    await openLinksWithEdge();
    const dialog = screen.getByRole("dialog", { name: "adminTracker.relatedFiles" });

    expect(await within(dialog).findByText(FAR_ID)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "adminTracker.remove" }));
    await waitFor(() =>
      expect(chainsFor("eu_policy_links").some((c) => c.has("delete"))).toBe(true),
    );
    expect(chainWith("eu_policy_links", "delete").argsOf("eq")).toEqual(["item_id", ITEM_ID]);
  });

  it("zamknięcie okna powiązań nie pisze niczego", async () => {
    db().setResponse("eu_policy_links", () => ok([]));
    await openLinksWithEdge();
    fireEvent.click(button("adminTracker.close"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chainsFor("eu_policy_links").some((c) => c.has("upsert") || c.has("delete"))).toBe(
      false,
    );
  });
});

describe("admin.tracker - wpis osi czasu", () => {
  async function openUpdate() {
    const view = await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.update"));
    // Okno ma NAZWĘ dostępną, jak dwa pozostałe okna panelu - do tej pracy było
    // jedynym bezimiennym `role="dialog"` na tej trasie.
    await screen.findByRole("dialog", { name: "adminTracker.addUpdate" });
    return view;
  }

  it("publikacja jest zablokowana, dopóki notatka nie ma OBU wersji językowych", async () => {
    // Wpis osi czasu idzie do powiadomień push obserwujących. Wpis z pustą
    // wersją angielską wychodzi w powiadomieniu jako pusta treść - do ludzi,
    // których nie da się odpowiadomić.
    await openUpdate();

    expect(button("adminTracker.publish")).toBeDisabled();
    const areas = screen.getAllByRole("textbox");
    fireEvent.change(areas[0], { target: { value: "Rada przyjęła stanowisko" } });
    expect(button("adminTracker.publish")).toBeDisabled();
    fireEvent.change(areas[1], { target: { value: "Council adopted its position" } });
    expect(button("adminTracker.publish")).not.toBeDisabled();
  });

  it("wpis bez zmiany etapu zapisuje `stage_to` jako `null`, nie jako 'none'", async () => {
    // Wartość „none" z listy wyboru jest wyłącznie etykietą interfejsu.
    // Zapisana wprost trafiłaby do kolumny etapu jako nieznany etap i trigger
    // `tg_eu_policy_update_applied` przestawiłby dossier na etap, którego nie ma.
    await openUpdate();
    const areas = screen.getAllByRole("textbox");
    fireEvent.change(areas[0], { target: { value: "Rada przyjęła stanowisko" } });
    fireEvent.change(areas[1], { target: { value: "Council adopted its position" } });
    fireEvent.click(button("adminTracker.publish"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_updates").some((c) => c.has("insert"))).toBe(true),
    );
    const payload = chainWith("eu_policy_updates", "insert").argsOf("insert")?.[0];
    expect(payload).toMatchObject({
      item_id: ITEM_ID,
      stage_to: null,
      tenant_id: ZERO_UUID,
      note_pl: "Rada przyjęła stanowisko",
      note_en: "Council adopted its position",
    });
  });

  it("wpis z etapem unieważnia CAŁĄ publiczną przestrzeń trackera i listę panelu", async () => {
    // Regresja: zapis unieważniał tylko `["tracker", "updates", itemId]`. Etap
    // dossier przestawia jednak TRIGGER w bazie, więc w tej samej sesji
    // nieaktualne zostawały strona dossier (pasek postępu na starym etapie pod
    // nowym wpisem osi), lista z filtrem etapu, statystyki etapów explorera
    // i globalny feed zmian, do którego nowy wpis należy.
    const view = await openUpdate();
    seedPublicCache(view.queryClient);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const areas = screen.getAllByRole("textbox");
    fireEvent.change(areas[0], { target: { value: "Rada przyjęła stanowisko" } });
    fireEvent.change(areas[1], { target: { value: "Council adopted its position" } });
    change(screen.getByLabelText("adminTracker.stageChangeOptional"), "trilogue");
    fireEvent.click(button("adminTracker.publish"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminTracker.updatePublishedFollowersWereNotified",
      ),
    );
    for (const key of [
      PUBLIC_ENTRIES.updates,
      PUBLIC_ENTRIES.item,
      PUBLIC_ENTRIES.items,
      PUBLIC_ENTRIES.recent,
      PUBLIC_ENTRIES.stats,
    ]) {
      expect(invalidated(view.queryClient, key), JSON.stringify(key)).toBe(true);
    }
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "tracker-items"] });
  });

  it("etap i źródło wpisu trafiają do ładunku: etap wprost, źródło przycięte", async () => {
    // Etap jest tym, co uruchamia trigger i powiadomienia; źródło - jedynym
    // odnośnikiem przy wpisie na stronie publicznej i w kanale RSS.
    await openUpdate();
    const areas = screen.getAllByRole("textbox");
    fireEvent.change(areas[0], { target: { value: "Trilog rozpoczęty" } });
    fireEvent.change(areas[1], { target: { value: "Trilogue started" } });
    change(screen.getByLabelText("adminTracker.stageChangeOptional"), "trilogue");
    change(screen.getByLabelText("adminTracker.sourceUrl"), "  https://example.org/trilog  ");
    fireEvent.click(button("adminTracker.publish"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_updates").some((c) => c.has("insert"))).toBe(true),
    );
    expect(payloadOf("eu_policy_updates", "insert")).toMatchObject({
      stage_to: "trilogue",
      source_url: "https://example.org/trilog",
    });
  });

  it("błąd publikacji wpisu daje komunikat i NIE zamyka okna z notatkami", async () => {
    db().setResponse("eu_policy_updates", () => fail("test: notatka za krótka", "23514"));
    await openUpdate();
    const areas = screen.getAllByRole("textbox");
    fireEvent.change(areas[0], { target: { value: "Rada przyjęła stanowisko" } });
    fireEvent.change(areas[1], { target: { value: "Council adopted its position" } });
    fireEvent.click(button("adminTracker.publish"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("test: notatka za krótka"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText("adminTracker.updateNotePl")).toHaveValue(
      "Rada przyjęła stanowisko",
    );
  });

  it("anulowanie wpisu zamyka okno BEZ zapisu", async () => {
    await openUpdate();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Szkic notatki" } });
    fireEvent.click(button("adminTracker.cancel"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chainsFor("eu_policy_updates").some((c) => c.has("insert"))).toBe(false);
  });
});

describe("admin.tracker-guide - dokumentacja panelu", () => {
  it("renderuje kroki konfiguracji ze SŁOWNIKA, nie z tablicy w kodzie", async () => {
    // Ta trasa niosła wcześniej dwie tablice kroków wybierane ternarem po
    // języku. Strażnik `isStep` jest jedynym miejscem, które chroni render
    // przed kształtem, którego `returnObjects: true` nie gwarantuje - a przy
    // stubie i18n `t()` oddaje ciąg, więc lista kroków jest PUSTA i strona
    // musi to wytrzymać bez wywalenia się. Kroki na PRAWDZIWYM słowniku (oba
    // języki, parytet liczby kroków, wpis o złym kształcie) dowodzi
    // `adminTrackerGuideRoute.test.tsx`.
    const view = await renderRoute({
      route: TrackerGuideRoute,
      path: GUIDE_PATH,
      initialEntry: GUIDE_PATH,
    });

    expect(view.container.textContent).toContain("adminTrackerGuide");
    expect(screen.getByRole("link", { name: /adminTrackerGuide/ })).toHaveAttribute("href", PATH);
  });

  it("dokumentacja nie zostawia w nagłówku pustego tytułu", async () => {
    const meta = await routeMeta(TrackerGuideRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});
