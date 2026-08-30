// Zdrowie webhooków operatora płatności - 25 linii, 0 z 4 funkcji pokrytych.
//
// SKĄD TEN PLIK NA GAŁĘZI O WYDARZENIACH. `WebhookHealthPanel.tsx` wszedł na
// `main` bez testu i sam jeden zbił próg `src/components/admin/billing/**`
// poniżej ratchetu (linie 88,3% wobec progu 97%), więc bramka `verify` była
// czerwona na KAŻDYM PR-ze wychodzącym z tego `main`, nie tylko na tym.
// Pozostałe sześć plików tego katalogu stoi na 94-100%. Progu obniżyć nie
// wolno, więc jedyną drogą do zieleni jest pokrycie tego pliku.
//
// TO NIE JEST WYPEŁNIACZ POKRYCIA. Panel pilnuje pieniędzy: mówi, czy
// webhooki operatora dochodzą, i pozwala ponowić powiadomienie o zgłoszeniu.
// Cztery rzeczy, które muszą być prawdą:
//
//   1. PRÓG ALARMU JEST NAZWANY W KOMENTARZU PANELU (powyżej 5% czerwono,
//      powyżej 1% bursztynowo) i to są progi OSTRE. Dokładnie 5% ma być
//      jeszcze „obserwuj", a nie „napraw teraz" - inaczej alarm najwyższego
//      stopnia zapala się o jeden przypadek za wcześnie i traci wagę.
//   2. BRAK POMIARU CZASU TO MYŚLNIK, NIE ZERO. `avgDurationMs === null`
//      znaczy „nie ma danych"; wyświetlone „0 ms" byłoby zdaniem o
//      błyskawicznym webhooku, czyli nieprawdą o stanie systemu.
//   3. PONOWNA WYSYŁKA IDZIE WYŁĄCZNIE Z POPRAWNYM IDENTYFIKATOREM. Przycisk
//      jest zablokowany, dopóki wpisane nie jest UUID-em - server fn i tak
//      waliduje `z.string().uuid()`, więc bez tej blokady operator dostawałby
//      odmowę schematu zamiast podpowiedzi.
//   4. PUSTA LISTA AWARII MÓWI, ŻE ICH NIE MA. Cisza w tym miejscu czyta się
//      jak „nie sprawdzono".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import type { WebhookHealth } from "@/lib/billing/webhookHealthApi";

const h = vi.hoisted(() => ({
  fetchHealth: vi.fn(),
  resend: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => "pl");
});

// Import słownika jest tu efektem ubocznym (`ensureTicketsI18n()` na module).
vi.mock("@/lib/i18n-participant-tickets", () => ({ ensureI18n: () => undefined }));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toastSuccess(message),
    error: (message: string) => h.toastError(message),
  },
}));

vi.mock("@/lib/billing/webhookHealthApi", () => ({
  fetchWebhookHealth: (environment: string, sinceHours: number) =>
    h.fetchHealth(environment, sinceHours),
}));

vi.mock("@/lib/events/outcomeResend.functions", () => ({
  resendRegistrationNotifications: (arg: unknown) => h.resend(arg),
}));

const { WebhookHealthPanel } = await import("../WebhookHealthPanel");

/** Pomiar bez ani jednej awarii - punkt wyjścia, nadpisywany per przypadek. */
function zdrowie(overrides: Partial<WebhookHealth> = {}): WebhookHealth {
  return {
    environment: "live",
    since: "2026-08-29T10:00:00.000Z",
    total: 100,
    processed: 100,
    skipped: 0,
    failed: 0,
    pending: 0,
    retries: 0,
    failureRate: 0,
    avgDurationMs: 120,
    p95DurationMs: 340,
    avgLagSeconds: 2,
    byType: [
      { eventType: "checkout.session.completed", total: 100, failed: 0, avgDurationMs: 120 },
    ],
    recentFailures: [],
    ...overrides,
  };
}

function pokaz(environment: "sandbox" | "live" = "live", sinceHours = 24) {
  return renderWithQueryClient(
    <WebhookHealthPanel environment={environment} sinceHours={sinceHours} />,
  );
}

/** Klika „Wczytaj" i czeka, aż metryki się pojawią. */
async function wczytaj() {
  fireEvent.click(screen.getByRole("button", { name: "webhookHealth.load" }));
  await screen.findByRole("status");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchHealth.mockResolvedValue(zdrowie());
  h.resend.mockResolvedValue({
    registrationId: "11111111-2222-3333-4444-555555555555",
    outcome: "paid",
    emailed: true,
    smsSent: false,
    promotedNotified: 0,
  });
});

describe("stan przed pomiarem", () => {
  it("nie pokazuje ANI JEDNEJ metryki, dopóki nikt nie wczytał danych", () => {
    pokaz();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("webhookHealth.total")).toBeNull();
    expect(screen.queryByText("webhookHealth.failureRate")).toBeNull();
  });

  it("pole ponownej wysyłki jest dostępne od razu - nie czeka na pomiar", () => {
    pokaz();
    expect(screen.getByLabelText("webhookHealth.registrationId")).toBeInTheDocument();
  });

  it("nie odpytuje bazy samo z siebie", () => {
    pokaz();
    expect(h.fetchHealth).not.toHaveBeenCalled();
  });
});

describe("wczytanie pomiaru", () => {
  it("pyta o DOKŁADNIE to środowisko i okno, które dostało we właściwościach", async () => {
    pokaz("sandbox", 72);
    await wczytaj();
    expect(h.fetchHealth).toHaveBeenCalledTimes(1);
    expect(h.fetchHealth).toHaveBeenCalledWith("sandbox", 72);
  });

  it("liczby z odpowiedzi trafiają na ekran bez przeliczania", async () => {
    h.fetchHealth.mockResolvedValue(
      zdrowie({ total: 4211, processed: 4190, failed: 17, pending: 4, retries: 9 }),
    );
    pokaz();
    await wczytaj();
    expect(screen.getByText("4211")).toBeInTheDocument();
    expect(screen.getByText("4190")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("odmowa odczytu mówi TREŚCIĄ odmowy, a metryk nie pokazuje", async () => {
    h.fetchHealth.mockRejectedValue(new Error("webhook_health_denied"));
    pokaz();
    fireEvent.click(screen.getByRole("button", { name: "webhookHealth.load" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("webhook_health_denied"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("odmowa bez klasy Error nie gubi komunikatu", async () => {
    h.fetchHealth.mockRejectedValue("padło");
    pokaz();
    fireEvent.click(screen.getByRole("button", { name: "webhookHealth.load" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("padło"));
  });
});

describe("próg alarmu - komentarz panelu nazywa go wprost, więc jest sprawdzany na granicy", () => {
  it.each([
    ["0 (nic nie padło)", 0, "webhookHealth.alertOk"],
    ["1% - DOKŁADNIE próg, jeszcze spokój", 0.01, "webhookHealth.alertOk"],
    ["1,01% - pierwszy krok ponad próg", 0.0101, "webhookHealth.alertWarn"],
    ["5% - DOKŁADNIE próg, jeszcze „obserwuj”", 0.05, "webhookHealth.alertWarn"],
    ["5,01% - pierwszy krok ponad próg", 0.0501, "webhookHealth.alertHigh"],
    ["50% - katastrofa", 0.5, "webhookHealth.alertHigh"],
  ])("odsetek %s daje %s", async (_opis, failureRate, klucz) => {
    h.fetchHealth.mockResolvedValue(zdrowie({ failureRate }));
    pokaz();
    await wczytaj();
    expect(screen.getByRole("status").textContent).toContain(klucz);
  });

  it("stopień alarmu NIE jest tym samym co liczba awarii - 1 z 10 to już czerwień", async () => {
    h.fetchHealth.mockResolvedValue(zdrowie({ total: 10, failed: 1, failureRate: 0.1 }));
    pokaz();
    await wczytaj();
    expect(screen.getByRole("status").textContent).toContain("webhookHealth.alertHigh");
  });

  it("odsetek pokazuje się z dwoma miejscami po przecinku, a nie zaokrąglony do całości", async () => {
    h.fetchHealth.mockResolvedValue(zdrowie({ failureRate: 0.0333 }));
    pokaz();
    await wczytaj();
    expect(screen.getByText("3.33%")).toBeInTheDocument();
  });
});

describe("brak pomiaru czasu to myślnik, nie zero", () => {
  it("`avgDurationMs === null` daje „-”, a NIE „0 ms”", async () => {
    h.fetchHealth.mockResolvedValue(zdrowie({ avgDurationMs: null, p95DurationMs: null }));
    pokaz();
    await wczytaj();
    expect(screen.queryByText("0 ms")).toBeNull();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });

  it("zero milisekund to co innego niż brak pomiaru - pokazuje się jako „0 ms”", async () => {
    h.fetchHealth.mockResolvedValue(zdrowie({ avgDurationMs: 0, p95DurationMs: 0 }));
    pokaz();
    await wczytaj();
    expect(screen.getAllByText("0 ms").length).toBe(2);
  });

  it("czas jest zaokrąglany do pełnych milisekund, nie obcinany do ułamka", async () => {
    h.fetchHealth.mockResolvedValue(zdrowie({ avgDurationMs: 1234.6, p95DurationMs: 99.4 }));
    pokaz();
    await wczytaj();
    expect(screen.getByText(/1\D?235 ms/)).toBeInTheDocument();
    expect(screen.getByText("99 ms")).toBeInTheDocument();
  });
});

describe("rozbicie po typach zdarzeń", () => {
  it("każdy typ dostaje własny wiersz z liczbą wszystkich i nieudanych", async () => {
    h.fetchHealth.mockResolvedValue(
      zdrowie({
        byType: [
          { eventType: "checkout.session.completed", total: 80, failed: 2, avgDurationMs: 110 },
          { eventType: "charge.refunded", total: 20, failed: 0, avgDurationMs: null },
        ],
      }),
    );
    pokaz();
    await wczytaj();
    expect(screen.getByText("checkout.session.completed")).toBeInTheDocument();
    expect(screen.getByText("charge.refunded")).toBeInTheDocument();
    expect(screen.getByText(/80 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/20 \/ 0/)).toBeInTheDocument();
  });
});

describe("ostatnie awarie", () => {
  it("pusta lista MÓWI, że awarii nie ma - cisza czytałaby się jak „nie sprawdzono”", async () => {
    pokaz();
    await wczytaj();
    expect(screen.getByText("webhookHealth.noFailures")).toBeInTheDocument();
  });

  it("awaria niesie typ, liczbę ponowień i TREŚĆ błędu", async () => {
    h.fetchHealth.mockResolvedValue(
      zdrowie({
        failed: 1,
        failureRate: 0.01,
        recentFailures: [
          {
            id: "f-1",
            eventType: "invoice.payment_failed",
            error: "signature verification failed",
            occurredAt: "2026-08-29T12:34:56.000Z",
            retryCount: 3,
          },
        ],
      }),
    );
    pokaz();
    await wczytaj();
    expect(screen.getByText("invoice.payment_failed")).toBeInTheDocument();
    expect(screen.getByText("signature verification failed")).toBeInTheDocument();
    expect(screen.getByText(/webhookHealth\.retries: 3/)).toBeInTheDocument();
  });

  it("awaria bez treści błędu nie renderuje pustego akapitu", async () => {
    h.fetchHealth.mockResolvedValue(
      zdrowie({
        recentFailures: [
          {
            id: "f-2",
            eventType: "charge.failed",
            error: null,
            occurredAt: "2026-08-29T12:00:00.000Z",
            retryCount: 0,
          },
        ],
      }),
    );
    const { container } = pokaz();
    await wczytaj();
    expect(container.querySelector("p.text-destructive")).toBeNull();
  });

  it("awaria bez znacznika czasu dostaje myślnik, a nie „Invalid Date”", async () => {
    h.fetchHealth.mockResolvedValue(
      zdrowie({
        recentFailures: [
          {
            id: "f-3",
            eventType: "charge.failed",
            error: null,
            occurredAt: null,
            retryCount: 1,
          },
        ],
      }),
    );
    pokaz();
    await wczytaj();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

describe("ponowna wysyłka powiadomienia", () => {
  const UUID = "11111111-2222-3333-4444-555555555555";

  it("przycisk jest ZABLOKOWANY, dopóki pole jest puste", () => {
    pokaz();
    expect(screen.getByRole("button", { name: /webhookHealth\.resend$/ })).toBeDisabled();
  });

  it.each([
    ["urwane UUID", "11111111-2222-3333-4444"],
    ["nie-szesnastkowe znaki", "zzzzzzzz-2222-3333-4444-555555555555"],
    ["sam identyfikator liczbowy", "12345"],
    ["zdanie", "zgloszenie Kowalskiego"],
  ])("przycisk jest ZABLOKOWANY dla wartości: %s", (_opis, wartosc) => {
    pokaz();
    fireEvent.change(screen.getByLabelText("webhookHealth.registrationId"), {
      target: { value: wartosc },
    });
    expect(screen.getByRole("button", { name: /webhookHealth\.resend$/ })).toBeDisabled();
  });

  it("poprawne UUID odblokowuje przycisk", () => {
    pokaz();
    fireEvent.change(screen.getByLabelText("webhookHealth.registrationId"), {
      target: { value: UUID },
    });
    expect(screen.getByRole("button", { name: /webhookHealth\.resend$/ })).toBeEnabled();
  });

  it("spacje wokół identyfikatora nie blokują przycisku i NIE jadą do serwera", async () => {
    pokaz();
    fireEvent.change(screen.getByLabelText("webhookHealth.registrationId"), {
      target: { value: `   ${UUID}   ` },
    });
    const przycisk = screen.getByRole("button", { name: /webhookHealth\.resend$/ });
    expect(przycisk).toBeEnabled();
    fireEvent.click(przycisk);
    await waitFor(() => expect(h.resend).toHaveBeenCalledTimes(1));
    expect(h.resend).toHaveBeenCalledWith({ data: { registrationId: UUID } });
  });

  it("udana wysyłka melduje, KTÓRE kanały poszły", async () => {
    pokaz();
    fireEvent.change(screen.getByLabelText("webhookHealth.registrationId"), {
      target: { value: UUID },
    });
    fireEvent.click(screen.getByRole("button", { name: /webhookHealth\.resend$/ }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    const komunikat = h.toastSuccess.mock.calls[0][0] as string;
    expect(komunikat).toContain("webhookHealth.resendOk");
    expect(komunikat).toContain("✓");
    expect(komunikat).toContain("-");
  });

  it("nieudana wysyłka mówi TREŚCIĄ odmowy i nie melduje sukcesu", async () => {
    h.resend.mockRejectedValue(new Error("registration_not_found"));
    pokaz();
    fireEvent.change(screen.getByLabelText("webhookHealth.registrationId"), {
      target: { value: UUID },
    });
    fireEvent.click(screen.getByRole("button", { name: /webhookHealth\.resend$/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(h.toastError.mock.calls[0][0]).toContain("registration_not_found");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ponowna wysyłka NIE odpytuje pomiaru - to dwie rozłączne akcje", async () => {
    pokaz();
    fireEvent.change(screen.getByLabelText("webhookHealth.registrationId"), {
      target: { value: UUID },
    });
    fireEvent.click(screen.getByRole("button", { name: /webhookHealth\.resend$/ }));
    await waitFor(() => expect(h.resend).toHaveBeenCalledTimes(1));
    expect(h.fetchHealth).not.toHaveBeenCalled();
  });
});

describe("dostępność", () => {
  it("panel przed pomiarem nie ma naruszeń dostępności", async () => {
    const { container } = pokaz();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("panel z kompletem metryk i awarią nie ma naruszeń dostępności", async () => {
    h.fetchHealth.mockResolvedValue(
      zdrowie({
        failed: 6,
        failureRate: 0.06,
        recentFailures: [
          {
            id: "f-1",
            eventType: "invoice.payment_failed",
            error: "signature verification failed",
            occurredAt: "2026-08-29T12:34:56.000Z",
            retryCount: 3,
          },
        ],
      }),
    );
    const { container } = pokaz();
    await wczytaj();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
