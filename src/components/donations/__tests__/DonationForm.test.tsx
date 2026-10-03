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
  /** Suma wpłat widziana przez pasek celu (`getDonationsPublicStats`). */
  raisedCents: 25_000,
  getStats: vi.fn(),
}));

// Atrapa modala kasy wystawia oba sygnały `onOpenChange`, którymi prawdziwy
// Radix Dialog zgłasza zamknięcie (krzyżyk, Esc, klik w tło) - formularz ma na
// nie zareagować zdjęciem sesji, a NIE samym schowaniem okna.
vi.mock("@/components/checkout/EmbeddedCheckoutDialog", () => {
  return {
    EmbeddedCheckoutDialog: ({
      clientSecret,
      title,
      onOpenChange,
    }: {
      clientSecret: string | null;
      title?: string;
      onOpenChange: (open: boolean) => void;
    }) =>
      clientSecret ? (
        <div data-testid="checkout" data-secret={clientSecret}>
          <span data-testid="checkout-title">{title}</span>
          <button type="button" onClick={() => onOpenChange(true)}>
            atrapa: zostaw otwarte
          </button>
          <button type="button" onClick={() => onOpenChange(false)}>
            atrapa: zamknij kasę
          </button>
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
  getDonationsPublicStats: async () => {
    h.getStats();
    return {
      totalCents: h.raisedCents,
      monthCents: 5_000,
      count: 4,
      monthCount: 1,
      currency: "PLN",
      recent: [],
      truncated: false,
    };
  },
  createDonationCheckout: vi.fn(),
}));

import i18n from "@/lib/i18n";
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

/** Kwoty formatowane przez Intl niosą twarde spacje - porównujemy po normalizacji. */
function flat(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

const submitName = /przejdź do płatności|continue to payment/i;

beforeEach(() => {
  h.submit.mockReset();
  h.submit.mockResolvedValue({ ok: true, clientSecret: "cs_secret_1", donationId: "don-1" });
  h.getStats.mockReset();
  h.raisedCents = 25_000;
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

describe("DonationForm - pasek celu zbiórki", () => {
  it("pokazuje zebraną kwotę na tle celu i procent postępu", async () => {
    renderForm({ goalCents: 100_000, currency: "PLN" });

    const bar = await screen.findByRole("progressbar", { name: /cel zbiórki|fundraising goal/i });
    await waitFor(() => expect(bar.getAttribute("aria-valuenow")).toBe("25"));
    expect(h.getStats).toHaveBeenCalled();
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("25%");
    expect(flat(bar.previousElementSibling?.textContent)).toContain("250 zł / 1000 zł");
  });

  it("nadwyżka ponad cel nie rozpycha paska poza 100%", async () => {
    h.raisedCents = 250_000;
    renderForm({ goalCents: 100_000 });

    const bar = await screen.findByRole("progressbar");
    await waitFor(() => expect(bar.getAttribute("aria-valuenow")).toBe("100"));
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("100%");
  });

  it("bez celu nie pyta serwera o statystyki i nie rysuje paska", async () => {
    renderForm({ goalCents: 0 });

    await screen.findByRole("button", { name: submitName });
    expect(screen.queryByRole("progressbar")).toBeNull();
    // `enabled: false` ma faktycznie wstrzymać odczyt, a nie tylko schować wynik.
    expect(h.getStats).not.toHaveBeenCalled();
  });
});

describe("DonationForm - dane darczyńcy", () => {
  it("przekazuje e-mail i wiadomość po przycięciu spacji oraz adres powrotu", async () => {
    renderForm({ allowMessage: true });
    await clickPreset();

    fireEvent.change(screen.getByLabelText(/adres e-mail|email address/i), {
      target: { value: "  darczynca@example.com  " },
    });
    fireEvent.change(screen.getByLabelText(/wiadomość dla redakcji|message to the newsroom/i), {
      target: { value: "  Dziękuję za raporty  " },
    });
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const data = h.submit.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.donorEmail).toBe("darczynca@example.com");
    expect(data.message).toBe("Dziękuję za raporty");
    expect(data.returnUrl).toBe(`${window.location.origin}/donate?status=thanks`);
  });

  it("pola wypełnione samymi spacjami nie trafiają do sesji płatności", async () => {
    renderForm({ allowMessage: true });
    await clickPreset();

    fireEvent.change(screen.getByLabelText(/adres e-mail|email address/i), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText(/wiadomość dla redakcji|message to the newsroom/i), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const data = h.submit.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.donorEmail).toBeUndefined();
    expect(data.message).toBeUndefined();
  });

  it("wiadomość jest ucinana do 500 znaków, a licznik pokazuje limit", async () => {
    renderForm({ allowMessage: true });
    const field = await screen.findByLabelText(/wiadomość dla redakcji|message to the newsroom/i);

    fireEvent.change(field, { target: { value: "x".repeat(620) } });

    expect((field as HTMLTextAreaElement).value).toHaveLength(500);
    expect(screen.getByText("500/500")).toBeTruthy();
  });

  it("bez zgody na wiadomość formularz nie pokazuje tego pola", async () => {
    renderForm({ allowMessage: false });
    await screen.findByRole("button", { name: submitName });
    expect(screen.queryByLabelText(/wiadomość dla redakcji|message to the newsroom/i)).toBeNull();
  });
});

describe("DonationForm - błędy wysyłki", () => {
  it("zerwane połączenie daje ogólny komunikat i odblokowuje przycisk", async () => {
    h.submit.mockRejectedValue(new Error("test: brak sieci"));
    renderForm();
    await clickPreset();
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /nie udało się otworzyć płatności|could not open the payment/i,
      ),
    );
    const button = screen.getByRole("button", { name: submitName });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId("checkout")).toBeNull();
  });

  it("nieznany kod błędu serwera spada na komunikat ogólny, nie na surowy klucz", async () => {
    h.submit.mockResolvedValue({ ok: false, error: "kod_spoza_slownika" });
    renderForm();
    await clickPreset();
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /nie udało się otworzyć płatności|could not open the payment/i,
      ),
    );
    expect(screen.getByRole("alert").textContent).not.toContain("kod_spoza_slownika");
  });

  it("wysłanie formularza z pominięciem przycisku nie tworzy sesji poza zakresem", async () => {
    const { container } = renderForm({ minCents: 1000, allowCustom: true });
    const custom = await screen.findByLabelText(/inna kwota|other amount/i);
    fireEvent.change(custom, { target: { value: "5" } });

    // Przycisk jest zablokowany, ale formularz da się wysłać inną drogą
    // (Enter w polu, skrypt) - strażnik w `handleSubmit` jest ostatnią linią.
    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByRole("alert").textContent).toMatch(
      /poza dozwolonym zakresem|outside the allowed range/i,
    );
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("wybór kwoty sugerowanej czyści wcześniejszy komunikat błędu", async () => {
    const { container } = renderForm({ minCents: 1000, allowCustom: true });
    fireEvent.change(await screen.findByLabelText(/inna kwota|other amount/i), {
      target: { value: "5" },
    });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("alert").textContent).not.toBe("");

    await clickPreset();

    expect(screen.getByRole("alert").textContent).toBe("");
  });
});

describe("DonationForm - zamknięcie kasy", () => {
  it("zamknięcie modala zdejmuje sesję, a sygnał otwarcia jej nie rusza", async () => {
    renderForm({ allowRecurring: true });
    await clickPreset();
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() => expect(screen.getByTestId("checkout")).toBeTruthy());
    // Wpłata jednorazowa ma własny tytuł modala - darczyńca widzi, co płaci.
    expect(screen.getByTestId("checkout-title").textContent).toMatch(/^(darowizna|donation)$/i);

    fireEvent.click(screen.getByRole("button", { name: "atrapa: zostaw otwarte" }));
    expect(screen.getByTestId("checkout")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "atrapa: zamknij kasę" }));
    await waitFor(() => expect(screen.queryByTestId("checkout")).toBeNull());

    // Po zamknięciu można rozpocząć NOWĄ sesję - przycisk nie zostaje zablokowany.
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2));
  });
});

describe("DonationForm - język i waluta", () => {
  // Najpierw odmontowanie, potem powrót języka - inaczej zmiana języka
  // przerysowuje formularz poza `act` i zaśmieca log ostrzeżeniami.
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("pl");
  });

  it("w wersji angielskiej formatuje kwoty po angielsku i otwiera kasę po angielsku", async () => {
    await i18n.changeLanguage("en");
    renderForm({ currency: "EUR", presetsCents: [5000], allowCustom: true });

    const preset = await screen.findByRole("button", { name: "€50" });
    expect(screen.getByText(/amount between €5 and €10,000/i)).toBeTruthy();
    expect(screen.getByLabelText(/other amount/i).getAttribute("placeholder")).toBe("50.00");

    fireEvent.click(preset);
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(h.submit.mock.calls[0]?.[0]).toMatchObject({
      data: { amountCents: 5000, locale: "en" },
    });
  });

  it("podpowiedź formatu kwoty idzie za walutą zbiórki", async () => {
    renderForm({ currency: "PLN", allowCustom: true });
    expect(
      (await screen.findByLabelText(/inna kwota|other amount/i)).getAttribute("placeholder"),
    ).toBe("100,00");
    cleanup();

    renderForm({ currency: "EUR", allowCustom: true });
    expect(
      (await screen.findByLabelText(/inna kwota|other amount/i)).getAttribute("placeholder"),
    ).toBe("50.00");
  });
});
