// Motyw wykresów BI (`src/components/admin/analytics/chartTheme.ts`) - pierwszy
// test tego pliku (stał na 0/16 linii).
//
// PO CO. Ten moduł jest JEDYNYM tłumaczem między semantycznymi tokenami CSS
// projektu a ECharts, a tłumaczenie jest nieoczywiste w obie strony:
//
//  1. FORMAT TOKENU. `readVar` opakowuje w `hsl(...)` WYŁĄCZNIE gołą trójkę HSL
//     („221 83% 53%" - zapis shadcn, który sam kolorem nie jest), a każdą inną
//     niepustą wartość przepuszcza dosłownie. Rozpoznawanie idzie więc po
//     wzorcu trójki, nie po liście dozwolonych prefiksów (`#`, `rgb`, `hsl`),
//     bo lista prefiksów z natury zostaje o krok za CSS-em i każdy napis,
//     którego nie zna, zamieniała w `hsl(<coś-co-nie-jest-trójką>)` - kolor,
//     którego przeglądarka nie umie odczytać, a wykres cicho maluje etykiety
//     domyślną czernią. Nic nie rzuca, nic nie trafia do konsoli - regres jest
//     niewidoczny inaczej niż przez asercję na wyniku `resolveChartTheme`, i
//     dlatego niżej stoją OBA kierunki naraz: trójka opakowana, `oklch(...)`
//     przepuszczony (`src/styles.css` trzyma `--foreground`, `--border`,
//     `--muted-foreground`, `--background` i `--primary` właśnie w OKLCH).
//  2. GAŁĄŹ SSR. `chartThemeSnapshot` jest podpięty w `EChartClient` jako
//     `getServerSnapshot` dla `useSyncExternalStore`, więc ten moduł JEST
//     wykonywany w workerze Cloudflare, gdzie zakres modułu żyje dłużej niż
//     jedno żądanie i obsługuje kolejno różnych tenantów. Strażnik
//     `typeof window === "undefined"` musi więc nie tylko nie rzucać, ale też
//     oddawać paletę TENANTOWO NEUTRALNĄ - inaczej pamięć podręczna modułu
//     stałaby się kanałem wycieku kolorów tenanta A do renderu tenanta B.
//  3. PRZEWLECZENIE. `baseOption` jest podkładem opcji KAŻDEGO wykresu panelu.
//     Zgubione pole (np. `tooltip.borderColor`) nie psuje testu renderu ani
//     typów - wykres po prostu dostaje domyślny kolor ECharts, biały w trybie
//     ciemnym. Dlatego asercje niżej idą po konkretnych ścieżkach opcji.
//
// CZYM MIERZONE TOKENY. happy-dom 20.x ODDAJE własności niestandardowe przez
// `getComputedStyle(root).getPropertyValue("--x")` dosłownie - sprawdzone sondą
// przed napisaniem tych testów: `#123abc`, `221 83% 53%`, `rgb(1, 2, 3)` i
// `oklch(0.5 0 0)` wracają znak w znak, a token nieustawiony (albo ustawiony na
// same spacje) wraca jako pusty napis. Dlatego testy ustawiają PRAWDZIWE
// zmienne CSS na `document.documentElement`, a nie szpiega na
// `getComputedStyle` - szpieg dowodziłby tylko tego, co sam zwraca.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedTheme } from "../chartTheme";

/** Tokeny, których dotyka `resolveChartTheme` - sprzątane po każdym przypadku. */
const TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--muted-foreground",
  "--border",
  "--foreground",
  "--background",
  "--primary",
] as const;

/** Paleta zapasowa z modułu - powielona świadomie, żeby test pilnował WARTOŚCI. */
const FALLBACK_PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"];

function setTokens(tokens: Record<string, string>): void {
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
}

/**
 * Świeży moduł na każdy przypadek.
 *
 * `chartTheme` trzyma migawkę motywu w zmiennej MODUŁOWEJ (`snapshot`), a ta
 * jest porzucana dopiero, gdy odpina się ostatni subskrybent. Bez resetu jeden
 * przypadek karmiłby następny cudzą paletą - i to nie hipotetycznie, bo
 * `chartThemeSnapshot()` zwraca zapamiętany obiekt bez ponownego odczytu.
 */
async function loadChartTheme() {
  vi.resetModules();
  return import("../chartTheme");
}

beforeEach(() => {
  for (const token of TOKENS) document.documentElement.style.removeProperty(token);
});

afterEach(() => {
  for (const token of TOKENS) document.documentElement.style.removeProperty(token);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("resolveChartTheme - gałąź SSR", () => {
  it("bez `window` oddaje paletę zapasową i NIE dotyka getComputedStyle", async () => {
    // Sedno: nie wystarczy „nie rzuca". Trzeba odróżnić „strażnik zadziałał" od
    // „strażnika nie ma, a happy-dom akurat oddał puste tokeny" - bo w drugim
    // przypadku wynik też byłby zapasowy. Rozróżnia to szpieg: strażnik stoi
    // PRZED pobraniem migawki stylu, więc licznik musi zostać na zerze.
    const { resolveChartTheme } = await loadChartTheme();
    const szpieg = vi.spyOn(window, "getComputedStyle");
    const realneOkno = window;

    vi.stubGlobal("window", undefined);
    const theme = resolveChartTheme();
    vi.stubGlobal("window", realneOkno);

    expect(theme.palette).toEqual(FALLBACK_PALETTE);
    expect(theme.muted).toBe("#6b7280");
    expect(theme.border).toBe("#e5e7eb");
    expect(theme.foreground).toBe("#111827");
    expect(theme.background).toBe("#ffffff");
    expect(theme.primary).toBe(FALLBACK_PALETTE[0]);
    expect(szpieg).not.toHaveBeenCalled();
  });

  it("samo `document` niedostępne też zamyka gałąź - warunek jest alternatywą", async () => {
    // Druga połowa `||`. W środowisku, w którym `window` istnieje, a `document`
    // nie (worker, prerender z częściowym shimem), wejście do
    // `getComputedStyle(document.documentElement)` byłoby wyjątkiem w renderze
    // serwerowym, nie brzydkim kolorem.
    const { resolveChartTheme } = await loadChartTheme();
    const realnyDokument = document;

    vi.stubGlobal("document", undefined);
    let theme: ResolvedTheme | null = null;
    expect(() => {
      theme = resolveChartTheme();
    }).not.toThrow();
    vi.stubGlobal("document", realnyDokument);

    expect(theme).not.toBeNull();
    expect(theme!.palette).toEqual(FALLBACK_PALETTE);
  });

  it("kolory statusowe są STAŁE - nie pochodzą z tokenów i nie znikają na SSR", async () => {
    // `success`/`warning`/`danger` są zaszyte w obu gałęziach. Kontrakt jest
    // taki, że wykres statusowy ma ten sam zielony przed i po hydratacji -
    // inaczej wskaźnik „dobrze/źle" mrugałby kolorem przy pierwszym malowaniu.
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({ "--chart-1": "#111111" });
    const klient = resolveChartTheme();

    const realneOkno = window;
    vi.stubGlobal("window", undefined);
    const serwer = resolveChartTheme();
    vi.stubGlobal("window", realneOkno);

    expect(klient.success).toBe(serwer.success);
    expect(klient.warning).toBe(serwer.warning);
    expect(klient.danger).toBe(serwer.danger);
    expect([klient.success, klient.warning, klient.danger]).toEqual([
      "#16a34a",
      "#f59e0b",
      "#dc2626",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("readVar - rozpoznawanie formatu tokenu", () => {
  it("surowy kolor (#hex, rgb(), hsl()) przechodzi BEZ opakowania", async () => {
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({
      "--chart-1": "#123abc",
      "--chart-2": "rgb(34, 197, 94)",
      "--chart-3": "hsl(221 83% 53%)",
      "--chart-4": "rgba(0, 0, 0, 0.5)",
      "--chart-5": "hsla(10, 20%, 30%, 0.4)",
    });

    const theme = resolveChartTheme();

    expect(theme.palette).toEqual([
      "#123abc",
      "rgb(34, 197, 94)",
      "hsl(221 83% 53%)",
      "rgba(0, 0, 0, 0.5)",
      "hsla(10, 20%, 30%, 0.4)",
    ]);
  });

  it("goła TRÓJKA HSL jest opakowana w hsl() - to jest zapis shadcn", async () => {
    // Bez tego opakowania ECharts dostałby napis „221 83% 53%", którego nie
    // parsuje jako koloru, i cała seria wyszłaby domyślnym odcieniem.
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({
      "--chart-1": "221 83% 53%",
      "--muted-foreground": "215 16% 47%",
      "--border": "214 32% 91%",
    });

    const theme = resolveChartTheme();

    expect(theme.palette[0]).toBe("hsl(221 83% 53%)");
    expect(theme.muted).toBe("hsl(215 16% 47%)");
    expect(theme.border).toBe("hsl(214 32% 91%)");
  });

  it("token PUSTY spada na wartość zapasową WŁAŚCIWĄ dla swojego slotu", async () => {
    // Slot ma własny kolor zapasowy (`FALLBACK_PALETTE[i]`), nie wspólny.
    // Gdyby fallback był jeden, brak dwóch tokenów dałby dwie serie w tym samym
    // kolorze - wykres nieczytelny, a nie „lekko inny".
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({ "--chart-2": "   ", "--chart-4": "#00ff00" });

    const theme = resolveChartTheme();

    expect(theme.palette[0]).toBe(FALLBACK_PALETTE[0]);
    expect(theme.palette[1]).toBe(FALLBACK_PALETTE[1]);
    expect(theme.palette[2]).toBe(FALLBACK_PALETTE[2]);
    expect(theme.palette[3]).toBe("#00ff00");
    expect(theme.palette[4]).toBe(FALLBACK_PALETTE[4]);
    expect(new Set(theme.palette).size).toBe(5);
  });

  it("brak --primary spada na ROZWIĄZANY --chart-1, a nie na stałą z modułu", async () => {
    // Subtelne i łatwe do zepsucia przy refaktorze: fallbackiem `--primary`
    // jest `palette[0]` PO odczycie, więc tenant, który nadpisał tylko paletę,
    // dostaje spójny kolor wiodący. Fallback na stałą dałby akcent z motywu
    // fabrycznego na wykresie w barwach tenanta.
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({ "--chart-1": "210 100% 40%" });

    const theme = resolveChartTheme();

    expect(theme.palette[0]).toBe("hsl(210 100% 40%)");
    expect(theme.primary).toBe("hsl(210 100% 40%)");
    expect(theme.primary).not.toBe(FALLBACK_PALETTE[0]);
  });

  it("--primary ustawiony jawnie wygrywa z --chart-1", async () => {
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({ "--chart-1": "#111111", "--primary": "#222222" });

    expect(resolveChartTheme().primary).toBe("#222222");
  });

  it("białe znaki wokół tokenu nie przeciekają do wartości koloru", async () => {
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({ "--foreground": "  #0b0b0b  ", "--background": "\t221 83% 53%\t" });

    const theme = resolveChartTheme();

    expect(theme.foreground).toBe("#0b0b0b");
    expect(theme.background).toBe("hsl(221 83% 53%)");
  });

  it("token oklch() - realny format --foreground w src/styles.css - przechodzi BEZ opakowania w hsl()", async () => {
    // TO JEST FORMAT TEGO REPO, NIE HIPOTEZA. `src/styles.css` definiuje
    // semantyczne tokeny projektu w OKLCH:
    //   --foreground: oklch(0.18 0 0);   --muted-foreground: oklch(0.5 0 0);
    //   --border:     oklch(0.9 0.005 80); --background: oklch(0.99 0.003 80);
    //   --primary:    oklch(0.18 0 0);
    // Dopóki `readVar` szło po liście prefiksów (`#`, `rgb`, `hsl`), każdy z
    // nich wychodził stąd jako `hsl(oklch(...))` - napis, który nie jest
    // kolorem CSS w żadnej przeglądarce - i dotyczyło to czterech z pięciu pól
    // motywu niebędących paletą, czyli koloru tekstu, etykiet osi, siatki i
    // tła dymka na KAŻDYM wykresie panelu /admin/analytics. Teraz warunek jest
    // odwrócony: opakowywana jest tylko goła trójka, więc `oklch(...)` idzie
    // dalej dosłownie.
    //
    // Ten przypadek pilnuje odwrócenia od strony, z której awaria była
    // niewidoczna: ECharts nie waliduje koloru, tylko oddaje go canvasowi, a
    // canvas przy nieparsowalnym napisie zostaje przy poprzedniej wartości
    // `fillStyle`. Regres wyglądałby jak „etykiety są jakoś ciemne", nie jak
    // błąd - żaden test renderu ani typy go nie złapią.
    //
    // Asercja jest DOSŁOWNA (identyczność z wartością tokenu), bo dowodem na
    // brak opakowania jest tu wyłącznie znak w znak ten sam napis: warunek
    // „nie zawiera `hsl(`" przeszedłby także dla wartości okrojonej.
    const { resolveChartTheme } = await loadChartTheme();
    setTokens({
      "--foreground": "oklch(0.18 0 0)",
      "--muted-foreground": "oklch(0.5 0 0)",
      "--border": "oklch(0.9 0.005 80)",
      "--background": "oklch(0.99 0.003 80)",
    });

    const theme = resolveChartTheme();

    expect(theme.foreground).toBe("oklch(0.18 0 0)");
    expect(theme.muted).toBe("oklch(0.5 0 0)");
    expect(theme.border).toBe("oklch(0.9 0.005 80)");
    expect(theme.background).toBe("oklch(0.99 0.003 80)");
  });
});

// ---------------------------------------------------------------------------
describe("baseOption - przewleczenie motywu do opcji ECharts", () => {
  /** Motyw o rozłącznych, rozpoznawalnych kolorach - każde pole ma inny ślad. */
  const THEME: ResolvedTheme = {
    palette: ["#a10001", "#a10002", "#a10003", "#a10004", "#a10005"],
    muted: "#b10001",
    border: "#c10001",
    foreground: "#d10001",
    background: "#e10001",
    primary: "#f10001",
    success: "#16a34a",
    warning: "#f59e0b",
    danger: "#dc2626",
  };

  it("paleta trafia do `color`, a tekst bazowy do `textStyle.color`", async () => {
    const { baseOption } = await loadChartTheme();
    const option = baseOption(THEME) as Record<string, unknown>;

    expect(option.color).toEqual(THEME.palette);
    expect((option.textStyle as { color: string }).color).toBe(THEME.foreground);
  });

  it("tło wykresu jest PRZEZROCZYSTE - kartę maluje CSS, nie canvas", async () => {
    // Gdyby ECharts malował własne tło, przełączenie trybu jasny/ciemny
    // zostawiałoby biały prostokąt w ciemnej karcie do czasu przeliczenia
    // motywu. Kontrakt: canvas nigdy nie maluje podłoża.
    const { baseOption } = await loadChartTheme();

    expect((baseOption(THEME) as Record<string, unknown>).backgroundColor).toBe("transparent");
  });

  it("legenda używa koloru wyciszonego, nie bazowego", async () => {
    const { baseOption } = await loadChartTheme();
    const legend = (baseOption(THEME) as Record<string, unknown>).legend as {
      textStyle: { color: string };
    };

    expect(legend.textStyle.color).toBe(THEME.muted);
    expect(legend.textStyle.color).not.toBe(THEME.foreground);
  });

  it("dymek bierze tło z --background, ramkę z --border, a tekst z --foreground", async () => {
    // Trzy różne tokeny w jednym elemencie - najczęstsze miejsce na pomyłkę
    // „wkleiłem to samo pole dwa razy". Rozłączne kolory motywu wyżej sprawiają,
    // że taka pomyłka jest tu widoczna.
    const { baseOption } = await loadChartTheme();
    const tooltip = (baseOption(THEME) as Record<string, unknown>).tooltip as {
      backgroundColor: string;
      borderColor: string;
      textStyle: { color: string };
    };

    expect(tooltip.backgroundColor).toBe(THEME.background);
    expect(tooltip.borderColor).toBe(THEME.border);
    expect(tooltip.textStyle.color).toBe(THEME.foreground);
  });

  it("obie osie: linie i podziałka w kolorze ramki, etykiety w wyciszonym", async () => {
    const { baseOption } = await loadChartTheme();
    const option = baseOption(THEME) as Record<string, unknown>;
    const xAxis = option.xAxis as {
      axisLine: { lineStyle: { color: string } };
      axisTick: { lineStyle: { color: string } };
      axisLabel: { color: string };
      splitLine: { show: boolean };
    };
    const yAxis = option.yAxis as {
      splitLine: { lineStyle: { color: string; type: string } };
      axisLabel: { color: string };
      axisLine: { show: boolean };
    };

    expect(xAxis.axisLine.lineStyle.color).toBe(THEME.border);
    expect(xAxis.axisTick.lineStyle.color).toBe(THEME.border);
    expect(xAxis.axisLabel.color).toBe(THEME.muted);
    expect(yAxis.splitLine.lineStyle.color).toBe(THEME.border);
    expect(yAxis.axisLabel.color).toBe(THEME.muted);
    // Siatkę rysuje TYLKO oś Y - pionowe linie na osi czasu to szum.
    expect(xAxis.splitLine.show).toBe(false);
    expect(yAxis.axisLine.show).toBe(false);
    expect(yAxis.splitLine.lineStyle.type).toBe("dashed");
  });

  it("żaden kolor motywu nie jest zaszyty na sztywno - podmiana motywu zmienia WSZYSTKIE", async () => {
    // Test odwrotny do powyższych: zamiast sprawdzać pola po nazwie, porównuje
    // dwa serializaty. Jeśli ktoś dopisze do `baseOption` nowe pole z literałem
    // koloru zamiast z motywu, ten przypadek to złapie bez aktualizacji listy.
    const { baseOption } = await loadChartTheme();
    const inny: ResolvedTheme = {
      ...THEME,
      palette: THEME.palette.map((c) => c.replace("#a1", "#b2")),
      muted: "#b20001",
      border: "#c20001",
      foreground: "#d20001",
      background: "#e20001",
    };

    const pierwszy = JSON.stringify(baseOption(THEME));
    const drugi = JSON.stringify(baseOption(inny));

    for (const kolor of [THEME.muted, THEME.border, THEME.foreground, THEME.background]) {
      expect(pierwszy).toContain(kolor);
      expect(drugi).not.toContain(kolor);
    }
  });

  it("czcionka jest jawna, z zapasowym stosem systemowym", async () => {
    // Wykres eksportowany do PNG renderuje się na canvasie, który NIE dziedziczy
    // czcionki dokumentu. Brak `fontFamily` to inny krój na ekranie niż w pliku
    // pobranym przez `exportPng`.
    const { baseOption } = await loadChartTheme();
    const rodzina = (
      (baseOption(THEME) as Record<string, unknown>).textStyle as {
        fontFamily: string;
      }
    ).fontFamily;

    expect(rodzina).toContain("Red Hat Display");
    expect(rodzina).toContain("system-ui");
    expect(rodzina).toContain("sans-serif");
  });
});

// ---------------------------------------------------------------------------
describe("magazyn motywu - kontrakt useSyncExternalStore", () => {
  it("migawka ma STABILNĄ referencję, dopóki tokeny się nie zmieniły", async () => {
    // `useSyncExternalStore` porównuje migawki referencją. Nowy obiekt przy
    // każdym odczycie to nieskończona pętla renderów, a nie „lekki narzut".
    const { chartThemeSnapshot } = await loadChartTheme();

    expect(chartThemeSnapshot()).toBe(chartThemeSnapshot());
  });

  it("rozgłoszenie budzi subskrybentów TYLKO przy realnej zmianie tokenu", async () => {
    const { chartThemeSnapshot, subscribeChartTheme, notifyChartThemeChanged } =
      await loadChartTheme();
    const nasluch = vi.fn();
    const odepnij = subscribeChartTheme(nasluch);
    chartThemeSnapshot();

    notifyChartThemeChanged();
    expect(nasluch).not.toHaveBeenCalled();

    setTokens({ "--chart-1": "#ff0000" });
    notifyChartThemeChanged();
    expect(nasluch).toHaveBeenCalledTimes(1);
    expect(chartThemeSnapshot().palette[0]).toBe("#ff0000");

    odepnij();
  });

  it("odpięcie OSTATNIEGO subskrybenta porzuca migawkę - brak stanu między trasami", async () => {
    // Dowód, że pamięć podręczna nie przeżywa wyjścia z panelu: po odpięciu
    // ostatniego wykresu kolejny odczyt musi ZOBACZYĆ tokeny zmienione w
    // międzyczasie, a nie oddać stary obiekt.
    const { chartThemeSnapshot, subscribeChartTheme } = await loadChartTheme();
    setTokens({ "--chart-1": "#010101" });
    const odepnij = subscribeChartTheme(() => {});
    const przed = chartThemeSnapshot();
    expect(przed.palette[0]).toBe("#010101");

    odepnij();
    setTokens({ "--chart-1": "#020202" });
    const po = chartThemeSnapshot();

    expect(po).not.toBe(przed);
    expect(po.palette[0]).toBe("#020202");
  });

  it("dwóch subskrybentów: odpięcie jednego NIE porzuca migawki drugiego", async () => {
    const { chartThemeSnapshot, subscribeChartTheme } = await loadChartTheme();
    const odepnijA = subscribeChartTheme(() => {});
    const odepnijB = subscribeChartTheme(() => {});
    const przed = chartThemeSnapshot();

    odepnijA();

    expect(chartThemeSnapshot()).toBe(przed);
    odepnijB();
  });

  it("N wywołań scheduleChartThemeRefresh to JEDNO przeliczenie na turę", async () => {
    // To jest cała oszczędność, dla której powstał ten magazyn: dziesięć
    // wykresów montujących się naraz woła to dziesięć razy, a `getComputedStyle`
    // ma polecieć raz. Licznik na szpiegu mierzy to bezpośrednio.
    const { chartThemeSnapshot, scheduleChartThemeRefresh } = await loadChartTheme();
    chartThemeSnapshot();
    const real = window.getComputedStyle.bind(window);
    const szpieg = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((...args: Parameters<typeof real>) => real(...args));

    for (let i = 0; i < 10; i++) scheduleChartThemeRefresh();
    await Promise.resolve();

    expect(szpieg).toHaveBeenCalledTimes(1);
  });

  it("kolejne tury planują się od nowa - koalescencja nie jest wyłącznikiem", async () => {
    const { chartThemeSnapshot, subscribeChartTheme, scheduleChartThemeRefresh } =
      await loadChartTheme();
    const nasluch = vi.fn();
    const odepnij = subscribeChartTheme(nasluch);
    chartThemeSnapshot();

    setTokens({ "--chart-1": "#030303" });
    scheduleChartThemeRefresh();
    await Promise.resolve();
    expect(nasluch).toHaveBeenCalledTimes(1);

    setTokens({ "--chart-1": "#040404" });
    scheduleChartThemeRefresh();
    await Promise.resolve();
    expect(nasluch).toHaveBeenCalledTimes(2);

    odepnij();
  });
});

// ---------------------------------------------------------------------------
describe("izolacja tenantów", () => {
  it("migawka SSR nie niesie ANI JEDNEGO koloru tenanta - worker obsługuje wielu", async () => {
    // Dlaczego to jest tu asercją, a nie uwagą w komentarzu: `chartThemeSnapshot`
    // jest w `EChartClient` podpięty jako `getServerSnapshot`, a zakres modułu
    // w izolacie Cloudflare Workers przeżywa żądanie. Migawka zapisana przy
    // renderze tenanta A jest więc widoczna dla renderu tenanta B, bo na
    // serwerze nikt się nie subskrybuje i nikt jej nie porzuca. Bezpieczne jest
    // to WYŁĄCZNIE dlatego, że gałąź SSR nie czyta tokenów - i dokładnie to
    // sprawdza ten przypadek.
    const { chartThemeSnapshot } = await loadChartTheme();
    const KOLORY_TENANTA_A = {
      "--chart-1": "#aa0001",
      "--chart-2": "#aa0002",
      "--chart-3": "#aa0003",
      "--chart-4": "#aa0004",
      "--chart-5": "#aa0005",
      "--primary": "#aa0006",
      "--foreground": "#aa0007",
      "--background": "#aa0008",
      "--border": "#aa0009",
      "--muted-foreground": "#aa000a",
    };
    setTokens(KOLORY_TENANTA_A);

    const realneOkno = window;
    vi.stubGlobal("window", undefined);
    const zapamietana = chartThemeSnapshot();
    vi.stubGlobal("window", realneOkno);

    const serializat = JSON.stringify(zapamietana);
    for (const kolor of Object.values(KOLORY_TENANTA_A)) {
      expect(serializat).not.toContain(kolor);
    }
    expect(zapamietana.palette).toEqual(FALLBACK_PALETTE);

    // Drugie żądanie w tym samym izolacie - nadal paleta fabryczna, nie A.
    vi.stubGlobal("window", undefined);
    expect(chartThemeSnapshot().palette).toEqual(FALLBACK_PALETTE);
    vi.stubGlobal("window", realneOkno);
  });

  it("zmiana tokenów tenanta jest widoczna dopiero po rozgłoszeniu, ale JEST", async () => {
    // Druga strona tej samej monety: skoro migawka jest zamrożona, to przełączenie
    // tenanta w tej samej karcie (podgląd motywu w panelu) musi mieć drogę do
    // odświeżenia. Bez tego panel zostałby z paletą poprzedniego tenanta.
    const { chartThemeSnapshot, subscribeChartTheme, notifyChartThemeChanged } =
      await loadChartTheme();
    const odepnij = subscribeChartTheme(() => {});
    setTokens({ "--chart-1": "#aa1111" });
    expect(chartThemeSnapshot().palette[0]).toBe("#aa1111");

    setTokens({ "--chart-1": "#bb2222" });
    expect(chartThemeSnapshot().palette[0]).toBe("#aa1111");

    notifyChartThemeChanged();

    expect(chartThemeSnapshot().palette[0]).toBe("#bb2222");
    odepnij();
  });
});
