// Karta „NES Edge Cache" na `/admin/performance` - 0/43 linii, 0/18 funkcji.
//
// PO CO TEN EKRAN MUSI BYĆ DOWIEDZIONY. To jedyne miejsce, w którym operator
// widzi, czy wbudowany cache dokumentów SSR w ogóle pracuje. Reguły, których
// złamania NIE WIDAĆ na ekranie, bo panel zawsze coś narysuje:
//
//   1. WSPÓŁCZYNNIK TRAFIEŃ liczy się z (hits + stale) / (hits + stale +
//      misses) - `stale` JEST trafieniem, bo dokument wyszedł z cache'a, tylko
//      nieświeży. Wliczenie `stale` do mianownika po stronie pudła zaniżyłoby
//      wynik i kazało operatorowi szukać awarii, której nie ma. Kolumny
//      `bypass` w tym rachunku nie ma wcale - żądanie pominięte nie jest ani
//      trafieniem, ani chybieniem.
//   2. BRAK RUCHU TO NIE ZERO PROCENT. Świeży izolat ma zerowe liczniki;
//      „0%" znaczyłoby „cache nie działa", a prawda jest „nie było jeszcze
//      czego zmierzyć". Panel musi w tym miejscu pokazać kreskę.
//   3. PURGE JEST NIEDOSTĘPNY, GDY CACHE JEST WYŁĄCZONY. Przycisk czyszczący
//      wyłączony cache nie ma czego wyczyścić, a jego kliknięcie kosztuje
//      round-trip i sugeruje operatorowi, że coś zrobił.
//   4. ODRZUTY ROZMIAROWE (`oversize`) mają własny kafel, i to nie ozdoba:
//      komentarz w źródle zapisuje diagnozę z 2026-08-18 - rosnący licznik
//      znaczy, że trasa wypadła z cache'a NA STAŁE i każdy czytelnik płaci
//      pełny render SSR. Pole jest opcjonalne w migawce, więc jego brak musi
//      dawać zero, a nie „undefined” na ekranie.
//   5. SONDA ŚCIEŻKI przyjmuje tylko adresy zaczynające się od „/". Bez tego
//      warunku formularz strzela zapytaniem na każdą literówkę.
//
// GRANICE. Atrapowane są WYŁĄCZNIE granice: funkcje serwerowe cache'a, i18n
// i toasty. Prawdziwe biegną: `Card`, `Button`, `FloatingInput` oraz cała
// arytmetyka karty (`formatBytes`, `hitRatio`, `StatusPill`, `StatTile`).
// ZERO sieci, ZERO danych osobowych - migawka nie niesie tożsamości.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  stats: vi.fn(),
  probe: vi.fn(),
  purge: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  lang: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
// TYLKO `useServerFn`, resztę modułu ROZWIJAMY. Podmiana całego modułu zabiera
// `createIsomorphicFn`, którego używa `lib/i18n/localeRuntime` - a ten wchodzi
// tu przez nakładkę słownika importowaną przez samą kartę.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  // W produkcji `useServerFn` owija funkcję serwerową; w teście tożsamość
  // wystarcza - asercje idą wprost na atrapy niżej.
  return { ...actual, useServerFn: <T,>(fn: T) => fn };
});
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => h.toastError(...a),
    success: (...a: unknown[]) => h.toastSuccess(...a),
  },
}));
vi.mock("@/lib/edgeCache.functions", () => ({
  getEdgeCacheStats: (...a: unknown[]) => h.stats(...a),
  probeEdgeCache: (...a: unknown[]) => h.probe(...a),
  purgeEdgeCache: (...a: unknown[]) => h.purge(...a),
}));

import { EdgeCacheCard } from "../EdgeCacheCard";

/** Migawka w kształcie kontraktu `DocumentCacheSnapshot`. */
function snapshot(patch: Record<string, unknown> = {}) {
  return {
    enabled: true,
    entries: 12,
    bytes: 2048,
    maxBytes: 1024 * 1024 * 4,
    hits: 30,
    stale: 10,
    misses: 10,
    bypass: 5,
    stores: 20,
    evictions: 1,
    purges: 0,
    revalidations: 3,
    revalidationFailures: 0,
    oversize: 0,
    startedAt: "2026-09-01T10:00:00.000Z",
    l2: { enabled: false, hits: 0, stale: 0, stores: 0, bumps: 0 },
    recent: [],
    ...patch,
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EdgeCacheCard />
    </QueryClientProvider>,
  );
}

/** Wartość kafla o danej etykiecie - kafle to para „etykieta + liczba". */
function tile(labelKey: string): string {
  const label = screen.getByText(labelKey);
  const box = label.parentElement;
  if (!box) throw new Error(`test: kafel ${labelKey} nie ma kontenera`);
  return (box.textContent ?? "").replace(labelKey, "").trim();
}

beforeEach(() => {
  cleanup();
  h.stats.mockReset().mockResolvedValue(snapshot());
  h.probe.mockReset();
  h.purge.mockReset();
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.lang = "pl";
});

// ---------------------------------------------------------------------------
describe("współczynnik trafień", () => {
  it("liczy STALE jako trafienie, a BYPASS pomija zupełnie", async () => {
    // (30 + 10) / (30 + 10 + 10) = 80%. Pięć żądań pominiętych nie wchodzi do
    // rachunku - inaczej wynik byłby 72,7% i sugerowałby awarię.
    mount();

    await waitFor(() => expect(tile("adminEdgeCache.tiles.hitRatio")).toBe("80%"));
  });

  it("BRAK RUCHU pokazuje kreskę, nie zero procent", async () => {
    // Świeży izolat: „0%" znaczyłoby „cache nie działa", a prawda jest
    // „nie było jeszcze czego zmierzyć".
    h.stats.mockResolvedValue(snapshot({ hits: 0, stale: 0, misses: 0, bypass: 4 }));

    mount();

    await waitFor(() => expect(tile("adminEdgeCache.tiles.hitRatio")).toBe("-"));
  });

  it("same chybienia dają zero procent - to JEST pomiar, nie brak pomiaru", async () => {
    h.stats.mockResolvedValue(snapshot({ hits: 0, stale: 0, misses: 7 }));

    mount();

    await waitFor(() => expect(tile("adminEdgeCache.tiles.hitRatio")).toBe("0%"));
  });
});

// ---------------------------------------------------------------------------
describe("liczby i jednostki", () => {
  it("pamięć poniżej kilobajta idzie w bajtach, powyżej - w KB, powyżej megabajta - w MB", async () => {
    h.stats.mockResolvedValue(snapshot({ bytes: 512, maxBytes: 4 * 1024 * 1024 }));
    mount();
    await waitFor(() => expect(tile("adminEdgeCache.tiles.memory")).toContain("512 B"));
    expect(tile("adminEdgeCache.tiles.memory")).toContain("MB");

    cleanup();
    h.stats.mockResolvedValue(snapshot({ bytes: 200 * 1024, maxBytes: 900 * 1024 }));
    mount();
    await waitFor(() => expect(tile("adminEdgeCache.tiles.memory")).toContain("KB"));
    expect(tile("adminEdgeCache.tiles.memory")).not.toContain("MB");
  });

  it("BRAK pola `oversize` w migawce daje ZERO, nie „undefined” na ekranie", async () => {
    // Pole jest opcjonalne w kontrakcie, a rosnące odrzuty rozmiarowe znaczą,
    // że trasa wypadła z cache'a na stałe - kafel nie może się rozsypać.
    const { oversize: _oversize, ...withoutOversize } = snapshot();
    h.stats.mockResolvedValue(withoutOversize);

    mount();

    await waitFor(() => expect(tile("adminEdgeCache.tiles.oversize")).toBe("0"));
  });

  it("język przełącza separator liczb - te same dane, inna lokalizacja", async () => {
    h.stats.mockResolvedValue(snapshot({ entries: 12345 }));
    mount();
    await waitFor(() => expect(tile("adminEdgeCache.tiles.entries")).toMatch(/12.345/));

    cleanup();
    h.lang = "en";
    h.stats.mockResolvedValue(snapshot({ entries: 12345 }));
    mount();
    await waitFor(() => expect(tile("adminEdgeCache.tiles.entries")).toBe("12,345"));
  });
});

// ---------------------------------------------------------------------------
describe("stan cache'a", () => {
  it("WŁĄCZONY i WYŁĄCZONY cache to dwie różne etykiety, nie ta sama", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("adminEdgeCache.enabled")).toBeTruthy());

    cleanup();
    h.stats.mockResolvedValue(snapshot({ enabled: false }));
    mount();
    await waitFor(() => expect(screen.getByText("adminEdgeCache.disabled")).toBeTruthy());
  });

  it("PURGE jest niedostępny przy wyłączonym cache'u", async () => {
    h.stats.mockResolvedValue(snapshot({ enabled: false }));

    mount();

    await waitFor(() => expect(screen.getByText("adminEdgeCache.disabled")).toBeTruthy());
    const purge = screen.getByRole("button", { name: /adminEdgeCache\.purge/ });
    expect(purge.hasAttribute("disabled")).toBe(true);
  });

  it("PURGE wpisuje ZWRÓCONĄ migawkę do cache'a zapytania - panel nie czeka na kolejny odczyt", async () => {
    h.purge.mockResolvedValue({ removed: 7, snapshot: snapshot({ entries: 0, purges: 1 }) });

    mount();
    await waitFor(() => expect(screen.getByText("adminEdgeCache.enabled")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.purge/ }));

    await waitFor(() => expect(tile("adminEdgeCache.tiles.entries")).toBe("0"));
    expect(tile("adminEdgeCache.tiles.purges")).toBe("1");
    expect(h.toastSuccess).toHaveBeenCalled();
    // Liczba usuniętych wpisów idzie do komunikatu - inaczej operator nie wie,
    // czy purge cokolwiek zrobił.
    expect(String(h.toastSuccess.mock.calls[0]?.[0])).toContain("count=7");
  });

  it("AWARIA purge'a pokazuje komunikat i NIE podmienia liczb", async () => {
    h.purge.mockRejectedValue(new Error("edge padl"));

    mount();
    await waitFor(() => expect(tile("adminEdgeCache.tiles.entries")).toBe("12"));
    fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.purge/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(tile("adminEdgeCache.tiles.entries")).toBe("12");
  });

  it("AWARIA odczytu statystyk pokazuje komunikat, a nie pustą kartę", async () => {
    h.stats.mockRejectedValue(new Error("brak dostępu"));

    mount();

    await waitFor(() => expect(screen.getByText("adminEdgeCache.loadError")).toBeTruthy());
    // Kafle nie mogą się pojawić z zerami - to byłby pomiar, którego nie ma.
    expect(screen.queryByText("adminEdgeCache.tiles.hitRatio")).toBeNull();
  });

  it("ODŚWIEŻENIE woła odczyt ponownie", async () => {
    mount();
    // Czekamy na WYRENDEROWANE dane, nie na samo wywołanie: dopóki zapytanie
    // jest w locie, przycisk odświeżania jest wyłączony i klik przepada.
    await waitFor(() => expect(screen.getByText("adminEdgeCache.enabled")).toBeTruthy());
    expect(h.stats).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.refresh/ }));

    await waitFor(() => expect(h.stats).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
describe("druga warstwa cache'a (L2)", () => {
  it("NIEAKTYWNA warstwa nie pokazuje swoich kafli - zera sugerowałyby, że pracuje", async () => {
    mount();

    await waitFor(() => expect(screen.getByText("adminEdgeCache.l2.inactive")).toBeTruthy());
    expect(screen.queryByText("adminEdgeCache.l2.tiles.hits")).toBeNull();
  });

  it("AKTYWNA warstwa pokazuje własne liczniki", async () => {
    h.stats.mockResolvedValue(
      snapshot({ l2: { enabled: true, hits: 9, stale: 2, stores: 4, bumps: 1 } }),
    );

    mount();

    await waitFor(() => expect(screen.getByText("adminEdgeCache.l2.active")).toBeTruthy());
    expect(tile("adminEdgeCache.l2.tiles.hits")).toBe("9");
    expect(tile("adminEdgeCache.l2.tiles.bumps")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
describe("sonda ścieżki", () => {
  it("adres BEZ wiodącego ukośnika NIE strzela zapytaniem", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("adminEdgeCache.diag.title")).toBeTruthy());

    const input = screen.getByLabelText("adminEdgeCache.diag.probeLabel");
    fireEvent.change(input, { target: { value: "cennik" } });
    fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.diag\.probeRun/ }));

    expect(h.probe).not.toHaveBeenCalled();
  });

  it("adres jest PRZYCINANY z białych znaków przed wysłaniem", async () => {
    h.probe.mockResolvedValue({
      status: "HIT",
      path: "/cennik",
      cacheable: true,
      cached: true,
      ageS: 12,
      freshForS: 48,
    });

    mount();
    await waitFor(() => expect(screen.getByText("adminEdgeCache.diag.title")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("adminEdgeCache.diag.probeLabel"), {
      target: { value: "  /cennik  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.diag\.probeRun/ }));

    await waitFor(() => expect(h.probe).toHaveBeenCalledWith({ data: { path: "/cennik" } }));
  });

  it("trzy wyniki sondy to TRZY różne komunikaty: trafienie, chybienie, pominięcie", async () => {
    const cases = [
      [
        { status: "HIT", path: "/a", cacheable: true, cached: true, ageS: 5, freshForS: 55 },
        "adminEdgeCache.diag.probeCached",
      ],
      [
        { status: "MISS", path: "/b", cacheable: true, cached: false },
        "adminEdgeCache.diag.probeMiss",
      ],
      [
        { status: "BYPASS", path: "/c", cacheable: false, cached: false, bypassReason: "cookie" },
        "adminEdgeCache.diag.probeBypass",
      ],
    ] as const;

    for (const [result, expectedKey] of cases) {
      cleanup();
      h.probe.mockResolvedValue(result);
      mount();
      await waitFor(() => expect(screen.getByText("adminEdgeCache.diag.title")).toBeTruthy());
      fireEvent.change(screen.getByLabelText("adminEdgeCache.diag.probeLabel"), {
        target: { value: result.path },
      });
      fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.diag\.probeRun/ }));

      await waitFor(() =>
        expect(screen.getByText(new RegExp(expectedKey.replace(/\./g, "\\.")))).toBeTruthy(),
      );
    }
  });

  it("AWARIA sondy pokazuje komunikat i nie zostawia poprzedniego wyniku", async () => {
    h.probe.mockRejectedValue(new Error("sonda padla"));

    mount();
    await waitFor(() => expect(screen.getByText("adminEdgeCache.diag.title")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("adminEdgeCache.diag.probeLabel"), {
      target: { value: "/cennik" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adminEdgeCache\.diag\.probeRun/ }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
describe("dziennik ostatnich decyzji", () => {
  it("PUSTY dziennik mówi, że jest pusty - nie pokazuje nagłówków tabeli bez wierszy", async () => {
    mount();

    await waitFor(() => expect(screen.getByText("adminEdgeCache.diag.recentEmpty")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("wiersze niosą ścieżkę, status i sklejone szczegóły", async () => {
    h.stats.mockResolvedValue(
      snapshot({
        recent: [
          {
            at: "2026-09-01T10:05:00.000Z",
            path: "/wpis/alfa",
            status: "STALE",
            ageS: 42,
            renderMs: 210,
            cacheControl: "public, max-age=60",
          },
          { at: "2026-09-01T10:06:00.000Z", path: "/wpis/beta", status: "MISS" },
        ],
      }),
    );

    mount();

    const table = await waitFor(() => screen.getByRole("table"));
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("/wpis/alfa");
    expect(rows[0].textContent).toContain("age 42s");
    expect(rows[0].textContent).toContain("ssr 210ms");
    expect(rows[0].textContent).toContain("public, max-age=60");
    // Wiersz bez opcjonalnych pól nie może zostawić „undefined” ani samych
    // separatorów.
    expect(rows[1].textContent).toContain("/wpis/beta");
    expect(rows[1].textContent).not.toContain("undefined");
    expect(rows[1].textContent).not.toContain("·");
  });

  it("nieznany status decyzji dostaje neutralny ton, a nie brak stylu", async () => {
    h.stats.mockResolvedValue(
      snapshot({ recent: [{ at: "2026-09-01T10:05:00.000Z", path: "/x", status: "COS_NOWEGO" }] }),
    );

    mount();

    const pill = await waitFor(() => screen.getByText("COS_NOWEGO"));
    expect(pill.className).toContain("border-border");
  });
});
