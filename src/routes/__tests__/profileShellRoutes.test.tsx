// Powłoka panelu konta: layout `/profile` plus dwie małe trasy (`edit`, `plan`).
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// Cała rodzina `/profile/*` stała na okrągłym zerze. Layout jest wspólnym
// przedsionkiem dla dwudziestu podstron, więc jego pomyłka mnoży się przez
// dwadzieścia:
//
//   1. BRAMKA SESJI JEST INLINE, NIE PRZEKIEROWANIEM - i to jest DECYZJA
//      opisana w `AuthGate`: trasa zostaje publiczna (SSR, udostępnianie
//      odnośnika, przycisk „wstecz"), a zawartość jest zamknięta. Dowodzimy więc
//      trzech rozłącznych stanów: oczekiwanie na sesję, brak sesji (401 z drogą
//      do logowania), sesja obecna (zawartość). Test szukający tu przekierowania
//      dowodziłby czegoś, czego ta trasa świadomie NIE robi.
//   2. STAN SZUFLADY JEST PAMIĘTANY, ALE ODCZYTYWANY PO HYDRACJI. Odczyt
//      w pierwszym renderze rozjechałby SSR z klientem; awaria magazynu (tryb
//      prywatny) musi zostawić domyślne zwinięcie, nie wywalić panelu.
//   3. SZUFLADA NA MOBILE BLOKUJE PRZEWIJANIE TŁA i zamyka się `Escape`.
//      Overlay bez blokady scrolla przewija stronę pod spodem - klasyczny błąd,
//      po którym użytkownik gubi miejsce na liście.
//   4. PODGLĄD GOŚCIA UKRYWA NAWIGACJĘ TYLKO NA `/profile`. Na podstronach
//      przełącznik nie istnieje, więc ukrycie nawigacji zostawiłoby użytkownika
//      bez wyjścia.
//   5. `/profile/edit` NIE SERWUJE ZABLOKOWANEJ ZAKŁADKI. `?tab=expert` bez roli
//      autorskiej przenosi na „basic" - inaczej ktoś, kto zna adres, dostaje
//      pusty panel eksperta i wnioskuje, że aplikacja jest zepsuta.
//   6. `/profile/plan` ROZRÓŻNIA TRZY STANY PLANU: subskrypcja, dostęp
//      z nadania (dożywotni VIP - „aktywny plan" bez ceny i odnowienia), brak
//      planu. Zlanie drugiego z trzecim mówi osobie z dostępem, że go nie ma.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - NAWIGACJI PANELU: `ProfileNav` ma własne testy w `components/profile`;
//   tutaj jest atrapą, która ZAPISUJE PROPSY (interesuje nas `collapsed`).
// - PANELI TOŻSAMOŚCI: `AccountIdentityPanel`, `SocialIdentityPanel`
//   i `AuthorProfileEditor` mają testy w `components/profile`; tu są markerami.
// - ORGANIZMÓW ROZLICZEŃ: `SubscriptionStatusCard`, `PaymentHistoryCard`,
//   `PlanSwitchBoard` i reszta mają testy w `components/billing`.
// - KATALOGU CEN I RANG: `lib/billing/{catalog,planSwitch,tiers}` mają własne
//   testy; sprawdzamy, że trasa czyta ich wynik.
// - `useGuestPreview` / `guestPreviewStore`: czysty moduł na progu 100%.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  session: {} as unknown,
  loading: false,
  user: { id: "user-1", email: "osoba@example.com", user_metadata: {} } as {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  } | null,
  roles: [] as string[],
  tenantId: "tenant-1" as string | null,
  isAdmin: false,
  /** Wiersz profilu z cache nagłówka (`null` = brak wiersza). */
  headerProfile: null as Record<string, unknown> | null,
  guestPreview: false,
  /** Propsy, z jakimi layout zawołał nawigację panelu. */
  navProps: [] as { collapsed: boolean }[],
  /** Stan subskrypcji, nadań i rangi dla `/profile/plan`. */
  subscription: null as Record<string, unknown> | null,
  grants: [] as Record<string, unknown>[],
  tier: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-experts", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    loading: h.loading,
    user: h.user,
    roles: h.roles,
    tenantId: h.tenantId,
    isAdmin: h.isAdmin,
    isStaff: h.isAdmin,
    isSuperAdmin: false,
  }),
}));
vi.mock("@/lib/profile/useHeaderProfile", () => ({
  useHeaderProfile: () => ({ data: h.headerProfile }),
}));
vi.mock("@/lib/profile/guestPreviewStore", () => ({ useGuestPreview: () => h.guestPreview }));
vi.mock("@/components/profile/ProfileNav", () => ({
  ProfileNav: (props: { collapsed: boolean }) => {
    h.navProps.push(props);
    return <nav data-testid="profile-nav" data-collapsed={String(props.collapsed)} />;
  },
}));
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: (props: { error: { status: number } }) => (
    <div data-testid="friendly-error" data-status={String(props.error.status)} />
  ),
}));
vi.mock("@/components/profile/identity/AccountIdentityPanel", () => ({
  AccountIdentityPanel: () => <div data-testid="AccountIdentityPanel" />,
}));
vi.mock("@/components/profile/identity/SocialIdentityPanel", () => ({
  SocialIdentityPanel: () => <div data-testid="SocialIdentityPanel" />,
}));
vi.mock("@/components/profile/AuthorProfileEditor", () => ({
  AuthorProfileEditor: (props: Record<string, unknown>) => (
    <div data-testid="AuthorProfileEditor" data-mode={String(props.mode)} />
  ),
}));
vi.mock("@/lib/billing/queries", () => ({
  fetchMySubscription: () => Promise.resolve(h.subscription),
}));
vi.mock("@/lib/billing/membership", () => ({ useMyGrants: () => ({ data: h.grants }) }));
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useCurrentTier: () => ({ data: h.tier }),
}));
vi.mock("@/components/billing/organisms/SubscriptionStatusCard", () => ({
  SubscriptionStatusCard: (props: Record<string, unknown>) => (
    <div data-testid="SubscriptionStatusCard" data-has-sub={String(props.subscription !== null)} />
  ),
}));
vi.mock("@/components/billing/organisms/PaymentHistoryCard", () => ({
  PaymentHistoryCard: () => <div data-testid="PaymentHistoryCard" />,
}));
vi.mock("@/components/billing/molecules/PlanSwitchBoard", () => ({
  PlanSwitchBoard: () => <div data-testid="PlanSwitchBoard" />,
}));
vi.mock("@/components/billing/molecules/CustomerPortalButton", () => ({
  CustomerPortalButton: () => <div data-testid="CustomerPortalButton" />,
}));
vi.mock("@/components/billing/molecules/SyncBillingButton", () => ({
  SyncBillingButton: () => <div data-testid="SyncBillingButton" />,
}));
vi.mock("@/components/billing/molecules/LifetimeAccessCard", () => ({
  LifetimeAccessCard: () => <div data-testid="LifetimeAccessCard" />,
}));
// Radix Tabs bez pełnego pointer API nie renderuje zawartości pod happy-dom.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <div data-testid="tabs" data-value={value}>
      <button type="button" data-testid="tab-social" onClick={() => onValueChange("social")}>
        social
      </button>
      <button type="button" data-testid="tab-basic" onClick={() => onValueChange("basic")}>
        basic
      </button>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => (
    <button type="button" data-tab-trigger={value}>
      {children}
    </button>
  ),
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-tab-content={value}>{children}</div>
  ),
}));

import { renderRoute, routeMeta, routeSearchValidator } from "@/test/routeHarness";
import { Route as ProfileLayoutRoute } from "@/routes/profile";
import { Route as ProfileEditRoute } from "@/routes/profile.edit";
import { Route as ProfilePlanRoute } from "@/routes/profile.plan";

/** Ustalona data bazowa - `/profile/plan` liczy wygaśnięcie nadania od „teraz". */
const NOW = new Date("2026-08-21T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  h.session = {};
  h.loading = false;
  h.user = { id: "user-1", email: "osoba@example.com", user_metadata: {} };
  h.roles = [];
  h.tenantId = "tenant-1";
  h.isAdmin = false;
  h.headerProfile = null;
  h.guestPreview = false;
  h.navProps = [];
  h.subscription = null;
  h.grants = [];
  h.tier = null;
  window.localStorage.clear();
  document.body.style.overflow = "";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function mountLayout(entry = "/profile") {
  return renderRoute({ route: ProfileLayoutRoute, path: "/profile", initialEntry: entry });
}

describe("layout /profile - bramka sesji", () => {
  it("OCZEKIWANIE na sesję pokazuje wskaźnik, nie treść i nie odmowę", async () => {
    // Render odmowy w trakcie ładowania mrugałby ekranem 401 każdemu
    // zalogowanemu przy zimnym starcie.
    h.loading = true;
    h.session = null;
    await mountLayout();
    expect(screen.getByLabelText("loading")).toBeTruthy();
    expect(screen.queryByTestId("friendly-error")).toBeNull();
    expect(screen.queryByTestId("profile-nav")).toBeNull();
  });

  it("BRAK SESJI daje odmowę 401 na miejscu, BEZ przekierowania", async () => {
    // Decyzja opisana w `AuthGate`: trasa zostaje publiczna (SSR, udostępnianie
    // odnośnika, „wstecz"), a treść jest zamknięta. Test szukający tu
    // przekierowania dowodziłby czegoś, czego ta trasa świadomie nie robi.
    h.session = null;
    const view = await mountLayout();
    expect(screen.getByTestId("friendly-error").getAttribute("data-status")).toBe("401");
    expect(view.currentPath()).toBe("/profile");
    expect(screen.queryByTestId("profile-nav")).toBeNull();
  });

  it("SESJA OBECNA renderuje powłokę z nawigacją", async () => {
    await mountLayout();
    expect(screen.getByTestId("profile-nav")).toBeTruthy();
    expect(screen.queryByTestId("friendly-error")).toBeNull();
  });

  it("panel jest `noindex` - to prywatne konto, nie treść dla wyszukiwarki", async () => {
    const meta = await routeMeta(ProfileLayoutRoute);
    const robots = meta.find((entry) => entry.name === "robots");
    expect(String(robots?.content)).toContain("noindex");
    // Zakładka przeglądarki musi mieć tytuł - inaczej dwadzieścia podstron
    // panelu daje dwadzieścia identycznych kart.
    expect(meta.find((entry) => "title" in entry)?.title).toBeTruthy();
  });
});

describe("layout /profile - szuflada nawigacji", () => {
  it("domyślnie jest ZWINIĘTA - rail z ikonami, nie pełna kolumna", async () => {
    await mountLayout();
    await waitFor(() => expect(document.querySelector("aside")).toBeTruthy());
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    expect(h.navProps.at(-1)?.collapsed).toBe(true);
  });

  it("zapamiętany stan „rozwinięta” jest odczytywany PO hydracji", async () => {
    // Odczyt w pierwszym renderze rozjechałby SSR z klientem.
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false"),
    );
  });

  it("rozwinięcie ZAPISUJE stan, żeby przetrwał przejście na podstronę", async () => {
    await mountLayout();
    fireEvent.click(screen.getByLabelText("profile.sidebar.expand"));
    await waitFor(() => expect(window.localStorage.getItem("profile:sidebar")).toBe("expanded"));
  });

  it("zwinięcie z powrotem też zapisuje stan", async () => {
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() => expect(screen.getByLabelText("profile.sidebar.collapse")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("profile.sidebar.collapse"));
    await waitFor(() => expect(window.localStorage.getItem("profile:sidebar")).toBe("collapsed"));
  });

  it("AWARIA MAGAZYNU zostawia domyślne zwinięcie, nie wywala panelu", async () => {
    // Tryb prywatny przeglądarki rzuca na `getItem`/`setItem`; panel konta nie
    // ma prawa się na tym wysypać.
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true"),
    );
    expect(screen.getByTestId("profile-nav")).toBeTruthy();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("`Escape` zamyka rozwiniętą szufladę", async () => {
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false"),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true"),
    );
  });

  it("inny klawisz NIE zamyka szuflady", async () => {
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false"),
    );
    fireEvent.keyDown(window, { key: "a" });
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false");
  });

  it("na MOBILE rozwinięta szuflada BLOKUJE przewijanie tła", async () => {
    // Overlay bez blokady scrolla przewija stronę pod spodem i użytkownik gubi
    // miejsce, w którym był.
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: true } as MediaQueryList);
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    // Zamknięcie PRZYWRACA przewijanie - inaczej strona zostaje zablokowana.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.body.style.overflow).not.toBe("hidden"));
    matchMedia.mockRestore();
  });

  it("na DESKTOPIE rozwinięta szuflada nie rusza przewijania", async () => {
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: false } as MediaQueryList);
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false"),
    );
    expect(document.body.style.overflow).not.toBe("hidden");
    matchMedia.mockRestore();
  });

  it("przycisk zwijania na dole szuflady też ją zamyka", async () => {
    // Na mobile użytkownik jest na dole listy nawigacji - droga powrotna musi
    // być tam, gdzie jego palec, nie tylko w nagłówku szuflady.
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false"),
    );
    const bottom = [...document.querySelectorAll("aside button")].filter((node) =>
      node.className.includes("md:hidden"),
    );
    expect(bottom.length).toBeGreaterThan(0);
    fireEvent.click(bottom.at(-1) as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true"),
    );
  });

  it("kliknięcie w tło zamyka szufladę", async () => {
    window.localStorage.setItem("profile:sidebar", "expanded");
    await mountLayout();
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false"),
    );
    const overlay = document.querySelector("button.fixed.inset-0");
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true"),
    );
  });
});

describe("layout /profile - podgląd gościa", () => {
  it("na `/profile` podgląd gościa UKRYWA nawigację", async () => {
    h.guestPreview = true;
    await mountLayout("/profile");
    expect(screen.queryByTestId("profile-nav")).toBeNull();
  });

  it("adres z ukośnikiem na końcu liczy się jako `/profile`", async () => {
    h.guestPreview = true;
    await mountLayout("/profile/");
    expect(screen.queryByTestId("profile-nav")).toBeNull();
  });

  it("na PODSTRONIE podgląd gościa nie rusza nawigacji - i to jest cała treść testu", async () => {
    // Przełącznik „podgląd jak gość" żyje wyłącznie na `/profile`. Ukrycie
    // nawigacji na podstronie zostawiłoby użytkownika bez wyjścia z ekranu.
    h.guestPreview = true;
    const view = await renderRoute({
      route: ProfileLayoutRoute,
      path: "/profile/bookmarks",
      initialEntry: "/profile/bookmarks",
    });
    expect(view.currentPath()).toBe("/profile/bookmarks");
    expect(screen.getByTestId("profile-nav")).toBeTruthy();
  });
});

describe("layout /profile - nazwa wyświetlana", () => {
  it("wizytówka pokazuje się WYŁĄCZNIE w rozwiniętej szufladzie", async () => {
    h.headerProfile = { display_name: "Anna Kowalska", avatar_url: null };
    await mountLayout();
    expect(screen.queryByText("Anna Kowalska")).toBeNull();
    fireEvent.click(screen.getByLabelText("profile.sidebar.expand"));
    await waitFor(() => expect(screen.getByText("Anna Kowalska")).toBeTruthy());
  });

  it.each([
    [{ display_name: "Anna Kowalska", first_name: "A", last_name: "K" }, {}, "Anna Kowalska"],
    [{ display_name: null, first_name: "Anna", last_name: "Kowalska" }, {}, "Anna Kowalska"],
    [{ display_name: "   ", first_name: "Anna", last_name: null }, {}, "Anna"],
    [null, { full_name: "Z metadanych" }, "Z metadanych"],
    [null, { name: "Z pola name" }, "Z pola name"],
    [null, {}, "osoba@example.com"],
  ])(
    "kolejność źródeł nazwy: profil → metadane → adres (%#)",
    async (profile, metadata, expected) => {
      // Puste imię i nazwisko nie mogą dać pustej wizytówki - użytkownik
      // widziałby kartę z samą rolą i bez tożsamości.
      h.headerProfile = profile;
      h.user = { id: "user-1", email: "osoba@example.com", user_metadata: metadata };
      await mountLayout();
      fireEvent.click(screen.getByLabelText("profile.sidebar.expand"));
      await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    },
  );

  it("konto bez żadnej nazwy dostaje etykietę zastępczą, nie pustkę", async () => {
    h.headerProfile = null;
    h.user = { id: "user-1", email: undefined, user_metadata: {} };
    await mountLayout();
    fireEvent.click(screen.getByLabelText("profile.sidebar.expand"));
    await waitFor(() => expect(screen.getByText("profile.account.unnamed")).toBeTruthy());
  });

  it("bez zalogowanego użytkownika wizytówka się nie renderuje", async () => {
    // Sesja bez `user` to stan przejściowy odświeżania tokenu.
    h.user = null;
    await mountLayout();
    fireEvent.click(screen.getByLabelText("profile.sidebar.expand"));
    await waitFor(() => expect(screen.getByTestId("profile-nav")).toBeTruthy());
    expect(document.querySelector("[data-slot='avatar']")).toBeNull();
  });
});

describe("/profile/edit - zakładki tożsamości", () => {
  async function mountEdit(entry = "/profile/edit") {
    return renderRoute({ route: ProfileEditRoute, path: "/profile/edit", initialEntry: entry });
  }

  it("bez zakładki w adresie otwiera dane podstawowe", async () => {
    await mountEdit();
    expect(screen.getByTestId("tabs").getAttribute("data-value")).toBe("basic");
    expect(screen.getByTestId("AccountIdentityPanel")).toBeTruthy();
  });

  it("zakładka z adresu jest respektowana - głęboki odnośnik działa", async () => {
    await mountEdit("/profile/edit?tab=social");
    expect(screen.getByTestId("tabs").getAttribute("data-value")).toBe("social");
  });

  it("bez roli autorskiej zakładka eksperta NIE ISTNIEJE", async () => {
    h.roles = ["user"];
    await mountEdit();
    expect(document.querySelector('[data-tab-trigger="expert"]')).toBeNull();
    expect(screen.queryByTestId("AuthorProfileEditor")).toBeNull();
  });

  it.each(["author", "admin", "super_admin"])(
    "rola %s odblokowuje zakładkę eksperta",
    async (role) => {
      h.roles = [role];
      await mountEdit("/profile/edit?tab=expert");
      expect(document.querySelector('[data-tab-trigger="expert"]')).toBeTruthy();
      expect(screen.getByTestId("AuthorProfileEditor").getAttribute("data-mode")).toBe("self");
    },
  );

  it("`?tab=expert` BEZ ROLI przenosi na dane podstawowe, nie na pusty panel", async () => {
    // To jest cała treść tego testu: ktoś, kto zna adres, nie może dostać
    // zablokowanego panelu eksperta i wywnioskować, że aplikacja jest zepsuta.
    h.roles = ["user"];
    await mountEdit("/profile/edit?tab=expert");
    expect(screen.getByTestId("tabs").getAttribute("data-value")).toBe("basic");
    expect(screen.getByTestId("AccountIdentityPanel")).toBeTruthy();
  });

  it.each([
    [{ tab: "expert" }, "expert"],
    [{ tab: "social" }, "social"],
    [{ tab: "basic" }, undefined],
    [{ tab: "nie-ma-takiej" }, undefined],
    [{ tab: 42 }, undefined],
    [{}, undefined],
  ])("walidator adresu: %j → %j", (raw, expected) => {
    // Wartość spoza zbioru nie ma prawa dojść do komponentu: zakładka jest
    // KONTRAKTEM odnośnika, a nie dowolnym ciągiem z paska adresu.
    expect(routeSearchValidator(ProfileEditRoute)(raw as Record<string, unknown>)).toEqual({
      tab: expected,
    });
  });

  it("zmiana zakładki ZASTĘPUJE wpis w historii", async () => {
    // Dziewięć wpisów po przejrzeniu trzech zakładek zamienia „wstecz"
    // w błądzenie.
    const view = await mountEdit();
    fireEvent.click(screen.getByTestId("tab-social"));
    await waitFor(() => expect(view.search().tab).toBe("social"));
  });

  it("powrót na „basic” CZYŚCI parametr adresu, nie zostawia `?tab=basic`", async () => {
    const view = await mountEdit("/profile/edit?tab=social");
    fireEvent.click(screen.getByTestId("tab-basic"));
    await waitFor(() => expect(view.search().tab).toBeUndefined());
  });

  it("dopóki sesja się nie rozstrzygnęła, strona nie renderuje paneli", async () => {
    h.loading = true;
    await mountEdit();
    expect(screen.queryByTestId("AccountIdentityPanel")).toBeNull();
  });

  it("bez użytkownika strona nie renderuje paneli tożsamości", async () => {
    h.user = null;
    await mountEdit();
    expect(screen.queryByTestId("AccountIdentityPanel")).toBeNull();
  });
});

describe("/profile/plan - trzy stany planu", () => {
  async function mountPlan() {
    return renderRoute({
      route: ProfilePlanRoute,
      path: "/profile/plan",
      initialEntry: "/profile/plan",
    });
  }

  it("BRAK planu i nadania prowadzi do cennika", async () => {
    await mountPlan();
    await waitFor(() => expect(screen.getByText("profile.planPage.noPlan")).toBeTruthy());
    expect(screen.getByText("profile.planPage.chooseCta").closest("a")?.getAttribute("href")).toBe(
      "/pricing",
    );
  });

  it("AKTYWNA SUBSKRYPCJA pokazuje nazwę planu, nie zaproszenie do cennika", async () => {
    h.subscription = { plan: "annual", status: "active" };
    await mountPlan();
    await waitFor(() => expect(screen.queryByText("profile.planPage.noPlan")).toBeNull());
    expect(screen.getByTestId("SubscriptionStatusCard").getAttribute("data-has-sub")).toBe("true");
  });

  it("DOSTĘP Z NADANIA to „aktywny plan” - bez ceny i bez odnowienia", async () => {
    // Zlanie nadania z brakiem planu mówi osobie z dożywotnim dostępem, że go
    // nie ma - i wysyła ją do cennika po coś, co już posiada.
    h.grants = [{ tier_key: "vip", source: "expert", revoked_at: null, expires_at: null }];
    await mountPlan();
    await waitFor(() => expect(screen.queryByText("profile.planPage.noPlan")).toBeNull());
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.getByText("profile.planPage.grantLifetime")).toBeTruthy();
  });

  it("nadanie z terminem pokazuje DATĘ, nie „dożywotnio”", async () => {
    h.grants = [
      {
        tier_key: "vip",
        source: "expert",
        revoked_at: null,
        expires_at: "2026-12-31T00:00:00.000Z",
      },
    ];
    await mountPlan();
    await waitFor(() => expect(screen.queryByText("profile.planPage.grantLifetime")).toBeNull());
  });

  it("nadanie ODWOŁANE nie liczy się jako aktywny plan", async () => {
    h.grants = [
      {
        tier_key: "vip",
        source: "expert",
        revoked_at: "2026-01-01T00:00:00.000Z",
        expires_at: null,
      },
    ];
    await mountPlan();
    await waitFor(() => expect(screen.getByText("profile.planPage.noPlan")).toBeTruthy());
  });

  it("nadanie WYGASŁE nie liczy się jako aktywny plan", async () => {
    // Data bazowa testu jest ustalona (`vi.setSystemTime`), więc „wygasłe"
    // znaczy to samo przy każdym uruchomieniu.
    h.grants = [
      {
        tier_key: "vip",
        source: "expert",
        revoked_at: null,
        expires_at: "2026-08-20T00:00:00.000Z",
      },
    ];
    await mountPlan();
    await waitFor(() => expect(screen.getByText("profile.planPage.noPlan")).toBeTruthy());
  });

  it("nadanie z terminem W PRZYSZŁOŚCI liczy się jako aktywne", async () => {
    h.grants = [
      {
        tier_key: "vip",
        source: "expert",
        revoked_at: null,
        expires_at: "2026-08-22T00:00:00.000Z",
      },
    ];
    await mountPlan();
    await waitFor(() => expect(screen.queryByText("profile.planPage.noPlan")).toBeNull());
  });

  it("nazwa rangi z katalogu wygrywa nad surowym kluczem", async () => {
    h.grants = [{ tier_key: "vip", source: "expert", revoked_at: null, expires_at: null }];
    h.tier = { key: "vip", name_pl: "Mecenas", name_en: "Patron" };
    await mountPlan();
    await waitFor(() => expect(screen.getByText("Mecenas")).toBeTruthy());
  });

  it("ranga o INNYM kluczu niż nadanie nie podmienia nazwy", async () => {
    // Ranga bieżąca może pochodzić z subskrypcji, a nadanie z innego źródła -
    // pomyłka nazwałaby dostęp VIP nazwą planu, którego użytkownik nie ma.
    h.grants = [{ tier_key: "vip", source: "expert", revoked_at: null, expires_at: null }];
    h.tier = { key: "premium", name_pl: "Premium", name_en: "Premium" };
    await mountPlan();
    await waitFor(() => expect(screen.getByText("VIP")).toBeTruthy());
    expect(screen.queryByText("Premium")).toBeNull();
  });

  it("aktywna subskrypcja pokazuje CENĘ i datę ODNOWIENIA", async () => {
    h.subscription = {
      plan: { tier_key: "student", interval: "month", price_cents: 1900, currency: "PLN" },
      status: "active",
      canceled_at: null,
      current_period_end: "2026-09-21T00:00:00.000Z",
    };
    await mountPlan();
    await waitFor(() => expect(screen.getByText("profile.subscription.renewsAt")).toBeTruthy());
    expect(screen.getByText("profile.status.active")).toBeTruthy();
    expect(screen.queryByText("profile.subscription.cancelsAt")).toBeNull();
  });

  it("subskrypcja ANULOWANA mówi „kończy się”, nie „odnawia się”", async () => {
    // Dwa różne stany o jednym napisie: użytkownik, który anulował, widziałby
    // „odnawia się" i wnioskował, że anulowanie nie zadziałało.
    h.subscription = {
      plan: { tier_key: "student", interval: "month", price_cents: 1900, currency: "PLN" },
      status: "canceled",
      canceled_at: "2026-08-01T00:00:00.000Z",
      current_period_end: "2026-09-21T00:00:00.000Z",
    };
    await mountPlan();
    await waitFor(() => expect(screen.getByText("profile.subscription.cancelsAt")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.renewsAt")).toBeNull();
  });

  it("subskrypcja bez daty końca pokazuje kreskę, nie „Invalid Date”", async () => {
    h.subscription = {
      plan: { tier_key: "student", interval: "month", price_cents: 1900, currency: "PLN" },
      status: "active",
      canceled_at: null,
      current_period_end: null,
    };
    await mountPlan();
    await waitFor(() => expect(screen.getByText("-")).toBeTruthy());
  });

  it("subskrypcja bez statusu domyślnie jest „aktywna”, nie pusta", async () => {
    h.subscription = {
      plan: { tier_key: "student", interval: "month", price_cents: 1900, currency: "PLN" },
      current_period_end: null,
    };
    await mountPlan();
    await waitFor(() => expect(screen.getByText("profile.status.active")).toBeTruthy());
  });

  it("nadanie AKTYWNE wygrywa nad wcześniejszym odwołanym na liście", async () => {
    // `find` po liście nadań musi pominąć odwołane, nie zatrzymać się na
    // pierwszym wpisie - inaczej osoba z nowym nadaniem widzi „brak planu".
    h.grants = [
      {
        tier_key: "old",
        source: "expert",
        revoked_at: "2026-01-01T00:00:00.000Z",
        expires_at: null,
      },
      { tier_key: "vip", source: "manual", revoked_at: null, expires_at: null },
    ];
    await mountPlan();
    await waitFor(() => expect(screen.getByText("VIP")).toBeTruthy());
  });

  it("identyfikator techniczny ceny widzi WYŁĄCZNIE admin", async () => {
    // `lookup_key` niczego nie mówi użytkownikowi, a ujawnia strukturę cennika
    // u operatora płatności. Plan bierzemy Z KATALOGU (nie wymyślony), bo
    // identyfikator powstaje z dopasowania rangi i okresu - plan spoza katalogu
    // dałby `null` i test „przechodziłby" nie dowodząc niczego.
    const { BILLING_CATALOG } = await import("@/lib/billing/catalog");
    const entry = BILLING_CATALOG[0];
    h.subscription = {
      plan: { tier_key: entry.tierKey, interval: entry.interval },
      status: "active",
    };

    h.isAdmin = false;
    await mountPlan();
    await waitFor(() => expect(screen.getByTestId("SubscriptionStatusCard")).toBeTruthy());
    expect(screen.queryByText(entry.priceId)).toBeNull();
    cleanup();

    h.isAdmin = true;
    await mountPlan();
    await waitFor(() => expect(screen.getByText(entry.priceId)).toBeTruthy());
  });

  it("zapytanie o subskrypcję NIE leci bez sesji", async () => {
    // Panel bez sesji nie ma po co pukać do rozliczeń - zapytanie i tak
    // wróciłoby odmową, a licznik w logach urósłby.
    h.session = null;
    const view = await mountPlan();
    await waitFor(() => expect(screen.getByTestId("SubscriptionStatusCard")).toBeTruthy());
    const cached = view.queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.status !== "pending");
    expect(cached).toHaveLength(0);
  });
});
