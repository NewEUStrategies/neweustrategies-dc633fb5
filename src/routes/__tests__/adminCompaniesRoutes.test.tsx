// Trasy firm CRM: lista `/admin/companies` i karta `/admin/companies/$id`.
//
// Montujemy PRAWDZIWE trasy w routerze pamięciowym: parametr ścieżki, walidacja
// query (deep-link zapisanego widoku), zapytania listy, zaznaczenie i operacje
// zbiorcze, eksport CSV oraz karta firmy z kontaktami i feedem aktywności.
// Zamockowana jest granica sieci - serwerowe funkcje CRM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  companies: [] as unknown[],
  company: null as unknown,
  activity: [] as unknown[],
  savedViews: [] as unknown[],
  listArgs: [] as unknown[],
  bulkUpdated: [] as unknown[],
  bulkDeleted: [] as unknown[],
  updated: [] as unknown[],
  createdContact: [] as unknown[],
  createdCompanies: [] as unknown[],
  notes: [] as unknown[],
  savedUpserts: [] as unknown[],
  toastError: [] as string[],
  toastSuccess: [] as string[],
}));

vi.mock("@/lib/crm-companies.functions", () => ({
  listCrmCompanies: async (input: unknown) => {
    h.listArgs.push(input);
    return { json: JSON.stringify(h.companies) };
  },
  getCrmCompany: async () => ({ json: JSON.stringify(h.company) }),
  getCrmCompanyActivity: async () => ({ json: JSON.stringify(h.activity) }),
  updateCrmCompany: async (input: unknown) => {
    h.updated.push(input);
    return { ok: true };
  },
  createCrmContactForCompany: async (input: unknown) => {
    h.createdContact.push(input);
    return { ok: true, id: "lead-new" };
  },
  addCrmCompanyNote: async (input: unknown) => {
    h.notes.push(input);
    return { ok: true };
  },
  bulkUpdateCrmCompanies: async (input: unknown) => {
    h.bulkUpdated.push(input);
    return { ok: true, updated: 1 };
  },
  bulkDeleteCrmCompanies: async (input: unknown) => {
    h.bulkDeleted.push(input);
    return { ok: true, deleted: 1 };
  },
  createCrmCompany: async (input: unknown) => {
    h.createdCompanies.push(input);
    return { ok: true, id: "company-new" };
  },
}));
vi.mock("@/lib/crm-saved-views.functions", () => ({
  listSavedViews: async () => ({ json: JSON.stringify(h.savedViews) }),
  upsertSavedView: async (input: unknown) => {
    h.savedUpserts.push(input);
    return { ok: true, id: "view-new" };
  },
  deleteSavedView: async () => ({ ok: true }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "pl" }, t: (k: string) => k }),
}));

import { Route as CompaniesRoute } from "@/routes/admin.companies.index";
import { Route as CompanyRoute } from "@/routes/admin.companies.$id";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";

const company = (over: Record<string, unknown> = {}) => ({
  id: COMPANY_ID,
  name: "Acme",
  domain: "acme.example",
  country: "Poland",
  branch: "Energetyka",
  city: "Warszawa",
  website: "https://acme.example",
  phone: "+48 500 100 200",
  address: null,
  postal_code: null,
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-05T10:00:00.000Z",
  leads_count: 3,
  contacts_count: 1,
  last_lead_activity_at: "2026-08-06T10:00:00.000Z",
  ...over,
});

const mountList = (entry = "/admin/companies") =>
  renderRoute({ route: CompaniesRoute, path: "/admin/companies", initialEntry: entry });

const mountCard = (search = "") =>
  renderRoute({
    route: CompanyRoute,
    path: "/admin/companies/$id",
    initialEntry: `/admin/companies/${COMPANY_ID}${search}`,
  });

beforeEach(() => {
  h.companies = [];
  h.company = null;
  h.activity = [];
  h.savedViews = [];
  h.listArgs = [];
  h.bulkUpdated = [];
  h.bulkDeleted = [];
  h.updated = [];
  h.createdContact = [];
  h.createdCompanies = [];
  h.notes = [];
  h.savedUpserts = [];
  h.toastError = [];
  h.toastSuccess = [];
});

afterEach(() => cleanup());

describe("lista firm", () => {
  it("strona panelu nie idzie do indeksu wyszukiwarek", async () => {
    const view = await mountList();
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("pokazuje firmy z licznikami kontaktów i leadów", async () => {
    h.companies = [company()];
    await mountList();
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    // Kolumna „Lokalizacja” skleja miasto z krajem - sprzedaż widzi jedno pole.
    expect(screen.getByText("Warszawa, Poland")).toBeInTheDocument();
    expect(screen.getByText("Energetyka")).toBeInTheDocument();
  });

  it("pusta lista pokazuje stan pusty", async () => {
    await mountList();
    expect(await screen.findByText(/Brak firm/i)).toBeInTheDocument();
  });

  it("fraza wyszukiwania idzie do zapytania serwerowego", async () => {
    await mountList();
    fireEvent.change(await screen.findByPlaceholderText(/Szukaj/), { target: { value: "acme" } });
    await waitFor(() =>
      expect(
        h.listArgs.some((a) => (a as { data?: { search?: string } })?.data?.search === "acme"),
      ).toBe(true),
    );
  });

  it("deep-link widoku z adresu ustawia aktywną zakładkę", async () => {
    const view = await mountList("/admin/companies?view=builtin:all");
    expect(view.search()).toMatchObject({ view: "builtin:all" });
  });

  it("walidator adresu przepuszcza tylko identyfikator w formacie UUID", () => {
    // Trasa montowana w harnessie dziedziczy surowy query po korzeniu, więc
    // regułę sprawdzamy na samym walidatorze trasy - to on chroni zapytanie
    // serwerowe przed wstrzyknięciem dowolnego ciągu w miejsce identyfikatora.
    const validate = CompaniesRoute.options.validateSearch as (
      raw: Record<string, unknown>,
    ) => { company?: string; view?: string };
    expect(validate({ company: "nie-uuid" }).company).toBeUndefined();
    expect(validate({ company: COMPANY_ID }).company).toBe(COMPANY_ID);
    expect(validate({ view: "x".repeat(200) }).view).toBeUndefined();
    expect(validate({}).company).toBeUndefined();
  });

  it("zaznaczenie firmy pozwala zmienić kraj zbiorczo", async () => {
    h.companies = [company()];
    await mountList();
    // Checkbox wiersza ma etykietę z nazwą firmy (nagłówkowy „zaznacz wszystkie”
    // jest osobny), więc operacja zbiorcza dotyczy dokładnie tego rekordu.
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Kraj" }));
    const input = await screen.findByLabelText("Kraj");
    fireEvent.change(input, { target: { value: " Belgia " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(1));
    const payload = (h.bulkUpdated[0] as { data: { ids: string[]; country: string } }).data;
    expect(payload.ids).toEqual([COMPANY_ID]);
    // Wartość z pola idzie przycięta - inaczej w bazie lądują kraje ze spacją.
    expect(payload.country).toBe("Belgia");
  });

  it("usunięcie zbiorcze wymaga potwierdzenia", async () => {
    h.companies = [company()];
    await mountList();
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Usuń" }));
    // Kasowanie firm jest nieodwracalne - potwierdzenie jest w oknie dialogowym,
    // nie pod tym samym przyciskiem co wyzwalacz.
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/nieodwracalna/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.bulkDeleted).toHaveLength(1));
    expect((h.bulkDeleted[0] as { data: { ids: string[] } }).data.ids).toEqual([COMPANY_ID]);
  });
});

describe("karta firmy", () => {
  it("brak firmy pokazuje komunikat zamiast pustego ekranu", async () => {
    await mountCard();
    expect(await screen.findByText("Firma nieznaleziona.")).toBeInTheDocument();
  });

  it("pokazuje dane firmy, kontakty i feed aktywności", async () => {
    h.company = {
      company: company(),
      profiles: [{ id: "u1", display_name: "Anna Kowalska", job_title: "Dyrektorka" }],
      leads: [
        {
          id: LEAD_ID,
          email: "anna@example.test",
          first_name: "Anna",
          last_name: "Kowalska",
          stage: "new",
          score: 40,
          score_band: "warm",
          tags: [],
          last_activity_at: "2026-08-05T10:00:00.000Z",
          created_at: "2026-08-01T10:00:00.000Z",
        },
      ],
    };
    h.activity = [
      {
        id: "a1",
        kind: "note",
        action: "crm.company.note",
        created_at: "2026-08-06T10:00:00.000Z",
        actor_id: "u1",
        lead_id: null,
        lead_label: null,
        body: "Spotkanie w Brukseli",
      },
    ];
    await mountCard();
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    // Profil (stanowisko) i lead (e-mail) to dwa różne źródła tej samej osoby -
    // karta pokazuje oba, więc handlowiec wie, że kontakt ma konto w serwisie.
    expect(screen.getByText("Dyrektorka")).toBeInTheDocument();
    expect(screen.getByText("anna@example.test")).toBeInTheDocument();
    expect(screen.getByText(/Spotkanie w Brukseli/)).toBeInTheDocument();
  });

  it("notatka firmowa idzie na serwer z treścią i identyfikatorem firmy", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    // Notatka mieszka w zakładce „Aktywność” - wchodzimy tam z adresu, bo
    // zakładka jest w query (deep-link działa też z powiadomienia).
    await mountCard("?tab=activity");
    const input = await screen.findByPlaceholderText(/Krótka notatka wewnętrzna/);
    fireEvent.change(input, { target: { value: "Rozmowa o ofercie" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz notatkę" }));
    await waitFor(() => expect(h.notes).toHaveLength(1));
    expect((h.notes[0] as { data: Record<string, unknown> }).data).toMatchObject({
      company_id: COMPANY_ID,
      body: "Rozmowa o ofercie",
    });
  });

  it("pusta notatka nie idzie na serwer", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard("?tab=activity");
    const save = await screen.findByRole("button", { name: "Zapisz notatkę" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(h.notes).toHaveLength(0);
  });

  it("edycja pól firmy zapisuje patch", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj" }));
    const city = await screen.findByDisplayValue("Warszawa");
    fireEvent.change(city, { target: { value: "Kraków" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: COMPANY_ID,
      city: "Kraków",
    });
  });

  it("pusta nazwa blokuje zapis edycji - firma bez nazwy jest nie do odszukania", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj" }));
    fireEvent.change(await screen.findByDisplayValue("Acme"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
    expect(h.updated).toHaveLength(0);
  });

  it("szybka akcja „Dodaj notatkę” przełącza na zakładkę aktywności", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    const view = await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: /Dodaj notatkę/ }));
    await waitFor(() => expect(view.search()).toMatchObject({ tab: "activity" }));
    expect(await screen.findByPlaceholderText(/Krótka notatka wewnętrzna/)).toBeInTheDocument();
  });
});
