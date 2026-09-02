// Generator interpretacji dla dashboardu Search Console (`gscInsights.ts`) -
// pierwszy test tego pliku (0/69 linii, 0/21 funkcji przed tą zmianą).
//
// PO CO. Ten moduł nie rysuje ani jednego piksela i nie robi ani jednego
// zapytania - to CZYSTA warstwa oceny. Dostaje surowe wiersze GSC i wypluwa
// listę zdań, które administrator czyta jako diagnozę własnego SEO: „CTR jest
// niższy o 1.0 pp", „70% ruchu jest brandowe", „15% wyświetleń w TOP 10".
// Klasa defektów, którą łapie ten plik, jest więc jedna: MODUŁ MOŻE KŁAMAĆ
// BEZ ŻADNEGO OBJAWU. Wykres narysuje się tak samo, testy renderu przejdą,
// a użytkownik dostanie rekomendację „przepisz meta title" wyliczoną z progu
// przesuniętego o jeden znak porównania. Nic w aplikacji tego nie zweryfikuje.
//
// Dlatego asercje celują w trzy rzeczy naraz:
//   1. PRÓG - każdy z kilkunastu progów liczbowych (-10 / +20 / ±0.02 / 0.5 /
//      0.6 / 0.25 / 0.5 / 20 impr. / 30 impr. / 0.4 dni / >3 / >=7) jest
//      sprawdzany PO OBU STRONACH, bo pomyłka `<` vs `<=` nie zmienia typów
//      i nie wywraca żadnego renderu;
//   2. DZIELENIE PRZEZ ZERO - cztery mianowniki (`totals.clicks` dwa razy,
//      `totalImp`, `pctDelta(prev === 0)`) mają w kodzie strażników; test
//      dowodzi, że pusty raport daje „0%", a nie „NaN%" w zdaniu dla klienta;
//   3. SŁOWNIK - `t()` jest tu PRAWDZIWY (`realT`), w PL i EN. Atrapa
//      odbijająca klucz udowodniłaby wyłącznie, że kod woła `t()`; asercja na
//      realnym słowniku oblewa również wtedy, gdy klucz zniknie z nakładki
//      `i18n-admin-analytics.ts` albo gdy `returnObjects: true` przestanie
//      oddawać tablicę rekomendacji (wtedy `fixes` cicho staje się napisem).
//
// TENANT. Ten builder jest bezstanowy i nie czyta niczego, co należy do
// workspace'u - dane wjeżdżają argumentem. Jedyna izolacja, jaka może się tu
// zepsuć, to stan modułowy (cache/memo) między wywołaniami, więc blok
// „izolacja i czystość" dowodzi, że raport najemcy B nie niesie ani jednej
// liczby najemcy A i że wejściowe tablice nie są mutowane.
import { describe, expect, it } from "vitest";

import type { GscRow } from "@/lib/analytics/gsc.functions";
import type { AppLang } from "@/lib/i18n/localePath";
import { realT } from "@/test/i18nReal";
import type { Insight } from "../InsightSection";
import { buildGscInsights } from "../gscInsights";

type Params = Parameters<typeof buildGscInsights>[0];
type Totals = Params["totals"];

const ZERO_TOTALS: Totals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** Wiersz GSC z sensownymi domyślnymi - test nadpisuje tylko to, co bada. */
function row(over: Partial<GscRow> = {}): GscRow {
  return { keys: ["x"], clicks: 0, impressions: 0, ctr: 0, position: 1, ...over };
}

/** `n` kolejnych dni (rosnąco po dacie) z klikami z funkcji indeksu. */
function days(n: number, clicks: (i: number) => number): GscRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      keys: [`2026-03-${String(i + 1).padStart(2, "0")}`],
      clicks: clicks(i),
      impressions: 10,
    }),
  );
}

function build(over: Partial<Params> = {}, lang: AppLang = "pl"): Insight[] {
  return buildGscInsights({
    totals: ZERO_TOTALS,
    prevTotals: ZERO_TOTALS,
    dateRows: [],
    queryRows: [],
    pageRows: [],
    countryRows: [],
    deviceRows: [],
    windowDays: 28,
    t: realT(lang),
    ...over,
  });
}

/** Wyciąga wpis po id - brak wpisu ma oblać z czytelnym komunikatem. */
function pick(list: Insight[], id: string): Insight {
  const found = list.find((i) => i.id === id);
  if (!found) {
    throw new Error(`Brak insightu "${id}". Zbudowane: ${list.map((i) => i.id).join(", ") || "-"}`);
  }
  return found;
}

/**
 * Lista rekomendacji prosto ze słownika. `t(key)` BEZ `returnObjects` oddaje
 * komunikat „returned an object instead of string" zamiast tablicy, więc
 * asercja musi pytać słownik tak samo, jak pyta go produkcyjne `arr()`.
 */
function lista(key: string, lang: AppLang = "pl"): string[] {
  return realT(lang)(key, { returnObjects: true }) as string[];
}

/** Skrót na najczęstszy kształt: jeden wpis KPI kliknięć z zadanej pary sum. */
function clicksInsight(cur: number, prev: number): Insight {
  return pick(
    build({
      totals: { ...ZERO_TOTALS, clicks: cur },
      prevTotals: { ...ZERO_TOTALS, clicks: prev },
    }),
    "kpi-clicks",
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("buildGscInsights - bramki wejściowe i kompletność listy", () => {
  it("na pustym raporcie oddaje wyłącznie trzy wpisy KPI, bez wpisów o wierszach", () => {
    const out = build();
    expect(out.map((i) => i.id)).toEqual(["kpi-clicks", "kpi-ctr", "kpi-position"]);
  });

  it("komplet danych daje dziesięć wpisów o unikalnych id, w kolejności elementów pulpitu", () => {
    const out = build({
      totals: { clicks: 100, impressions: 2000, ctr: 0.05, position: 8.4 },
      prevTotals: { clicks: 80, impressions: 1800, ctr: 0.044, position: 9.1 },
      dateRows: days(10, (i) => i),
      queryRows: [row({ keys: ["polityka ue"], clicks: 30, impressions: 1700, position: 14 })],
      pageRows: [row({ keys: ["https://example.com/a"], clicks: 50, impressions: 900 })],
      countryRows: [row({ keys: ["pol"], clicks: 90, impressions: 1500 })],
      deviceRows: [row({ keys: ["mobile"], clicks: 40, impressions: 1200 })],
    });
    expect(out.map((i) => i.id)).toEqual([
      "kpi-clicks",
      "kpi-ctr",
      "kpi-position",
      "trend",
      "top-queries",
      "position-histogram",
      "countries",
      "devices",
      "pages",
      "calendar",
    ]);
    expect(new Set(out.map((i) => i.id)).size).toBe(out.length);
  });

  it("trend wymaga WIĘCEJ niż 3 dni - przy 3 wierszach wpisu nie ma, przy 4 jest", () => {
    expect(build({ dateRows: days(3, () => 5) }).some((i) => i.id === "trend")).toBe(false);
    expect(build({ dateRows: days(4, () => 5) }).some((i) => i.id === "trend")).toBe(true);
  });

  it("kalendarz wymaga CO NAJMNIEJ 7 dni - przy 6 wierszach wpisu nie ma, przy 7 jest", () => {
    expect(build({ dateRows: days(6, () => 5) }).some((i) => i.id === "calendar")).toBe(false);
    expect(build({ dateRows: days(7, () => 5) }).some((i) => i.id === "calendar")).toBe(true);
  });

  it("jeden wiersz zapytań włącza OBA wpisy zapytaniowe: listę fraz i histogram pozycji", () => {
    const out = build({ queryRows: [row({ impressions: 5, position: 4 })] });
    expect(out.map((i) => i.id)).toContain("top-queries");
    expect(out.map((i) => i.id)).toContain("position-histogram");
  });

  it("puste tablice krajów, urządzeń i stron nie generują pustych sekcji", () => {
    const ids = build({ countryRows: [], deviceRows: [], pageRows: [] }).map((i) => i.id);
    expect(ids).not.toContain("countries");
    expect(ids).not.toContain("devices");
    expect(ids).not.toContain("pages");
  });

  it("każdy wpis niesie niepusty tytuł, detal i TABLICĘ rekomendacji ze słownika", () => {
    const out = build({
      totals: { clicks: 100, impressions: 2000, ctr: 0.05, position: 8.4 },
      prevTotals: { clicks: 80, impressions: 1800, ctr: 0.044, position: 9.1 },
      dateRows: days(10, (i) => i),
      queryRows: [row({ clicks: 30, impressions: 1700, position: 14 })],
      pageRows: [row({ clicks: 50, impressions: 900 })],
      countryRows: [row({ keys: ["pol"], clicks: 90 })],
      deviceRows: [row({ keys: ["mobile"], clicks: 40, impressions: 1200 })],
    });
    for (const i of out) {
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.detail.length).toBeGreaterThan(0);
      expect(Array.isArray(i.fixes)).toBe(true);
      expect(i.fixes.length).toBeGreaterThan(0);
      // Wyciek klucza = brak wpisu w nakładce i18n; i18next oddaje wtedy klucz.
      for (const text of [i.element, i.title, i.detail, ...i.fixes]) {
        expect(text.startsWith("adminAnalytics.")).toBe(false);
      }
    }
  });
});

describe("KPI kliknięcia - progi delty i strażnik dzielenia przez zero", () => {
  it("poprzednie okno z zerem klików nie daje NaN, tylko tytuł bez delty i severity info", () => {
    const i = clicksInsight(42, 0);
    expect(i.title).toBe("Kliknięcia w oknie: 42");
    expect(i.title).not.toMatch(/NaN|Infinity/);
    expect(i.severity).toBe("info");
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.clicks.fixesStable"));
  });

  it("delta niezerowa wchodzi do tytułu ze znakiem i jednym miejscem po przecinku", () => {
    expect(clicksInsight(125, 100).title).toBe("Kliknięcia +25.0% vs poprzednie okno");
    expect(clicksInsight(75, 100).title).toBe("Kliknięcia -25.0% vs poprzednie okno");
  });

  it("severity: +5% to już „good”, +4% jeszcze „info”", () => {
    expect(clicksInsight(105, 100).severity).toBe("good");
    expect(clicksInsight(104, 100).severity).toBe("info");
  });

  it("severity: -15% to już „warn”, -14% jeszcze „info”", () => {
    expect(clicksInsight(85, 100).severity).toBe("warn");
    expect(clicksInsight(86, 100).severity).toBe("info");
  });

  it("rekomendacje spadkowe od PONIŻEJ -10% - równe -10% zostaje przy zestawie stabilnym", () => {
    expect(clicksInsight(90, 100).fixes).toEqual(
      lista("adminAnalytics.gsc.insights.clicks.fixesStable"),
    );
    expect(clicksInsight(899, 1000).fixes).toEqual(
      lista("adminAnalytics.gsc.insights.clicks.fixesDown"),
    );
  });

  it("rekomendacje wzrostowe od POWYŻEJ +20% - równe +20% zostaje przy zestawie stabilnym", () => {
    expect(clicksInsight(120, 100).fixes).toEqual(
      lista("adminAnalytics.gsc.insights.clicks.fixesStable"),
    );
    expect(clicksInsight(121, 100).fixes).toEqual(
      lista("adminAnalytics.gsc.insights.clicks.fixesUp"),
    );
  });

  it("detal cytuje okno, obie sumy klików i obie sumy wyświetleń", () => {
    const i = pick(
      build({
        totals: { clicks: 100, impressions: 2000, ctr: 0.05, position: 8 },
        prevTotals: { clicks: 80, impressions: 1800, ctr: 0.044, position: 9 },
        windowDays: 14,
      }),
      "kpi-clicks",
    );
    expect(i.detail).toBe(
      "W bieżącym oknie 14 dni: 100 klik. Poprzednio: 80. Wyświetlenia: 2000 (poprzednio 1800).",
    );
  });
});

describe("KPI CTR - tabela benchmarku, luka do benchmarku i próg zmiany", () => {
  const expForPosition = (position: number, ctr = 0): string =>
    pick(build({ totals: { ...ZERO_TOTALS, ctr, position } }), "kpi-ctr").detail;

  it("benchmark 18% obowiązuje DO pozycji 3 włącznie, od 3.1 spada do 6%", () => {
    expect(expForPosition(3)).toContain("~18.0%");
    expect(expForPosition(3.1)).toContain("~6.0%");
  });

  it("benchmark 6% obowiązuje DO pozycji 10 włącznie, od 10.1 spada do 2%", () => {
    expect(expForPosition(10)).toContain("~6.0%");
    expect(expForPosition(10.1)).toContain("~2.0%");
  });

  it("benchmark 2% obowiązuje DO pozycji 20 włącznie, od 20.1 spada do 0.8%", () => {
    expect(expForPosition(20)).toContain("~2.0%");
    expect(expForPosition(20.1)).toContain("~0.8%");
  });

  it("pozycja spoza zbioru liczb (uszkodzony payload API) spada na najgłębszy benchmark 0.8%", () => {
    // `find()` nie dopasuje żadnego progu dla NaN - wtedy działa `?? 0.008`.
    expect(expForPosition(Number.NaN)).toContain("~0.8%");
  });

  it("CTR powyżej benchmarku opisuje słowem „wyższy”, poniżej - „niższy”", () => {
    expect(expForPosition(5, 0.09)).toContain("jest wyższy o 3.0 pp");
    expect(expForPosition(5, 0.03)).toContain("jest niższy o 3.0 pp");
  });

  it("luka RÓWNA zeru liczy się jako „wyższy” - porównanie jest nieostre", () => {
    expect(expForPosition(5, 0.06)).toContain("jest wyższy o 0.0 pp");
  });

  it("luka poniżej -2 pp daje „warn”, luka RÓWNA -2 pp już nie", () => {
    // 0 - 0.02 to w liczbach zmiennoprzecinkowych dokładnie -0.02, więc próg
    // jest tu badany bez marginesu błędu.
    expect(
      pick(build({ totals: { ...ZERO_TOTALS, ctr: 0, position: 15 } }), "kpi-ctr").severity,
    ).toBe("info");
    expect(
      pick(build({ totals: { ...ZERO_TOTALS, ctr: 0.001, position: 5 } }), "kpi-ctr").severity,
    ).toBe("warn");
  });

  it("luka powyżej +2 pp daje „good”, luka RÓWNA +2 pp spada do reguły zmiany CTR", () => {
    // 0.028 - 0.008 to dokładnie 0.02: ostre „>” nie może tu zadziałać.
    const equal = pick(build({ totals: { ...ZERO_TOTALS, ctr: 0.028, position: 25 } }), "kpi-ctr");
    expect(equal.severity).toBe("good"); // z reguły `dCtr > 0`, nie z luki
    const above = pick(build({ totals: { ...ZERO_TOTALS, ctr: 0.05, position: 25 } }), "kpi-ctr");
    expect(above.severity).toBe("good");
  });

  it("przy luce w normie decyduje zmiana CTR: <0.5 pp to „info”, spadek to „warn”, wzrost „good”", () => {
    const at = (ctr: number, prevCtr: number): Insight =>
      pick(
        build({
          totals: { ...ZERO_TOTALS, ctr, position: 5 },
          prevTotals: { ...ZERO_TOTALS, ctr: prevCtr, position: 5 },
        }),
        "kpi-ctr",
      );
    expect(at(0.06, 0.06).severity).toBe("info"); // dCtr = 0
    expect(at(0.06, 0.05).severity).toBe("good"); // +1 pp
    expect(at(0.05, 0.06).severity).toBe("warn"); // -1 pp
  });

  it("rekomendacje: ujemna luka to zestaw naprawczy, zerowa i dodatnia - podtrzymujący", () => {
    const low = pick(build({ totals: { ...ZERO_TOTALS, ctr: 0.03, position: 5 } }), "kpi-ctr");
    const ok = pick(build({ totals: { ...ZERO_TOTALS, ctr: 0.06, position: 5 } }), "kpi-ctr");
    expect(low.fixes).toEqual(lista("adminAnalytics.gsc.insights.ctr.fixesLow"));
    expect(ok.fixes).toEqual(lista("adminAnalytics.gsc.insights.ctr.fixesGood"));
  });

  it("tytuł podaje CTR z dwoma miejscami i pozycję z jednym", () => {
    const i = pick(
      build({ totals: { clicks: 1, impressions: 2, ctr: 0.0512, position: 8.44 } }),
      "kpi-ctr",
    );
    expect(i.title).toBe("CTR 5.12% przy pozycji 8.4");
  });

  it("pusty raport nie może wyglądać jak alarm CTR - pozycja 0 to brak danych, nie miejsce w TOP 3", () => {
    // Przy zerowych wyświetleniach `totalsOf` w `GscBiDashboard` oddaje
    // position = 0. Gdyby `expectedCtr(0)` wpadało do kubełka „maxPos: 3",
    // moduł ogłaszałby lukę -18 pp i nakazywał przepisać meta title na
    // stronach, których w raporcie w ogóle nie ma. Pozycja niższa od 1.0 jest
    // dla GSC niemożliwa, więc znaczy „brak pomiaru" i dostaje najgłębszy
    // benchmark (0,8%) - ten sam, co uszkodzony payload z NaN kilka
    // przypadków wyżej. Pusty raport zostaje więc obserwacją.
    const i = pick(build(), "kpi-ctr");
    expect(i.severity).not.toBe("warn");
  });
});

// DWA PROGI CTR, DWA RÓŻNE FAKTY - i to jest ROZSTRZYGNIĘCIE, nie przeoczenie.
// `kpi-ctr` podejmuje dwie decyzje o jednym wpisie, ale KAŻDA STOI NA INNEJ
// LICZBIE: lista działań na ZNAKU luki wobec benchmarku pozycji (`ctrGap`),
// a waga na ROZMIARZE tej luki (martwa strefa ±2 pp), z kierunkiem zmiany CTR
// (`dCtr`) jako rozstrzygnięciem WEWNĄTRZ martwej strefy. Dlatego kafelek
// ZIELONY z pełną listą remontową jest tu zachowaniem POPRAWNYM, a nie
// rozjazdem progów w rodzaju tego domkniętego w `kpi-position`: tam JEDNA
// liczba (`dPos`), opisana JEDNYM zdaniem, sterowała obiema decyzjami, więc
// alarm z poradą „trzymaj kurs” był sprzecznością. Tu `detail` wypisuje OBA
// fakty w jednym zdaniu („niższy o 0.5 pp” i „Zmiana vs poprzednie okno:
// 1.00 pp”), więc kafelek czyta się jako „idzie w dobrą stronę, ale wciąż
// poniżej normy dla tej pozycji - oto co robić”.
//
// Asercje niżej pilnują tego jako REGUŁY, w obie strony:
//   - oba lustrzane narożniki tej samej reguły: zielony z remontem ORAZ
//     bursztynowy z poradą „utrzymaj stylistykę tytułów - działa”;
//   - każda z TRZECH granic bloku osobno (znak luki, ±2 pp, 0.5 pp zmiany),
//     DOKŁADNIE na progu i po obu jego stronach, przy drugiej osi
//     UNIERUCHOMIONEJ - czyli test mówi też, która granica NIE rusza;
//   - dwie tabele prawdy na skali luki (trend rosnący i trend spadający)
//     porównane z LITERAŁEM oczekiwań, nie z powtórzonym warunkiem ze źródła.
//
// Kto zechce „naprawić” ten blok jednym booleanem jak `kpi-position`, oblewa
// wiersze -1.9 pp i -0.5 pp w OBU tabelach: wspólna martwa strefa ±2 pp
// wypisałaby „Utrzymaj stylistykę tytułów - działa” na bursztynowym kafelku
// strony, która jest pod krzywą i dalej spada, czyli wyprodukowałaby defekt
// z `kpi-position` zamiast go usunąć.
describe("KPI CTR - dwa progi to dwa różne fakty: znak luki rządzi poradami, rozmiar wagą", () => {
  const REMONT = lista("adminAnalytics.gsc.insights.ctr.fixesLow");
  const PODTRZYMANIE = lista("adminAnalytics.gsc.insights.ctr.fixesGood");

  /** CTR i CTR poprzedniego okna w częściach jedności; pozycja ustala benchmark. */
  const at = (ctr: number, prevCtr: number, position = 5): Insight =>
    pick(
      build({
        totals: { ...ZERO_TOTALS, ctr, position },
        prevTotals: { ...ZERO_TOTALS, ctr: prevCtr, position },
      }),
      "kpi-ctr",
    );
  const remont = (fixes: string[]): boolean =>
    fixes.length === REMONT.length && fixes.every((f, idx) => f === REMONT[idx]);

  it("oba zestawy porad naprawdę się różnią, a remontowy ma cztery kroki", () => {
    // Bez tego reszta bloku nie dowodziłaby niczego: gdyby słownik oddawał ten
    // sam tekst dla obu kluczy, każda asercja o „remoncie” przechodziłaby sama.
    expect(REMONT).not.toEqual(PODTRZYMANIE);
    expect(REMONT).toHaveLength(4);
    expect(PODTRZYMANIE).toHaveLength(1);
    expect(REMONT[0]).toContain("Przepisz meta title");
    expect(PODTRZYMANIE[0]).toContain("Utrzymaj stylistykę tytułów");
  });

  it("ZIELONY kafelek z pełną listą remontową jest zachowaniem POPRAWNYM, nie rozjazdem progów", () => {
    // Sonda z rozstrzygnięcia: CTR 5.5% przy pozycji 5 (benchmark 6%) i wzrost
    // o 1 pp. Waga „good”, a pod nią cztery kroki naprawcze - i to jest dobrze,
    // bo `detail` mówi operatorowi OBA fakty naraz: jest poniżej normy dla
    // swojego miejsca w SERP I rośnie. Kto zetnie tu listę do zestawu
    // podtrzymującego, każe modułowi pochwalić snippet, którego sam pomiar
    // stawia pod krzywą.
    const i = at(0.055, 0.045);
    expect(i.severity).toBe("good");
    expect(i.fixes).toEqual(REMONT);
    expect(i.detail).toBe(
      "Oczekiwany CTR dla tej pozycji: ~6.0%. Twój CTR jest niższy o 0.5 pp. Zmiana vs poprzednie okno: 1.00 pp.",
    );
  });

  it("BURSZTYNOWY kafelek z poradą „utrzymaj stylistykę tytułów” też jest poprawny - to ten sam narożnik od drugiej strony", () => {
    // Luka nieujemna (+0.5 pp), ale CTR spadł o 1.5 pp. Alarm dotyczy SPADKU,
    // a porada mówi, że przyczyną NIE jest snippet, i wskazuje drugą dźwignię
    // („wprowadź ten sam wzorzec na słabszych stronach”) - więc nie jest to
    // alarm z instrukcją bezczynności, jaki zamknięto w `kpi-position`.
    const i = at(0.065, 0.08);
    expect(i.severity).toBe("warn");
    expect(i.fixes).toEqual(PODTRZYMANIE);
    expect(i.detail).toBe(
      "Oczekiwany CTR dla tej pozycji: ~6.0%. Twój CTR jest wyższy o 0.5 pp. Zmiana vs poprzednie okno: -1.50 pp.",
    );
  });

  it("granica porad jest ZEROWA i domknięta po stronie dodatniej, a waga przy niej NIE drga", () => {
    // Benchmark 2% (pozycja 15) jest w tym miejscu ważny: 0.02 - 0.02 to
    // w IEEE 754 dokładnie zero, więc próg jest badany bez marginesu błędu.
    // Trend unieruchomiony na zerze, żeby zmieniała się TYLKO luka.
    const zero = at(0.02, 0.02, 15);
    const ponizej = at(0.019, 0.019, 15);
    const powyzej = at(0.021, 0.021, 15);
    expect(zero.fixes).toEqual(PODTRZYMANIE);
    expect(ponizej.fixes).toEqual(REMONT);
    expect(powyzej.fixes).toEqual(PODTRZYMANIE);
    // Trzy różne luki, ta sama waga - to jest ta druga oś.
    expect([zero.severity, ponizej.severity, powyzej.severity]).toEqual(["info", "info", "info"]);
  });

  it("granica wagi to OTWARTE -2 pp: luka dokładnie -2 pp jeszcze nie alarmuje, -2.1 pp już tak", () => {
    // Punkt DOKŁADNIE -2 pp bierzemy z benchmarku 2% (pozycja 15, CTR 0),
    // bo tam 0 - 0.02 to w IEEE 754 dokładnie -0.02. Przy benchmarku 6%
    // różnica 0.04 - 0.06 wypada 3e-18 WEWNĄTRZ strefy i nie badałaby progu.
    // UWAGA NA PRZYSZŁOŚĆ: ten wiersz jest jednocześnie skrajnym przypadkiem
    // martwej strefy. Przy benchmarku 2% (pozycja 11-20) największa możliwa
    // luka ujemna to właśnie -2 pp, a przy 0.8% (pozycja > 20) - 0.8 pp, więc
    // dla właściwości rankujących poza TOP 10 reguła benchmarku NIE MOŻE
    // podnieść wagi i decyduje wyłącznie trend. Zerowy CTR na pozycji 15
    // dostaje więc „info”. Czy to dobrze, jest odrębnym pytaniem (próg
    // absolutny kontra proporcjonalny, jakiego blok `pages` używa przez
    // mnożniki 0.6 / 1.3) - ten wiersz przypina dzisiejszą odpowiedź, żeby
    // zmiana progu na proporcjonalny była DECYZJĄ, a nie skutkiem ubocznym.
    const rowno = at(0, 0, 15);
    expect(rowno.severity).toBe("info");
    const ponizej = at(0.039, 0.039);
    expect(ponizej.severity).toBe("warn");
    const wStrefie = at(0.041, 0.041);
    expect(wStrefie.severity).toBe("info");
    // Porady po tej stronie skali są niezmiennie remontowe - alarm się rusza,
    // lista działań nie, bo odpowiada na inne pytanie.
    expect([rowno.fixes, ponizej.fixes, wStrefie.fixes]).toEqual([REMONT, REMONT, REMONT]);
  });

  it("granica wagi jest SYMETRYCZNA: luka dokładnie +2 pp też nie przesądza wagi, +2.1 pp daje „good” z samej luki", () => {
    // 0.04 - 0.02 to w IEEE 754 dokładnie +0.02, więc `> CTR_GAP_DEADBAND`
    // jest tu sprawdzone bez marginesu błędu. Trend zerowy, czyli „info”
    // może przyjść wyłącznie z martwej strefy luki.
    expect(at(0.04, 0.04, 15).severity).toBe("info");
    expect(at(0.041, 0.041, 15).severity).toBe("good");
    expect([at(0.04, 0.04, 15).fixes, at(0.041, 0.041, 15).fixes]).toEqual([
      PODTRZYMANIE,
      PODTRZYMANIE,
    ]);
  });

  it("próg zmiany CTR jest OTWARTY na 0.5 pp - pół punktu już rusza wagę, 0.49 pp jeszcze nie, a porady stoją", () => {
    // 0.005 - 0 i 0.0049 - 0 są w IEEE 754 dokładne, więc próg `< 0.005`
    // badamy na samej granicy. Luka trzymana w martwej strefie (-1.5 pp
    // i -1.51 pp przy benchmarku 2%), żeby o wadze decydował wyłącznie trend.
    const naProgu = at(0.005, 0, 15);
    const podProgiem = at(0.0049, 0, 15);
    expect(naProgu.severity).toBe("good");
    expect(podProgiem.severity).toBe("info");
    expect([naProgu.fixes, podProgiem.fixes]).toEqual([REMONT, REMONT]);
  });

  it("na całej skali luki przy trendzie ROSNĄCYM waga łamie się na -2 pp, a porady na zerze", () => {
    // Tabela prawdy zamiast powtórzenia warunku ze źródła. `dCtr` ustalone na
    // +1 pp dla KAŻDEGO wiersza, więc zmienia się wyłącznie luka. Cztery
    // pierwsze wiersze to zielone i bursztynowe kafelki z tą samą listą
    // remontową - dokładnie to, co rozstrzygnięcie uznaje za poprawne.
    const skala: Array<{ lukaPp: string; ctr: number }> = [
      { lukaPp: "-4.0", ctr: 0.02 },
      { lukaPp: "-2.1", ctr: 0.039 },
      { lukaPp: "-1.9", ctr: 0.041 },
      { lukaPp: "-0.5", ctr: 0.055 },
      { lukaPp: "0.0", ctr: 0.06 },
      { lukaPp: "+0.5", ctr: 0.065 },
      { lukaPp: "+1.9", ctr: 0.079 },
      { lukaPp: "+2.1", ctr: 0.081 },
      { lukaPp: "+4.0", ctr: 0.1 },
    ];
    const zmierzone = skala.map(({ lukaPp, ctr }) => {
      const i = at(ctr, ctr - 0.01);
      return { lukaPp, waga: i.severity, remont: remont(i.fixes) };
    });
    expect(zmierzone).toEqual([
      { lukaPp: "-4.0", waga: "warn", remont: true },
      { lukaPp: "-2.1", waga: "warn", remont: true },
      { lukaPp: "-1.9", waga: "good", remont: true },
      { lukaPp: "-0.5", waga: "good", remont: true },
      { lukaPp: "0.0", waga: "good", remont: false },
      { lukaPp: "+0.5", waga: "good", remont: false },
      { lukaPp: "+1.9", waga: "good", remont: false },
      { lukaPp: "+2.1", waga: "good", remont: false },
      { lukaPp: "+4.0", waga: "good", remont: false },
    ]);
  });

  it("na tej samej skali przy trendzie SPADAJĄCYM waga jest bursztynowa aż do +2 pp, a porady dalej łamią się na zerze", () => {
    // Ta sama skala luki, `dCtr` ustalone na -1 pp. Wiersz „0.0” to lustrzany
    // narożnik: kafelek bursztynowy z jedyną poradą „utrzymaj stylistykę
    // tytułów - działa”. Zestawienie obu tabel pokazuje, że waga i porady
    // reagują na DWIE RÓŻNE liczby: kolumna wagi zmienia się między tabelami,
    // kolumna remontu jest w obu identyczna.
    const skala: Array<{ lukaPp: string; ctr: number }> = [
      { lukaPp: "-4.0", ctr: 0.02 },
      { lukaPp: "-2.1", ctr: 0.039 },
      { lukaPp: "-1.9", ctr: 0.041 },
      { lukaPp: "-0.5", ctr: 0.055 },
      { lukaPp: "0.0", ctr: 0.06 },
      { lukaPp: "+0.5", ctr: 0.065 },
      { lukaPp: "+1.9", ctr: 0.079 },
      { lukaPp: "+2.1", ctr: 0.081 },
      { lukaPp: "+4.0", ctr: 0.1 },
    ];
    const zmierzone = skala.map(({ lukaPp, ctr }) => {
      const i = at(ctr, ctr + 0.01);
      return { lukaPp, waga: i.severity, remont: remont(i.fixes) };
    });
    expect(zmierzone).toEqual([
      { lukaPp: "-4.0", waga: "warn", remont: true },
      { lukaPp: "-2.1", waga: "warn", remont: true },
      { lukaPp: "-1.9", waga: "warn", remont: true },
      { lukaPp: "-0.5", waga: "warn", remont: true },
      { lukaPp: "0.0", waga: "warn", remont: false },
      { lukaPp: "+0.5", waga: "warn", remont: false },
      { lukaPp: "+1.9", waga: "warn", remont: false },
      { lukaPp: "+2.1", waga: "good", remont: false },
      { lukaPp: "+4.0", waga: "good", remont: false },
    ]);
  });

  it("słowo w detalu i zestaw porad mają TĘ SAMĄ granicę zero - „niższy” zawsze idzie z remontem", () => {
    // To jest materialne uzasadnienie zerowej granicy porad: lista kroków
    // odpowiada na to samo pytanie, na które odpowiada zdanie w `detail`.
    // Gdyby porady dostały własną martwą strefę, moduł pisałby „Twój CTR jest
    // niższy o 1.9 pp” i w tym samym kafelku „Utrzymaj stylistykę tytułów -
    // działa”. Skala celowo zawiera wiersz 0.0 pp, gdzie detal mówi „wyższy”.
    const skala = [0.02, 0.039, 0.041, 0.055, 0.06, 0.065, 0.081, 0.1];
    const zmierzone = skala.map((ctr) => {
      const i = at(ctr, ctr - 0.01);
      return { ctr, nizszy: i.detail.includes("jest niższy o"), remont: remont(i.fixes) };
    });
    expect(zmierzone).toEqual([
      { ctr: 0.02, nizszy: true, remont: true },
      { ctr: 0.039, nizszy: true, remont: true },
      { ctr: 0.041, nizszy: true, remont: true },
      { ctr: 0.055, nizszy: true, remont: true },
      { ctr: 0.06, nizszy: false, remont: false },
      { ctr: 0.065, nizszy: false, remont: false },
      { ctr: 0.081, nizszy: false, remont: false },
      { ctr: 0.1, nizszy: false, remont: false },
    ]);
  });
});

// GRANICA POZYCJI. `kpi-position` podejmuje DWIE decyzje o tej samej liczbie:
// wagę wpisu (kolor ramki, miejsce w posortowanej liście, wpis do odznaki
// „do poprawy”) oraz zestaw kroków pod nagłówkiem. Operator widzi je razem,
// w JEDNYM kafelku (`InsightSection` renderuje ikonę wagi i `fixes` w tym samym
// `<li>`), więc kafelek ostrzegawczy z jedyną poradą „utrzymaj tempo” jest dla
// niego sprzecznością: alarm i instrukcja bezczynności w jednym miejscu.
// Granica jest więc JEDNA i DOMKNIĘTA - ±0.5 miejsca - a asercje niżej pilnują
// jej jako reguły: równoważności „waga `warn`” ⇔ „zestaw naprawczy” na całej
// skali delty, z osobnymi przypadkami DOKŁADNIE na progu i po obu jego stronach.
describe("KPI pozycja - jedna domknięta granica 0.5 miejsca dla wagi i dla działań", () => {
  const at = (pos: number, prevPos: number): Insight =>
    pick(
      build({
        totals: { ...ZERO_TOTALS, position: pos },
        prevTotals: { ...ZERO_TOTALS, position: prevPos },
      }),
      "kpi-position",
    );
  const STABILNE = lista("adminAnalytics.gsc.insights.position.fixesStable");
  const NAPRAWCZE = lista("adminAnalytics.gsc.insights.position.fixesWorse");

  it("dwa zestawy porad naprawdę się różnią - inaczej reszta bloku nie dowodziłaby niczego", () => {
    expect(NAPRAWCZE).not.toEqual(STABILNE);
    expect(STABILNE.length).toBeGreaterThan(0);
  });

  it("pogorszenie DOKŁADNIE o 0.5 miejsca: waga `warn` I zestaw naprawczy razem", () => {
    const i = at(10.5, 10);
    expect(i.severity).toBe("warn");
    expect(i.fixes).toEqual(NAPRAWCZE);
  });

  it("pogorszenie o 0.4 miejsca zostaje pod progiem: waga `info` i porady stabilne", () => {
    const i = at(10.4, 10);
    expect(i.severity).toBe("info");
    expect(i.fixes).toEqual(STABILNE);
  });

  it("pogorszenie o 0.6 miejsca dalej trzyma tę samą parę: `warn` i zestaw naprawczy", () => {
    const i = at(10.6, 10);
    expect(i.severity).toBe("warn");
    expect(i.fixes).toEqual(NAPRAWCZE);
  });

  it("poprawa DOKŁADNIE o 0.5 miejsca: waga `good`, a kroki podtrzymujące, nie naprawcze", () => {
    const i = at(9.5, 10);
    expect(i.severity).toBe("good");
    expect(i.fixes).toEqual(STABILNE);
  });

  it("poprawa o 0.4 miejsca zostaje pod progiem: waga `info` i porady stabilne", () => {
    const i = at(9.6, 10);
    expect(i.severity).toBe("info");
    expect(i.fixes).toEqual(STABILNE);
  });

  it("poprawa o 0.6 miejsca to `good` z poradami stabilnymi", () => {
    const i = at(9.4, 10);
    expect(i.severity).toBe("good");
    expect(i.fixes).toEqual(STABILNE);
  });

  it("na progu kafelek NIE stawia obok siebie alarmu i porady „trzymaj kurs”", () => {
    // To zdanie ze słownika jest całą listą działań wariantu stabilnego. Jeśli
    // pojawi się w kafelku o wadze `warn`, operator czyta ostrzeżenie i
    // instrukcję bezczynności w jednym miejscu - dokładnie ten defekt.
    const i = at(10.5, 10);
    expect(i.severity).toBe("warn");
    expect(i.detail).toBe("Pozycja pogorszyła się o 0.5 miejsc - spadek widoczności.");
    expect(i.fixes).not.toContain("Utrzymaj tempo linkowania wewnętrznego i publikacji.");
  });

  it("na całej skali delty waga `warn` zachodzi DOKŁADNIE wtedy, gdy porady są naprawcze", () => {
    // Tabela prawdy zamiast powtórzenia warunku ze źródła: każdy wiersz mówi,
    // co operator ma zobaczyć przy danej zmianie pozycji. Przesunięcie
    // KTÓREGOKOLWIEK z dwóch progów o jeden znak porównania oblewa wiersz
    // ±0.5, a rozjechanie ich względem siebie - wiersz 0.5 w obu kolumnach.
    const naprawczy = (fixes: string[]): boolean =>
      fixes.length === NAPRAWCZE.length && fixes.every((f, idx) => f === NAPRAWCZE[idx]);
    const delty = [-2, -0.6, -0.5, -0.4, 0, 0.4, 0.5, 0.6, 2];
    const zmierzone = delty.map((d) => {
      const i = at(10 + d, 10);
      return { delta: d, ostrzezenie: i.severity === "warn", naprawcze: naprawczy(i.fixes) };
    });
    expect(zmierzone).toEqual([
      { delta: -2, ostrzezenie: false, naprawcze: false },
      { delta: -0.6, ostrzezenie: false, naprawcze: false },
      { delta: -0.5, ostrzezenie: false, naprawcze: false },
      { delta: -0.4, ostrzezenie: false, naprawcze: false },
      { delta: 0, ostrzezenie: false, naprawcze: false },
      { delta: 0.4, ostrzezenie: false, naprawcze: false },
      { delta: 0.5, ostrzezenie: true, naprawcze: true },
      { delta: 0.6, ostrzezenie: true, naprawcze: true },
      { delta: 2, ostrzezenie: true, naprawcze: true },
    ]);
  });

  it("granica jest SYMETRYCZNA - pół miejsca w dół waży tyle samo, co pół miejsca w górę", () => {
    // Gdyby pogorszenie o równo 0.5 spadło do „info” (próg wagi otwarty na
    // `> 0.5`), moduł traktowałby ten sam ruch jako sygnał w górę i jako szum
    // w dół - czyli zawyżałby obraz widoczności. Ta para wierszy tego pilnuje.
    expect(at(9.5, 10).severity).toBe("good");
    expect(at(10.5, 10).severity).toBe("warn");
    expect(at(9.6, 10).severity).toBe("info");
    expect(at(10.4, 10).severity).toBe("info");
  });

  it("detal rozróżnia trzy kierunki: gorzej, lepiej i bez zmiany", () => {
    expect(at(11, 10).detail).toBe("Pozycja pogorszyła się o 1.0 miejsc - spadek widoczności.");
    expect(at(9, 10).detail).toBe("Pozycja poprawiła się o 1.0 miejsc.");
    expect(at(10, 10).detail).toBe("Pozycja stabilna względem poprzedniego okna.");
  });

  it("detal ma WŁASNĄ, zerową granicę - opisuje kierunek, nie wagę ruchu", () => {
    // Ruch o 0.1 miejsca to jeszcze `info` z poradami stabilnymi, ale detal
    // już nazywa kierunek. To nie jest rozjazd progów: zdanie opisowe i ocena
    // odpowiadają na dwa różne pytania i nie mogą mieć wspólnej granicy.
    const i = at(10.1, 10);
    expect(i.severity).toBe("info");
    expect(i.fixes).toEqual(STABILNE);
    expect(i.detail).toBe("Pozycja pogorszyła się o 0.1 miejsc - spadek widoczności.");
  });

  it("brak zmiany zapisuje deltę ze znakiem plus - `signed()` traktuje zero jako nieujemne", () => {
    expect(at(10, 10).title).toBe("Średnia pozycja: 10.0 (+0.0)");
  });
});

describe("Trend widoczności - podział okna na połowy", () => {
  it("porządkuje dni po dacie przed podziałem, niezależnie od kolejności wejścia", () => {
    const chronologiczne = days(4, (i) => [1, 2, 30, 40][i] ?? 0);
    const i = pick(build({ dateRows: [...chronologiczne].reverse() }), "trend");
    expect(i.detail).toBe("Kliknięcia H1: 3, H2: 70. Kierunek trendu w oknie 28 dni.");
  });

  it("pierwsza połowa bez klików nie daje dzielenia przez zero, tylko tytuł „brak danych”", () => {
    const i = pick(build({ dateRows: days(4, (idx) => (idx < 2 ? 0 : 5)) }), "trend");
    expect(i.title).toBe("Trend widoczności - brak dostatecznych danych");
    expect(i.title).not.toMatch(/NaN|Infinity/);
    expect(i.severity).toBe("info");
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.trend.fixesDefault"));
  });

  it("wiersze bez klucza daty nie wywracają sortowania - puste klucze idą na początek", () => {
    // DWA wiersze bez daty, żeby komparator porównał pusty klucz z pustym -
    // to jedyny układ, w którym oba `?? ""` w `localeCompare` naprawdę działają.
    const rows = [
      row({ keys: [], clicks: 100, impressions: 10 }),
      row({ keys: [], clicks: 4, impressions: 10 }),
      ...days(2, () => 4),
    ];
    const i = pick(build({ dateRows: rows }), "trend");
    expect(i.detail).toBe("Kliknięcia H1: 104, H2: 8. Kierunek trendu w oknie 28 dni.");
  });

  it("rekomendacje kryzysowe dopiero PONIŻEJ -10% - równe -10% zostaje przy domyślnych", () => {
    const rowny = pick(build({ dateRows: days(4, (idx) => (idx < 2 ? 50 : 45)) }), "trend");
    expect(rowny.title).toBe("Druga połowa okna: -10.0% klik. vs pierwsza");
    expect(rowny.fixes).toEqual(lista("adminAnalytics.gsc.insights.trend.fixesDefault"));
    const ponizej = pick(build({ dateRows: days(4, (idx) => (idx < 2 ? 500 : 449)) }), "trend");
    expect(ponizej.fixes).toEqual(lista("adminAnalytics.gsc.insights.trend.fixesDown"));
  });

  it("głęboki spadek między połowami podnosi severity do „warn”", () => {
    expect(
      pick(build({ dateRows: days(4, (idx) => (idx < 2 ? 100 : 10)) }), "trend").severity,
    ).toBe("warn");
  });

  it("płaska seria klików w oknie o NIEPARZYSTEJ liczbie dni nie jest wzrostem", () => {
    // 5 dni po 10 klików. Przy `slice(0, half)` / `slice(half)` „pierwsza
    // połowa" miałaby 2 dni (20 klików), a „druga" 3 dni (30 klików) - moduł
    // ogłaszałby +50% wzrostu na serii, która nie drgnęła (a w drugą stronę
    // ukrywałby realny spadek). Połowy mają teraz tę samą liczbę dni: dzień
    // środkowy nie należy do żadnej, więc H1 = H2 = 20 i trend to dokładnie 0%.
    const i = pick(build({ dateRows: days(5, () => 10) }), "trend");
    expect(i.severity).toBe("info");
    expect(i.title).toBe("Druga połowa okna: +0.0% klik. vs pierwsza");
    expect(i.detail).toBe("Kliknięcia H1: 20, H2: 20. Kierunek trendu w oknie 28 dni.");
  });
});

describe("Top zapytania - udział brandu i frazy bez kliknięć", () => {
  const brand = (clicks: number): GscRow =>
    row({ keys: ["New European Strategies raport"], clicks, impressions: 500, position: 2 });

  it("udział brandu POWYŻEJ 60% przełącza wpis na narrację brandową", () => {
    const i = pick(
      build({ totals: { ...ZERO_TOTALS, clicks: 100 }, queryRows: [brand(61)] }),
      "top-queries",
    );
    expect(i.severity).toBe("warn");
    expect(i.title).toBe("Ruch mocno brandowy (61%)");
    expect(i.detail).toBe(
      "Ponad połowa kliknięć pochodzi z fraz brandowych - brakuje widoczności generycznej.",
    );
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.topQueries.fixesBranded"));
  });

  it("udział brandu RÓWNY 60% jeszcze nie przełącza - wpis mówi o frazach bez klików", () => {
    const i = pick(
      build({ totals: { ...ZERO_TOTALS, clicks: 100 }, queryRows: [brand(60)] }),
      "top-queries",
    );
    expect(i.title).toBe("0 fraz z ≥20 wyśw. i 0 klik.");
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.topQueries.fixesZeroClick"));
  });

  it("dopasowanie frazy brandowej ignoruje wielkość liter", () => {
    const i = pick(
      build({
        totals: { ...ZERO_TOTALS, clicks: 100 },
        queryRows: [row({ keys: ["NEW EUROPEAN STRATEGIES"], clicks: 90, impressions: 500 })],
      }),
      "top-queries",
    );
    expect(i.title).toBe("Ruch mocno brandowy (90%)");
  });

  it("zerowa suma klików w oknie nie daje NaN w procencie brandu", () => {
    const i = pick(build({ totals: ZERO_TOTALS, queryRows: [brand(50)] }), "top-queries");
    expect(i.title).not.toMatch(/NaN|Infinity/);
    expect(i.title).toBe("0 fraz z ≥20 wyśw. i 0 klik.");
  });

  it("fraza wchodzi do licznika „zero klików” od 20 wyświetleń - przy 19 nie", () => {
    const liczy = build({ queryRows: [row({ clicks: 0, impressions: 20 })] });
    const nieLiczy = build({ queryRows: [row({ clicks: 0, impressions: 19 })] });
    expect(pick(liczy, "top-queries").title).toBe("1 fraz z ≥20 wyśw. i 0 klik.");
    expect(pick(nieLiczy, "top-queries").title).toBe("0 fraz z ≥20 wyśw. i 0 klik.");
  });

  it("fraza z choćby jednym klikiem nie jest „zero-click”, mimo wysokich wyświetleń", () => {
    const out = build({ queryRows: [row({ clicks: 1, impressions: 5000 })] });
    expect(pick(out, "top-queries").title).toBe("0 fraz z ≥20 wyśw. i 0 klik.");
  });

  it("severity rośnie do „warn” dopiero POWYŻEJ 5 fraz zero-click - przy równo 5 jest „info”", () => {
    const zeroClick = (n: number): GscRow[] =>
      Array.from({ length: n }, (_, i) =>
        row({ keys: [`fraza ${i}`], clicks: 0, impressions: 30 }),
      );
    expect(pick(build({ queryRows: zeroClick(5) }), "top-queries").severity).toBe("info");
    const szesc = pick(build({ queryRows: zeroClick(6) }), "top-queries");
    expect(szesc.severity).toBe("warn");
    expect(szesc.detail).toBe(
      "Wysokie impressions bez kliknięć = SERP snippet nie sprzedaje. Fraz: 6.",
    );
  });

  it("wiersz bez klucza frazy nie wywraca filtra brandowego", () => {
    const out = build({ totals: { ...ZERO_TOTALS, clicks: 10 }, queryRows: [row({ keys: [] })] });
    expect(pick(out, "top-queries").title).toBe("0 fraz z ≥20 wyśw. i 0 klik.");
  });
});

describe("Histogram pozycji SERP - kubełki i próg widoczności TOP 10", () => {
  const q = (position: number, impressions: number): GscRow =>
    row({ keys: [`q${position}`], position, impressions });

  it("granice kubełków są nieostre od góry: 3, 10 i 20 należą do niższego przedziału", () => {
    const i = pick(
      build({ queryRows: [q(3, 1), q(3.1, 2), q(10, 4), q(10.1, 8), q(20, 16), q(20.1, 32)] }),
      "position-histogram",
    );
    expect(i.detail).toContain("TOP3: 1, TOP4-10: 6, TOP11-20: 24, 21+: 32");
  });

  it("udział TOP 10 liczony jest po WYŚWIETLENIACH, nie po liczbie fraz", () => {
    const i = pick(build({ queryRows: [q(2, 30), q(30, 70)] }), "position-histogram");
    expect(i.title).toBe("30% wyświetleń w TOP 10");
  });

  it("50% udziału to już „good”, 49% jeszcze „info”", () => {
    expect(pick(build({ queryRows: [q(2, 50), q(30, 50)] }), "position-histogram").severity).toBe(
      "good",
    );
    expect(pick(build({ queryRows: [q(2, 49), q(30, 51)] }), "position-histogram").severity).toBe(
      "info",
    );
  });

  it("25% udziału to jeszcze „info”, 24% już „warn” z inną trzecią rekomendacją", () => {
    const t = realT("pl");
    const graniczny = pick(build({ queryRows: [q(2, 25), q(30, 75)] }), "position-histogram");
    expect(graniczny.severity).toBe("info");
    expect(graniczny.fixes[2]).toBe(t("adminAnalytics.gsc.insights.positionHistogram.fix3High"));
    const ponizej = pick(build({ queryRows: [q(2, 24), q(30, 76)] }), "position-histogram");
    expect(ponizej.severity).toBe("warn");
    expect(ponizej.fixes[2]).toBe(t("adminAnalytics.gsc.insights.positionHistogram.fix3Low"));
  });

  it("same zerowe wyświetlenia nie dają dzielenia przez zero - udział to 0%, nie NaN", () => {
    const i = pick(build({ queryRows: [q(2, 0), q(30, 0)] }), "position-histogram");
    expect(i.title).toBe("0% wyświetleń w TOP 10");
    expect(i.title).not.toMatch(/NaN|Infinity/);
    expect(i.severity).toBe("warn");
  });

  it("dwie pierwsze rekomendacje są stałe i pochodzą ze słownika", () => {
    const t = realT("pl");
    const i = pick(build({ queryRows: [q(2, 10)] }), "position-histogram");
    expect(i.fixes.slice(0, 2)).toEqual([
      t("adminAnalytics.gsc.insights.positionHistogram.fix1"),
      t("adminAnalytics.gsc.insights.positionHistogram.fix2"),
    ]);
  });
});

describe("Kraje - koncentracja rynku", () => {
  const c = (code: string, clicks: number): GscRow =>
    row({ keys: [code], clicks, impressions: 100 });

  it("sortuje malejąco po klikach i podaje kod dominującego kraju wersalikami", () => {
    const i = pick(
      build({
        totals: { ...ZERO_TOTALS, clicks: 100 },
        countryRows: [c("deu", 10), c("pol", 70), c("gbr", 20)],
      }),
      "countries",
    );
    expect(i.title).toBe("Dominujący kraj: POL (70%)");
    expect(i.detail).toBe("3 krajów w wynikach. Top 3: POL 70, GBR 20, DEU 10.");
  });

  it("podsumowanie obcina listę do trzech rynków, choćby krajów było więcej", () => {
    const rows = [c("pol", 50), c("deu", 40), c("gbr", 30), c("fra", 20), c("esp", 10)];
    const i = pick(
      build({ totals: { ...ZERO_TOTALS, clicks: 150 }, countryRows: rows }),
      "countries",
    );
    expect(i.detail).toBe("5 krajów w wynikach. Top 3: POL 50, DEU 40, GBR 30.");
  });

  it("udział POWYŻEJ 90% to „info” z poradami o jednym rynku, równe 90% to „good”", () => {
    const skrajny = pick(
      build({ totals: { ...ZERO_TOTALS, clicks: 100 }, countryRows: [c("pol", 91), c("deu", 9)] }),
      "countries",
    );
    expect(skrajny.severity).toBe("info");
    expect(skrajny.fixes).toEqual(lista("adminAnalytics.gsc.insights.countries.fixesSingle"));
    const graniczny = pick(
      build({ totals: { ...ZERO_TOTALS, clicks: 100 }, countryRows: [c("pol", 90), c("deu", 10)] }),
      "countries",
    );
    expect(graniczny.severity).toBe("good");
    expect(graniczny.fixes).toEqual(lista("adminAnalytics.gsc.insights.countries.fixesMulti"));
  });

  it("zerowa suma klików nie daje NaN w udziale dominującego kraju", () => {
    const i = pick(build({ totals: ZERO_TOTALS, countryRows: [c("pol", 5)] }), "countries");
    expect(i.title).toBe("Dominujący kraj: POL (0%)");
    expect(i.title).not.toMatch(/NaN|Infinity/);
  });

  it("brak kodu kraju w wierszu zostaje zastąpiony znakiem zapytania, nie „undefined”", () => {
    const i = pick(
      build({
        totals: { ...ZERO_TOTALS, clicks: 10 },
        countryRows: [row({ keys: [], clicks: 10 })],
      }),
      "countries",
    );
    expect(i.title).toBe("Dominujący kraj: ? (100%)");
    expect(i.detail).toBe("1 krajów w wynikach. Top 3: ? 10.");
  });
});

describe("Urządzenia - luka CTR mobile vs desktop", () => {
  const dev = (key: string, clicks: number, impressions: number, ctr: number): GscRow =>
    row({ keys: [key], clicks, impressions, ctr });

  it("dopasowuje wiersze po nazwie urządzenia bez względu na wielkość liter", () => {
    const i = pick(
      build({ deviceRows: [dev("MOBILE", 40, 1200, 0.033), dev("Desktop", 60, 800, 0.075)] }),
      "devices",
    );
    expect(i.title).toBe("Mobile 40 klik., desktop 60 klik.");
    expect(i.detail).toContain("CTR: mobile 3.30%, desktop 7.50%.");
  });

  it("brak wiersza dla urządzenia daje zero klików i zerowy CTR, nie „undefined”", () => {
    // Wiersz bez klucza urządzenia siedzi w tej samej tablicy - predykat `find`
    // musi go pominąć, a nie wywrócić się na `undefined.toLowerCase()`.
    const i = pick(
      build({ deviceRows: [dev("tablet", 7, 100, 0.07), row({ keys: [], clicks: 3 })] }),
      "devices",
    );
    expect(i.title).toBe("Mobile 0 klik., desktop 0 klik.");
    expect(i.detail).toContain("CTR: mobile 0.00%, desktop 0.00%.");
  });

  it("wiersz z zerowymi wyświetleniami jest traktowany jak brak CTR, nawet gdy pole ctr jest niezerowe", () => {
    const i = pick(
      build({ deviceRows: [dev("mobile", 0, 0, 0.99), dev("desktop", 10, 100, 0.1)] }),
      "devices",
    );
    expect(i.detail).toContain("CTR: mobile 0.00%, desktop 10.00%.");
  });

  it("luka POWYŻEJ 2 pp na korzyść desktopu to „warn” z notatką o słabym snippecie mobile", () => {
    const t = realT("pl");
    const i = pick(
      build({ deviceRows: [dev("mobile", 10, 100, 0.05), dev("desktop", 10, 100, 0.07)] }),
      "devices",
    );
    expect(i.severity).toBe("warn");
    expect(i.detail).toContain(t("adminAnalytics.gsc.insights.devices.noteGap"));
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.devices.fixesGap"));
  });

  it("luka RÓWNA 2 pp jeszcze nie alarmuje - próg jest ostry", () => {
    const t = realT("pl");
    // 0.028 - 0.008 to dokładnie 0.02 w liczbach zmiennoprzecinkowych.
    const i = pick(
      build({ deviceRows: [dev("mobile", 10, 100, 0.008), dev("desktop", 10, 100, 0.028)] }),
      "devices",
    );
    expect(i.severity).toBe("info");
    expect(i.detail).toContain(t("adminAnalytics.gsc.insights.devices.noteEven"));
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.devices.fixesEven"));
  });

  it("przewaga mobile'a nad desktopem nie może być opisana jako równomierny rozkład CTR", () => {
    // `gap = desktop - mobile` jest wtedy UJEMNY, więc porównanie tylko od
    // góry (`gap > 0.02`) wpadało w gałąź „even" i użytkownik czytał
    // „Równomierny rozkład CTR" przy różnicy 18 pp. Rozkład jest równomierny
    // dopiero wtedy, gdy różnica jest poniżej progu W OBIE strony, więc tu
    // noty o równomierności nie ma. Nie ma też noty „Desktop przoduje": ona
    // opisuje słaby snippet mobile, a to nie ten przypadek - detal zostaje
    // przy dwóch zmierzonych CTR-ach.
    const t = realT("pl");
    const i = pick(
      build({ deviceRows: [dev("mobile", 200, 1000, 0.2), dev("desktop", 20, 1000, 0.02)] }),
      "devices",
    );
    expect(i.detail).not.toContain(t("adminAnalytics.gsc.insights.devices.noteEven"));
    expect(i.detail).not.toContain(t("adminAnalytics.gsc.insights.devices.noteGap"));
    expect(i.detail).toBe("CTR: mobile 20.00%, desktop 2.00%.");
    expect(i.severity).toBe("info");
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.devices.fixesEven"));
  });
});

describe("Strony - benchmark CTR na wierszu strony", () => {
  const page = (slug: string, impressions: number, ctr: number, position = 5): GscRow =>
    row({ keys: [`https://example.com/${slug}`], impressions, ctr, position });

  it("do analizy wchodzą strony od 30 wyświetleń - przy 29 wiersz jest pomijany", () => {
    expect(pick(build({ pageRows: [page("a", 30, 0.05)] }), "pages").detail).toContain(
      "Analiza 1 stron",
    );
    expect(pick(build({ pageRows: [page("a", 29, 0.05)] }), "pages").detail).toContain(
      "Analiza 0 stron",
    );
  });

  it("słaba strona to CTR PONIŻEJ 60% benchmarku - dokładnie 60% jeszcze się nie liczy", () => {
    // pozycja 5 => benchmark 6%, próg słabości 3.6%.
    expect(pick(build({ pageRows: [page("a", 100, 0.036)] }), "pages").title).toBe(
      "0 stron znacząco poniżej benchmarku CTR, 0 powyżej",
    );
    expect(pick(build({ pageRows: [page("a", 100, 0.0359)] }), "pages").title).toBe(
      "1 stron znacząco poniżej benchmarku CTR, 0 powyżej",
    );
  });

  it("zwycięzca to CTR POWYŻEJ 130% benchmarku - dokładnie 130% jeszcze się nie liczy", () => {
    // pozycja 5 => benchmark 6%, próg zwycięstwa 7.8%.
    expect(pick(build({ pageRows: [page("a", 100, 0.078)] }), "pages").title).toBe(
      "0 stron znacząco poniżej benchmarku CTR, 0 powyżej",
    );
    expect(pick(build({ pageRows: [page("a", 100, 0.0781)] }), "pages").title).toBe(
      "0 stron znacząco poniżej benchmarku CTR, 1 powyżej",
    );
  });

  it("benchmark jest liczony PER STRONA z jej własnej pozycji, nie ze średniej właściwości", () => {
    // Ten sam CTR 1.5%: przy pozycji 2 (benchmark 18%) to słaba strona,
    // przy pozycji 30 (benchmark 0.8%) to zwycięzca.
    const i = pick(
      build({ pageRows: [page("a", 100, 0.015, 2), page("b", 100, 0.015, 30)] }),
      "pages",
    );
    expect(i.title).toBe("1 stron znacząco poniżej benchmarku CTR, 1 powyżej");
  });

  it("severity rośnie do „warn” dopiero POWYŻEJ 3 słabych stron", () => {
    const slabe = (n: number): GscRow[] =>
      Array.from({ length: n }, (_, i) => page(`p${i}`, 100, 0.001));
    expect(pick(build({ pageRows: slabe(3) }), "pages").severity).toBe("info");
    expect(pick(build({ pageRows: slabe(4) }), "pages").severity).toBe("warn");
  });

  it("rekomendacje stron są stałe i pochodzą ze słownika", () => {
    const i = pick(build({ pageRows: [page("a", 100, 0.05)] }), "pages");
    expect(i.fixes).toEqual(lista("adminAnalytics.gsc.insights.pages.fixes"));
  });
});

describe("Kalendarz aktywności - dni puste i szczyt", () => {
  it("wskazuje dzień o największej liczbie klików wraz z datą", () => {
    const i = pick(build({ dateRows: days(7, (idx) => (idx === 4 ? 33 : 1)) }), "calendar");
    expect(i.title).toBe("Szczyt: 33 klik. 2026-03-05");
    expect(i.detail).toBe("Największy szczyt aktywności w wybranym oknie: 2026-03-05 (33 klik.).");
    expect(i.severity).toBe("info");
  });

  it("przy remisie szczytu wygrywa dzień WCZEŚNIEJSZY - porównanie jest ostre", () => {
    const i = pick(
      build({ dateRows: days(7, (idx) => (idx === 1 || idx === 5 ? 9 : 1)) }),
      "calendar",
    );
    expect(i.title).toBe("Szczyt: 9 klik. 2026-03-02");
  });

  it("dni puste liczą się dopiero POWYŻEJ 40% okna - równe 40% nie przełącza narracji", () => {
    // 10 dni, próg to 4 dni; równe 4 zera zostają przy narracji o szczycie.
    const rowne = pick(build({ dateRows: days(10, (idx) => (idx < 4 ? 0 : 3)) }), "calendar");
    expect(rowne.severity).toBe("info");
    expect(rowne.fixes).toEqual(lista("adminAnalytics.gsc.insights.calendar.fixesSpike"));
    const powyzej = pick(build({ dateRows: days(10, (idx) => (idx < 5 ? 0 : 3)) }), "calendar");
    expect(powyzej.severity).toBe("warn");
    expect(powyzej.title).toBe("5/10 dni bez kliknięć");
    expect(powyzej.detail).toBe(
      "Duża liczba zerowych dni sugeruje wąską niszę lub problem z indeksacją długi czas.",
    );
    expect(powyzej.fixes).toEqual(lista("adminAnalytics.gsc.insights.calendar.fixesZeros"));
  });

  it("okno bez ani jednego klika trafia w narrację o dniach pustych, nie w szczyt z zerem", () => {
    const i = pick(build({ dateRows: days(7, () => 0) }), "calendar");
    expect(i.title).toBe("7/7 dni bez kliknięć");
  });

  it("brak daty w wierszu szczytu daje pusty tytuł i myślnik w detalu - dwa różne zastępniki", () => {
    const rows = [
      row({ keys: [], clicks: 50, impressions: 10 }),
      row({ keys: [], clicks: 1, impressions: 10 }),
      ...days(5, () => 1),
    ];
    const i = pick(build({ dateRows: rows }), "calendar");
    expect(i.title).toBe("Szczyt: 50 klik. ");
    expect(i.detail).toBe("Największy szczyt aktywności w wybranym oknie: - (50 klik.).");
  });
});

describe("Słownik EN - te same dane, angielska warstwa tekstu", () => {
  const params: Partial<Params> = {
    totals: { clicks: 100, impressions: 2000, ctr: 0.05, position: 8.4 },
    prevTotals: { clicks: 80, impressions: 1800, ctr: 0.044, position: 9.1 },
    dateRows: days(10, (i) => i),
    queryRows: [
      row({ keys: ["eu policy"], clicks: 30, impressions: 1700, position: 14 }),
      row({ keys: ["cee summit"], clicks: 70, impressions: 300, position: 2 }),
    ],
    pageRows: [
      row({
        keys: ["https://example.com/a"],
        clicks: 50,
        impressions: 900,
        ctr: 0.09,
        position: 6,
      }),
    ],
    countryRows: [row({ keys: ["pol"], clicks: 90 }), row({ keys: ["deu"], clicks: 10 })],
    deviceRows: [
      row({ keys: ["mobile"], clicks: 40, impressions: 1200, ctr: 0.033 }),
      row({ keys: ["desktop"], clicks: 60, impressions: 800, ctr: 0.075 }),
    ],
    windowDays: 28,
  };

  it("tytuły i etykiety elementów pochodzą z angielskiej nakładki", () => {
    const out = build(params, "en");
    expect(out.map((i) => i.title)).toEqual([
      "Clicks +25.0% vs previous window",
      "CTR 5.00% at position 8.4",
      "Average position: 8.4 (-0.7)",
      "Second half of the window: +250.0% clicks vs the first",
      "0 phrases with ≥20 impr. and 0 clicks",
      "15% of impressions in the TOP 10",
      "Dominant country: POL (90%)",
      "Mobile 40 clicks, desktop 60 clicks",
      "0 pages significantly below the CTR benchmark, 1 above",
      "Peak: 9 clicks 2026-03-10",
    ]);
    expect(pick(out, "kpi-ctr").element).toBe("KPI · CTR");
    expect(pick(out, "calendar").element).toBe("Daily activity");
  });

  it("detale i rekomendacje też są angielskie - żadna gałąź nie wpada na polski fallback", () => {
    const out = build(params, "en");
    expect(pick(out, "kpi-clicks").detail).toBe(
      "In the current 28-day window: 100 clicks. Previously: 80. Impressions: 2000 (previously 1800).",
    );
    expect(pick(out, "kpi-position").detail).toBe("Position improved by 0.7 spots.");
    expect(pick(out, "devices").detail).toContain("Desktop clearly leads");
    expect(pick(out, "pages").fixes).toEqual(
      lista("adminAnalytics.gsc.insights.pages.fixes", "en"),
    );
  });

  it("obie wersje językowe mają ten sam szkielet: te same id i te same severity", () => {
    const pl = build(params, "pl");
    const en = build(params, "en");
    expect(en.map((i) => i.id)).toEqual(pl.map((i) => i.id));
    expect(en.map((i) => i.severity)).toEqual(pl.map((i) => i.severity));
    for (const i of en) {
      expect(i.title.startsWith("adminAnalytics.")).toBe(false);
      expect(i.fixes.length).toBeGreaterThan(0);
    }
  });

  it("obie wersje różnią się treścią - to dowód, że EN nie jest kopią PL", () => {
    const pl = build(params, "pl");
    const en = build(params, "en");
    // Detal ma w KAŻDYM wpisie inne brzmienie - gdyby `getFixedT("en")" cicho
    // spadło na polski rdzeń (tak działo się przed `ensureCoreLanguage`),
    // pierwsza z tych par byłaby identyczna.
    for (let idx = 0; idx < pl.length; idx += 1) {
      expect(en[idx].detail).not.toBe(pl[idx].detail);
    }
    expect(pick(en, "calendar").element).not.toBe(pick(pl, "calendar").element);
    expect(pick(en, "countries").element).not.toBe(pick(pl, "countries").element);
  });
});

describe("Izolacja najemców i czystość buildera", () => {
  const najemcaA: Partial<Params> = {
    totals: { clicks: 900, impressions: 9000, ctr: 0.1, position: 2 },
    prevTotals: { clicks: 100, impressions: 1000, ctr: 0.1, position: 2 },
    countryRows: [row({ keys: ["pol"], clicks: 900 })],
    queryRows: [row({ keys: ["new european strategies"], clicks: 900, impressions: 9000 })],
  };
  const najemcaB: Partial<Params> = {
    totals: { clicks: 7, impressions: 4000, ctr: 0.00175, position: 33 },
    prevTotals: { clicks: 7, impressions: 4000, ctr: 0.00175, position: 33 },
    countryRows: [row({ keys: ["deu"], clicks: 7 })],
    queryRows: [row({ keys: ["berlin summit"], clicks: 0, impressions: 4000, position: 33 })],
  };

  it("raport najemcy B po raporcie najemcy A nie niesie ANI JEDNEJ liczby najemcy A", () => {
    build(najemcaA);
    const b = build(najemcaB);
    const tekst = b.map((i) => `${i.title} ${i.detail}`).join(" | ");
    expect(tekst).toContain("DEU");
    expect(tekst).not.toContain("POL");
    expect(tekst).not.toContain("900");
    expect(pick(b, "kpi-clicks").detail).toContain("7 klik. Poprzednio: 7");
  });

  it("kolejność wywołań nie zmienia wyniku - builder nie trzyma stanu między najemcami", () => {
    const bPoA = (() => {
      build(najemcaA);
      return build(najemcaB);
    })();
    const bSam = build(najemcaB);
    expect(bPoA).toEqual(bSam);
  });

  it("nie mutuje wejściowych tablic - sortowania robione są na kopii", () => {
    const dateRows = days(8, (i) => 8 - i);
    const countryRows = [row({ keys: ["deu"], clicks: 1 }), row({ keys: ["pol"], clicks: 99 })];
    const dateSnapshot = dateRows.map((r) => r.keys[0]);
    const countrySnapshot = countryRows.map((r) => r.keys[0]);
    build({ totals: { ...ZERO_TOTALS, clicks: 100 }, dateRows, countryRows });
    expect(dateRows.map((r) => r.keys[0])).toEqual(dateSnapshot);
    expect(countryRows.map((r) => r.keys[0])).toEqual(countrySnapshot);
  });
});
