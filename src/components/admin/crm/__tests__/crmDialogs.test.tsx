// Dialogi i panele administracyjne CRM: nowa firma, import CSV, ustawienia
// scoringu, partnerzy CRM.
//
// Wszystkie cztery wykonują ZAPIS - test sprawdza, co dokładnie idzie na serwer
// (a nie że dialog się otworzył) oraz jak panel zachowuje się przy odmowie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  created: [] as unknown[],
  createError: null as Error | null,
  imported: [] as unknown[],
  importSummary: { imported: 2, merged: 1, skipped: 0, errors: [] as unknown[] },
  scoringSettings: null as unknown,
  savedScoring: [] as unknown[],
  recomputeBatches: [] as unknown[],
  toastError: [] as string[],
  toastSuccess: [] as string[],
  endpoints: [] as unknown[],
  deliveries: [] as unknown[],
}));

vi.mock("@/lib/crm-companies.functions", () => ({
  createCrmCompany: async (input: unknown) => {
    if (h.createError) throw h.createError;
    h.created.push(input);
    return { ok: true, id: "company-1" };
  },
}));
vi.mock("@/lib/crm-tasks.functions", () => ({
  CRM_IMPORT_CHUNK_SIZE: 500,
  importCrmLeads: async (input: unknown) => {
    h.imported.push(input);
    return h.importSummary;
  },
}));
vi.mock("@/lib/crm.functions", () => ({
  getCrmScoringSettings: async () => ({ json: JSON.stringify(h.scoringSettings) }),
  upsertCrmScoringSettings: async (input: unknown) => {
    h.savedScoring.push(input);
    return { ok: true };
  },
  recomputeAllLeadScores: async (input: unknown) => {
    h.recomputeBatches.push(input);
    return { processed: 7, lastId: null, done: true };
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
    warning: (m: string) => h.toastError.push(m),
  },
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = (rows: () => unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit"]) {
      chain[method] = () => chain;
    }
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(onFulfilled);
    return chain;
  };
  return {
    supabase: {
      from: (name: string) =>
        table(() => (name === "integration_endpoints" ? h.endpoints : h.deliveries)),
    },
  };
});
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  dispatchIntegrationDeliveries: async () => ({ delivered: 1, failed: 0 }),
}));

import { NewCompanyDialog } from "../NewCompanyDialog";
import { ImportLeadsCsvDialog } from "../ImportLeadsCsvDialog";
import { ScoringSettingsDialog } from "../ScoringSettingsDialog";
import { CrmPartnerEndpointsPanel } from "../CrmPartnerEndpointsPanel";

const STAGE_LABELS = {
  new: "Nowy",
  contacted: "Kontakt",
  qualified: "Zakwalifikowany",
  proposal: "Oferta",
  won: "Wygrany",
  lost: "Przegrany",
  archived: "Archiwum",
};

beforeEach(() => {
  h.created = [];
  h.createError = null;
  h.imported = [];
  h.importSummary = { imported: 2, merged: 1, skipped: 0, errors: [] };
  h.scoringSettings = null;
  h.savedScoring = [];
  h.recomputeBatches = [];
  h.toastError = [];
  h.toastSuccess = [];
  h.endpoints = [];
  h.deliveries = [];
});

describe("NewCompanyDialog", () => {
  const openDialog = (onCreated?: (id: string) => void) => {
    renderWithQueryClient(<NewCompanyDialog lang="pl" onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: /Nowa firma/ }));
  };

  it("bez nazwy przycisk zapisu jest nieaktywny", () => {
    openDialog();
    expect(screen.getByRole("button", { name: /Utwórz firmę/ })).toBeDisabled();
  });

  it("wysyła przycięte pola i POMIJA puste", async () => {
    const onCreated = vi.fn();
    openDialog(onCreated);
    fireEvent.change(screen.getByLabelText(/Nazwa/), { target: { value: "  Acme  " } });
    fireEvent.change(screen.getByLabelText(/Miasto/), { target: { value: " Bruksela " } });
    fireEvent.click(screen.getByRole("button", { name: /Utwórz firmę/ }));

    await waitFor(() => expect(h.created).toHaveLength(1));
    expect((h.created[0] as { data: Record<string, unknown> }).data).toEqual({
      name: "Acme",
      city: "Bruksela",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("company-1"));
  });

  it("duplikat nazwy ma własny komunikat", async () => {
    h.createError = new Error("duplicate_name");
    openDialog();
    fireEvent.change(screen.getByLabelText(/Nazwa/), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /Utwórz firmę/ }));
    await waitFor(() => expect(h.toastError.some((m) => m.includes("już istnieje"))).toBe(true));
  });

  it("inny błąd pokazuje komunikat ogólny", async () => {
    h.createError = new Error("permission denied");
    openDialog();
    fireEvent.change(screen.getByLabelText(/Nazwa/), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /Utwórz firmę/ }));
    await waitFor(() =>
      expect(h.toastError.some((m) => m.includes("Nie udało się utworzyć"))).toBe(true),
    );
  });
});

describe("ImportLeadsCsvDialog", () => {
  function csvFile(content: string): File {
    const file = new File([content], "leady.csv", { type: "text/csv" });
    // happy-dom nie implementuje File.text() dla wszystkich wersji - domykamy.
    Object.defineProperty(file, "text", { value: async () => content });
    return file;
  }

  async function uploadCsv(content: string) {
    renderWithQueryClient(<ImportLeadsCsvDialog open onOpenChange={() => {}} lang="pl" />);
    // Dialog renderuje się w portalu, więc szukamy w całym dokumencie.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [csvFile(content)] });
    fireEvent.change(input);
    return input;
  }

  it("po wgraniu pliku pokazuje liczbę wierszy i mapuje kolumny automatycznie", async () => {
    await uploadCsv("E-mail,Imię,Nazwisko\nanna@example.test,Anna,Kowalska\n");
    expect(await screen.findByText(/1 wierszy, 1 z poprawnym e-mailem/)).toBeInTheDocument();
    expect(screen.getByText("anna@example.test")).toBeInTheDocument();
  });

  it("liczy duplikaty w pliku i importuje pierwszy wiersz", async () => {
    await uploadCsv(
      "E-mail,Imię\nanna@example.test,Anna\nANNA@example.test,Anna druga\nbartek@example.test,Bartek\n",
    );
    expect(await screen.findByText(/1 duplikatów w pliku/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Importuj 2/ }));
    await waitFor(() => expect(h.imported).toHaveLength(1));
    const payload = (h.imported[0] as { data: { rows: Array<{ email: string }> } }).data;
    expect(payload.rows.map((r) => r.email)).toEqual(["anna@example.test", "bartek@example.test"]);
  });

  it("plik bez kolumny e-mail nie pozwala importować", async () => {
    await uploadCsv("Imię,Nazwisko\nAnna,Kowalska\n");
    expect(await screen.findByText(/Wskaż kolumnę z adresem e-mail/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Importuj 0/ })).toBeDisabled();
  });

  it("kolumna zgody nie trafia do importu (zgody nie da się wgrać plikiem)", async () => {
    await uploadCsv("E-mail,Zgoda marketingowa\nanna@example.test,tak\n");
    fireEvent.click(await screen.findByRole("button", { name: /Importuj 1/ }));
    await waitFor(() => expect(h.imported).toHaveLength(1));
    const rows = (h.imported[0] as { data: { rows: Array<Record<string, unknown>> } }).data.rows;
    expect(Object.keys(rows[0])).toEqual(["email"]);
  });

  it("podsumowanie importu ląduje w powiadomieniu", async () => {
    await uploadCsv("E-mail\nanna@example.test\n");
    fireEvent.click(await screen.findByRole("button", { name: /Importuj 1/ }));
    await waitFor(() => expect(h.toastSuccess.some((m) => m.includes("Nowe: 2"))).toBe(true));
  });
});

describe("ScoringSettingsDialog", () => {
  it("otwarcie wczytuje ustawienia tenanta i pokazuje progi", async () => {
    h.scoringSettings = {
      enabled: true,
      half_life_days: 45,
      horizon_days: 200,
      hot_threshold: 90,
      warm_threshold: 60,
      cool_threshold: 30,
      weights: {},
    };
    renderWithQueryClient(<ScoringSettingsDialog lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Scoring/ }));
    await screen.findByText("Progi pasm (punkty)");
    // Czekamy na wartość, której NIE MA w domyślnych ustawieniach - inaczej test
    // przechodziłby na domyślnym formularzu, zanim odpowiedź z bazy dojdzie.
    const values = await waitFor(() => {
      const numbers = screen.getAllByRole("spinbutton").map((el) => (el as HTMLInputElement).value);
      expect(numbers).toContain("200");
      return numbers;
    });
    expect(values).toEqual(expect.arrayContaining(["45", "200", "90", "60", "30"]));
  });

  it("zapis wysyła komplet ustawień", async () => {
    renderWithQueryClient(<ScoringSettingsDialog lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Scoring/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedScoring).toHaveLength(1));
    const payload = (h.savedScoring[0] as { data: Record<string, unknown> }).data;
    expect(payload).toMatchObject({ enabled: expect.any(Boolean), weights: expect.any(Object) });
  });

  it("progi, które nie maleją, nie idą na serwer", async () => {
    h.scoringSettings = {
      enabled: true,
      half_life_days: 30,
      horizon_days: 200,
      hot_threshold: 80,
      warm_threshold: 45,
      cool_threshold: 20,
      weights: {},
    };
    renderWithQueryClient(<ScoringSettingsDialog lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Scoring/ }));
    // Najpierw czekamy, aż formularz przyjmie ustawienia z bazy - inaczej efekt
    // wczytania nadpisałby zmianę wpisaną przez test.
    await waitFor(() =>
      expect(
        screen.getAllByRole("spinbutton").map((el) => (el as HTMLInputElement).value),
      ).toContain("200"),
    );
    const hotLabel = await screen.findByText("Gorący od");
    const hot = hotLabel.parentElement?.querySelector("input") as HTMLInputElement;
    fireEvent.change(hot, { target: { value: "1" } });

    // Formularz od razu pokazuje, że progi się nie zgadzają...
    expect(await screen.findByText(/Progi muszą maleć/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    // ...a zapis nie idzie na serwer (CHECK w bazie odrzuciłby go i tak).
    await waitFor(() => expect(h.savedScoring).toHaveLength(0));
  });

  it("przeliczenie wszystkich leadów raportuje liczbę", async () => {
    renderWithQueryClient(<ScoringSettingsDialog lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Scoring/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Przelicz wszystkie leady/ }));
    await waitFor(() => expect(h.toastSuccess.some((m) => m.includes("Przeliczono 7"))).toBe(true));
  });
});

describe("CrmPartnerEndpointsPanel", () => {
  it("pusta lista partnerów nie udaje konfiguracji", async () => {
    renderWithQueryClient(<CrmPartnerEndpointsPanel lang="pl" stageLabels={STAGE_LABELS} />);
    expect(await screen.findByText("Partnerzy CRM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nowy partner/ })).toBeInTheDocument();
  });

  it("pokazuje partnera, jego etapy i stan sekretu", async () => {
    h.endpoints = [
      {
        id: "ep-1",
        name: "Partner A",
        url: "https://partner.example.test/hook",
        enabled: true,
        secret_id: "vault-1",
        created_at: "2026-08-01T10:00:00.000Z",
        updated_at: "2026-08-02T10:00:00.000Z",
        crm_webhook_endpoints: {
          auth_kind: "bearer",
          forward_stages: ["qualified", "won"],
          consent_mapping: null,
          workspace_id: null,
        },
      },
    ];
    renderWithQueryClient(<CrmPartnerEndpointsPanel lang="pl" stageLabels={STAGE_LABELS} />);
    expect(await screen.findByText("Partner A")).toBeInTheDocument();
    expect(screen.getByText("sekret ustawiony")).toBeInTheDocument();
    expect(screen.getByText(/Zakwalifikowany/)).toBeInTheDocument();
  });

  it("formularz nowego partnera otwiera się z pustymi polami", async () => {
    renderWithQueryClient(<CrmPartnerEndpointsPanel lang="pl" stageLabels={STAGE_LABELS} />);
    fireEvent.click(await screen.findByRole("button", { name: /Nowy partner/ }));
    const url = await screen.findByPlaceholderText(/https:\/\//);
    expect(url).toHaveValue("");
  });
});

describe("ScoringSettingsDialog - wagi i przełączniki", () => {
  async function openSettings() {
    h.scoringSettings = {
      enabled: true,
      half_life_days: 30,
      horizon_days: 200,
      hot_threshold: 80,
      warm_threshold: 45,
      cool_threshold: 20,
      weights: {},
    };
    renderWithQueryClient(<ScoringSettingsDialog lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Scoring/ }));
    await screen.findByText("Wagi sygnałów");
    // Czekamy na wczytanie ustawień - efekt wczytania nadpisuje formularz,
    // więc edycja przed nim byłaby cicho cofnięta.
    await waitFor(() =>
      expect(
        screen.getAllByRole("spinbutton").map((el) => (el as HTMLInputElement).value),
      ).toContain("200"),
    );
  }

  it("zmiana wagi sygnału trafia do zapisu jako nadpisanie", async () => {
    await openSettings();
    // Pola wag stoją za progami i parametrami wygasania - bierzemy pierwsze
    // pole wagi po nagłówku tabeli.
    const inputs = screen.getAllByRole("spinbutton");
    const weightInput = inputs[5];
    fireEvent.change(weightInput, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => expect(h.savedScoring).toHaveLength(1));
    const payload = (h.savedScoring[0] as { data: { weights: Record<string, unknown> } }).data;
    // Zapisujemy TYLKO realne nadpisania - reszta wag zostaje domyślna w bazie.
    expect(Object.keys(payload.weights).length).toBeGreaterThan(0);
  });

  it("wyłączenie scoringu zapisuje się jako enabled:false", async () => {
    await openSettings();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedScoring).toHaveLength(1));
    expect((h.savedScoring[0] as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });

  it("zmiana półokresu wygasania trafia do zapisu", async () => {
    await openSettings();
    const halfLife = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(halfLife, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));
    await waitFor(() => expect(h.savedScoring).toHaveLength(1));
    expect((h.savedScoring[0] as { data: { half_life_days: number } }).data.half_life_days).toBe(
      60,
    );
  });
});

describe("ImportLeadsCsvDialog - pozostałe ścieżki", () => {
  function csvFile(content: string): File {
    const file = new File([content], "leady.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => content });
    return file;
  }

  async function uploadCsv(content: string) {
    renderWithQueryClient(<ImportLeadsCsvDialog open onOpenChange={() => {}} lang="pl" />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [csvFile(content)] });
    fireEvent.change(input);
  }

  it("ręczna zmiana mapowania kolumny zmienia wynik importu", async () => {
    await uploadCsv("E-mail,Nieznana\nanna@example.test,Acme\n");
    await screen.findByText(/1 wierszy/);

    // Druga kolumna jest niezmapowana - wskazujemy ją ręcznie jako firmę.
    const triggers = screen.getAllByRole("combobox");
    fireEvent.keyDown(triggers[1], { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Firma" }));

    fireEvent.click(screen.getByRole("button", { name: /Importuj 1/ }));
    await waitFor(() => expect(h.imported).toHaveLength(1));
    const rows = (h.imported[0] as { data: { rows: Array<Record<string, unknown>> } }).data.rows;
    expect(rows[0]).toEqual({ email: "anna@example.test", company: "Acme" });
  });

  it("„Zmień plik” wraca do wyboru pliku", async () => {
    await uploadCsv("E-mail\nanna@example.test\n");
    fireEvent.click(await screen.findByRole("button", { name: "Zmień plik" }));
    await waitFor(() => expect(screen.queryByText("Mapowanie kolumn")).toBeNull());
    expect(screen.getByText(/Kliknij, aby wybrać plik/)).toBeInTheDocument();
  });

  it("błędy zwrócone przez bazę są zgłaszane osobnym powiadomieniem", async () => {
    h.importSummary = {
      imported: 1,
      merged: 0,
      skipped: 1,
      errors: [{ email: "zly@example.test", reason: "invalid_email" }],
    };
    await uploadCsv("E-mail\nanna@example.test\n");
    fireEvent.click(await screen.findByRole("button", { name: /Importuj 1/ }));
    await waitFor(() => expect(h.toastError.some((m) => m.includes("Błędy: 1"))).toBe(true));
  });
});
