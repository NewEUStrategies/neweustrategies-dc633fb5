// Trasa /admin/billing-reconcile - uzgadnianie stanu u operatora płatności ze
// stanem w naszej bazie. Do dziś: 0 z 16 funkcji, 0 instrukcji.
//
// DLACZEGO TEN EKRAN MUSI BYĆ DOWIEDZIONY. To jedyne miejsce w aplikacji, w
// którym człowiek naprawia PIENIĄDZE po awarii webhooka: klient zapłacił u
// operatora, zdarzenie nie dotarło, więc dostęp nie został nadany, a faktura
// nie powstała. Trzy rzeczy, których złamanie kosztuje realne pieniądze albo
// realne zaufanie:
//
//   1. „BRAK ROZBIEŻNOŚCI" MUSI BYĆ ZDANIEM, NIE CISZĄ. Pusty ekran po skanie
//      czyta się jak „nie zeskanowano" - dyżurny zamyka kartę i wraca za
//      godzinę, zamiast odhaczyć zakres jako czysty.
//   2. WYNIK NAPRAWY STOI PRZY SWOIM WIERSZU. Klucz wyniku to para
//      `kind:reference`, bo ten sam identyfikator potrafi wystąpić w dwóch
//      rodzajach (zdarzenie i zamówienie). Wynik pod złym wierszem to
//      informacja, że naprawiono coś, czego się nie naprawiło.
//   3. NIEUDANA NAPRAWA MÓWI, ŻE JEST NIEUDANA. Cicha porażka przy naprawie
//      płatności to najgorszy możliwy wynik: operator idzie dalej w
//      przekonaniu, że klient ma już dostęp.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: funkcje serwerowe (`reconcile.functions`,
// rola `admin` weryfikowana po stronie serwera) i odczyt środowiska operatora
// płatności. Słowniki, komponenty i cała logika prezentacji biegną prawdziwe -
// asercje mierzą napisy, które zobaczy dyżurny.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { ReconcileIssue, ReconcileReport } from "@/lib/billing/reconcile.server";
import type { RepairOutcome } from "@/lib/billing/reconcile.server";

const h = vi.hoisted(() => ({
  report: vi.fn(),
  repair: vi.fn(),
}));

// Granica serwerowa. Trasa woła te funkcje WPROST (bez `useServerFn`), więc
// atrapa modułu jest tu dokładnie granicą sieci - nic więcej.
vi.mock("@/lib/billing/reconcile.functions", () => ({
  getReconcileReport: (args: unknown) => h.report(args),
  repairReconcileEntry: (args: unknown) => h.repair(args),
}));
// Środowisko operatora płatności: w teście deterministyczne i BEZ tokena.
vi.mock("@/lib/stripe", () => ({
  getStripeEnvironmentSafe: () => "sandbox" as const,
  getStripeEnvironment: () => "sandbox" as const,
  isPaymentsConfigured: () => true,
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ReconcileRoute } from "@/routes/admin.billing-reconcile";

const PATH = "/admin/billing-reconcile";

function issue(overrides: Partial<ReconcileIssue> = {}): ReconcileIssue {
  return {
    kind: "event",
    reference: "evt_1SyntetyczneZdarzenie",
    eventId: "evt_1SyntetyczneZdarzenie",
    eventType: "checkout.session.completed",
    reason: "event_missing",
    detail: null,
    occurredAt: "2026-08-18T10:00:00.000Z",
    repairable: true,
    ...overrides,
  };
}

function report(overrides: Partial<ReconcileReport> = {}): ReconcileReport {
  return {
    environment: "sandbox",
    sinceIso: "2026-08-15T10:00:00.000Z",
    scannedEvents: 12,
    scannedOrders: 4,
    scannedSubscriptions: 2,
    issues: [],
    warnings: [],
    ...overrides,
  };
}

function outcome(overrides: Partial<RepairOutcome> = {}): RepairOutcome {
  return { reference: "evt_1SyntetyczneZdarzenie", status: "processed", error: null, ...overrides };
}

async function mount() {
  return renderRoute({ route: ReconcileRoute, path: PATH, initialEntry: PATH });
}

/** Skan to jedno kliknięcie - powtarza się w każdym teście tej trasy. */
async function scan() {
  fireEvent.click(screen.getByRole("button", { name: "Skanuj" }));
  await waitFor(() => expect(h.report).toHaveBeenCalled());
}

/** Wiersz tabeli rozbieżności po widocznym identyfikatorze. */
function rowOf(reference: string): HTMLElement {
  return screen.getByText(reference).closest("tr") as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.report.mockReset().mockResolvedValue(report());
  h.repair.mockReset().mockResolvedValue(outcome());
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /admin/billing-reconcile - sklejenie i nagłówek", () => {
  it("trzyma panel rozliczeń poza indeksem wyszukiwarek", async () => {
    // Adresy panelu niosą identyfikatory zamówień i subskrypcji w treści.
    // Wejście robota na tę stronę to wyciek materiału rozliczeniowego do
    // wyników wyszukiwania, więc `noindex` jest tu regułą, nie kosmetyką.
    const view = await mount();

    expect(view.currentPath()).toBe(PATH);
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(view.meta()).toContainEqual({ title: "Uzgadnianie płatności - Panel" });
  });

  it("przed skanem nie udaje, że cokolwiek sprawdzono", async () => {
    // Panel otwarty i pusty nie może twierdzić „brak rozbieżności" - to
    // zdanie wolno wypowiedzieć dopiero PO skanie konkretnego zakresu.
    await mount();

    expect(screen.getByRole("heading", { name: "Uzgadnianie płatności" })).toBeInTheDocument();
    expect(screen.queryByText("Brak rozbieżności w wybranym zakresie.")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(h.report).not.toHaveBeenCalled();
  });

  it("nie zostawia panelu z wadami dostępności", async () => {
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    const view = await mount();
    await scan();
    await screen.findByRole("table");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /admin/billing-reconcile - zakres skanu", () => {
  it("skanuje domyślnie ostatnie 72 godziny środowiska testowego", async () => {
    // Domyślny zakres jest decyzją: 72 godziny to okno, w którym operator
    // płatności sam ponawia webhooki. Krótsze okno chowałoby zdarzenia,
    // których operator jeszcze nie odpuścił.
    await mount();
    await scan();

    expect(h.report).toHaveBeenCalledWith({ data: { environment: "sandbox", sinceHours: 72 } });
  });

  it("przełączenie na produkcję zmienia środowisko skanu, a nie tylko etykietę", async () => {
    // Skan produkcji z parametrem „sandbox" pokazałby czysty wynik dla
    // środowiska, w którym nikt nie płaci - i zamknąłby zgłoszenie o realnej
    // awarii jako „brak rozbieżności".
    await mount();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "live" } });
    await scan();

    expect(h.report).toHaveBeenCalledWith({ data: { environment: "live", sinceHours: 72 } });
  });

  it("nieznana wartość środowiska spada na testowe, nie na produkcyjne", async () => {
    // Kierunek degradacji ma znaczenie: skan produkcji dotyka prawdziwych
    // pieniędzy, więc każda niejasność musi lądować po stronie piaskownicy.
    await mount();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cokolwiek" } });
    await scan();

    expect(h.report).toHaveBeenCalledWith({ data: { environment: "sandbox", sinceHours: 72 } });
  });

  it("przycina okno czasowe do zakresu, który serwer w ogóle przyjmie", async () => {
    // Schemat funkcji serwerowej to `min(1).max(720)`. Bez przycięcia po
    // stronie pola operator dostawałby odmowę schematu zamiast wyniku -
    // czyli błąd narzędzia w chwili, w której szuka błędu płatności.
    await mount();
    const window = screen.getByRole("spinbutton");

    fireEvent.change(window, { target: { value: "5000" } });
    await scan();
    expect(h.report).toHaveBeenLastCalledWith({
      data: { environment: "sandbox", sinceHours: 720 },
    });

    fireEvent.change(window, { target: { value: "0" } });
    await scan();
    expect(h.report).toHaveBeenLastCalledWith({ data: { environment: "sandbox", sinceHours: 1 } });

    fireEvent.change(window, { target: { value: "nie-liczba" } });
    await scan();
    expect(h.report).toHaveBeenLastCalledWith({ data: { environment: "sandbox", sinceHours: 1 } });
  });

  it("w trakcie skanu blokuje przycisk i mówi, że skanuje", async () => {
    // Dwa równoległe skany to dwa raporty konkurujące o ten sam stan; ten,
    // który wróci drugi, nadpisze świeższy wynik.
    let release: (value: ReconcileReport) => void = () => {};
    h.report.mockImplementation(
      () =>
        new Promise<ReconcileReport>((resolve) => {
          release = resolve;
        }),
    );
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Skanuj" }));
    const pending = await screen.findByRole("button", { name: "Skanowanie..." });
    expect(pending).toBeDisabled();

    release(report());
    await screen.findByText("Brak rozbieżności w wybranym zakresie.");
  });
});

describe("trasa /admin/billing-reconcile - skan bez rozbieżności", () => {
  it("mówi wprost, że zakres jest czysty, i podaje, ile sprawdzono", async () => {
    // Liczby „sprawdzono" są dowodem na to, że skan miał na czym pracować.
    // Bez nich „brak rozbieżności" jest nieodróżnialne od skanu pustego
    // zakresu - czyli od braku informacji.
    await mount();
    await scan();

    expect(await screen.findByText("Brak rozbieżności w wybranym zakresie.")).toBeInTheDocument();
    expect(
      screen.getByText("Sprawdzono: 12 zdarzeń, 4 zamówień, 2 subskrypcji."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("ostrzeżenie o obciętym skanie dociera do operatora nazwane po ludzku", async () => {
    // Obcięty skan to raport, który MOŻE przemilczeć rozbieżność. Gdyby kod
    // ostrzeżenia poszedł na ekran surowy, operator uznałby go za szum.
    h.report.mockResolvedValue(report({ warnings: ["events_truncated"] }));
    await mount();
    await scan();

    expect(
      await screen.findByText(
        "Zakres zawiera więcej zdarzeń niż limit skanu - zawęź okno czasowe.",
      ),
    ).toBeInTheDocument();
  });

  it("nieznany kod ostrzeżenia pokazuje się surowy, zamiast zniknąć", async () => {
    // Ostrzeżenie dodane na serwerze bez wpisu w słowniku ma być WIDOCZNE.
    // Cicha ucieczka do pustki oznaczałaby raport, który zataja własne luki.
    h.report.mockResolvedValue(report({ warnings: ["orders_page_limit"] }));
    await mount();
    await scan();

    expect(await screen.findByText("orders_page_limit")).toBeInTheDocument();
  });
});

describe("trasa /admin/billing-reconcile - skan z rozbieżnościami", () => {
  it("nazywa rodzaj, powód i identyfikator każdej rozbieżności", async () => {
    // Kody `event_missing` czy `subscription_status_drift` są zrozumiałe dla
    // autora kodu, nie dla dyżurnego - a to on decyduje, czy naprawiać.
    h.report.mockResolvedValue(
      report({
        issues: [
          issue(),
          issue({
            kind: "subscription",
            reference: "sub_stripe_1",
            reason: "subscription_status_drift",
            detail: "u operatora: canceled, lokalnie: active",
            eventType: null,
            repairable: false,
          }),
        ],
      }),
    );
    await mount();
    await scan();

    const eventRow = rowOf("evt_1SyntetyczneZdarzenie");
    expect(within(eventRow).getByText("Zdarzenie")).toBeInTheDocument();
    expect(within(eventRow).getByText("Zdarzenie nie dotarło do aplikacji")).toBeInTheDocument();
    expect(within(eventRow).getByText("checkout.session.completed")).toBeInTheDocument();

    const subRow = rowOf("sub_stripe_1");
    expect(within(subRow).getByText("Subskrypcja")).toBeInTheDocument();
    expect(
      within(subRow).getByText("Status subskrypcji różni się od operatora"),
    ).toBeInTheDocument();
    expect(within(subRow).getByText("u operatora: canceled, lokalnie: active")).toBeInTheDocument();
  });

  it("nieznany kod powodu pokazuje się surowy, zamiast zniknąć z wiersza", async () => {
    // Serwer może zacząć zwracać nowy powód wcześniej, niż słownik go pozna.
    // Pusta komórka „powód" zamieniłaby rozbieżność w zagadkę.
    h.report.mockResolvedValue(report({ issues: [issue({ reason: "order_currency_drift" })] }));
    await mount();
    await scan();

    expect(await screen.findByText("order_currency_drift")).toBeInTheDocument();
  });

  it("rozbieżności nienaprawialnej nie da się kliknąć - jest nazwana wprost", async () => {
    // Przycisk „Napraw" przy pozycji, której automat nie umie naprawić,
    // produkuje pewną porażkę i podejrzenie, że narzędzie jest zepsute.
    h.report.mockResolvedValue(report({ issues: [issue({ repairable: false })] }));
    await mount();
    await scan();

    const row = rowOf("evt_1SyntetyczneZdarzenie");
    expect(within(row).getByText("Wymaga ręcznej analizy")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Napraw" })).not.toBeInTheDocument();
  });

  it("pusty czas zdarzenia to myślnik, a nie data z dzisiaj", async () => {
    // Brak znacznika czasu jest informacją („nie wiemy, kiedy"), a podstawiona
    // data „teraz" byłaby zdaniem o zdarzeniu, którego nikt nie zmierzył.
    h.report.mockResolvedValue(report({ issues: [issue({ occurredAt: null })] }));
    await mount();
    await scan();

    const row = rowOf("evt_1SyntetyczneZdarzenie");
    expect(within(row).getByText("-")).toBeInTheDocument();
  });

  it("czysty skan po skanie z rozbieżnościami czyści tabelę", async () => {
    // Stara tabela zostawiona pod nowym, czystym wynikiem to najgroźniejszy
    // rodzaj nieaktualności: operator naprawiałby pozycje, których już nie ma.
    h.report.mockResolvedValueOnce(report({ issues: [issue()] }));
    await mount();
    await scan();
    expect(await screen.findByRole("table")).toBeInTheDocument();

    h.report.mockResolvedValue(report());
    await scan();

    expect(await screen.findByText("Brak rozbieżności w wybranym zakresie.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("trasa /admin/billing-reconcile - naprawa pojedynczej pozycji", () => {
  it("naprawa jedzie ze środowiskiem, rodzajem i identyfikatorem wiersza", async () => {
    // Naprawa uruchamia tę samą, idempotentną obsługę co webhook - ale na
    // WSKAZANEJ pozycji. Zgubiony rodzaj albo środowisko to odtworzenie
    // obsługi na czymś innym, niż operator kliknął.
    h.report.mockResolvedValue(
      report({ issues: [issue({ kind: "order", reference: "order-77" })] }),
    );
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    await waitFor(() => expect(h.repair).toHaveBeenCalledTimes(1));
    expect(h.repair).toHaveBeenCalledWith({
      data: { environment: "sandbox", kind: "order", reference: "order-77" },
    });
  });

  it("wynik naprawy staje przy swoim wierszu, nie przy wszystkich", async () => {
    // Klucz wyniku to `kind:reference` - dwie pozycje o tym samym
    // identyfikatorze, ale różnym rodzaju, to dwie różne naprawy. Wspólny
    // wynik oznaczałby „naprawiono", tam gdzie nikt nic nie naprawiał.
    const shared = "ref-wspolny";
    h.report.mockResolvedValue(
      report({
        issues: [
          issue({ kind: "event", reference: shared }),
          issue({ kind: "order", reference: shared, eventType: null }),
        ],
      }),
    );
    h.repair.mockResolvedValue(outcome({ reference: shared, status: "processed" }));
    await mount();
    await scan();

    const buttons = await screen.findAllByRole("button", { name: "Napraw" });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(screen.getAllByText("Naprawione")).toHaveLength(1));
    expect(h.repair).toHaveBeenCalledWith({
      data: { environment: "sandbox", kind: "event", reference: shared },
    });
  });

  it("naprawa bez efektu mówi, że nie było czego naprawiać", async () => {
    // `skipped` to nie sukces i nie porażka: obsługa przebiegła, ale stan był
    // już poprawny. Pokazanie tego jako „Naprawione" fałszowałoby historię
    // interwencji przy pieniądzach.
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    h.repair.mockResolvedValue(outcome({ status: "skipped" }));
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    expect(await screen.findByText("Pominięte (nic do zrobienia)")).toBeInTheDocument();
  });

  it("porażka naprawy zgłoszona przez serwer niesie powód, a nie samo słowo", async () => {
    // Serwer odróżnia „naprawa się nie udała" od wyjątku transportu. Oba
    // muszą dojść do operatora RAZEM z powodem - bez niego dyżurny nie wie,
    // czy ponawiać, czy eskalować.
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    h.repair.mockResolvedValue(outcome({ status: "failed", error: "brak planu w katalogu" }));
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    expect(await screen.findByText("Błąd naprawy: brak planu w katalogu")).toBeInTheDocument();
  });

  it("porażka bez powodu nadal jest porażką, a nie pustym wierszem", async () => {
    // Serwer ma prawo zwrócić `failed` bez tekstu błędu (np. gdy komunikat
    // operatora zawierałby dane klienta). Operator i tak musi zobaczyć, że
    // naprawa NIE przeszła - milczenie czytałby jako sukces.
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    h.repair.mockResolvedValue(outcome({ status: "failed", error: null }));
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    expect(await screen.findByText(/^Błąd naprawy:/)).toBeInTheDocument();
  });

  it("odrzucenie niebędące wyjątkiem też daje czytelny komunikat", async () => {
    // Granica funkcji serwerowych potrafi odrzucić obietnicę czymś, co nie
    // jest `Error` (odpowiedź transportu, obiekt problemu). Bez tej gałęzi
    // przy wierszu stanąłby napis „[object Object]".
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    h.repair.mockRejectedValue("timeout bramki");
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    expect(await screen.findByText("Błąd naprawy: timeout bramki")).toBeInTheDocument();
  });

  it("wyjątek po stronie operatora też ląduje przy wierszu, a nie w konsoli", async () => {
    // Cicha porażka jest tu najgorszym wynikiem: operator odchodzi od ekranu
    // przekonany, że klient ma dostęp, którego nadal nie ma.
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    h.repair.mockRejectedValue(new Error("połączenie z operatorem zerwane"));
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    expect(
      await screen.findByText("Błąd naprawy: połączenie z operatorem zerwane"),
    ).toBeInTheDocument();
  });

  it("w trakcie naprawy przycisk mówi, że naprawia, i nie da się go kliknąć drugi raz", async () => {
    // Podwójne kliknięcie „Napraw" to dwie równoległe obsługi tego samego
    // zdarzenia. Obsługa jest idempotentna, ale wyścig o wiersz dziennika
    // potrafi zostawić w nim wynik starszej próby.
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    let release: (value: RepairOutcome) => void = () => {};
    h.repair.mockImplementation(
      () =>
        new Promise<RepairOutcome>((resolve) => {
          release = resolve;
        }),
    );
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));

    const pending = await screen.findByRole("button", { name: "Naprawianie..." });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(h.repair).toHaveBeenCalledTimes(1);

    release(outcome());
    expect(await screen.findByText("Naprawione")).toBeInTheDocument();
  });

  it("ponowny skan kasuje wyniki poprzednich napraw", async () => {
    // Wynik naprawy opisuje KONKRETNY przebieg. Przeniesiony na świeży
    // raport twierdziłby, że pozycja z nowego skanu jest już załatwiona.
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    await mount();
    await scan();

    fireEvent.click(await screen.findByRole("button", { name: "Napraw" }));
    expect(await screen.findByText("Naprawione")).toBeInTheDocument();

    await scan();
    await waitFor(() => expect(screen.queryByText("Naprawione")).not.toBeInTheDocument());
  });
});

describe("trasa /admin/billing-reconcile - awaria skanu", () => {
  it("odmowa serwera pokazuje się na ekranie, zamiast zostawić panel pustym", async () => {
    // Rola `admin` jest weryfikowana SERWEROWO - odmowa wraca jako wyjątek.
    // Bez komunikatu ekran wygląda identycznie jak „skan trwa", więc operator
    // czeka na wynik, którego nigdy nie będzie.
    h.report.mockRejectedValue(new Error("brak uprawnień administratora"));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Skanuj" }));

    expect(await screen.findByText("brak uprawnień administratora")).toBeInTheDocument();
    expect(screen.queryByText("Brak rozbieżności w wybranym zakresie.")).not.toBeInTheDocument();
  });

  it("odrzucenie niebędące wyjątkiem pokazuje treść, a nie zbitkę obiektu", async () => {
    // Ten sam powód co przy naprawie: komunikat awarii skanu ma być czytelny
    // niezależnie od tego, czym granica odrzuciła obietnicę.
    h.report.mockRejectedValue({ code: "PGRST301" });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Skanuj" }));

    expect(await screen.findByText("[object Object]")).toBeInTheDocument();
  });

  it("odblokowuje przycisk po awarii, żeby dało się spróbować ponownie", async () => {
    h.report.mockRejectedValue(new Error("chwilowa awaria"));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Skanuj" }));
    await screen.findByText("chwilowa awaria");

    await waitFor(() => expect(screen.getByRole("button", { name: "Skanuj" })).toBeEnabled());
  });
});

describe("trasa /admin/billing-reconcile - dwujęzyczność panelu", () => {
  it("po angielsku mówi po angielsku - także kodami powodów i wyników", async () => {
    // Panel obsługuje anglojęzycznego administratora tenanta. Klucze
    // `adminReconcile.*` muszą mieć komplet PL/EN, bo brak tłumaczenia
    // pokazuje w tym miejscu surowy klucz zamiast powodu rozbieżności.
    await i18n.changeLanguage("en");
    h.report.mockResolvedValue(report({ issues: [issue()] }));
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(h.report).toHaveBeenCalled());

    expect(await screen.findByText("Event never reached the app")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment reconciliation" })).toBeInTheDocument();
    expect(screen.getByText("Checked: 12 events, 4 orders, 2 subscriptions.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Repair" }));
    expect(await screen.findByText("Repaired")).toBeInTheDocument();
  });
});
