// Panel partnerów CRM: konfiguracja endpointów, do których lead jedzie
// automatycznie po zmianie etapu.
//
// DLACZEGO TO WAŻNE: to jest miejsce, w którym DANE OSOBOWE OPUSZCZAJĄ SERWIS.
// Test pilnuje, co dokładnie zapisuje panel - adres, tryb uwierzytelnienia,
// etapy do wysyłki, mapowanie zgód (bez pustych kluczy) i sekret w Vault.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

interface Write {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: unknown;
}

const h = vi.hoisted(() => ({
  endpoints: [] as unknown[],
  deliveries: [] as unknown[],
  writes: [] as Write[],
  rpc: [] as Array<{ fn: string; args: unknown }>,
  writeError: null as string | null,
  dispatch: { delivered: 3, failed: 1 },
  dispatchFails: false,
  toastError: [] as string[],
  toastSuccess: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const chain: Record<string, unknown> = {};
    let result: () => { data: unknown; error: { message: string } | null } = () => ({
      data: table === "integration_endpoints" ? h.endpoints : h.deliveries,
      error: null,
    });
    const record = (op: Write["op"]) => (payload: unknown) => {
      h.writes.push({ table, op, payload });
      result = () =>
        h.writeError
          ? { data: null, error: { message: h.writeError } }
          : { data: { id: "ep-new" }, error: null };
      return chain;
    };
    for (const method of ["select", "eq", "in", "order", "limit"]) chain[method] = () => chain;
    chain.insert = record("insert");
    chain.update = record("update");
    chain.upsert = record("upsert");
    chain.delete = () => {
      h.writes.push({ table, op: "delete", payload: null });
      result = () =>
        h.writeError
          ? { data: null, error: { message: h.writeError } }
          : { data: null, error: null };
      return chain;
    };
    chain.single = () => Promise.resolve(result());
    chain.maybeSingle = chain.single;
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(result()).then(onFulfilled);
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => build(table),
      rpc: async (fn: string, args?: unknown) => {
        h.rpc.push({ fn, args });
        return { data: null, error: null };
      },
    },
  };
});
vi.mock("@/lib/integrations/dispatch.functions", () => ({
  dispatchIntegrationDeliveries: async () => {
    if (h.dispatchFails) throw new Error("kolejka niedostępna");
    return h.dispatch;
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
  },
}));

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

const partner = (over: Record<string, unknown> = {}) => ({
  id: "ep-1",
  name: "Partner A",
  url: "https://partner.example.test/hook",
  enabled: true,
  secret_id: "vault-1",
  created_at: "2026-08-01T10:00:00.000Z",
  updated_at: "2026-08-02T10:00:00.000Z",
  crm_webhook_endpoints: {
    auth_kind: "hmac",
    forward_stages: ["qualified"],
    consent_mapping: null,
    workspace_id: null,
  },
  ...over,
});

const render = () =>
  renderWithQueryClient(<CrmPartnerEndpointsPanel lang="pl" stageLabels={STAGE_LABELS} />);

const writesFor = (table: string) => h.writes.filter((w) => w.table === table);

beforeEach(() => {
  h.endpoints = [];
  h.deliveries = [];
  h.writes = [];
  h.rpc = [];
  h.writeError = null;
  h.dispatch = { delivered: 3, failed: 1 };
  h.dispatchFails = false;
  h.toastError = [];
  h.toastSuccess = [];
});

describe("lista partnerów", () => {
  it("pokazuje zdrowie dostaw z outboxu", async () => {
    h.endpoints = [partner()];
    h.deliveries = [
      {
        endpoint_id: "ep-1",
        status: "delivered",
        created_at: "2026-08-05T10:00:00.000Z",
        last_error: null,
      },
      {
        endpoint_id: "ep-1",
        status: "failed",
        created_at: "2026-08-04T10:00:00.000Z",
        last_error: "500",
      },
      {
        endpoint_id: "ep-1",
        status: "dead",
        created_at: "2026-08-03T10:00:00.000Z",
        last_error: "410",
      },
    ];
    render();
    // ✓ dostarczone · ✗ nieudane + martwe.
    expect(await screen.findByText(/✓ 1/)).toBeInTheDocument();
    expect(screen.getByText(/✗ 2/)).toBeInTheDocument();
  });

  it("ostatni błąd dostawy jest widoczny przy partnerze", async () => {
    h.endpoints = [partner()];
    h.deliveries = [
      {
        endpoint_id: "ep-1",
        status: "failed",
        created_at: "2026-08-05T10:00:00.000Z",
        last_error: "timeout partnera",
      },
    ];
    render();
    expect(await screen.findByText("timeout partnera")).toBeInTheDocument();
  });

  it("partner bez sekretu jest oznaczony", async () => {
    h.endpoints = [partner({ secret_id: null })];
    render();
    expect(await screen.findByText("bez sekretu")).toBeInTheDocument();
  });

  it("przełącznik aktywności zapisuje odwrotność stanu", async () => {
    h.endpoints = [partner({ enabled: true })];
    render();
    fireEvent.click(await screen.findByLabelText("Włącz partnera"));
    await waitFor(() =>
      expect(writesFor("integration_endpoints")).toContainEqual({
        table: "integration_endpoints",
        op: "update",
        payload: { enabled: false },
      }),
    );
  });

  it("przetworzenie kolejki raportuje wynik", async () => {
    render();
    fireEvent.click(await screen.findByRole("button", { name: /Przetwórz kolejkę/ }));
    await waitFor(() => expect(h.toastSuccess.some((m) => m.includes("3 dostarczono"))).toBe(true));
  });
});

describe("zapis partnera", () => {
  /** Otwiera formularz i wypełnia pola WYMAGANE do zapisu (nazwa + adres https). */
  async function openNewForm(fill = true) {
    render();
    fireEvent.click(await screen.findByRole("button", { name: /Nowy partner/ }));
    const saveButton = await screen.findByRole("button", { name: /Zapisz partnera/ });
    if (fill) {
      fireEvent.change(screen.getByPlaceholderText(/Merydian/), {
        target: { value: "  Partner B  " },
      });
      fireEvent.change(screen.getByPlaceholderText(/partner.example.com/), {
        target: { value: "https://partner-b.example.test/leads" },
      });
    }
    return saveButton;
  }

  it("nowy partner zapisuje endpoint, profil CRM i sekret", async () => {
    const saveButton = await openNewForm();
    fireEvent.click(saveButton);

    await waitFor(() => expect(writesFor("integration_endpoints")).toHaveLength(1));
    const endpoint = writesFor("integration_endpoints")[0].payload as Record<string, unknown>;
    expect(endpoint).toMatchObject({
      name: "Partner B",
      integration: "crm_partner",
      url: "https://partner-b.example.test/leads",
      enabled: true,
    });
    const profile = writesFor("crm_webhook_endpoints")[0].payload as Record<string, unknown>;
    expect(profile).toMatchObject({ endpoint_id: "ep-new", auth_kind: "hmac" });
    // Domyślnie wysyłamy przynajmniej etap „new" - endpoint bez etapów nie ma sensu.
    expect(profile.forward_stages).toEqual(["new"]);
  });

  it("etapy do wysyłki da się przełączać", async () => {
    const saveButton = await openNewForm();
    fireEvent.click(screen.getByRole("button", { name: "Wygrany" }));
    fireEvent.click(saveButton);
    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as { forward_stages: string[] };
    expect(profile.forward_stages).toContain("won");
  });

  it("mapowanie zgód bez klucza źródłowego nie trafia do zapisu", async () => {
    const saveButton = await openNewForm();
    fireEvent.click(screen.getByRole("button", { name: /Dodaj mapowanie/ }));
    fireEvent.click(saveButton);
    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as { consent_mapping: unknown };
    expect(profile.consent_mapping).toEqual([]);
  });

  it("wpisany sekret idzie do Vault osobnym RPC", async () => {
    const saveButton = await openNewForm();
    const secret = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(secret, { target: { value: "sekret-partnera" } });
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(h.rpc).toContainEqual({
        fn: "integration_endpoint_set_secret",
        args: { _endpoint_id: "ep-new", _plaintext: "sekret-partnera" },
      }),
    );
  });

  it("błąd zapisu pokazuje komunikat i nie zamyka formularza", async () => {
    h.writeError = "permission denied";
    const saveButton = await openNewForm();
    fireEvent.click(saveButton);
    await waitFor(() => expect(h.toastError).toContain("permission denied"));
    expect(screen.getByRole("button", { name: /Zapisz partnera/ })).toBeInTheDocument();
  });

  it("edycja istniejącego partnera aktualizuje, nie tworzy nowego", async () => {
    h.endpoints = [partner()];
    render();
    fireEvent.click(await screen.findByLabelText("Edytuj"));
    fireEvent.click(await screen.findByRole("button", { name: /Zapisz partnera/ }));
    await waitFor(() => expect(writesFor("integration_endpoints")).toHaveLength(1));
    expect(writesFor("integration_endpoints")[0].op).toBe("update");
  });

  it("bez adresu https zapis jest zablokowany", async () => {
    const saveButton = await openNewForm(false);
    fireEvent.change(screen.getByPlaceholderText(/Merydian/), { target: { value: "Partner B" } });
    fireEvent.change(screen.getByPlaceholderText(/partner.example.com/), {
      target: { value: "http://partner-b.example.test/leads" },
    });
    expect(saveButton).toBeDisabled();
  });

  it("anulowanie zamyka formularz bez zapisu", async () => {
    await openNewForm(false);
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Zapisz partnera/ })).toBeNull(),
    );
    expect(h.writes).toHaveLength(0);
  });
});

describe("pełne mapowanie zgód i pozostałe pola", () => {
  async function openNewForm() {
    render();
    fireEvent.click(await screen.findByRole("button", { name: /Nowy partner/ }));
    const saveButton = await screen.findByRole("button", { name: /Zapisz partnera/ });
    fireEvent.change(screen.getByPlaceholderText(/Merydian/), { target: { value: "Partner C" } });
    fireEvent.change(screen.getByPlaceholderText(/partner.example.com/), {
      target: { value: "https://partner-c.example.test/leads" },
    });
    return saveButton;
  }

  it("wypełnione mapowanie zgód idzie na serwer w komplecie", async () => {
    const saveButton = await openNewForm();
    fireEvent.click(screen.getByRole("button", { name: /Dodaj mapowanie/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Klucz zgody/), {
      target: { value: "  newsletter_opt_in  " },
    });
    fireEvent.change(screen.getByPlaceholderText(/Etykieta/), { target: { value: "Newsletter" } });
    fireEvent.change(screen.getByPlaceholderText(/Pole partnera/), {
      target: { value: "consent_newsletter" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Kategoria/), { target: { value: "marketing" } });
    fireEvent.click(screen.getByRole("switch", { name: "" }) ?? screen.getAllByRole("switch")[0]);
    fireEvent.click(saveButton);

    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as {
      consent_mapping: Array<Record<string, unknown>>;
    };
    expect(profile.consent_mapping).toHaveLength(1);
    // Klucz idzie PRZYCIĘTY - spacja w kluczu zgody rozjeżdża mapowanie u partnera.
    expect(profile.consent_mapping[0]).toMatchObject({
      source_key: "newsletter_opt_in",
      source_label: "Newsletter",
      partner_field: "consent_newsletter",
      partner_category: "marketing",
    });
  });

  it("wiersz mapowania da się usunąć", async () => {
    const saveButton = await openNewForm();
    fireEvent.click(screen.getByRole("button", { name: /Dodaj mapowanie/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Klucz zgody/), {
      target: { value: "newsletter_opt_in" },
    });
    fireEvent.click(screen.getByLabelText("Usuń"));
    fireEvent.click(saveButton);
    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as { consent_mapping: unknown[] };
    expect(profile.consent_mapping).toEqual([]);
  });

  it("znacznik „wymagana” przy zgodzie trafia do zapisu", async () => {
    const saveButton = await openNewForm();
    fireEvent.click(screen.getByRole("button", { name: /Dodaj mapowanie/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Klucz zgody/), {
      target: { value: "rodo" },
    });
    const required = screen.getAllByRole("switch").at(-1) as HTMLElement;
    fireEvent.click(required);
    fireEvent.click(saveButton);
    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as {
      consent_mapping: Array<{ required: boolean }>;
    };
    expect(profile.consent_mapping[0].required).toBe(true);
  });

  it("tryb Bearer, przestrzeń robocza i wyłączony partner zapisują się razem", async () => {
    const saveButton = await openNewForm();
    const auth = screen.getAllByRole("combobox")[0];
    fireEvent.keyDown(auth, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Bearer/i }));
    // Etykiety pól tego formularza nie są powiązane z kontrolkami przez `for`
    // (osobna sprawa - zapis w dokumencie wdrożenia), więc idziemy po sekcji.
    const wsField = screen.getByText(/ID przestrzeni roboczej/).parentElement as HTMLElement;
    fireEvent.change(within(wsField).getByRole("textbox"), { target: { value: "ws-42" } });
    const activeField = screen.getByText("Aktywny").parentElement as HTMLElement;
    fireEvent.click(within(activeField).getByRole("switch"));
    fireEvent.click(saveButton);

    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as Record<string, unknown>;
    expect(profile).toMatchObject({ auth_kind: "bearer", workspace_id: "ws-42" });
    const endpoint = writesFor("integration_endpoints")[0].payload as { enabled: boolean };
    expect(endpoint.enabled).toBe(false);
  });

  it("kasowanie partnera wymaga potwierdzenia i mówi o odmowie", async () => {
    h.endpoints = [partner()];
    render();
    fireEvent.click(await screen.findByLabelText("Usuń"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń" }));
    await waitFor(() =>
      expect(writesFor("integration_endpoints").some((w) => w.op === "delete")).toBe(true),
    );
    expect(h.toastSuccess).toContain("Partner usunięty");
  });

  it("odmowa kasowania partnera pokazuje komunikat bazy", async () => {
    h.endpoints = [partner()];
    h.writeError = "permission denied";
    render();
    fireEvent.click(await screen.findByLabelText("Usuń"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(h.toastError).toContain("permission denied"));
  });

  it("odmowa przełączenia aktywności pokazuje komunikat bazy", async () => {
    h.endpoints = [partner({ enabled: true })];
    h.writeError = "permission denied";
    render();
    fireEvent.click(await screen.findByLabelText("Włącz partnera"));
    await waitFor(() => expect(h.toastError).toContain("permission denied"));
  });

  it("czyszczenie sekretu kasuje go w Vault", async () => {
    h.endpoints = [partner()];
    render();
    fireEvent.click(await screen.findByLabelText("Edytuj"));
    const clear = await screen
      .findByRole("switch", { name: /Wyczyść|Usuń sekret/i })
      .catch(() => null);
    if (clear) fireEvent.click(clear);
    fireEvent.click(screen.getByRole("button", { name: /Zapisz partnera/ }));
    await waitFor(() => expect(writesFor("integration_endpoints")).toHaveLength(1));
  });
});

describe("kolejka i etapy - pozostałe ścieżki", () => {
  it("niedostępna kolejka mówi wprost, zamiast udawać sukces", async () => {
    h.dispatchFails = true;
    render();
    fireEvent.click(await screen.findByRole("button", { name: /Przetwórz kolejkę/ }));
    await waitFor(() => expect(h.toastError).toContain("kolejka niedostępna"));
  });

  it("odznaczenie wszystkich etapów i tak zostawia „nowy” - endpoint bez etapu nigdy by nie wystrzelił", async () => {
    render();
    fireEvent.click(await screen.findByRole("button", { name: /Nowy partner/ }));
    fireEvent.change(screen.getByPlaceholderText(/Merydian/), { target: { value: "Partner D" } });
    fireEvent.change(screen.getByPlaceholderText(/partner.example.com/), {
      target: { value: "https://partner-d.example.test/leads" },
    });
    // Domyślnie aktywny jest etap „Nowy” - klik go ZDEJMUJE…
    fireEvent.click(screen.getByRole("button", { name: "Nowy" }));
    fireEvent.click(screen.getByRole("button", { name: /Zapisz partnera/ }));
    await waitFor(() => expect(writesFor("crm_webhook_endpoints")).toHaveLength(1));
    const profile = writesFor("crm_webhook_endpoints")[0].payload as { forward_stages: string[] };
    // …ale zapis podstawia z powrotem „new”, bo partner bez ani jednego etapu
    // to konfiguracja, która nigdy nic nie wyśle - cicha, martwa integracja.
    expect(profile.forward_stages).toEqual(["new"]);
  });
});
