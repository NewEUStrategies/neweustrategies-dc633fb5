// Trasa `/admin/crm` - skrzynka kontaktów CRM.
//
// To jest GŁÓWNE wejście operatora do danych osobowych: lista leadów, karta
// kontaktu (zgody, historia formularzy, notatki, oś czasu) i operacje zbiorcze,
// które jednym kliknięciem zmieniają etap, zgodę marketingową albo kasują
// rekordy. Test montuje PRAWDZIWĄ trasę w routerze pamięciowym i sprawdza to,
// co decyduje o skutku: jakie parametry idą do zapytania serwerowego i jakie
// identyfikatory trafiają do mutacji.
//
// Zamockowana jest wyłącznie granica sieci (serwerowe funkcje, klient Supabase,
// realtime) - reguły filtra/sortu mają własne testy w `lib/crm/leadListSpec`.
// Wszystkie dane są syntetyczne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  total: 0,
  detail: null as unknown,
  timeline: null as unknown,
  savedViews: [] as unknown[],
  listArgs: [] as unknown[],
  exportArgs: [] as unknown[],
  bulkUpdated: [] as unknown[],
  bulkDeleted: [] as unknown[],
  updated: [] as unknown[],
  notesAdded: [] as unknown[],
  notesDeleted: [] as unknown[],
  pushed: [] as unknown[],
  dispatched: [] as unknown[],
  timelineCsv: [] as unknown[],
  toastError: [] as string[],
  toastSuccess: [] as string[],
  isSuperAdmin: false,
  isAdmin: false,
}));

vi.mock("@/lib/crm.functions", () => ({
  listCrmLeads: async (input: unknown) => {
    h.listArgs.push(input);
    return { json: JSON.stringify(h.rows), total: h.total };
  },
  getCrmLead: async () => ({ json: JSON.stringify(h.detail) }),
  updateCrmLead: async (input: unknown) => {
    h.updated.push(input);
    return { ok: true };
  },
  exportCrmLeadsCsv: async (input: unknown) => {
    h.exportArgs.push(input);
    return { csv: "email\nanna@example.test\n" };
  },
  getCrmLeadTimeline: async () => ({ json: JSON.stringify(h.timeline) }),
  exportCrmLeadTimelineCsv: async (input: unknown) => {
    h.timelineCsv.push(input);
    return { csv: "at,type\n", email: "anna@example.test" };
  },
  bulkUpdateCrmLeads: async (input: unknown) => {
    h.bulkUpdated.push(input);
    return { ok: true, updated: 1 };
  },
  bulkDeleteCrmLeads: async (input: unknown) => {
    h.bulkDeleted.push(input);
    return { ok: true, deleted: 1 };
  },
  addCrmNote: async (input: unknown) => {
    h.notesAdded.push(input);
    return { ok: true };
  },
  deleteCrmNote: async (input: unknown) => {
    h.notesDeleted.push(input);
    return { ok: true };
  },
  pushLeadToPartners: async (input: unknown) => {
    h.pushed.push(input);
    return { ok: true, delivered: 1, endpoints: 1 };
  },
  getCrmScoringSettings: async () => ({ json: "null" }),
  upsertCrmScoringSettings: async () => ({ ok: true }),
  recomputeLeadScore: async () => ({ json: "null" }),
  recomputeAllLeadScores: async () => ({ ok: true, updated: 0 }),
  getCrmLeadMonthlyMetering: async () => ({ json: "null" }),
  getCrmLeadMembership: async () => ({ json: "null" }),
  getCrmLeadProfileSync: async () => ({ json: JSON.stringify({ matched: false }) }),
  listStaffUsers: async () => ({ json: "[]" }),
}));
vi.mock("@/lib/crm-saved-views.functions", () => ({
  listSavedViews: async () => ({ json: JSON.stringify(h.savedViews) }),
  upsertSavedView: async () => ({ ok: true, id: "view-new" }),
  deleteSavedView: async () => ({ ok: true }),
}));
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  dispatchIntegrationDeliveries: async (input: unknown) => {
    h.dispatched.push(input);
    return { ok: true, processed: 0 };
  },
}));
vi.mock("@/lib/crm-tasks.functions", () => ({
  CRM_IMPORT_CHUNK_SIZE: 500,
  listCrmDueTasks: async () => ({ json: "[]" }),
  listCrmLeadTasks: async () => ({ json: "[]" }),
  createCrmTask: async () => ({ ok: true }),
  updateCrmTask: async () => ({ ok: true }),
  deleteCrmTask: async () => ({ ok: true }),
  importCrmLeads: async () => ({ ok: true, inserted: 0, updated: 0, skipped: 0 }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin, isSuperAdmin: h.isSuperAdmin }),
}));
vi.mock("@/lib/realtime/useModuleRealtime", () => ({ useModuleRealtime: () => {} }));
vi.mock("@/components/molecules/PresenceIndicator", () => ({
  PresenceIndicator: () => null,
}));
vi.mock("@/components/molecules/LinkedItemsCard", () => ({ LinkedItemsCard: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ or: async () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: [{ profiles_synced: 2, subscribers_synced: 3 }], error: null }),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
    warning: (m: string) => h.toastError.push(m),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "pl" }, t: (k: string) => k }),
}));

import { Route } from "@/routes/admin.crm.index";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

const lead = (over: Record<string, unknown> = {}) => ({
  id: LEAD_ID,
  tenant_id: "t1",
  email: "anna@example.test",
  first_name: "Anna",
  last_name: "Kowalska",
  phone: "+48 500 100 200",
  position: "Dyrektorka",
  company: "Acme",
  country: "Poland",
  stage: "new",
  tags: ["energia"],
  marketing_consent: true,
  newsletter_status: null,
  source_count: 2,
  follow_up_at: null,
  last_activity_at: "2026-08-10T10:00:00.000Z",
  created_at: "2026-08-01T10:00:00.000Z",
  score: 72,
  score_band: "warm",
  score_breakdown: null,
  score_updated_at: null,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  lead: lead(),
  messages: [],
  subscriptions: [],
  consents: [],
  notes: [],
  ...over,
});

const mount = (entry = "/admin/crm") =>
  renderRoute({ route: Route, path: "/admin/crm", initialEntry: entry });

/** Radix aktywuje zakładkę na `mousedown`, nie na `click`. */
const openTab = async (name: RegExp | string) => {
  fireEvent.mouseDown(await screen.findByRole("tab", { name }));
};

const lastListArgs = () =>
  (h.listArgs.at(-1) as { data: Record<string, unknown> } | undefined)?.data ?? {};

beforeEach(() => {
  h.rows = [];
  h.total = 0;
  h.detail = null;
  h.timeline = null;
  h.savedViews = [];
  h.listArgs = [];
  h.exportArgs = [];
  h.bulkUpdated = [];
  h.bulkDeleted = [];
  h.updated = [];
  h.notesAdded = [];
  h.notesDeleted = [];
  h.pushed = [];
  h.dispatched = [];
  h.timelineCsv = [];
  h.toastError = [];
  h.toastSuccess = [];
  h.isSuperAdmin = false;
  h.isAdmin = false;
});

afterEach(() => cleanup());

describe("skrzynka CRM - lista", () => {
  it("panel nie idzie do indeksu wyszukiwarek", async () => {
    const view = await mount();
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("walidator adresu przycina deep-linki notyfikacji i widoku", () => {
    const validate = Route.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => { lead?: string; task?: string; view?: string };
    expect(validate({ lead: LEAD_ID, task: "t1" })).toMatchObject({ lead: LEAD_ID, task: "t1" });
    expect(validate({ lead: "", view: "" })).toEqual({
      lead: undefined,
      task: undefined,
      view: undefined,
    });
    // Nazwa widoku wchodzi do klucza cache i adresu - długość jest ograniczona.
    expect(validate({ view: "v".repeat(80) }).view).toBeUndefined();
  });

  it("pusta lista mówi wprost, że nic nie ma", async () => {
    await mount();
    expect(await screen.findByText("Brak kontaktów dla wybranych filtrów.")).toBeInTheDocument();
  });

  it("wiersz pokazuje osobę, firmę, etap i wynik", async () => {
    h.rows = [lead()];
    h.total = 1;
    await mount();
    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Nowy")).toBeInTheDocument();
    expect(screen.getByLabelText(/Lead score 72/)).toBeInTheDocument();
  });

  it("fraza wyszukiwania trafia do zapytania serwerowego", async () => {
    await mount();
    fireEvent.change(await screen.findByPlaceholderText(/Szukaj po e-mailu/), {
      target: { value: "kowalska" },
    });
    await waitFor(() => expect(lastListArgs().search).toBe("kowalska"));
  });

  it("klik w nagłówek kolumny zmienia sort, a drugi klik odwraca kierunek", async () => {
    h.rows = [lead()];
    h.total = 1;
    await mount();
    await screen.findByText("Anna Kowalska");
    // Nagłówek tabeli, nie menedżer kolumn - obie powierzchnie mają „Firmę”.
    const thead = document.querySelector("thead") as HTMLElement;
    const header = within(thead).getByRole("button", { name: /Firma/ });
    fireEvent.click(header);
    // Kolumny tekstowe startują rosnąco - alfabetycznie, nie „od końca”.
    await waitFor(() => expect(lastListArgs()).toMatchObject({ sort: "company", sort_dir: "asc" }));
    fireEvent.click(header);
    await waitFor(() =>
      expect(lastListArgs()).toMatchObject({ sort: "company", sort_dir: "desc" }),
    );
  });

  it("widok wbudowany z adresu ustawia filtr i sort zapytania", async () => {
    await mount("/admin/crm?view=builtin:hot");
    await waitFor(() =>
      expect(lastListArgs()).toMatchObject({ band: "hot", sort: "score", sort_dir: "desc" }),
    );
  });

  it("eksport CSV dziedziczy filtry listy, nie tylko widoczną stronę", async () => {
    const createObjectURL = vi.fn(() => "blob:csv");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    await mount("/admin/crm?view=builtin:hot");
    fireEvent.change(await screen.findByPlaceholderText(/Szukaj po e-mailu/), {
      target: { value: "acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(h.exportArgs).toHaveLength(1));
    expect((h.exportArgs[0] as { data: Record<string, unknown> }).data).toMatchObject({
      search: "acme",
      band: "hot",
      scope: "tenant",
    });
  });

  it("zakres „wszystkie tenanty” jest dostępny tylko dla super admina", async () => {
    await mount();
    expect(screen.queryByText("Wszystkie tenanty (super admin)")).toBeNull();
    cleanup();
    h.isSuperAdmin = true;
    await mount();
    expect(await screen.findByText("Mój tenant")).toBeInTheDocument();
  });

  it("wejście do CRM zdejmuje zaległe dostawy integracji", async () => {
    await mount();
    await waitFor(() => expect(h.dispatched).toEqual([{ data: { limit: 20 } }]));
  });
});

describe("skrzynka CRM - operacje zbiorcze", () => {
  const selectFirst = async () => {
    fireEvent.click(await screen.findByLabelText("anna@example.test"));
    return screen.findByRole("region", { name: "Akcje zbiorcze" });
  };

  beforeEach(() => {
    h.rows = [lead()];
    h.total = 1;
  });

  it("zaznaczenie wszystkich obejmuje widoczną stronę", async () => {
    await mount();
    await screen.findByText("Anna Kowalska");
    fireEvent.click(screen.getByLabelText("Zaznacz wszystkie"));
    expect(await screen.findByText("1 kontaktów zaznaczonych")).toBeInTheDocument();
  });

  it("zmiana etapu wysyła identyfikatory i nowy etap", async () => {
    await mount();
    const bar = await selectFirst();
    fireEvent.click(within(bar).getByRole("button", { name: "Etap" }));
    fireEvent.click(await screen.findByRole("button", { name: /Kwalifikowany/ }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(1));
    expect((h.bulkUpdated[0] as { data: Record<string, unknown> }).data).toEqual({
      ids: [LEAD_ID],
      stage: "qualified",
    });
  });

  it("zgoda marketingowa zmienia się zbiorczo w obie strony", async () => {
    await mount();
    const bar = await selectFirst();
    fireEvent.click(within(bar).getByRole("button", { name: "Zgoda: TAK" }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(1));
    expect((h.bulkUpdated[0] as { data: { marketing_consent: boolean } }).data.marketing_consent)
      .toBe(true);

    const bar2 = await selectFirst();
    fireEvent.click(within(bar2).getByRole("button", { name: "Zgoda: NIE" }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(2));
    expect((h.bulkUpdated[1] as { data: { marketing_consent: boolean } }).data.marketing_consent)
      .toBe(false);
  });

  it("tagi zbiorcze rozdzielają dodawane od usuwanych i ignorują puste", async () => {
    await mount();
    const bar = await selectFirst();
    fireEvent.click(within(bar).getByRole("button", { name: "Tagi" }));
    fireEvent.change(await screen.findByPlaceholderText("Dodaj"), {
      target: { value: "energia, , bruksela" },
    });
    fireEvent.change(screen.getByPlaceholderText("Usuń"), { target: { value: "stary" } });
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj" }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(1));
    expect((h.bulkUpdated[0] as { data: Record<string, unknown> }).data).toEqual({
      ids: [LEAD_ID],
      add_tags: ["energia", "bruksela"],
      remove_tags: ["stary"],
    });
  });

  it("pusty formularz tagów nie wysyła mutacji", async () => {
    await mount();
    const bar = await selectFirst();
    fireEvent.click(within(bar).getByRole("button", { name: "Tagi" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zastosuj" }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(0));
  });

  it("kasowanie kontaktów wymaga potwierdzenia w oknie dialogowym", async () => {
    await mount();
    const bar = await selectFirst();
    fireEvent.click(within(bar).getByRole("button", { name: "Usuń" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/nieodwracalna/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.bulkDeleted).toEqual([{ data: { ids: [LEAD_ID] } }]));
  });
});

describe("skrzynka CRM - karta kontaktu (drawer)", () => {
  beforeEach(() => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
  });

  it("deep-link z powiadomienia otwiera kartę na zakładce zadań", async () => {
    await mount(`/admin/crm?lead=${LEAD_ID}&task=task-1`);
    const tasks = await screen.findByRole("tab", { name: /Zadania/ });
    await waitFor(() => expect(tasks).toHaveAttribute("data-state", "active"));
  });

  it("szybki podgląd pokazuje zgody z formularzem i wersją", async () => {
    h.detail = detail({
      consents: [
        {
          id: "c1",
          consent_key: "marketing",
          given: true,
          consent_version: "2026-01",
          consent_text: "Zgadzam się na newsletter",
          form_name: "Kontakt",
          created_at: "2026-08-01T10:00:00.000Z",
        },
      ],
    });
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab(/Zgody/);
    expect(await screen.findByText("marketing")).toBeInTheDocument();
    expect(screen.getByText("Kontakt")).toBeInTheDocument();
    expect(screen.getByText(/Zgadzam się na newsletter/)).toBeInTheDocument();
  });

  it("historia formularzy pokazuje zgłoszenie i subskrypcję", async () => {
    h.detail = detail({
      messages: [
        {
          id: "m1",
          form_type: "contact",
          form_name: "Formularz kontaktowy",
          subject: "Zapytanie",
          message: "Proszę o ofertę",
          lang: "pl",
          page_url: null,
          created_at: "2026-08-02T10:00:00.000Z",
          consents: null,
          newsletter_opt_in: true,
        },
      ],
      subscriptions: [
        {
          id: "s1",
          status: "subscribed",
          source: "stopka",
          source_form_name: "Stopka",
          language: "pl",
          confirmed_at: null,
          created_at: "2026-08-03T10:00:00.000Z",
          consents: null,
        },
      ],
    });
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab("Historia formularzy");
    expect(await screen.findByText("Formularz kontaktowy")).toBeInTheDocument();
    expect(screen.getByText(/Proszę o ofertę/)).toBeInTheDocument();
    expect(screen.getByText("subscribed")).toBeInTheDocument();
  });

  it("notatka zespołowa idzie na serwer, a kasowanie woła jej identyfikator", async () => {
    h.detail = detail({
      notes: [
        { id: "n1", body: "Rozmowa telefoniczna", author_id: "u1", created_at: "2026-08-04T10:00:00.000Z" },
      ],
    });
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab("Notatki");
    const box = await screen.findByPlaceholderText(/Notatka widoczna tylko dla zespołu/);
    fireEvent.change(box, { target: { value: "  Po spotkaniu  " } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj" }));
    await waitFor(() => expect(h.notesAdded).toHaveLength(1));
    const added = (h.notesAdded[0] as { data: Record<string, unknown> }).data;
    expect(added).toMatchObject({ lead_id: LEAD_ID, body: "Po spotkaniu" });
    // Klucz idempotencji chroni przed zdublowaniem notatki po retry HTTP.
    expect(typeof added.idempotency_key).toBe("string");

    fireEvent.click(screen.getByLabelText("Usuń"));
    await waitFor(() => expect(h.notesDeleted).toEqual([{ data: { id: "n1" } }]));
  });

  it("edycja profilu wysyła zmienione pola i tagi rozbite po przecinku", async () => {
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    const phone = await screen.findByDisplayValue("+48 500 100 200");
    fireEvent.change(phone, { target: { value: "+32 2 000 00 00" } });
    fireEvent.change(screen.getByDisplayValue("energia"), {
      target: { value: "energia, klimat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: LEAD_ID,
      phone: "+32 2 000 00 00",
      tags: ["energia", "klimat"],
      stage: "new",
    });
  });

  it("push do partnerów woła serwer dla otwartego leada", async () => {
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab("Integracje");
    fireEvent.click(await screen.findByRole("button", { name: /Wyślij do partnerów CRM/ }));
    await waitFor(() => expect(h.pushed).toEqual([{ data: { lead_id: LEAD_ID } }]));
  });

  it("pusta oś czasu blokuje eksport - nie ma czego wyeksportować", async () => {
    h.timeline = { lead: { id: LEAD_ID, email: "anna@example.test" }, events: [] };
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab(/Oś czasu/);
    expect(await screen.findByText("Brak zdarzeń na osi czasu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Eksport CSV/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Eksport PDF/ })).toBeDisabled();
  });

  it("oś czasu ze zdarzeniami eksportuje się do CSV dla tego leada", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    h.timeline = {
      lead: { id: LEAD_ID, email: "anna@example.test" },
      events: [
        {
          id: "e1",
          type: "consent",
          at: "2026-08-01T10:00:00.000Z",
          title: "Zgoda z formularza kontaktowego",
          detail: "formularz kontaktowy",
          meta: { version: "2026-01" },
        },
      ],
    };
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab(/Oś czasu/);
    // Tytuł zdarzenia, nie etykieta „Zgoda marketingowa” ze statystyk nagłówka -
    // ta ostatnia jest na ekranie ZANIM oś czasu zdąży się wczytać.
    expect(await screen.findByText("Zgoda z formularza kontaktowego")).toBeInTheDocument();
    const exportCsv = screen.getByRole("button", { name: /Eksport CSV/ });
    expect(exportCsv).toBeEnabled();
    fireEvent.click(exportCsv);
    await waitFor(() => expect(h.timelineCsv).toEqual([{ data: { id: LEAD_ID } }]));
  });
});
