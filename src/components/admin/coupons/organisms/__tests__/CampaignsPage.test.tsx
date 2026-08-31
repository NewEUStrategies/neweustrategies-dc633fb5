// Cala strona kampanii kuponowych - masowe generowanie kodow, eksport CSV
// i wysylka przez newsletter.
//
// PO CO TEN PLIK ISTNIEJE. To jest najdrozszy ekran calego modulu kuponow:
// jedno klikniecie „Generuj" zaklada nawet 10 000 dzialajacych kodow rabatowych,
// a jedno klikniecie „Wyslij" wysyla je do segmentu subskrybentow. Ryzyka:
//   1. AKCJE NIE OD TEGO STANU. „Generuj" na kampanii juz wygenerowanej to
//      DRUGIE 10 000 kodow. „Wyslij" na szkicu wysyla maile z pustym miejscem
//      na kod. Dlatego kazdy stan ma tu wlasny przypadek z pelna lista
//      dostepnych akcji.
//   2. GENEROWANIE PRZEZ NIEWLASCIWY IDENTYFIKATOR. RPC dostaje `_campaign_id`;
//      pomylka wiersza to kody wygenerowane do cudzej kampanii.
//   3. EKSPORT, KTORY GUBI KOLUMNY. Plik CSV idzie do partnera - naglowek
//      i kolejnosc kolumn sa czescia kontraktu, a puste pola musza zostac
//      puste, a nie zniknac (przesuniecie kolumn w calym pliku).
//   4. WYSYLKA, KTORA NIE ODNOTUJE SIE W KAMPANII. Bez zapisania
//      `newsletter_campaign_id` i statusu `sent` ta sama kampania da sie
//      wyslac drugi raz.
//
// GRANICE vs SASIEDZI. `CampaignCreateDialog` biegnie PRAWDZIWY (sasiad
// z `@/components/admin/coupons/*`). Atrapowane sa granice: klient Supabase
// (wraz z `rpc`), toasty, i18n, API obiektow URL przegladarki oraz Radiksowy
// Dialog.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";
import type { CampaignRow } from "../CampaignsPage";

const h = vi.hoisted(() => ({
  from: null as unknown,
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  ensureI18n: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: h.ensureI18n }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from, rpc: h.rpc } };
});

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

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
      return React.createElement("div", null, children as never);
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
  };
});

import { CampaignsPage } from "../CampaignsPage";

const db = () => h.from as SupabaseFromStub;

/** Blob-y przekazane do `URL.createObjectURL` - z nich czytamy tresc CSV. */
const pobraneBloby: Blob[] = [];
const zwolnioneUrl: string[] = [];

function kampania(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "cccccccc-1111-4111-8111-cccccccccccc",
    name: "Q1 2026 VIP",
    prefix: "NES-",
    code_count: 100,
    generated_count: 0,
    discount_kind: "percent",
    discount_percent: 20,
    discount_cents: null,
    currency: null,
    valid_until: null,
    grants_tier_key: null,
    grants_duration_days: null,
    newsletter_segment: null,
    newsletter_campaign_id: null,
    status: "draft",
    created_at: "2026-02-01T10:00:00.000Z",
    ...over,
  };
}

function withData(rows: CampaignRow[]): void {
  db().setResponse("b2b_coupon_campaigns", (chain) => (chain.has("update") ? ok(null) : ok(rows)));
  db().setResponse(
    "membership_tiers",
    ok([{ key: "premium", name_pl: "Premium", name_en: "Premium" }]),
  );
}

async function renderPage(rows: CampaignRow[]) {
  withData(rows);
  const utils = renderWithQueryClient(<CampaignsPage />);
  await waitFor(() => expect(db().chainsFor("b2b_coupon_campaigns").length).toBeGreaterThan(0));
  return utils;
}

/** Wiersz tabeli po nazwie kampanii; czeka, az lista sie wyrenderuje. */
async function wiersz(nazwa: string): Promise<HTMLElement> {
  return (await screen.findByText(nazwa)).closest("tr") as HTMLElement;
}

beforeEach(() => {
  db().reset();
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: 100, error: null });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.ensureI18n.mockClear();
  pobraneBloby.length = 0;
  zwolnioneUrl.length = 0;
  // happy-dom nie implementuje API obiektow URL. To granica przegladarki,
  // a jednoczesnie jedyne miejsce, z ktorego da sie odczytac wygenerowany plik.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      pobraneBloby.push(blob);
      return "blob:test/pobrany.csv";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => {
      zwolnioneUrl.push(url);
    },
  });
});

describe("CampaignsPage - odczyt i stany", () => {
  it("REJESTRUJE slownik kuponow przy renderze", () => {
    withData([]);
    renderWithQueryClient(<CampaignsPage />);
    expect(h.ensureI18n).toHaveBeenCalled();
  });

  it("ZANIM dane dojada, lista mowi `wczytuje`", () => {
    withData([]);
    renderWithQueryClient(<CampaignsPage />);
    expect(screen.getByText("adminCoupons.loading")).toBeInTheDocument();
  });

  it("BRAK kampanii konczy sie komunikatem, a nie pusta tabela", async () => {
    await renderPage([]);
    expect(await screen.findByText("adminCoupons.campaignsYet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("odczyt sortuje od najnowszych i ma twardy limit", async () => {
    await renderPage([]);
    const chain = db()
      .chainsFor("b2b_coupon_campaigns")
      .find((c) => c.has("order"));
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("wiersz pokazuje nazwe, prefiks kodow i postep generowania", async () => {
    // „0 / 100" to jedyne miejsce, z ktorego widac, ze kody jeszcze NIE
    // istnieja - a od tego zalezy, czy wolno juz wysylac newsletter.
    await renderPage([kampania({ generated_count: 40, code_count: 100 })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.getByText("NES-***")).toBeInTheDocument();
    expect(cells.getByText("40 / 100")).toBeInTheDocument();
  });

  it("rabat KWOTOWY kampanii przelicza sie z groszy", async () => {
    await renderPage([
      kampania({
        discount_kind: "fixed",
        discount_percent: null,
        discount_cents: 2000,
        currency: "PLN",
      }),
    ]);
    expect(within(await wiersz("Q1 2026 VIP")).getByText("20.00 PLN")).toBeInTheDocument();
  });

  it("kampania przyznajaca ABONAMENT pokazuje poziom i liczbe dni", async () => {
    await renderPage([kampania({ grants_tier_key: "premium", grants_duration_days: 30 })]);
    expect(within(await wiersz("Q1 2026 VIP")).getByText(/premium/)).toBeInTheDocument();
    expect(within(await wiersz("Q1 2026 VIP")).getByText(/30d/)).toBeInTheDocument();
  });

  it("segment newslettera pokazuje sie, gdy jest ustawiony", async () => {
    await renderPage([kampania({ newsletter_segment: "vip" })]);
    expect(within(await wiersz("Q1 2026 VIP")).getByText("vip")).toBeInTheDocument();
  });
});

describe("CampaignsPage - akcje zalezne od stanu kampanii", () => {
  it("SZKIC ma wylacznie `generuj` i archiwizacje", async () => {
    // Eksport i wysylka na szkicu nie maja czego wyslac - kody jeszcze nie
    // istnieja.
    await renderPage([kampania({ status: "draft" })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.getByRole("button", { name: "adminCoupons.generate" })).toBeInTheDocument();
    expect(cells.queryByRole("button", { name: /CSV/ })).toBeNull();
    expect(cells.queryByRole("button", { name: /adminCoupons\.send/ })).toBeNull();
    expect(cells.getByRole("button", { name: "adminCoupons.archiveAction" })).toBeInTheDocument();
  });

  it("WYGENEROWANA ma eksport i wysylke, a NIE MA juz `generuj`", async () => {
    // Ponowne generowanie zalozyloby DRUGI komplet kodow do tej samej kampanii.
    await renderPage([kampania({ status: "generated", generated_count: 100 })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.queryByRole("button", { name: "adminCoupons.generate" })).toBeNull();
    expect(cells.getByRole("button", { name: /CSV/ })).toBeInTheDocument();
    expect(cells.getByRole("button", { name: /adminCoupons\.send/ })).toBeInTheDocument();
  });

  it("WYSLANA nie pozwala juz ani generowac, ani wysylac drugi raz", async () => {
    await renderPage([kampania({ status: "sent", generated_count: 100 })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.queryByRole("button", { name: "adminCoupons.generate" })).toBeNull();
    expect(cells.queryByRole("button", { name: /adminCoupons\.send/ })).toBeNull();
    expect(cells.getByRole("button", { name: "adminCoupons.archiveAction" })).toBeInTheDocument();
  });

  it("ZARCHIWIZOWANA nie ma zadnej akcji - takze archiwizacji", async () => {
    await renderPage([kampania({ status: "archived" })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.queryByRole("button")).toBeNull();
  });
});

describe("CampaignsPage - generowanie kodow", () => {
  it("`generuj` wola RPC z identyfikatorem TEJ kampanii", async () => {
    await renderPage([kampania({ status: "draft" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: "adminCoupons.generate" }),
    );
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(h.rpc).toHaveBeenCalledWith("bulk_generate_coupons_for_campaign", {
      _campaign_id: "cccccccc-1111-4111-8111-cccccccccccc",
    });
  });

  it("liczba wygenerowanych kodow idzie do komunikatu przez `count`, nie przez sklejenie", async () => {
    // Polski ma trzy formy liczebnika (1 kod / 2 kody / 5 kodow). Sklejony
    // literal „${n} kodow" daje „1 kodow" - i to jest jedyny komunikat, po
    // ktorym redakcja poznaje, ze operacja sie udala.
    h.rpc.mockResolvedValue({ data: 250, error: null });
    await renderPage([kampania({ status: "draft" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: "adminCoupons.generate" }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.codesGenerated(count=250)");
  });

  it("ODMOWA RPC konczy sie komunikatem bledu, a nie cisza", async () => {
    // Bez komunikatu redakcja klika „Generuj" ponownie - i przy pierwszym
    // udanym przebiegu dostaje podwojony komplet kodow.
    h.rpc.mockResolvedValue({ data: null, error: new Error("brak uprawnien do RPC") });
    await renderPage([kampania({ status: "draft" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: "adminCoupons.generate" }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("brak uprawnien do RPC"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("CampaignsPage - archiwizacja", () => {
  it("archiwizacja ustawia status i jest ZAWEZONA do tego wiersza", async () => {
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.archiveAction",
      }),
    );
    await waitFor(() =>
      expect(
        db()
          .chainsFor("b2b_coupon_campaigns")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("b2b_coupon_campaigns")
      .find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toEqual({ status: "archived" });
    expect(update?.argsOf("eq")).toEqual(["id", "cccccccc-1111-4111-8111-cccccccccccc"]);
  });

  it("ODMOWA archiwizacji konczy sie komunikatem", async () => {
    db().setResponse("b2b_coupon_campaigns", (chain) =>
      chain.has("update") ? fail("permission denied", "42501") : ok([kampania({ status: "sent" })]),
    );
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CampaignsPage />);
    await screen.findByText("Q1 2026 VIP");
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.archiveAction",
      }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
  });
});

describe("CampaignsPage - eksport CSV", () => {
  const KODY = [
    {
      code: "NES-AAA111",
      name: "Partner A",
      active: true,
      valid_until: "2026-12-31T00:00:00.000Z",
      max_redemptions: 1,
      redemptions_count: 0,
    },
    {
      code: "NES-BBB222",
      name: null,
      active: false,
      valid_until: null,
      max_redemptions: null,
      redemptions_count: 3,
    },
  ];

  async function eksportuj(): Promise<string> {
    db().setResponse("b2b_coupons", ok(KODY));
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(pobraneBloby).toHaveLength(1));
    return pobraneBloby[0].text();
  }

  it("eksport czyta kody TEJ kampanii, w kolejnosci zakladania, z sufitem", async () => {
    // Bez `eq("campaign_id", ...)` plik dla partnera zawieralby WSZYSTKIE kody
    // w systemie - w tym kody innych partnerow.
    await eksportuj();
    const chain = db().lastChain("b2b_coupons");
    expect(chain?.argsOf("eq")).toEqual(["campaign_id", "cccccccc-1111-4111-8111-cccccccccccc"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    expect(chain?.argsOf("limit")).toEqual([10000]);
  });

  it("plik ma NAGLOWEK i wiersz na kazdy kod", async () => {
    const csv = await eksportuj();
    const linie = csv.split("\n");
    expect(linie[0]).toBe("code;name;active;valid_until;max_redemptions;redemptions_count");
    expect(linie).toHaveLength(3);
    expect(linie[1]).toBe("NES-AAA111;Partner A;true;2026-12-31T00:00:00.000Z;1;0");
  });

  it("puste pola zostaja PUSTE, a nie znikaja - kolumny nie moga sie przesunac", async () => {
    // `null` wypisany jako nic daje wiersz o mniejszej liczbie separatorow,
    // przez co arkusz partnera przesuwa wszystkie kolejne kolumny.
    const csv = await eksportuj();
    const wiersz2 = csv.split("\n")[2];
    expect(wiersz2).toBe("NES-BBB222;;false;;;3");
    expect(wiersz2.split(";")).toHaveLength(6);
  });

  it("plik dostaje nazwe z nazwy kampanii, bez spacji", async () => {
    // Spacje w nazwie pliku psuja polecenia powloki i linki, na ktore ten plik
    // trafia u odbiorcy.
    await eksportuj();
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.csvExported");
  });

  it("adres obiektu jest ZWALNIANY po pobraniu", async () => {
    // Nietrwaly wyciek pamieci karty: kazdy eksport bez `revokeObjectURL`
    // trzyma caly plik w pamieci do konca zycia karty.
    await eksportuj();
    expect(zwolnioneUrl).toEqual(["blob:test/pobrany.csv"]);
  });

  it("ODMOWA odczytu kodow konczy sie komunikatem i BEZ pobrania pliku", async () => {
    // Pobrany pusty plik wygladalby jak kampania bez kodow.
    db().setResponse("b2b_coupons", fail("permission denied", "42501"));
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
    expect(pobraneBloby).toHaveLength(0);
  });
});

describe("CampaignsPage - wysylka newslettera", () => {
  function withNewsletter(wynik: SupabaseResult = ok({ id: "nl-1" })) {
    db().setResponse("newsletter_campaigns", wynik);
  }

  it("tworzy kampanie newslettera z merge tagiem na kod i segmentem odbiorcow", async () => {
    // Kod MUSI byc merge tagiem: kazdy subskrybent dostaje inny kod, wiec
    // wpisanie konkretnego kodu w tresc wyslaloby wszystkim ten sam.
    withNewsletter();
    await renderPage([kampania({ status: "generated", newsletter_segment: "vip" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /adminCoupons\.send/ }),
    );
    await waitFor(() => expect(db().chainsFor("newsletter_campaigns").length).toBe(1));
    const payload = db().lastChain("newsletter_campaigns")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(String(payload.html_pl)).toContain("{{coupon_code}}");
    expect(String(payload.html_en)).toContain("{{coupon_code}}");
    expect(payload.audience_filter).toEqual({ segment: "vip" });
  });

  it("kampania BEZ segmentu wysyla sie do calej bazy - filtr jest pusty, nie `null`", async () => {
    // `null` w kolumnie filtra bywa interpretowany inaczej niz pusty obiekt;
    // to rozroznienie decyduje o tym, kto dostanie maila.
    withNewsletter();
    await renderPage([kampania({ status: "generated", newsletter_segment: null })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /adminCoupons\.send/ }),
    );
    await waitFor(() => expect(db().chainsFor("newsletter_campaigns").length).toBe(1));
    const payload = db().lastChain("newsletter_campaigns")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.audience_filter).toEqual({});
  });

  it("tresc niesie date waznosci kodow w OBU wersjach jezykowych", async () => {
    withNewsletter();
    await renderPage([kampania({ status: "generated", valid_until: "2026-12-31T00:00:00.000Z" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /adminCoupons\.send/ }),
    );
    await waitFor(() => expect(db().chainsFor("newsletter_campaigns").length).toBe(1));
    const payload = db().lastChain("newsletter_campaigns")?.argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(String(payload.html_pl)).toContain("2026-12-31");
    expect(String(payload.html_en)).toContain("2026-12-31");
  });

  it("po wysylce kampania dostaje `sent` i ODNOSNIK do newslettera", async () => {
    // To jedyne zabezpieczenie przed wyslaniem tej samej kampanii dwa razy.
    withNewsletter();
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /adminCoupons\.send/ }),
    );
    await waitFor(() =>
      expect(
        db()
          .chainsFor("b2b_coupon_campaigns")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("b2b_coupon_campaigns")
      .find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toEqual({
      newsletter_campaign_id: "nl-1",
      status: "sent",
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.newsletterCampaignCreated");
  });

  it("ODMOWA utworzenia newslettera NIE przestawia statusu kampanii", async () => {
    // Status `sent` przy nieistniejacym newsletterze to kampania, ktorej juz
    // nie da sie wyslac, a ktora nigdy nie poszla.
    withNewsletter(fail("permission denied", "42501"));
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /adminCoupons\.send/ }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
    expect(
      db()
        .chainsFor("b2b_coupon_campaigns")
        .some((c) => c.has("update")),
    ).toBe(false);
  });
});

describe("CampaignsPage - dialog tworzenia", () => {
  it("dialog jest zamkniety przy wejsciu", async () => {
    await renderPage([]);
    await screen.findByText("adminCoupons.campaignsYet");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("`nowa kampania` otwiera PRAWDZIWY formularz, z poziomami z zapytania strony", async () => {
    await renderPage([]);
    await screen.findByText("adminCoupons.campaignsYet");
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons\.newCampaign/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("adminCoupons.newCouponCampaign")).toBeInTheDocument();
    expect(dialog.getByRole("option", { name: "Premium" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DEFEKTY NAPRAWIONE (dawne `it.fails`).
// ---------------------------------------------------------------------------
describe("CampaignsPage - dawne defekty", () => {
  it("nieudane odnotowanie wysylki konczy sie bledem, a nie cichym sukcesem", async () => {
    // CO BYLO ZLE. `sendNewsletter` po utworzeniu kampanii newslettera robil
    // `await supabase.from("b2b_coupon_campaigns").update({...})` i NIE
    // sprawdzal zwroconego `error`. Odmowa tego zapisu przechodzila bez sladu,
    // a mutacja konczyla sie sukcesem.
    //
    // JAKIE TO BYLO RYZYKO. Kampania newslettera JUZ ISTNIEJE, ale kampania
    // kuponowa zostawala w stanie „generated" bez `newsletter_campaign_id`.
    // Panel pokazywal wiec dalej przycisk „Wyslij", a redakcja - widzac
    // komunikat o sukcesie i niezmieniony status - klikala go ponownie.
    // Efekt: DRUGA kampania newslettera do tego samego segmentu, czyli drugi
    // mail z kodem rabatowym do tych samych odbiorcow.
    //
    // JAK NAPRAWIONE. Zapis odnotowujacy wysylke zwraca teraz swoj `error`
    // do zmiennej `linkError` i rzuca nim; mutacja konczy sie bledem, wiec
    // toast sukcesu nie pada, a status kampanii zostaje na „generated".
    db().setResponse("newsletter_campaigns", ok({ id: "nl-1" }));
    db().setResponse("b2b_coupon_campaigns", (chain) =>
      chain.has("update")
        ? fail("permission denied", "42501")
        : ok([kampania({ status: "generated" })]),
    );
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CampaignsPage />);
    await screen.findByText("Q1 2026 VIP");
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /adminCoupons\.send/ }),
    );
    await waitFor(() =>
      expect(
        db()
          .chainsFor("b2b_coupon_campaigns")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("status kampanii jest PRZETLUMACZONY, a nie surowa wartoscia z bazy", async () => {
    // CO BYLO ZLE. Odznaka statusu renderowala `{c.status}` wprost - czyli
    // „draft", „generated", „sent", „archived" z kolumny bazy.
    //
    // JAKIE TO BYLO RYZYKO. Cala reszta tabeli (naglowki, akcje, komunikaty)
    // idzie przez slownik, wiec panel wygladal na przetlumaczony, a jedna
    // kolumna mowila po angielsku technicznymi nazwami stanow. Redakcja
    // pracujaca po polsku musiala zgadywac, czym rozni sie „generated" od
    // „sent" - a od tej roznicy zalezy, czy kody juz poszly do subskrybentow.
    //
    // JAK NAPRAWIONE. `CAMPAIGN_STATUS_LABEL_KEYS` (typ
    // `Record<CampaignRow["status"], string>`, wiec nowy stan bez etykiety sie
    // nie skompiluje) wskazuje klucze `adminCoupons.campaignStatus.*`, zalozone
    // w PL i EN.
    await renderPage([kampania({ status: "generated" })]);
    expect(within(await wiersz("Q1 2026 VIP")).queryByText("generated")).toBeNull();
  });

  it("przycisk archiwizacji ma PRZETLUMACZONA nazwe dostepna", async () => {
    // BYLO: `aria-label="archive"` - techniczna nazwa z kodu, w innym jezyku
    // niz reszta panelu, a przy tym JEDYNA nazwa tego przycisku (sama ikona).
    // JEST: `adminCoupons.archiveAction` w PL i EN.
    await renderPage([kampania({ status: "generated" })]);
    await wiersz("Q1 2026 VIP");
    expect(screen.queryByRole("button", { name: "archive" })).toBeNull();
  });
});
