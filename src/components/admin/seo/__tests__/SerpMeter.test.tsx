// CO DOWODZI TEN PLIK: wskaźnik pikselowy pod polami SEO tłumaczy metrykę
// `SerpMetric` na JEDEN pasek i JEDNĄ etykietę - i robi to zgodnie z regułą
// „szerokość = ratio, ale nigdy poniżej 4% i nigdy powyżej 100%, a stan pusty
// to twarde 0%". Każdy z czterech poziomów oceny (empty/short/good/long) jest
// tu sprawdzony osobno: kolor paska, klucz etykiety i wyliczona szerokość.
//
// DLACZEGO TO WAŻNE DLA UŻYTKOWNIKA. Redakcja nie liczy pikseli w głowie -
// czyta pasek. Gdy reguła klamry pęknie:
//   * brak dolnej klamry przy `short` daje pasek o zerowej szerokości, czyli
//     wizualnie NIEODRÓŻNIALNY od pustego pola - redaktor nie widzi, że coś
//     już wpisał, tylko że „nadal nic nie ma",
//   * dolna klamra zastosowana także do `empty` (pasek 4% na pustym polu)
//     kłamie w drugą stronę: sugeruje wpisaną treść tam, gdzie jej nie ma,
//   * brak górnej klamry przy `long` (ratio > 1) rozpycha pasek poza tor i
//     zabiera jedyny sygnał „jesteś ZA limitem", bo pasek pełny wygląda jak
//     pasek idealny.
// Metryki bierzemy z PRAWDZIWYCH `serpTitleMetric`/`serpDescriptionMetric` na
// realnych napisach - inaczej test potwierdzałby własną arytmetykę, a nie to,
// co wskaźnik pokaże redakcji. Ręcznie zbudowany `SerpMetric` pojawia się
// WYŁĄCZNIE tam, gdzie trzeba wymusić skrajne ratio dla klamr.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * nie liczy szerokości pikselowej ani nie ocenia progów od nowa - to jest
//     kontrakt `src/lib/seo/__tests__/serp.test.ts` („grades empty, short, good
//     and long", „description uses the wider budget"); tutaj metryka jest
//     WEJŚCIEM, a dowodem jest to, co z niej robi warstwa widoku,
//   * nie sprawdza brzmienia etykiet (asercje idą po kluczach i18n),
//   * nie dubluje `e2e/seo.spec.ts` - jedyny test e2e stykający się z tą
//     powierzchnią to „/admin/seo is auth-gated (redirects to /auth or /login)",
//     który dowodzi WYŁĄCZNIE bramki auth i nigdy nie renderuje wskaźnika.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  serpDescriptionMetric,
  serpTitleMetric,
  SERP_DESCRIPTION_LIMIT_PX,
  SERP_TITLE_LIMIT_PX,
  type SerpMetric,
} from "@/lib/seo/serp";
import { SerpMeter } from "../SerpMeter";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const K = {
  empty: "admin.seo.meter.empty",
  short: "admin.seo.meter.short",
  good: "admin.seo.meter.good",
  long: "admin.seo.meter.long",
} as const;

/** Realne napisy dobrane tak, żeby PRAWDZIWA metryka trafiła w dany poziom. */
const TITLE_SHORT = "Krotki tytul";
const TITLE_TINY = "i"; // najwęższa klasa znaku - 6px, ratio 0.01
const TITLE_GOOD = "Polska prezydencja w Radzie Unii Europejskiej 2025";
const DESC_GOOD =
  "Opis o dobrej dlugosci dla wyniku wyszukiwania, ktory miesci sie w limicie pikseli i nie jest ani zbyt krotki, ani zbyt dlugi dla Google.";
const DESC_LONG =
  "Ten opis jest zdecydowanie zbyt dlugi na wynik wyszukiwania Google, poniewaz zawiera wiele zdan i szczegolow, ktore i tak nie zmieszcza sie w limicie dziewieciuset szescdziesieciu pikseli renderowanej szerokosci, a wiec zostanie obciety wielokropkiem przez podglad panelu redakcyjnego.";

/**
 * Pasek to jedyny element wskaźnika z szerokością wyliczaną w JS, więc szukamy
 * go po obecności atrybutu `style` - nie po klasie Tailwind ani po pozycji w
 * drzewie (jedno i drugie może się zmienić bez zmiany kontraktu).
 */
function renderMeter(metric: SerpMetric): HTMLElement {
  const { container } = render(<SerpMeter metric={metric} />);
  const bar = container.querySelector<HTMLElement>("div[style]");
  if (!bar) throw new Error("wskaźnik nie wyrenderował paska z wyliczoną szerokością");
  return bar;
}

afterEach(cleanup);

describe("SerpMeter - poziomy oceny", () => {
  it("stan pusty: pasek na twardym 0%, nie na dolnej klamrze 4%", () => {
    const metric = serpTitleMetric("");
    expect(metric.grade).toBe("empty");
    const bar = renderMeter(metric);
    // Klucz: 0%, a NIE Math.max(pct, 4). Pusty pasek = pusty pasek.
    expect(bar.style.width).toBe("0%");
    expect(screen.getByText(K.empty)).toBeTruthy();
    expect(screen.getByText(`0px / ${SERP_TITLE_LIMIT_PX}px`)).toBeTruthy();
  });

  it("stan pusty wygrywa z klamrą, nawet gdy metryka poda niezerowe ratio", () => {
    // Ręczna metryka: sprzeczne wejście (grade empty + ratio 0.5) pokazuje, że
    // o zerowej szerokości decyduje POZIOM OCENY, a nie samo ratio.
    const bar = renderMeter({ px: 0, limitPx: SERP_TITLE_LIMIT_PX, ratio: 0.5, grade: "empty" });
    expect(bar.style.width).toBe("0%");
  });

  it("tytuł za krótki: etykieta short i pasek proporcjonalny do ratio", () => {
    const metric = serpTitleMetric(TITLE_SHORT);
    expect(metric.grade).toBe("short");
    const bar = renderMeter(metric);
    expect(bar.style.width).toBe(`${Math.round(metric.ratio * 100)}%`);
    expect(bar.style.width).toBe("19%");
    expect(screen.getByText(K.short)).toBeTruthy();
  });

  it("tytuł za krótki przy znikomym ratio: pasek podniesiony do 4% (dolna klamra)", () => {
    const metric = serpTitleMetric(TITLE_TINY);
    expect(metric.grade).toBe("short");
    // Surowe ratio dałoby 1% - klamra podnosi do 4%, żeby pasek był widoczny.
    expect(Math.round(metric.ratio * 100)).toBe(1);
    expect(renderMeter(metric).style.width).toBe("4%");
  });

  it("dolna klamra działa też przy ratio zaokrąglającym się do zera", () => {
    // Ręczna metryka: realny napis nie zejdzie poniżej 6px, a klamra musi
    // trzymać także dla ratio zaokrąglanego w dół do 0%.
    const bar = renderMeter({ px: 1, limitPx: SERP_TITLE_LIMIT_PX, ratio: 0.0001, grade: "short" });
    expect(bar.style.width).toBe("4%");
  });

  it("tytuł w dobrym zakresie: etykieta good i pasek na wyliczonym ratio", () => {
    const metric = serpTitleMetric(TITLE_GOOD);
    expect(metric.grade).toBe("good");
    const bar = renderMeter(metric);
    expect(bar.style.width).toBe("86%");
    expect(screen.getByText(K.good)).toBeTruthy();
    expect(screen.getByText(`${metric.px}px / ${SERP_TITLE_LIMIT_PX}px`)).toBeTruthy();
  });

  it("opis w dobrym zakresie liczy się względem szerszego budżetu 960px", () => {
    const metric = serpDescriptionMetric(DESC_GOOD);
    expect(metric.grade).toBe("good");
    const bar = renderMeter(metric);
    expect(bar.style.width).toBe("97%");
    expect(screen.getByText(`${metric.px}px / ${SERP_DESCRIPTION_LIMIT_PX}px`)).toBeTruthy();
  });

  it("opis za długi: etykieta long, a pasek OBCIĘTY do 100% mimo ratio > 1", () => {
    const metric = serpDescriptionMetric(DESC_LONG);
    expect(metric.grade).toBe("long");
    expect(metric.ratio).toBeGreaterThan(1);
    const bar = renderMeter(metric);
    expect(bar.style.width).toBe("100%");
    expect(screen.getByText(K.long)).toBeTruthy();
    // Licznik pokazuje PRAWDZIWĄ szerokość, nawet gdy pasek stoi na 100% -
    // inaczej redaktor nie wie, o ile przekroczył limit.
    expect(screen.getByText(`${metric.px}px / ${SERP_DESCRIPTION_LIMIT_PX}px`)).toBeTruthy();
    expect(metric.px).toBeGreaterThan(SERP_DESCRIPTION_LIMIT_PX);
  });

  it("górna klamra trzyma także przy skrajnym ratio", () => {
    // Ręczna metryka: pięciokrotne przekroczenie limitu nadal daje 100%.
    const bar = renderMeter({ px: 3000, limitPx: SERP_TITLE_LIMIT_PX, ratio: 5, grade: "long" });
    expect(bar.style.width).toBe("100%");
  });
});

describe("SerpMeter - ton paska per poziom", () => {
  // Każdy poziom ma WŁASNY kolor: cztery różne tony to jedyny sposób, w jaki
  // redaktor rozpoznaje stan bez czytania etykiety.
  const TONE: ReadonlyArray<readonly [SerpMetric["grade"], string]> = [
    ["empty", "bg-muted-foreground/30"],
    ["short", "bg-amber-500"],
    ["good", "bg-emerald-500"],
    ["long", "bg-destructive"],
  ];

  it.each(TONE)("poziom %s dostaje ton %s", (grade, tone) => {
    const bar = renderMeter({ px: 100, limitPx: SERP_TITLE_LIMIT_PX, ratio: 0.5, grade });
    expect(bar.className).toContain(tone);
  });

  it("tony są parami różne, więc żaden poziom nie udaje innego", () => {
    expect(new Set(TONE.map(([, tone]) => tone)).size).toBe(TONE.length);
  });
});
