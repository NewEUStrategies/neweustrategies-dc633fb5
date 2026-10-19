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
//   5. WYGENEROWANE KODY, KTORYCH ANALITYKA NIE ZNA. Hurt z kampanii to nowe
//      kupony najemcy, a ranking na /admin/coupons/analytics liczy po
//      wszystkich jego kuponach. Do 2026-10 generowanie uniewaznialo liste,
//      ale nie analityke (`["admin-analytics", <najemca>, "b2b-coupons", ...]`).
//
// GRANICE vs SASIEDZI. `CampaignCreateDialog` biegnie PRAWDZIWY (sasiad
// z `@/components/admin/coupons/*`). Atrapowane sa granice: klient Supabase
// (wraz z `rpc`), toasty, i18n, najemca (`useCurrentTenantId`), API obiektow
// URL przegladarki, Radiksowy Dialog, router (nawigacja do edytora kampanii
// newslettera), funkcja serwerowa kampanii i ustawienia newslettera (listy).
//
// ZMIANY SWIADOME (S1, P04). Punkt 4 wyzej opisywal DEFEKT jako wymaganie:
// „Wyslij" wstawialo kampanie newslettera Z PRZEGLADARKI i od razu ustawialo
// kampanii kuponowej `sent` - zanim cokolwiek wyszlo, a segment (wolny tekst)
// serwer ignorowal. Teraz „Przygotuj wysylke" wola serwer
// (`createCouponNewsletterCampaign`), ktory zaklada SZKIC i podpina go
// (idempotentnie), a `sent` ustawia wylacznie zakonczona wysylka. Ochrone
// przed podwojnym wyslaniem daje podpiecie (`newsletter_campaign_id`) i stan
// serwera - nie status ustawiany przez panel. Archiwizacja idzie przez RPC
// `admin_coupon_campaign_set_status` z tokenem `updated_at` (panel nie ma juz
// grantu UPDATE na `status`). Odczyty z `couponQueries.ts` - bez dawnego
// limitu 200 (lista kampanii najemcy jest czytana w calosci).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { analyticsCouponsKey } from "@/lib/analytics/queryKeys";
import type { CampaignRow } from "../CampaignsPage";

const h = vi.hoisted(() => ({
  from: null as unknown,
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  ensureI18n: vi.fn(),
  /** Najemca z `useCurrentTenantId`. */
  tenantId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" as string | null,
  /** `createCouponNewsletterCampaign` (funkcja serwerowa P04). */
  prepare: vi.fn(),
  navigations: [] as { to: string; params?: Record<string, string> }[],
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => (options: { to: string; params?: Record<string, string> }) => {
    h.navigations.push(options);
    return Promise.resolve();
  },
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
    className?: string;
  }) => (
    <a
      className={className}
      href={Object.entries(params ?? {}).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)}
    >
      {children}
    </a>
  ),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.prepare,
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({ createCouponNewsletterCampaign: {} }));
vi.mock("@/lib/i18n-admin-paywall-sync", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({
    data: { popup_mailing_lists: [{ id: "vip", label_pl: "Lista VIP", label_en: "VIP list" }] },
  }),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-admin-coupons", () => ({ ensureI18n: h.ensureI18n }));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => h.tenantId }));

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
    // Surowy token PostgREST (mikrosekundy) - idzie do RPC bez `new Date()`.
    updated_at: "2026-02-01T10:00:00.123456+00:00",
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
  h.prepare.mockReset();
  h.prepare.mockResolvedValue({ newsletterCampaignId: "nl-1" });
  h.navigations = [];
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.ensureI18n.mockClear();
  h.tenantId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
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

  it("odczyt sortuje od najnowszych i czyta CALA liste kampanii najemcy", async () => {
    // ZMIANA SWIADOMA (S1): odczyt idzie przez `couponCampaignsQueryOptions`
    // - jeden odczyt dla panelu i huba, bez dawnego `limit(200)`, ktory
    // chowal starsze kampanie bez slowa.
    await renderPage([]);
    const chain = db()
      .chainsFor("b2b_coupon_campaigns")
      .find((c) => c.has("order"));
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.has("limit")).toBe(false);
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

  it("segment newslettera pokazuje NAZWE listy mailingowej", async () => {
    await renderPage([kampania({ newsletter_segment: "vip" })]);
    expect(within(await wiersz("Q1 2026 VIP")).getByText("Lista VIP")).toBeInTheDocument();
  });

  it("kampania BEZ segmentu jest podpisana wprost: cala lista subskrybentow", async () => {
    // Pusta komorka nie mowila, ze kody pojda do WSZYSTKICH (R-25).
    await renderPage([kampania({ newsletter_segment: null })]);
    expect(
      within(await wiersz("Q1 2026 VIP")).getByText("adminCoupons.segmentField.wholeList"),
    ).toBeInTheDocument();
  });

  it("segment spoza list (stary wolny tekst) jest oznaczony jako NIEZNANY", async () => {
    // Wysylka odrzuci taki segment (fail-closed) - panel ma to pokazac wczesniej.
    await renderPage([kampania({ newsletter_segment: "stary-tag" })]);
    expect(
      within(await wiersz("Q1 2026 VIP")).getByText(
        "adminCoupons.segmentField.unknown(id=stary-tag)",
      ),
    ).toBeInTheDocument();
  });

  it("odpowiedz BEZ wierszy (`data: null`) to pusta lista, a nie wywrotka", async () => {
    // PostgREST potrafi oddac `null` zamiast `[]` (np. pusty wynik za widokiem).
    // `null.map` wywrocilby caly panel kuponow, a nie tylko te liste.
    db().setResponse("b2b_coupon_campaigns", ok(null));
    db().setResponse("membership_tiers", ok(null));
    renderWithQueryClient(<CampaignsPage />);
    expect(await screen.findByText("adminCoupons.campaignsYet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("rabat KWOTOWY bez kwoty i waluty pokazuje 0.00, a nie `NaN` ani `null`", async () => {
    // Wiersz niedokonczony recznie w bazie. „NaN null" w kolumnie rabatu
    // wyglada jak awaria panelu; „0.00" mowi wprost, ze rabatu nie ustawiono.
    await renderPage([
      kampania({
        discount_kind: "fixed",
        discount_percent: null,
        discount_cents: null,
        currency: null,
      }),
    ]);
    const komorka = within(await wiersz("Q1 2026 VIP")).getByText(/^0\.00/);
    expect(komorka.textContent?.trim()).toBe("0.00");
    expect(komorka.textContent).not.toMatch(/NaN|null|undefined/);
  });

  it("abonament BEZ liczby dni pokazuje sam poziom, bez sufiksu `d`", async () => {
    await renderPage([kampania({ grants_tier_key: "premium", grants_duration_days: null })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.getByText("premium")).toBeInTheDocument();
    expect(cells.queryByText(/\dd/)).toBeNull();
  });
});

describe("CampaignsPage - odmowy odczytu", () => {
  it("ODMOWA odczytu kampanii nie wisi na `wczytuje` i nie pokazuje zadnej akcji", async () => {
    // Kontrola dodatnia dla defektu przypietego na dole pliku: zapytanie
    // rzuca (`if (error) throw error`), react-query wychodzi ze stanu
    // ladowania, a panel nie renderuje tabeli ani przyciskow kampanii -
    // nie da sie wiec „wygenerowac" ani „wyslac" niczego na slepo.
    db().setResponse("b2b_coupon_campaigns", fail("permission denied", "42501"));
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CampaignsPage />);
    await waitFor(() => expect(db().chainsFor("b2b_coupon_campaigns")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText("adminCoupons.loading")).toBeNull());
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "adminCoupons.generate" })).toBeNull();
    expect(screen.queryByRole("button", { name: /prepareSend/ })).toBeNull();
    // Odczyt NIE jest ponawiany w petli - jedna proba, jeden lancuch.
    expect(db().chainsFor("b2b_coupon_campaigns")).toHaveLength(1);
  });

  it("ODMOWA odczytu poziomow nie blokuje formularza - zostaje sama opcja `brak`", async () => {
    // Poziomy sa tylko podpowiedzia w formularzu. Ich odmowa nie moze
    // zablokowac tworzenia kampanii bez abonamentu - a nie moze tez podsunac
    // poziomu, ktorego panel w rzeczywistosci nie odczytal.
    db().setResponse("b2b_coupon_campaigns", ok([]));
    db().setResponse("membership_tiers", fail("permission denied", "42501"));
    renderWithQueryClient(<CampaignsPage />);
    await screen.findByText("adminCoupons.campaignsYet");
    await waitFor(() => expect(db().chainsFor("membership_tiers")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons\.newCampaign/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const poziomy = dialog.getAllByRole("combobox")[1] as HTMLSelectElement;
    expect(Array.from(poziomy.options).map((o) => o.value)).toEqual(["none"]);
    expect(dialog.getByRole("button", { name: "adminCoupons.createCampaign" })).toBeEnabled();
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
    expect(cells.queryByRole("button", { name: /prepareSend/ })).toBeNull();
    expect(cells.getByRole("button", { name: "adminCoupons.archiveAction" })).toBeInTheDocument();
  });

  it("WYGENEROWANA ma eksport i „przygotuj wysylke”, a NIE MA juz `generuj`", async () => {
    // Ponowne generowanie zalozyloby DRUGI komplet kodow do tej samej kampanii.
    await renderPage([kampania({ status: "generated", generated_count: 100 })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.queryByRole("button", { name: "adminCoupons.generate" })).toBeNull();
    expect(cells.getByRole("button", { name: /CSV/ })).toBeInTheDocument();
    expect(
      cells.getByRole("button", { name: "adminCoupons.campaignsFlow.prepareSend" }),
    ).toBeInTheDocument();
  });

  it("PODPIETA (szkic newslettera istnieje) to OSOBNY stan z linkiem - nie „Wyslana”", async () => {
    // Podpiecie to nie wysylka: dopoki serwer nie ustawi `sent`, kampania jest
    // „Wygenerowana", a operator przechodzi do edytora po link - drugie
    // „przygotuj" juz sie nie pokazuje.
    await renderPage([
      kampania({ status: "generated", generated_count: 100, newsletter_campaign_id: "nl-7" }),
    ]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.getByText("adminCoupons.campaignStatus.generated")).toBeInTheDocument();
    expect(cells.getByText("adminCoupons.campaignsFlow.linked")).toBeInTheDocument();
    expect(cells.queryByText("adminCoupons.campaignStatus.sent")).toBeNull();
    expect(cells.queryByRole("button", { name: /prepareSend/ })).toBeNull();
    expect(
      cells.getByRole("link", { name: /adminCoupons\.campaignsFlow\.openNewsletter/ }),
    ).toHaveAttribute("href", "/admin/newsletter/campaigns/nl-7");
  });

  it("WYSLANA (stan z serwera) nie pozwala juz ani generowac, ani wysylac drugi raz", async () => {
    await renderPage([
      kampania({ status: "sent", generated_count: 100, newsletter_campaign_id: "nl-7" }),
    ]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.queryByRole("button", { name: "adminCoupons.generate" })).toBeNull();
    expect(cells.queryByRole("button", { name: /prepareSend/ })).toBeNull();
    expect(cells.getByText("adminCoupons.campaignStatus.sent")).toBeInTheDocument();
    expect(cells.queryByText("adminCoupons.campaignsFlow.linked")).toBeNull();
    expect(cells.getByRole("button", { name: "adminCoupons.archiveAction" })).toBeInTheDocument();
  });

  it("ZARCHIWIZOWANA ma WYLACZNIE przywrocenie - RPC dopuszcza powrot", async () => {
    // ZMIANA SWIADOMA: archiwizacja byla jednokierunkowa, bo panel pisal
    // status wprost. RPC `admin_coupon_campaign_set_status` dopuszcza
    // `archived -> generated|draft`, wiec panel to proponuje.
    await renderPage([kampania({ status: "archived" })]);
    const cells = within(await wiersz("Q1 2026 VIP"));
    expect(cells.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "adminCoupons.campaignsFlow.restoreAction",
    ]);
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

  it("wygenerowane kody uniewazniaja LISTE kuponow i ANALITYKE kuponow tego najemcy", async () => {
    // Analityka trzyma zakres dat z wlasnego ekranu - mutacja go nie zna,
    // wiec trafia prefiksem w kazdy zapamietany zakres, ale nie w cudzy.
    const zakres = analyticsCouponsKey(
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      "2026-07-01T00:00:00.000Z",
      null,
    );
    const cudzy = analyticsCouponsKey("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", null, null);
    const { queryClient } = await renderPage([kampania({ status: "draft" })]);
    const wiersze = await wiersz("Q1 2026 VIP");
    for (const key of [["admin", "b2b-coupons"], zakres, cudzy]) queryClient.setQueryData(key, []);
    fireEvent.click(within(wiersze).getByRole("button", { name: "adminCoupons.generate" }));

    await waitFor(() => expect(queryClient.getQueryState(zakres)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(["admin", "b2b-coupons"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(cudzy)?.isInvalidated).toBe(false);
  });

  it("ODMOWA RPC NIE uniewaznia analityki kuponow - zadnych nowych kodow", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("brak uprawnien do RPC") });
    const zakres = analyticsCouponsKey("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", null, null);
    const { queryClient } = await renderPage([kampania({ status: "draft" })]);
    const wiersze = await wiersz("Q1 2026 VIP");
    queryClient.setQueryData(zakres, []);
    fireEvent.click(within(wiersze).getByRole("button", { name: "adminCoupons.generate" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("brak uprawnien do RPC"));
    expect(queryClient.getQueryState(zakres)?.isInvalidated).toBe(false);
  });
});

describe("CampaignsPage - archiwizacja i przywrocenie (RPC z tokenem)", () => {
  /** Odpowiedz RPC zmiany statusu albo generowania - zaleznie od nazwy funkcji. */
  function rpcStatusu(wynik: { data?: unknown; error?: unknown } = {}) {
    h.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) =>
      fn === "admin_coupon_campaign_set_status"
        ? {
            data:
              "data" in wynik
                ? wynik.data
                : {
                    id: args.p_campaign_id,
                    status: args.p_status,
                    updated_at: "2026-02-02T10:00:00.000001+00:00",
                  },
            error: wynik.error ?? null,
          }
        : { data: 100, error: null },
    );
  }

  it("archiwizacja idzie RPC z ID TEJ kampanii i SUROWYM tokenem - nie UPDATE tabeli", async () => {
    rpcStatusu();
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.archiveAction",
      }),
    );
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("admin_coupon_campaign_set_status", {
        p_campaign_id: "cccccccc-1111-4111-8111-cccccccccccc",
        p_status: "archived",
        p_expected_updated_at: "2026-02-01T10:00:00.123456+00:00",
      }),
    );
    expect(
      db()
        .chainsFor("b2b_coupon_campaigns")
        .some((c) => c.has("update")),
    ).toBe(false);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignsFlow.archived"),
    );
  });

  it("przywrocenie wraca do `generated`, gdy kody istnieja, a do `draft`, gdy nie", async () => {
    rpcStatusu();
    await renderPage([
      kampania({ id: "k-gen", name: "Z kodami", status: "archived", generated_count: 10 }),
      kampania({ id: "k-draft", name: "Bez kodow", status: "archived", generated_count: 0 }),
    ]);
    fireEvent.click(
      within(await wiersz("Z kodami")).getByRole("button", {
        name: "adminCoupons.campaignsFlow.restoreAction",
      }),
    );
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith(
        "admin_coupon_campaign_set_status",
        expect.objectContaining({ p_campaign_id: "k-gen", p_status: "generated" }),
      ),
    );
    await waitFor(() =>
      expect(
        within(screen.getByText("Bez kodow").closest("tr") as HTMLElement).getByRole("button", {
          name: "adminCoupons.campaignsFlow.restoreAction",
        }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(
      within(await wiersz("Bez kodow")).getByRole("button", {
        name: "adminCoupons.campaignsFlow.restoreAction",
      }),
    );
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith(
        "admin_coupon_campaign_set_status",
        expect.objectContaining({ p_campaign_id: "k-draft", p_status: "draft" }),
      ),
    );
  });

  it("ODMOWA archiwizacji konczy sie komunikatem", async () => {
    rpcStatusu({ data: null, error: { message: "permission denied", code: "42501" } });
    await renderPage([kampania({ status: "sent" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.archiveAction",
      }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("permission denied"));
  });

  it("nieaktualny token (40001) to KONFLIKT z akcja „Wczytaj aktualne”, nie surowy blad", async () => {
    rpcStatusu({ data: null, error: { message: "stale_write", code: "40001" } });
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.archiveAction",
      }),
    );
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        "adminPaywall.sync.staleWrite",
        expect.objectContaining({ action: expect.anything() }),
      ),
    );
    expect(h.toastError).not.toHaveBeenCalledWith("stale_write");
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

  it("kampania BEZ kodow (`data: null`) daje plik z SAMYM naglowkiem", async () => {
    // Naglowek jest kontraktem z partnerem - plik bez niego nie zaimportuje
    // sie nawet jako pusty. Brak wierszy nie moze tez wywrocic eksportu.
    db().setResponse("b2b_coupons", ok(null));
    await renderPage([kampania({ status: "generated" })]);
    fireEvent.click(within(await wiersz("Q1 2026 VIP")).getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(pobraneBloby).toHaveLength(1));
    const linie = (await pobraneBloby[0].text()).split("\n").filter((l) => l !== "");
    expect(linie).toEqual(["code;name;active;valid_until;max_redemptions;redemptions_count"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.csvExported");
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

describe("CampaignsPage - przygotowanie wysylki (P04)", () => {
  async function przygotuj(c: CampaignRow = kampania({ status: "generated" })) {
    const utils = await renderPage([c]);
    fireEvent.click(
      within(await wiersz(c.name)).getByRole("button", {
        name: "adminCoupons.campaignsFlow.prepareSend",
      }),
    );
    return utils;
  }

  it("woła SERWER z identyfikatorem kampanii kuponowej - panel niczego nie wstawia sam", async () => {
    // Szablon z `{{coupon_code}}`, segment i podpiecie robi serwer
    // (`createCouponNewsletterCampaign`, testy w `newsletter-campaigns.coupons`).
    await przygotuj();
    await waitFor(() =>
      expect(h.prepare).toHaveBeenCalledWith({
        data: { couponCampaignId: "cccccccc-1111-4111-8111-cccccccccccc" },
      }),
    );
    expect(db().chainsFor("newsletter_campaigns")).toHaveLength(0);
  });

  it("NIE ustawia `sent` ani `newsletter_campaign_id` z przegladarki", async () => {
    // Dawny przeplyw oznaczal kampanie jako wyslana, zanim cokolwiek wyszlo.
    await przygotuj();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(
      db()
        .chainsFor("b2b_coupon_campaigns")
        .some((c) => c.has("update") || c.has("insert")),
    ).toBe(false);
    expect(h.rpc).not.toHaveBeenCalledWith("admin_coupon_campaign_set_status", expect.anything());
  });

  it("po przygotowaniu przenosi do EDYTORA kampanii newslettera - tam widac odbiorcow i kody", async () => {
    await przygotuj();
    await waitFor(() =>
      expect(h.navigations).toEqual([
        { to: "/admin/newsletter/campaigns/$id", params: { id: "nl-1" } },
      ]),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignsFlow.prepared");
  });

  it("po przygotowaniu odswieza kampanie kuponowe I kampanie newslettera", async () => {
    const { queryClient } = await renderPage([kampania({ status: "generated" })]);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.campaignsFlow.prepareSend",
      }),
    );
    await waitFor(() => expect(h.navigations).toHaveLength(1));
    const klucze = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(klucze).toContain(JSON.stringify(["admin", "b2b-coupon-campaigns"]));
    expect(klucze).toContain(JSON.stringify(["admin", "newsletter-campaigns"]));
  });

  it("ODMOWA serwera jest przetlumaczona i NIE przenosi donikad", async () => {
    h.prepare.mockRejectedValue(new Error("COUPON_SEGMENT_INVALID"));
    await przygotuj();
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminCoupons.campaignsFlow.segmentInvalid"),
    );
    expect(h.navigations).toHaveLength(0);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("nieznany blad serwera pokazuje jego tresc - nie milczy", async () => {
    h.prepare.mockRejectedValue(new Error("insert_failed"));
    await przygotuj();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("insert_failed"));
  });
});

describe("CampaignsPage - dialog tworzenia", () => {
  it("dialog jest zamkniety przy wejsciu", async () => {
    await renderPage([]);
    await screen.findByText("adminCoupons.campaignsYet");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("UTWORZENIE kampanii zamyka dialog i ODSWIEZA liste kampanii", async () => {
    // `onCreated` strony robi dwie rzeczy naraz: zamyka dialog i uniewaznia
    // klucz listy. Bez uniewaznienia nowa kampania nie pojawia sie w tabeli,
    // redaktor uznaje zapis za nieudany i zaklada ja drugi raz.
    let utworzona = false;
    db().setResponse("b2b_coupon_campaigns", (chain) => {
      if (chain.has("insert")) {
        utworzona = true;
        return ok(null);
      }
      return ok(utworzona ? [kampania({ name: "Kampania z dialogu" })] : []);
    });
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CampaignsPage />);
    await screen.findByText("adminCoupons.campaignsYet");
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons\.newCampaign/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const nazwa = dialog.getByText("adminCoupons.name").parentElement?.querySelector("input");
    if (!nazwa) throw new Error("brak pola nazwy w dialogu");
    fireEvent.change(nazwa, { target: { value: "Kampania z dialogu" } });
    // Segment jest obowiazkowy (S1) - lista „vip" z ustawien newslettera.
    fireEvent.change(dialog.getByLabelText("adminCoupons.segmentField.label"), {
      target: { value: "vip" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "adminCoupons.createCampaign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Kampania z dialogu")).toBeInTheDocument();
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignCreatedDraft");
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
  it("„wyslij” nie oznacza juz kampanii jako wyslanej ZANIM cokolwiek wyszlo", async () => {
    // CO BYLO ZLE. `sendNewsletter` wstawial kampanie newslettera z
    // przegladarki i tym samym kliknieciem ustawial kampanii kuponowej
    // `status: "sent"` - przed jakakolwiek wysylka. Segment (wolny tekst)
    // serwer ignorowal, wiec kody szly do CALEJ listy (P04, R-25).
    //
    // JAK NAPRAWIONE. „Przygotuj wysylke" wola serwer, ktory zaklada SZKIC
    // i podpina go; `sent` ustawia wylacznie zakonczona wysylka. Panel nie
    // pisze ani `status`, ani `newsletter_campaign_id` (nie ma juz nawet
    // grantu UPDATE na te kolumny).
    db().setResponse("b2b_coupon_campaigns", (chain) =>
      chain.has("update")
        ? fail("permission denied", "42501")
        : ok([kampania({ status: "generated" })]),
    );
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CampaignsPage />);
    await screen.findByText("Q1 2026 VIP");
    fireEvent.click(
      within(await wiersz("Q1 2026 VIP")).getByRole("button", {
        name: "adminCoupons.campaignsFlow.prepareSend",
      }),
    );
    await waitFor(() => expect(h.prepare).toHaveBeenCalledTimes(1));
    expect(
      db()
        .chainsFor("b2b_coupon_campaigns")
        .some((c) => c.has("update")),
    ).toBe(false);
    expect(db().chainsFor("newsletter_campaigns")).toHaveLength(0);
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

  it("ODMOWA odczytu kampanii nie mowi `brak kampanii, utworz pierwsza`", async () => {
    // CO BYLO ZLE. `queryFn` rzucal bledem PostgREST, ale render patrzyl tylko
    // na `isLoading` i `(campaignsQ.data ?? []).length` - stanu bledu nie
    // czytal nikt. Odmowa RLS, wygasla sesja i literowka w kolumnie konczyly
    // sie zdaniem „Brak kampanii. Utworz pierwsza." (`adminCoupons.campaignsYet`).
    //
    // JAKIE TO BYLO RYZYKO. Redaktor, ktory po prostu nie widzi listy, dostawal
    // ZACHETE do zalozenia kampanii od nowa - czyli drugiego kompletu do
    // 10 000 kodow obok istniejacego.
    //
    // JAK NAPRAWIONE. Galaz na `campaignsQ.isError` z tym samym komunikatem
    // bledu (`adminCoupons.loadError.*`), co zakladki Realizacje i Analityka.
    db().setResponse("b2b_coupon_campaigns", fail("permission denied", "42501"));
    db().setResponse("membership_tiers", ok([]));
    renderWithQueryClient(<CampaignsPage />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("adminCoupons.loadError.title")).toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.campaignsYet")).toBeNull();
    expect(screen.queryByText("adminCoupons.loading")).toBeNull();
  });

  it("subskrypcja na 0 dni nie wstawia literalu `0` do odznaki", async () => {
    // BYLO: `{c.grants_duration_days && ...}` - przy 0 React renderowal liczbe,
    // wiec odznaka czytala sie „premium0". Formularz kampanii potrafi zapisac
    // 0 (`min={1}` na polu nie jest egzekwowane).
    await renderPage([
      kampania({ status: "generated", grants_tier_key: "premium", grants_duration_days: 0 }),
    ]);
    const row = within(await wiersz("Q1 2026 VIP"));
    expect(row.getByText("premium")).toBeInTheDocument();
    expect(row.queryByText(/premium\s*0/)).toBeNull();
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

describe("CampaignsPage - `?id=` z adresu (SPEC §2.6)", () => {
  it("wskazana kampania jest WYROZNIONA i przewinieta do widoku, pozostale nie", async () => {
    const przewiniete: Element[] = [];
    const oryginal = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      przewiniete.push(this);
    };
    try {
      withData([
        kampania({ id: "k-1", name: "Pierwsza" }),
        kampania({ id: "k-2", name: "Wskazana" }),
      ]);
      renderWithQueryClient(<CampaignsPage highlightId="k-2" />);
      const wskazana = await wiersz("Wskazana");
      expect(wskazana).toHaveAttribute("aria-current", "true");
      expect((await wiersz("Pierwsza")).getAttribute("aria-current")).toBeNull();
      await waitFor(() => expect(przewiniete).toEqual([wskazana]));
      // Czytnik ekranu slyszy, ze to wiersz wskazany w adresie.
      expect(
        within(wskazana).getByText("adminCoupons.campaignsFlow.highlighted"),
      ).toBeInTheDocument();
    } finally {
      Element.prototype.scrollIntoView = oryginal;
    }
  });
});
