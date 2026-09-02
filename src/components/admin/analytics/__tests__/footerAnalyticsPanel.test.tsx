// `FooterAnalyticsPanel` - pulpit kliknięć w stopce: konwersja newslettera,
// filtr grup, trzy stany i izolacja warsztatów.
//
// PO CO. Plik stał na zerze. Agregacja siedzi w server function
// (`footerAnalytics.functions.ts`) i testują ją inni - TUTAJ przedmiotem dowodu
// jest to, co panel robi Z TYMI liczbami, bo tego nie widzi żaden test
// serwerowy:
//
//   1. KONWERSJA JEST TU LICZONA NA MIEJSCU. `signups / clicks * 100` to jedyna
//      liczba na tym pulpicie, której nie ma w raporcie - powstaje w JSX.
//      Zabezpieczenie przed dzieleniem przez zero jest miękkie
//      (`totals && totals.newsletter_clicks`), a górnej granicy nie ma żadnej.
//      Tymczasem `trackFooterNewsletterSubmit` wysyła `footer_newsletter_signup`
//      przy KAŻDYM wyniku wysyłki (także "error" i "throttled") i BEZ
//      poprzedzającego `footer_newsletter_click`, bo kliknięcie jest raportowane
//      tylko dla linków z "newsletter" w adresie. Zapisów może więc być więcej
//      niż kliknięć - i panel wypisuje wtedy konwersję powyżej 100%. Przypięte.
//   2. FILTR GRUP KŁAMIE O OKNIE. Puste `rows` po filtrowaniu dają komunikat
//      "Brak zdarzeń w wybranym oknie", chociaż okno może być pełne zdarzeń -
//      tylko nie z tej grupy. Operator dostaje twierdzenie o danych, które
//      jest fałszywe. Przypięte `it.fails`.
//   3. TRZY STANY. Ładowanie i awaria mają tu WŁASNE gałęzie (rzadkość w tym
//      katalogu) - i to jest sprawdzane pozytywnie, żeby regres ich nie ściągnął
//      do wspólnego "brak danych".
//   4. SŁOWNIK. Panel nie importuje i18n ani razu: nagłówki, etykiety kafelków,
//      nazwy grup (`GROUP_LABEL`) i nazwy zdarzeń (`EVENT_LABEL`) są wpisane po
//      polsku w kodzie. Angielski administrator czyta polszczyznę. Przypięte.
//   5. IZOLACJA WARSZTATÓW. `queryKey: ["footer-analytics", days]` to stała i
//      liczba dni - ani tenanta, ani użytkownika, ani znacznika czasu.
//
// ECHARTS: ten panel nie renderuje `EChart`, więc nie ma czego atrapować - i
// biblioteka nie wchodzi do procesu testowego (patrz nagłówek `EChart.tsx`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type {
  FooterAnalyticsResult,
  FooterAnalyticsRow,
} from "@/lib/analytics/footerAnalytics.functions";

const h = vi.hoisted(() => ({ fetchFooter: vi.fn() }));

// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy.
// Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywracałaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/footerAnalytics.functions", () => ({
  getFooterAnalytics: (...args: unknown[]) => h.fetchFooter(...args),
}));

// Prawdziwa instancja i18next - potrzebna do dowodu, że przełączenie języka NIE
// zmienia w tym panelu ani jednego napisu.
import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { FooterAnalyticsPanel } from "../FooterAnalyticsPanel";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

function row(over: Partial<FooterAnalyticsRow> = {}): FooterAnalyticsRow {
  return {
    href: "/analizy",
    label: "Analizy",
    group: "editorial",
    event_name: "footer_link_click",
    clicks: 10,
    last_at: "2026-08-20T10:05:00.000Z",
    ...over,
  };
}

function report(over: {
  totals?: Partial<FooterAnalyticsResult["totals"]>;
  rows?: FooterAnalyticsRow[];
  days?: number;
}): FooterAnalyticsResult {
  return {
    totals: {
      total: 0,
      link_clicks: 0,
      legal_clicks: 0,
      newsletter_clicks: 0,
      newsletter_signups: 0,
      ...(over.totals ?? {}),
    },
    rows: over.rows ?? [],
    daily: [],
    windowDays: over.days ?? 30,
  };
}

const EMPTY = report({});

/** Okno "roboze": po jednym wierszu na każdą grupę i na każdy typ zdarzenia. */
const BUSY = report({
  totals: {
    total: 148,
    link_clicks: 100,
    legal_clicks: 20,
    newsletter_clicks: 20,
    newsletter_signups: 8,
  },
  rows: [
    row({ href: "/analizy", label: "Analizy", group: "editorial", clicks: 60 }),
    row({ href: "/tematy/energia", label: "Energia", group: "topics", clicks: 25 }),
    row({ href: "/spolecznosc", label: "Spolecznosc", group: "community", clicks: 15 }),
    row({ href: "/instytut", label: "Instytut", group: "institute", clicks: 10 }),
    row({
      href: "/polityka-prywatnosci",
      label: "Polityka prywatnosci",
      group: "legal",
      event_name: "footer_legal_click",
      clicks: 20,
    }),
    row({
      href: "/dolacz-do-newslettera",
      label: "Newsletter",
      group: "editorial",
      event_name: "footer_newsletter_click",
      clicks: 20,
    }),
    row({
      href: "footer_newsletter",
      label: "footer_newsletter",
      group: "unknown",
      event_name: "footer_newsletter_signup",
      clicks: 8,
    }),
  ],
});

/** Warsztat A - każdy napis niesie rozpoznawalny prefiks. */
const WORKSPACE_A = report({
  totals: { total: 3, link_clicks: 3 },
  rows: [row({ href: "/alfa/analizy", label: "ALFA analizy", clicks: 3 })],
});

/** Warsztat B - rozłączny z A na każdym napisie. */
const WORKSPACE_B = report({
  totals: { total: 1, link_clicks: 1 },
  rows: [row({ href: "/beta/raporty", label: "BETA raporty", clicks: 1 })],
});

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

/**
 * Kafelek `Stat` stojący przy podanej etykiecie. Etykieta jest gołym węzłem
 * tekstowym obok ikony, więc `getByText` zwraca ten wiersz, a jego rodzic to
 * cała karta: [0] etykieta, [1] wartość, [2] opcjonalna podpowiedź.
 */
function statCard(label: string): HTMLElement {
  const card = screen.getByText(label).parentElement;
  if (!card) throw new Error(`test: nie znaleziono kafelka "${label}"`);
  return card as HTMLElement;
}
function statValue(label: string): string {
  return statCard(label).children[1]?.textContent ?? "";
}
function statHint(label: string): string | null {
  return statCard(label).children[2]?.textContent ?? null;
}

function tableRows(): HTMLElement[] {
  const table = screen.queryByRole("table");
  if (!table) return [];
  return Array.from(table.querySelectorAll("tbody > tr")) as HTMLElement[];
}

/** Komórki jednego wiersza tabeli w kolejności renderu. */
function cells(tr: HTMLElement): string[] {
  return Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "");
}

function columnHeaders(): string[] {
  const table = screen.getByRole("table");
  return Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent ?? "");
}

/** Radix Select otwiera listę klawiszem - w happy-dom to najpewniejsza droga. */
async function pickOption(comboboxIndex: number, name: string): Promise<void> {
  const trigger = screen.getAllByRole("combobox")[comboboxIndex];
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

function queriedDays(): number[] {
  return h.fetchFooter.mock.calls.map((c) => (c[0] as { data: { days: number } }).data.days);
}

function panel(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <FooterAnalyticsPanel />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

/**
 * Czeka, aż raport DOJEDZIE do panelu.
 *
 * ŚWIADOMIE NIE OPIERA SIĘ na zniknięciu wskaźnika postępu. Wskaźnik pokazuje
 * `isFetching`, a przy obciążonej maszynie pierwszy render może wypaść PRZED
 * startem zapytania: wskaźnika nie ma jeszcze wcale, więc asercja "nie ma
 * wskaźnika" przechodzi na PUSTYM panelu i test mierzy stan przejściowy.
 * Dokładnie tak oblewały się cztery przypadki przy `load average` 34. Dlatego
 * czekamy na rozstrzygnięcie obietnic, które atrapa naprawdę oddała, wewnątrz
 * `act` - i tylko dla porządku domykamy spokojnym paskiem narzędzi.
 */
async function loaded(): Promise<void> {
  await waitFor(() => expect(h.fetchFooter).toHaveBeenCalled());
  await act(async () => {
    await Promise.allSettled(h.fetchFooter.mock.results.map((r) => r.value));
  });
  await waitFor(() => expect(screen.queryByText(/Ładowanie danych stopki/)).toBeNull());
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.fetchFooter.mockReset();
  h.fetchFooter.mockResolvedValue(BUSY);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - trzy stany panelu", () => {
  it("w trakcie pobierania panel mówi o ładowaniu i NIE pokazuje ani jednego kafelka", async () => {
    h.fetchFooter.mockImplementation(() => new Promise<FooterAnalyticsResult>(() => {}));
    panel();

    expect(await screen.findByText(/Ładowanie danych stopki/)).toBeInTheDocument();
    // Zero na kafelku to twierdzenie o pomiarze; dopóki go nie ma, kafelka też
    // nie ma - i to jest tu zrobione poprawnie, w odróżnieniu od pozostałych
    // pulpitów w tym katalogu.
    expect(screen.queryByText("Wszystkie zdarzenia")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("w trakcie pobierania selektor okna żyje - operator może zmienić zakres", async () => {
    h.fetchFooter.mockImplementation(() => new Promise<FooterAnalyticsResult>(() => {}));
    panel();
    await screen.findByText(/Ładowanie danych stopki/);

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Odśwież" })).toBeEnabled();
  });

  it("awaria odczytu ma WŁASNY komunikat i niesie treść błędu, a nie ciszy", async () => {
    h.fetchFooter.mockRejectedValue(new Error("analytics_events read failed: 500"));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("Nie udało się pobrać danych");
    expect(container.textContent ?? "").toContain("analytics_events read failed: 500");
    // Awaria nie udaje pustego okna - ani kafelków, ani tabeli.
    expect(screen.queryByText("Wszystkie zdarzenia")).toBeNull();
    expect(screen.queryByText("Brak zdarzeń w wybranym oknie.")).toBeNull();
  });

  it("puste okno pokazuje kafelki z zerami i komunikat o braku zdarzeń", async () => {
    h.fetchFooter.mockResolvedValue(EMPTY);
    panel();
    await loaded();

    expect(statValue("Wszystkie zdarzenia")).toBe("0");
    expect(screen.getByText("Brak zdarzeń w wybranym oknie.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("zapytanie wstrzymane brakiem sieci nie odpytuje serwera ani razu", async () => {
    onlineManager.setOnline(false);
    panel();
    await waitFor(() => expect(screen.queryByText(/Ładowanie danych stopki/)).toBeNull());

    expect(h.fetchFooter).not.toHaveBeenCalled();
  });

  it.fails("DEFEKT: przy braku sieci panel maluje pięć zer jako pomiar", async () => {
    // `q.isLoading` w react-query v5 to `isPending && isFetching`. Zapytanie
    // wstrzymane brakiem sieci ma `fetchStatus: "paused"`, więc `isFetching`
    // jest fałszem - a wraz z nim `isLoading`, mimo że nie przyszedł ani jeden
    // wiersz. Panel wchodzi wtedy w gałąź "mam dane", `totals` jest
    // `undefined`, a pięć kafelków wypisuje swoje `?? 0`. Operator w tunelu
    // dostaje twierdzenie, że stopka nie zebrała ani jednego kliknięcia -
    // zamiast informacji, że panel nie ma połączenia. To ta sama klasa błędu,
    // która w gałęzi `isLoading` jest obsłużona poprawnie.
    onlineManager.setOnline(false);
    panel();
    await waitFor(() => expect(screen.getByText("Wszystkie zdarzenia")).toBeInTheDocument());

    const shown = [
      statValue("Wszystkie zdarzenia"),
      statValue("Linki treści"),
      statValue("Linki prawne"),
      statValue("Kliknięcia newsletter"),
      statValue("Zapisy z newslettera"),
    ];
    expect(shown).not.toEqual(["0", "0", "0", "0", "0"]);
  });

  it("przycisk odświeżania ponawia odczyt tego samego okna", async () => {
    panel();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));
    await waitFor(() => expect(h.fetchFooter.mock.calls.length).toBe(2));

    expect(queriedDays()).toEqual([30, 30]);
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - kafelki sumaryczne", () => {
  it("każdy kafelek bierze WŁASNE pole raportu, bez przeliczania na miejscu", async () => {
    panel();
    await loaded();

    expect(statValue("Wszystkie zdarzenia")).toBe("148");
    expect(statValue("Linki treści")).toBe("100");
    expect(statValue("Linki prawne")).toBe("20");
    expect(statValue("Kliknięcia newsletter")).toBe("20");
    expect(statValue("Zapisy z newslettera")).toBe("8");
  });

  it("suma łączna NIE jest przeliczana z podliczeń - to osobne pole raportu", async () => {
    // 100 + 20 + 20 + 8 = 148, ale `totals.total` to `events.length` po
    // stronie serwera i może być WIĘKSZE (zdarzenie `footer_*`, którego panel
    // nie zna, wpada do sumy, a nie do żadnego podliczenia). Panel nie ma prawa
    // "poprawiać" tej liczby.
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 200, link_clicks: 1, legal_clicks: 1 } }),
    );
    panel();
    await loaded();

    expect(statValue("Wszystkie zdarzenia")).toBe("200");
  });

  it("konwersja newslettera liczy się z dwóch liczników, z jednym miejscem po przecinku", async () => {
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 33, newsletter_clicks: 80, newsletter_signups: 25 } }),
    );
    panel();
    await loaded();

    // 25 / 80 = 31,25% -> "31.3% konwersji"
    expect(statHint("Zapisy z newslettera")).toBe("31.3% konwersji");
  });

  it("zero kliknięć nie daje dzielenia przez zero - podpowiedź w ogóle nie powstaje", async () => {
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 5, newsletter_clicks: 0, newsletter_signups: 5 } }),
    );
    panel();
    await loaded();

    expect(statHint("Zapisy z newslettera")).toBeNull();
    expect(statCard("Zapisy z newslettera").children).toHaveLength(2);
  });

  it("pozostałe kafelki nie mają podpowiedzi - nie ma tam czego doliczać", async () => {
    panel();
    await loaded();

    expect(statCard("Wszystkie zdarzenia").children).toHaveLength(2);
    expect(statCard("Kliknięcia newsletter").children).toHaveLength(2);
  });

  it.fails("DEFEKT: konwersja newslettera potrafi przekroczyć 100%", async () => {
    // Licznik i mianownik nie pochodzą z tego samego lejka.
    // `trackFooterNewsletterSubmit` wysyła `footer_newsletter_signup` przy
    // KAŻDYM wyniku wysyłki (w tym "error" i "throttled"), a
    // `footer_newsletter_click` powstaje wyłącznie przy klikniecu w link, który
    // ma "newsletter" w adresie - formularz w stopce nie wymaga takiego
    // kliknięcia w ogóle. Zapisów bywa więc więcej niż kliknięć, a panel
    // wypisuje wtedy "300.0% konwersji". Żaden odsetek nie ma prawa przekroczyć
    // stu procent: albo trzeba go ograniczyć, albo nazwać inaczej niż
    // "konwersja".
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 34, newsletter_clicks: 2, newsletter_signups: 6 } }),
    );
    panel();
    await loaded();

    const hint = statHint("Zapisy z newslettera") ?? "";
    const pct = Number.parseFloat(hint);
    expect(pct).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - tabela top linków", () => {
  it("wiersz niesie etykietę, adres, grupę, zdarzenie, liczbę i datę", async () => {
    h.fetchFooter.mockResolvedValue(
      report({
        totals: { total: 60, link_clicks: 60 },
        rows: [row({ href: "/analizy/energia", label: "Energia w regionie", clicks: 60 })],
      }),
    );
    panel();
    await loaded();

    const c = cells(tableRows()[0]);
    expect(c[0]).toContain("Energia w regionie");
    expect(c[0]).toContain("/analizy/energia");
    expect(c[1]).toBe("Redakcja");
    expect(c[2]).toBe("Link stopki");
    expect(c[3]).toBe("60");
    expect(c[4]).toBe(new Date("2026-08-20T10:05:00.000Z").toLocaleString("pl-PL"));
  });

  it("każda grupa dostaje swoją etykietę, a nie klucz techniczny", async () => {
    panel();
    await loaded();

    const byGroup = tableRows().map((tr) => cells(tr)[1]);
    expect(byGroup).toEqual([
      "Redakcja",
      "Tematy",
      "Społeczność",
      "Instytut",
      "Prawne",
      "Redakcja",
      "Inne",
    ]);
  });

  it("każde zdarzenie dostaje swoją etykietę - cztery typy są rozróżnialne", async () => {
    panel();
    await loaded();

    const byEvent = tableRows().map((tr) => cells(tr)[2]);
    expect(new Set(byEvent)).toEqual(
      new Set(["Link stopki", "Link prawny", "Newsletter (link)", "Newsletter (zapis)"]),
    );
  });

  it("nieznana grupa i nieznane zdarzenie spadają na wartość surową, nie na puste pole", async () => {
    // Nowa grupa w stopce albo nowe zdarzenie `footer_*` nie może wyzerować
    // komórki - operator musi zobaczyć choćby klucz.
    h.fetchFooter.mockResolvedValue(
      report({
        totals: { total: 1 },
        rows: [row({ group: "partnerzy", event_name: "footer_partner_click", clicks: 1 })],
      }),
    );
    panel();
    await loaded();

    const c = cells(tableRows()[0]);
    expect(c[1]).toBe("partnerzy");
    expect(c[2]).toBe("footer_partner_click");
  });

  it("brak daty ostatniego kliknięcia daje kreskę, a nie Invalid Date", async () => {
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 1 }, rows: [row({ last_at: null, clicks: 1 })] }),
    );
    panel();
    await loaded();

    expect(cells(tableRows()[0])[4]).toBe("-");
    expect(screen.getByRole("table").textContent ?? "").not.toContain("Invalid Date");
  });

  it("kolejność wierszy jest ta, którą dał serwer - panel nie sortuje po swojemu", async () => {
    panel();
    await loaded();

    expect(tableRows().map((tr) => Number(cells(tr)[3]))).toEqual([60, 25, 15, 10, 20, 20, 8]);
  });

  it("wiersz jest identyfikowany parą zdarzenie-adres, więc ten sam adres może wystąpić dwa razy", async () => {
    // Klucz `${event_name}::${href}` - ten sam link raz jako kliknięcie, raz
    // jako zapis. Kolizja klucza zgubiłaby jeden z wierszy.
    h.fetchFooter.mockResolvedValue(
      report({
        totals: { total: 12 },
        rows: [
          row({ href: "/newsletter", event_name: "footer_newsletter_click", clicks: 9 }),
          row({ href: "/newsletter", event_name: "footer_newsletter_signup", clicks: 3 }),
        ],
      }),
    );
    panel();
    await loaded();

    expect(tableRows()).toHaveLength(2);
    expect(tableRows().map((tr) => cells(tr)[2])).toEqual([
      "Newsletter (link)",
      "Newsletter (zapis)",
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - filtr grup", () => {
  it("domyślnie widać wszystkie grupy", async () => {
    panel();
    await loaded();

    expect(tableRows()).toHaveLength(BUSY.rows.length);
  });

  it("wybór grupy zawęża tabelę DO TEJ grupy, bez ponownego odczytu z serwera", async () => {
    panel();
    await loaded();

    await pickOption(1, "Prawne");

    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(cells(tableRows()[0])[1]).toBe("Prawne");
    // Filtrowanie jest po stronie klienta - okno się nie zmieniło, więc drugie
    // zapytanie byłoby marnotrawstwem.
    expect(queriedDays()).toEqual([30]);
  });

  it("powrót do wszystkich grup przywraca pełną tabelę", async () => {
    panel();
    await loaded();
    await pickOption(1, "Instytut");
    await waitFor(() => expect(tableRows()).toHaveLength(1));

    await pickOption(1, "Wszystkie grupy");

    await waitFor(() => expect(tableRows()).toHaveLength(BUSY.rows.length));
  });

  it("filtr grupy „Inne” łapie wiersze o nieznanej grupie", async () => {
    panel();
    await loaded();

    await pickOption(1, "Inne");

    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(cells(tableRows()[0])[2]).toBe("Newsletter (zapis)");
  });

  it("filtr nie rusza kafelków sumarycznych - one opisują całe okno", async () => {
    panel();
    await loaded();

    await pickOption(1, "Prawne");
    await waitFor(() => expect(tableRows()).toHaveLength(1));

    expect(statValue("Wszystkie zdarzenia")).toBe("148");
    expect(statValue("Linki treści")).toBe("100");
  });

  it("filtr oferuje wszystkie znane grupy plus pozycję zbiorczą", async () => {
    panel();
    await loaded();

    fireEvent.keyDown(screen.getAllByRole("combobox")[1], { key: "Enter" });
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(labels).toEqual([
      "Wszystkie grupy",
      "Redakcja",
      "Tematy",
      "Społeczność",
      "Instytut",
      "Prawne",
      "Inne",
    ]);
  });

  it.fails("DEFEKT: filtr bez trafień twierdzi, że w OKNIE nie było zdarzeń", async () => {
    // `rows.length === 0` obsługuje dwa różne stany jednym zdaniem: "okno
    // jest puste" i "ta grupa jest pusta". Tu okno ma 148 zdarzeń, a panel
    // pisze "Brak zdarzeń w wybranym oknie." - operator może na tej podstawie
    // uznać, że tracking stopki nie działa, i zacząć szukać awarii, której
    // nie ma.
    h.fetchFooter.mockResolvedValue(
      report({
        totals: { total: 148, link_clicks: 148 },
        rows: [row({ group: "editorial", clicks: 148 })],
      }),
    );
    panel();
    await loaded();

    await pickOption(1, "Prawne");
    await waitFor(() => expect(tableRows()).toHaveLength(0));

    expect(screen.queryByText("Brak zdarzeń w wybranym oknie.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - okno czasu", () => {
  it("startowe okno to 30 dni i taka liczba trafia do WEJŚCIA funkcji", async () => {
    panel();
    await loaded();

    expect(queriedDays()).toEqual([30]);
  });

  it("nagłówek podaje długość okna, którą panel naprawdę odpytał", async () => {
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("Okno: ostatnie 30 dni");
  });

  it("wybór krótszego okna przestawia WEJŚCIE zapytania i opis okna", async () => {
    panel();
    await loaded();

    await pickOption(0, "7 dni");

    await waitFor(() => expect(queriedDays()).toEqual([30, 7]));
    expect(document.body.textContent ?? "").toContain("Okno: ostatnie 7 dni");
  });

  it("wybór najdłuższego okna daje dziewięćdziesiąt dni", async () => {
    panel();
    await loaded();

    await pickOption(0, "90 dni");

    await waitFor(() => expect(queriedDays()).toEqual([30, 90]));
  });

  it("zmiana okna nie gubi danych poprzedniego - każde okno ma własny wpis cache", async () => {
    h.fetchFooter.mockResolvedValueOnce(BUSY);
    h.fetchFooter.mockResolvedValueOnce(report({ totals: { total: 3, link_clicks: 3 } }));
    panel();
    await loaded();
    expect(statValue("Wszystkie zdarzenia")).toBe("148");

    await pickOption(0, "7 dni");
    await waitFor(() => expect(statValue("Wszystkie zdarzenia")).toBe("3"));

    await pickOption(0, "30 dni");
    await waitFor(() => expect(statValue("Wszystkie zdarzenia")).toBe("148"));
    expect(queriedDays()).toEqual([30, 7]);
  });

  it("wybrana grupa PRZEŻYWA zmianę okna - filtr jest niezależny od zapytania", async () => {
    panel();
    await loaded();
    await pickOption(1, "Prawne");
    await waitFor(() => expect(tableRows()).toHaveLength(1));

    await pickOption(0, "7 dni");
    await waitFor(() => expect(queriedDays()).toEqual([30, 7]));

    expect(tableRows()).toHaveLength(1);
    expect(cells(tableRows()[0])[1]).toBe("Prawne");
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - izolacja warsztatów", () => {
  it("panel warsztatu B pokazuje WYŁĄCZNIE linki warsztatu B", async () => {
    h.fetchFooter.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("BETA raporty");
    expect(container.textContent ?? "").not.toContain("ALFA");
    expect(container.textContent ?? "").not.toContain("/alfa/");
  });

  it("świeży klient react-query nie przenosi raportu między warsztatami", async () => {
    h.fetchFooter.mockResolvedValue(WORKSPACE_A);
    const first = panel();
    await loaded();
    expect(first.container.textContent ?? "").toContain("ALFA analizy");
    first.unmount();

    h.fetchFooter.mockResolvedValue(WORKSPACE_B);
    const second = panel();
    await loaded();

    expect(second.container.textContent ?? "").not.toContain("ALFA");
    expect(second.container.textContent ?? "").toContain("BETA");
  });

  it.fails(
    "DEFEKT: klucz cache nie niesie warsztatu - drugi panel z tym samym oknem widzi cudze linki",
    async () => {
      // `queryKey: ["footer-analytics", days]` to jedna stała i liczba dni. Nie
      // ma w nim ani tenanta, ani użytkownika, ani - inaczej niż w pulpitach
      // opartych o `TimeRangeFilter` - znacznika czasu okna. Dwa montowania z
      // domyślnym oknem 30 dni trafiają więc ZAWSZE w ten sam wpis cache, a
      // `staleTime: 60_000` sprawia, że react-query nie ponawia zapytania.
      // Administrator warsztatu B czyta etykiety i adresy warsztatu A, i nie
      // leci przy tym ani jedno żądanie sieciowe.
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      h.fetchFooter.mockResolvedValue(WORKSPACE_A);
      const first = panel(client);
      await loaded();
      first.unmount();

      h.fetchFooter.mockResolvedValue(WORKSPACE_B);
      const second = panel(client);
      await loaded();

      expect(second.container.textContent ?? "").not.toContain("ALFA");
    },
  );
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - słownik", () => {
  it.fails("DEFEKT: panel nie ma warstwy i18n - po angielsku dalej mówi po polsku", async () => {
    // Ani jednego `useTranslation`, ani jednego importu nakładki słownika.
    // Nagłówek, opis, pięć etykiet kafelków, pięć pozycji filtra, cztery nazwy
    // zdarzeń i pięć nagłówków kolumn są wpisane po polsku w kodzie
    // komponentu - a `/admin/analytics` jest dostępne w obu językach. Każdy
    // inny pulpit w tym katalogu (`AudienceSegmentsDashboard`,
    // `ClientErrorsDashboard`, `VitalsBiDashboard`) bierze te napisy z
    // `@/lib/i18n-admin-analytics`, więc to rozjazd, nie decyzja produktowa.
    await i18n.changeLanguage("en");
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toContain("Kliknięcia w stopce");
    expect(container.textContent ?? "").not.toContain("Wszystkie zdarzenia");
  });

  it.fails("DEFEKT: daty w tabeli są formatowane zaszytym pl-PL także po angielsku", async () => {
    // `new Date(r.last_at).toLocaleString("pl-PL")` ignoruje język interfejsu.
    // `ClientErrorsDashboard` w tym samym katalogu wybiera locale z
    // `i18n.language`, więc wzorzec w repo istnieje.
    await i18n.changeLanguage("en");
    h.fetchFooter.mockResolvedValue(report({ totals: { total: 1 }, rows: [row({ clicks: 1 })] }));
    panel();
    await loaded();

    expect(cells(tableRows()[0])[4]).toBe(
      new Date("2026-08-20T10:05:00.000Z").toLocaleString("en-GB"),
    );
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - dostępność", () => {
  it("tabela ma nagłówki kolumn, więc czytnik ekranu wie, co jest w komórce", async () => {
    panel();
    await loaded();

    expect(columnHeaders()).toEqual([
      "Etykieta / URL",
      "Grupa",
      "Zdarzenie",
      "Kliknięcia",
      "Ostatnie",
    ]);
    // Każdy wiersz ma tyle komórek, ile jest nagłówków - inaczej powiązanie
    // komórka-kolumna rozjeżdża się dla czytnika ekranu.
    for (const tr of tableRows()) expect(cells(tr)).toHaveLength(5);
  });

  it("cały dług dostępności panelu to DWA bezimienne selektory", async () => {
    // Asercja jest na PEŁNEJ liście naruszeń: dopisanie dowolnego innego
    // problemu (tabela bez nagłówków, plakietka bez nazwy, zła kolejność
    // nagłówków) oblewa ten test. Dwa wpisy `button-name`, które tu stoją, są
    // przypięte osobno niżej.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    expect(violations[0].nodes).toHaveLength(2);
  });

  it("panel bez danych nie dokłada naruszeń poza selektorem okna", async () => {
    h.fetchFooter.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it.fails("DEFEKT: ani selektor okna, ani filtr grup nie ma nazwy dostępnej", async () => {
    // Oba `SelectTrigger` renderują `<button role="combobox">` bez `aria-label`
    // i bez `<label>`. `SelectValue` nie ma nawet `placeholder`, więc do
    // pierwszego otwarcia listy przyciski są PUSTE - czytnik ekranu ogłasza dwa
    // nieopisane comboboxy stojące obok siebie i nie da się ich rozróżnić.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
