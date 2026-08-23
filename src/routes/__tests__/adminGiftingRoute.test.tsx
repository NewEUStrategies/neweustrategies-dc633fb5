// Trasa /admin/gifting jako KOMPOZYCJA - co trasa deklaruje sama i co składa.
//
// CO TEN PLIK DOWODZI.
//   1. TRASA NIE DEKLARUJE WŁASNEGO `head()`, LOADERA ANI `validateSearch`.
//      To jest asercja o granicy odpowiedzialności: `robots: noindex` i `ssr:
//      false` mieszkają w `src/routes/admin.tsx` i scalają się w dół po
//      dopasowanym łańcuchu tras, więc dopisanie tu drugiego `head()` z noindex
//      byłoby duplikatem, który zaczyna żyć własnym życiem. Test sprawdza
//      WYŁĄCZNIE to, co deklaruje ta trasa.
//   2. SŁOWNIK PANELU REJESTRUJE SIĘ W CHUNKU KOMPONENTU, PRZED pierwszym
//      odczytem danych - inaczej pierwszy render pokazałby gołe klucze.
//   3. KAFLE STATYSTYK STOJĄ NAD ZAKŁADKAMI, więc przełączanie zakładek ich NIE
//      odmontowuje i nie powtarza odczytu statystyk. Wciągnięcie ich do zakładki
//      dałoby dodatkowe wywołanie server fn na każde kliknięcie - koszt
//      niewidoczny w żadnym snapshocie.
//   4. KAŻDA ZAKŁADKA ODPALA SWÓJ ODCZYT DOPIERO PO WEJŚCIU (audyt 200 zdarzeń
//      nie jedzie, dopóki nikt nie otworzył audytu), a poprzedni panel jest
//      odmontowany.
//   5. WSZYSTKIE SZEŚĆ server fn panelu przechodzi przez `useServerFn` -
//      wywołanie server fn wprost z komponentu ominęłoby transport RPC.
//   6. JĘZYK „en-US" DOSTAJE POLSKIE FORMATOWANIE DAT (defekt, `it.fails` niżej):
//      trasa zawęża język porównaniem `=== "en"` zamiast przez `uiLang`, choć
//      `uiLocale` importuje.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania paneli - to
// `src/components/admin/gifting/__tests__/Gift{Stats,Settings,Links,Audit}Panel.test.tsx`.
// Dostępu (isStaff, RLS, SECURITY DEFINER RPC) - tego render nie dowodzi i nie
// wolno mu tak udawać; autorytet stoi przy `adminRouteAuthority.gate.test.ts`,
// snapshocie authz i pgTAP.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderRoute, routeMeta } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  language: "pl",
  kolejność: [] as string[],
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getStats: vi.fn(),
  listLinks: vi.fn(),
  revokeLink: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  const { language } = await import("@/test/adminGiftingLanguage");
  return reactI18nextStub(() => language.current);
});
vi.mock("@/lib/i18n-gifting-admin", () => ({
  ensureI18n: () => {
    h.kolejność.push("słownik");
  },
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: h.getSettings,
  updateGiftAdminSettings: h.updateSettings,
  getGiftAdminStats: h.getStats,
  listGiftLinksAdmin: h.listLinks,
  revokeGiftLinkAdmin: h.revokeLink,
  listGiftEventsAdmin: h.listEvents,
}));

import { language } from "@/test/adminGiftingLanguage";
import { Route } from "@/routes/admin.gifting";
import { DEFAULT_GIFT_ADMIN_SETTINGS } from "@/lib/gifting/admin-model";

const KATALOG = "src/components/admin/gifting";
const SERWEROWE = [
  "getGiftAdminSettings",
  "updateGiftAdminSettings",
  "getGiftAdminStats",
  "listGiftLinksAdmin",
  "revokeGiftLinkAdmin",
  "listGiftEventsAdmin",
] as const;

/** Wszystkie pliki produkcyjne rodziny gifting + sama trasa. */
function źródła(): Array<{ path: string; src: string }> {
  const out = [
    {
      path: "src/routes/admin.gifting.tsx",
      src: readFileSync("src/routes/admin.gifting.tsx", "utf8"),
    },
  ];
  for (const podkatalog of ["atoms", "molecules", "organisms"]) {
    const dir = join(KATALOG, podkatalog);
    for (const name of readdirSync(dir)) {
      out.push({ path: join(dir, name), src: readFileSync(join(dir, name), "utf8") });
    }
  }
  return out;
}

const STATY = {
  active_links: 11,
  created_this_month: 22,
  redeemed_this_month: 33,
  total_created: 44,
  total_redeemed: 55,
  unique_gifters: 66,
  unique_recipients: 77,
  exhausted_links: 88,
  revoked_links: 99,
  expired_links: 101,
};

const LINK = {
  id: "link-1",
  post_id: "post-1",
  post_title: "Reforma rynku energii",
  post_slug: "reforma-rynku-energii",
  created_by: "autor-1",
  creator_name: "Redakcja Testowa",
  creator_email: "redakcja@example.com",
  code: "KODKODKODKOD",
  created_at: "2026-08-01T10:00:00.000Z",
  expires_at: null,
  revoked_at: null,
  redemption_count: 0,
  max_redemptions: 5,
  unique_recipients: 0,
  last_redeemed_at: null,
  total_count: 1,
};

async function trasa() {
  return renderRoute({ route: Route, path: "/admin/gifting", initialEntry: "/admin/gifting" });
}

beforeEach(() => {
  language.current = "pl";
  h.kolejność.length = 0;
  for (const fn of [h.getSettings, h.getStats, h.listLinks, h.listEvents, h.revokeLink]) {
    fn.mockReset();
  }
  h.getStats.mockImplementation(() => {
    h.kolejność.push("statystyki");
    return Promise.resolve(STATY);
  });
  h.getSettings.mockResolvedValue({
    ...DEFAULT_GIFT_ADMIN_SETTINGS,
    updated_at: null,
    updated_by: null,
    persisted: true,
  });
  h.listLinks.mockResolvedValue({ rows: [LINK], total: 1 });
  h.listEvents.mockResolvedValue({ rows: [], total: 0 });
});

describe("trasa /admin/gifting: co deklaruje SAMA", () => {
  it("nie deklaruje własnego head() - noindex dziedziczy po layoucie /admin", async () => {
    expect(Route.options.head).toBeUndefined();
    expect(await routeMeta(Route)).toEqual([]);
  });

  it("nie ma loadera ani walidatora search - panel czyta wszystko po zamontowaniu", () => {
    expect(Route.options.loader).toBeUndefined();
    expect(Route.options.validateSearch).toBeUndefined();
  });

  it("nie nadpisuje ssr - decyzja o renderze serwerowym należy do layoutu /admin", () => {
    expect(Route.options.ssr).toBeUndefined();
  });
});

describe("trasa /admin/gifting: kompozycja", () => {
  it("rejestruje słownik panelu PRZED pierwszym odczytem danych", async () => {
    await trasa();

    expect(h.kolejność.indexOf("słownik")).toBe(0);
    expect(h.kolejność).toContain("statystyki");
  });

  it("po wejściu widać nagłówek, kafle i zakładkę ustawień jako wybraną", async () => {
    await trasa();

    expect(screen.getByRole("heading", { name: /giftingAdmin\.title/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy());
    const wybrana = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(wybrana.map((t) => t.textContent)).toEqual(["giftingAdmin.tabs.settings"]);
  });

  it("audyt NIE jest odczytywany, dopóki nikt nie otworzył zakładki audytu", async () => {
    await trasa();

    await waitFor(() => expect(h.getSettings).toHaveBeenCalled());
    expect(h.listEvents).not.toHaveBeenCalled();
    expect(h.listLinks).not.toHaveBeenCalled();
  });

  it("przełączenie na LINKI odpala odczyt linków i NIE powtarza odczytu statystyk", async () => {
    await trasa();
    await waitFor(() => expect(h.getStats).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.links" }));

    await waitFor(() => expect(h.listLinks).toHaveBeenCalledTimes(1));
    expect(h.getStats).toHaveBeenCalledTimes(1);
    expect(screen.getByText("giftingAdmin.stats.active")).toBeTruthy();
  });

  it("przełączenie na AUDYT odmontowuje panel linków", async () => {
    await trasa();
    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.links" }));
    await waitFor(() => expect(screen.getByText("Reforma rynku energii")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.audit" }));

    await waitFor(() => expect(h.listEvents).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Reforma rynku energii")).toBeNull();
    expect(h.getStats).toHaveBeenCalledTimes(1);
  });
});

describe("trasa /admin/gifting: warstwa danych", () => {
  it("wszystkie SZEŚĆ server fn panelu idzie przez useServerFn - żadna nie jest wołana wprost", () => {
    const pliki = źródła();

    for (const nazwa of SERWEROWE) {
      const użycia = pliki.flatMap(({ src }) =>
        [...src.matchAll(new RegExp(`useServerFn\\(${nazwa}\\)`, "g"))].map(() => 1),
      );
      expect(użycia).toHaveLength(1);
    }
    const wszystkie = pliki.reduce(
      (sum, { src }) => sum + [...src.matchAll(/useServerFn\(/g)].length,
      0,
    );
    expect(wszystkie).toBe(SERWEROWE.length);
  });

  it("ani jeden atom i ani jedna molekuła nie zna react-query, useServerFn ani Supabase", () => {
    const winni = źródła()
      .filter(({ path }) => path.includes("/atoms/") || path.includes("/molecules/"))
      .filter(
        ({ src }) =>
          src.includes("@tanstack/react-query") ||
          src.includes("useServerFn") ||
          src.includes("@/integrations/supabase"),
      )
      .map(({ path }) => path);

    expect(winni).toEqual([]);
  });
});

describe("trasa /admin/gifting: język interfejsu a formatowanie", () => {
  it("interfejs po polsku formatuje daty po polsku", async () => {
    language.current = "pl";
    await trasa();
    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.links" }));

    const oczekiwana = new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(LINK.created_at));
    expect(await screen.findByText(oczekiwana)).toBeTruthy();
  });

  it("interfejs po angielsku ('en') formatuje daty po europejsku (en-GB), nie po amerykańsku", async () => {
    language.current = "en";
    await trasa();
    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.links" }));

    const oczekiwana = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(LINK.created_at));
    expect(await screen.findByText(oczekiwana)).toBeTruthy();
  });

  // DEFEKT (usuwa się RAZEM z sąsiednim `it` poniżej po naprawie).
  it.fails("interfejs 'en-US' też jest angielski - daty NIE lecą po polsku", async () => {
    // Oczekiwane: `uiLang` z `lib/i18n/format` istnieje właśnie po to, żeby
    // `en-US`, `en-GB` i `en` znaczyły to samo (`.startsWith("en")`). Trasa
    // zawęża język porównaniem `i18n.language === "en"`, więc każdy wariant
    // regionalny angielskiego wraca do „pl".
    language.current = "en-US";
    await trasa();
    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.links" }));

    const angielska = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(LINK.created_at));
    expect(await screen.findByText(angielska)).toBeTruthy();
  });

  it("STAN FAKTYCZNY: 'en-US' dostaje polskie formatowanie daty", async () => {
    // Konsekwencja: angielski admin z przeglądarką ustawioną na en-US czyta w
    // panelu polskie daty, choć reszta interfejsu jest po angielsku.
    language.current = "en-US";
    await trasa();
    fireEvent.click(screen.getByRole("tab", { name: "giftingAdmin.tabs.links" }));

    const polska = new Intl.DateTimeFormat("pl-PL", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(LINK.created_at));
    expect(await screen.findByText(polska)).toBeTruthy();
  });
});
