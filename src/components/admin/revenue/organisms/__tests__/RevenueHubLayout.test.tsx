// `RevenueHubLayout` - powłoka huba po wycinku S6: pasek sekcji z grupami,
// filtry okna, bramki ról, świeżość z cache i SSR bez treści zależnej od sesji.
//
// MONTAŻ JAK W TEŚCIE I0 (`adminRevenueHubRoutes.test.tsx`): PRAWDZIWY układ,
// kokpit i trasa `$tab` pod korzeniem z własną stroną 404. Zakładki są
// zaślepkami I0 - przedmiotem dowodu jest powłoka, nie ich treść. Atrapowana
// jest wyłącznie sesja (`useAuth`); słownik jest prawdziwy, więc asercje
// mierzą napisy, które zobaczy admin.
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, type AnyRoute } from "@tanstack/react-router";

import type { Role } from "@/hooks/useAuth";

const h = vi.hoisted(() => ({
  auth: { isAdmin: true, roles: ["admin"] as Role[], tenantId: undefined as string | undefined },
  listJourneys: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
// Licznik „Ścieżki = aktywne” (Integrator S8) czyta listę ścieżek - atrapa
// jedynej server fn, którą układ woła (granica sieci).
vi.mock("@/lib/journeys/journeys.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/journeys/journeys.functions")>()),
  listJourneys: (input: unknown) => h.listJourneys(input),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute, type RouteHarnessContext } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { revenueKeys } from "@/lib/revenue/keys";
import { journeyKeys } from "@/lib/journeys/keys";
import { parseJourneyList } from "@/lib/journeys/parse";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { resolveRevenueRange } from "@/lib/revenue/window";
import { RevenueHubLayout } from "@/components/admin/revenue/organisms/RevenueHubLayout";
import { Route as LayoutRoute } from "@/routes/admin.revenue";
import { Route as IndexRoute } from "@/routes/admin.revenue.index";
import { Route as TabRoute } from "@/routes/admin.revenue.$tab";

const HUB = "/admin/revenue";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_TZ = process.env.TZ;

function asRole(roles: Role[], tenantId?: string): void {
  h.auth = { isAdmin: roles.includes("admin"), roles, tenantId };
}

beforeAll(() => {
  // Strefa admina = Warszawa: zakres okna ma być LOKALNY (północ czasu
  // polskiego), nie data z napisu UTC.
  process.env.TZ = "Europe/Warsaw";
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

beforeEach(async () => {
  asRole(["admin"]);
  h.listJourneys.mockReset().mockResolvedValue({ state: "ready", data: [] });
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

interface RouteWiring {
  id: string;
  path: string;
  getParentRoute: () => AnyRoute;
}

function wire(route: AnyRoute, wiring: RouteWiring): AnyRoute {
  const update = route.update as unknown as (options: RouteWiring) => AnyRoute;
  return update.call(route, wiring);
}

async function mountHub(entry: string, queryClient?: QueryClient) {
  const layout: AnyRoute = LayoutRoute;
  layout.addChildren([
    wire(IndexRoute, { id: "/", path: "/", getParentRoute: () => layout }),
    wire(TabRoute, { id: "/$tab", path: "/$tab", getParentRoute: () => layout }),
  ]);
  const rootRoute = createRootRouteWithContext<RouteHarnessContext>()({
    component: () => <Outlet />,
    notFoundComponent: () => <p data-testid="not-found">404</p>,
  });
  const view = await renderRoute({
    route: layout,
    path: HUB,
    initialEntry: entry,
    rootRoute,
    queryClient,
  });
  await screen.findByRole("heading", { level: 1 });
  return view;
}

function hubNav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Sekcje huba" });
}

function periodGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Okres" });
}

// ---------------------------------------------------------------------------
// Pasek sekcji
// ---------------------------------------------------------------------------

describe("pasek sekcji huba", () => {
  it("bieżąca zakładka ma aria-current=page, pozostałe nie", async () => {
    await mountHub(`${HUB}/funnel`);

    const current = within(hubNav())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Lejek"]);
  });

  it("na indeksie huba bieżący jest Kokpit (a nie każda zakładka z tym samym prefiksem)", async () => {
    await mountHub(HUB);

    const current = within(hubNav())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Kokpit"]);
  });

  it("odnośniki są pogrupowane: nazwa grupy jest OPISEM odnośnika, a grupy dzielą separatory", async () => {
    await mountHub(`${HUB}/mrr`);

    expect(within(hubNav()).getByRole("link", { name: "Przychód" })).toHaveAccessibleDescription(
      "Monitoruj",
    );
    expect(within(hubNav()).getByRole("link", { name: "Diagnostyka" })).toHaveAccessibleDescription(
      "Napraw",
    );
    expect(within(hubNav()).getByRole("link", { name: "Ścieżki" })).toHaveAccessibleDescription(
      "Automatyzuj",
    );
    expect(within(hubNav()).getByRole("link", { name: "Wskaźniki" })).toHaveAccessibleDescription(
      "Rozumiej",
    );
    expect(within(hubNav()).getAllByRole("separator")).toHaveLength(3);
  });

  it("telefon: wybór sekcji `md:hidden`, szerszy ekran: pasek `hidden md:flex` - bez JS mediów", async () => {
    const view = await mountHub(`${HUB}/funnel`);

    const select = screen.getByRole("combobox", { name: "Sekcja huba" });
    expect(select.closest(".md\\:hidden")).not.toBeNull();
    expect(hubNav().className).toContain("hidden");
    expect(hubNav().className).toContain("md:flex");
    expect(select).toHaveTextContent("Lejek");
    expect(view.container.querySelectorAll("nav")).toHaveLength(2); // sekcje + powiązane moduły
  });

  it("przejście na inną zakładkę zachowuje okno i filtry, gubi parametry zakładki", async () => {
    const view = await mountHub(`${HUB}/funnel?w=quarter&seg=b2c_reduced&track=sales`);

    fireEvent.click(within(hubNav()).getByRole("link", { name: "Dostęp" }));
    await screen.findByTestId("revenue-tab-access");

    expect(view.currentPath()).toBe(`${HUB}/access`);
    expect(view.search()).toEqual({ w: "quarter", seg: "b2c_reduced" });
  });

  it("redaktor nie widzi zakładek z kwotami - ani na pasku, ani w wyborze sekcji", async () => {
    asRole(["editor"]);
    await mountHub(`${HUB}/funnel`);

    const names = within(hubNav())
      .getAllByRole("link")
      .map((a) => a.textContent);
    for (const hidden of ["Przychód", "Retencja", "Dane wejściowe"]) {
      expect(names, hidden).not.toContain(hidden);
    }
    expect(names).toContain("Lejek");
    expect(names).toContain("Wskaźniki");
  });
});

// ---------------------------------------------------------------------------
// Bramki ról
// ---------------------------------------------------------------------------

describe("bramki ról", () => {
  it("redaktor wchodzący z adresu na /mrr dostaje bramkę administratora - nagłówek zostaje", async () => {
    asRole(["editor"]);
    await mountHub(`${HUB}/mrr`);

    const gate = await screen.findByTestId("revenue-role-gate");
    expect(gate).toHaveAttribute("data-required-role", "admin");
    expect(gate).toHaveTextContent("wyłącznie dla administratorów");
    expect(screen.getByRole("heading", { level: 1, name: "Przychód i lejek" })).toBeVisible();
    expect(screen.queryByTestId("revenue-tab-mrr")).toBeNull();
    // Pasek zostaje - redaktor może przejść do swojej zakładki.
    expect(hubNav()).toBeInTheDocument();
  });

  it("autor: bramka huba, bez paska, filtrów i powiązanych modułów", async () => {
    asRole(["author"]);
    await mountHub(`${HUB}/funnel`);

    expect(await screen.findByTestId("revenue-role-gate")).toHaveAttribute(
      "data-required-role",
      "admin_or_editor",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("group", { name: "Okres" })).toBeNull();
  });

  it("przed hydratacją: wyłącznie „wczytywanie” - bez h1, bramki, paska i filtrów", () => {
    for (const roles of [["admin"], ["editor"], ["author"]] as Role[][]) {
      asRole(roles, TENANT);
      const html = renderToString(<RevenueHubLayout />);

      expect(html).toContain('role="status"');
      expect(html).toContain("Wczytywanie sekcji…");
      for (const absent of ["<h1", "<nav", "revenue-role-gate", "aria-pressed"]) {
        expect(html, `${roles}: ${absent}`).not.toContain(absent);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Okno czasu
// ---------------------------------------------------------------------------

describe("filtry okna", () => {
  it("okresy huba z REVENUE_PERIODS; domyślne okno zakładki, gdy adres go nie niesie", async () => {
    await mountHub(`${HUB}/mrr`);

    const labels = within(periodGroup())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual([
      "Ten tydzień",
      "Ten miesiąc",
      "Poprzedni miesiąc",
      "Kwartał",
      "Półrocze",
      "Rok",
      "Ostatnie 12 miesięcy",
      "Własny zakres",
    ]);
    // Przychód domyślnie pokazuje zamknięty poprzedni miesiąc (SPEC §2.2).
    expect(
      within(periodGroup()).getByRole("button", { name: "Poprzedni miesiąc" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("okno z adresu wygrywa z domyślnym, a wybór okresu trafia do adresu", async () => {
    const view = await mountHub(`${HUB}/funnel?w=quarter`);
    expect(within(periodGroup()).getByRole("button", { name: "Kwartał" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(periodGroup()).getByRole("button", { name: "Ostatnie 12 miesięcy" }));
    await waitFor(() => expect(view.search()).toEqual({ w: "ltm" }));
    expect(screen.getByText("wobec 12 pełnych miesięcy wcześniej")).toBeInTheDocument();
  });

  it("zakładka bez okna czasu (Diagnostyka) nie pokazuje przełącznika okresu", async () => {
    await mountHub(`${HUB}/diagnostics?w=quarter`);
    await screen.findByTestId("revenue-tab-diagnostics");

    expect(screen.queryByRole("group", { name: "Okres" })).toBeNull();
  });

  it("okres własny: dwa pola dat LOKALNYCH i zakres opisany tymi samymi dniami", async () => {
    await mountHub(`${HUB}/funnel?w=custom&from=2026-08-03&to=2026-08-09`);

    expect(screen.getByLabelText("Od")).toHaveValue("2026-08-03");
    expect(screen.getByLabelText("Do")).toHaveValue("2026-08-09");
    // Warszawska północ 3 sierpnia to 2 sierpnia 22:00 UTC - opis musi
    // mówić o 3 sierpnia, nie o dniu z napisu UTC.
    expect(screen.getByTestId("revenue-hub-range")).toHaveTextContent(
      "Okno: 3 sierpnia 2026 – 9 sierpnia 2026",
    );
  });

  it("„Zastosuj zakres” zapisuje nowe daty do adresu", async () => {
    const view = await mountHub(`${HUB}/funnel?w=custom&from=2026-08-03&to=2026-08-09`);

    fireEvent.change(screen.getByLabelText("Do"), { target: { value: "2026-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Zastosuj zakres" }));

    await waitFor(() =>
      expect(view.search()).toEqual({ w: "custom", from: "2026-08-03", to: "2026-08-20" }),
    );
  });

  it("wybór „Własny zakres” startuje od bieżącego okna (lokalne dni)", async () => {
    const view = await mountHub(`${HUB}/funnel?w=prev-month`);

    fireEvent.click(within(periodGroup()).getByRole("button", { name: "Własny zakres" }));
    const range = resolveRevenueRange("prev-month", Date.now());
    const since = new Date(range.current.sinceIso);
    const expectedFrom = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-01`;

    await waitFor(() => expect(view.search().w).toBe("custom"));
    expect(view.search().from).toBe(expectedFrom);
  });

  it("segment z listy REVENUE_SEGMENTS trafia do adresu; „wszystkie” go usuwa", async () => {
    const view = await mountHub(`${HUB}/funnel?seg=b2b_institution`);

    const segment = screen.getByRole("combobox", { name: "Segment klientów" });
    expect(segment).toHaveTextContent("Instytucje");
    expect(view.search()).toEqual({ seg: "b2b_institution" });

    fireEvent.keyDown(segment, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Klienci z ulgą" }));
    await waitFor(() => expect(view.search()).toEqual({ seg: "b2c_reduced" }));

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Segment klientów" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Wszystkie segmenty" }));
    await waitFor(() => expect(view.search()).toEqual({}));
  });
});

// ---------------------------------------------------------------------------
// Świeżość, waluta, odświeżanie - bierny odczyt cache
// ---------------------------------------------------------------------------

function seedSnapshot(queryClient: QueryClient, tenantId: string, money: unknown): void {
  const range = resolveRevenueRange("month", Date.now());
  queryClient.setQueryData(revenueKeys.query("snapshot", tenantId, range), { money });
}

describe("świeżość i waluta z cache huba", () => {
  it("bez najemcy w sesji: brak przełącznika waluty, „Odśwież” wyłączone", async () => {
    await mountHub(`${HUB}/funnel`);

    expect(screen.queryByRole("combobox", { name: "Waluta" })).toBeNull();
    expect(screen.getByRole("button", { name: "Odśwież dane" })).toBeDisabled();
  });

  it("waluty z migawki TEGO najemcy i kropka świeżości z dataUpdatedAt", async () => {
    asRole(["admin"], TENANT);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedSnapshot(queryClient, TENANT, {
      mrr: [
        { currency: "PLN", amount_minor: 10_000 },
        { currency: "EUR", amount_minor: 2_400 },
      ],
    });
    // Cudzy najemca w tym samym cache nie dokłada swoich walut.
    seedSnapshot(queryClient, OTHER_TENANT, { mrr: [{ currency: "USD", amount_minor: 1 }] });

    await mountHub(`${HUB}/funnel`, queryClient);

    const currency = screen.getByRole("combobox", { name: "Waluta" });
    expect(currency).toHaveTextContent("Wszystkie waluty");
    fireEvent.keyDown(currency, { key: "ArrowDown" });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Wszystkie waluty", "PLN", "EUR"]);
    expect(screen.getByText(/^Dane z \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("„Odśwież dane” unieważnia klucze huba WYŁĄCZNIE tego najemcy", async () => {
    asRole(["admin"], TENANT);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seedSnapshot(queryClient, TENANT, { mrr: [] });
    seedSnapshot(queryClient, OTHER_TENANT, { mrr: [] });
    queryClient.setQueryData(["admin", "unrelated"], 1);

    await mountHub(`${HUB}/funnel`, queryClient);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Odśwież dane" }));
    });

    const invalidated = (prefix: readonly unknown[]) =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: prefix })
        .map((q) => q.state.isInvalidated);
    expect(invalidated(revenueKeys.domainTenant("snapshot", TENANT))).toEqual([true]);
    expect(invalidated(revenueKeys.domainTenant("snapshot", OTHER_TENANT))).toEqual([false]);
    expect(invalidated(["admin", "unrelated"])).toEqual([false]);
  });
});

// ---------------------------------------------------------------------------
// Licznik paska - Ścieżki (Z-S6-08, Integrator S8)
// ---------------------------------------------------------------------------

describe("licznik „Ścieżki = aktywne” na pasku", () => {
  const journeysLink = () => within(hubNav()).getByRole("link", { name: /^Ścieżki/ });
  const list = (...statuses: string[]) =>
    parseJourneyList(
      statuses.map((status, i) => ({
        ...RPC_SHAPES.list[0],
        id: `aaaaaaaa-0000-4000-8000-00000000000${i}`,
        status,
      })),
    );

  it.each([["admin"], ["editor"]] as const)(
    "%s: liczba aktywnych z listy ścieżek (ten sam klucz co zakładka), z nazwą dla czytnika",
    async (role) => {
      asRole([role], TENANT);
      h.listJourneys.mockResolvedValue({
        state: "ready",
        data: list("active", "paused", "active", "draft"),
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await mountHub(`${HUB}/funnel`, queryClient);

      await waitFor(() => expect(journeysLink()).toHaveTextContent("2"));
      expect(journeysLink()).toHaveTextContent("2 aktywne ścieżki");
      expect(h.listJourneys).toHaveBeenCalledWith({ data: { status: null } });
      expect(queryClient.getQueryData(journeyKeys.list(TENANT, null))).toMatchObject({
        state: "ready",
      });
    },
  );

  it("przy ciepłym cache zakładki - bez nowego żądania; zero aktywnych = brak licznika", async () => {
    asRole(["admin"], TENANT);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(journeyKeys.list(TENANT, null), {
      state: "ready",
      data: list("paused", "archived"),
    });
    await mountHub(`${HUB}/funnel`, queryClient);

    expect(journeysLink()).toHaveTextContent(/^Ścieżki$/);
    expect(h.listJourneys).not.toHaveBeenCalled();
  });

  it("odmowa i błąd odczytu to brak licznika, nie „0”", async () => {
    asRole(["admin"], TENANT);
    h.listJourneys.mockResolvedValue({ state: "forbidden" });
    await mountHub(`${HUB}/funnel`);
    await waitFor(() => expect(h.listJourneys).toHaveBeenCalled());
    expect(journeysLink()).toHaveTextContent(/^Ścieżki$/);
  });

  it("bez najemcy w sesji nie ma żądania listy ścieżek", async () => {
    asRole(["admin"]);
    await mountHub(`${HUB}/funnel`);
    expect(h.listJourneys).not.toHaveBeenCalled();
  });

  it("angielski czytnik słyszy „active journeys”", async () => {
    await i18n.changeLanguage("en");
    asRole(["admin"], TENANT);
    h.listJourneys.mockResolvedValue({ state: "ready", data: list("active") });
    await mountHub(`${HUB}/funnel`);
    const link = within(screen.getByRole("navigation", { name: "Hub sections" })).getByRole(
      "link",
      { name: /^Journeys/ },
    );
    await waitFor(() => expect(link).toHaveTextContent("1 active journey"));
  });
});

// ---------------------------------------------------------------------------
// Język i dostępność
// ---------------------------------------------------------------------------

describe("wersja angielska i dostępność", () => {
  it("mówi po angielsku: sekcje, okresy, powiązane moduły", async () => {
    await i18n.changeLanguage("en");
    await mountHub(`${HUB}/funnel`);

    expect(screen.getByRole("heading", { level: 1, name: "Revenue and funnel" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Hub sections" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Related modules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last 12 months" })).toBeInTheDocument();
  });

  it("nie ma naruszeń dostępności: administrator, redaktor na zakładce administratora, okres własny", async () => {
    asRole(["admin"], TENANT);
    const admin = await mountHub(`${HUB}/funnel`);
    await screen.findByTestId("revenue-tab-funnel");
    expect(summarize(await axeViolations(admin.container))).toBe("");
    cleanup();

    asRole(["editor"]);
    const editor = await mountHub(`${HUB}/retention`);
    await screen.findByTestId("revenue-role-gate");
    expect(summarize(await axeViolations(editor.container))).toBe("");
    cleanup();

    const custom = await mountHub(`${HUB}/funnel?w=custom&from=2026-08-03&to=2026-08-09`);
    await screen.findByTestId("revenue-tab-funnel");
    expect(summarize(await axeViolations(custom.container))).toBe("");
  });
});
