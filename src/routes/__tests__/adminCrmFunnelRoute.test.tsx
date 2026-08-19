// Trasa `/admin/crm/funnel` - lejek marketingowy (subskrybenci newslettera).
//
// Test montuje PRAWDZIWĄ trasę w routerze pamięciowym, więc przechodzi tę samą
// drogę co operator: statystyki, filtry odbiorców, zaznaczenie i dwie operacje
// zbiorcze, z których jedna (konwersja na Kontakty) przenosi DANE OSOBOWE
// między tabelami, a druga (wypisanie) odbiera zgodę na wysyłkę.
//
// Zamockowana jest wyłącznie granica sieci: serwerowe funkcje lejka.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  stats: { total: 0, subscribed: 0, pending: 0, unsubscribed: 0, registered: 0, contacts: 0 },
  listArgs: [] as unknown[],
  unsubscribed: [] as unknown[],
  converted: [] as unknown[],
  listThrows: false,
  toastError: [] as string[],
  toastSuccess: [] as string[],
}));

vi.mock("@/lib/crm-funnel.functions", () => ({
  listFunnelSubscribers: async (input: unknown) => {
    h.listArgs.push(input);
    if (h.listThrows) throw new Error("read failed");
    return { json: JSON.stringify(h.rows) };
  },
  funnelStats: async () => h.stats,
  bulkUnsubscribeFunnel: async (input: unknown) => {
    h.unsubscribed.push(input);
    return { ok: true, count: 1 };
  },
  convertFunnelToContacts: async (input: unknown) => {
    h.converted.push(input);
    return { ok: true, count: 1 };
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "pl" }, t: (k: string) => k }),
}));

import { Route } from "@/routes/admin.crm.funnel.index";

const subscriber = (over: Record<string, unknown> = {}) => ({
  id: "sub-1",
  tenant_id: "t1",
  email: "anna@example.test",
  first_name: "Anna",
  last_name: "Kowalska",
  display_name: "Anna Kowalska",
  language: "pl",
  source: "stopka",
  status: "subscribed",
  confirmed_at: "2026-08-01T10:00:00.000Z",
  unsubscribed_at: null,
  created_at: "2026-08-01T09:00:00.000Z",
  user_id: null,
  profile_id: null,
  avatar_url: null,
  is_registered: false,
  contact_id: null,
  is_contact: false,
  contact_stage: null,
  contact_score: null,
  ...over,
});

const mountFunnel = () =>
  renderRoute({ route: Route, path: "/admin/crm/funnel", initialEntry: "/admin/crm/funnel" });

beforeEach(() => {
  h.rows = [];
  h.stats = { total: 0, subscribed: 0, pending: 0, unsubscribed: 0, registered: 0, contacts: 0 };
  h.listArgs = [];
  h.unsubscribed = [];
  h.converted = [];
  h.listThrows = false;
  h.toastError = [];
  h.toastSuccess = [];
});

afterEach(() => cleanup());

describe("trasa lejka marketingowego", () => {
  it("nagłówek strony jest oznaczony jako panel (tytuł z head())", async () => {
    const view = await mountFunnel();
    expect(view.meta().some((m) => String(m.title ?? "").includes("Lejek marketingowy"))).toBe(true);
  });

  it("pokazuje statystyki lejka z bazy", async () => {
    h.stats = { total: 120, subscribed: 90, pending: 10, unsubscribed: 20, registered: 40, contacts: 25 };
    await mountFunnel();
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("pusta lista mówi wprost, że nic nie ma - nie udaje danych", async () => {
    await mountFunnel();
    expect(await screen.findByText(/Brak subskrybentów/i)).toBeInTheDocument();
  });

  it("wiersz pokazuje osobę, źródło i powiązania", async () => {
    h.rows = [subscriber({ is_registered: true, is_contact: true, contact_id: "lead-1" })];
    await mountFunnel();
    expect(await screen.findByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("anna@example.test")).toBeInTheDocument();
    expect(screen.getByText("Zarejestrowany")).toBeInTheDocument();
    expect(screen.getByText("Kontakt")).toBeInTheDocument();
  });

  it("fraza wyszukiwania trafia do zapytania serwerowego", async () => {
    await mountFunnel();
    fireEvent.change(await screen.findByPlaceholderText(/Szukaj po e-mailu/), {
      target: { value: "kowalska" },
    });
    await waitFor(() =>
      expect(
        h.listArgs.some((a) => (a as { data?: { search?: string } })?.data?.search === "kowalska"),
      ).toBe(true),
    );
  });

  it("zaznaczenie pozwala wypisać zaznaczonych z newslettera", async () => {
    h.rows = [subscriber()];
    await mountFunnel();
    // Checkbox wiersza ma etykietę z adresem - nagłówkowy „zaznacz wszystko"
    // jest osobny.
    fireEvent.click(await screen.findByLabelText("Select anna@example.test"));
    fireEvent.click(await screen.findByRole("button", { name: "Wypisz" }));
    // Operacja nieodwracalna - potwierdzenie w oknie dialogowym.
    fireEvent.click(await screen.findByRole("button", { name: "Potwierdź" }));
    await waitFor(() => expect(h.unsubscribed).toHaveLength(1));
    expect((h.unsubscribed[0] as { data: { ids: string[] } }).data.ids).toEqual(["sub-1"]);
  });

  it("konwersja na Kontakty wysyła zaznaczone identyfikatory", async () => {
    h.rows = [subscriber()];
    await mountFunnel();
    fireEvent.click(await screen.findByLabelText("Select anna@example.test"));
    fireEvent.click(await screen.findByRole("button", { name: "Utwórz Kontakty" }));
    fireEvent.click(await screen.findByRole("button", { name: "Potwierdź" }));
    await waitFor(() => expect(h.converted).toHaveLength(1));
    expect((h.converted[0] as { data: { ids: string[] } }).data.ids).toEqual(["sub-1"]);
  });

  it("błąd odczytu nie wywraca strony", async () => {
    h.listThrows = true;
    await mountFunnel();
    // Strona zostaje na miejscu (nagłówek + pusty stan), zamiast białego ekranu.
    expect(await screen.findByRole("heading", { name: "Lejek marketingowy" })).toBeInTheDocument();
  });
});
