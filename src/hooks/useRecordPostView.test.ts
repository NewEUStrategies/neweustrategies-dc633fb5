// Regresja RODO: licznik odsłon jest bramkowany zgodą analityczną.
//
// Hook zapisywał `post_views` (i mintował trwały `viewer_hash` w localStorage)
// od razu po 1,5 s, bez pytania o zgodę - a /cookies deklaruje `post_views`
// w kategorii „analityka”. Test pilnuje obu stron bramki: braku zapisu i braku
// identyfikatora przed zgodą, oraz kompletnej ścieżki po zgodzie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { Activity, createElement, type ReactNode } from "react";

const h = vi.hoisted(() => ({
  record: vi.fn(),
  hasAnalyticsConsent: vi.fn(),
  upsert: vi.fn(),
  upsertThen: vi.fn(),
  from: vi.fn(),
  user: null as { id: string } | null,
  startDwell: vi.fn(),
  stopDwell: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.record }));
vi.mock("@/lib/views/postViews.functions", () => ({ recordPostView: {} }));
vi.mock("@/lib/ads/consent", () => ({
  hasAnalyticsConsent: () => h.hasAnalyticsConsent(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
// Pomiar czasu czytania ma własne testy (`lib/views/__tests__/postDwell.test.ts`);
// tutaj liczy się wyłącznie, KIEDY hook go uruchamia i domyka.
vi.mock("@/lib/views/postDwell", () => ({
  startPostDwell: (...args: unknown[]) => h.startDwell(...args),
}));
// Mock łańcucha zapisu historii czytania. `from` i `upsert` są SZPIEGAMI, a nie
// pustymi zaślepkami, bo test niżej asertuje nie tylko FAKT zapisu, ale i to,
// DO KTÓREJ TABELI oraz z jakim ładunkiem - inaczej bramka zgody dałaby się
// „spełnić" przepięciem zapisu na inną tabelę.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.from(table);
      return { upsert: (...args: unknown[]) => (h.upsert(...args), { then: h.upsertThen }) };
    },
  },
}));

import { useRecordPostView } from "./useRecordPostView";

const POST = "11111111-1111-1111-1111-111111111111";
const STORAGE_KEY = "viewer_hash:v2";
const LEGACY_KEY = "__viewer_hash";

/** Montuje hook i przepuszcza opóźnienie 1,5 s filtrujące odbicia. */
async function mountAndTick(): Promise<void> {
  renderHook(() => useRecordPostView(POST, null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.record.mockReset().mockResolvedValue({ ok: true });
  h.hasAnalyticsConsent.mockReset().mockReturnValue(false);
  h.upsert.mockReset();
  h.upsertThen.mockReset();
  h.from.mockReset();
  h.user = null;
  h.stopDwell.mockReset();
  h.startDwell.mockReset().mockReturnValue(h.stopDwell);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRecordPostView - bramka zgody analitycznej", () => {
  it("bez zgody nie zapisuje odsłony ani nie mintuje identyfikatora", async () => {
    await mountAndTick();

    expect(h.record).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("po zgodzie zapisuje odsłonę z nieprzejrzystym identyfikatorem widza", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);

    await mountAndTick();

    expect(h.record).toHaveBeenCalledTimes(1);
    const arg = h.record.mock.calls[0]?.[0] as { data: { postId: string; viewerHash: string } };
    expect(arg.data.postId).toBe(POST);
    // `record_post_view` waliduje długość tokenu (min. 16 znaków).
    expect(arg.data.viewerHash.length).toBeGreaterThanOrEqual(16);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain(arg.data.viewerHash);
  });

  it("wycofana zgoda usuwa identyfikator zapisany wcześniej", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hash: "0123456789abcdef0123", mintedAt: Date.now() }),
    );
    window.localStorage.setItem(LEGACY_KEY, "0123456789abcdef0123");

    await mountAndTick();

    expect(h.record).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("zgoda nie znosi reguły, że autor nie nabija odsłon własnego wpisu", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

    renderHook(() => useRecordPostView(POST, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).not.toHaveBeenCalled();
  });
});

// REGRESJA DRUGIEJ STRONY TEJ SAMEJ BRAMKI.
//
// Do 2026-09-14 zapis do `user_read_history` stał POZA gałęzią zgody: hook
// przestawał liczyć odsłonę i kasował `viewer_hash`, a mimo to dalej dopisywał
// do profilu zachowania konkretnej osoby - co i kiedy przeczytała. Mock upsertu
// istniał w tym pliku od początku i nie był asertowany ANI RAZU, więc decyzja
// nigdy nie została utrwalona. Utrwalają ją przypadki niżej - CZTERY, bo
// czwarty pilnuje ASYMETRII: autor nie nabija odsłony, ale swoją historię
// czytania zapisuje. Liczba jest tu istotna, nie ozdobna: bez tego czwartego
// przypadku regresja obejmująca oba zapisy jednym `if (!isAuthor)` przejdzie.
describe("useRecordPostView - historia czytania pod tą samą bramką zgody", () => {
  const USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("bez zgody NIE dopisuje historii czytania zalogowanego użytkownika", async () => {
    h.user = { id: USER };

    await mountAndTick();

    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalledWith("user_read_history");
  });

  it("po zgodzie dopisuje historię czytania z kluczem konfliktu użytkownik-wpis", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: USER };

    await mountAndTick();

    expect(h.from).toHaveBeenCalledWith("user_read_history");
    expect(h.upsert).toHaveBeenCalledTimes(1);
    const [wiersz, opcje] = h.upsert.mock.calls[0] as [
      { user_id: string; post_id: string; read_at: string },
      { onConflict: string },
    ];
    expect(wiersz.user_id).toBe(USER);
    expect(wiersz.post_id).toBe(POST);
    expect(typeof wiersz.read_at).toBe("string");
    // Bez tego klucza każde wejście na wpis dokładałoby wiersz zamiast odświeżać.
    expect(opcje.onConflict).toBe("user_id,post_id");
  });

  it("anonim nie dopisuje historii czytania nawet po zgodzie", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = null;

    await mountAndTick();

    expect(h.upsert).not.toHaveBeenCalled();
  });

  // Ta asymetria jest ZAMIERZONA i dlatego ma własny test: reguła „autor nie
  // nabija odsłon własnego wpisu" chroni METRYKĘ WPISU, a historia czytania to
  // dane autora jako czytelnika. Gdyby ktoś kiedyś objął oba zapisy jednym
  // warunkiem `isAuthor`, ten test to wychwyci.
  it("autor czytający własny wpis: bez odsłony, ale z historią czytania", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: USER };

    renderHook(() => useRecordPostView(POST, USER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });
});

// SYGNAŁ DWELL REKOMENDACJI - pomiar czasu czytania jedzie WYŁĄCZNIE za
// policzoną odsłoną: ta sama zgoda, to samo wykluczenie autora, ten sam
// `viewer_hash`. Pomiar bez odsłony nie miałby w bazie wiersza, do którego
// mógłby trafić - a pomiar bez zgody byłby pomiarem, którego /cookies nie
// obiecuje.
describe("useRecordPostView - pomiar czasu czytania za policzoną odsłoną", () => {
  it("po zgodzie rusza pomiar dla TEGO wpisu i TEGO samego viewer_hash co odsłona", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);

    await mountAndTick();

    expect(h.startDwell).toHaveBeenCalledTimes(1);
    const arg = h.record.mock.calls[0]?.[0] as { data: { viewerHash: string } };
    expect(h.startDwell).toHaveBeenCalledWith(POST, arg.data.viewerHash);
  });

  it("odmontowanie domyka pomiar (wysyłka narastającej sumy)", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    const { unmount } = renderHook(() => useRecordPostView(POST, null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.stopDwell).not.toHaveBeenCalled();

    unmount();

    expect(h.stopDwell).toHaveBeenCalledTimes(1);
  });

  it("bez zgody pomiar NIE rusza", async () => {
    await mountAndTick();

    expect(h.startDwell).not.toHaveBeenCalled();
  });

  it("autor czytający własny wpis nie uruchamia pomiaru - jego odsłona nie jest liczona", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

    renderHook(() => useRecordPostView(POST, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.startDwell).not.toHaveBeenCalled();
  });

  it("odmontowanie ZANIM moduł pomiaru dojedzie nie zostawia osieroconego pomiaru", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    const { unmount } = renderHook(() => useRecordPostView(POST, null));
    // Wersja SYNCHRONICZNA: licznik odpala, `import()` jeszcze się nie rozwiązał.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(h.startDwell).not.toHaveBeenCalled();
  });

  it("awaria pomiaru jest cicha - nie psuje odsłony ani renderu", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.startDwell.mockImplementation(() => {
      throw new Error("brak performance.now");
    });

    await mountAndTick();

    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.startDwell).toHaveBeenCalledTimes(1);
  });
});

// Cykl życia efektu. `useRecordPostView` siedzi w trasie wpisu, którą domyślny
// klient TanStack Start montuje w <StrictMode>: efekt biegnie tam dwa razy
// (montaż -> cleanup -> montaż). Znacznik „już wysłano” stawiany przy
// PLANOWANIU kazał drugiemu przebiegowi wyjść bez nowego timera, a cleanup
// pierwszego skasował jedyny zaplanowany - w dev odsłona i historia czytania
// nie zapisywały się NIGDY. Pierwszy przypadek niżej padał na tamtym kodzie
// (zero wywołań), reszta pilnuje, że naprawa nie zaczęła dublować zapisów.
describe("useRecordPostView - cykl życia efektu", () => {
  const USER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  it("podwójny montaż StrictMode zapisuje odsłonę i historię DOKŁADNIE raz", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: USER };

    renderHook(() => useRecordPostView(POST, null), { reactStrictMode: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("ponowne odsłonięcie ukrytego wpisu nie liczy drugiej odsłony", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    let mode: "visible" | "hidden" = "visible";
    const view = renderHook(() => useRecordPostView(POST, null), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(Activity, { mode, children }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.record).toHaveBeenCalledTimes(1);

    // <Activity> sprząta efekty przy ukryciu i odpala je przy odsłonięciu -
    // ten sam wpis w tym samym montażu to wciąż jedna odsłona.
    mode = "hidden";
    view.rerender();
    mode = "visible";
    view.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("zmiana wpisu w tym samym montażu liczy nowy wpis, a porzucony przed 1,5 s - nie", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const THIRD = "33333333-3333-3333-3333-333333333333";
    const view = renderHook(({ id }) => useRecordPostView(id, null), {
      initialProps: { id: POST },
    });

    // Przejście dalej przed upływem opóźnienia = odbicie, nie odsłona.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    view.rerender({ id: OTHER });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    view.rerender({ id: THIRD });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const recorded = h.record.mock.calls.map(
      (call) => (call[0] as { data: { postId: string } }).data.postId,
    );
    expect(recorded).toEqual([OTHER, THIRD]);
  });

  it("bez identyfikatora wpisu nic nie planuje", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: USER };

    renderHook(() => useRecordPostView(null, null));

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.record).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

// Prerender spekulacyjny (Speculation Rules): najazd kursora na link renderuje
// stronę w tle - to NIE jest odsłona. Odliczanie rusza dopiero po aktywacji.
describe("useRecordPostView - strona prerenderowana", () => {
  type PrerenderDocument = Document & { prerendering?: boolean };

  beforeEach(() => {
    Object.defineProperty(document as PrerenderDocument, "prerendering", {
      value: true,
      configurable: true,
    });
    h.hasAnalyticsConsent.mockReturnValue(true);
  });

  afterEach(() => {
    delete (document as PrerenderDocument).prerendering;
  });

  it("liczy odsłonę dopiero 1,5 s po aktywacji prerenderu", async () => {
    renderHook(() => useRecordPostView(POST, null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.record).not.toHaveBeenCalled();

    Object.defineProperty(document as PrerenderDocument, "prerendering", {
      value: false,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event("prerenderingchange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).toHaveBeenCalledTimes(1);
  });

  it("strona porzucona przed aktywacją nie zostawia nasłuchu ani odsłony", async () => {
    const view = renderHook(() => useRecordPostView(POST, null));
    view.unmount();

    act(() => {
      document.dispatchEvent(new Event("prerenderingchange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(h.record).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Oba zapisy są best-effort: odrzucenie (500 serwera, RLS, brak sieci) nie może
// wyjść jako nieobsłużone odrzucenie obietnicy - w przeglądarce to błąd
// w konsoli i w monitoringu na KAŻDYM wejściu na wpis przy awarii backendu.
describe("useRecordPostView - zapisy best-effort", () => {
  it("odrzucony licznik i odrzucony upsert historii są obsłużone", async () => {
    h.hasAnalyticsConsent.mockReturnValue(true);
    h.user = { id: "dddddddd-dddd-dddd-dddd-dddddddddddd" };
    // Obietnica powstaje dopiero przy wywołaniu - tak jak żądanie serwera.
    const handled: Promise<unknown>[] = [];
    h.record.mockImplementation(() => {
      const rejected = Promise.reject(new Error("record_post_view: 500"));
      const realCatch = rejected.catch.bind(rejected);
      return Object.assign(rejected, {
        catch: (onRejected: (reason: unknown) => unknown) => {
          const chained = realCatch(onRejected);
          handled.push(chained);
          return chained;
        },
      });
    });
    h.upsertThen.mockImplementation(
      (onFulfilled: undefined, onRejected: (reason: unknown) => void) =>
        Promise.reject(new Error("rls")).then(onFulfilled, onRejected),
    );

    await mountAndTick();

    expect(handled).toHaveLength(1);
    expect(h.upsertThen).toHaveBeenCalledTimes(1);
    // Łańcuchy z obsługą błędu ROZWIĄZUJĄ się - odrzucenie nie ucieka dalej.
    await expect(handled[0]).resolves.toBeUndefined();
    await expect(h.upsertThen.mock.results[0]?.value).resolves.toBeUndefined();
  });
});
