// TRASA `/admin/coupons/redemptions` - RAPORT FINANSOWY z realizacji kuponów
// B2B: trzy kafle kwot, siedmiokolumnowa tabela i eksport do arkusza.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
// Ryzyko tej trasy nie leży w dostępie (to pilnuje layout `/admin` i RLS),
// tylko w tym, że raport pieniędzy KŁAMIE CICHO:
//
//   1. PAGINACJI NIE MA. Jedynym ograniczeniem jest `limit(500)`, a kafle sumują
//      dokładnie ten obcięty zbiór - i nie mówią o tym ani słowa. Zgłoszone
//      przez `it.fails`.
//   2. ZAKRES DAT: `gte`/`lte` pojawiają się tylko wtedy, gdy data jest
//      ustawiona; wyczyszczenie pola USUWA ogniwo z zapytania (a nie ustawia
//      granicy domyślnej). Zmiana zakresu to NOWY klucz zapytania, czyli nowy
//      odczyt - inaczej filtr byłby ozdobą.
//   3. STAN BŁĘDU vs STAN PUSTY - dziś nierozróżnialne. Zgłoszone przez `it.fails`.
//   4. EKSPORT: co dokładnie ląduje w arkuszu (z PEŁNYM identyfikatorem
//      użytkownika) i że eksport NIE MELDUJE niczego - inaczej niż eksport
//      kodów kampanii.
//   5. Kafle liczą się przez `sumCouponTotals`, więc inwersja rabat/przychód
//      nie może tu wrócić po cichu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki `couponMoney` (własny plik), treści
// arkusza (`couponCsv.test.ts`), granic zakresu (`couponRedemptionsRange.test.ts`)
// ani renderu wiersza (`RedemptionsTable.test.tsx`).
//
// RODO: identyfikatory w fixture'ach są jawnie fałszywe, bez e-maili.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  pendingTables: new Set<string>(),
  /** Język interfejsu - ta trasa NIE MA kluczy w słowniku, ma własne `L(pl,en)`. */
  language: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  const neverSettling = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) builder[m] = () => builder;
    builder.then = () => new Promise(() => undefined);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.pendingTables.has(table) ? neverSettling() : db.from(table)),
    },
  };
});
// Kalendarz -> natywne pole: tylko tak da się WYCZYŚCIĆ zakres, a od tego
// zależy, czy zapytanie dostanie ogniwo `gte`/`lte`.
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
import { Route as RedemptionsRoute } from "@/routes/admin.coupons.redemptions";
import { fail, ok } from "@/test/supabase";

const PATH = "/admin/coupons/redemptions";
const TABELA = "b2b_coupon_redemptions";

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return h.db;
}

interface RedFixture {
  id: string;
  coupon_id: string;
  user_id: string | null;
  order_id: string | null;
  applied_cents: number;
  original_cents: number;
  currency: string;
  created_at: string;
  effects_applied_at: string | null;
  b2b_coupons: { code: string; name: string | null; grants_tier_key: string | null } | null;
}

function redemption(overrides: Partial<RedFixture> = {}): RedFixture {
  return {
    id: "red-1",
    coupon_id: "c-1",
    user_id: "9f8e7d6c-1111-2222-3333-444455556666",
    order_id: "ord-1",
    applied_cents: 2000,
    original_cents: 10000,
    currency: "PLN",
    created_at: "2026-08-20T10:00:00.000Z",
    effects_applied_at: null,
    b2b_coupons: { code: "NES-A1B2", name: "VIP", grants_tier_key: null },
    ...overrides,
  };
}

let odpowiedz: SupabaseResult;

beforeEach(() => {
  db().reset();
  h.pendingTables.clear();
  h.language = "pl";
  odpowiedz = ok([redemption()]);
  db().setResponse(TABELA, () => odpowiedz);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPanel(): Promise<void> {
  await renderRoute({
    route: RedemptionsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
}

async function renderReady(): Promise<void> {
  await renderPanel();
  await waitFor(() => expect(db().chainsFor(TABELA).length).toBeGreaterThan(0));
}

function ostatnieZapytanie(): RecordedChain {
  const chain = db().lastChain(TABELA);
  if (!chain) throw new Error("test: nie było żadnego zapytania o realizacje");
  return chain;
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

describe("kontrakt zapytania o realizacje", () => {
  it("pyta o komplet kolumn RAZEM z osadzonym kuponem - bez niego kolumna 'Kod' byłaby pusta", async () => {
    await renderReady();
    const kolumny = String(ostatnieZapytanie().argsOf("select")?.[0] ?? "");
    for (const kolumna of [
      "applied_cents",
      "original_cents",
      "currency",
      "created_at",
      "effects_applied_at",
      "b2b_coupons(code, name, grants_tier_key)",
    ]) {
      expect(kolumny).toContain(kolumna);
    }
  });

  it("sortuje malejąco po dacie - najnowsze realizacje na górze raportu", async () => {
    await renderReady();
    expect(ostatnieZapytanie().argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("domyślny zakres to ostatnie 30 dni: oba ogniwa filtrujące są obecne", async () => {
    await renderReady();
    const chain = ostatnieZapytanie();
    expect(chain.has("gte")).toBe(true);
    expect(chain.has("lte")).toBe(true);
    expect(String(chain.argsOf("gte")?.[1])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("WYCZYSZCZENIE daty 'do' USUWA ogniwo lte z kolejnego zapytania", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText("Do"), { target: { value: "" } });
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBeGreaterThan(1));
    const chain = ostatnieZapytanie();
    expect(chain.has("lte")).toBe(false);
    expect(chain.has("gte")).toBe(true);
  });

  it("zmiana zakresu to NOWY odczyt, a nie przefiltrowanie tego, co już w pamięci", async () => {
    await renderReady();
    const przed = db().chainsFor(TABELA).length;
    fireEvent.change(screen.getByLabelText("Od"), {
      target: { value: "2026-01-01T00:00:00.000Z" },
    });
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBeGreaterThan(przed));
    expect(ostatnieZapytanie().argsOf("gte")).toEqual(["created_at", "2026-01-01T00:00:00.000Z"]);
  });
});

describe("DEFEKT: raport nie ma paginacji i nie mówi o obcięciu", () => {
  const PIECSET = Array.from({ length: 500 }, (_, i) =>
    redemption({ id: `red-${i}`, original_cents: 200, applied_cents: 100 }),
  );

  // Para `it.fails` + `it()`. Po naprawie (paginacja albo jawny komunikat
  // o obcięciu) usuwa się OBA RAZEM.
  it.fails(
    "przy 500 wierszach raport POWINIEN mieć sterowanie stronami albo ostrzeżenie",
    async () => {
      odpowiedz = ok(PIECSET);
      await renderReady();
      await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
      expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    },
  );

  it("STAN FAKTYCZNY: limit 500, kafle sumują obcięty zbiór, a jedyny przycisk to eksport", async () => {
    odpowiedz = ok(PIECSET);
    await renderReady();
    expect(ostatnieZapytanie().argsOf("limit")).toEqual([500]);
    expect(ostatnieZapytanie().has("range")).toBe(false);
    await waitFor(() => expect(kafel("Realizacje")).toBe("500"));
    // 500 x 1.00 zł rabatu = 500.00, bez żadnego znaku, że wierszy jest więcej.
    expect(kafel("Rabat udzielony")).toBe("500.00");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("kafle podsumowania", () => {
  it("liczą przychód i rabat wg semantyki couponMoney, nie wg nazw kolumn bazy", async () => {
    odpowiedz = ok([
      redemption({ id: "red-1", original_cents: 10000, applied_cents: 2000 }),
      redemption({ id: "red-2", original_cents: 5000, applied_cents: 500 }),
    ]);
    await renderReady();
    await waitFor(() => expect(kafel("Realizacje")).toBe("2"));
    expect(kafel("Przychód netto")).toBe("125.00");
    expect(kafel("Rabat udzielony")).toBe("25.00");
  });

  it("dane niespójne (rabat > kwoty) NIE dają ujemnego przychodu", async () => {
    odpowiedz = ok([redemption({ original_cents: 1000, applied_cents: 3000 })]);
    await renderReady();
    await waitFor(() => expect(kafel("Przychód netto")).toBe("0.00"));
    expect(kafel("Rabat udzielony")).toBe("30.00");
  });

  it("pusty zakres pokazuje uczciwe zera, a nie puste kafle", async () => {
    odpowiedz = ok([]);
    await renderReady();
    await waitFor(() => expect(kafel("Realizacje")).toBe("0"));
    expect(kafel("Przychód netto")).toBe("0.00");
    expect(kafel("Rabat udzielony")).toBe("0.00");
  });
});

describe("stany zawartości", () => {
  it("nierozwiązany odczyt pokazuje WCZYTYWANIE, a nie 'brak realizacji'", async () => {
    h.pendingTables.add(TABELA);
    await renderPanel();
    await waitFor(() => expect(screen.getByText("Wczytywanie…")).toBeInTheDocument());
    expect(screen.queryByText("Brak realizacji w zakresie.")).not.toBeInTheDocument();
  });

  it("pusty zakres mówi WPROST, że w tym zakresie nic nie ma", async () => {
    odpowiedz = ok([]);
    await renderPanel();
    await waitFor(() =>
      expect(screen.getByText("Brak realizacji w zakresie.")).toBeInTheDocument(),
    );
  });
});

describe("DEFEKT: odmowa odczytu wygląda jak pusty zakres", () => {
  // Para `it.fails` + `it()`. Po naprawie (gałąź `isError`) usuwa się OBA RAZEM.
  it.fails(
    "odmowa RLS POWINNA być powiedziana wprost, a nie zamieniona w 'brak realizacji'",
    async () => {
      odpowiedz = fail("permission denied for table b2b_coupon_redemptions");
      await renderPanel();
      await waitFor(() =>
        expect(screen.getByText("Brak realizacji w zakresie.")).toBeInTheDocument(),
      );
      expect(screen.queryByText("Brak realizacji w zakresie.")).not.toBeInTheDocument();
    },
  );

  it("STAN FAKTYCZNY: po odmowie operator widzi 'brak realizacji' i ZERA w kaflach pieniędzy", async () => {
    odpowiedz = fail("permission denied for table b2b_coupon_redemptions");
    await renderPanel();
    await waitFor(() =>
      expect(screen.getByText("Brak realizacji w zakresie.")).toBeInTheDocument(),
    );
    expect(kafel("Przychód netto")).toBe("0.00");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});

describe("eksport arkusza", () => {
  function przechwycPobranie() {
    const createUrl = vi.fn().mockReturnValue("blob:csv");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const kotwice: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        kotwice.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });
    return { createUrl, revokeUrl, kotwice };
  }

  it("zapisuje WIDOCZNE wiersze z pełnym identyfikatorem użytkownika i datuje plik", async () => {
    const { createUrl, revokeUrl, kotwice } = przechwycPobranie();
    await renderReady();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(
      "date;code;user_id;order_id;original;discount;paid;currency\n" +
        "2026-08-20T10:00:00.000Z;NES-A1B2;9f8e7d6c-1111-2222-3333-444455556666;ord-1;100;20;80;PLN",
    );
    expect(kotwice[0]?.download).toMatch(/^coupon-redemptions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(revokeUrl).toHaveBeenCalledWith("blob:csv");
  });

  it("eksport PUSTEGO zakresu produkuje plik z samym nagłówkiem i NIE melduje niczego", async () => {
    odpowiedz = ok([]);
    const { createUrl } = przechwycPobranie();
    await renderReady();
    await waitFor(() =>
      expect(screen.getByText("Brak realizacji w zakresie.")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Eksport CSV/ }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe("date;code;user_id;order_id;original;discount;paid;currency\n");
  });
});

describe("język interfejsu", () => {
  it("po angielsku ekran NIE pokazuje polszczyzny - napisy idą z lokalnego L(pl,en)", async () => {
    h.language = "en";
    await renderReady();
    await waitFor(() => expect(screen.getByText("Redemption log")).toBeInTheDocument());
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export CSV/ })).toBeInTheDocument();
    expect(kafel("Net revenue")).toBe("80.00");
    expect(screen.queryByText("Historia realizacji")).not.toBeInTheDocument();
  });

  it("po angielsku PUSTY zakres też mówi po angielsku", async () => {
    h.language = "en";
    odpowiedz = ok([]);
    await renderPanel();
    await waitFor(() => expect(screen.getByText("No redemptions in range.")).toBeInTheDocument());
  });

  it("data realizacji jest formatowana językiem interfejsu, nie stałą", async () => {
    await renderReady();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const pl = screen.getAllByRole("row")[1].textContent ?? "";
    cleanup();
    h.language = "en";
    db().reset();
    db().setResponse(TABELA, () => odpowiedz);
    await renderReady();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.getAllByRole("row")[1].textContent).not.toBe(pl);
  });
});

describe("wyczyszczenie dolnej granicy zakresu", () => {
  it("wyczyszczenie daty 'od' USUWA ogniwo gte, a raport sięga do początku danych", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText("Od"), { target: { value: "" } });
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBeGreaterThan(1));
    expect(ostatnieZapytanie().has("gte")).toBe(false);
    expect(ostatnieZapytanie().has("lte")).toBe(true);
  });

  it("wyczyszczenie OBU dat zostawia zapytanie bez ani jednego ogniwa filtrującego", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText("Od"), { target: { value: "" } });
    await waitFor(() => expect(db().chainsFor(TABELA).length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText("Do"), { target: { value: "" } });
    await waitFor(() => expect(ostatnieZapytanie().has("lte")).toBe(false));
    expect(ostatnieZapytanie().has("gte")).toBe(false);
    expect(ostatnieZapytanie().argsOf("limit")).toEqual([500]);
  });
});

describe("nagłówek trasy", () => {
  it("trasa NIE deklaruje własnego head() - zakładka nie ma nazwy w karcie przeglądarki", async () => {
    // `noindex` panelu pochodzi z layoutu `/admin` i scala się w dół po całym
    // dopasowanym łańcuchu - tego tu NIE dublujemy.
    expect(await routeMeta(RedemptionsRoute)).toEqual([]);
  });
});
