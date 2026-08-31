// Cala strona listy kuponow B2B.
//
// PO CO TEN PLIK ISTNIEJE. Kupon B2B to zobowiazanie finansowe: kazdy kod
// realnie obniza fakture albo przyznaje abonament. Panel jest jedynym miejscem,
// w ktorym widac, KTORE kody dzialaja. Ryzyka, ktore te testy pilnuja:
//   1. FILTR, KTORY KLAMIE. „Wygasle" liczy sie wzgledem `valid_until`
//      i BIEZACEJ chwili. Odwrocone porownanie pokazuje jako wygasle wszystkie
//      kody wazne - i ktos zaczyna wystawiac nowe zamiast istniejacych.
//   2. KAFELKI LICZONE Z PRZEFILTROWANEJ LISTY. Cztery liczby na gorze maja
//      opisywac CALY zbior kuponow, nie biezacy widok. Policzone ze
//      `filtered` pokazywalyby „aktywnych: 0" po wpisaniu czegokolwiek
//      w wyszukiwarke.
//   3. RABAT POKAZANY W ZLYCH JEDNOSTKACH. Kwoty siedza w bazie w GROSZACH.
//      Pominiety podzial przez 100 zamienia 10,00 PLN w 1000 PLN - i taki
//      kupon idzie do klienta.
//   4. PRZELACZNIK, KTORY NIE ZAPISUJE. „Aktywny" to jedyny hamulec dla kodu,
//      ktory wyciekl; musi trafic do bazy z odwrocona wartoscia i zawezony do
//      TEGO wiersza.
//
// GRANICE vs SASIEDZI. `CouponCreateDialog` i `Stat` biegna PRAWDZIWE - to
// sasiedzi z `@/components/admin/coupons/*`. Atrapowane sa wylacznie granice:
// klient Supabase, toasty, i18n, schowek przegladarki i Radiksowe prymitywy,
// ktore pod happy-dom nie reaguja na klikniecie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import type { ExtRow } from "../CouponsListPage";

const h = vi.hoisted(() => ({
  from: null as unknown,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  ensureI18n: vi.fn(),
  clipboard: vi.fn(async () => undefined),
  // happy-dom NIE implementuje `window.confirm` - bez wlasnej atrapy natywne
  // potwierdzenie byloby `undefined` i test wywracalby sie zanim dojdzie do
  // asercji. Atrapa jest tez dowodem samym w sobie: gdyby panel przeszedl na
  // `confirmDialog`, ta funkcja przestalaby byc wolana.
  natywneConfirm: vi.fn((_message?: string) => true),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: h.ensureI18n }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/checkbox", async () => {
  const React = await import("react");
  return {
    Checkbox: ({
      checked,
      onCheckedChange,
    }: {
      checked?: boolean;
      onCheckedChange?: (next: boolean) => void;
    }) =>
      React.createElement("input", {
        type: "checkbox",
        checked: !!checked,
        onChange: (event: { target: { checked: boolean } }) =>
          onCheckedChange?.(event.target.checked),
      }),
  };
});

// Radiksowy Dialog montuje tresc w portalu i domyka fokus - pod happy-dom nie
// otwiera sie od klikniecia w trigger. Atrapa zachowuje to, co jest tresc
// zachowania: tresc pojawia sie DOPIERO gdy `open` jest prawdziwe, a trigger
// wola `onOpenChange(true)`.
vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const stan: { open: boolean; onOpenChange?: (open: boolean) => void } = { open: false };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.onOpenChange = onOpenChange;
      return React.createElement("div", { "data-open": String(open) }, children as never);
    },
    DialogTrigger: ({ children }: { asChild?: boolean; children?: ReactNode }) =>
      React.createElement("div", { onClick: () => stan.onOpenChange?.(true) }, children as never),
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? React.createElement("div", { role: "dialog" }, children as never) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogFooter: ({ children }: { children?: ReactNode }) =>
      React.createElement("div", null, children as never),
    DialogTitle: ({ children }: { children?: ReactNode }) =>
      React.createElement("h2", null, children as never),
    DialogDescription: ({ children }: { children?: ReactNode }) =>
      React.createElement("p", null, children as never),
  };
});

import { CouponsListPage } from "../CouponsListPage";

const db = () => h.from as SupabaseFromStub;

const PRZESZLOSC = "2020-01-15T00:00:00.000Z";
const PRZYSZLOSC = "2099-12-31T00:00:00.000Z";

function kupon(over: Partial<ExtRow> = {}): ExtRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "NES-B2B-10",
    name: "Partner strategiczny",
    description: null,
    discount_kind: "percent",
    discount_percent: 10,
    discount_cents: null,
    currency: null,
    active: true,
    max_redemptions: 100,
    redemptions_count: 7,
    valid_from: null,
    valid_until: null,
    plan_ids: [],
    organization_id: null,
    metadata: {},
    created_at: "2026-02-01T10:00:00.000Z",
    updated_at: "2026-02-01T10:00:00.000Z",
    campaign_id: null,
    grants_tier_key: null,
    grants_duration_days: null,
    assigned_company_id: null,
    assigned_lead_id: null,
    ...over,
  };
}

function withData(rows: ExtRow[]): void {
  db().setResponse("b2b_coupons", (chain) => (chain.has("select") ? ok(rows) : ok(null)));
  db().setResponse(
    "access_plans",
    ok([{ id: "plan-1", name_pl: "Plan", name_en: "Plan", active: true }]),
  );
  db().setResponse(
    "membership_tiers",
    ok([{ key: "premium", name_pl: "Premium", name_en: "Premium", active: true }]),
  );
}

async function renderPage(rows: ExtRow[]) {
  withData(rows);
  const utils = renderWithQueryClient(<CouponsListPage />);
  await waitFor(() => expect(db().chainsFor("b2b_coupons").length).toBeGreaterThan(0));
  return utils;
}

/** Wiersz tabeli po kodzie kuponu; czeka, az lista sie wyrenderuje. */
async function wiersz(kod: string): Promise<HTMLElement> {
  return (await screen.findByText(kod)).closest("tr") as HTMLElement;
}

/** Kafelek liczby - etykieta i wartosc leza w tej samej karcie. */
function kafelek(etykieta: string): string {
  const label = screen.getAllByText(etykieta).find((el) => el.className.includes("uppercase"));
  return label?.parentElement?.querySelector("div:last-child")?.textContent ?? "";
}

beforeEach(() => {
  db().reset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.ensureI18n.mockClear();
  h.clipboard.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: h.clipboard },
  });
  h.natywneConfirm.mockReset();
  h.natywneConfirm.mockReturnValue(true);
  Object.defineProperty(window, "confirm", {
    configurable: true,
    writable: true,
    value: h.natywneConfirm,
  });
});

describe("CouponsListPage - odczyt i stany", () => {
  it("REJESTRUJE slownik kuponow przy renderze", () => {
    withData([]);
    renderWithQueryClient(<CouponsListPage />);
    expect(h.ensureI18n).toHaveBeenCalled();
  });

  it("ZANIM dane dojada, lista mowi `wczytuje`", () => {
    withData([]);
    renderWithQueryClient(<CouponsListPage />);
    expect(screen.getByText("adminCoupons.loading")).toBeInTheDocument();
  });

  it("PUSTA lista konczy sie komunikatem, a nie sama naglowkiem tabeli", async () => {
    await renderPage([]);
    expect(await screen.findByText("adminCoupons.results")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("odczyt kuponow jest posortowany od najnowszych i ma twardy limit", async () => {
    // Limit chroni panel przed sciagnieciem dziesiatek tysiecy kodow kampanii
    // masowej do przegladarki - bez niego strona po prostu zamiera.
    await renderPage([]);
    const chain = db().lastChain("b2b_coupons");
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([1000]);
  });

  it("BLAD odczytu nie udaje pustej listy", async () => {
    // `queryFn` rzuca przy `error`, wiec react-query wchodzi w stan bledu
    // zamiast zapisac `[]` - dzieki temu panel nie mowi „nie masz kuponow"
    // osobie, ktorej po prostu odmowiono odczytu.
    db().setResponse("b2b_coupons", fail("permission denied", "42501"));
    db().setResponse("access_plans", ok([]));
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CouponsListPage />);
    expect(await screen.findByText("adminCoupons.results")).toBeInTheDocument();
  });
});

describe("CouponsListPage - wiersz kuponu", () => {
  it("rabat PROCENTOWY pokazuje sie z procentem", async () => {
    await renderPage([kupon({ discount_kind: "percent", discount_percent: 25 })]);
    expect(within(await wiersz("NES-B2B-10")).getByText("25%")).toBeInTheDocument();
  });

  it("rabat KWOTOWY przelicza sie z GROSZY na jednostki waluty", async () => {
    // Najkosztowniejsza pomylka na tej liscie: 1000 groszy to 10,00 PLN,
    // a nie 1000 PLN.
    await renderPage([
      kupon({
        discount_kind: "fixed",
        discount_percent: null,
        discount_cents: 1000,
        currency: "PLN",
      }),
    ]);
    expect(within(await wiersz("NES-B2B-10")).getByText("10.00 PLN")).toBeInTheDocument();
  });

  it("licznik wykorzystan pokazuje limit, gdy limit istnieje", async () => {
    await renderPage([kupon({ redemptions_count: 7, max_redemptions: 100 })]);
    expect(within(await wiersz("NES-B2B-10")).getByText("7 / 100")).toBeInTheDocument();
  });

  it("kupon BEZ limitu nie pokazuje mianownika", async () => {
    // „7 / null" albo „7 / 0" czytaloby sie jak wyczerpany limit.
    await renderPage([kupon({ redemptions_count: 7, max_redemptions: null })]);
    const cells = within(await wiersz("NES-B2B-10"));
    expect(cells.getByText("7")).toBeInTheDocument();
    expect(cells.queryByText(/\//)).toBeNull();
  });

  it("kupon przyznajacy ABONAMENT pokazuje klucz poziomu i liczbe dni", async () => {
    // To jedyne miejsce, w ktorym widac, ze kod nie tylko obniza cene, ale
    // NADAJE dostep - czyli koszt, ktory nie pojawi sie na zadnej fakturze.
    await renderPage([kupon({ grants_tier_key: "premium", grants_duration_days: 90 })]);
    const cells = within(await wiersz("NES-B2B-10"));
    expect(cells.getByText("premium")).toBeInTheDocument();
    expect(cells.getByText("90d")).toBeInTheDocument();
  });

  it("status AKTYWNY i NIEAKTYWNY maja rozne odznaki", async () => {
    await renderPage([kupon({ active: true }), kupon({ id: "2", code: "NES-OFF", active: false })]);
    expect(
      within(await wiersz("NES-B2B-10")).getByText("adminCoupons.active2"),
    ).toBeInTheDocument();
    expect(within(await wiersz("NES-OFF")).getByText("adminCoupons.inactive2")).toBeInTheDocument();
  });

  it("okno waznosci pokazuje OBIE granice, sformatowane wg jezyka interfejsu", async () => {
    // Data waznosci decyduje o tym, czy kod zadziala przy kasie. Formatowanie
    // surowym ISO („2020-01-15T00:00:00.000Z") byloby dla redakcji nieczytelne,
    // a pokazanie tylko jednej granicy ukrywa polowe informacji.
    await renderPage([kupon({ valid_from: PRZESZLOSC, valid_until: PRZYSZLOSC })]);
    const tekst = (await wiersz("NES-B2B-10")).textContent ?? "";
    expect(tekst).toContain(new Date(PRZESZLOSC).toLocaleDateString("pl"));
    expect(tekst).toContain(new Date(PRZYSZLOSC).toLocaleDateString("pl"));
  });

  it("KOPIOWANIE kodu wklada do schowka DOKLADNIE kod, i melduje sukces", async () => {
    // Kod idzie stad prosto do wiadomosci dla klienta. Skopiowanie nazwy
    // zamiast kodu (albo kodu z bialymi znakami) konczy sie odmowa przy kasie.
    await renderPage([kupon()]);
    fireEvent.click(within(await wiersz("NES-B2B-10")).getByRole("button", { name: "Kopiuj" }));
    expect(h.clipboard).toHaveBeenCalledWith("NES-B2B-10");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.copied");
  });

  it("kupon nalezacy do KAMPANII jest oznaczony ikona", async () => {
    // Rozroznienie ma znaczenie operacyjne: kod z kampanii masowej kasuje sie
    // przez kampanie, a nie pojedynczo.
    await renderPage([kupon({ campaign_id: "kampania-1" })]);
    expect(within(await wiersz("NES-B2B-10")).getByLabelText("kampania")).toBeInTheDocument();
  });
});

describe("CouponsListPage - filtry", () => {
  const ZBIOR = [
    kupon({ id: "a", code: "NES-AKTYWNY", name: "Partner", active: true }),
    kupon({ id: "b", code: "NES-WYLACZONY", name: "Archiwum", active: false }),
    kupon({ id: "c", code: "NES-WYGASLY", name: "Stary", active: true, valid_until: PRZESZLOSC }),
  ];

  it("wyszukiwarka filtruje po KODZIE, bez rozroznienia wielkosci liter", async () => {
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "wygasly" },
    });
    expect(screen.getByText("NES-WYGASLY")).toBeInTheDocument();
    expect(screen.queryByText("NES-AKTYWNY")).toBeNull();
  });

  it("wyszukiwarka filtruje TAKZE po nazwie wewnetrznej", async () => {
    // Nazwa jest opisem dla redakcji („Partner strategiczny"), a nie dla
    // klienta - i to po niej szuka sie kodu, ktorego nikt nie pamieta.
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "archiwum" },
    });
    expect(screen.getByText("NES-WYLACZONY")).toBeInTheDocument();
    expect(screen.queryByText("NES-AKTYWNY")).toBeNull();
  });

  it("wyszukiwanie bez trafien konczy sie komunikatem, nie pusta tabela", async () => {
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "nie-ma-takiego" },
    });
    expect(screen.getByText("adminCoupons.results")).toBeInTheDocument();
  });

  it("filtr AKTYWNE zostawia wylacznie kody wlaczone", async () => {
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });
    expect(screen.getByText("NES-AKTYWNY")).toBeInTheDocument();
    expect(screen.queryByText("NES-WYLACZONY")).toBeNull();
  });

  it("filtr NIEAKTYWNE zostawia wylacznie kody wylaczone", async () => {
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "inactive" } });
    expect(screen.getByText("NES-WYLACZONY")).toBeInTheDocument();
    expect(screen.queryByText("NES-AKTYWNY")).toBeNull();
  });

  it("filtr WYGASLE liczy sie wzgledem BIEZACEJ chwili, nie flagi `active`", async () => {
    // Kod moze byc `active: true` i jednoczesnie po dacie waznosci - kasa go
    // odrzuci, a panel bez tego filtra pokaze go jako sprawny.
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "expired" } });
    expect(screen.getByText("NES-WYGASLY")).toBeInTheDocument();
    expect(screen.queryByText("NES-AKTYWNY")).toBeNull();
    expect(screen.queryByText("NES-WYLACZONY")).toBeNull();
  });

  it("kod BEZ daty koncowej nigdy nie wpada do `wygasle`", async () => {
    await renderPage([kupon({ code: "NES-BEZTERMINOWY", valid_until: null })]);
    await screen.findByText("NES-BEZTERMINOWY");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "expired" } });
    expect(screen.getByText("adminCoupons.results")).toBeInTheDocument();
  });

  it("filtry SKLADAJA sie ze soba", async () => {
    await renderPage(ZBIOR);
    await screen.findByText("NES-AKTYWNY");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "wygasly" },
    });
    expect(screen.getByText("NES-WYGASLY")).toBeInTheDocument();
    expect(screen.queryByText("NES-AKTYWNY")).toBeNull();
  });
});

describe("CouponsListPage - kafelki liczb", () => {
  const ZBIOR = [
    kupon({ id: "a", code: "A", active: true, redemptions_count: 3 }),
    kupon({ id: "b", code: "B", active: false, redemptions_count: 4 }),
    kupon({ id: "c", code: "C", active: true, redemptions_count: 0, valid_until: PRZESZLOSC }),
  ];

  it("licza CALY zbior kuponow: razem, aktywne, wykorzystania, wygasle", async () => {
    await renderPage(ZBIOR);
    await screen.findByText("A");
    expect(kafelek("adminCoupons.total")).toBe("3");
    expect(kafelek("adminCoupons.active")).toBe("2");
    expect(kafelek("adminCoupons.totalRedemptions")).toBe("7");
    expect(kafelek("adminCoupons.expired")).toBe("1");
  });

  it("kafelki NIE reaguja na filtr widoku", async () => {
    // Sedno tego bloku: liczby na gorze opisuja stan systemu, a nie to,
    // co akurat widac po wpisaniu frazy. Policzone z `filtered` spadalyby do
    // zera przy kazdym wyszukiwaniu i nie dalyby sie z niczym porownac.
    await renderPage(ZBIOR);
    await screen.findByText("A");
    fireEvent.change(screen.getByPlaceholderText("adminCoupons.searchCodeName"), {
      target: { value: "A" },
    });
    expect(kafelek("adminCoupons.total")).toBe("3");
    expect(kafelek("adminCoupons.active")).toBe("2");
  });

  it("pusta lista daje same zera, a nie puste kafelki", async () => {
    await renderPage([]);
    await screen.findByText("adminCoupons.results");
    expect(kafelek("adminCoupons.total")).toBe("0");
    expect(kafelek("adminCoupons.totalRedemptions")).toBe("0");
  });
});

describe("CouponsListPage - zmiany stanu kuponu", () => {
  it("PRZELACZNIK odwraca `active` i zapisuje ZAWEZONY do tego wiersza", async () => {
    await renderPage([kupon({ active: true })]);
    await screen.findByText("NES-B2B-10");
    fireEvent.click(screen.getByRole("switch", { name: "toggle-active" }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("b2b_coupons")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("b2b_coupons")
      .find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toEqual({ active: false });
    expect(update?.argsOf("eq")).toEqual(["id", "11111111-1111-4111-8111-111111111111"]);
  });

  it("ODMOWA zapisu przelacznika konczy sie komunikatem", async () => {
    db().setResponse("b2b_coupons", (chain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok([kupon()]),
    );
    db().setResponse("access_plans", ok([]));
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CouponsListPage />);
    await screen.findByText("NES-B2B-10");
    fireEvent.click(screen.getByRole("switch", { name: "toggle-active" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
  });

  it("POTWIERDZONE usuniecie kasuje TEN kupon", async () => {
    h.natywneConfirm.mockReturnValue(true);
    await renderPage([kupon()]);
    await screen.findByText("NES-B2B-10");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("b2b_coupons")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(
      db()
        .chainsFor("b2b_coupons")
        .find((c) => c.has("delete"))
        ?.argsOf("eq"),
    ).toEqual(["id", "11111111-1111-4111-8111-111111111111"]);
    // Pytanie zawiera KOD kuponu - bez niego potwierdzenie nie mowi, co ginie.
    expect(String(h.natywneConfirm.mock.calls[0]![0])).toContain("NES-B2B-10");
  });

  it("ANULOWANE potwierdzenie NIE kasuje niczego", async () => {
    h.natywneConfirm.mockReturnValue(false);
    await renderPage([kupon()]);
    await screen.findByText("NES-B2B-10");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(h.natywneConfirm).toHaveBeenCalled());
    expect(
      db()
        .chainsFor("b2b_coupons")
        .some((c) => c.has("delete")),
    ).toBe(false);
  });
});

describe("CouponsListPage - dialog tworzenia", () => {
  it("dialog jest ZAMKNIETY przy wejsciu na strone", async () => {
    await renderPage([]);
    await screen.findByText("adminCoupons.results");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("przycisk `nowy kupon` otwiera PRAWDZIWY formularz tworzenia", async () => {
    // `CouponCreateDialog` biegnie prawdziwy - to sasiad, nie granica. Dzieki
    // temu widac takze, ze plany i poziomy pobrane przez te strone naprawde do
    // niego dojezdzaja.
    await renderPage([]);
    await screen.findByText("adminCoupons.results");
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons\.newCoupon/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("adminCoupons.newB2bCoupon")).toBeInTheDocument();
  });

  it("plany i poziomy z zapytan strony dojezdzaja do formularza", async () => {
    await renderPage([]);
    await screen.findByText("adminCoupons.results");
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons\.newCoupon/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Plan")).toBeInTheDocument();
    expect(dialog.getByRole("option", { name: "Premium" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY ZAREJESTROWANE, NIENAPRAWIONE (zakres pracy: wylacznie testy).
// ---------------------------------------------------------------------------
describe("CouponsListPage - defekty (zarejestrowane)", () => {
  it.fails("usuwanie kuponu idzie przez dialog aplikacji, nie przez `window.confirm`", async () => {
    // CO JEST ZLE. Wiersz kuponu kasuje sie natywnym `confirm(...)`. Reszta
    // panelu administracyjnego - w tym oba panele reklam obok - uzywa
    // `confirmDialog` z `@/lib/appDialogs`.
    //
    // DLACZEGO TO RYZYKO. Natywne okno (a) blokuje CALA karte przegladarki,
    // (b) nie da sie go ostylowac ani przetlumaczyc poza tekstem tresci,
    // (c) czesc przegladarek pozwala uzytkownikowi ZABLOKOWAC kolejne takie
    // okna („nie pozwalaj tej stronie tworzyc wiecej okien dialogowych") -
    // a wtedy `confirm` zwraca `false` bez pytania i przycisk kasowania
    // przestaje dzialac bez zadnego komunikatu, (d) nie jest oznaczone jako
    // destrukcyjne, wiec kasowanie kuponu wyglada jak zwykle pytanie „OK?".
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka zmienia kod produkcyjny (przejscie na
    // `confirmDialog`, funkcja asynchroniczna, klucze slownika na tytul i
    // etykiete potwierdzenia), a zakres tej pracy to wylacznie testy.
    await renderPage([kupon()]);
    await screen.findByText("NES-B2B-10");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("b2b_coupons")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    expect(h.natywneConfirm).not.toHaveBeenCalled();
  });

  it.fails("etykiety przyciskow wiersza sa PRZETLUMACZONE, nie surowe", async () => {
    // CO JEST ZLE. Trzy sterowniki w wierszu maja etykiety wpisane wprost:
    // `aria-label="Kopiuj"` (polski literal), `aria-label="toggle-active"`
    // i `aria-label="delete"` (angielskie nazwy techniczne).
    //
    // DLACZEGO TO RYZYKO. To sa JEDYNE nazwy tych kontrolek - kazda z nich to
    // sama ikona bez tekstu. Uzytkownik czytnika ekranu slyszy w wierszu
    // „toggle-active, przelacznik" i „delete, przycisk": nazwy z kodu, nie
    // z interfejsu, w innym jezyku niz reszta panelu. „delete" kasuje kupon
    // nieodwracalnie.
    //
    // DLACZEGO NIE NAPRAWIAM. Poprawka wymaga kluczy slownika w obu jezykach
    // i zmiany kodu produkcyjnego; zakres tej pracy to wylacznie testy.
    await renderPage([kupon()]);
    await screen.findByText("NES-B2B-10");
    expect(screen.queryByRole("button", { name: "delete" })).toBeNull();
  });

  it.fails("puste pola tabeli uzywaja DYWIZU ASCII, nie pauzy", async () => {
    // CO JEST ZLE. Kolumny „waznosc" i „plan" wstawiaja „—" (U+2014) dla pustej
    // wartosci; konwencja repozytorium to dywiz ASCII. Ta sama tabela uzywa
    // dodatkowo „∞" dla braku daty koncowej.
    //
    // DLACZEGO TO RYZYKO. Poza rozjazdem z reszta panelu, to sa ZNAKI, a nie
    // klucze slownika - nie da sie ich zamienic na czytelne „bezterminowo"
    // w zadnym jezyku, a czytnik ekranu odczytuje pauze i symbol
    // nieskonczonosci roznie zaleznie od syntezatora.
    //
    // DLACZEGO NIE NAPRAWIAM. Zakres tej pracy to wylacznie testy.
    await renderPage([kupon({ valid_from: null, valid_until: null, grants_tier_key: null })]);
    const cells = within(await wiersz("NES-B2B-10"));
    expect(cells.queryByText("—")).toBeNull();
  });
});
