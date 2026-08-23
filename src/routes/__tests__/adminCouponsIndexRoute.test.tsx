// Trasa `/admin/coupons/` - SKLEJENIE listy kuponów B2B z bazą.
// To ekran, na którym operator decyduje, czy rabat dalej działa.
//
// CO TEN PLIK DOWODZI.
//   1. KONTRAKT ODCZYTU: dwadzieścia trzy kolumny, `order(created_at desc)`
//      i `limit(1000)`. Ciche usunięcie kolumny przy refaktorze nie psuje ani
//      tsc, ani renderu - psuje wyłącznie to, co operator widzi.
//   2. AWARIA ODCZYTU JEST NIEROZRÓŻNIALNA OD PUSTEJ LISTY. Odmowa RLS pokazuje
//      „Brak wyników.” i zera w kaflach, więc operator raportuje „nie mamy
//      kuponów” zamiast „panel nie ma dostępu”. Zgłoszone parą `it.fails` + `it`.
//   3. PRZEŁĄCZENIE AKTYWNOŚCI WYSYŁA ZAPRZECZENIE STANU Z WIERSZA i nie ma
//      stanu optymistycznego: po odmowie wiersz zostaje jak był, leci sam
//      komunikat. Cena: dwa szybkie kliknięcia to DWA IDENTYCZNE żądania.
//   4. USUNIĘCIE PYTA PRZEZ `confirm()` Z KODEM W TREŚCI, a odmowa
//      potwierdzenia nie wysyła niczego. To ostatnia bariera przed skasowaniem
//      działającego rabatu.
//   5. TOAST „SKOPIOWANO” LECI NAWET WTEDY, GDY SCHOWEK ODMÓWI - `void`
//      porzuca obietnicę. Operator myśli, że ma kod w schowku, a wkleja co
//      innego. Zgłoszone parą.
//   6. UNIEWAŻNIENIE PO ZAPISIE ODŚWIEŻA TAKŻE PLANY I WARSTWY, bo klucz listy
//      jest ich PREFIKSEM - jedno przełączenie to trzy odczyty.
//   7. AWARIA ODCZYTU PLANÓW UDAJE „BRAK PLANÓW” w dialogu tworzenia.
//   8. TRASA NIE DEKLARUJE WŁASNEGO `head()` - wykluczenie z indeksowania
//      dziedziczy z layoutu `/admin`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł filtra i kafli -
// `lib/billing/__tests__/couponAdminList.test.ts`. (2) Walidacji i ładunku
// tworzenia - `couponAdminForm.test.ts` oraz `CouponCreateDialog.test.tsx`.
// (3) Renderu komórek - `couponAtoms.test.tsx` i `CouponsTable.test.tsx`.
// (4) Autoryzacji dostępu do `/admin` - `adminRouteAuthority.gate.test.ts`.
//
// Radix (Dialog, Select, Switch, Checkbox) jest podmieniony na natywne
// odpowiedniki, bo pod happy-dom nie ma pełnego API wskaźnika. `confirm`
// i `navigator.clipboard` nie istnieją w tym środowisku - są podstawione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  language: "pl",
  i18nRegistrations: 0,
  pendingTables: new Set<string>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
// Słownik rejestruje się side-effectem importu i ciągnie CAŁY i18next
// aplikacji - atrapa liczy wywołania, bo brak rejestracji = panel bez napisów.
// PUŁAPKA NAZWY: moduł eksportuje `ensureI18n`, trasa importuje go pod aliasem.
vi.mock("@/lib/i18n-admin-coupons", () => ({
  ensureI18n: () => {
    h.i18nRegistrations += 1;
  },
}));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  h.db = db;
  /**
   * Łańcuch, który nigdy się nie rozwiązuje - jedyny deterministyczny sposób
   * na utrzymanie stanu „wczytywanie” (atrapa odpowiada natychmiast).
   */
  const neverSettling = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
      builder[method] = () => builder;
    }
    builder.then = () => new Promise(() => undefined);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.pendingTables.has(table) ? neverSettling() : db.from(table)),
    },
  };
});

vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  const Ctx = react.createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
    open: false,
    setOpen: () => undefined,
  });
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (v: boolean) => void;
      children?: ReactNode;
    }) => (
      <Ctx.Provider value={{ open, setOpen: (v) => onOpenChange?.(v) }}>
        <div data-testid="dialog" data-open={String(open)}>
          {children}
        </div>
      </Ctx.Provider>
    ),
    DialogTrigger: ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      if (asChild === true && react.isValidElement<{ onClick?: () => void }>(children)) {
        return react.cloneElement(children, { onClick: () => ctx.setOpen(true) });
      }
      return (
        <button type="button" onClick={() => ctx.setOpen(true)}>
          {children}
        </button>
      );
    },
    DialogContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return ctx.open ? <div data-testid="dialog-content">{children}</div> : null;
    },
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={() => onCheckedChange(!checked)}
    />
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock("@/components/admin/coupons/DatePickerField", () => ({
  DatePickerField: ({ label }: { label?: string }) => <input aria-label={label} readOnly />,
}));

import { renderRoute, routeHead, routeMeta } from "@/test/routeHarness";
import { Route as CouponsIndexRoute } from "@/routes/admin.coupons.index";
import { fail, ok } from "@/test/supabase";
import type { CouponAdminRow } from "@/components/admin/coupons/organisms/CouponsTable";

const PATH = "/admin/coupons/";
const KUPONY = "b2b_coupons";
const PLANY = "access_plans";
const WARSTWY = "membership_tiers";

/** STRAŻNIK zamiast rzutowania stanu z `vi.hoisted`. */
function db(): SupabaseFromStub {
  const value = h.db;
  if (!value) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return value as SupabaseFromStub;
}

function kupon(overrides: Partial<CouponAdminRow> = {}): CouponAdminRow {
  return {
    id: "c-1",
    code: "NES-B2B-10",
    name: null,
    description: null,
    discount_kind: "percent",
    discount_percent: 10,
    discount_cents: null,
    currency: null,
    active: true,
    max_redemptions: null,
    redemptions_count: 0,
    valid_from: null,
    valid_until: null,
    plan_ids: [],
    organization_id: null,
    metadata: {},
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    campaign_id: null,
    grants_tier_key: null,
    grants_duration_days: null,
    assigned_company_id: null,
    assigned_lead_id: null,
    ...overrides,
  };
}

/** Plan odpowiedzi dla tabeli kuponów: odczyt osobno, zapis osobno. */
interface Plan {
  lista: SupabaseResult;
  zapis: SupabaseResult;
  plany: SupabaseResult;
  warstwy: SupabaseResult;
}

let plan: Plan;

function kuponyResponder(chain: RecordedChain): SupabaseResult {
  if (chain.has("update") || chain.has("delete") || chain.has("insert")) return plan.zapis;
  return plan.lista;
}

async function zamontuj(): Promise<void> {
  db().setResponse(KUPONY, kuponyResponder);
  db().setResponse(PLANY, () => plan.plany);
  db().setResponse(WARSTWY, () => plan.warstwy);
  await renderRoute({
    route: CouponsIndexRoute,
    path: PATH,
    initialEntry: "/admin/coupons/",
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    }),
  });
  await waitFor(() => expect(db().chainsFor(KUPONY).length).toBeGreaterThan(0));
}

/** Łańcuchy ZAPISUJĄCE na tabeli kuponów (odczyt ich nie zawiera). */
function zapisy(metoda: "update" | "delete" | "insert"): RecordedChain[] {
  return db()
    .chainsFor(KUPONY)
    .filter((c) => c.has(metoda));
}

beforeEach(() => {
  db().reset();
  h.pendingTables = new Set();
  h.language = "pl";
  h.i18nRegistrations = 0;
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  plan = {
    lista: ok([kupon()]),
    zapis: ok(null),
    plany: ok([{ id: "p-1", name_pl: "Roczny", name_en: "Annual", active: true }]),
    warstwy: ok([{ key: "gold", name_pl: "Złoty", name_en: "Gold", active: true }]),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kontrakt odczytu listy", () => {
  it("lista pyta o dwadzieścia trzy kolumny, najnowsze najpierw, najwyżej tysiąc wierszy", async () => {
    await zamontuj();
    const chain = db().chainsFor(KUPONY)[0];
    const kolumny = String(chain.argsOf("select")?.[0])
      .split(",")
      .map((c) => c.trim());
    expect(kolumny).toHaveLength(23);
    expect(kolumny).toContain("discount_percent");
    expect(kolumny).toContain("grants_duration_days");
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([1000]);
  });

  it("plany i warstwy to OSOBNE zapytania - warstwy tylko aktywne, w kolejności rangi", async () => {
    await zamontuj();
    const warstwy = db().lastChain(WARSTWY);
    expect(warstwy?.argsOf("eq")).toEqual(["active", true]);
    expect(warstwy?.argsOf("order")).toEqual(["rank", { ascending: true }]);
    expect(db().lastChain(PLANY)?.argsOf("limit")).toEqual([200]);
  });

  it("słownik panelu jest rejestrowany przy montowaniu trasy, nie w wejściu aplikacji", async () => {
    await zamontuj();
    expect(h.i18nRegistrations).toBeGreaterThan(0);
  });

  it("w trakcie odczytu widać wskaźnik, a nie komunikat o braku wyników", async () => {
    h.pendingTables = new Set([KUPONY]);
    db().setResponse(PLANY, () => plan.plany);
    db().setResponse(WARSTWY, () => plan.warstwy);
    await renderRoute({
      route: CouponsIndexRoute,
      path: PATH,
      initialEntry: "/admin/coupons/",
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    });
    expect(await screen.findByText("adminCoupons.loading")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.results")).toBeNull();
  });
});

describe("DEFEKT: awaria odczytu wygląda jak pusta lista", () => {
  it.fails("odmowa dostępu do tabeli kuponów powinna być widoczna jako AWARIA", async () => {
    plan.lista = fail("permission denied for table b2b_coupons");
    await zamontuj();
    await screen.findByText("adminCoupons.results");
    expect(screen.queryByText("adminCoupons.results")).toBeNull();
  });

  it("STAN FAKTYCZNY: operator widzi „Brak wyników.” i zera w kaflach", async () => {
    // Para do usunięcia RAZEM po naprawie (dodanie gałęzi `isError`).
    plan.lista = fail("permission denied for table b2b_coupons");
    await zamontuj();
    expect(await screen.findByText("adminCoupons.results")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("filtrowanie listy", () => {
  it("wpisana fraza zawęża tabelę do pasujących kuponów", async () => {
    plan.lista = ok([kupon({ id: "c-1", code: "NES-VIP" }), kupon({ id: "c-2", code: "NES-STD" })]);
    await zamontuj();
    await screen.findByText("NES-VIP");
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "vip" },
    });
    expect(screen.getByText("NES-VIP")).toBeInTheDocument();
    expect(screen.queryByText("NES-STD")).toBeNull();
  });

  it("filtrowanie NIE odpytuje bazy ponownie - odbywa się na wczytanym zbiorze", async () => {
    plan.lista = ok([kupon({ id: "c-1", code: "NES-VIP" }), kupon({ id: "c-2", code: "NES-STD" })]);
    await zamontuj();
    const przed = db().chainsFor(KUPONY).length;
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "vip" },
    });
    expect(db().chainsFor(KUPONY).length).toBe(przed);
  });

  it("kafle liczą PEŁNY zbiór, także po zawężeniu listy", async () => {
    plan.lista = ok([kupon({ id: "c-1", code: "NES-VIP" }), kupon({ id: "c-2", code: "NES-STD" })]);
    await zamontuj();
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "vip" },
    });
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });
});

describe("przełączenie aktywności", () => {
  it("wysyła ZAPRZECZENIE stanu z wiersza, zawężone po identyfikatorze", async () => {
    plan.lista = ok([kupon({ id: "c-7", active: true })]);
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("toggle-active"));
    await waitFor(() => expect(zapisy("update")).toHaveLength(1));
    expect(zapisy("update")[0].argsOf("update")).toEqual([{ active: false }]);
    expect(zapisy("update")[0].argsOf("eq")).toEqual(["id", "c-7"]);
  });

  it("odmowa zapisu pokazuje SUROWY komunikat bazy i NIE przestawia przełącznika", async () => {
    plan.lista = ok([kupon({ id: "c-7", active: true })]);
    plan.zapis = fail("permission denied for table b2b_coupons");
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("toggle-active"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table b2b_coupons"),
    );
    expect((screen.getByLabelText("toggle-active") as HTMLInputElement).checked).toBe(true);
  });

  it.fails("dwa szybkie kliknięcia NIE powinny wysyłać dwóch identycznych żądań", async () => {
    plan.lista = ok([kupon({ id: "c-7", active: true })]);
    await zamontuj();
    const przelacznik = await screen.findByLabelText("toggle-active");
    fireEvent.click(przelacznik);
    fireEvent.click(przelacznik);
    await waitFor(() => expect(zapisy("update").length).toBeGreaterThan(0));
    expect(zapisy("update")).toHaveLength(1);
  });

  it("STAN FAKTYCZNY: drugie kliknięcie powtarza pierwsze żądanie, a nie je cofa", async () => {
    // Para do usunięcia RAZEM po naprawie (`disabled={toggle.isPending}`).
    plan.lista = ok([kupon({ id: "c-7", active: true })]);
    await zamontuj();
    const przelacznik = await screen.findByLabelText("toggle-active");
    fireEvent.click(przelacznik);
    fireEvent.click(przelacznik);
    await waitFor(() => expect(zapisy("update")).toHaveLength(2));
    expect(zapisy("update")[1].argsOf("update")).toEqual([{ active: false }]);
  });

  it("po udanym zapisie odświeżane są TAKŻE plany i warstwy - klucz listy jest ich prefiksem", async () => {
    plan.lista = ok([kupon({ id: "c-7", active: true })]);
    await zamontuj();
    const planyPrzed = db().chainsFor(PLANY).length;
    fireEvent.click(await screen.findByLabelText("toggle-active"));
    await waitFor(() => expect(db().chainsFor(PLANY).length).toBeGreaterThan(planyPrzed));
    expect(db().chainsFor(WARSTWY).length).toBeGreaterThan(1);
  });
});

describe("usunięcie kuponu", () => {
  it("odmowa potwierdzenia NIE wysyła żadnego zapytania kasującego", async () => {
    vi.stubGlobal("confirm", () => false);
    plan.lista = ok([kupon({ id: "c-7" })]);
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("delete"));
    expect(zapisy("delete")).toHaveLength(0);
  });

  it("pytanie o potwierdzenie wymienia KOD kuponu, żeby nie skasować nie tego", async () => {
    const pytania: string[] = [];
    vi.stubGlobal("confirm", (tresc: string) => {
      pytania.push(tresc);
      return true;
    });
    plan.lista = ok([kupon({ id: "c-7", code: "NES-VIP" })]);
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("delete"));
    expect(pytania[0]).toBe("adminCoupons.deleteCoupon NES-VIP");
  });

  it("potwierdzenie kasuje DOKŁADNIE ten wiersz", async () => {
    vi.stubGlobal("confirm", () => true);
    plan.lista = ok([kupon({ id: "c-7" })]);
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("delete"));
    await waitFor(() => expect(zapisy("delete")).toHaveLength(1));
    expect(zapisy("delete")[0].argsOf("eq")).toEqual(["id", "c-7"]);
  });
});

describe("DEFEKT: kopiowanie kodu melduje sukces bez schowka", () => {
  function schowekOdmawia(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  it.fails("odmowa schowka NIE powinna kończyć się komunikatem o skopiowaniu", async () => {
    schowekOdmawia();
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("Kopiuj"));
    await waitFor(() => expect(h.toastSuccess).not.toHaveBeenCalled());
  });

  it("STAN FAKTYCZNY: komunikat „Skopiowano” leci synchronicznie, obok porzuconej obietnicy", async () => {
    // Para do usunięcia RAZEM po naprawie (`await` + gałąź `catch`).
    const writeText = schowekOdmawia();
    await zamontuj();
    fireEvent.click(await screen.findByLabelText("Kopiuj"));
    expect(writeText).toHaveBeenCalledWith("NES-B2B-10");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.copied");
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("DEFEKT: awaria odczytu planów udaje brak planów", () => {
  it.fails("odmowa odczytu planów powinna różnić się od pustej listy planów", async () => {
    plan.plany = fail("permission denied for table access_plans");
    await zamontuj();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCoupon/ }));
    expect(screen.queryByText("adminCoupons.plansAvailable")).toBeNull();
  });

  it("STAN FAKTYCZNY: dialog pokazuje „Brak planów”, choć plany istnieją i są niedostępne", async () => {
    plan.plany = fail("permission denied for table access_plans");
    await zamontuj();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCoupon/ }));
    expect(await screen.findByText("adminCoupons.plansAvailable")).toBeInTheDocument();
  });
});

describe("utworzenie kuponu z poziomu listy", () => {
  it("sukces ZAMYKA dialog i odświeża listę - operator nie zapisuje kuponu dwa razy", async () => {
    await zamontuj();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCoupon/ }));
    fireEvent.change(screen.getByPlaceholderText("NES-B2B-10"), {
      target: { value: "NES-NOWY" },
    });
    const odczytyPrzed = db()
      .chainsFor(KUPONY)
      .filter((c) => !c.has("insert")).length;
    fireEvent.click(screen.getByRole("button", { name: "adminCoupons.createCoupon" }));
    await waitFor(() => expect(screen.queryByTestId("dialog-content")).toBeNull());
    await waitFor(() =>
      expect(
        db()
          .chainsFor(KUPONY)
          .filter((c) => !c.has("insert")).length,
      ).toBeGreaterThan(odczytyPrzed),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.couponCreated");
  });
});

describe("język interfejsu dochodzi do kolumny ważności", () => {
  it("ten sam kupon pokazuje RÓŻNE daty w interfejsie polskim i angielskim", async () => {
    plan.lista = ok([kupon({ valid_from: "2026-01-05T10:00:00.000Z" })]);
    h.language = "pl";
    await zamontuj();
    const poPolsku = (await screen.findAllByRole("row"))[1].textContent ?? "";
    expect(poPolsku).toContain("2026");

    cleanup();
    db().reset();
    h.language = "en";
    await zamontuj();
    const poAngielsku = (await screen.findAllByRole("row"))[1].textContent ?? "";
    expect(poAngielsku).not.toBe(poPolsku);
  });
});

describe("awaria odczytu warstw członkostwa", () => {
  it("odmowa odczytu warstw zostawia w dialogu SAMĄ opcję „Brak” - bez śladu awarii", async () => {
    // Ten sam wzorzec, co przy planach: nieudany odczyt jest nieodróżnialny od
    // pustego słownika warstw, więc operator nie wie, czemu nie może nadać
    // subskrypcji. Zapytanie mimo to poleciało - to jest tu przedmiotem dowodu.
    plan.warstwy = fail("permission denied for table membership_tiers");
    await zamontuj();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCoupon/ }));
    const wybor = (await screen.findAllByRole("combobox"))[2];
    const opcje = Array.from(wybor.querySelectorAll("option")).map((o) => o.value);
    expect(opcje).toEqual(["none"]);
    expect(db().chainsFor(WARSTWY).length).toBeGreaterThan(0);
  });
});

describe("nagłówek strony", () => {
  it("trasa NIE deklaruje własnego head() - noindex dziedziczy z layoutu /admin", () => {
    expect(() => routeHead(CouponsIndexRoute)).toThrow(/head\(\)/);
  });

  it("skutek uboczny: lista kuponów nie ma WŁASNEGO tytułu w karcie przeglądarki", async () => {
    await expect(routeMeta(CouponsIndexRoute)).resolves.toEqual([]);
  });
});
