// Trasa `/admin/crm/$id` - pełna karta osoby w CRM.
//
// Karta łączy w jednym miejscu dane osobowe z czterech źródeł (formularze,
// newsletter, notatki zespołu, oś czasu) i pozwala je zmienić: edycja inline,
// zmiana etapu jednym wyborem, notatka i push do partnerów CRM. Test montuje
// PRAWDZIWĄ trasę (parametr ścieżki `$id` idzie do zapytania) i sprawdza, co
// naprawdę leci na serwer - w szczególności, że zapis wysyła TYLKO zmienione
// pola, a nie cały rekord.
//
// Zamockowana jest wyłącznie granica sieci. Dane są syntetyczne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  detail: null as unknown,
  detailThrows: false,
  timeline: { lead: { email: "anna@example.test" }, events: [] as unknown[] },
  detailArgs: [] as unknown[],
  updated: [] as unknown[],
  updateThrows: false,
  notesAdded: [] as unknown[],
  notesDeleted: [] as unknown[],
  pushed: [] as unknown[],
  toastError: [] as string[],
  toastSuccess: [] as string[],
  lang: "pl",
}));

vi.mock("@/lib/crm.functions", () => ({
  getCrmLead: async (input: unknown) => {
    h.detailArgs.push(input);
    if (h.detailThrows) throw new Error("read failed");
    return { json: JSON.stringify(h.detail) };
  },
  getCrmLeadTimeline: async () => ({ json: JSON.stringify(h.timeline) }),
  updateCrmLead: async (input: unknown) => {
    h.updated.push(input);
    if (h.updateThrows) throw new Error("update failed");
    return { ok: true };
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
    return { ok: true, delivered: 2, endpoints: 2 };
  },
  recomputeLeadScore: async () => ({ json: "null" }),
  getCrmLeadMonthlyMetering: async () => ({ json: "null" }),
  getCrmLeadMembership: async () => ({ json: "null" }),
  getCrmLeadProfileSync: async () => ({ json: JSON.stringify({ matched: false }) }),
}));
vi.mock("@/lib/crm-tasks.functions", () => ({
  listCrmLeadTasks: async () => ({ json: "[]" }),
  createCrmTask: async () => ({ ok: true }),
  updateCrmTask: async () => ({ ok: true }),
  deleteCrmTask: async () => ({ ok: true }),
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

import { Route } from "@/routes/admin.crm.$id";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";

const lead = (over: Record<string, unknown> = {}) => ({
  id: LEAD_ID,
  tenant_id: "t1",
  email: "anna@example.test",
  aliases: null,
  first_name: "Anna",
  last_name: "Kowalska",
  phone: "+48 500 100 200",
  position: "Dyrektorka",
  company: "Acme",
  company_id: null,
  country: "Poland",
  linkedin_url: null,
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

const detail = (over: Record<string, unknown> = {}) => {
  const { lead: leadOver, ...rest } = over as { lead?: Record<string, unknown> };
  return {
    lead: lead(leadOver ?? {}),
    messages: [],
    subscriptions: [],
    consents: [],
    notes: [],
    profile_avatar_url: null,
    ...rest,
  };
};

const mount = () =>
  renderRoute({
    route: Route,
    path: "/admin/crm/$id",
    initialEntry: `/admin/crm/${LEAD_ID}`,
  });

const openTab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  h.detail = detail();
  h.detailThrows = false;
  h.timeline = { lead: { email: "anna@example.test" }, events: [] };
  h.detailArgs = [];
  h.updated = [];
  h.updateThrows = false;
  h.notesAdded = [];
  h.notesDeleted = [];
  h.pushed = [];
  h.toastError = [];
  h.toastSuccess = [];
  h.lang = "pl";
});

afterEach(() => cleanup());

describe("karta osoby CRM", () => {
  it("panel nie idzie do indeksu wyszukiwarek", async () => {
    const view = await mount();
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("identyfikator ze ścieżki trafia do zapytania o kartę", async () => {
    await mount();
    await waitFor(() => expect(h.detailArgs[0]).toEqual({ data: { id: LEAD_ID } }));
  });

  it("pokazuje osobę, kontakt i tagi z bazy", async () => {
    await mount();
    // Nazwisko jest i w okruszkach, i w lewym railu - to jedna osoba w dwóch
    // miejscach, więc liczymy wystąpienia zamiast udawać, że jest jedno.
    expect((await screen.findAllByText("Anna Kowalska")).length).toBeGreaterThan(0);
    expect(screen.getByText("anna@example.test")).toBeInTheDocument();
    expect(screen.getByText("+48 500 100 200")).toBeInTheDocument();
    expect(screen.getByText("energia")).toBeInTheDocument();
    expect(screen.getByText("Zgoda marketingowa")).toBeInTheDocument();
  });

  it("brak kontaktu daje komunikat i drogę powrotną, nie biały ekran", async () => {
    h.detail = null;
    const view = await mount();
    expect(await screen.findByText("Nie znaleziono kontaktu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Wróć do listy/ }));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/crm"));
  });

  it("wersja angielska ma komplet etykiet - panel jest dwujęzyczny", async () => {
    h.lang = "en";
    h.detail = detail({ lead: { tags: [], position: null } });
    await mount();
    expect(await screen.findByText("No tags")).toBeInTheDocument();
    expect(screen.getByText("No position")).toBeInTheDocument();
    expect(screen.getByText("Marketing consent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
    expect(await screen.findByText("No events yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Analytics/ }));
    expect(await screen.findByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Subs")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to CRM partners/ })).toBeInTheDocument();
    // Formularz edycji ma własny komplet etykiet - też musi być dwujęzyczny.
    fireEvent.click(screen.getByRole("button", { name: /Overview/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.getByText("Last")).toBeInTheDocument();
    expect(screen.getByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("Position")).toBeInTheDocument();
    // „Company” jest i etykietą pola, i tytułem karty w sidebarze.
    expect(screen.getAllByText("Company").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Country")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByPlaceholderText("Write a note…")).toBeInTheDocument();
  });

  it("wersja angielska nazywa też stany puste i powiązania", async () => {
    h.lang = "en";
    h.detail = detail({ lead: { company: null, company_id: null } });
    await mount();
    expect(await screen.findByText("No company.")).toBeInTheDocument();
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
    expect(screen.getByText("No messages.")).toBeInTheDocument();

    cleanup();
    h.detail = detail({ lead: { company_id: COMPANY_ID } });
    await mount();
    expect(await screen.findByText("Open company")).toBeInTheDocument();
    expect(screen.getByText("Linked profile")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("błąd odczytu też kończy się komunikatem, nie wywrotką", async () => {
    h.detailThrows = true;
    await mount();
    expect(await screen.findByText("Nie znaleziono kontaktu.")).toBeInTheDocument();
  });

  it("brak danych opisowych pokazuje myślniki zamiast pustych pól", async () => {
    h.detail = detail({ lead: { phone: null, position: null, company: null, country: null, tags: [] } });
    await mount();
    expect(await screen.findByText("Brak tagów")).toBeInTheDocument();
    expect(screen.getByText("Brak stanowiska")).toBeInTheDocument();
  });

  it("zapis edycji wysyła TYLKO zmienione pola", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.change(await screen.findByDisplayValue("Dyrektorka"), {
      target: { value: "Dyrektorka ds. energii" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    // Kluczowa reguła: patch zawiera identyfikator i JEDNO zmienione pole -
    // wysyłanie całego rekordu nadpisywałoby zmiany zrobione równolegle.
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toEqual({
      id: LEAD_ID,
      position: "Dyrektorka ds. energii",
    });
  });

  it("edycja bez zmian nie wysyła nic i zamyka formularz", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Edytuj/ })).toBeInTheDocument());
    expect(h.updated).toHaveLength(0);
  });

  it("anulowanie edycji porzuca szkic", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.change(await screen.findByDisplayValue("Acme"), { target: { value: "Inna firma" } });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Inna firma")).toBeNull());
    expect(h.updated).toHaveLength(0);
  });

  it("wyczyszczone pole zapisuje się jako NULL, nie jako pusty łańcuch", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.change(await screen.findByDisplayValue("+48 500 100 200"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toEqual({
      id: LEAD_ID,
      phone: null,
    });
  });

  it("zmiana etapu w selektorze idzie na serwer od razu", async () => {
    await mount();
    const trigger = await screen.findByRole("combobox");
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Kwalifikowany" }));
    await waitFor(() =>
      expect(h.updated).toEqual([{ data: { id: LEAD_ID, stage: "qualified" } }]),
    );
  });

  it("notatka idzie z kluczem idempotencji, a kasowanie z identyfikatorem", async () => {
    h.detail = detail({
      notes: [
        { id: "n1", body: "Rozmowa o ofercie", author_id: "u1", created_at: "2026-08-05T10:00:00.000Z" },
      ],
    });
    await mount();
    const box = await screen.findByPlaceholderText("Napisz notatkę…");
    fireEvent.change(box, { target: { value: "  Wysłać materiały  " } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj notatkę" }));
    await waitFor(() => expect(h.notesAdded).toHaveLength(1));
    const payload = (h.notesAdded[0] as { data: Record<string, unknown> }).data;
    expect(payload).toMatchObject({ lead_id: LEAD_ID, body: "Wysłać materiały" });
    expect(typeof payload.idempotency_key).toBe("string");

    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.notesDeleted).toEqual([{ data: { id: "n1" } }]));
  });

  it("pusta notatka nie da się wysłać", async () => {
    await mount();
    const add = await screen.findByRole("button", { name: "Dodaj notatkę" });
    expect(add).toBeDisabled();
  });

  it("zakładka aktywności pokazuje oś czasu, a pusta mówi o braku zdarzeń", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Aktywność/ }));
    expect(await screen.findByText("Brak zdarzeń.")).toBeInTheDocument();

    cleanup();
    h.timeline = {
      lead: { email: "anna@example.test" },
      events: [
        {
          id: "e1",
          type: "stage_change",
          at: "2026-08-09T10:00:00.000Z",
          title: "Etap: new -> contacted",
          detail: "zmiana ręczna",
          meta: null,
        },
      ],
    };
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Aktywność/ }));
    expect(await screen.findByText("Etap: new -> contacted")).toBeInTheDocument();
    expect(screen.getByText("zmiana ręczna")).toBeInTheDocument();
  });

  it("zakładka analityki liczy wiadomości, subskrypcje i notatki", async () => {
    h.detail = detail({
      messages: [
        {
          id: "m1",
          form_type: "contact",
          form_id: "contact",
          form_name: "Kontakt",
          subject: "Zapytanie",
          message: "Proszę o ofertę",
          lang: "pl",
          page_url: null,
          custom: null,
          career_applications: null,
          created_at: "2026-08-02T10:00:00.000Z",
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
        },
      ],
      notes: [{ id: "n1", body: "Notatka", author_id: null, created_at: "2026-08-04T10:00:00.000Z" }],
    });
    await mount();
    // Przegląd pokazuje wiadomość z formularza…
    expect(await screen.findByText("Zapytanie")).toBeInTheDocument();
    expect(screen.getByText("Proszę o ofertę")).toBeInTheDocument();
    // …a analityka jej licznik.
    openTab("Analityka");
    expect(await screen.findByText("Wiadomości")).toBeInTheDocument();
    expect(screen.getByText("Subskrypcje")).toBeInTheDocument();
  });

  it("firma powiązana prowadzi do karty firmy, a niepowiązana mówi o tym wprost", async () => {
    h.detail = detail({ lead: { company_id: COMPANY_ID } });
    await mount();
    expect(await screen.findByText("Otwórz kartę firmy")).toBeInTheDocument();

    cleanup();
    h.detail = detail();
    await mount();
    expect(await screen.findByText("Nie powiązano z CRM firm")).toBeInTheDocument();

    cleanup();
    h.detail = detail({ lead: { company: null, company_id: null } });
    await mount();
    expect(await screen.findByText("Brak firmy.")).toBeInTheDocument();
  });

  it("sekcja sidebaru zwija się i wtedy nie renderuje swojej zawartości", async () => {
    await mount();
    const header = await screen.findByRole("button", { name: /Integracje/ });
    expect(screen.getByRole("button", { name: /Wyślij do partnerów CRM/ })).toBeInTheDocument();
    fireEvent.click(header);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Wyślij do partnerów CRM/ })).toBeNull(),
    );
  });

  it("zapis wszystkich pól opisowych składa jeden patch", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.change(await screen.findByDisplayValue("Anna"), { target: { value: "Ania" } });
    fireEvent.change(screen.getByDisplayValue("Kowalska"), { target: { value: "Nowak" } });
    fireEvent.change(screen.getByDisplayValue("Poland"), { target: { value: "Belgium" } });
    fireEvent.change(screen.getByDisplayValue("Acme"), { target: { value: "Acme SA" } });
    fireEvent.change(screen.getByPlaceholderText("https://linkedin.com/in/..."), {
      target: { value: "https://linkedin.com/in/ania" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toEqual({
      id: LEAD_ID,
      first_name: "Ania",
      last_name: "Nowak",
      company: "Acme SA",
      country: "Belgium",
      linkedin_url: "https://linkedin.com/in/ania",
    });
  });

  it("błąd zapisu pokazuje komunikat zamiast cichej porażki", async () => {
    h.updateThrows = true;
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Edytuj/ }));
    fireEvent.change(await screen.findByDisplayValue("Anna"), { target: { value: "Ania" } });
    fireEvent.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(h.toastError).toContain("update failed"));
  });

  it("kopiowanie e-maila i telefonu wkłada wartość do schowka", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mount();
    const copies = await screen.findAllByLabelText("Copy");
    fireEvent.click(copies[0]);
    fireEvent.click(copies[1]);
    await waitFor(() => expect(writeText.mock.calls.flat()).toEqual([
      "anna@example.test",
      "+48 500 100 200",
    ]));
  });

  it("kontakt bez telefonu nie oferuje kopiowania pustej wartości", async () => {
    h.detail = detail({ lead: { phone: null } });
    await mount();
    expect(await screen.findByText("Anna Kowalska", { selector: "div" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Copy")).toHaveLength(1);
  });

  it("powrót z karty prowadzi na listę kontaktów", async () => {
    const view = await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Kontakty/ }));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/crm"));
  });

  it("push do partnerów woła serwer dla tego kontaktu", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /Wyślij do partnerów CRM/ }));
    await waitFor(() => expect(h.pushed).toEqual([{ data: { lead_id: LEAD_ID } }]));
  });
});
