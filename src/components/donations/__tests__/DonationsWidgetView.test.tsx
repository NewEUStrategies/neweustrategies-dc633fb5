// Widget CMS „Darowizny" (`DonationsWidgetView`): sześć wariantów wizualnych
// nad tymi samymi publicznymi statystykami zbiórki.
//
// CO TEN PLIK DOWODZI:
//   1. KAŻDY WARIANT POKAZUJE TE SAME LICZBY. Suma, miesiąc i liczba darczyńców
//      pochodzą z jednego odczytu (`getDonationsPublicStats`); wariant zmienia
//      wyłącznie układ, a przełączniki `showMonth`/`showCount` działają w każdym.
//   2. POSTĘP DO CELU JEST UCZCIWY. Procent liczony od celu i przycięty do 100 -
//      nadwyżka nie rozpycha paska poza ramkę. Bez celu warianty z paskiem nie
//      udają procentu, tylko rysują umowne wypełnienie od liczby wpłat.
//   3. KWOTA NIGDY NIE WYWRACA WIDGETU. Waluta wpisana w panelu ręcznie bywa
//      błędna; `Intl` rzuca wtedy wyjątkiem, a widget ma pokazać liczbę z kodem.
//   4. JEDEN TRYB AKCJI DLA WSZYSTKICH WARIANTÓW. `quickDonate`/`mode` trafia do
//      `DonationCta` identycznie w każdym wariancie - przycisk nie może prowadzić
//      gdzie indziej tylko dlatego, że redakcja zmieniła wygląd bloku.
//
// GRANICE: funkcja serwerowa statystyk i most `useServerFn`, cel darowizny
// (`useDonationTarget` - konfiguracja modułu ma własne testy) oraz i18n (atrapa
// zwraca KLUCZ, a jej język steruje gałęzią „język z interfejsu"). `DonationCta`
// biegnie PRAWDZIWY - to on zamienia tryb na adres.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DonationsPublicStats } from "@/lib/billing/donations.functions";
import type { DonationTarget } from "@/lib/billing/donationTarget";

const h = vi.hoisted(() => ({
  language: "pl",
  getStats: vi.fn(),
  target: { kind: "internal", href: "/donate", external: false } as DonationTarget,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-donations-widget", () => ({}));
vi.mock("@/lib/i18n-donate", () => ({ ensureI18n: () => undefined }));
// Mock CZĘŚCIOWY - `createIsomorphicFn` z tego modułu napędza runtime i18n.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/billing/donations.functions", () => ({
  getDonationsPublicStats: (...args: unknown[]) => h.getStats(...args),
}));
vi.mock("@/lib/billing/donationsConfigQuery", () => ({
  useDonationTarget: () => h.target,
}));

import {
  DonationsWidgetView,
  type DonationsVariant,
  type DonationsWidgetProps,
} from "@/components/donations/DonationsWidgetView";

/** Ten sam klucz, pod którym widget trzyma odczyt - odpowiednik rozgrzewki SSR. */
const STATS_KEY = ["donations", "public-stats"] as const;
const VARIANTS: DonationsVariant[] = [
  "hero",
  "progress",
  "stats-strip",
  "compact-card",
  "inline-bar",
  "thermometer",
];
const NOW = new Date("2026-10-03T12:00:00.000Z");

function stats(over: Partial<DonationsPublicStats> = {}): DonationsPublicStats {
  return {
    totalCents: 125_000,
    monthCents: 32_000,
    count: 42,
    monthCount: 9,
    currency: "PLN",
    recent: [],
    truncated: false,
    ...over,
  };
}

/**
 * Montuje widget z gotowymi statystykami w cache (`null` = brak danych, widget
 * sam woła funkcję serwerową). Świeży klient na każde wywołanie.
 */
function renderWidget(
  props: DonationsWidgetProps = {},
  data: DonationsPublicStats | null = stats(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (data) client.setQueryData(STATS_KEY, data);
  return render(
    <QueryClientProvider client={client}>
      <DonationsWidgetView {...props} />
    </QueryClientProvider>,
  );
}

/** Kwoty z `Intl` niosą twarde spacje - porównujemy po normalizacji. */
function flat(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function widgetText(container: HTMLElement): string {
  return flat(container.textContent);
}

function cta(): HTMLAnchorElement {
  return screen.getByRole("link") as HTMLAnchorElement;
}

/** Element z inline `width`/`height` w procentach - pasek postępu albo termometr. */
function fillOf(container: HTMLElement, prop: "width" | "height"): string | undefined {
  const el = Array.from(container.querySelectorAll<HTMLElement>("div")).find((node) =>
    node.style[prop].endsWith("%"),
  );
  return el?.style[prop];
}

/**
 * Wartość boksu statystyk pod etykietą (wariant `stats-strip`). Etykieta sumy
 * występuje tam dwa razy (nagłówek paska i boks) - boks rozpoznajemy po ikonie.
 */
function statBoxValue(label: string): string {
  const box = screen.getAllByText(label).find((node) => node.querySelector("svg") !== null);
  if (!box) throw new Error(`test: brak boksu statystyk „${label}"`);
  return flat(box.nextElementSibling?.textContent);
}

beforeEach(() => {
  h.language = "pl";
  h.target = { kind: "internal", href: "/donate", external: false };
  h.getStats.mockReset().mockResolvedValue(stats());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
describe("hero (wariant domyślny)", () => {
  it("bez wariantu pokazuje sumę, miesiąc, liczbę darczyńców i link na /support", () => {
    const { container } = renderWidget();
    const text = widgetText(container);

    expect(text).toContain("Mecenat obywatelski");
    expect(text).toContain("1250 zł");
    expect(text).toContain("320 zł");
    expect(text).toContain("42");
    expect(text).toContain("donationsWidget.thisMonth");
    expect(text).toContain("donationsWidget.donors");
    expect(cta().getAttribute("href")).toBe("/support");
    expect(flat(cta().textContent)).toBe("donationsWidget.cta");
    // Bez celu nie ma paska i nie ma „z X" - nie udajemy zbiórki celowej.
    expect(text).not.toContain("donationsWidget.of");
    expect(fillOf(container, "width")).toBeUndefined();
  });

  it("z celem pokazuje procent i pasek wypełniony proporcjonalnie", () => {
    const { container } = renderWidget({ goalCents: 500_000 });

    expect(widgetText(container)).toContain("25% donationsWidget.of 5000 zł");
    expect(fillOf(container, "width")).toBe("25%");
  });

  it("nadwyżka ponad cel zatrzymuje się na 100%", () => {
    const { container } = renderWidget({ goalCents: 100_000 });

    expect(widgetText(container)).toContain("100% donationsWidget.of 1000 zł");
    expect(widgetText(container)).not.toContain("125%");
    expect(fillOf(container, "width")).toBe("100%");
  });

  it("cel ujemny albo nieliczbowy traktuje jak brak celu", () => {
    const { container } = renderWidget({ goalCents: -500 });
    expect(widgetText(container)).not.toContain("donationsWidget.of");
    cleanup();

    const second = renderWidget({ goalCents: Number.NaN });
    expect(widgetText(second.container)).not.toContain("donationsWidget.of");
  });

  it("przełączniki chowają miesiąc i liczbę darczyńców, suma zostaje", () => {
    const { container } = renderWidget({ showMonth: false, showCount: false });
    const text = widgetText(container);

    expect(text).toContain("1250 zł");
    expect(text).not.toContain("320 zł");
    expect(text).not.toContain("donationsWidget.thisMonth");
    expect(text).not.toContain("donationsWidget.donors");
  });

  it("własny tytuł, podtytuł, etykieta i adres są przycinane ze spacji", () => {
    renderWidget({
      title: "  Fundusz analiz  ",
      subtitle: "Każda wpłata finansuje raport",
      cta: "  Wesprzyj nas  ",
      href: "  /wsparcie  ",
    });

    expect(screen.getByText("Fundusz analiz")).toBeTruthy();
    expect(screen.getByText("Każda wpłata finansuje raport")).toBeTruthy();
    expect(flat(cta().textContent)).toBe("Wesprzyj nas");
    expect(cta().getAttribute("href")).toBe("/wsparcie");
  });

  it("adres z samych spacji wraca na /support, a pusta etykieta na domyślną", () => {
    renderWidget({ href: "   ", cta: "  " });

    expect(cta().getAttribute("href")).toBe("/support");
    expect(flat(cta().textContent)).toBe("donationsWidget.cta");
  });
});

// ---------------------------------------------------------------------------
describe("język widgetu", () => {
  it("bez propsa `lang` bierze język interfejsu - tytuł i kwoty po angielsku", () => {
    h.language = "en";
    const { container } = renderWidget();

    expect(widgetText(container)).toContain("Citizen patronage");
    expect(widgetText(container)).toContain("PLN 1,250");
  });

  it("jawny `lang` wygrywa z językiem interfejsu", () => {
    h.language = "en";
    const { container } = renderWidget({ lang: "pl" });

    expect(widgetText(container)).toContain("Mecenat obywatelski");
    expect(widgetText(container)).toContain("1250 zł");
  });
});

// ---------------------------------------------------------------------------
describe("kwoty i waluta", () => {
  it("błędny kod waluty z panelu nie wywraca widgetu - liczba z kodem", () => {
    const { container } = renderWidget({ currency: "ZL" });

    // `Intl.NumberFormat` rzuca RangeError na niepoprawnym kodzie waluty.
    expect(widgetText(container)).toContain("1250 ZL");
  });

  it("waluta z propsa wygrywa z walutą statystyk", () => {
    const { container } = renderWidget({ currency: "EUR", lang: "en" });

    expect(widgetText(container)).toContain("€1,250");
  });

  it("bez propsa bierze walutę zbiórki ze statystyk, a pustą zastępuje PLN", () => {
    const eur = renderWidget({ lang: "en" }, stats({ currency: "EUR" }));
    expect(widgetText(eur.container)).toContain("€1,250");
    cleanup();

    const empty = renderWidget({ lang: "pl" }, stats({ currency: "" }));
    expect(widgetText(empty.container)).toContain("1250 zł");
  });

  it("kwoty z groszami pokazują dwa miejsca po przecinku, okrągłe - żadnego", () => {
    const { container } = renderWidget({}, stats({ totalCents: 123_456, monthCents: 10_000 }));

    expect(widgetText(container)).toContain("1234,56 zł");
    expect(widgetText(container)).toContain("100 zł");
    expect(widgetText(container)).not.toContain("100,00 zł");
  });
});

// ---------------------------------------------------------------------------
describe("progress", () => {
  it("z celem pokazuje kwotę celu, procent i pasek", () => {
    const { container } = renderWidget({ variant: "progress", goalCents: 500_000 });

    expect(widgetText(container)).toContain("donationsWidget.of 5000 zł (25%)");
    expect(fillOf(container, "width")).toBe("25%");
  });

  it("bez celu wypełnia pasek umownie od liczby wpłat (5% na wpłatę, max 100%)", () => {
    const few = renderWidget({ variant: "progress" }, stats({ count: 4 }));
    expect(fillOf(few.container, "width")).toBe("20%");
    expect(widgetText(few.container)).not.toContain("donationsWidget.of");
    cleanup();

    const many = renderWidget({ variant: "progress" }, stats({ count: 42 }));
    expect(fillOf(many.container, "width")).toBe("100%");
  });

  it("miesiąc i darczyńcy są niezależnie przełączalni", () => {
    const onlyMonth = renderWidget({ variant: "progress", showCount: false });
    expect(widgetText(onlyMonth.container)).toContain("donationsWidget.thisMonth: 320 zł");
    expect(widgetText(onlyMonth.container)).not.toContain("donationsWidget.donors");
    cleanup();

    const onlyCount = renderWidget({ variant: "progress", showMonth: false });
    expect(widgetText(onlyCount.container)).toContain("donationsWidget.donors: 42");
    expect(widgetText(onlyCount.container)).not.toContain("donationsWidget.thisMonth");
    cleanup();

    const none = renderWidget({ variant: "progress", showMonth: false, showCount: false });
    expect(widgetText(none.container)).not.toContain("donationsWidget.thisMonth");
    expect(widgetText(none.container)).not.toContain("donationsWidget.donors");
  });

  it("podtytuł pojawia się pod paskiem", () => {
    renderWidget({ variant: "progress", subtitle: "Cel: niezależny raport roczny" });
    expect(screen.getByText("Cel: niezależny raport roczny")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("stats-strip", () => {
  it("pokazuje trzy boksy: suma, miesiąc, darczyńcy", () => {
    renderWidget({ variant: "stats-strip", title: "Mecenat" });

    expect(statBoxValue("donationsWidget.total")).toBe("1250 zł");
    expect(statBoxValue("donationsWidget.thisMonth")).toBe("320 zł");
    expect(statBoxValue("donationsWidget.donors")).toBe("42");
    expect(screen.getByText("Mecenat")).toBeTruthy();
  });

  it("przełączniki usuwają boks miesiąca i boks darczyńców", () => {
    const { container } = renderWidget({
      variant: "stats-strip",
      showMonth: false,
      showCount: false,
      subtitle: "Dziękujemy",
    });

    expect(widgetText(container)).not.toContain("donationsWidget.thisMonth");
    expect(widgetText(container)).not.toContain("donationsWidget.donors");
    expect(statBoxValue("donationsWidget.total")).toBe("1250 zł");
    expect(screen.getByText("Dziękujemy")).toBeTruthy();
  });

  it("kolor akcentu barwi etykiety boksów", () => {
    renderWidget({ variant: "stats-strip", accent: "#d97706" });

    const label = screen.getByText("donationsWidget.donors");
    expect(label.getAttribute("style") ?? "").toMatch(/d97706|217, 119, 6/i);
  });
});

// ---------------------------------------------------------------------------
describe("compact-card", () => {
  it("pokazuje sumę, linię miesiąca i podtytuł", () => {
    const { container } = renderWidget({
      variant: "compact-card",
      subtitle: "Wspieraj co miesiąc",
    });

    expect(widgetText(container)).toContain("1250 zł");
    expect(widgetText(container)).toContain("donationsWidget.thisMonth: 320 zł");
    expect(screen.getByText("Wspieraj co miesiąc")).toBeTruthy();
  });

  it("bez miesiąca zostaje sama suma", () => {
    const { container } = renderWidget({ variant: "compact-card", showMonth: false });

    expect(widgetText(container)).not.toContain("donationsWidget.thisMonth");
    expect(widgetText(container)).toContain("1250 zł");
  });
});

// ---------------------------------------------------------------------------
describe("inline-bar", () => {
  it("dokleja liczbę darczyńców do sumy, gdy są wpłaty", () => {
    const { container } = renderWidget({ variant: "inline-bar" });

    expect(widgetText(container)).toContain(
      "donationsWidget.total: 1250 zł · 42 donationswidget.donors",
    );
  });

  it("zero wpłat albo wyłączony licznik - bez dopisku o darczyńcach", () => {
    const zero = renderWidget({ variant: "inline-bar" }, stats({ count: 0 }));
    expect(widgetText(zero.container)).not.toContain("·");
    cleanup();

    const hidden = renderWidget({ variant: "inline-bar", showCount: false });
    expect(widgetText(hidden.container)).not.toContain("donationswidget.donors");
  });
});

// ---------------------------------------------------------------------------
describe("thermometer", () => {
  it("z celem wypełnia słupek procentem i podpisuje go", () => {
    const { container } = renderWidget({
      variant: "thermometer",
      goalCents: 500_000,
      subtitle: "Na raport roczny",
    });

    expect(fillOf(container, "height")).toBe("25%");
    expect(widgetText(container)).toContain("25%");
    expect(widgetText(container)).toContain("donationsWidget.of 5000 zł");
    expect(screen.getByText("Na raport roczny")).toBeTruthy();
  });

  it("bez celu słupek ma umowne wypełnienie i NIE ma podpisu procentowego", () => {
    const { container } = renderWidget({ variant: "thermometer" }, stats({ count: 3 }));

    expect(fillOf(container, "height")).toBe("15%");
    expect(widgetText(container)).not.toContain("%");
  });

  it("ostatnie wpłaty pokazuje dopiero po włączeniu `showRecent`", () => {
    const data = stats({
      recent: [{ amount_cents: 5_000, currency: "PLN", created_at: NOW.toISOString() }],
    });
    const off = renderWidget({ variant: "thermometer" }, data);
    expect(off.container.querySelector("ul")).toBeNull();
    cleanup();

    const empty = renderWidget({ variant: "thermometer", showRecent: true }, stats());
    expect(empty.container.querySelector("ul")).toBeNull();
  });

  it("czas wpłaty po polsku: minuty, godziny, dni (przyszłość = 0 min)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const data = stats({
      recent: [
        { amount_cents: 5_000, currency: "PLN", created_at: ago(5 * 60_000) },
        { amount_cents: 10_000, currency: "PLN", created_at: ago(3 * 3_600_000) },
        { amount_cents: 2_550, currency: "PLN", created_at: ago(2 * 86_400_000) },
        { amount_cents: 7_000, currency: "PLN", created_at: ago(-60_000) },
      ],
    });

    const { container } = renderWidget({ variant: "thermometer", showRecent: true }, data);

    const rows = Array.from(container.querySelectorAll("li")).map((li) => flat(li.textContent));
    expect(rows).toEqual([
      "50 zł5 min temu",
      "100 zł3 godz. temu",
      "25,50 zł2 dni temu",
      "70 zł0 min temu",
    ]);
  });

  it("czas wpłaty po angielsku: min / h / d", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const data = stats({
      recent: [
        { amount_cents: 5_000, currency: "PLN", created_at: ago(59 * 60_000) },
        { amount_cents: 5_000, currency: "PLN", created_at: ago(60 * 60_000) },
        { amount_cents: 5_000, currency: "PLN", created_at: ago(24 * 3_600_000) },
      ],
    });

    const { container } = renderWidget(
      { variant: "thermometer", showRecent: true, lang: "en" },
      data,
    );

    const times = Array.from(container.querySelectorAll("li")).map((li) =>
      flat(li.lastElementChild?.textContent),
    );
    expect(times).toEqual(["59 min ago", "1h ago", "1d ago"]);
  });
});

// ---------------------------------------------------------------------------
describe("kolor akcentu", () => {
  it.each(VARIANTS)("wariant %s wystawia akcent jako zmienną CSS i barwi przycisk", (variant) => {
    const { container } = renderWidget({ variant, accent: "  #d97706  " });

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--donation-accent")).toBe("#d97706");
    expect(cta().getAttribute("style") ?? "").toMatch(/d97706|217, 119, 6/i);
  });

  it.each(VARIANTS)("wariant %s bez akcentu nie nadpisuje stylu przycisku", (variant) => {
    const { container } = renderWidget({ variant });

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--donation-accent")).toBe("");
    expect(cta().getAttribute("style")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("tryb akcji - jeden dla każdego wariantu", () => {
  it.each(VARIANTS)("wariant %s: `quickDonate` prowadzi do naszej kasy", (variant) => {
    renderWidget({ variant, quickDonate: true });
    expect(cta().getAttribute("href")).toBe("/donate");
  });

  it.each(VARIANTS)("wariant %s: domyślnie link na wskazany adres", (variant) => {
    renderWidget({ variant, href: "/support" });
    expect(cta().getAttribute("href")).toBe("/support");
  });

  it("`quickDonate` przy zbiórce zewnętrznej otwiera ją w nowej karcie", () => {
    h.target = { kind: "external", href: "https://zbiorka.example/nes", external: true };
    renderWidget({ variant: "compact-card", quickDonate: true });

    expect(cta().getAttribute("href")).toBe("https://zbiorka.example/nes");
    expect(cta().getAttribute("target")).toBe("_blank");
    expect(cta().getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("jawny `mode` wygrywa z historycznym `quickDonate`", () => {
    renderWidget({ variant: "hero", quickDonate: true, mode: "link" });
    expect(cta().getAttribute("href")).toBe("/support");
    cleanup();

    renderWidget({ variant: "hero", mode: "form" });
    expect(cta().getAttribute("href")).toBe("/donate");
  });
});

// ---------------------------------------------------------------------------
describe("odczyt statystyk", () => {
  it("pobiera statystyki funkcją serwerową, a do odpowiedzi pokazuje zera", async () => {
    let resolve: (value: DonationsPublicStats) => void = () => {};
    h.getStats.mockReturnValue(
      new Promise<DonationsPublicStats>((r) => {
        resolve = r;
      }),
    );

    const { container } = renderWidget({ variant: "stats-strip" }, null);

    expect(h.getStats).toHaveBeenCalledTimes(1);
    expect(statBoxValue("donationsWidget.total")).toBe("0 zł");
    expect(statBoxValue("donationsWidget.donors")).toBe("0");

    await act(async () => {
      resolve(stats({ totalCents: 77_700, count: 5 }));
    });

    await waitFor(() => expect(statBoxValue("donationsWidget.total")).toBe("777 zł"));
    expect(statBoxValue("donationsWidget.donors")).toBe("5");
    expect(widgetText(container)).not.toContain("NaN");
  });

  it("awaria odczytu zostawia zera zamiast wywracać blok", async () => {
    h.getStats.mockRejectedValue(new Error("test: funkcja serwerowa niedostępna"));

    renderWidget({ variant: "stats-strip" }, null);

    await waitFor(() => expect(h.getStats).toHaveBeenCalled());
    expect(statBoxValue("donationsWidget.total")).toBe("0 zł");
    expect(cta().getAttribute("href")).toBe("/support");
  });
});
