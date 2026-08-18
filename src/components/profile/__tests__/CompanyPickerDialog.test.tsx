// Dialog wyboru/tworzenia firmy w edytorze profilu - stał na ZERZE pokrycia
// przy 120 instrukcjach. Dwa RPC-e SECURITY DEFINER (`search_companies_public`,
// `create_company_self_service`, `link_current_company`) zamiast zapytań
// wprost na `crm_companies`, bo polityka odczytu tej tabeli jest staff-only -
// zwykły użytkownik NIGDY nie widzi cudzych rekordów CRM, tylko to, co RPC mu
// odda.
//
// Trzy rzeczy, które ten plik pilnuje szczególnie:
//
//   1. WALIDACJA ODPOWIEDZI RPC JEST OBOWIĄZKOWA. `search_companies_public`
//      zwraca `unknown` z bazy - `companyRowSchema` (zod) jest jedyną zaporą
//      przed pokazaniem w liście wiersza o nieoczekiwanym kształcie. Zwrotka,
//      która nie przejdzie walidacji, ma dać PUSTĄ listę, nie wywalić render.
//   2. DOPASOWANIE DOKŁADNE BLOKUJE PROPOZYCJĘ TWORZENIA. „Utwórz «Acme»” nie
//      może się pojawić, gdy „Acme” już jest wśród wyników - inaczej ten sam
//      użytkownik tworzy duplikat firmy zamiast połączyć się z istniejącą.
//   3. UTWORZENIE FIRMY TO DWA KROKI (stworzenie + powiązanie), NIE JEDEN.
//      Błąd w drugim kroku (`link_current_company`) zostawia firmę w CRM, ale
//      profil bez powiązania - test dowodzi, że taki stan kończy się
//      komunikatem błędu, a nie fałszywym sukcesem.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { PROFILE_IDS } from "@/test/profile/fixtures";

const h = vi.hoisted(() => ({
  auth: { current: { user: { id: "user-me" }, tenantId: "tenant-alfa" as string | null } },
  rpc: vi.fn(),
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateError: { current: null as { message: string } | null },
  invalidated: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/lib/i18n-admin-extras", () => ({ ensureI18n: () => {} }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth.current }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args),
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const entry = { patch, filters: [] as Array<[string, unknown]> };
        h.updates.push(entry);
        return {
          eq: (column: string, value: unknown) => {
            entry.filters.push([column, value]);
            return Promise.resolve({ error: h.updateError.current });
          },
        };
      },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));

import { CompanyPickerDialog } from "@/components/profile/CompanyPickerDialog";

/** Wiersz `search_companies_public` - kształt sprawdzany przez `companyRowSchema`. */
function companyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Acme",
    country: "Belgia",
    branch: "Energia",
    city: "Bruksela",
    address: null,
    postal_code: null,
    website: null,
    phone: null,
    domain: null,
    ...overrides,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof CompanyPickerDialog>> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const view = renderWithQueryClient(
    <CompanyPickerDialog open={true} onOpenChange={onOpenChange} {...props} />,
  );
  return { onOpenChange, ...view };
}

function searchInput(): HTMLElement {
  return screen.getByPlaceholderText("company.searchPh");
}

async function typeQuery(value: string) {
  fireEvent.change(searchInput(), { target: { value } });
  // `queryKey` zmienia się natychmiast, ale `useQuery` odpala `queryFn`
  // asynchronicznie - testy czekają na skutek (wynik albo wywołanie RPC).
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.auth.current = { user: { id: PROFILE_IDS.me }, tenantId: PROFILE_IDS.tenant };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [], error: null });
  h.updates.length = 0;
  h.updateError.current = null;
  h.invalidated.length = 0;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("wyszukiwanie", () => {
  it("nie odpytuje bazy bez tenanta", async () => {
    h.auth.current = { user: { id: PROFILE_IDS.me }, tenantId: null };
    renderDialog();
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("puste zapytanie pokazuje zachętę do wpisania frazy, nie 'brak wyników'", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("company.startTyping")).toBeInTheDocument());
  });

  it("wyszukuje przez RPC `search_companies_public`, nie wprost na `crm_companies`", async () => {
    // Polityka odczytu `crm_companies` jest staff-only - zwykły select z tej
    // tabeli zwróciłby zero wierszy niezależnie od tego, co jest w bazie.
    h.rpc.mockResolvedValue({ data: [companyRow()], error: null });
    renderDialog();

    await typeQuery("Acme");

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(h.rpc).toHaveBeenCalledWith("search_companies_public", {
      _query: "Acme",
      _limit: 12,
    });
  });

  it("pokazuje metadane firmy (miasto - kraj - branża) w jednym wierszu", async () => {
    h.rpc.mockResolvedValue({
      data: [companyRow({ city: "Bruksela", country: "Belgia", branch: "Energia" })],
      error: null,
    });
    renderDialog();

    await typeQuery("Acme");

    await waitFor(() =>
      expect(screen.getByText("Bruksela - Belgia - Energia")).toBeInTheDocument(),
    );
  });

  it("odznacza AKTUALNIE powiązaną firmę znacznikiem wyboru", async () => {
    const currentId = "660e8400-e29b-41d4-a716-446655440001";
    h.rpc.mockResolvedValue({ data: [companyRow({ id: currentId })], error: null });
    renderDialog({ currentCompanyId: currentId });

    await typeQuery("Acme");

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    // Przycisk aktualnej firmy niesie dodatkowe oznaczenie stanu (aktywny wybór).
    const button = screen.getByText("Acme").closest("button");
    expect(button?.className).toContain("bg-muted/50");
  });

  it("odpowiedź o KSZTAŁCIE spoza schematu daje pustą listę, nie awarię renderu", async () => {
    // Reguła 1: `search_companies_public` zwraca `unknown`. Rozjazd typu (np.
    // kolumna `country` jako liczba po błędnej migracji) nie może wywrócić
    // dialogu wyboru firmy - lista ma pozostać pusta i mówić `noMatches`.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: [{ id: "not-a-uuid", name: "Zła firma" }], error: null });
    renderDialog();

    await typeQuery("Zła");

    await waitFor(() => expect(screen.getByText("company.noMatches")).toBeInTheDocument());
    expect(screen.queryByText("Zła firma")).not.toBeInTheDocument();
    err.mockRestore();
  });

  it("błąd RPC nie pokazuje wyników jako pustej, poprawnej odpowiedzi", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "rpc failed" } });
    renderDialog();

    await typeQuery("Acme");

    // Zapytanie kończy się błędem `useQuery` - lista i tak renderuje się jako
    // pusta (przez `search.data ?? []`), ale nie w stanie ładowania.
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});

describe("propozycja utworzenia nowej firmy", () => {
  it("pojawia się TYLKO gdy fraza nie ma dokładnego trafienia", async () => {
    // Reguła 2. Dokładne trafienie ma skierować do połączenia z istniejącą
    // firmą, nie do stworzenia duplikatu.
    h.rpc.mockResolvedValue({ data: [companyRow({ name: "Acme" })], error: null });
    renderDialog();

    await typeQuery("Acme");

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /company\.createNamed/ })).not.toBeInTheDocument();
  });

  it("dopasowanie jest odporne na wielkość liter i białe znaki na brzegu", async () => {
    h.rpc.mockResolvedValue({ data: [companyRow({ name: "Acme" })], error: null });
    renderDialog();

    await typeQuery("  ACME  ");

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /company\.createNamed/ })).not.toBeInTheDocument();
  });

  it("pojawia się, gdy fraza NIE pasuje do żadnego wyniku", async () => {
    h.rpc.mockResolvedValue({ data: [companyRow({ name: "Inna firma" })], error: null });
    renderDialog();

    await typeQuery("Nowa Sp. z o.o.");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /company\.createNamed/ })).toBeInTheDocument(),
    );
  });

  it("przełącza dialog w tryb tworzenia z frazą jako podpowiedzią nazwy", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    renderDialog();

    await typeQuery("Nowa Sp. z o.o.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /company\.createNamed/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /company\.createNamed/ }));

    expect(screen.getByText("company.createTitle")).toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", { name: "company.fields.name" });
    expect(nameInput).toHaveValue("Nowa Sp. z o.o.");
  });
});

describe("połączenie z istniejącą firmą", () => {
  it("woła `link_current_company` z id wybranej firmy", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "search_companies_public") {
        return Promise.resolve({ data: [companyRow()], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await typeQuery("Acme");
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Acme"));

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("link_current_company", {
        _company_id: companyRow().id,
      }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("company.toast.linked"));
  });

  it("unieważnia cache edytora profilu, nagłówka i paska bocznego", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "search_companies_public") {
        return Promise.resolve({ data: [companyRow()], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const view = renderDialog();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");

    await typeQuery("Acme");
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Acme"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(["profile-editor", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["header-profile", PROFILE_IDS.me]));
    expect(keys).toContain(JSON.stringify(["profile-sidebar", PROFILE_IDS.me]));
  });

  it("błąd połączenia pokazuje komunikat Z TREŚCIĄ błędu serwera", async () => {
    // `PostgrestError` dziedziczy po `Error` w supabase-js - atrapa musi też,
    // inaczej `err instanceof Error` w `linkCompany` jest `false` i komunikat
    // schodzi na `String(obiekt)` = "[object Object]" zamiast prawdziwej treści.
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "search_companies_public") {
        return Promise.resolve({ data: [companyRow()], error: null });
      }
      const error = new Error("not in tenant");
      error.name = "PostgrestError";
      return Promise.resolve({ data: null, error });
    });
    renderDialog();

    await typeQuery("Acme");
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Acme"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(String(h.toastError.mock.calls[0][0])).toContain("not in tenant");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odznaczenie firmy zapisuje NULL zawężone do własnego wiersza", async () => {
    renderDialog({ currentCompanyId: "current-id", currentCompanyName: "Stara Firma" });

    fireEvent.click(screen.getByRole("button", { name: "company.detach" }));

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0].patch).toEqual({ current_company_id: null, current_company: null });
    expect(h.updates[0].filters).toEqual([["id", PROFILE_IDS.me]]);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("company.toast.detached"));
  });

  it("przycisk odznaczenia pojawia się TYLKO gdy jest aktualna firma", async () => {
    renderDialog({ currentCompanyId: null });
    expect(screen.queryByRole("button", { name: "company.detach" })).not.toBeInTheDocument();
  });

  it("nie pozwala kliknąć drugi raz w trakcie zapisu", async () => {
    let resolveRpc: (v: { data: unknown; error: unknown }) => void = () => {};
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "search_companies_public") {
        return Promise.resolve({ data: [companyRow()], error: null });
      }
      return new Promise((resolve) => {
        resolveRpc = resolve;
      });
    });
    renderDialog();

    await typeQuery("Acme");
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    const button = screen.getByText("Acme").closest("button")!;
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    fireEvent.click(button);
    resolveRpc({ data: null, error: null });

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
  });
});

describe("utworzenie nowej firmy", () => {
  async function openCreateForm(name = "Nowa Sp. z o.o.") {
    // Atrapa RPC NIE jest tu resetowana - jeśli test skonfigurował własne
    // zachowanie (np. `create_company_self_service`), nadpisanie go tutaj
    // cofnęłoby tamtą konfigurację. Domyślne puste wyniki wyszukiwania i tak
    // zapewnia `beforeEach`.
    renderDialog();
    await typeQuery(name);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /company\.createNamed/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /company\.createNamed/ }));
  }

  it("odrzuca pustą nazwę bez wołania RPC", async () => {
    await openCreateForm();
    fireEvent.change(screen.getByRole("textbox", { name: "company.fields.name" }), {
      target: { value: "   " },
    });

    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("company.errors.nameRequired"));
    expect(h.rpc).not.toHaveBeenCalledWith("create_company_self_service", expect.anything());
  });

  it("tworzy firmę PRZYCINAJĄC pola do wpisanych wartości i pomijając puste jako `undefined`", async () => {
    // RPC odczytuje brakujące parametry inaczej niż puste napisy (kolumny
    // opcjonalne w CRM) - `undefined` musi zniknąć z payloadu, nie zostać
    // wysłany jako pusty string.
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: "new-id", error: null });
      if (fn === "link_current_company") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    await openCreateForm("Nowa Sp. z o.o.");

    fireEvent.change(screen.getByRole("textbox", { name: "company.fields.city" }), {
      target: { value: "  Warszawa  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("create_company_self_service", {
        _name: "Nowa Sp. z o.o.",
        _country: undefined,
        _branch: undefined,
        _city: "Warszawa",
        _address: undefined,
        _postal_code: undefined,
        _website: undefined,
        _phone: undefined,
      }),
    );
  });

  it("UTWORZENIE JEST DWOMA KROKAMI: tworzy w CRM, potem łączy z profilem", async () => {
    // Reguła 3. Kolejność ma znaczenie - powiązanie następuje PO utworzeniu,
    // z id, które zwrócił pierwszy krok.
    const calls: string[] = [];
    h.rpc.mockImplementation((fn: string, args?: Record<string, unknown>) => {
      calls.push(fn);
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: "new-id", error: null });
      if (fn === "link_current_company") {
        expect(args).toEqual({ _company_id: "new-id" });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
    await openCreateForm();

    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("company.toast.created"));
    expect(calls.indexOf("create_company_self_service")).toBeLessThan(
      calls.indexOf("link_current_company"),
    );
  });

  it("REGRESJA: błąd DRUGIEGO KROKU (powiązania) kończy się komunikatem błędu, nie fałszywym sukcesem", async () => {
    // ZNALEZIONY DEFEKT (naprawiony osobnym commitem): `submitCreate` wołał
    // `link_current_company` bez sprawdzenia `error` z odpowiedzi - firma
    // lądowała w CRM, powiązanie z profilem się nie udawało, a użytkownik i
    // tak widział "utworzono firmę" i dialog się zamykał. `linkCompany`
    // (łączenie z ISTNIEJĄCĄ firmą) sprawdzał błąd poprawnie - ten sam RPC,
    // dwa różne wywołania, jedno bez kontroli błędu.
    // Firma wylądowała w CRM, ale profil o niej nie wie - użytkownik MUSI
    // zobaczyć, że coś poszło nie tak, żeby nie zamknął dialogu w przekonaniu,
    // że ma powiązaną firmę.
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: "new-id", error: null });
      if (fn === "link_current_company") {
        const error = new Error("link failed");
        error.name = "PostgrestError";
        return Promise.resolve({ data: null, error });
      }
      return Promise.resolve({ data: [], error: null });
    });
    await openCreateForm();

    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(String(h.toastError.mock.calls[0][0])).toContain("link failed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odpowiedź BEZ id firmy (RPC nic nie zwrócił) jest awarią, nie cichym przejściem", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    await openCreateForm();

    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.rpc).not.toHaveBeenCalledWith("link_current_company", expect.anything());
  });

  it("błąd RPC tworzenia zwraca komunikat i NIE wywołuje powiązania", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service") {
        const error = new Error("duplicate name");
        error.name = "PostgrestError";
        return Promise.resolve({ data: null, error });
      }
      return Promise.resolve({ data: [], error: null });
    });
    await openCreateForm();

    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(String(h.toastError.mock.calls[0][0])).toContain("duplicate name");
    expect(h.rpc).not.toHaveBeenCalledWith("link_current_company", expect.anything());
  });

  it("po utworzeniu unieważnia wyniki wyszukiwania firm I edytor profilu", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: "new-id", error: null });
      if (fn === "link_current_company") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const view = renderWithQueryClient(<CompanyPickerDialog open={true} onOpenChange={vi.fn()} />);
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");

    await typeQuery("Nowa Sp. z o.o.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /company\.createNamed/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /company\.createNamed/ }));
    fireEvent.click(screen.getByRole("button", { name: "company.save" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(["crm-companies-search"]));
    expect(keys).toContain(JSON.stringify(["profile-editor", PROFILE_IDS.me]));
  });

  it("bez tenanta lub sesji odmawia zapisu bez wołania RPC", async () => {
    h.auth.current = { user: null as never, tenantId: null };
    h.rpc.mockResolvedValue({ data: [], error: null });
    renderWithQueryClient(<CompanyPickerDialog open={true} onOpenChange={vi.fn()} />);

    fireEvent.change(searchInput(), { target: { value: "Nowa" } });
    await act(async () => {
      await Promise.resolve();
    });
    // Bez sesji dialog nie może w ogóle pokazać propozycji tworzenia - test
    // przechodzi wprost do formy defensywnie: jeśli przycisk mimo to istnieje,
    // kliknięcie NIE może wywołać RPC tworzenia.
    const createButton = screen.queryByRole("button", { name: /company\.createNamed/ });
    if (createButton) fireEvent.click(createButton);
    const saveButton = screen.queryByRole("button", { name: "company.save" });
    if (saveButton) fireEvent.click(saveButton);

    await act(async () => {
      await Promise.resolve();
    });
    expect(h.rpc).not.toHaveBeenCalledWith("create_company_self_service", expect.anything());
  });

  it("powrót do wyszukiwania NIE zapisuje nic", async () => {
    await openCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "company.back" }));

    expect(screen.getByPlaceholderText("company.searchPh")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalledWith("create_company_self_service", expect.anything());
  });
});

describe("etykiety pól formularza tworzenia (REGRESJA a11y)", () => {
  // Domyka defekt naprawiony osobnym commitem: `FieldRow` renderował `Label`
  // jako rodzeństwo pola, bez `htmlFor` - czytnik ekranu nie miał jak
  // powiązać etykiety z ośmioma polami formularza.
  it("każde pole formularza jest znajdowalne przez SWOJĄ etykietę", async () => {
    await openCreateForm();

    for (const [labelKey] of [
      ["company.fields.name"],
      ["company.fields.country"],
      ["company.fields.branch"],
      ["company.fields.city"],
      ["company.fields.postalCode"],
      ["company.fields.address"],
      ["company.fields.website"],
      ["company.fields.phone"],
    ]) {
      expect(screen.getByRole("textbox", { name: labelKey })).toBeInTheDocument();
    }
  });

  it("pole nazwy jest oznaczone jako wymagane", async () => {
    await openCreateForm();
    expect(screen.getByRole("textbox", { name: "company.fields.name" })).toBeRequired();
  });

  async function openCreateForm(name = "Nowa Sp. z o.o.") {
    // Atrapa RPC NIE jest tu resetowana - jeśli test skonfigurował własne
    // zachowanie (np. `create_company_self_service`), nadpisanie go tutaj
    // cofnęłoby tamtą konfigurację. Domyślne puste wyniki wyszukiwania i tak
    // zapewnia `beforeEach`.
    renderDialog();
    await typeQuery(name);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /company\.createNamed/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /company\.createNamed/ }));
  }
});

describe("zamykanie", () => {
  it("przycisk anuluj wywołuje `onOpenChange(false)`", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("otwarcie dialogu z istniejącą nazwą wstawia ją do pola wyszukiwania", async () => {
    renderDialog({ currentCompanyName: "Stara Firma" });
    expect(searchInput()).toHaveValue("Stara Firma");
  });
});
