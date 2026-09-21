// PO CO. Most między panelem CMS („Na czasie") a prawdziwym nagłówkiem strony
// jest JEDYNYM kanałem podglądu na żywo: panel publikuje NIEZAPISANĄ
// konfigurację, Header ją renderuje zamiast tej z bazy. Ten kanał nie ma
// żadnego typu w runtime - to zdarzenie `CustomEvent` plus pole na `window` -
// więc każdy jego kontrakt da się złamać po cichu, bez ani jednego błędu
// kompilacji:
//   1. LUSTRO NA `window` I ZDARZENIE MUSZĄ IŚĆ RAZEM. Header montowany PO
//      publikacji czyta lustro (`__cmsTickerDraft`), Header już zamontowany
//      czyta zdarzenie. Publikacja, która zaktualizuje tylko jedno z dwóch,
//      daje dwa różne paski na tej samej stronie i nic tego nie zgłosi.
//   2. SPRZĄTANIE JEST WARUNKIEM POPRAWNOŚCI, NIE HIGIENĄ. Draft to stan
//      GLOBALNY, przeżywający odmontowanie panelu: brak `clearTickerDraft()`
//      zostawia prawdziwy nagłówek na wieczystym podglądzie roboczym, a brak
//      `removeEventListener` w hooku - `setState` na odmontowanym drzewie.
//   3. GAŁĄŹ SSR. Moduł ląduje w grafie nagłówka, więc jest wykonywany także
//      na Workerze, gdzie `window` nie istnieje. Zgubiona straż `getWin()`
//      w nadawcy wywraca CAŁY render serwerowy, a nie tylko pasek.
// Plik mierzy zachowanie mostu widziane przez OBU jego użytkowników naraz
// (nadawcę i odbiorcę), bo tylko ich zgodność coś znaczy.
//
// CZEGO TU NIE MA I DLACZEGO: straży `if (!w) return` W EFEKCIE hooka nie da
// się wykonać z testu jednostkowego ani nawet w produkcji. Efekty Reacta nie
// uruchamiają się przy renderze serwerowym, a `react-dom/client` przewraca się
// na braku `window` ZANIM dojdzie do commitu (`resolveUpdatePriority`), więc
// ta jedna instrukcja jest asekuracją martwą z konstrukcji. Straż w
// `publishTickerDraft`/`clearTickerDraft` - już nie, i ta ma tu własny test.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import { publishTickerDraft, clearTickerDraft, useTickerDraft } from "../tickerDraftBridge";

const EVENT = "cms:ticker-draft";

/** Okno z lustrem draftu - odczyt bez rzutowania na `any`. */
type DraftWindow = Window & { __cmsTickerDraft?: TickerConfig | null };

function mirror(): TickerConfig | null | undefined {
  return (window as DraftWindow).__cmsTickerDraft;
}

function cfg(over: Partial<TickerConfig> = {}): TickerConfig {
  return { enabled: true, source: "trending", mode: "scroll", days: 7, limit: 8, ...over };
}

beforeEach(() => {
  // Draft to stan globalny - bez tego jeden test dziedziczy podgląd po drugim.
  clearTickerDraft();
  (window as DraftWindow).__cmsTickerDraft = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publishTickerDraft / clearTickerDraft - nadawca", () => {
  it("publikacja aktualizuje LUSTRO i rozgłasza zdarzenie z tą samą konfiguracją", () => {
    const seen: Array<TickerConfig | null> = [];
    const listener = (e: Event): void => {
      seen.push((e as CustomEvent<TickerConfig | null>).detail);
    };
    window.addEventListener(EVENT, listener);

    const draft = cfg({ source: "pinned", limit: 3 });
    publishTickerDraft(draft);

    // Oba kanały naraz: kto dołączy później, czyta lustro; kto już słucha - zdarzenie.
    expect(mirror()).toEqual(draft);
    expect(seen).toEqual([draft]);
    window.removeEventListener(EVENT, listener);
  });

  it("czyszczenie zeruje lustro i rozgłasza BRAK draftu, a nie ostatnią wartość", () => {
    const seen: Array<TickerConfig | null> = [];
    const listener = (e: Event): void => {
      seen.push((e as CustomEvent<TickerConfig | null>).detail);
    };
    publishTickerDraft(cfg());
    window.addEventListener(EVENT, listener);

    clearTickerDraft();

    expect(mirror()).toBeNull();
    expect(seen).toEqual([null]);
    window.removeEventListener(EVENT, listener);
  });

  it("każda publikacja NADPISUJE poprzednią - most niesie stan, nie kolejkę", () => {
    publishTickerDraft(cfg({ limit: 1 }));
    publishTickerDraft(cfg({ limit: 5 }));
    expect(mirror()?.limit).toBe(5);
  });

  it("bez `window` (render na Workerze) nadawca milczy zamiast wywracać SSR", () => {
    const before = mirror();
    vi.stubGlobal("window", undefined);

    expect(() => publishTickerDraft(cfg())).not.toThrow();
    expect(() => clearTickerDraft()).not.toThrow();

    vi.unstubAllGlobals();
    // Straż `getWin()` ma ODCIĄĆ zapis, nie tylko przełknąć wyjątek.
    expect(mirror()).toBe(before);
  });
});

describe("useTickerDraft - odbiorca", () => {
  it("widzi draft opublikowany PRZED montażem nagłówka", () => {
    const draft = cfg({ source: "selected", selectedPostIds: ["p-1"] });
    publishTickerDraft(draft);

    const { result } = renderHook(() => useTickerDraft());

    expect(result.current).toEqual(draft);
  });

  it("bez publikacji zwraca null, czyli „renderuj konfigurację z bazy”", () => {
    const { result } = renderHook(() => useTickerDraft());
    expect(result.current).toBeNull();
  });

  it("pełna pętla: publikacja po montażu dociera, czyszczenie oddaje sterowanie bazie", () => {
    const { result } = renderHook(() => useTickerDraft());

    const draft = cfg({ layoutStyle: "glassLive", labelPl: "Podgląd" });
    act(() => publishTickerDraft(draft));
    expect(result.current).toEqual(draft);

    act(() => clearTickerDraft());
    expect(result.current).toBeNull();
  });

  it("rozgłasza do WSZYSTKICH subskrybentów, nie tylko do ostatniego", () => {
    const a = renderHook(() => useTickerDraft());
    const b = renderHook(() => useTickerDraft());

    const draft = cfg({ limit: 2 });
    act(() => publishTickerDraft(draft));

    expect(a.result.current).toEqual(draft);
    expect(b.result.current).toEqual(draft);
  });

  it("zdarzenie BEZ `detail` czyta się jako brak draftu, nie jako `undefined`", () => {
    // Header rozróżnia tylko „draft jest” od „draftu nie ma”. Gdyby hook
    // przepuścił `undefined`, warunek `draft ?? persisted` po stronie nagłówka
    // nadal by działał, ale `draft === null` w testach i w kodzie panelu już nie.
    publishTickerDraft(cfg());
    const { result } = renderHook(() => useTickerDraft());

    act(() => {
      window.dispatchEvent(new Event(EVENT));
    });

    expect(result.current).toBeNull();
  });

  it("most NIE waliduje ładunku - obcy `detail` przechodzi do nagłówka jak swój", () => {
    // Charakterystyka, nie życzenie: most jest kanałem wewnątrz jednej karty
    // przeglądarki i świadomie nie przepuszcza ładunku przez
    // `normalizeTickerConfig`. Test przypina ten fakt, żeby ewentualne dołożenie
    // walidacji było ZMIANĄ ZACHOWANIA widoczną w tym pliku, a nie cichym
    // zaostrzeniem kontraktu, o które nikt nie prosił.
    const { result } = renderHook(() => useTickerDraft());

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { source: "z kosmosu" } }));
    });

    expect(result.current).toEqual({ source: "z kosmosu" });
  });

  it("odmontowanie ODPINA nasłuch - późniejsza publikacja nie rusza martwego drzewa", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useTickerDraft());

    act(() => publishTickerDraft(cfg({ limit: 4 })));
    const beforeUnmount = result.current;
    unmount();

    expect(remove).toHaveBeenCalledWith(EVENT, expect.any(Function));

    // Po odpięciu hook nie może już zmienić zdania - a `console.error`
    // z ostrzeżeniem Reacta o `setState` na odmontowanym drzewie ma nie paść.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    publishTickerDraft(cfg({ limit: 9 }));
    expect(result.current).toBe(beforeUnmount);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("draft PRZEŻYWA odmontowanie odbiorcy - to stan globalny, nie stan komponentu", () => {
    // Dlatego panel MUSI wołać `clearTickerDraft()` w sprzątaniu efektu:
    // samo zniknięcie nagłówka nie kasuje podglądu.
    publishTickerDraft(cfg({ limit: 6 }));
    const first = renderHook(() => useTickerDraft());
    first.unmount();

    const second = renderHook(() => useTickerDraft());
    expect(second.result.current?.limit).toBe(6);
  });
});
