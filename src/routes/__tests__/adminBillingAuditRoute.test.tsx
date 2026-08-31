// Trasa /admin/billing-audit - dziennik zamówień i zdarzeń operatora płatności
// plus eksport księgowy. Do dziś: 0 z 26 funkcji, 0 instrukcji.
//
// DLACZEGO TEN EKRAN MUSI BYĆ DOWIEDZIONY. To materiał, na którym księgowość
// zamyka miesiąc, a dyżurny odtwarza obsługę zdarzenia, które poległo. Cztery
// rzeczy, których złamania nie widać z zewnątrz:
//
//   1. ZAKRES PYTANIA JEST CZĘŚCIĄ ODPOWIEDZI. Środowisko, okno czasowe i
//      filtr wydarzenia decydują o tym, CO wchodzi do raportu i do eksportu.
//      Raport produkcyjny pobrany z parametrem piaskownicy to pusty plik
//      podpisany jako komplet.
//   2. FILTR WYDARZENIA JEST WALIDOWANY PO STRONIE KLIENTA (UUID) - wartość
//      niepełna NIE jedzie do serwera. Ta reguła istnieje, żeby schemat
//      `z.string().uuid()` nie odbijał operatora odmową w połowie wpisywania.
//   3. EKSPORT POWSTAJE Z BASE64 BEZ POŚREDNICTWA SIECI. Plik składa się w
//      przeglądarce; utrata typu MIME albo nazwy oznacza plik, którego arkusz
//      księgowy nie otworzy.
//   4. PONOWIENIE ZDARZENIA JEST OPERACJĄ NA PIENIĄDZACH. Wynik musi stanąć
//      przy SWOIM wierszu, a porażka musi być nazwana - cicha porażka to
//      dostęp, którego klient nadal nie ma.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: funkcje serwerowe (`audit.functions`,
// `webhookRetry.functions`, `webhookHealthApi`, `outcomeResend.functions`),
// odczyt środowiska operatora i powiadomienia. `WebhookHealthPanel` biegnie
// PRAWDZIWY - to sąsiad tej trasy, nie jej granica; podmieniony atrapą
// „dowodziłby", że panel dostaje parametry, których nikt nie sprawdza.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type {
  AuditExport,
  AuditOrderRow,
  AuditReport,
  AuditWebhookRow,
} from "@/lib/billing/audit.server";
import type { WebhookRetryResult } from "@/lib/billing/webhookRetry.functions";

const h = vi.hoisted(() => ({
  audit: vi.fn(),
  exportAudit: vi.fn(),
  retry: vi.fn(),
  health: vi.fn(),
  resend: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Granice serwerowe trasy. Rola `admin` jest weryfikowana po stronie serwera,
// więc test opisuje wyłącznie to, CO klient wysyła i JAK czyta odpowiedź.
vi.mock("@/lib/billing/audit.functions", () => ({
  getBillingAudit: (args: unknown) => h.audit(args),
  exportBillingAudit: (args: unknown) => h.exportAudit(args),
}));
vi.mock("@/lib/billing/webhookRetry.functions", () => ({
  retryWebhookEvent: (args: unknown) => h.retry(args),
}));
// Granice SĄSIADA (`WebhookHealthPanel`), nie sam sąsiad - komponent biegnie
// prawdziwy, żeby test widział parametry, które trasa mu podaje.
vi.mock("@/lib/billing/webhookHealthApi", () => ({
  fetchWebhookHealth: (environment: string, sinceHours: number) =>
    h.health(environment, sinceHours),
}));
vi.mock("@/lib/events/outcomeResend.functions", () => ({
  resendRegistrationNotifications: (args: unknown) => h.resend(args),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/stripe", () => ({
  getStripeEnvironmentSafe: () => "sandbox" as const,
  getStripeEnvironment: () => "sandbox" as const,
  isPaymentsConfigured: () => true,
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { moneyPattern } from "@/test/billing/fixtures";
import { Route as AuditRoute } from "@/routes/admin.billing-audit";

const PATH = "/admin/billing-audit";
const EVENT_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const WEBHOOK_ROW_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

function order(overrides: Partial<AuditOrderRow> = {}): AuditOrderRow {
  return {
    id: "order-1",
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:05:00.000Z",
    status: "paid",
    kind: "subscription",
    amountCents: 4900,
    refundedCents: 0,
    currency: "PLN",
    eventId: null,
    entityType: null,
    entityId: null,
    providerSessionId: "cs_test_1",
    providerPaymentIntentId: "pi_test_1",
    providerCustomerId: "cus_test_1",
    providerChargeId: null,
    ...overrides,
  };
}

function webhook(overrides: Partial<AuditWebhookRow> = {}): AuditWebhookRow {
  return {
    id: WEBHOOK_ROW_ID,
    eventId: "evt_1SyntetyczneZdarzenie",
    eventType: "checkout.session.completed",
    status: "failed",
    occurredAt: "2026-08-18T09:00:00.000Z",
    processedAt: null,
    durationMs: 240,
    retryCount: 1,
    error: "brak planu w katalogu",
    ...overrides,
  };
}

function report(overrides: Partial<AuditReport> = {}): AuditReport {
  const orders = overrides.orders ?? [order()];
  const webhooks = overrides.webhooks ?? [webhook()];
  return {
    environment: "sandbox",
    sinceIso: "2026-08-11T10:00:00.000Z",
    generatedAt: "2026-08-18T10:30:00.000Z",
    orders,
    webhooks,
    totals: {
      orders: orders.length,
      paidCents: 4900,
      refundedCents: 0,
      webhooksFailed: webhooks.filter((w) => w.status === "failed").length,
    },
    truncated: false,
    ...overrides,
  };
}

function exportFile(overrides: Partial<AuditExport> = {}): AuditExport {
  return {
    fileName: "audyt-sandbox-2026-08-18.csv",
    mimeType: "text/csv;charset=utf-8",
    // "order_id\n" w base64 - treść jest nieistotna, kształt granicy nie.
    base64: "b3JkZXJfaWQK",
    ...overrides,
  };
}

function retryResult(overrides: Partial<WebhookRetryResult> = {}): WebhookRetryResult {
  return {
    id: WEBHOOK_ROW_ID,
    eventType: "checkout.session.completed",
    status: "processed",
    durationMs: 180,
    retryCount: 2,
    error: null,
    ...overrides,
  };
}

async function mount() {
  return renderRoute({ route: AuditRoute, path: PATH, initialEntry: PATH });
}

/** Wczytanie raportu - pierwszy krok każdego przypadku tej trasy. */
async function load() {
  fireEvent.click(screen.getByRole("button", { name: "Wczytaj" }));
  await waitFor(() => expect(h.audit).toHaveBeenCalled());
}

/** Ostatni ładunek wysłany do funkcji serwerowej audytu. */
function lastAuditQuery(): Record<string, unknown> {
  const call = h.audit.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> };
  return call.data;
}

/**
 * Karta podsumowania po widocznej etykiecie. Zawężenie do `div` jest
 * konieczne: „Zamówienia" jest jednocześnie etykietą kafla i nazwą zakładki,
 * a zakładka to `button` - bez tego test trafiałby raz w kafel, raz w przycisk.
 */
function summaryCard(label: string): HTMLElement {
  return screen.getByText(label, { selector: "div" }).parentElement as HTMLElement;
}

// Pola formularza zakresu. Sąsiadujący panel zdrowia webhooków ma WŁASNE pole
// tekstowe i własny przycisk, więc każde wskazanie musi być jednoznaczne.
const auditEnv = () => screen.getByLabelText("Środowisko");
const auditWindow = () => screen.getByLabelText("Zakres (godziny)");
const auditEventFilter = () => screen.getByLabelText("Wydarzenie (UUID, opcjonalnie)");

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.audit.mockReset().mockResolvedValue(report());
  h.exportAudit.mockReset().mockResolvedValue(exportFile());
  h.retry.mockReset().mockResolvedValue(retryResult());
  // Sąsiadujący panel zdrowia webhooków ma własny przycisk wczytania - w tych
  // testach nikt go nie naciska, więc granica milczy.
  h.health.mockReset().mockResolvedValue(null);
  h.resend.mockReset();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /admin/billing-audit - sklejenie i nagłówek", () => {
  it("trzyma dziennik rozliczeń poza indeksem wyszukiwarek", async () => {
    // Wiersze niosą identyfikatory sesji, intencji płatności i klientów
    // operatora. Zaindeksowana strona panelu to wyciek materiału
    // rozliczeniowego do wyników wyszukiwania.
    const view = await mount();

    expect(view.currentPath()).toBe(PATH);
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(view.meta()).toContainEqual({ title: "Audyt rozliczeń - Panel" });
  });

  it("przed wczytaniem nie pokazuje ani podsumowania, ani tabel", async () => {
    // Panel bez raportu nie może udawać, że coś policzył - zero zamówień
    // wyświetlone przed zapytaniem czyta się jak „w tym oknie nic nie było".
    await mount();

    expect(screen.getByRole("heading", { name: "Audyt rozliczeń" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Zamówienia")).not.toBeInTheDocument();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("oddaje sąsiadującemu panelowi zdrowia TEN SAM zakres, który sam pyta", async () => {
    // Metryka zdrowia i dziennik opisują to samo zdarzenie. Gdyby panel
    // zdrowia dostawał inne środowisko niż tabela obok, dyżurny czytałby
    // dwie sprzeczne odpowiedzi na jedno pytanie i nie miałby jak ich pogodzić.
    await mount();

    fireEvent.change(auditEnv(), { target: { value: "live" } });
    fireEvent.change(auditWindow(), { target: { value: "24" } });

    // Panel zdrowia ma własny przycisk („Odśwież") - klikamy JEGO, nie
    // „Wczytaj", bo dowód dotyczy parametrów PRZEKAZANYCH sąsiadowi.
    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));

    await waitFor(() => expect(h.health).toHaveBeenCalledWith("live", 24));
  });

  it("nie zostawia panelu z wadami dostępności", async () => {
    const view = await mount();
    await load();
    await screen.findByRole("table");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /admin/billing-audit - zakres pytania", () => {
  it("domyślnie pyta o ostatnie 168 godzin środowiska testowego, bez filtra", async () => {
    // Tydzień to okno, w którym operator płatności jeszcze ponawia webhooki -
    // krótsze domyślne okno chowałoby zdarzenia, które same się dokończą.
    await mount();
    await load();

    expect(lastAuditQuery()).toEqual({ environment: "sandbox", sinceHours: 168, eventId: null });
  });

  it("przełączenie na produkcję zmienia środowisko pytania, a nie tylko etykietę", async () => {
    // Audyt produkcji pobrany z parametrem piaskownicy to pusty raport
    // podpisany jako komplet - dokładnie ten dokument trafia do księgowości.
    await mount();

    fireEvent.change(auditEnv(), { target: { value: "live" } });
    await load();

    expect(lastAuditQuery().environment).toBe("live");
  });

  it("okno czasowe nie schodzi poniżej godziny nawet przy pustym polu", async () => {
    // Schemat serwerowy to `min(1)`. Zero albo tekst w polu liczbowym dałoby
    // odmowę schematu zamiast raportu - błąd narzędzia w chwili diagnozy.
    await mount();

    fireEvent.change(auditWindow(), { target: { value: "0" } });
    await load();
    expect(lastAuditQuery().sinceHours).toBe(1);

    fireEvent.change(auditWindow(), { target: { value: "" } });
    await load();
    expect(lastAuditQuery().sinceHours).toBe(1);
  });

  it("poprawny UUID wydarzenia zawęża audyt do tego wydarzenia", async () => {
    // Filtr po wydarzeniu to główny tryb pracy przy reklamacji uczestnika:
    // „pokaż wszystkie zamówienia tej konferencji".
    await mount();

    fireEvent.change(auditEventFilter(), { target: { value: `  ${EVENT_UUID}  ` } });
    await load();

    // Spacje z wklejenia nie mogą unieważnić filtra - wklejanie identyfikatora
    // z arkusza to najczęstsza droga wejścia tej wartości.
    expect(lastAuditQuery().eventId).toBe(EVENT_UUID);
  });

  it("niepełny identyfikator wydarzenia nie jedzie do serwera", async () => {
    // Walidacja po stronie klienta istnieje po to, żeby schemat
    // `z.string().uuid()` nie odbijał operatora odmową w połowie wpisywania.
    await mount();

    fireEvent.change(auditEventFilter(), { target: { value: "3f2504e0-4f89" } });
    await load();

    expect(lastAuditQuery().eventId).toBeNull();
  });

  it("w trakcie wczytywania blokuje przycisk i mówi, że wczytuje", async () => {
    // Dwa równoległe wczytania to dwa raporty konkurujące o ten sam stan -
    // ten, który wróci drugi, nadpisze świeższy wynik.
    let release: (value: AuditReport) => void = () => {};
    h.audit.mockImplementation(
      () =>
        new Promise<AuditReport>((resolve) => {
          release = resolve;
        }),
    );
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Wczytaj" }));
    const pending = await screen.findByRole("button", { name: "Wczytywanie..." });
    expect(pending).toBeDisabled();

    release(report());
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("trasa /admin/billing-audit - podsumowanie zakresu", () => {
  it("liczy zamówienia, kwoty i nieudane zdarzenia z tego samego raportu", async () => {
    // Cztery kafle to jedyne miejsce, w którym dyżurny widzi skalę problemu
    // bez czytania tabeli. Rozjazd między kaflem a wierszami oznaczałby, że
    // panel liczy coś innego, niż pokazuje.
    h.audit.mockResolvedValue(
      report({
        orders: [order(), order({ id: "order-2", status: "refunded", refundedCents: 4900 })],
        totals: { orders: 2, paidCents: 4900, refundedCents: 4900, webhooksFailed: 1 },
      }),
    );
    await mount();
    await load();

    expect(within(summaryCard("Zamówienia")).getByText("2")).toBeInTheDocument();
    expect(within(summaryCard("Zaksięgowane")).getByText(moneyPattern(4900))).toBeInTheDocument();
    expect(within(summaryCard("Zwrócone")).getByText(moneyPattern(4900))).toBeInTheDocument();
    expect(within(summaryCard("Nieudane zdarzenia")).getByText("1")).toBeInTheDocument();
  });

  it("obcięty raport ostrzega, zamiast udawać komplet", async () => {
    // Raport przycięty limitem wierszy MOŻE przemilczeć zamówienie. Bez tego
    // ostrzeżenia trafiłby do księgowości jako zamknięty zakres.
    h.audit.mockResolvedValue(report({ truncated: true }));
    await mount();
    await load();

    expect(
      await screen.findByText("Zakres przekracza limit wierszy - zawęź okno czasowe."),
    ).toBeInTheDocument();
  });

  it("nieobcięty raport nie straszy ostrzeżeniem", async () => {
    await mount();
    await load();

    await screen.findByRole("table");
    expect(
      screen.queryByText("Zakres przekracza limit wierszy - zawęź okno czasowe."),
    ).not.toBeInTheDocument();
  });

  it("pusty zakres mówi wprost, że nic w nim nie było", async () => {
    // Dwie puste tabele bez zdania podsumowującego czytają się jak awaria
    // panelu, a nie jak odpowiedź „w tym oknie nie było ruchu".
    h.audit.mockResolvedValue(
      report({
        orders: [],
        webhooks: [],
        totals: { orders: 0, paidCents: 0, refundedCents: 0, webhooksFailed: 0 },
      }),
    );
    await mount();
    await load();

    expect(await screen.findByText("Brak danych w wybranym zakresie.")).toBeInTheDocument();
  });

  it("niepusty raport nie twierdzi, że jest pusty", async () => {
    await mount();
    await load();

    await screen.findByRole("table");
    expect(screen.queryByText("Brak danych w wybranym zakresie.")).not.toBeInTheDocument();
  });
});

describe("trasa /admin/billing-audit - dziennik zamówień", () => {
  it("pokazuje kwotę w walucie ZAMÓWIENIA, nie w walucie panelu", async () => {
    // Zamówienie w euro pokazane ze złotówkowym symbolem to fałszywy zapis
    // księgowy - kwota zgadza się co do cyfry, waluta nie.
    h.audit.mockResolvedValue(report({ orders: [order({ currency: "EUR", amountCents: 2475 })] }));
    await mount();
    await load();

    const row = (await screen.findByText("pi_test_1")).closest("tr") as HTMLElement;
    expect(within(row).getByText(/€|EUR/)).toBeInTheDocument();
    expect(row.textContent).not.toContain("zł");
  });

  it("brak kwoty to myślnik, a nie zero złotych", async () => {
    // Zamówienie bez kwoty (sesja porzucona przed wyceną) to brak danych.
    // Wyświetlone „0,00 zł" byłoby zdaniem o darmowym zamówieniu.
    h.audit.mockResolvedValue(
      report({ orders: [order({ amountCents: null, refundedCents: 0 })], webhooks: [] }),
    );
    await mount();
    await load();

    const row = (await screen.findByText("pi_test_1")).closest("tr") as HTMLElement;
    expect(within(row).getAllByText("-").length).toBeGreaterThan(0);
    expect(row.textContent).not.toMatch(/0[.,]00/);
  });

  it("zwrot pokazuje się tylko wtedy, gdy faktycznie był", async () => {
    // Kolumna zwrotu wypełniona zerem w każdym wierszu zabija czytelność
    // dziennika: oko przestaje odróżniać zwrot od jego braku.
    h.audit.mockResolvedValue(
      report({
        orders: [
          order(),
          order({ id: "order-2", providerPaymentIntentId: "pi_test_2", refundedCents: 1900 }),
        ],
        webhooks: [],
      }),
    );
    await mount();
    await load();

    const clean = (await screen.findByText("pi_test_1")).closest("tr") as HTMLElement;
    const refunded = screen.getByText("pi_test_2").closest("tr") as HTMLElement;
    expect(within(refunded).getByText(moneyPattern(1900))).toBeInTheDocument();
    expect(clean.textContent).not.toMatch(moneyPattern(1900));
  });

  it("gdy nie ma intencji płatności, pokazuje identyfikator sesji", async () => {
    // Sesja porzucona przed autoryzacją nie ma intencji. Pusta komórka
    // odbierałaby jedyny uchwyt do znalezienia tej płatności u operatora.
    h.audit.mockResolvedValue(
      report({ orders: [order({ providerPaymentIntentId: null })], webhooks: [] }),
    );
    await mount();
    await load();

    expect(await screen.findByText("cs_test_1")).toBeInTheDocument();
  });

  it("zamówienie bez żadnego identyfikatora operatora nie zostawia pustki", async () => {
    h.audit.mockResolvedValue(
      report({
        orders: [
          order({
            providerPaymentIntentId: null,
            providerSessionId: null,
            providerCustomerId: null,
          }),
        ],
        webhooks: [],
      }),
    );
    await mount();
    await load();

    const rows = await screen.findAllByRole("row");
    const dataRow = rows[rows.length - 1];
    expect(within(dataRow).getAllByText("-").length).toBeGreaterThanOrEqual(2);
  });

  it("brak znacznika czasu to myślnik, a nie data z dzisiaj", async () => {
    h.audit.mockResolvedValue(
      report({ orders: [order({ createdAt: null as never })], webhooks: [] }),
    );
    await mount();
    await load();

    const row = (await screen.findByText("pi_test_1")).closest("tr") as HTMLElement;
    expect(within(row).getAllByText("-").length).toBeGreaterThan(0);
  });
});

describe("trasa /admin/billing-audit - dziennik zdarzeń i ponowienie", () => {
  it("zakładka zdarzeń pokazuje typ, status, próby i czas obsługi", async () => {
    // Te cztery kolumny są całą diagnozą: co przyszło, czy przeszło, ile razy
    // próbowano i jak długo trwało.
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));

    const row = (await screen.findByText("checkout.session.completed")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("failed")).toBeInTheDocument();
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(within(row).getByText("240 ms")).toBeInTheDocument();
    expect(within(row).getByText("brak planu w katalogu")).toBeInTheDocument();
  });

  it("brak pomiaru czasu obsługi to myślnik, a nie zero milisekund", async () => {
    // „0 ms" byłoby zdaniem o błyskawicznej obsłudze, czyli nieprawdą o
    // zdarzeniu, którego nikt nie zmierzył.
    h.audit.mockResolvedValue(report({ webhooks: [webhook({ durationMs: null, error: null })] }));
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));

    const row = (await screen.findByText("checkout.session.completed")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getAllByText("-").length).toBeGreaterThan(0);
    expect(row.textContent).not.toContain("0 ms");
  });

  it("powrót na zakładkę zamówień nie gubi wczytanego raportu", async () => {
    // Zakładki dzielą JEDEN raport. Przeładowanie przy każdym przełączeniu
    // kosztowałoby zapytanie i - przy zmienionym oknie - dałoby dwie tabele
    // opisujące różne zakresy.
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    await screen.findByText("checkout.session.completed");
    fireEvent.click(screen.getByRole("button", { name: "Zamówienia" }));

    expect(await screen.findByText("pi_test_1")).toBeInTheDocument();
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("ponowienie jedzie z identyfikatorem WIERSZA dziennika, nie zdarzenia operatora", async () => {
    // Funkcja serwerowa czyta ładunek z NASZEJ bazy po kluczu wiersza -
    // wysłanie `evt_...` operatora dałoby odmowę schematu UUID i zostawiło
    // zdarzenie nieprzetworzone.
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ponów" }));

    await waitFor(() => expect(h.retry).toHaveBeenCalledWith({ data: { id: WEBHOOK_ROW_ID } }));
  });

  it("wynik ponowienia zastępuje treść błędu przy TYM wierszu", async () => {
    // Stary komunikat błędu obok świeżego „Ponowiono" to sprzeczna diagnoza.
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ponów" }));

    expect(await screen.findByText("Ponowiono: processed")).toBeInTheDocument();
    expect(screen.queryByText("brak planu w katalogu")).not.toBeInTheDocument();
  });

  it("nieudane ponowienie mówi, dlaczego się nie udało", async () => {
    // Cicha porażka to najgorszy wynik: dyżurny odchodzi od ekranu w
    // przekonaniu, że zdarzenie zostało odtworzone, a dostęp nadany.
    h.retry.mockRejectedValue(new Error("Zdarzenie nie istnieje."));
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ponów" }));

    expect(
      await screen.findByText("Ponowienie nie powiodło się: Zdarzenie nie istnieje."),
    ).toBeInTheDocument();
  });

  it("odrzucenie niebędące wyjątkiem też jest czytelne", async () => {
    // Granica funkcji serwerowych potrafi odrzucić obietnicę czymś, co nie
    // jest `Error`; bez tej gałęzi w wierszu stanęłaby zbitka obiektu.
    h.retry.mockRejectedValue("bramka nie odpowiada");
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ponów" }));

    expect(
      await screen.findByText("Ponowienie nie powiodło się: bramka nie odpowiada"),
    ).toBeInTheDocument();
  });

  it("ponawiany wiersz mówi, że trwa, a pozostałe są zablokowane", async () => {
    // Dwa równoległe ponowienia tego samego dziennika potrafią zostawić w
    // wierszu wynik STARSZEJ próby - obsługa jest idempotentna, zapis nie.
    h.audit.mockResolvedValue(
      report({
        webhooks: [
          webhook(),
          webhook({ id: "0c9d5a1e-1a1f-4b2c-9a01-2b3c4d5e6f70", eventType: "invoice.paid" }),
        ],
      }),
    );
    let release: (value: WebhookRetryResult) => void = () => {};
    h.retry.mockImplementation(
      () =>
        new Promise<WebhookRetryResult>((resolve) => {
          release = resolve;
        }),
    );
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    const buttons = await screen.findAllByRole("button", { name: "Ponów" });
    fireEvent.click(buttons[0]);

    expect(await screen.findByRole("button", { name: "Ponawianie..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ponów" })).toBeDisabled();

    release(retryResult());
    expect(await screen.findByText("Ponowiono: processed")).toBeInTheDocument();
  });

  it("ponowne wczytanie raportu kasuje wyniki poprzednich ponowień", async () => {
    // Wynik opisuje KONKRETNY przebieg. Przeniesiony na świeży raport
    // twierdziłby, że zdarzenie z nowego zakresu jest już odtworzone.
    await mount();
    await load();

    fireEvent.click(screen.getByRole("button", { name: "Zdarzenia webhooków" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ponów" }));
    await screen.findByText("Ponowiono: processed");

    await load();
    await waitFor(() => expect(screen.queryByText("Ponowiono: processed")).not.toBeInTheDocument());
  });
});

describe("trasa /admin/billing-audit - eksport księgowy", () => {
  /** Przechwytuje pobranie pliku: adres obiektu, nazwę i typ MIME. */
  function captureDownload() {
    const created: Blob[] = [];
    const anchors: { href: string; download: string }[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
      created.push(blob as Blob);
      return "blob:test-object-url";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push({ href: this.href, download: this.download });
    });
    return { created, anchors };
  }

  it("eksport CSV pyta o TEN SAM zakres co dziennik i pobiera plik z serwera", async () => {
    // Eksport rozjechany z ekranem to dokument, którego nikt nie potrafi
    // odtworzyć: księgowość dostaje inny zakres, niż widział dyżurny.
    const download = captureDownload();
    await mount();

    fireEvent.change(auditEnv(), { target: { value: "live" } });
    fireEvent.change(auditWindow(), { target: { value: "24" } });
    fireEvent.change(auditEventFilter(), { target: { value: EVENT_UUID } });
    fireEvent.click(screen.getByRole("button", { name: "Eksport CSV" }));

    await waitFor(() => expect(h.exportAudit).toHaveBeenCalledTimes(1));
    expect(h.exportAudit).toHaveBeenCalledWith({
      data: { environment: "live", sinceHours: 24, eventId: EVENT_UUID, format: "csv" },
    });

    await waitFor(() => expect(download.anchors).toHaveLength(1));
    expect(download.anchors[0].download).toBe("audyt-sandbox-2026-08-18.csv");
    expect(download.created[0].type).toBe("text/csv;charset=utf-8");
  });

  it("eksport XLSX idzie tym samym kanałem, tylko z innym formatem", async () => {
    const download = captureDownload();
    h.exportAudit.mockResolvedValue(
      exportFile({
        fileName: "audyt.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Eksport XLSX" }));

    await waitFor(() => expect(h.exportAudit).toHaveBeenCalledTimes(1));
    expect((h.exportAudit.mock.calls[0][0] as { data: { format: string } }).data.format).toBe(
      "xlsx",
    );
    await waitFor(() => expect(download.anchors[0].download).toBe("audyt.xlsx"));
  });

  it("plik składa się w przeglądarce z base64, bez żadnego wyjścia do sieci", async () => {
    // Treść eksportu nigdy nie przechodzi przez publiczny adres - to warunek
    // tego, żeby identyfikatory operatora nie wyciekły poza sesję admina.
    const download = captureDownload();
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Eksport CSV" }));

    await waitFor(() => expect(download.created).toHaveLength(1));
    expect(await download.created[0].text()).toBe("order_id\n");
    expect(download.anchors[0].href).toContain("blob:");
  });

  it("eksport nie wczytuje dziennika przy okazji", async () => {
    // Eksport i podgląd to dwa niezależne zapytania. Ukryte doładowanie
    // dziennika przy eksporcie podwajałoby koszt najcięższego zapytania panelu.
    captureDownload();
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Eksport CSV" }));

    await waitFor(() => expect(h.exportAudit).toHaveBeenCalled());
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe("trasa /admin/billing-audit - defekty NAPRAWIONE", () => {
  // Wszystkie cztery przypadki w tym bloku były wcześniej `it.fails`: opisywały
  // defekt, którego wtedy nie naprawiano. Zachowanie produkcyjne zostało
  // zmienione świadomie (dołożenie komunikatów awarii, przycięcie okna od góry,
  // rozbicie sum po walutach), więc znacznik `it.fails` zdjęto, a komentarze
  // opisują teraz, CO było złe i JAK zostało naprawione.
  //
  // Rozbicie sum NIE wymagało zmiany `audit.server.ts`: `AuditReport.totals`
  // jest redukcją tablicy `report.orders`, którą klient i tak dostaje, więc
  // kafel liczy per waluta z tego samego materiału, z którego serwer liczy
  // sumę zbiorczą.

  it("nieudane wczytanie audytu mówi operatorowi, CO padło", async () => {
    // CO BYŁO ZŁE. Mutacja `load` nie miała `onError` i nigdzie nie czytała
    // `load.isError`. Odmowa serwera (brak roli `admin`, awaria bazy, odrzucony
    // schemat) kończyła się dokładnie tym samym ekranem, co przed kliknięciem:
    // bez raportu, bez komunikatu, z odblokowanym przyciskiem.
    //
    // DLACZEGO TO BYŁO RYZYKO. Bliźniaczy panel /admin/billing-reconcile w tej
    // samej sekcji POKAZUJE `scan.isError` - operator uczył się więc, że brak
    // komunikatu znaczy „zapytanie przeszło". Tutaj brak komunikatu znaczył
    // „zapytanie padło", a ekran wyglądał jak pusty zakres. Skutek był
    // konkretny: zgłoszenie reklamacyjne zamykane wnioskiem „w tym oknie nie
    // ma zamówienia", podczas gdy audyt w ogóle się nie wykonał.
    //
    // JAK NAPRAWIONE: `load.isError` renderuje komunikat `role="alert"`
    // z kluczem `adminBillingAudit.loadFailed` i POWODEM z granicy serwerowej.
    h.audit.mockRejectedValue(new Error("brak uprawnień administratora"));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Wczytaj" }));
    await waitFor(() => expect(h.audit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Wczytaj" })).toBeEnabled());

    expect(document.body.textContent).toContain("brak uprawnień administratora");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("nieudany eksport księgowy kończy się komunikatem, nie ciszą", async () => {
    // CO BYŁO ZŁE. Mutacja `exportFile` też nie miała `onError`. Gdy funkcja
    // serwerowa odrzuciła obietnicę, plik się nie pobierał, przycisk wracał do
    // stanu wyjściowego i NIC się nie zmieniało na ekranie. Osobno: słownik miał
    // parę kluczy `adminBillingAudit.exporting` („Przygotowuję plik..." /
    // „Preparing file..."), której komponent nigdy nie używał - etykieta
    // przycisku nie zmieniała się nawet w trakcie udanego eksportu.
    //
    // DLACZEGO TO BYŁO RYZYKO. Eksport jest ostatnim krokiem zamknięcia
    // miesiąca. Cisza po kliknięciu czytała się jak „przeglądarka zablokowała
    // pobieranie", więc księgowość klikała kolejny raz, a potem raportowała brak
    // pliku zamiast realnego powodu (odmowa roli, zakres, awaria generatora).
    //
    // JAK NAPRAWIONE: `exportFile.isError` renderuje komunikat `role="alert"`
    // z kluczem `adminBillingAudit.exportFailed`, a martwy klucz `exporting`
    // jest wreszcie etykietą przycisku, który właśnie składa plik.
    h.exportAudit.mockRejectedValue(new Error("eksport odrzucony przez serwer"));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Eksport CSV" }));
    await waitFor(() => expect(h.exportAudit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Eksport CSV" })).toBeEnabled());

    expect(document.body.textContent).toContain("eksport odrzucony przez serwer");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("suma zaksięgowanych rozbija się po walutach, zamiast podpisywać je jedną", async () => {
    // CO BYŁO ZŁE. Kafle podsumowania wołały `money(report.totals.paidCents,
    // null)`, a `money` dla waluty `null` przyjmuje PLN. Sam raport
    // (`audit.server.ts`) sumuje `amountCents` po WSZYSTKICH zamówieniach
    // zakresu, nie grupując po walucie. Zakres z zamówieniem 49,00 PLN i
    // 24,75 EUR dawał więc jedną liczbę 73,75 podpisaną „zł".
    //
    // DLACZEGO TO BYŁO RYZYKO. To nie była usterka kosmetyczna, tylko fałszywy
    // zapis księgowy w miejscu, z którego bierze się kwoty do zamknięcia
    // miesiąca. Kolumna kwoty w TABELI robiła to poprawnie (waluta wiersza),
    // więc kafel i wiersze mówiły różne rzeczy o tym samym zakresie - a kafel
    // jest czytany pierwszy i bez tabeli.
    //
    // JAK NAPRAWIONE, BEZ RUSZANIA KONTRAKTU SERWERA. `AuditReport.totals` jest
    // redukcją tablicy `report.orders` (ten sam, przycięty limitem materiał),
    // którą klient i tak dostaje - kafel grupuje ją po `currency` i pokazuje
    // jedną kwotę na walutę. Panel formatuje kwoty KODEM waluty (PLN/EUR),
    // bo symbol zależy od locale i wersji ICU, a arkusz księgowy nazywa waluty
    // kodem. Eksport CSV/XLSX niesie kolumnę `currency` per wiersz, więc jego
    // kontrakt nie wymagał zmiany.
    h.audit.mockResolvedValue(
      report({
        orders: [
          order(),
          order({
            id: "order-eur",
            currency: "EUR",
            amountCents: 2475,
            providerPaymentIntentId: "pi_eur",
          }),
        ],
        totals: { orders: 2, paidCents: 7375, refundedCents: 0, webhooksFailed: 0 },
      }),
    );
    await mount();
    await load();

    await screen.findByRole("table");
    const zaksiegowane = summaryCard("Zaksięgowane").textContent ?? "";
    // Żadnej waluty narzuconej mieszance - obie kwoty stoją ze swoim kodem.
    expect(zaksiegowane).not.toContain("zł");
    expect(zaksiegowane).toMatch(moneyPattern(4900));
    expect(zaksiegowane).toMatch(moneyPattern(2475));
    expect(zaksiegowane).toContain("PLN");
    expect(zaksiegowane).toContain("EUR");
    // I żadnego zlepka 73,75, który nie jest kwotą w żadnej walucie.
    expect(zaksiegowane).not.toMatch(moneyPattern(7375));
  });

  it("okno ponad zadeklarowane maksimum nie wychodzi już do serwera", async () => {
    // CO BYŁO ZŁE. Pole ma `max={8760}`, a funkcja serwerowa `max(8760)` w
    // schemacie - ale handler `onChange` przycinał wyłącznie DÓŁ zakresu
    // (`Math.max(1, ...)`). Atrybut `max` w polu liczbowym nie blokuje
    // wpisania większej wartości, więc 99999 jechało do serwera i odbijało się
    // od schematu. Bliźniaczy panel uzgadniania robi to poprawnie:
    // `Math.min(720, Math.max(1, ...))`.
    //
    // DLACZEGO TO BYŁO RYZYKO. Odbicie od schematu było NIEWIDOCZNE (patrz
    // pierwszy przypadek w tym bloku), więc operator, który wpisał zbyt duże
    // okno, dostawał pusty ekran bez żadnego wyjaśnienia i nie miał jak zgadnąć,
    // że winna jest liczba w polu obok.
    //
    // JAK NAPRAWIONE: `onChange` przycina OBIE strony zakresu do
    // `MAX_WINDOW_HOURS`, czyli do maksimum ze schematu funkcji serwerowej -
    // a pole od razu pokazuje przyciętą wartość.
    await mount();

    fireEvent.change(auditWindow(), { target: { value: "99999" } });
    await load();

    expect(lastAuditQuery().sinceHours).toBeLessThanOrEqual(8760);
    // Operator widzi, co poszło do serwera - pole nie zostaje z 99999.
    expect(auditWindow()).toHaveValue(8760);
  });
});

describe("trasa /admin/billing-audit - dwujęzyczność panelu", () => {
  it("po angielsku mówi po angielsku, łącznie z wynikiem ponowienia", async () => {
    // Panel obsługuje anglojęzycznego administratora tenanta - brak pary
    // PL/EN w kluczach `adminBillingAudit.*` pokazałby tu surowy klucz.
    await i18n.changeLanguage("en");
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(h.audit).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: "Billing audit" })).toBeInTheDocument();
    expect(await screen.findByText("Settled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Webhook events" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Retried: processed")).toBeInTheDocument();
  });
});
