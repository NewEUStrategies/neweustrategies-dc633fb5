// `FooterAnalyticsPanel` - pulpit klikniec w stopce: konwersja newslettera,
// filtr grup, trzy stany i izolacja warsztatow.
//
// PO CO. Plik stal na zerze. Agregacja siedzi w server function
// (`footerAnalytics.functions.ts`) i testuja ja inni - TUTAJ przedmiotem dowodu
// jest to, co panel robi Z TYMI liczbami, bo tego nie widzi zaden test
// serwerowy:
//
//   1. KONWERSJA JEST TU LICZONA NA MIEJSCU. `signups / clicks * 100` to jedyna
//      liczba na tym pulpicie, ktorej nie ma w raporcie - powstaje w JSX.
//      Zabezpieczenie przed dzieleniem przez zero jest miekkie
//      (`totals && totals.newsletter_clicks`), a gornej granicy nie ma zadnej.
//      Tymczasem `trackFooterNewsletterSubmit` wysyla `footer_newsletter_signup`
//      przy KAZDYM wyniku wysylki (takze "error" i "throttled") i BEZ
//      poprzedzajacego `footer_newsletter_click`, bo klikniecie jest raportowane
//      tylko dla linkow z "newsletter" w adresie. Zapisow moze wiec byc wiecej
//      niz klikniec - i panel wypisuje wtedy konwersje powyzej 100%. Przypiete.
//   2. FILTR GRUP KLAMIE O OKNIE. Puste `rows` po filtrowaniu daja komunikat
//      "Brak zdarzen w wybranym oknie", chociaz okno moze byc pelne zdarzen -
//      tylko nie z tej grupy. Operator dostaje twierdzenie o danych, ktore
//      jest falszywe. Przypiete `it.fails`.
//   3. TRZY STANY. Ladowanie i awaria maja tu WLASNE galezie (rzadkosc w tym
//      katalogu) - i to jest sprawdzane pozytywnie, zeby regres ich nie sciagnal
//      do wspolnego "brak danych".
//   4. SLOWNIK. Panel nie importuje i18n ani razu: naglowki, etykiety kafelkow,
//      nazwy grup (`GROUP_LABEL`) i nazwy zdarzen (`EVENT_LABEL`) sa wpisane po
//      polsku w kodzie. Angielski administrator czyta polszczyzne. Przypiete.
//   5. IZOLACJA WARSZTATOW. `queryKey: ["footer-analytics", days]` to stala i
//      liczba dni - ani tenanta, ani uzytkownika, ani znacznika czasu.
//
// ECHARTS: ten panel nie renderuje `EChart`, wiec nie ma czego atrapowac - i
// biblioteka nie wchodzi do procesu testowego (patrz naglowek `EChart.tsx`).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import type {
  FooterAnalyticsResult,
  FooterAnalyticsRow,
} from "@/lib/analytics/footerAnalytics.functions";

const h = vi.hoisted(() => ({ fetchFooter: vi.fn() }));

// `useServerFn` staje sie tozsamoscia - wywolanie idzie prosto do atrapy.
// Mock CZESCIOWY, bo `@/lib/i18n` ciagnie z tego samego pakietu
// `createIsomorphicFn`, a pelna atrapa wywracalaby inicjalizacje slownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/analytics/footerAnalytics.functions", () => ({
  getFooterAnalytics: (...args: unknown[]) => h.fetchFooter(...args),
}));

// Prawdziwa instancja i18next - potrzebna do dowodu, ze przelaczenie jezyka NIE
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

/** Okno "roboze": po jednym wierszu na kazda grupe i na kazdy typ zdarzenia. */
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

/** Warsztat A - kazdy napis niesie rozpoznawalny prefiks. */
const WORKSPACE_A = report({
  totals: { total: 3, link_clicks: 3 },
  rows: [row({ href: "/alfa/analizy", label: "ALFA analizy", clicks: 3 })],
});

/** Warsztat B - rozlaczny z A na kazdym napisie. */
const WORKSPACE_B = report({
  totals: { total: 1, link_clicks: 1 },
  rows: [row({ href: "/beta/raporty", label: "BETA raporty", clicks: 1 })],
});

// ---------------------------------------------------------------------------
// Narzedzia
// ---------------------------------------------------------------------------

/**
 * Kafelek `Stat` stojacy przy podanej etykiecie. Etykieta jest golym wezlem
 * tekstowym obok ikony, wiec `getByText` zwraca ten wiersz, a jego rodzic to
 * cala karta: [0] etykieta, [1] wartosc, [2] opcjonalna podpowiedz.
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

/** Komorki jednego wiersza tabeli w kolejnosci renderu. */
function cells(tr: HTMLElement): string[] {
  return Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? "");
}

function columnHeaders(): string[] {
  const table = screen.getByRole("table");
  return Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent ?? "");
}

/** Radix Select otwiera liste klawiszem - w happy-dom to najpewniejsza droga. */
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
 * Czeka, az raport DOJEDZIE do panelu.
 *
 * SWIADOMIE NIE OPIERA SIE na zniknieciu wskaznika postepu. Wskaznik pokazuje
 * `isFetching`, a przy obciazonej maszynie pierwszy render moze wypasc PRZED
 * startem zapytania: wskaznika nie ma jeszcze wcale, wiec asercja "nie ma
 * wskaznika" przechodzi na PUSTYM panelu i test mierzy stan przejsciowy.
 * Dokladnie tak oblewaly sie cztery przypadki przy `load average` 34. Dlatego
 * czekamy na rozstrzygniecie obietnic, ktore atrapa naprawde oddala, wewnatrz
 * `act` - i tylko dla porzadku domykamy spokojnym paskiem narzedzi.
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
  it("w trakcie pobierania panel mowi o ladowaniu i NIE pokazuje ani jednego kafelka", async () => {
    h.fetchFooter.mockImplementation(() => new Promise<FooterAnalyticsResult>(() => {}));
    panel();

    expect(await screen.findByText(/Ładowanie danych stopki/)).toBeInTheDocument();
    // Zero na kafelku to twierdzenie o pomiarze; dopoki go nie ma, kafelka tez
    // nie ma - i to jest tu zrobione poprawnie, w odroznieniu od pozostalych
    // pulpitow w tym katalogu.
    expect(screen.queryByText("Wszystkie zdarzenia")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("w trakcie pobierania selektor okna zyje - operator moze zmienic zakres", async () => {
    h.fetchFooter.mockImplementation(() => new Promise<FooterAnalyticsResult>(() => {}));
    panel();
    await screen.findByText(/Ładowanie danych stopki/);

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Odśwież" })).toBeEnabled();
  });

  it("awaria odczytu ma WLASNY komunikat i niesie tresc bledu, a nie ciszy", async () => {
    h.fetchFooter.mockRejectedValue(new Error("analytics_events read failed: 500"));
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("Nie udało się pobrać danych");
    expect(container.textContent ?? "").toContain("analytics_events read failed: 500");
    // Awaria nie udaje pustego okna - ani kafelkow, ani tabeli.
    expect(screen.queryByText("Wszystkie zdarzenia")).toBeNull();
    expect(screen.queryByText("Brak zdarzeń w wybranym oknie.")).toBeNull();
  });

  it("puste okno pokazuje kafelki z zerami i komunikat o braku zdarzen", async () => {
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
    // wstrzymane brakiem sieci ma `fetchStatus: "paused"`, wiec `isFetching`
    // jest falszem - a wraz z nim `isLoading`, mimo ze nie przyszedl ani jeden
    // wiersz. Panel wchodzi wtedy w galaz "mam dane", `totals` jest
    // `undefined`, a pięć kafelkow wypisuje swoje `?? 0`. Operator w tunelu
    // dostaje twierdzenie, ze stopka nie zebrala ani jednego klikniecia -
    // zamiast informacji, ze panel nie ma polaczenia. To ta sama klasa bledu,
    // ktora w galezi `isLoading` jest obsluzona poprawnie.
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

  it("przycisk odswiezania ponawia odczyt tego samego okna", async () => {
    panel();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Odśwież" }));
    await waitFor(() => expect(h.fetchFooter.mock.calls.length).toBe(2));

    expect(queriedDays()).toEqual([30, 30]);
  });
});

// ---------------------------------------------------------------------------

describe("FooterAnalyticsPanel - kafelki sumaryczne", () => {
  it("kazdy kafelek bierze WLASNE pole raportu, bez przeliczania na miejscu", async () => {
    panel();
    await loaded();

    expect(statValue("Wszystkie zdarzenia")).toBe("148");
    expect(statValue("Linki treści")).toBe("100");
    expect(statValue("Linki prawne")).toBe("20");
    expect(statValue("Kliknięcia newsletter")).toBe("20");
    expect(statValue("Zapisy z newslettera")).toBe("8");
  });

  it("suma laczna NIE jest przeliczana z podliczen - to osobne pole raportu", async () => {
    // 100 + 20 + 20 + 8 = 148, ale `totals.total` to `events.length` po
    // stronie serwera i moze byc WIEKSZE (zdarzenie `footer_*`, ktorego panel
    // nie zna, wpada do sumy, a nie do zadnego podliczenia). Panel nie ma prawa
    // "poprawiac" tej liczby.
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 200, link_clicks: 1, legal_clicks: 1 } }),
    );
    panel();
    await loaded();

    expect(statValue("Wszystkie zdarzenia")).toBe("200");
  });

  it("konwersja newslettera liczy sie z dwoch licznikow, z jednym miejscem po przecinku", async () => {
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 33, newsletter_clicks: 80, newsletter_signups: 25 } }),
    );
    panel();
    await loaded();

    // 25 / 80 = 31,25% -> "31.3% konwersji"
    expect(statHint("Zapisy z newslettera")).toBe("31.3% konwersji");
  });

  it("zero klikniec nie daje dzielenia przez zero - podpowiedz w ogole nie powstaje", async () => {
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 5, newsletter_clicks: 0, newsletter_signups: 5 } }),
    );
    panel();
    await loaded();

    expect(statHint("Zapisy z newslettera")).toBeNull();
    expect(statCard("Zapisy z newslettera").children).toHaveLength(2);
  });

  it("pozostale kafelki nie maja podpowiedzi - nie ma tam czego doliczac", async () => {
    panel();
    await loaded();

    expect(statCard("Wszystkie zdarzenia").children).toHaveLength(2);
    expect(statCard("Kliknięcia newsletter").children).toHaveLength(2);
  });

  it.fails("DEFEKT: konwersja newslettera potrafi przekroczyc 100%", async () => {
    // Licznik i mianownik nie pochodza z tego samego lejka.
    // `trackFooterNewsletterSubmit` wysyla `footer_newsletter_signup` przy
    // KAZDYM wyniku wysylki (w tym "error" i "throttled"), a
    // `footer_newsletter_click` powstaje wylacznie przy klikniecu w link, ktory
    // ma "newsletter" w adresie - formularz w stopce nie wymaga takiego
    // klikniecia w ogole. Zapisow bywa wiec wiecej niz klikniec, a panel
    // wypisuje wtedy "300.0% konwersji". Zaden odsetek nie ma prawa przekroczyc
    // stu procent: albo trzeba go ograniczyc, albo nazwac inaczej niz
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

describe("FooterAnalyticsPanel - tabela top linkow", () => {
  it("wiersz niesie etykiete, adres, grupe, zdarzenie, liczbe i date", async () => {
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

  it("kazda grupa dostaje swoja etykiete, a nie klucz techniczny", async () => {
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

  it("kazde zdarzenie dostaje swoja etykiete - cztery typy sa rozroznialne", async () => {
    panel();
    await loaded();

    const byEvent = tableRows().map((tr) => cells(tr)[2]);
    expect(new Set(byEvent)).toEqual(
      new Set(["Link stopki", "Link prawny", "Newsletter (link)", "Newsletter (zapis)"]),
    );
  });

  it("nieznana grupa i nieznane zdarzenie spadaja na wartosc surowa, nie na puste pole", async () => {
    // Nowa grupa w stopce albo nowe zdarzenie `footer_*` nie moze wyzerowac
    // komorki - operator musi zobaczyc chocby klucz.
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

  it("brak daty ostatniego klikniecia daje kreske, a nie Invalid Date", async () => {
    h.fetchFooter.mockResolvedValue(
      report({ totals: { total: 1 }, rows: [row({ last_at: null, clicks: 1 })] }),
    );
    panel();
    await loaded();

    expect(cells(tableRows()[0])[4]).toBe("-");
    expect(screen.getByRole("table").textContent ?? "").not.toContain("Invalid Date");
  });

  it("kolejnosc wierszy jest ta, ktora dal serwer - panel nie sortuje po swojemu", async () => {
    panel();
    await loaded();

    expect(tableRows().map((tr) => Number(cells(tr)[3]))).toEqual([60, 25, 15, 10, 20, 20, 8]);
  });

  it("wiersz jest identyfikowany para zdarzenie-adres, wiec ten sam adres moze wystapic dwa razy", async () => {
    // Klucz `${event_name}::${href}` - ten sam link raz jako klikniecie, raz
    // jako zapis. Kolizja klucza zgubilaby jeden z wierszy.
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
  it("domyslnie widac wszystkie grupy", async () => {
    panel();
    await loaded();

    expect(tableRows()).toHaveLength(BUSY.rows.length);
  });

  it("wybor grupy zawezá tabele DO TEJ grupy, bez ponownego odczytu z serwera", async () => {
    panel();
    await loaded();

    await pickOption(1, "Prawne");

    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(cells(tableRows()[0])[1]).toBe("Prawne");
    // Filtrowanie jest po stronie klienta - okno sie nie zmienilo, wiec drugie
    // zapytanie byloby marnotrawstwem.
    expect(queriedDays()).toEqual([30]);
  });

  it("powrot do wszystkich grup przywraca pelna tabele", async () => {
    panel();
    await loaded();
    await pickOption(1, "Instytut");
    await waitFor(() => expect(tableRows()).toHaveLength(1));

    await pickOption(1, "Wszystkie grupy");

    await waitFor(() => expect(tableRows()).toHaveLength(BUSY.rows.length));
  });

  it("filtr grupy „Inne” lapie wiersze o nieznanej grupie", async () => {
    panel();
    await loaded();

    await pickOption(1, "Inne");

    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(cells(tableRows()[0])[2]).toBe("Newsletter (zapis)");
  });

  it("filtr nie rusza kafelkow sumarycznych - one opisuja cale okno", async () => {
    panel();
    await loaded();

    await pickOption(1, "Prawne");
    await waitFor(() => expect(tableRows()).toHaveLength(1));

    expect(statValue("Wszystkie zdarzenia")).toBe("148");
    expect(statValue("Linki treści")).toBe("100");
  });

  it("filtr oferuje wszystkie znane grupy plus pozycje zbiorcza", async () => {
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

  it.fails("DEFEKT: filtr bez trafien twierdzi, ze w OKNIE nie bylo zdarzen", async () => {
    // `rows.length === 0` obsluguje dwa rozne stany jednym zdaniem: "okno
    // jest puste" i "ta grupa jest pusta". Tu okno ma 148 zdarzen, a panel
    // pisze "Brak zdarzeń w wybranym oknie." - operator moze na tej podstawie
    // uznac, ze tracking stopki nie dziala, i zaczac szukac awarii, ktorej
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
  it("startowe okno to 30 dni i taka liczba trafia do WEJSCIA funkcji", async () => {
    panel();
    await loaded();

    expect(queriedDays()).toEqual([30]);
  });

  it("naglowek podaje dlugosc okna, ktora panel naprawde odpytal", async () => {
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("Okno: ostatnie 30 dni");
  });

  it("wybor krotszego okna przestawia WEJSCIE zapytania i opis okna", async () => {
    panel();
    await loaded();

    await pickOption(0, "7 dni");

    await waitFor(() => expect(queriedDays()).toEqual([30, 7]));
    expect(document.body.textContent ?? "").toContain("Okno: ostatnie 7 dni");
  });

  it("wybor najdluzszego okna daje dziewiecdziesiat dni", async () => {
    panel();
    await loaded();

    await pickOption(0, "90 dni");

    await waitFor(() => expect(queriedDays()).toEqual([30, 90]));
  });

  it("zmiana okna nie gubi danych poprzedniego - kazde okno ma wlasny wpis cache", async () => {
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

  it("wybrana grupa PRZEZYWA zmiane okna - filtr jest niezalezny od zapytania", async () => {
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

describe("FooterAnalyticsPanel - izolacja warsztatow", () => {
  it("panel warsztatu B pokazuje WYLACZNIE linki warsztatu B", async () => {
    h.fetchFooter.mockResolvedValue(WORKSPACE_B);
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").toContain("BETA raporty");
    expect(container.textContent ?? "").not.toContain("ALFA");
    expect(container.textContent ?? "").not.toContain("/alfa/");
  });

  it("swiezy klient react-query nie przenosi raportu miedzy warsztatami", async () => {
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
      // `queryKey: ["footer-analytics", days]` to jedna stala i liczba dni. Nie
      // ma w nim ani tenanta, ani uzytkownika, ani - inaczej niz w pulpitach
      // opartych o `TimeRangeFilter` - znacznika czasu okna. Dwa montowania z
      // domyslnym oknem 30 dni trafiaja wiec ZAWSZE w ten sam wpis cache, a
      // `staleTime: 60_000` sprawia, ze react-query nie ponawia zapytania.
      // Administrator warsztatu B czyta etykiety i adresy warsztatu A, i nie
      // leci przy tym ani jedno zadanie sieciowe.
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

describe("FooterAnalyticsPanel - slownik", () => {
  it.fails("DEFEKT: panel nie ma warstwy i18n - po angielsku dalej mowi po polsku", async () => {
    // Ani jednego `useTranslation`, ani jednego importu nakladki slownika.
    // Naglowek, opis, pięć etykiet kafelkow, pięć pozycji filtra, cztery nazwy
    // zdarzen i pięć naglowkow kolumn sa wpisane po polsku w kodzie
    // komponentu - a `/admin/analytics` jest dostepne w obu jezykach. Kazdy
    // inny pulpit w tym katalogu (`AudienceSegmentsDashboard`,
    // `ClientErrorsDashboard`, `VitalsBiDashboard`) bierze te napisy z
    // `@/lib/i18n-admin-analytics`, wiec to rozjazd, nie decyzja produktowa.
    await i18n.changeLanguage("en");
    const { container } = panel();
    await loaded();

    expect(container.textContent ?? "").not.toContain("Kliknięcia w stopce");
    expect(container.textContent ?? "").not.toContain("Wszystkie zdarzenia");
  });

  it.fails("DEFEKT: daty w tabeli sa formatowane zaszytym pl-PL takze po angielsku", async () => {
    // `new Date(r.last_at).toLocaleString("pl-PL")` ignoruje jezyk interfejsu.
    // `ClientErrorsDashboard` w tym samym katalogu wybiera locale z
    // `i18n.language`, wiec wzorzec w repo istnieje.
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

describe("FooterAnalyticsPanel - dostepnosc", () => {
  it("tabela ma naglowki kolumn, wiec czytnik ekranu wie, co jest w komorce", async () => {
    panel();
    await loaded();

    expect(columnHeaders()).toEqual([
      "Etykieta / URL",
      "Grupa",
      "Zdarzenie",
      "Kliknięcia",
      "Ostatnie",
    ]);
    // Kazdy wiersz ma tyle komorek, ile jest naglowkow - inaczej powiazanie
    // komorka-kolumna rozjezdza sie dla czytnika ekranu.
    for (const tr of tableRows()) expect(cells(tr)).toHaveLength(5);
  });

  it("caly dlug dostepnosci panelu to DWA bezimienne selektory", async () => {
    // Asercja jest na PELNEJ liscie naruszen: dopisanie dowolnego innego
    // problemu (tabela bez naglowkow, plakietka bez nazwy, zla kolejnosc
    // naglowkow) oblewa ten test. Dwa wpisy `button-name`, ktore tu stoja, sa
    // przypiete osobno nizej.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["button-name"]);
    expect(violations[0].nodes).toHaveLength(2);
  });

  it("panel bez danych nie dokłada naruszen poza selektorem okna", async () => {
    h.fetchFooter.mockResolvedValue(EMPTY);
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container, { "button-name": { enabled: false } });
    expect(violations, summarize(violations)).toEqual([]);
  });

  it.fails("DEFEKT: ani selektor okna, ani filtr grup nie ma nazwy dostepnej", async () => {
    // Oba `SelectTrigger` renderuja `<button role="combobox">` bez `aria-label`
    // i bez `<label>`. `SelectValue` nie ma nawet `placeholder`, wiec do
    // pierwszego otwarcia listy przyciski sa PUSTE - czytnik ekranu oglasza dwa
    // nieopisane comboboxy stojace obok siebie i nie da sie ich rozroznic.
    const { container } = panel();
    await loaded();

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
