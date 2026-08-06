// Formularz darowizny: ścieżka cykliczna (wsparcie miesięczne), granice kwoty,
// obsługa błędu serwera i degradacja trybów modułu.
//
// Dowód leniwego ładowania kasy stoi osobno, w
// `components/checkout/__tests__/LazyEmbeddedCheckoutDialog.test.tsx`.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DONATIONS_DEFAULTS, type DonationsConfig } from "@/lib/billing/donationsConfig";

const h = vi.hoisted(() => ({
  submit: vi.fn(),
  config: null as DonationsConfig | null,
}));

vi.mock("@/components/checkout/EmbeddedCheckoutDialog", () => {
  return {
    EmbeddedCheckoutDialog: ({
      clientSecret,
      title,
    }: {
      clientSecret: string | null;
      title?: string;
    }) =>
      clientSecret ? (
        <div data-testid="checkout" data-secret={clientSecret}>
          {title}
        </div>
      ) : null,
  };
});

// Mock CZĘŚCIOWY - `createIsomorphicFn` z tego modułu napędza runtime i18n.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => h.submit };
});
vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" as const }));
vi.mock("@/lib/billing/donations.functions", () => ({
  getDonationsConfig: async () => h.config,
  getDonationsPublicStats: async () => ({
    totalCents: 25_000,
    monthCents: 5_000,
    count: 4,
    monthCount: 1,
    currency: "PLN",
    recent: [],
    truncated: false,
  }),
  createDonationCheckout: vi.fn(),
}));

import { DonationForm } from "@/components/donations/DonationForm";

function renderForm(config: Partial<DonationsConfig> = {}) {
  h.config = { ...DONATIONS_DEFAULTS, ...config };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DonationForm />
    </QueryClientProvider>,
  );
}

/** Przycisk kwoty sugerowanej - etykieta jest sformatowaną walutą. */
async function clickPreset(index = 0) {
  const buttons = await screen.findAllByRole("button", { pressed: false });
  const preset = buttons.find((b) => /\d/.test(b.textContent ?? ""));
  expect(preset).toBeDefined();
  fireEvent.click(preset!);
  return index;
}

beforeEach(() => {
  h.submit.mockReset();
  h.submit.mockResolvedValue({ ok: true, clientSecret: "cs_secret_1", donationId: "don-1" });
});
afterEach(cleanup);

describe("DonationForm - ścieżka cykliczna", () => {
  it("wysyła wsparcie miesięczne z zadeklarowaną kwotą i otwiera kasę", async () => {
    renderForm({ currency: "PLN", presetsCents: [5000], allowRecurring: true });

    fireEvent.click(await screen.findByRole("radio", { name: /co miesiąc|monthly/i }));
    await clickPreset();
    fireEvent.click(screen.getByRole("button", { name: /przejdź do płatności|continue/i }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(h.submit.mock.calls[0]?.[0]).toMatchObject({
      data: {
        amountCents: 5000,
        recurring: true,
        environment: "sandbox",
        locale: "pl",
      },
    });
    await waitFor(() => expect(screen.getByTestId("checkout")).toBeTruthy());
    expect(screen.getByTestId("checkout").getAttribute("data-secret")).toBe("cs_secret_1");
  });

  it("informuje o cykliczności i prawie do rezygnacji dopiero w trybie miesięcznym", async () => {
    renderForm({ allowRecurring: true });
    const note = /co miesiąc do momentu rezygnacji|every month until you cancel/i;
    await screen.findByRole("radio", { name: /jednorazowo|one-off/i });
    expect(screen.queryByText(note)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /co miesiąc|monthly/i }));
    expect(screen.getByText(note)).toBeTruthy();
  });

  it("nie pokazuje przełącznika, gdy wsparcie cykliczne jest wyłączone", async () => {
    renderForm({ allowRecurring: false });
    await clickPreset();
    expect(screen.queryByRole("radio", { name: /co miesiąc|monthly/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /przejdź do płatności|continue/i }));
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0]?.[0]).toMatchObject({ data: { recurring: false } });
  });
});

describe("DonationForm - leniwa kasa", () => {
  // Dowód, że chunk kasy nie jedzie do czytelnika, stoi w dedykowanym teście
  // `LazyEmbeddedCheckoutDialog` (licznik importów modułu da się obserwować
  // tylko raz na plik). Tutaj pilnujemy warstwy formularza: modal pojawia się
  // dopiero z sesją, nigdy przy samym wejściu na stronę.
  it("nie renderuje kasy przy wejściu na stronę wpłaty", async () => {
    renderForm();
    await clickPreset();
    expect(screen.queryByTestId("checkout")).toBeNull();
  });
});

describe("DonationForm - granice kwoty", () => {
  it("blokuje wysyłkę bez kwoty i poza zakresem z konfiguracji", async () => {
    renderForm({ minCents: 1000, maxCents: 50_000, allowCustom: true, presetsCents: [2500] });

    const submitButton = await screen.findByRole("button", {
      name: /przejdź do płatności|continue/i,
    });
    expect(submitButton.hasAttribute("disabled")).toBe(true);

    const custom = screen.getByLabelText(/inna kwota|other amount/i);
    fireEvent.change(custom, { target: { value: "5" } });
    expect(submitButton.hasAttribute("disabled")).toBe(true);
    expect(custom.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(custom, { target: { value: "120,50" } });
    expect(submitButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(submitButton);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0]?.[0]).toMatchObject({ data: { amountCents: 12_050 } });
  });

  it("pokazuje komunikat błędu zwrócony przez serwer", async () => {
    h.submit.mockResolvedValue({ ok: false, error: "rate_limited" });
    renderForm();
    await clickPreset();
    fireEvent.click(screen.getByRole("button", { name: /przejdź do płatności|continue/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/zbyt wiele prób|too many attempts/i),
    );
    expect(screen.queryByTestId("checkout")).toBeNull();
  });
});

describe("DonationForm - tryby modułu", () => {
  it("tryb zewnętrzny degraduje formularz do jawnego linku w nowej karcie", async () => {
    renderForm({ provider: "external", externalUrl: "https://zbiorka.example/nes" });

    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("https://zbiorka.example/nes");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByTestId("checkout")).toBeNull();
  });

  it("moduł wyłączony nie zaprasza do wpłaty", async () => {
    renderForm({ enabled: false });
    expect(await screen.findByText(/chwilowo wyłączona|temporarily closed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /przejdź do płatności|continue/i })).toBeNull();
  });
});
