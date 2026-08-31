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

describe("trasa /admin/billing-audit - defekty udokumentowane, nie naprawiane", () => {
  // Wszystkie cztery przypadki w tym bloku PADAJĄ na asercji docelowej i są
  // oznaczone `it.fails`. Każdy uruchomiono najpierw jako zwykły `it` i
  // potwierdzono, że pada dokładnie na tej asercji, o której mówi komentarz -
  // czyli że opisuje defekt, a nie własną pomyłkę.
  //
  // DLACZEGO NIE NAPRAWIAM. Zakres tej pracy to dopisanie testów jednostkowych
  // do pięciu tras modułu 13. Zmiana zachowania panelu rozliczeń (dołożenie
  // komunikatów błędu, przycięcie okna, rozbicie sum po walutach) to zmiana
  // produkcyjna z własnym uzasadnieniem i własną recenzją - a przy sumach
  // walutowych także zmiana po stronie `audit.server.ts`, poza tym zakresem.
  // Test zostaje jako wykonywalny opis defektu: gdy ktoś go naprawi, `it.fails`
  // zacznie oblewać i zmusi do zdjęcia tego znacznika.

  it.fails("nieudane wczytanie audytu nie mówi operatorowi ANI SŁOWA", async () => {
    // CO JEST ZŁE. Mutacja `load` nie ma `onError` i nigdzie nie czyta
    // `load.isError`. Odmowa serwera (brak roli `admin`, awaria bazy, odrzucony
    // schemat) kończy się dokładnie tym samym ekranem, co przed kliknięciem:
    // bez raportu, bez komunikatu, z odblokowanym przyciskiem.
    //
    // DLACZEGO TO RYZYKO. Bliźniaczy panel /admin/billing-reconcile w tej samej
    // sekcji POKAZUJE `scan.isError` - operator uczy się więc, że brak
    // komunikatu znaczy „zapytanie przeszło". Tutaj brak komunikatu znaczy
    // „zapytanie padło", a ekran wygląda jak pusty zakres. Skutek jest
    // konkretny: zgłoszenie reklamacyjne zamykane wnioskiem „w tym oknie nie
    // ma zamówienia", podczas gdy audyt w ogóle się nie wykonał.
    //
    // ASERCJA DOCELOWA: komunikat awarii widoczny na ekranie.
    h.audit.mockRejectedValue(new Error("brak uprawnień administratora"));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Wczytaj" }));
    await waitFor(() => expect(h.audit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Wczytaj" })).toBeEnabled());

    expect(document.body.textContent).toContain("brak uprawnień administratora");
  });

  it.fails("nieudany eksport księgowy kończy się ciszą zamiast komunikatem", async () => {
    // CO JEST ZŁE. Mutacja `exportFile` też nie ma `onError`. Gdy funkcja
    // serwerowa odrzuci obietnicę, plik się nie pobiera, przycisk wraca do
    // stanu wyjściowego i NIC się nie zmienia na ekranie. Osobno: słownik ma
    // parę kluczy `adminBillingAudit.exporting` („Przygotowuję plik..." /
    // „Preparing file..."), której komponent nigdy nie używa - etykieta
    // przycisku nie zmienia się nawet w trakcie udanego eksportu.
    //
    // DLACZEGO TO RYZYKO. Eksport jest ostatnim krokiem zamknięcia miesiąca.
    // Cisza po kliknięciu czyta się jak „przeglądarka zablokowała pobieranie",
    // więc księgowość klika kolejny raz, a potem raportuje brak pliku zamiast
    // realnego powodu (odmowa roli, przekroczony zakres, awaria generatora).
    //
    // ASERCJA DOCELOWA: komunikat awarii widoczny na ekranie.
    h.exportAudit.mockRejectedValue(new Error("eksport odrzucony przez serwer"));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Eksport CSV" }));
    await waitFor(() => expect(h.exportAudit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Eksport CSV" })).toBeEnabled());

    expect(document.body.textContent).toContain("eksport odrzucony przez serwer");
  });

  it.fails("suma zaksięgowanych podpisuje mieszankę walut złotówkami", async () => {
    // CO JEST ZŁE. Kafle podsumowania wołają `money(report.totals.paidCents,
    // null)`, a `money` dla waluty `null` przyjmuje PLN. Sam raport
    // (`audit.server.ts`) sumuje `amountCents` po WSZYSTKICH zamówieniach
    // zakresu, nie grupując po walucie. Zakres z zamówieniem 49,00 PLN i
    // 24,75 EUR daje więc jedną liczbę 73,75 podpisaną „zł".
    //
    // DLACZEGO TO RYZYKO. To nie jest usterka kosmetyczna, tylko fałszywy
    // zapis księgowy w miejscu, z którego bierze się kwoty do zamknięcia
    // miesiąca. Kolumna kwoty w TABELI robi to poprawnie (waluta wiersza), więc
    // kafel i wiersze mówią różne rzeczy o tym samym zakresie - a kafel jest
    // czytany pierwszy i bez tabeli.
    //
    // DLACZEGO NIE NAPRAWIAM TUTAJ. Uczciwa poprawka to rozbicie sum po
    // walutach w `AuditReport.totals`, czyli zmiana kontraktu funkcji
    // serwerowej, eksportu CSV/XLSX i tego widoku naraz.
    //
    // ASERCJA DOCELOWA: kafel sumy nie podpisuje mieszanki walut złotówkami.
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
    expect(summaryCard("Zaksięgowane").textContent).not.toContain("zł");
  });

  it.fails("okno ponad zadeklarowane maksimum i tak wychodzi do serwera", async () => {
    // CO JEST ZŁE. Pole ma `max={8760}`, a funkcja serwerowa `max(8760)` w
    // schemacie - ale handler `onChange` przycina wyłącznie DÓŁ zakresu
    // (`Math.max(1, ...)`). Atrybut `max` w polu liczbowym nie blokuje
    // wpisania większej wartości, więc 99999 jedzie do serwera i odbija się
    // od schematu. Bliźniaczy panel uzgadniania robi to poprawnie:
    // `Math.min(720, Math.max(1, ...))`.
    //
    // DLACZEGO TO RYZYKO. Odbicie od schematu jest tu NIEWIDOCZNE (patrz
    // pierwszy `it.fails` w tym bloku), więc operator, który wpisał zbyt duże
    // okno, dostaje pusty ekran bez żadnego wyjaśnienia i nie ma jak zgadnąć,
    // że winna jest liczba w polu obok.
    //
    // ASERCJA DOCELOWA: zapytanie nie przekracza maksimum przyjmowanego przez
    // funkcję serwerową.
    await mount();

    fireEvent.change(auditWindow(), { target: { value: "99999" } });
    await load();

    expect(lastAuditQuery().sinceHours).toBeLessThanOrEqual(8760);
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
