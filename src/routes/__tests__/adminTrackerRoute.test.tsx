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
// i publiczny. Trzy testy niżej pilnują dokładnie tego.
// ─────────────────────────────────────────────────────────────────────────────
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
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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

  it("dodanie powiązania bez wybranego dossier NIE puka do bazy", async () => {
    // `if (!targetId) return` przed zapytaniem: upsert z pustym
    // `related_item_id` to naruszenie klucza obcego, czyli błąd bazy
    // w miejscu, w którym wystarczy nic nie robić.
    await openLinks();
    await waitFor(() => expect(chainsFor("eu_policy_links").length).toBe(1));
    fireEvent.click(button("adminTracker.addLink"));

    await waitFor(() =>
      expect(chainsFor("eu_policy_links").some((c) => c.has("upsert"))).toBe(false),
    );
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

describe("admin.tracker - wpis osi czasu", () => {
  async function openUpdate() {
    const view = await mount();
    await screen.findByText(/Akt o odporności cyfrowej/);
    fireEvent.click(button("adminTracker.update"));
    await screen.findByRole("dialog");
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

  it("wpis z etapem unieważnia klucz osi czasu I klucz listy panelu", async () => {
    // Etap dossier przestawia TRIGGER w bazie, więc lista panelu też jest po
    // zapisie nieaktualna - stąd drugie unieważnienie. Bez niego redakcja
    // widzi stary etap i dodaje ten sam wpis ponownie.
    const view = await openUpdate();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    const areas = screen.getAllByRole("textbox");
    fireEvent.change(areas[0], { target: { value: "Rada przyjęła stanowisko" } });
    fireEvent.change(areas[1], { target: { value: "Council adopted its position" } });
    fireEvent.click(button("adminTracker.publish"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "adminTracker.updatePublishedFollowersWereNotified",
      ),
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tracker", "updates", ITEM_ID] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "tracker-items"] });
  });
});

describe("admin.tracker-guide - dokumentacja panelu", () => {
  it("renderuje kroki konfiguracji ze SŁOWNIKA, nie z tablicy w kodzie", async () => {
    // Ta trasa niosła wcześniej dwie tablice kroków wybierane ternarem po
    // języku. Strażnik `isStep` jest jedynym miejscem, które chroni render
    // przed kształtem, którego `returnObjects: true` nie gwarantuje - a przy
    // stubie i18n `t()` oddaje ciąg, więc lista kroków jest PUSTA i strona
    // musi to wytrzymać bez wywalenia się.
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
