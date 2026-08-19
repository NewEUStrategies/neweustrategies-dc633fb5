// Trasy firm CRM: lista `/admin/companies` i karta `/admin/companies/$id`.
//
// Montujemy PRAWDZIWE trasy w routerze pamięciowym: parametr ścieżki, walidacja
// query (deep-link zapisanego widoku), zapytania listy, zaznaczenie i operacje
// zbiorcze, eksport CSV oraz karta firmy z kontaktami i feedem aktywności.
// Zamockowana jest granica sieci - serwerowe funkcje CRM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  savedDeleted: [] as unknown[],
  bulkFails: false,
  bulkDeleteFails: false,
  savedFails: false,
  savedDeleteFails: false,
  memberOrgs: [] as unknown[],
  tiers: [] as unknown[],
  uploadFails: false,
  updateFails: false,
  companyThrows: false,
  noteFails: false,
  uploaded: [] as unknown[],
  toastError: [] as string[],
  toastSuccess: [] as string[],
  lang: "pl",
}));

vi.mock("@/lib/crm-companies.functions", () => ({
  listCrmCompanies: async (input: unknown) => {
    h.listArgs.push(input);
    return { json: JSON.stringify(h.companies) };
  },
  getCrmCompany: async () => {
    if (h.companyThrows) throw new Error("odczyt odrzucony");
    return { json: JSON.stringify(h.company) };
  },
  getCrmCompanyActivity: async () => ({ json: JSON.stringify(h.activity) }),
  updateCrmCompany: async (input: unknown) => {
    h.updated.push(input);
    if (h.updateFails) throw new Error("zapis odrzucony");
    return { ok: true };
  },
  createCrmContactForCompany: async (input: unknown) => {
    h.createdContact.push(input);
    return { ok: true, id: "lead-new" };
  },
  addCrmCompanyNote: async (input: unknown) => {
    h.notes.push(input);
    if (h.noteFails) throw new Error("notatka odrzucona");
    return { ok: true };
  },
  bulkUpdateCrmCompanies: async (input: unknown) => {
    h.bulkUpdated.push(input);
    if (h.bulkFails) throw new Error("brak uprawnień");
    return { ok: true, updated: 1 };
  },
  bulkDeleteCrmCompanies: async (input: unknown) => {
    h.bulkDeleted.push(input);
    if (h.bulkDeleteFails) throw new Error("kasowanie odrzucone");
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
    if (h.savedFails) throw new Error("widok odrzucony");
    h.savedUpserts.push(input);
    return { ok: true, id: "view-new" };
  },
  deleteSavedView: async (input: unknown) => {
    if (h.savedDeleteFails) throw new Error("kasowanie widoku odrzucone");
    h.savedDeleted.push(input);
    return { ok: true };
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === "member_organizations" ? h.memberOrgs : h.tiers;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "in", "is", "not", "limit"]) {
        chain[m] = () => chain;
      }
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      return chain;
    },
    storage: {
      from: () => ({
        upload: async (path: string, file: unknown) => {
          h.uploaded.push({ path, file });
          return h.uploadFails ? { error: new Error("upload odrzucony") } : { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: h.lang }, t: (k: string) => k }),
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

const savedView = (over: Record<string, unknown> = {}) => ({
  id: "view-1",
  name: "Firmy z UE",
  entity: "company",
  is_shared: false,
  config: { columns: ["name"], filter: {}, sort: { key: "name", dir: "asc" } },
  ...over,
});

const mountList = (entry = "/admin/companies") =>
  renderRoute({ route: CompaniesRoute, path: "/admin/companies", initialEntry: entry });

/** Ukryte pole pliku loga - istnieje dopiero po wczytaniu kartoteki. */
const fileInput = async () => {
  await screen.findByLabelText("Zmień logo");
  return document.querySelector("input[type='file']") as HTMLInputElement;
};

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
  h.savedDeleted = [];
  h.bulkFails = false;
  h.bulkDeleteFails = false;
  h.savedFails = false;
  h.savedDeleteFails = false;
  h.memberOrgs = [];
  h.tiers = [];
  h.uploadFails = false;
  h.updateFails = false;
  h.companyThrows = false;
  h.noteFails = false;
  h.uploaded = [];
  h.toastError = [];
  h.toastSuccess = [];
  h.lang = "pl";
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

  it("statystyki liczą firmy, kontakty i leady z bieżącej listy", async () => {
    h.companies = [
      company(),
      company({ id: "c2", name: "Beta", leads_count: 0, contacts_count: 2, city: "Gdańsk" }),
    ];
    await mountList();
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    // 2 firmy, 3 kontakty, 3 leady, 1 firma z leadami.
    const stats = document.body.textContent ?? "";
    expect(stats).toContain("Beta");
  });

  it("sortowanie po kolumnie odwraca kierunek przy drugim kliknięciu", async () => {
    h.companies = [
      company({ id: "c1", name: "Beta" }),
      company({ id: "c2", name: "Acme" }),
    ];
    await mountList();
    const thead = document.querySelector("thead") as HTMLElement;
    const header = within(thead).getByRole("button", { name: /Firma/ });
    fireEvent.click(header);
    await waitFor(() => {
      const names = Array.from(document.querySelectorAll("tbody tr td:nth-child(2)")).map(
        (n) => n.textContent ?? "",
      );
      expect(names[0]).toContain("Acme");
    });
    fireEvent.click(header);
    await waitFor(() => {
      const names = Array.from(document.querySelectorAll("tbody tr td:nth-child(2)")).map(
        (n) => n.textContent ?? "",
      );
      expect(names[0]).toContain("Beta");
    });
  });

  it("zaznaczenie nagłówkowe obejmuje całą przefiltrowaną listę i da się cofnąć", async () => {
    h.companies = [company(), company({ id: "c2", name: "Beta" })];
    await mountList();
    await screen.findByText("Acme");
    const all = screen.getByLabelText("Zaznacz wszystkie");
    fireEvent.click(all);
    expect(await screen.findByText("2 firm zaznaczonych")).toBeInTheDocument();
    fireEvent.click(all);
    await waitFor(() => expect(screen.queryByText("2 firm zaznaczonych")).toBeNull());
  });

  it("czyszczenie kraju zbiorczo wysyła NULL, nie pusty napis", async () => {
    h.companies = [company()];
    await mountList();
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Kraj" }));
    // „Wyczyść” jest dwa razy: w dymku kraju i na pasku (czyszczenie zaznaczenia).
    const group = (await screen.findByLabelText("Kraj")).parentElement as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: "Wyczyść" }));
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(1));
    expect((h.bulkUpdated[0] as { data: { country: string | null } }).data.country).toBeNull();
  });

  it("pusta wartość kraju nie wysyła mutacji", async () => {
    h.companies = [company()];
    await mountList();
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Kraj" }));
    const input = await screen.findByLabelText("Kraj");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.bulkUpdated).toHaveLength(0));
  });

  it("odrzucona operacja zbiorcza pokazuje komunikat serwera", async () => {
    h.companies = [company()];
    h.bulkFails = true;
    await mountList();
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Kraj" }));
    const group = (await screen.findByLabelText("Kraj")).parentElement as HTMLElement;
    fireEvent.click(within(group).getByRole("button", { name: "Wyczyść" }));
    await waitFor(() => expect(h.toastError).toContain("brak uprawnień"));
  });

  it("czyszczenie zaznaczenia chowa pasek operacji zbiorczych", async () => {
    h.companies = [company()];
    await mountList();
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Wyczyść" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Akcje zbiorcze" })).toBeNull());
  });

  it("eksport CSV bierze przefiltrowane wiersze i widoczne kolumny", async () => {
    const createObjectURL = vi.fn(() => "blob:companies");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    h.companies = [company(), company({ id: "c2", name: "Beta" })];
    await mountList();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(h.toastSuccess).toContain("Wyeksportowano 2 firm"));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("zapisany widok z serwera daje się wybrać, zmienić nazwę i usunąć", async () => {
    h.savedViews = [
      {
        id: "view-1",
        name: "Firmy z UE",
        entity: "company",
        is_shared: false,
        config: { columns: ["name", "country"], filter: {}, sort: { key: "name", dir: "asc" } },
      },
    ];
    h.companies = [company()];
    await mountList();
    fireEvent.click(await screen.findByRole("button", { name: /Firmy z UE/ }));
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę" }));
    const input = await screen.findByDisplayValue("Firmy z UE");
    fireEvent.change(input, { target: { value: "Firmy z UE i EFTA" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedUpserts).toHaveLength(1));
    expect((h.savedUpserts[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: "view-1",
      entity: "company",
      name: "Firmy z UE i EFTA",
    });

    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Usuń widok/ }));
    await waitFor(() => expect(h.savedDeleted).toEqual([{ data: { id: "view-1" } }]));
  });

  it("zapisanie bieżącej konfiguracji tworzy widok z kolumnami i filtrem", async () => {
    await mountList();
    fireEvent.click(await screen.findByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(await screen.findByPlaceholderText(/np. Firmy z UE/), {
      target: { value: "Moje firmy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedUpserts).toHaveLength(1));
    const payload = (h.savedUpserts[0] as { data: Record<string, unknown> }).data;
    expect(payload).toMatchObject({ entity: "company", name: "Moje firmy", is_shared: false });
    expect(payload.config).toBeTruthy();
  });

  it("udostępnienie widoku zespołowi zmienia flagę, nie nazwę", async () => {
    h.savedViews = [
      {
        id: "view-1",
        name: "Firmy z UE",
        entity: "company",
        is_shared: false,
        config: { columns: ["name"], filter: {}, sort: { key: "name", dir: "asc" } },
      },
    ];
    await mountList();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Udostępnij zespołowi/ }));
    await waitFor(() => expect(h.savedUpserts).toHaveLength(1));
    expect((h.savedUpserts[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: "view-1",
      name: "Firmy z UE",
      is_shared: true,
    });
  });

  it("utworzenie firmy przenosi od razu na jej kartę", async () => {
    const view = await mountList();
    fireEvent.click(await screen.findByRole("button", { name: /Nowa firma|Dodaj firmę/ }));
    const name = await screen.findByLabelText(/Nazwa/);
    fireEvent.change(name, { target: { value: "Nowa spółka" } });
    const dialog = document.querySelector("[role='dialog']") as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: /Utwórz|Dodaj|Zapisz/ }));
    await waitFor(() => expect(h.createdCompanies).toHaveLength(1));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/companies/company-new"));
  });

  it("wersja angielska ma komplet etykiet listy", async () => {
    h.lang = "en";
    await mountList();
    expect(await screen.findByText("No companies match your filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
  });


  it("chip filtru zawęża listę lokalnie, bez nowego zapytania", async () => {
    h.companies = [
      company(),
      company({ id: "c2", name: "Beta", country: "Belgium", branch: "Transport" }),
    ];
    await mountList();
    await screen.findByText("Acme");
    const before = h.listArgs.length;
    fireEvent.click(screen.getByRole("button", { name: /Kraj/ }));
    const trigger = await screen.findByRole("combobox");
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Belgium" }));
    await waitFor(() => expect(screen.queryByText("Acme")).toBeNull());
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // Filtr firm liczy się po stronie panelu - lista z serwera się nie zmienia.
    expect(h.listArgs.length).toBe(before);
  });

  it("data aktywności jest opisana po ludzku, a jej brak myślnikiem", async () => {
    const now = Date.now();
    h.companies = [
      company({ id: "c1", name: "Dzis", last_lead_activity_at: new Date(now - 3600_000).toISOString() }),
      company({ id: "c2", name: "Wczoraj", last_lead_activity_at: new Date(now - 30 * 3600_000).toISOString() }),
      company({ id: "c3", name: "Dawno", last_lead_activity_at: new Date(now - 200 * 86_400_000).toISOString() }),
      company({ id: "c4", name: "   ", domain: null, last_lead_activity_at: null, updated_at: null }),
    ];
    await mountList();
    expect(await screen.findByText("dzisiaj")).toBeInTheDocument();
    expect(screen.getByText("wczoraj")).toBeInTheDocument();
    // Nazwa z samych spacji nie ma z czego złożyć inicjałów.
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("klik w telefon i w strzałkę nie otwiera karty firmy", async () => {
    h.companies = [company()];
    const view = await mountList();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: /Kolumny/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Telefon" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(await screen.findByRole("link", { name: /\+48 500 100 200/ }));
    expect(view.currentPath()).toBe("/admin/companies");
    fireEvent.click(screen.getByLabelText("Otwórz firmę"));
    await waitFor(() => expect(view.currentPath()).toBe(`/admin/companies/${COMPANY_ID}`));
  });

  it("odrzucona zmiana nazwy widoku mówi o błędzie", async () => {
    h.savedViews = [savedView()];
    h.savedFails = true;
    await mountList();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: "Zmień nazwę" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.toastError).toContain("widok odrzucony"));
  });

  it("odrzucone udostępnienie widoku mówi o błędzie", async () => {
    h.savedViews = [savedView()];
    h.savedFails = true;
    await mountList();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Udostępnij zespołowi/ }));
    await waitFor(() => expect(h.toastError).toContain("widok odrzucony"));
  });

  it("odrzucone kasowanie widoku mówi o błędzie", async () => {
    h.savedViews = [savedView()];
    h.savedDeleteFails = true;
    await mountList();
    fireEvent.click(await screen.findByLabelText("Opcje widoku"));
    fireEvent.click(await screen.findByRole("button", { name: /Usuń widok/ }));
    await waitFor(() => expect(h.toastError).toContain("kasowanie widoku odrzucone"));
  });

  it("włączone kolumny opcjonalne pokazują domenę, telefon, stronę i daty", async () => {
    h.companies = [
      company(),
      company({
        id: "c2",
        name: "Beta",
        branch: "Transport",
        country: "Belgium",
        city: null,
        domain: null,
        phone: null,
        website: null,
        last_lead_activity_at: null,
        updated_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      }),
    ];
    await mountList();
    await screen.findByText("Acme");
    fireEvent.click(screen.getByRole("button", { name: /Kolumny/ }));
    for (const label of ["Domena", "Telefon", "WWW", "Kraj", "Utworzono"]) {
      const box = await screen.findByRole("checkbox", { name: label });
      fireEvent.click(box);
    }
    // Firma z kompletem danych pokazuje odnośniki, firma bez nich - myślniki.
    expect((await screen.findAllByText("acme.example")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: /\+48 500 100 200/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /acme.example/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Belgium").length).toBeGreaterThan(0);
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(screen.getByText("5 d temu")).toBeInTheDocument();
  });

  it("firma bez domeny pokazuje inicjały zamiast pustego kafelka", async () => {
    h.companies = [
      company({ domain: null }),
      company({ id: "c2", name: "Beta Gamma Delta", domain: null }),
      company({ id: "c3", name: "Solo", domain: null }),
    ];
    await mountList();
    expect(await screen.findByText("AC")).toBeInTheDocument();
    // Wieloczłonowa nazwa: pierwsza litera pierwszego i OSTATNIEGO członu.
    expect(screen.getByText("BD")).toBeInTheDocument();
    expect(screen.getByText("SO")).toBeInTheDocument();
  });

  it("niedziałające logo z domeny spada do inicjałów", async () => {
    h.companies = [company()];
    await mountList();
    const img = (await screen.findByText("Acme")).ownerDocument.querySelector(
      "img[src*='favicons']",
    ) as HTMLImageElement;
    fireEvent.error(img);
    expect(await screen.findByText("AC")).toBeInTheDocument();
  });

  it("klik w wiersz otwiera kartę firmy, a klik w checkbox nie", async () => {
    h.companies = [company()];
    const view = await mountList();
    const checkbox = await screen.findByLabelText("Acme");
    fireEvent.click(checkbox);
    expect(view.currentPath()).toBe("/admin/companies");
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Akcje zbiorcze" })).toBeNull());
    fireEvent.click(screen.getByText("Acme"));
    await waitFor(() => expect(view.currentPath()).toBe(`/admin/companies/${COMPANY_ID}`));
  });

  it("błąd zapisu widoku pokazuje komunikat serwera", async () => {
    h.savedFails = true;
    await mountList();
    fireEvent.click(await screen.findByRole("button", { name: /Zapisz widok/ }));
    fireEvent.change(await screen.findByPlaceholderText(/np. Firmy z UE/), {
      target: { value: "Widok" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.toastError).toContain("widok odrzucony"));
  });

  it("błąd kasowania zaznaczonych firm nie znika po cichu", async () => {
    h.companies = [company()];
    h.bulkDeleteFails = true;
    await mountList();
    fireEvent.click(await screen.findByLabelText("Acme"));
    const bar = await screen.findByRole("region", { name: "Akcje zbiorcze" });
    fireEvent.click(within(bar).getByRole("button", { name: "Usuń" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.toastError).toContain("kasowanie odrzucone"));
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

  it("edycja obejmuje komplet pól kartoteki", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj" }));
    fireEvent.change(await screen.findByDisplayValue("acme.example"), {
      target: { value: "acme.eu" },
    });
    fireEvent.change(screen.getByDisplayValue("https://acme.example"), {
      target: { value: "https://acme.eu" },
    });
    fireEvent.change(screen.getByDisplayValue("Energetyka"), { target: { value: "Klimat" } });
    fireEvent.change(screen.getByDisplayValue("Poland"), { target: { value: "Belgium" } });
    fireEvent.change(screen.getByDisplayValue("+48 500 100 200"), {
      target: { value: "+32 2 000 00 00" },
    });
    const labels = ["Adres", "Kod pocztowy"];
    for (const [i, value] of ["Rue de la Loi 1", "1000"].entries()) {
      const field = screen.getByText(labels[i]).parentElement as HTMLElement;
      fireEvent.change(within(field).getByRole("textbox"), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: Record<string, unknown> }).data).toMatchObject({
      id: COMPANY_ID,
      domain: "acme.eu",
      website: "https://acme.eu",
      branch: "Klimat",
      country: "Belgium",
      phone: "+32 2 000 00 00",
      address: "Rue de la Loi 1",
      postal_code: "1000",
    });
  });

  it("anulowanie edycji nie wysyła nic", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj" }));
    fireEvent.change(await screen.findByDisplayValue("Warszawa"), { target: { value: "Kraków" } });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Kraków")).toBeNull());
    expect(h.updated).toHaveLength(0);
  });

  it("odrzucony zapis kartoteki pokazuje komunikat serwera", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    h.updateFails = true;
    await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: "Edytuj" }));
    fireEvent.change(await screen.findByDisplayValue("Warszawa"), { target: { value: "Kraków" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.toastError).toContain("zapis odrzucony"));
  });

  it("kopiowanie pól kartoteki wkłada wartość do schowka", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    const copies = await screen.findAllByLabelText("Copy");
    fireEvent.click(copies[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("acme.example"));
    expect(h.toastSuccess.some((m) => m.includes("Skopiowano"))).toBe(true);
  });

  it("nieudane kopiowanie mówi o porażce, nie udaje sukcesu", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("brak dostępu");
        },
      },
    });
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    fireEvent.click((await screen.findAllByLabelText("Copy"))[0]);
    await waitFor(() => expect(h.toastError).toContain("Nie udało się skopiować"));
  });

  it("analityka rozbija leady po etapie i paśmie score", async () => {
    h.company = {
      company: company(),
      profiles: [],
      leads: [
        { id: "l1", email: "a@example.test", first_name: "A", last_name: null, stage: "new", score: 10, score_band: "cold", tags: [], last_activity_at: null, created_at: "2026-08-01T10:00:00.000Z" },
        { id: "l2", email: "b@example.test", first_name: "B", last_name: null, stage: "new", score: 80, score_band: "hot", tags: [], last_activity_at: null, created_at: "2026-08-01T10:00:00.000Z" },
        { id: "l3", email: "c@example.test", first_name: "C", last_name: null, stage: "won", score: 50, score_band: "hot", tags: [], last_activity_at: null, created_at: "2026-08-01T10:00:00.000Z" },
      ],
    };
    await mountCard("?tab=analytics");
    expect(await screen.findByText("new")).toBeInTheDocument();
    expect(screen.getByText("won")).toBeInTheDocument();
    expect(screen.getByText("hot")).toBeInTheDocument();
    expect(screen.getByText("cold")).toBeInTheDocument();
  });

  it("firma bez leadów nie udaje wykresów", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard("?tab=analytics");
    expect((await screen.findAllByText(/Brak/)).length).toBeGreaterThan(0);
  });

  it("feed aktywności rozróżnia notatkę, nowego leada i inne zdarzenie", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    h.activity = [
      { id: "a1", kind: "note", action: "crm.company.note", created_at: "2026-08-06T10:00:00.000Z", actor_id: "u1", lead_id: null, lead_label: null, body: "Notatka wewnętrzna" },
      { id: "a2", kind: "lead_created", action: "crm.lead.created", created_at: "2026-08-05T10:00:00.000Z", actor_id: null, lead_id: "l1", lead_label: "Anna Kowalska", body: null },
      { id: "a3", kind: "other", action: "crm.company.updated", created_at: "2026-08-04T10:00:00.000Z", actor_id: "u1", lead_id: null, lead_label: null, body: null },
    ];
    await mountCard("?tab=activity");
    expect(await screen.findByText("Notatka")).toBeInTheDocument();
    expect(screen.getByText("Nowy lead · Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("crm.company.updated")).toBeInTheDocument();
  });

  it("członkostwo B2B pokazuje organizację z warstwą i miejscami", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    h.memberOrgs = [
      { id: "org-1", name: "Acme Group", tier_key: "pro", status: "active", seats_limit: 25, expires_at: null },
    ];
    h.tiers = [{ key: "pro", rank: 30, name_pl: "Pro", name_en: "Pro", is_default: false, active: true }];
    await mountCard();
    expect(await screen.findByText("Acme Group")).toBeInTheDocument();
    expect(screen.getByText(/miejsca/)).toBeInTheDocument();
  });

  it("brak organizacji członkowskiej jest powiedziany wprost", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    expect(
      await screen.findByText("Firma nie ma organizacji członkowskiej."),
    ).toBeInTheDocument();
  });

  it("szybka akcja „Dodaj kontakt” prowadzi na listę z identyfikatorem firmy", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    const view = await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: /Dodaj kontakt/ }));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/companies"));
  });

  it("klik w powiązanego leada prowadzi do skrzynki CRM", async () => {
    h.company = {
      company: company(),
      profiles: [],
      leads: [
        { id: LEAD_ID, email: "anna@example.test", first_name: "Anna", last_name: "Kowalska", stage: "new", score: 40, score_band: "warm", tags: [], last_activity_at: null, created_at: "2026-08-01T10:00:00.000Z" },
      ],
    };
    const view = await mountCard();
    fireEvent.click(await screen.findByText("anna@example.test"));
    await waitFor(() => expect(view.currentPath()).toBe("/admin/crm"));
  });

  it("„Zobacz wszystko” przełącza na pełny feed aktywności", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    const view = await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: /Zobacz wszystko/ }));
    await waitFor(() => expect(view.search()).toMatchObject({ tab: "activity" }));
  });

  it("wgranie logo trafia do magazynu i zapisuje publiczny adres", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    const input = await fileInput();
    fireEvent.change(input, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(h.uploaded).toHaveLength(1));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: { logo_url: string } }).data.logo_url).toContain(
      "https://cdn.test/",
    );
  });

  it("plik, który nie jest obrazem, nie idzie do magazynu", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    const input = await fileInput();
    fireEvent.change(input, {
      target: { files: [new File(["x"], "dane.csv", { type: "text/csv" })] },
    });
    await waitFor(() => expect(h.toastError).toContain("Nieprawidłowy plik"));
    expect(h.uploaded).toHaveLength(0);
  });

  it("odrzucone wgranie logo pokazuje komunikat magazynu", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    h.uploadFails = true;
    await mountCard();
    const input = await fileInput();
    fireEvent.change(input, {
      target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(h.toastError).toContain("upload odrzucony"));
  });

  it("usunięcie logo zapisuje pustą wartość", async () => {
    h.company = { company: company({ logo_url: "https://cdn.test/logo.png" }), profiles: [], leads: [] };
    await mountCard();
    fireEvent.click(await screen.findByLabelText("Usuń logo"));
    await waitFor(() => expect(h.updated).toHaveLength(1));
    expect((h.updated[0] as { data: { logo_url: string | null } }).data.logo_url).toBeNull();
  });

  it("błąd odczytu w komponencie kończy się komunikatem, nie białym ekranem", async () => {
    h.companyThrows = true;
    await mountCard();
    expect(await screen.findByText("Firma nieznaleziona.")).toBeInTheDocument();
  });

  it("trasa ma własne ekrany błędu i braku firmy", () => {
    // To są opcje TRASY (błąd/404 loadera), więc nie da się ich wywołać
    // zapytaniem w komponencie - renderujemy je wprost.
    const opts = CompanyRoute.options as {
      errorComponent: (p: { error: Error }) => JSX.Element;
      notFoundComponent: () => JSX.Element;
    };
    const { container } = render(opts.errorComponent({ error: new Error("padło") }));
    expect(container.textContent).toContain("padło");
    cleanup();
    const nf = render(opts.notFoundComponent());
    expect(nf.container.textContent).toContain("Nie znaleziono firmy.");
  });

  it("odrzucona notatka nie znika po cichu", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    h.noteFails = true;
    await mountCard("?tab=activity");
    fireEvent.change(await screen.findByPlaceholderText(/Krótka notatka wewnętrzna/), {
      target: { value: "Notatka" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz notatkę" }));
    await waitFor(() => expect(h.toastError).toContain("notatka odrzucona"));
  });

  it("puste pole kartoteki w ogóle nie oferuje kopiowania", async () => {
    h.company = { company: company({ domain: null, phone: null }), profiles: [], leads: [] };
    await mountCard();
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    // Bez wartości nie ma czego kopiować - przycisk się nie renderuje.
    expect(screen.queryAllByLabelText("Copy")).toHaveLength(0);
  });

  it("kopiowanie telefonu bierze numer, nie etykietę", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    const copies = await screen.findAllByLabelText("Copy");
    fireEvent.click(copies[copies.length - 1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("+48 500 100 200"));
  });

  it("zakładki karty przełączają się klikiem i wracają na przegląd", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    const view = await mountCard();
    fireEvent.click(await screen.findByRole("button", { name: /Analityka/ }));
    await waitFor(() => expect(view.search()).toMatchObject({ tab: "analytics" }));
    fireEvent.click(screen.getByRole("button", { name: /Aktywność/ }));
    await waitFor(() => expect(view.search()).toMatchObject({ tab: "activity" }));
    fireEvent.click(screen.getByRole("button", { name: /Przegląd/ }));
    await waitFor(() => expect(view.search().tab).toBeUndefined());
  });

  it("niedziałające logo z domeny spada do inicjałów firmy", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    await screen.findByLabelText("Zmień logo");
    const img = document.querySelector("img[src*='favicons']") as HTMLImageElement;
    fireEvent.error(img);
    expect(await screen.findByText("AC")).toBeInTheDocument();
  });

  it("przycisk aparatu otwiera wybór pliku", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    const input = await fileInput();
    const click = vi.fn();
    input.click = click;
    fireEvent.click(screen.getByLabelText("Zmień logo"));
    expect(click).toHaveBeenCalled();
  });

  it("logo powyżej 2 MB nie idzie do magazynu", async () => {
    h.company = { company: company(), profiles: [], leads: [] };
    await mountCard();
    const input = await fileInput();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => expect(h.toastError).toContain("Max 2 MB"));
    expect(h.uploaded).toHaveLength(0);
  });
});
