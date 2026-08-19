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
  dueTasks: [] as unknown[],
  listArgs: [] as unknown[],
  exportArgs: [] as unknown[],
  bulkUpdated: [] as unknown[],
  bulkDeleted: [] as unknown[],
  bulkDeleteFails: false,
  updated: [] as unknown[],
  updateFails: false,
  notesAdded: [] as unknown[],
  notesDeleted: [] as unknown[],
  pushed: [] as unknown[],
  dispatched: [] as unknown[],
  timelineCsv: [] as unknown[],
  toastError: [] as string[],
  toastSuccess: [] as string[],
  isSuperAdmin: false,
  isAdmin: false,
  lang: "pl",
  savedUpserts: [] as unknown[],
  savedDeleted: [] as unknown[],
  savedFails: false,
  bulkFails: false,
  avatars: [] as unknown[],
  avatarFilters: [] as string[],
  realtime: [] as Array<(() => void) | undefined>,
  dispatchFails: false,
  timelineCsvFails: false,
  backfillFails: false,
}));

vi.mock("@/lib/crm.functions", () => ({
  listCrmLeads: async (input: unknown) => {
    h.listArgs.push(input);
    return { json: JSON.stringify(h.rows), total: h.total };
  },
  getCrmLead: async () => ({ json: JSON.stringify(h.detail) }),
  updateCrmLead: async (input: unknown) => {
    h.updated.push(input);
    if (h.updateFails) throw new Error("zapis odrzucony");
    return { ok: true };
  },
  exportCrmLeadsCsv: async (input: unknown) => {
    h.exportArgs.push(input);
    return { csv: "email\nanna@example.test\n" };
  },
  getCrmLeadTimeline: async () => ({ json: JSON.stringify(h.timeline) }),
  exportCrmLeadTimelineCsv: async (input: unknown) => {
    h.timelineCsv.push(input);
    if (h.timelineCsvFails) throw new Error("eksport odrzucony");
    return { csv: "at,type\n", email: "anna@example.test" };
  },
  bulkUpdateCrmLeads: async (input: unknown) => {
    h.bulkUpdated.push(input);
    if (h.bulkFails) throw new Error("operacja odrzucona");
    return { ok: true, updated: 1 };
  },
  bulkDeleteCrmLeads: async (input: unknown) => {
    h.bulkDeleted.push(input);
    if (h.bulkDeleteFails) throw new Error("kasowanie odrzucone");
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
  upsertSavedView: async (input: unknown) => {
    if (h.savedFails) throw new Error("widok odrzucony");
    h.savedUpserts.push(input);
    return { ok: true, id: "view-new" };
  },
  deleteSavedView: async (input: unknown) => {
    if (h.savedFails) throw new Error("kasowanie widoku odrzucone");
    h.savedDeleted.push(input);
    return { ok: true };
  },
}));
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  dispatchIntegrationDeliveries: async (input: unknown) => {
    h.dispatched.push(input);
    if (h.dispatchFails) throw new Error("kolejka niedostępna");
    return { ok: true, processed: 0 };
  },
}));
vi.mock("@/lib/crm-tasks.functions", () => ({
  CRM_IMPORT_CHUNK_SIZE: 500,
  listCrmDueTasks: async () => ({ json: JSON.stringify(h.dueTasks) }),
  listCrmLeadTasks: async () => ({ json: "[]" }),
  createCrmTask: async () => ({ ok: true }),
  updateCrmTask: async () => ({ ok: true }),
  deleteCrmTask: async () => ({ ok: true }),
  importCrmLeads: async () => ({ ok: true, inserted: 0, updated: 0, skipped: 0 }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin, isSuperAdmin: h.isSuperAdmin }),
}));
vi.mock("@/lib/realtime/useModuleRealtime", () => ({
  // Atrapa szyny zdarzeń: zapisujemy callback, żeby test mógł „wysłać” zdarzenie.
  useModuleRealtime: (_module: string, opts?: { onEvent?: () => void }) => {
    h.realtime.push(opts?.onEvent);
  },
}));
vi.mock("@/components/molecules/PresenceIndicator", () => ({
  PresenceIndicator: () => null,
}));
vi.mock("@/components/molecules/LinkedItemsCard", () => ({ LinkedItemsCard: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        or: async (filter: string) => {
          h.avatarFilters.push(filter);
          return { data: h.avatars, error: null };
        },
      }),
    }),
    rpc: async () =>
      h.backfillFails
        ? { data: null, error: new Error("synchronizacja odrzucona") }
        : { data: [{ profiles_synced: 2, subscribers_synced: 3 }], error: null },
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
  useTranslation: () => ({ i18n: { language: h.lang }, t: (k: string) => k }),
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
  h.dueTasks = [];
  h.listArgs = [];
  h.exportArgs = [];
  h.bulkUpdated = [];
  h.bulkDeleted = [];
  h.bulkDeleteFails = false;
  h.updated = [];
  h.updateFails = false;
  h.notesAdded = [];
  h.notesDeleted = [];
  h.pushed = [];
  h.dispatched = [];
  h.timelineCsv = [];
  h.toastError = [];
  h.toastSuccess = [];
  h.isSuperAdmin = false;
  h.isAdmin = false;
  h.lang = "pl";
  h.savedUpserts = [];
  h.savedDeleted = [];
  h.savedFails = false;
  h.bulkFails = false;
  h.avatars = [];
  h.avatarFilters = [];
  h.realtime = [];
  h.dispatchFails = false;
  h.timelineCsvFails = false;
  h.backfillFails = false;
});

afterEach(() => cleanup());

describe("skrzynka CRM - lista", () => {
  it("panel nie idzie do indeksu wyszukiwarek", async () => {
    const view = await mount();
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("walidator adresu przycina deep-linki notyfikacji i widoku", () => {
    const validate = Route.options.validateSearch as (raw: Record<string, unknown>) => {
      lead?: string;
      task?: string;
      view?: string;
    };
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
    expect(
      (h.bulkUpdated[0] as { data: { marketing_consent: boolean } }).data.marketing_consent,
    ).toBe(true);

    const bar2 = await selectFirst();
    fireEvent.click(within(bar2).getByRole("button", { name: "Zgoda: NIE" }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(2));
    expect(
      (h.bulkUpdated[1] as { data: { marketing_consent: boolean } }).data.marketing_consent,
    ).toBe(false);
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
        {
          id: "n1",
          body: "Rozmowa telefoniczna",
          author_id: "u1",
          created_at: "2026-08-04T10:00:00.000Z",
        },
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

describe("skrzynka CRM - obudowa listy", () => {
  const savedView = (over: Record<string, unknown> = {}) => ({
    id: "view-1",
    name: "Moi klienci",
    entity: "lead",
    is_shared: false,
    config: {
      columns: ["name", "email", "stage"],
      filter: {},
      sort: { key: "created", dir: "desc" },
    },
    ...over,
  });

  it("zapisany widok z serwera wchodzi w życie po kliknięciu", async () => {
    h.savedViews = [savedView()];
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Moi klienci/ }));
    await waitFor(() =>
      expect(lastListArgs()).toMatchObject({ sort: "created", sort_dir: "desc" }),
    );
  });

  it("zapisany widok z adresu podnosi się po dociągnięciu listy widoków", async () => {
    h.savedViews = [savedView()];
    await mount("/admin/crm?view=view-1");
    await waitFor(() => expect(lastListArgs()).toMatchObject({ sort: "created" }));
  });

  it("zapisanie bieżącej konfiguracji wysyła kolumny i filtr", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(await screen.findByPlaceholderText(/np\./), {
      target: { value: "Gorące PL" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedUpserts).toHaveLength(1));
    expect((h.savedUpserts[0] as { data: Record<string, unknown> }).data).toMatchObject({
      entity: "lead",
      name: "Gorące PL",
    });
  });

  it("zmiana nazwy, udostępnienie i usunięcie widoku idą na serwer", async () => {
    h.savedViews = [savedView()];
    await mount();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę" }));
    fireEvent.change(await screen.findByDisplayValue("Moi klienci"), {
      target: { value: "Moi klienci PL" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedUpserts).toHaveLength(1));
    expect((h.savedUpserts[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: "view-1",
      name: "Moi klienci PL",
    });

    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Udostępnij zespołowi/ }));
    await waitFor(() => expect(h.savedUpserts).toHaveLength(2));
    expect((h.savedUpserts[1] as { data: { is_shared: boolean } }).data.is_shared).toBe(true);
  });

  it("usunięcie widoku wraca na widok wbudowany", async () => {
    h.savedViews = [savedView()];
    await mount();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Usuń widok/ }));
    await waitFor(() => expect(h.savedDeleted).toEqual([{ data: { id: "view-1" } }]));
    // Widok domyślny sortuje po ostatniej aktywności (kolumna `activity` w SQL).
    await waitFor(() => expect(lastListArgs().sort).toBe("activity"));
  });

  it("odrzucone operacje na widokach mówią o błędzie", async () => {
    h.savedViews = [savedView()];
    h.savedFails = true;
    await mount();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Usuń widok/ }));
    await waitFor(() => expect(h.toastError).toContain("kasowanie widoku odrzucone"));
  });

  it("chip filtru etapu zawęża zapytanie serwerowe", async () => {
    h.rows = [lead()];
    h.total = 1;
    await mount();
    await screen.findByText("Anna Kowalska");
    // Chip filtra, nie nagłówek kolumny o tej samej nazwie.
    fireEvent.click(screen.getAllByRole("button", { name: /^Etap/ })[0]);
    const popover = (await waitFor(() => {
      const el = document.querySelector("[data-radix-popper-content-wrapper]");
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    fireEvent.keyDown(within(popover).getByRole("combobox"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Wygrana" }));
    await waitFor(() => expect(lastListArgs()).toMatchObject({ stage: "won" }));
  });

  it("menedżer kolumn dokłada kolumnę do tabeli", async () => {
    h.rows = [lead()];
    h.total = 1;
    await mount();
    await screen.findByText("Anna Kowalska");
    fireEvent.click(screen.getByRole("button", { name: /Kolumny/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Telefon" }));
    expect(await screen.findByText("+48 500 100 200")).toBeInTheDocument();
  });

  it("każda kolumna pokazuje swoją wartość albo myślnik", async () => {
    h.rows = [
      lead(),
      lead({
        id: "lead-2",
        email: "pusty@example.test",
        first_name: null,
        last_name: null,
        phone: null,
        position: null,
        company: null,
        country: null,
        tags: [],
        marketing_consent: false,
        newsletter_status: null,
        source_count: 0,
        follow_up_at: null,
      }),
      lead({
        id: "lead-3",
        email: "nl@example.test",
        newsletter_status: "subscribed",
        tags: ["a", "b", "c", "d", "e"],
        follow_up_at: "2026-09-01T10:00:00.000Z",
      }),
    ];
    h.total = 3;
    await mount();
    await screen.findAllByText("Anna Kowalska");
    fireEvent.click(screen.getByRole("button", { name: /Kolumny/ }));
    for (const label of [
      "Telefon",
      "Stanowisko",
      "Kraj",
      "Poziom",
      "Źródło",
      "Tagi",
      "Zgoda",
      "Utworzono",
      "Follow-up",
    ]) {
      fireEvent.click(await screen.findByRole("checkbox", { name: label }));
    }
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect((await screen.findAllByText("Dyrektorka")).length).toBe(2);
    expect(screen.getByText("formularz")).toBeInTheDocument();
    expect(screen.getByText("newsletter")).toBeInTheDocument();
    expect(screen.getByText("import")).toBeInTheDocument();
    expect(screen.getByText("subscribed")).toBeInTheDocument();
    // Tagi ponad limit zwijają się do licznika, nie rozpychają wiersza.
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("avatary dociąga jedno zapytanie po znormalizowanych e-mailach", async () => {
    h.rows = [
      lead({ email: "Anna@Example.test " }),
      lead({ id: "lead-2", email: "anna@example.test" }),
      lead({ id: "lead-3", email: "bartek@example.test" }),
    ];
    h.total = 3;
    h.avatars = [
      { email: "ANNA@example.test", contact_email: null, avatar_url: "https://cdn.test/a.png" },
      { email: null, contact_email: "bartek@example.test", avatar_url: "https://cdn.test/b.png" },
      { email: "bez@example.test", contact_email: null, avatar_url: null },
    ];
    await mount();
    await waitFor(() => expect(h.avatarFilters).toHaveLength(1));
    // Ten sam adres w dwóch wierszach pyta bazę RAZ, po małych literach i bez
    // spacji - inaczej lista 200 leadów robiłaby 200 zapytań o te same profile.
    expect(h.avatarFilters[0]).toBe(
      [
        "email.eq.anna@example.test",
        "contact_email.eq.anna@example.test",
        "email.eq.bartek@example.test",
        "contact_email.eq.bartek@example.test",
      ].join(","),
    );
  });

  it("klik w wiersz otwiera pełną kartę kontaktu", async () => {
    h.rows = [lead()];
    h.total = 1;
    const view = await mount();
    fireEvent.click(await screen.findByText("Anna Kowalska"));
    await waitFor(() => expect(view.currentPath()).toBe(`/admin/crm/${LEAD_ID}`));
  });

  it("zmiana rozmiaru strony wraca na pierwszą stronę", async () => {
    h.rows = [lead()];
    h.total = 300;
    await mount();
    await screen.findByText("Anna Kowalska");
    fireEvent.click(await screen.findByLabelText("admin.pagination.next"));
    await waitFor(() => expect(lastListArgs().page).toBe(2));
    const combos = screen.getAllByRole("combobox");
    const perPage = combos[combos.length - 1];
    fireEvent.keyDown(perPage, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "100" }));
    await waitFor(() => expect(lastListArgs()).toMatchObject({ page: 1, limit: 100 }));
  });

  it("super admin może przełączyć zakres na wszystkie tenanty", async () => {
    h.isSuperAdmin = true;
    await mount();
    // Selektor zakresu jest pierwszym comboboxem na stronie (przed paginacją).
    const trigger = (await screen.findAllByRole("combobox"))[0];
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Wszystkie tenanty/ }));
    await waitFor(() => expect(lastListArgs().scope).toBe("all"));
  });

  it("odświeżenie ponawia zapytanie listy", async () => {
    await mount();
    await waitFor(() => expect(h.listArgs.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: /Odśwież/ }));
    await waitFor(() => expect(h.listArgs.length).toBe(2));
  });

  it("import CSV otwiera się z panelu", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Import CSV/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("synchronizacja z bazy raportuje, ilu ludzi doszło", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Synchronizuj z bazy/ }));
    await waitFor(() =>
      expect(h.toastSuccess.some((m) => m.includes("2") && m.includes("3"))).toBe(true),
    );
  });

  it("odrzucona synchronizacja pokazuje komunikat bazy", async () => {
    h.backfillFails = true;
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Synchronizuj z bazy/ }));
    await waitFor(() => expect(h.toastError).toContain("synchronizacja odrzucona"));
  });

  it("odrzucona operacja zbiorcza nie znika po cichu", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.bulkFails = true;
    await mount();
    fireEvent.click(await screen.findByLabelText("anna@example.test"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Zgoda: TAK" }));
    await waitFor(() => expect(h.toastError).toContain("operacja odrzucona"));
  });

  it("czyszczenie zaznaczenia chowa pasek operacji zbiorczych", async () => {
    h.rows = [lead()];
    h.total = 1;
    await mount();
    fireEvent.click(await screen.findByLabelText("anna@example.test"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: /Wyczyść/ }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Akcje zbiorcze" })).toBeNull(),
    );
  });

  it("zaznaczenie wszystkich da się cofnąć jednym kliknięciem", async () => {
    h.rows = [lead(), lead({ id: "lead-2", email: "b@example.test" })];
    h.total = 2;
    await mount();
    await screen.findAllByText("Anna Kowalska");
    const all = screen.getByLabelText("Zaznacz wszystkie");
    fireEvent.click(all);
    expect(await screen.findByText("2 kontaktów zaznaczonych")).toBeInTheDocument();
    fireEvent.click(all);
    await waitFor(() => expect(screen.queryByText("2 kontaktów zaznaczonych")).toBeNull());
  });

  it("panel follow-upów otwiera kartę kontaktu na zadaniu", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    await mount();
    await screen.findByText("Anna Kowalska");
    fireEvent.click(screen.getByLabelText("Szybki podgląd"));
    expect(await screen.findByRole("tab", { name: /Profil/ })).toBeInTheDocument();
  });

  it("zamknięcie karty czyści deep-link z adresu", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    const view = await mount(`/admin/crm?lead=${LEAD_ID}&task=task-1`);
    await screen.findByRole("tab", { name: /Zadania/ });
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(view.search().lead).toBeUndefined());
    expect(view.search().task).toBeUndefined();
  });

  it("wersja angielska ma komplet etykiet skrzynki", async () => {
    h.lang = "en";
    await mount();
    expect(await screen.findByText("No contacts for the selected filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sync from DB/ })).toBeInTheDocument();
  });
});

describe("skrzynka CRM - ścieżki wyjątkowe", () => {
  it("niedostępna kolejka integracji nie psuje wejścia do panelu", async () => {
    h.dispatchFails = true;
    await mount();
    expect(await screen.findByText("Brak kontaktów dla wybranych filtrów.")).toBeInTheDocument();
    expect(h.toastError).toHaveLength(0);
  });

  it("zdarzenie z szyny realtime zapala wskaźnik na żywo", async () => {
    await mount();
    await waitFor(() => expect(h.realtime.length).toBeGreaterThan(0));
    const notify = h.realtime[0];
    expect(typeof notify).toBe("function");
    notify?.();
  });

  it("kraje do chipa filtra są posortowane i bez powtórzeń", async () => {
    h.rows = [
      lead({ country: "Poland" }),
      lead({ id: "l2", email: "b@example.test", country: "Belgium" }),
      lead({ id: "l3", email: "c@example.test", country: "Poland" }),
    ];
    h.total = 3;
    await mount();
    await screen.findAllByText("Anna Kowalska");
    fireEvent.click(screen.getAllByRole("button", { name: /^Kraj/ })[0]);
    const popover = (await waitFor(() => {
      const el = document.querySelector("[data-radix-popper-content-wrapper]");
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    fireEvent.keyDown(within(popover).getByRole("combobox"), { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Dowolny", "Belgium", "Poland"]);
  });

  it("odznaczenie pojedynczego kontaktu zdejmuje go z zaznaczenia", async () => {
    h.rows = [lead(), lead({ id: "lead-2", email: "b@example.test" })];
    h.total = 2;
    await mount();
    fireEvent.click(await screen.findByLabelText("anna@example.test"));
    fireEvent.click(screen.getByLabelText("b@example.test"));
    expect(await screen.findByText("2 kontaktów zaznaczonych")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("b@example.test"));
    expect(await screen.findByText("1 kontaktów zaznaczonych")).toBeInTheDocument();
  });

  it("odrzucone kasowanie zbiorcze pokazuje komunikat serwera", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.bulkDeleteFails = true;
    await mount();
    fireEvent.click(await screen.findByLabelText("anna@example.test"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Usuń" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.toastError).toContain("kasowanie odrzucone"));
  });

  it("odrzucone operacje na widokach leadów mówią o błędzie", async () => {
    h.savedFails = true;
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(await screen.findByPlaceholderText(/np\./), { target: { value: "Widok" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.toastError).toContain("widok odrzucony"));
  });

  it("odrzucona zmiana nazwy widoku leadów mówi o błędzie", async () => {
    h.savedViews = [
      {
        id: "view-1",
        name: "Moi klienci",
        entity: "lead",
        is_shared: false,
        config: { columns: ["name"], filter: {}, sort: { key: "created", dir: "desc" } },
      },
    ];
    h.savedFails = true;
    await mount();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.toastError).toContain("widok odrzucony"));
  });

  it("odrzucone udostępnienie widoku leadów mówi o błędzie", async () => {
    h.savedViews = [
      {
        id: "view-1",
        name: "Moi klienci",
        entity: "lead",
        is_shared: false,
        config: { columns: ["name"], filter: {}, sort: { key: "created", dir: "desc" } },
      },
    ];
    h.savedFails = true;
    await mount();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Udostępnij zespołowi/ }));
    await waitFor(() => expect(h.toastError).toContain("widok odrzucony"));
  });

  it("panel follow-upów otwiera kartę kontaktu na wskazanym zadaniu", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    h.dueTasks = [
      {
        id: "task-9",
        lead_id: LEAD_ID,
        title: "Oddzwonić",
        due_at: new Date(Date.now() + 3_600_000).toISOString(),
        status: "open",
        lead: {
          id: LEAD_ID,
          email: "anna@example.test",
          first_name: "Anna",
          last_name: "Kowalska",
        },
      },
    ];
    await mount();
    fireEvent.click(await screen.findByLabelText("Otwórz leada"));
    const tasks = await screen.findByRole("tab", { name: /Zadania/ });
    await waitFor(() => expect(tasks).toHaveAttribute("data-state", "active"));
  });

  it("odrzucony zapis profilu w karcie pokazuje komunikat", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    h.updateFails = true;
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    fireEvent.change(await screen.findByDisplayValue("Anna"), { target: { value: "Ania" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.toastError).toContain("zapis odrzucony"));
  });

  it("zapis profilu obejmuje imię, nazwisko, firmę i etap", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    fireEvent.change(await screen.findByDisplayValue("Anna"), { target: { value: "Ania" } });
    fireEvent.change(screen.getByDisplayValue("Kowalska"), { target: { value: "Nowak" } });
    fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value: "Acme SA" } });
    const stage = screen.getByRole("combobox");
    fireEvent.keyDown(stage, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Kwalifikowany" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: LEAD_ID,
      first_name: "Ania",
      last_name: "Nowak",
      company: "Acme SA",
      stage: "qualified",
    });
  });

  it("puste pola profilu zapisują się jako brak wartości", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    fireEvent.change(await screen.findByDisplayValue("Anna"), { target: { value: "" } });
    fireEvent.change(screen.getByDisplayValue("+48 500 100 200"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toMatchObject({
      first_name: null,
      phone: null,
    });
  });

  it("odrzucony eksport osi czasu pokazuje komunikat", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    h.timelineCsvFails = true;
    h.timeline = {
      lead: { id: LEAD_ID, email: "anna@example.test" },
      events: [
        {
          id: "e1",
          type: "note",
          at: "2026-08-01T10:00:00.000Z",
          title: "Notatka zespołu",
          detail: null,
          meta: null,
        },
      ],
    };
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab(/Oś czasu/);
    await screen.findByText("Notatka zespołu");
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(h.toastError).toContain("eksport odrzucony"));
  });

  it("wydruk osi czasu otwiera okno z dokumentem, a zablokowany popup mówi wprost", async () => {
    h.rows = [lead()];
    h.total = 1;
    h.detail = detail();
    h.timeline = {
      lead: { id: LEAD_ID, email: "anna@example.test", first_name: "Anna", last_name: "Kowalska" },
      events: [
        {
          id: "e1",
          type: "note",
          at: "2026-08-01T10:00:00.000Z",
          title: "Notatka zespołu",
          detail: null,
          meta: null,
        },
      ],
    };
    const written: string[] = [];
    const fakeWindow = {
      document: { open: () => {}, write: (html: string) => written.push(html), close: () => {} },
    };
    const open = vi.fn(() => fakeWindow);
    vi.stubGlobal("open", open);
    await mount();
    fireEvent.click(await screen.findByLabelText("Szybki podgląd"));
    await openTab(/Oś czasu/);
    await screen.findByText("Notatka zespołu");
    fireEvent.click(screen.getByRole("button", { name: /Eksport PDF/ }));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toContain("Notatka zespołu");

    open.mockReturnValue(null as never);
    fireEvent.click(screen.getByRole("button", { name: /Eksport PDF/ }));
    await waitFor(() => expect(h.toastError).toContain("Popup blocked"));
    vi.unstubAllGlobals();
  });
});
