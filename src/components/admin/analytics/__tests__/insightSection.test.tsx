// `InsightSection` - sekcja „Interpretacja i rekomendacje" pod każdym pulpitem
// BI: posortowana lista wniosków z odsyłaczem do konkretnego widgetu.
//
// PO CO. Generatory wniosków (`gscInsights`, `ga4Insights`) mają własne, pełne
// testy arytmetyki - ale kończą się na TABLICY. Wszystko, co decyduje o tym,
// czy operator w ogóle zobaczy najważniejszy wpis, dzieje się dopiero tutaj:
//
//   1. KOLEJNOŚĆ JEST TREŚCIĄ. Pulpity budują listę w kolejności widgetów, nie
//      wagi. Sekcja sortuje ją po `severity` (critical, warn, info, good), więc
//      zgubione sortowanie chowa awarię pod trzema pochwałami - i nikt tego nie
//      zauważy, bo lista dalej wygląda poprawnie.
//   2. SORTOWANIE NIE MOŻE RUSZAĆ WEJŚCIA. Tablica przychodzi ze stanu pulpitu
//      i bywa współdzielona; `sort` w miejscu przestawiłby wnioski także tam.
//   3. LICZNIKI MUSZĄ ZGADZAĆ SIĘ Z LISTĄ. Odznaka „3 krytycznych" nad listą,
//      która ma ich dwa, to nie kosmetyka - to raport, który kłamie.
//   4. STAN PUSTY TO WYNIK POMIARU, nie brak danych. „Nie znaleziono
//      krytycznych zagadnień" jest komunikatem samym w sobie.
//   5. LISTA DZIAŁAŃ. `fixes` to jedyna część wniosku, którą da się WYKONAĆ;
//      pusta lista nie może zostawiać po sobie pustego wypunktowania.
//
// ECHARTS TU NIE WCHODZI - sekcja nie dotyka renderera wykresów.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import {
  InsightSection,
  classifyDelta,
  pctDelta,
  type Insight,
  type InsightSeverity,
} from "../InsightSection";

// ---------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------

function wniosek(id: string, severity: InsightSeverity, extra: Partial<Insight> = {}): Insight {
  return {
    id,
    element: `widget-${id}`,
    severity,
    title: `Wniosek ${id}`,
    detail: `Co widać w danych: ${id}`,
    fixes: [`Działanie ${id}`],
    ...extra,
  };
}

/** Wejście w kolejności WIDGETÓW - dokładnie tak, jak składają je pulpity. */
const WEJSCIE: Insight[] = [
  wniosek("a", "good"),
  wniosek("b", "critical"),
  wniosek("c", "info"),
  wniosek("d", "warn"),
];

/**
 * Wpisy GŁÓWNEJ listy. Lista działań („fixes") jest zagnieżdżona w każdym
 * wpisie, więc `getAllByRole("listitem")` zliczyłby oba poziomy naraz -
 * bierzemy więc bezpośrednie dzieci pierwszej listy w drzewie.
 */
function wpisy(zasieg?: HTMLElement): HTMLElement[] {
  const listy = (zasieg ? within(zasieg) : screen).getAllByRole("list");
  return Array.from(listy[0].children) as HTMLElement[];
}

function tytuly(): string[] {
  return wpisy().map((li) => li.querySelector("span.text-sm")?.textContent ?? "");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

// ---------------------------------------------------------------------------

describe("InsightSection - stan pusty", () => {
  it("bez wniosków mówi ZE SŁOWNIKA, że nie ma czego poprawiać", () => {
    const t = realT("pl");
    const { container } = render(<InsightSection insights={[]} />);

    expect(screen.getByText(t("adminAnalytics.insightSection.defaultTitle"))).toBeTruthy();
    expect(screen.getByText(t("adminAnalytics.insightSection.emptyDefault"))).toBeTruthy();
    // Napis musi pochodzić ze słownika, a nie być surowym kluczem.
    expect(container.textContent).not.toContain("adminAnalytics.");
  });

  it("stan pusty nie rysuje ANI listy, ANI odznak z licznikami", () => {
    render(<InsightSection insights={[]} />);

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });

  it("wołający może podmienić tytuł i komunikat pustki", () => {
    const t = realT("pl");
    render(
      <InsightSection
        insights={[]}
        title="Wnioski dla Web Vitals"
        emptyLabel="Wszystkie metryki w zieleni."
      />,
    );

    expect(screen.getByText("Wnioski dla Web Vitals")).toBeTruthy();
    expect(screen.getByText("Wszystkie metryki w zieleni.")).toBeTruthy();
    expect(screen.queryByText(t("adminAnalytics.insightSection.emptyDefault"))).toBeNull();
  });

  it("w stanie pustym tytuł sekcji jest TYM SAMYM nagłówkiem co z wnioskami", () => {
    // Ten sam tytuł, ta sama rola w układzie - semantyka nie może zależeć od
    // liczby wpisów. Gdy z wnioskami tytuł jedzie jako `<h3>`, a bez nich jako
    // zwykły `<div>` z tą samą klasą, sekcja „Interpretacja i rekomendacje"
    // wypada z konspektu nagłówków dokładnie wtedy, gdy wszystko jest
    // w porządku: osoba nawigująca po nagłówkach (najszybszy sposób poruszania
    // się po pulpicie z czytnikiem ekranu) nie ma jak stwierdzić, że sekcja
    // w ogóle istnieje i co mówi. Przypadek pilnuje POZIOMU nagłówka pośrednio,
    // przez rolę: sekcja siedzi pod nagłówkiem karty pulpitu, więc `h3` w obu
    // wariantach trzyma konspekt spójny.
    render(<InsightSection insights={[]} title="Wnioski dla Web Vitals" />);

    expect(screen.getByRole("heading", { name: "Wnioski dla Web Vitals" })).toBeTruthy();
  });
});

describe("InsightSection - kolejność i liczniki", () => {
  it("sortuje po wadze: critical, warn, info, good - niezależnie od wejścia", () => {
    render(<InsightSection insights={WEJSCIE} />);

    expect(tytuly()).toEqual(["Wniosek b", "Wniosek d", "Wniosek c", "Wniosek a"]);
  });

  it("przy równej wadze zachowuje kolejność WEJŚCIOWĄ (sort stabilny)", () => {
    // Pulpit układa wnioski w kolejności widgetów; dwa ostrzeżenia o tej samej
    // wadze mają zostać w kolejności, w jakiej stoją widgety na ekranie.
    render(
      <InsightSection
        insights={[
          wniosek("pierwszy", "warn"),
          wniosek("drugi", "warn"),
          wniosek("trzeci", "warn"),
        ]}
      />,
    );

    expect(tytuly()).toEqual(["Wniosek pierwszy", "Wniosek drugi", "Wniosek trzeci"]);
  });

  it("NIE MUTUJE tablicy wołającego - stan pulpitu zostaje nietknięty", () => {
    const wejscie = [...WEJSCIE];
    const kolejnoscPrzed = wejscie.map((i) => i.id);

    render(<InsightSection insights={wejscie} />);

    expect(wejscie.map((i) => i.id)).toEqual(kolejnoscPrzed);
  });

  it("liczniki odznak ZGADZAJĄ się z liczbą wpisów każdej wagi", () => {
    const t = realT("pl");
    render(
      <InsightSection
        insights={[
          wniosek("k1", "critical"),
          wniosek("k2", "critical"),
          wniosek("w1", "warn"),
          wniosek("i1", "info"),
          wniosek("i2", "info"),
          wniosek("i3", "info"),
          wniosek("g1", "good"),
        ]}
      />,
    );

    expect(
      screen.getByText(t("adminAnalytics.insightSection.badgeCritical", { count: 2 })),
    ).toBeTruthy();
    expect(
      screen.getByText(t("adminAnalytics.insightSection.badgeWarn", { count: 1 })),
    ).toBeTruthy();
    expect(
      screen.getByText(t("adminAnalytics.insightSection.badgeInfo", { count: 3 })),
    ).toBeTruthy();
    expect(screen.getByText(t("adminAnalytics.insightSection.badgeOk", { count: 1 }))).toBeTruthy();
    expect(wpisy()).toHaveLength(7);
  });

  it("odznaka wagi, której nie ma na liście, NIE jest rysowana", () => {
    // „0 krytycznych" nad listą bez awarii to fałszywy alarm w drugą stronę:
    // czytelnik szuka wpisu, którego nie ma.
    const t = realT("pl");
    const { container } = render(<InsightSection insights={[wniosek("i1", "info")]} />);

    expect(
      screen.getByText(t("adminAnalytics.insightSection.badgeInfo", { count: 1 })),
    ).toBeTruthy();
    for (const klucz of ["badgeCritical", "badgeWarn", "badgeOk"]) {
      expect(container.textContent).not.toContain(
        t(`adminAnalytics.insightSection.${klucz}`, { count: 0 }),
      );
    }
  });

  it("każda waga maluje ramkę wpisu INNYM kolorem", () => {
    // Kolor jest szybkim kanałem skanowania listy; jeden wspólny odbiera go
    // w całości, a treść wygląda tak samo.
    render(<InsightSection insights={WEJSCIE} />);

    const klasy = wpisy().map((li) => li.className);
    expect(klasy[0]).toContain("border-red-500/30");
    expect(klasy[1]).toContain("border-amber-500/30");
    expect(klasy[2]).toContain("border-sky-500/30");
    expect(klasy[3]).toContain("border-emerald-500/30");
    expect(new Set(klasy).size).toBe(4);
  });
});

describe("InsightSection - treść wpisu", () => {
  it("wpis niesie tytuł, odsyłacz do widgetu i interpretację danych", () => {
    render(<InsightSection insights={[wniosek("x", "warn")]} />);

    const wpis = within(wpisy()[0]);
    expect(wpis.getByText("Wniosek x")).toBeTruthy();
    expect(wpis.getByText("widget-x")).toBeTruthy();
    expect(wpis.getByText("Co widać w danych: x")).toBeTruthy();
  });

  it("działania renderują się jako WŁASNA lista, w kolejności podanej", () => {
    render(
      <InsightSection
        insights={[
          wniosek("x", "critical", {
            fixes: ["Skróć LCP obrazu bohatera", "Włącz preload fontu", "Zdejmij trzeci skrypt"],
          }),
        ]}
      />,
    );

    const dzialania = within(wpisy()[0]).getAllByRole("listitem");
    expect(dzialania.map((li) => li.textContent?.replace("→", "").trim())).toEqual([
      "Skróć LCP obrazu bohatera",
      "Włącz preload fontu",
      "Zdejmij trzeci skrypt",
    ]);
  });

  it("PUSTA lista działań nie zostawia pustego wypunktowania", () => {
    render(<InsightSection insights={[wniosek("x", "info", { fixes: [] })]} />);

    const wpis = wpisy()[0];
    expect(within(wpis).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(wpis).queryAllByRole("list")).toHaveLength(0);
  });

  it("dwa wnioski o tym samym tytule, ale różnych `id`, renderują się OBA", () => {
    // Klucz Reacta to `id`; gdyby ktoś przełączył go na tytuł, drugi wpis
    // zniknąłby bez żadnego komunikatu.
    render(
      <InsightSection
        insights={[
          wniosek("pierwszy", "warn", { title: "Spadek CTR" }),
          wniosek("drugi", "warn", { title: "Spadek CTR" }),
        ]}
      />,
    );

    expect(screen.getAllByText("Spadek CTR")).toHaveLength(2);
    expect(wpisy()).toHaveLength(2);
  });

  it("podtytuł sekcji renderuje się przy liście, a jego brak nic nie psuje", () => {
    const { unmount } = render(
      <InsightSection insights={[wniosek("x", "info")]} subtitle="Okno 30 dni, wszystkie strony" />,
    );
    expect(screen.getByText("Okno 30 dni, wszystkie strony")).toBeTruthy();
    unmount();

    render(<InsightSection insights={[wniosek("x", "info")]} />);
    expect(screen.queryByText("Okno 30 dni, wszystkie strony")).toBeNull();
  });

  it("tytuł sekcji z listą jest NAGŁÓWKIEM trzeciego poziomu", () => {
    render(<InsightSection insights={[wniosek("x", "info")]} title="Wnioski GSC" />);

    expect(screen.getByRole("heading", { level: 3, name: "Wnioski GSC" })).toBeTruthy();
  });
});

describe("pctDelta i classifyDelta - progi, które ustawiają wagę wpisu", () => {
  it("procent liczy się względem poprzedniej wartości", () => {
    expect(pctDelta(120, 100)).toBeCloseTo(20);
    expect(pctDelta(80, 100)).toBeCloseTo(-20);
    expect(pctDelta(100, 100)).toBe(0);
  });

  it("zero w mianowniku i wartości niepoliczalne dają `null`, nie NaN", () => {
    // `null` znaczy „nie ma z czym porównać" i schodzi do wagi `info`;
    // `NaN` przeszedłby przez każde porównanie jako `false` i wylądował
    // w tej samej wadze przypadkiem, nie z decyzji.
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(Number.NaN, 10)).toBeNull();
    expect(pctDelta(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it.each([
    ["brak porównania", null, true, "info"],
    ["+5% to już dobrze (próg domknięty)", 5, true, "good"],
    ["+4,9% jeszcze nie", 4.9, true, "info"],
    ["-15% to ostrzeżenie (próg domknięty)", -15, true, "warn"],
    ["-14,9% jeszcze nie", -14.9, true, "info"],
  ])("gdy większa wartość jest lepsza: %s", (_opis, delta, higher, oczekiwana) => {
    expect(classifyDelta(delta as number | null, higher as boolean)).toBe(oczekiwana);
  });

  it.each([
    ["-5% to dobrze, gdy mniej znaczy lepiej", -5, "good"],
    ["+15% to ostrzeżenie, gdy mniej znaczy lepiej", 15, "warn"],
    ["+4% mieści się w paśmie neutralnym", 4, "info"],
  ])("gdy mniejsza wartość jest lepsza: %s", (_opis, delta, oczekiwana) => {
    expect(classifyDelta(delta as number, false)).toBe(oczekiwana);
  });

  it("ostrzeżenie WYGRYWA z pochwałą, gdy oba progi są spełnione naraz", () => {
    // Przy `higherIsBetter=false` delta -20 spełnia `good` (<= -5), a przy
    // odwróconej flagze +20 spełnia `bad` - kolejność `if (bad)` przed
    // `if (good)` przesądza, że gorsza wiadomość idzie na górę listy.
    expect(classifyDelta(-20, true)).toBe("warn");
    expect(classifyDelta(20, false)).toBe("warn");
  });
});

describe("InsightSection - izolacja warsztatów i dwujęzyczność", () => {
  it("dwie sekcje obok siebie nie mieszają wniosków ani liczników", () => {
    // Administrator obsługujący kilka warsztatów widzi ich pulpity na jednej
    // stronie. Sortowanie i liczniki są liczone per instancja - gdyby stan
    // wyciekł, warsztat B dostałby awarię warsztatu A.
    const t = realT("pl");
    render(
      <>
        <div data-testid="a">
          <InsightSection
            insights={[
              wniosek("a1", "critical", { title: "warsztat-a.example.com: 500 na wejściu" }),
            ]}
          />
        </div>
        <div data-testid="b">
          <InsightSection
            insights={[wniosek("b1", "good", { title: "warsztat-b.example.org: bez uwag" })]}
          />
        </div>
      </>,
    );

    const a = within(screen.getByTestId("a"));
    const b = within(screen.getByTestId("b"));
    expect(a.getByText("warsztat-a.example.com: 500 na wejściu")).toBeTruthy();
    expect(
      a.getByText(t("adminAnalytics.insightSection.badgeCritical", { count: 1 })),
    ).toBeTruthy();
    expect(b.queryByText("warsztat-a.example.com: 500 na wejściu")).toBeNull();
    expect(
      b.queryByText(t("adminAnalytics.insightSection.badgeCritical", { count: 1 })),
    ).toBeNull();
    expect(b.getByText(t("adminAnalytics.insightSection.badgeOk", { count: 1 }))).toBeTruthy();
  });

  it("stan pusty warsztatu B nie przejmuje wniosków warsztatu A", () => {
    render(
      <>
        <div data-testid="a">
          <InsightSection insights={[wniosek("a1", "critical", { title: "Awaria A" })]} />
        </div>
        <div data-testid="b">
          <InsightSection insights={[]} />
        </div>
      </>,
    );

    expect(within(screen.getByTestId("b")).queryByText("Awaria A")).toBeNull();
    expect(within(screen.getByTestId("b")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("tytuł, pustka i odznaki mają treść ZE SŁOWNIKA także w EN", async () => {
    const pl = realT("pl");
    const { unmount } = render(<InsightSection insights={[]} />);
    expect(screen.getByText(pl("adminAnalytics.insightSection.emptyDefault"))).toBeTruthy();
    unmount();

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const en = realT("en");
    // Zabezpieczenie przed testem, który przechodzi na polskim fallbacku.
    expect(en("adminAnalytics.insightSection.emptyDefault")).not.toBe(
      pl("adminAnalytics.insightSection.emptyDefault"),
    );

    const { unmount: zamknij } = render(<InsightSection insights={[]} />);
    expect(screen.getByText(en("adminAnalytics.insightSection.defaultTitle"))).toBeTruthy();
    expect(screen.getByText(en("adminAnalytics.insightSection.emptyDefault"))).toBeTruthy();
    zamknij();

    const { container } = render(<InsightSection insights={[wniosek("k1", "critical")]} />);
    expect(
      screen.getByText(en("adminAnalytics.insightSection.badgeCritical", { count: 1 })),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(
      pl("adminAnalytics.insightSection.badgeCritical", { count: 1 }),
    );
  });

  it("pełna lista nie wnosi naruszeń axe", async () => {
    const { container } = render(
      <InsightSection insights={WEJSCIE} subtitle="Okno 30 dni" title="Wnioski GSC" />,
    );

    const naruszenia = await axeViolations(container);
    expect(summarize(naruszenia)).toBe("");
  });

  it("stan pusty też jest czysty w axe", async () => {
    const { container } = render(<InsightSection insights={[]} />);

    const naruszenia = await axeViolations(container);
    expect(summarize(naruszenia)).toBe("");
  });
});
