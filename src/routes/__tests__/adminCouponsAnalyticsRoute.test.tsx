// TRASA `/admin/coupons/analytics` - cztery kafle, wykres TOP 10 i tabela
// szczegółów, wszystko z JEDNEGO wywołania RPC `b2b_coupons_analytics`.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
// Ryzyko tej trasy to LICZBY, po których ktoś decyduje o kolejnej kampanii
// rabatowej. Przedmiotem dowodu jest:
//
//   1. ARGUMENTY RPC: dokładnie `_from` i `_to`, oba ISO. Wyczyszczenie daty
//      „od" cofa raport DO EPOKI - to jest decyzja o zakresie, nie o wyglądzie.
//   2. AGREGACJE PRZY DZIELENIU: pusty zbiór NIE daje „NaN%" (dzielenie jest
//      osłonięte), ale brak kolumny w odpowiedzi daje „NaN" w kaflu kwoty -
//      awaria kontraktu funkcji SQL wygląda inaczej niż awaria odczytu.
//   3. STAN PUSTY: wykres ustępuje napisowi, tabela też, a kafle pokazują
//      uczciwe zera.
//   4. WYKRES niesie kolejność Z ODPOWIEDZI - klient nie sortuje, więc „TOP 10"
//      przestaje być TOP-em w chwili zmiany `ORDER BY` w migracji.
//   5. STAN BŁĘDU vs STAN PUSTY - dziś nierozróżnialne. Zgłoszone przez `it.fails`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Samych agregacji i opcji wykresu - mają
// tabelaryczny test w `couponAnalyticsView.test.ts`. Renderu tabeli szczegółów -
// `CouponAnalyticsTable.test.tsx`.
//
// DLACZEGO `EChart` JEST ATRAPĄ. Prawdziwy komponent to `React.lazy`
// + dynamiczny import silnika ECharts; pod happy-dom nie ma czego rysować.
// Atrapa wystawia OPCJĘ, czyli jedyną rzecz, którą ta trasa naprawdę wytwarza.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseResult, SupabaseRpcStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  /** Gdy true, RPC nigdy się nie rozwiązuje (stan „wczytywanie"). */
  pending: false,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub } = await import("@/test/supabase");
  const rpc = supabaseRpcStub();
  h.rpc = rpc;
  return {
    supabase: {
      rpc: (name: string, args?: Record<string, unknown>) =>
        h.pending ? new Promise(() => undefined) : rpc.rpc(name, args),
    },
  };
});
vi.mock("@/components/admin/analytics/EChart", () => ({
  EChart: ({ option, height }: { option: unknown; height?: number | string }) => (
    <div data-testid="wykres" data-height={String(height)}>
      {JSON.stringify(option)}
    </div>
  ),
}));
vi.mock("@/components/admin/coupons/DatePickerField", () => ({
  DatePickerField: ({
    value,
    onChange,
    label,
  }: {
    value: Date | undefined;
    onChange: (value: Date | undefined) => void;
    label: string;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value ? value.toISOString() : ""}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : undefined)}
      />
    </label>
  ),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as AnalyticsRoute } from "@/routes/admin.coupons.analytics";
import { fail, ok } from "@/test/supabase";

const PATH = "/admin/coupons/analytics";
const FUNKCJA = "b2b_coupons_analytics";

function rpc(): SupabaseRpcStub {
  if (!h.rpc) throw new Error("test: atrapa RPC nie została zainicjowana");
  return h.rpc;
}

interface AnalyticsFixture {
  coupon_id: string;
  code: string;
  name: string | null;
  redemptions: number;
  revenue_cents: number;
  discount_cents_total: number;
}

function wiersz(overrides: Partial<AnalyticsFixture> = {}): AnalyticsFixture {
  return {
    coupon_id: "c-1",
    code: "NES-A1",
    name: null,
    redemptions: 2,
    revenue_cents: 8000,
    discount_cents_total: 2000,
    ...overrides,
  };
}

let odpowiedz: SupabaseResult;

beforeEach(() => {
  rpc().reset();
  h.pending = false;
  odpowiedz = ok([wiersz()]);
  rpc().setResponse(FUNKCJA, () => odpowiedz);
});

afterEach(cleanup);

async function renderPanel(): Promise<void> {
  await renderRoute({
    route: AnalyticsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
}

async function renderReady(): Promise<void> {
  await renderPanel();
  await waitFor(() => expect(rpc().callsFor(FUNKCJA).length).toBeGreaterThan(0));
}

/**
 * Wartość kafla po jego etykiecie. Wyszukanie po samym napisie NIE WYSTARCZY:
 * „Przychód netto" i „Realizacje" są jednocześnie etykietami kafli i nagłówkami
 * kolumn tabeli szczegółów, więc `getByText` widziałby dwa węzły. Kafel poznaje
 * się po sąsiedztwie: etykieta, a zaraz za nią liczba w dużym stopniu pisma.
 */
function kafel(etykieta: string): string {
  for (const el of screen.getAllByText(etykieta)) {
    const wartosc = el.nextElementSibling;
    if (wartosc && wartosc.className.includes("text-2xl")) return wartosc.textContent ?? "";
  }
  throw new Error(`test: na ekranie nie ma kafla „${etykieta}"`);
}

/** Opcja przekazana do wykresu - jedyny wytwór tej trasy poza kaflami. */
function opcjaWykresu(): {
  xAxis: { data: string[] };
  series: Array<{ name: string; data: number[] }>;
} {
  return JSON.parse(screen.getByTestId("wykres").textContent ?? "{}");
}

describe("argumenty RPC analityki", () => {
  it("woła DOKŁADNIE jedną funkcję z dwoma argumentami ISO - żadnych zapytań tabelarycznych", async () => {
    await renderReady();
    expect(rpc().names()).toEqual([FUNKCJA]);
    const call = rpc().lastCall(FUNKCJA);
    expect(call?.keys()).toEqual(["_from", "_to"]);
    expect(String(call?.arg("_from"))).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(String(call?.arg("_to"))).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("domyślne okno to 90 dni wstecz - granica 'od' jest wcześniejsza niż 'do'", async () => {
    await renderReady();
    const call = rpc().lastCall(FUNKCJA);
    expect(String(call?.arg("_from")) < String(call?.arg("_to"))).toBe(true);
  });

  it("WYCZYSZCZENIE daty 'od' cofa raport DO EPOKI, a nie wyłącza filtra", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText("Od"), { target: { value: "" } });
    await waitFor(() => expect(rpc().callsFor(FUNKCJA).length).toBeGreaterThan(1));
    expect(rpc().lastCall(FUNKCJA)?.arg("_from")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("zmiana zakresu to NOWY odczyt - filtr nie jest ozdobą nad tymi samymi danymi", async () => {
    await renderReady();
    const przed = rpc().callsFor(FUNKCJA).length;
    fireEvent.change(screen.getByLabelText("Od"), {
      target: { value: "2026-01-01T00:00:00.000Z" },
    });
    await waitFor(() => expect(rpc().callsFor(FUNKCJA).length).toBeGreaterThan(przed));
    expect(rpc().lastCall(FUNKCJA)?.arg("_from")).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("agregacje przy dzieleniu", () => {
  it("PUSTY zbiór daje '0%', a nie 'NaN%' - dzielenie konwersji jest osłonięte warunkiem", async () => {
    odpowiedz = ok([]);
    await renderReady();
    await waitFor(() => expect(kafel("Konwersja")).toBe("0%"));
  });

  it("trzy kupony, jeden z realizacjami, dają konwersję 33.3%", async () => {
    odpowiedz = ok([
      wiersz({ coupon_id: "c-1", redemptions: 4 }),
      wiersz({ coupon_id: "c-2", code: "NES-B2", redemptions: 0 }),
      wiersz({ coupon_id: "c-3", code: "NES-C3", redemptions: 0 }),
    ]);
    await renderReady();
    await waitFor(() => expect(kafel("Konwersja")).toBe("33.3%"));
  });

  it("same kupony bez realizacji dają '0.0%', czyli liczbę, a nie brak wyniku", async () => {
    odpowiedz = ok([
      wiersz({ coupon_id: "c-1", redemptions: 0 }),
      wiersz({ coupon_id: "c-2", code: "NES-B2", redemptions: 0 }),
    ]);
    await renderReady();
    await waitFor(() => expect(kafel("Konwersja")).toBe("0.0%"));
  });

  it("dzielenie kwoty przez 100 na pustym zbiorze daje '0.00', nie 'NaN'", async () => {
    odpowiedz = ok([]);
    await renderReady();
    await waitFor(() => expect(kafel("Przychód netto")).toBe("0.00"));
  });

  it("BRAK kolumny przychodu w odpowiedzi zatruwa kafel wartością 'NaN'", async () => {
    const bezPola = { ...wiersz() } as Record<string, unknown>;
    delete bezPola.revenue_cents;
    odpowiedz = ok([bezPola]);
    await renderReady();
    await waitFor(() => expect(kafel("Przychód netto")).toBe("NaN"));
    // Konwersja liczy się dalej poprawnie - to nie jest awaria dzielenia.
    expect(kafel("Konwersja")).toBe("100.0%");
  });

  it("NULL w kolumnie przychodu cichnie do 0.00 - straty nie widać", async () => {
    odpowiedz = ok([wiersz({ revenue_cents: null as unknown as number })]);
    await renderReady();
    await waitFor(() => expect(kafel("Przychód netto")).toBe("0.00"));
  });

  it("kafle sumują kolumny odpowiedzi, a nie liczą po swojemu", async () => {
    odpowiedz = ok([
      wiersz({ coupon_id: "c-1", redemptions: 2, revenue_cents: 8000 }),
      wiersz({ coupon_id: "c-2", code: "NES-B2", redemptions: 3, revenue_cents: 1500 }),
    ]);
    await renderReady();
    await waitFor(() => expect(kafel("Kupony")).toBe("2"));
    expect(kafel("Realizacje")).toBe("5");
    expect(kafel("Przychód netto")).toBe("95.00");
  });
});

describe("obcięcie odpowiedzi funkcji SQL", () => {
  it("100 wierszy pokazuje '100' i ANI SŁOWA o tym, że kuponów może być więcej", async () => {
    odpowiedz = ok(
      Array.from({ length: 100 }, (_, i) => wiersz({ coupon_id: `c-${i}`, code: `KOD-${i}` })),
    );
    await renderReady();
    await waitFor(() => expect(kafel("Kupony")).toBe("100"));
    expect(screen.queryByText(/100\+/)).not.toBeInTheDocument();
  });
});

describe("wykres TOP 10", () => {
  it("kategorie osi to kody w KOLEJNOŚCI Z ODPOWIEDZI - klient nie sortuje", async () => {
    odpowiedz = ok([
      wiersz({ coupon_id: "c-1", code: "MALY", redemptions: 2 }),
      wiersz({ coupon_id: "c-2", code: "DUZY", redemptions: 99 }),
      wiersz({ coupon_id: "c-3", code: "SREDNI", redemptions: 5 }),
    ]);
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("wykres")).toBeInTheDocument());
    expect(opcjaWykresu().xAxis.data).toEqual(["MALY", "DUZY", "SREDNI"]);
    expect(opcjaWykresu().series[0].data).toEqual([2, 99, 5]);
  });

  it("realizacje w serii są LICZBAMI, także gdy funkcja odda je stringiem bigint", async () => {
    odpowiedz = ok([wiersz({ redemptions: "7" as unknown as number })]);
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("wykres")).toBeInTheDocument());
    expect(opcjaWykresu().series[0].data).toEqual([7]);
  });

  it("wykres pokazuje NAJWYŻEJ dziesięć słupków, choć kafel liczy wszystkie kupony", async () => {
    odpowiedz = ok(
      Array.from({ length: 14 }, (_, i) => wiersz({ coupon_id: `c-${i}`, code: `KOD-${i}` })),
    );
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("wykres")).toBeInTheDocument());
    expect(opcjaWykresu().xAxis.data).toHaveLength(10);
    expect(kafel("Kupony")).toBe("14");
  });

  it("nazwa serii jest po polsku dla języka domyślnego panelu", async () => {
    await renderReady();
    await waitFor(() => expect(screen.getByTestId("wykres")).toBeInTheDocument());
    expect(opcjaWykresu().series[0].name).toBe("Realizacje");
  });
});

describe("stany zawartości", () => {
  it("nierozwiązany odczyt pokazuje WCZYTYWANIE i nie montuje wykresu", async () => {
    h.pending = true;
    await renderPanel();
    await waitFor(() => expect(screen.getByText("Wczytywanie…")).toBeInTheDocument());
    expect(screen.queryByTestId("wykres")).not.toBeInTheDocument();
  });

  it("PUSTY zbiór: wykres ustępuje napisowi, tabela też, a kafle pokazują zera", async () => {
    odpowiedz = ok([]);
    await renderReady();
    await waitFor(() => expect(screen.getAllByText("Brak danych.")).toHaveLength(2));
    expect(screen.queryByTestId("wykres")).not.toBeInTheDocument();
    expect(kafel("Kupony")).toBe("0");
    expect(kafel("Realizacje")).toBe("0");
    expect(kafel("Przychód netto")).toBe("0.00");
    expect(kafel("Konwersja")).toBe("0%");
  });
});

describe("DEFEKT: odmowa RPC wygląda dokładnie jak brak danych", () => {
  // Para `it.fails` + `it()`. Po naprawie (gałąź `isError`) usuwa się OBA RAZEM.
  it.fails(
    "odmowa funkcji SQL POWINNA być powiedziana wprost, a nie zamieniona w 'Brak danych.'",
    async () => {
      odpowiedz = fail("permission denied for function b2b_coupons_analytics");
      await renderPanel();
      await waitFor(() => expect(screen.getAllByText("Brak danych.")).toHaveLength(2));
      expect(screen.queryAllByText("Brak danych.")).toHaveLength(0);
    },
  );

  it("STAN FAKTYCZNY: po odmowie kafle pokazują zera, a raport melduje 'Brak danych.'", async () => {
    odpowiedz = fail("permission denied for function b2b_coupons_analytics");
    await renderPanel();
    await waitFor(() => expect(screen.getAllByText("Brak danych.")).toHaveLength(2));
    expect(kafel("Przychód netto")).toBe("0.00");
    expect(kafel("Konwersja")).toBe("0%");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});

describe("tabela szczegółów", () => {
  it("suma pod tabelą zgadza się z sumą kolumny rabatu", async () => {
    odpowiedz = ok([
      wiersz({ coupon_id: "c-1", discount_cents_total: 2000 }),
      wiersz({ coupon_id: "c-2", code: "NES-B2", discount_cents_total: 550 }),
    ]);
    await renderReady();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getByText("-20.00")).toBeInTheDocument();
    expect(screen.getByText("-5.50")).toBeInTheDocument();
    expect(screen.getByText("25.50")).toBeInTheDocument();
  });
});

describe("nagłówek trasy", () => {
  it("trasa NIE deklaruje własnego head() - zakładka nie ma nazwy w karcie przeglądarki", async () => {
    // `noindex` panelu pochodzi z layoutu `/admin`; tego tu NIE dublujemy.
    expect(await routeMeta(AnalyticsRoute)).toEqual([]);
  });
});
