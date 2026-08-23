// Warstwa DECYZJI widgetu darowizn: kwota, czas relatywny, procent paska i
// normalizacja konfiguracji z edytora CMS. RYZYKIEM jest tu PIENIĄDZ - ten
// moduł rozstrzyga, jaką liczbę i w jakiej walucie zobaczy darczyńca, a do
// niedawna dało się go dotknąć wyłącznie przez sześć wariantów wizualnych
// (79,16% linii / 65,62% gałęzi całego widoku).
//
// CO TEN PLIK DOWODZI.
//   1. `fmtMoney` zmienia liczbę miejsc po przecinku ZALEŻNIE OD KWOTY
//      (`cents % 100 === 0`), więc jedna lista pokazuje „1 zł” obok „1,50 zł”.
//      Kompilator tego nie widzi - to jeden wyraz w opcjach `Intl`.
//   2. Gałąź `catch` w `fmtMoney` (niepoprawny kod waluty - `Intl` rzuca
//      `RangeError`) formatuje `toFixed(0)`, czyli ZAOKRĄGLA 1,50 do „2”.
//      To jest zawyżona kwota na ekranie, a nie brakujący symbol waluty.
//   3. `fmtRelative` czyta `Date.now()` i ma napisy wpisane w kod - bez
//      zamrożonego zegara nie da się jej sprawdzić, a bez tego testu nikt nie
//      zauważy, że data z przyszłości daje „0 min temu”, a nieparsowalna
//      „NaN dni temu”.
//   4. Pasek postępu BEZ CELU liczy darczyńców × 5 jako procent - 20 wpłat
//      maluje go na 100% przy zerowym celu.
//   5. Trzy różne konwencje boolean w jednej funkcji (`!== false`, `=== true`)
//      oraz pierwszeństwo waluty z edytora nad walutą zbiórki.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Renderu wariantów i stanu zapytania dowodzi
// `DonationsWidgetView.test.tsx`; atomy mają własne testy w `atoms/__tests__`.
// Tu nie ma ani Reacta, ani react-query - moduł ich nie zna.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK,
  computeProgressPct,
  fmtMoney,
  fmtRelative,
  resolveBarPct,
  resolveWidgetProps,
  type DonationsWidgetProps,
  type StatsShape,
} from "../donationsWidgetModel";

/** Statystyki zbiórki - jawnie, bez fixture'ów: test ma pokazywać liczby. */
function stats(over: Partial<StatsShape> = {}): StatsShape {
  return { ...FALLBACK, recent: [], ...over };
}

/** Atrapa `t` - echo z prefiksem, żeby było WIDAĆ, co przeszło przez słownik. */
function tSpy() {
  return vi.fn((key: string) => `T:${key}`);
}

function resolve(props: DonationsWidgetProps, over: Partial<StatsShape> = {}, language = "pl") {
  const t = tSpy();
  return { view: resolveWidgetProps(props, stats(over), { language, t }), t };
}

describe("fmtMoney - kwota, którą widzi darczyńca", () => {
  it("DECYZJA: pełne złotówki tracą część dziesiętną, bo cents % 100 === 0", () => {
    expect(fmtMoney(100, "PLN", "pl")).toBe("1\u00a0zł");
    expect(fmtMoney(0, "PLN", "pl")).toBe("0\u00a0zł");
  });

  it("DECYZJA: 150 gr pokazuje grosze - ta sama lista ma dwie szerokości kolumny kwot", () => {
    expect(fmtMoney(150, "PLN", "pl")).toBe("1,50\u00a0zł");
  });

  it("DECYZJA: wersja EN formatuje po europejsku (en-GB), nie po amerykańsku", () => {
    expect(fmtMoney(150, "EUR", "en")).toBe("€1.50");
    expect(fmtMoney(100, "PLN", "en")).toBe("PLN\u00a01");
  });

  it("DECYZJA: waluta zbiórki wchodzi do Intl bez sprawdzenia - EUR obok złotówek", () => {
    expect(fmtMoney(100, "EUR", "pl")).toBe("1\u00a0€");
  });

  it("DECYZJA: niepoprawny kod waluty nie wywala widgetu - odpowiada gałąź catch", () => {
    // `Intl.NumberFormat` rzuca RangeError na „ZZZZ”; catch składa napis ręcznie.
    expect(fmtMoney(150, "ZZZZ", "pl")).toBe("2 ZZZZ");
  });

  it("DECYZJA: pusty kod waluty też trafia w catch i zostawia sam osierocony odstęp", () => {
    expect(fmtMoney(150, "", "pl")).toBe("2 ");
  });

  it.fails("DEFEKT: gałąź catch POWINNA zachować grosze, a nie ZAWYŻAĆ kwoty (1,50 -> „2”)", () => {
    // Oczekiwane: awaryjne formatowanie zachowuje część groszową, tak jak
    // ścieżka główna. Dziś `toFixed(0)` zaokrągla 1,50 w GÓRĘ, więc przy
    // złym kodzie waluty widget pokazuje kwotę WYŻSZĄ niż zebrana.
    expect(fmtMoney(150, "ZZZZ", "pl")).toBe("1.50 ZZZZ");
  });
});

describe("fmtRelative - granice czasu przy zamrożonym zegarze", () => {
  const NOW = new Date("2026-08-23T12:00:00.000Z");
  /** Data przesunięta o `minutes` W TYŁ od zamrożonego „teraz”. */
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("DECYZJA: 59 minut to jeszcze minuty, 60 minut przeskakuje na godziny", () => {
    expect(fmtRelative(ago(59), "pl")).toBe("59 min temu");
    expect(fmtRelative(ago(60), "pl")).toBe("1 godz. temu");
  });

  it("DECYZJA: 23 godziny to jeszcze godziny, 24 godziny przeskakują na dni", () => {
    expect(fmtRelative(ago(23 * 60), "pl")).toBe("23 godz. temu");
    // Liczebnik nie jest odmieniany - dokładnie 24 h daje „1 dni temu”.
    expect(fmtRelative(ago(24 * 60), "pl")).toBe("1 dni temu");
    expect(fmtRelative(ago(48 * 60), "pl")).toBe("2 dni temu");
  });

  it("DECYZJA: data z PRZYSZŁOŚCI daje „0 min temu” (Math.max), nie napis o przyszłości", () => {
    expect(fmtRelative(ago(-90), "pl")).toBe("0 min temu");
  });

  it("DECYZJA: EN ma własne, krótsze skróty na tych samych granicach", () => {
    expect(fmtRelative(ago(5), "en")).toBe("5 min ago");
    expect(fmtRelative(ago(120), "en")).toBe("2h ago");
    expect(fmtRelative(ago(72 * 60), "en")).toBe("3d ago");
  });

  it('DŁUG i18n: napisy są wpisane w kod - o języku decyduje jeden `=== "pl"`', () => {
    // Każdy język inny niż „pl” dostaje ANGIELSKI napis, bo nie ma tu żadnego
    // słownika - jest tylko binarny warunek.
    expect(fmtRelative(ago(5), "de" as never)).toBe("5 min ago");
  });

  it("DECYZJA: nieparsowalna data renderuje się jako „NaN dni temu”, nie znika", () => {
    expect(fmtRelative("nie-jest-datą", "pl")).toBe("NaN dni temu");
  });

  it.fails("DEFEKT: nieparsowalna data POWINNA dać pusty napis, jak `formatDate` domu", () => {
    // `src/lib/i18n/format.ts` zwraca "" dla `Number.isNaN(d.getTime())`.
    // `fmtRelative` tej konwencji nie zna i wypisuje czytelnikowi „NaN”.
    expect(fmtRelative("nie-jest-datą", "pl")).toBe("");
  });

  it.fails("DŁUG i18n: słownik widgetu POWINIEN nieść etykiety czasu relatywnego", () => {
    // Oczekiwane: „min temu”/„godz. temu”/„dni temu” pochodzą z
    // `i18n-donations-widget.ts` (i mają parę EN), więc redakcja może je
    // poprawić bez zmiany kodu. Dziś w słowniku NIE MA takiego klucza.
    const dict = readFileSync("src/lib/i18n-donations-widget.ts", "utf8");
    expect(dict).toMatch(/minAgo|minutesAgo|hoursAgo|daysAgo|relativeTime/);
  });

  it("DŁUG i18n: literały czasu siedzą w kodzie modułu - tu jest dowód miejsca", () => {
    const src = readFileSync("src/components/donations/donationsWidgetModel.ts", "utf8");
    expect(src).toContain("min temu");
    expect(src).toContain("godz. temu");
    expect(src).toContain("dni temu");
  });
});

describe("computeProgressPct - arytmetyka celu zbiórki", () => {
  it("DECYZJA: brak celu daje 0%, a nie dzielenie przez zero", () => {
    expect(computeProgressPct(0, 500_00)).toBe(0);
  });

  it("DECYZJA: ujemny cel również daje 0%", () => {
    expect(computeProgressPct(-1, 500_00)).toBe(0);
  });

  it("DECYZJA: przekroczenie celu jest PRZYCINANE do 100%, nadwyżki nie widać", () => {
    expect(computeProgressPct(100_00, 250_00)).toBe(100);
  });

  it("DECYZJA: wynik jest zaokrąglany do pełnych procentów", () => {
    expect(computeProgressPct(300_00, 100_00)).toBe(33);
    expect(computeProgressPct(3_00, 2_00)).toBe(67);
  });
});

describe("resolveBarPct - wypełnienie paska w wariantach progress i thermometer", () => {
  it("DECYZJA: z celem pasek pokazuje procent realizacji celu", () => {
    expect(resolveBarPct(100_00, 42, 3)).toBe(42);
  });

  it("DEFEKT (przypięty): BEZ celu pasek pokazuje LICZBĘ DARCZYŃCÓW × 5 jako procent", () => {
    expect(resolveBarPct(0, 0, 3)).toBe(15);
    // 20 wpłat po złotówce = „pełny” pasek, choć żaden cel nie został ustawiony.
    expect(resolveBarPct(0, 0, 20)).toBe(100);
    expect(resolveBarPct(0, 0, 999)).toBe(100);
  });

  it.fails("DEFEKT: bez celu pasek POWINIEN być pusty - liczba wpłat nie jest procentem", () => {
    expect(resolveBarPct(0, 0, 20)).toBe(0);
  });
});

describe("resolveWidgetProps - normalizacja konfiguracji z edytora CMS", () => {
  it("DECYZJA: brak wariantu to `hero`, brak adresu to `/support`", () => {
    const { view } = resolve({});
    expect(view.variant).toBe("hero");
    expect(view.href).toBe("/support");
  });

  it("DECYZJA: adres z samych białych znaków degraduje do `/support`, nie do pustego linku", () => {
    expect(resolve({ href: "   " }).view.href).toBe("/support");
    expect(resolve({ href: "  /wspieraj  " }).view.href).toBe("/wspieraj");
  });

  it("DECYZJA: brak CTA bierze napis ze słownika - to JEDYNY klucz, po który sięga model", () => {
    const { view, t } = resolve({});
    expect(view.cta).toBe("T:donationsWidget.cta");
    expect(t.mock.calls.map(([key]) => key)).toEqual(["donationsWidget.cta"]);
  });

  it("DECYZJA: własny CTA jest przycinany i NIE woła słownika", () => {
    const { view, t } = resolve({ cta: "  Wesprzyj nas  " });
    expect(view.cta).toBe("Wesprzyj nas");
    expect(t).not.toHaveBeenCalled();
  });

  it("DŁUG i18n: domyślny tytuł to LITERAŁ w kodzie, choć słownik jest zaimportowany", () => {
    const { view: pl, t } = resolve({});
    expect(pl.title).toBe("Mecenat obywatelski");
    expect(t.mock.calls.map(([key]) => key)).not.toContain("donationsWidget.title");
    expect(resolve({ lang: "en" }).view.title).toBe("Citizen patronage");
  });

  it.fails("DŁUG i18n: domyślny tytuł POWINIEN pochodzić z t(), tak jak CTA obok", () => {
    // Oczekiwane: tytuł jedzie przez słownik (atrapa `t` prefiksuje „T:”),
    // więc redakcja zmienia go bez wdrożenia kodu.
    expect(resolve({}).view.title.startsWith("T:")).toBe(true);
  });

  it("DECYZJA: tytuł i podtytuł z edytora są przycinane; sam odstęp znaczy „brak”", () => {
    const { view } = resolve({ title: "  Zbiórka  ", subtitle: "   " });
    expect(view.title).toBe("Zbiórka");
    expect(view.subtitle).toBe("");
    expect(resolve({ subtitle: "  Damy radę  " }).view.subtitle).toBe("Damy radę");
  });

  it("DECYZJA: język bierze się z i18n.language porównanego DOKŁADNIE z „en”", () => {
    expect(resolve({}, {}, "en").view.lang).toBe("en");
    expect(resolve({}, {}, "pl").view.lang).toBe("pl");
  });

  it("DEFEKT (przypięty): „en-US” daje POLSKI - porównanie jest dokładne, nie prefiksowe", () => {
    expect(resolve({}, {}, "en-US").view.lang).toBe("pl");
    expect(resolve({}, {}, "en-US").view.title).toBe("Mecenat obywatelski");
  });

  it.fails("DEFEKT: „en-US” POWINNO dać angielski - dom ma na to `uiLang()`", () => {
    // `src/lib/i18n/format.ts` normalizuje język przez `startsWith("en")`.
    // Widget darowizn ma własną, węższą regułę i pokazuje Anglikowi polski
    // tytuł na stronie z prośbą o pieniądze.
    expect(resolve({}, {}, "en-US").view.lang).toBe("en");
  });

  it("DECYZJA: prop `lang` bije język interfejsu", () => {
    expect(resolve({ lang: "en" }, {}, "pl").view.lang).toBe("en");
    expect(resolve({ lang: "pl" }, {}, "en").view.lang).toBe("pl");
  });

  it("DECYZJA: cel zbiórki jest przycinany do liczby nieujemnej", () => {
    expect(resolve({ goalCents: -500 }).view.goalCents).toBe(0);
    expect(resolve({ goalCents: Number.NaN }).view.goalCents).toBe(0);
    expect(resolve({}).view.goalCents).toBe(0);
    expect(resolve({ goalCents: 250_00 }).view.goalCents).toBe(250_00);
  });

  it("DECYZJA: trzy różne konwencje boolean naraz - dwa przełączniki domyślnie WŁĄCZONE, jeden WYŁĄCZONY", () => {
    const { view } = resolve({});
    expect(view.showMonth).toBe(true); // `!== false`
    expect(view.showCount).toBe(true); // `!== false`
    expect(view.showRecent).toBe(false); // `=== true`
  });

  it("DECYZJA: tylko dosłowne `false` gasi miesiąc i licznik darczyńców", () => {
    expect(resolve({ showMonth: false, showCount: false }).view).toMatchObject({
      showMonth: false,
      showCount: false,
    });
    expect(resolve({ showRecent: true }).view.showRecent).toBe(true);
  });

  it("DECYZJA: waluta z edytora BIJE walutę zbiórki - to przemianowanie, nie przeliczenie", () => {
    const { view } = resolve({ currency: " PLN " }, { currency: "EUR", totalCents: 100_00 });
    expect(view.currency).toBe("PLN");
    // Kwota pozostaje ta sama liczba - zmienia się wyłącznie etykieta.
    expect(fmtMoney(100_00, view.currency, view.lang)).toBe("100\u00a0zł");
  });

  it.fails("DEFEKT: prop waluty NIE POWINIEN etykietować euro złotówkami", () => {
    // Oczekiwane: jednostkę wyznacza zbiórka (`stats.currency`), bo to w niej
    // pieniądze naprawdę wpłynęły; edytor może zmienić najwyżej format.
    const { view } = resolve({ currency: "PLN" }, { currency: "EUR", totalCents: 100_00 });
    expect(view.currency).toBe("EUR");
  });

  it("DECYZJA: bez propu waluta bierze się ze zbiórki, a pusta z obu stron to PLN", () => {
    expect(resolve({}, { currency: "EUR" }).view.currency).toBe("EUR");
    expect(resolve({ currency: "   " }, { currency: "" }).view.currency).toBe("PLN");
  });

  it("DECYZJA: tryb akcji - `mode` bije zgodność wsteczną `quickDonate`", () => {
    expect(resolve({}).view.actionMode).toBe("link");
    expect(resolve({ quickDonate: true }).view.actionMode).toBe("quick");
    expect(resolve({ quickDonate: false }).view.actionMode).toBe("link");
    expect(resolve({ mode: "form", quickDonate: true }).view.actionMode).toBe("form");
  });

  it("DECYZJA: procent postępu wjeżdża do wyniku policzony ze statystyk, nie z propsów", () => {
    const { view } = resolve({ goalCents: 200_00 }, { totalCents: 50_00 });
    expect(view.progressPct).toBe(25);
    expect(resolve({ goalCents: 0 }, { totalCents: 50_00 }).view.progressPct).toBe(0);
  });

  it("DECYZJA: akcent z edytora jest przycinany; same białe znaki znaczą „brak akcentu”", () => {
    expect(resolve({ accent: "  #ff0000  " }).view.accent).toBe("#ff0000");
    expect(resolve({ accent: "   " }).view.accent).toBe("");
    expect(resolve({}).view.accent).toBe("");
  });
});

describe("FALLBACK - kształt podstawiany zamiast danych", () => {
  it("DECYZJA: awaryjny kształt to ZERA w PLN, czyli nieodróżnialne od pustej zbiórki", () => {
    expect(FALLBACK).toEqual({
      totalCents: 0,
      monthCents: 0,
      count: 0,
      monthCount: 0,
      currency: "PLN",
      recent: [],
    });
  });
});
