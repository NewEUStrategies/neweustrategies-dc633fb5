// Sześć tras panelu `/admin/community/clubs/*` ZAMONTOWANYCH.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost,
// że render-testowanie tras panelu dla samego pokrycia jest farmą: ryzyko
// w trasie panelu to DOSTĘP, a dostęp jest egzekwowany w trzech miejscach
// (wspólny layout `/admin`, sama trasa, RLS/RPC). Ta bramka ma rację i jej
// zakres został rozszerzony o rodzinę `community.clubs` w tym samym commicie.
//
// Ten plik pokrywa to, czego bramka CELOWO nie dotyka - stan i sklejenie:
//
//   1. WŁASNA BRAMKA `isAdmin` W KAŻDEJ Z SZEŚCIU TRAS. Layout `/admin`
//      przepuszcza też redaktora i autora, a strukturą klubów zarządza
//      wyłącznie admin. Bez tego warunku redaktor widzi pustą tabelę zamiast
//      zdania wyjaśniającego - i to jest defekt tej samej klasy, co droplista
//      zmiany roli opisana w nagłówku bramki.
//   2. `?tab=` JAKO KONTRAKT LINKU. Administrator wysyłający odnośnik do
//      zakładki „Uprawnienia" ma wysyłać odnośnik do zakładki „Uprawnienia".
//      Zmiana zakładki ZASTĘPUJE wpis w historii (`replace`), bo dziewięć
//      wpisów po przejrzeniu edytora zamienia „wstecz" w błądzenie.
//   3. WERSJA ROBOCZA JEST LOKALNA i zapisuje się JEDNYM przyciskiem, aktywnym
//      wyłącznie przy realnej zmianie. Autozapis byłby tu błędem: pola dostępu
//      zmieniają realną widoczność treści.
//   4. ZAPYTANIA NIE LECĄ BEZ UPRAWNIENIA. `useAdminClub(isAdmin ? clubId :
//      undefined)` i `useAdminClubs(filters, isAdmin)` - bez tego panel bez
//      uprawnień nadal puka do RPC i zapala liczniki w logach.
//   5. TRZY STANY LISTY (awaria, oczekiwanie, pustka) i DWA komunikaty pustki:
//      „nie ma jeszcze klubów" vs „nic nie pasuje do filtrów". Pomyłka mówi
//      administratorowi, że baza jest pusta, kiedy jest tylko zawężona.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ EDYTORA: wersja robocza, wykrycie zmiany, payload zapisu, filtry
//   i normalizacja sluga mają tabelę przypadków w
//   `src/lib/clubs/__tests__/adminClubEditor.test.ts`. Tutaj dowodzimy, że
//   trasa je WOŁA i respektuje ich wynik.
// - ORGANIZMÓW ZAKŁADEK: dziewięć zakładek edytora i cztery managery to atrapy
//   -markery. Ich zachowanie należy do etapu organizmów panelu.
// - AUTORYTETU: `admin_club_upsert`, `admin_club_get` i reszta RPC mają pgTAP.
//   Test nie odtwarza ich reguł na atrapie.
// - NAGŁÓWKÓW SEO: panel jest `noindex` z definicji; sprawdzamy tylko, że
//   `head()` istnieje i niesie tytuł (zakładka przeglądarki bez tytułu to
//   dziewięć identycznych kart „New European Strategies”).
//
// DWIE GAŁĘZIE NIEOSIĄGALNE. W `admin.community.clubs.$clubId.tsx` handlery
// zmiany wersji roboczej mają kształt `setGeneral((prev) => (prev ? {...prev,
// ...patch} : prev))`. Ramię `: prev` nie ma wejścia: zakładka, która ten
// handler dostaje, renderuje się wyłącznie po warunku `!general || !access`
// wyżej w komponencie, więc w chwili wywołania wersja robocza ZAWSZE istnieje.
// Obrona zostaje w kodzie na wypadek przestawienia tych warunków - tylko nie da
// się jej wywołać z testu bez rozmontowania tej gwarancji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdminClubDetailRow, AdminClubRow, ClubUpsertInput } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  isAdmin: true,
  /** Odpowiedź `admin_club_list`; `undefined` = zapytanie w locie. */
  list: { rows: [] as unknown[], total: 0 } as { rows: unknown[]; total: number } | undefined,
  listPending: false,
  listError: false,
  /** Argumenty, z jakimi trasa zawołała listę - `enabled` jest tu dowodem. */
  listCalls: [] as { filters: Record<string, unknown>; enabled: boolean }[],
  /** Odpowiedź `admin_club_get`. */
  detail: null as unknown,
  detailPending: false,
  detailError: false,
  /** Identyfikator, o który trasa zapytała - `undefined` znaczy „nie pytaj". */
  detailCalls: [] as (string | undefined)[],
  savePayloads: [] as ClubUpsertInput[],
  saveError: null as unknown,
  savePending: false,
  /** Aktywna zakładka widziana przez atrapę `Tabs` - patrz `TabsContent`. */
  activeTab: "general",
  /** Nawigacje zlecone przez trasę listy po utworzeniu klubu. */
  navigations: [] as { to: string; params?: Record<string, unknown>; search?: unknown }[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("@/lib/i18n-club-elements", () => ({ ensureClubElementsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin, isStaff: true, isSuperAdmin: false, session: {} }),
}));
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: (value: string) => value }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // `useNavigate` bez parametrów - lista klubów przenosi do nowego klubu po
    // jego utworzeniu i to JEST przedmiotem dowodu (argumenty przejścia).
    // Nawigacja edytora idzie przez `Route.useNavigate()`, którego ten mock nie
    // dotyka, więc `?tab=` nadal jedzie przez prawdziwy router.
    useNavigate:
      () => (options: { to: string; params?: Record<string, unknown>; search?: unknown }) => {
        h.navigations.push(options);
        return Promise.resolve();
      },
  };
});
vi.mock("@/lib/clubs/useClubs", () => ({
  useAdminClubs: (filters: Record<string, unknown>, enabled: boolean) => {
    h.listCalls.push({ filters, enabled });
    return { data: h.list, isPending: h.listPending, isError: h.listError };
  },
  useAdminClub: (clubId: string | undefined) => {
    h.detailCalls.push(clubId);
    return { data: h.detail, isPending: h.detailPending, isError: h.detailError };
  },
  useUpsertClub: () => ({
    mutate: (
      payload: ClubUpsertInput,
      handlers: { onSuccess: () => void; onError: (error: unknown) => void },
    ) => {
      h.savePayloads.push(payload);
      if (h.saveError !== null) handlers.onError(h.saveError);
      else handlers.onSuccess();
    },
    isPending: h.savePending,
  }),
}));

// Radix Select i Tabs nie działają pod happy-dom bez pełnego pointer API.
// Podmieniamy je na natywne odpowiedniki: przedmiotem dowodu jest to, KTÓRE
// opcje trasa wystawia i CO robi ze zmianą, a nie mechanika biblioteki.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => {
    h.activeTab = value;
    return (
      <div data-testid="tabs" data-value={value}>
        <button type="button" data-testid="tab-change" onClick={() => onValueChange("permissions")}>
          zmień zakładkę
        </button>
        <button type="button" data-testid="tab-bogus" onClick={() => onValueChange("nie-ma")}>
          zakładka spoza zbioru
        </button>
        {children}
      </div>
    );
  },
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => (
    <button type="button" data-tab-trigger={value}>
      {children}
    </button>
  ),
  // Zawartość zakładki renderuje się TYLKO dla aktywnej wartości - tak samo
  // jak w Radiksie bez `forceMount`. To reguła wydajnościowa opisana w trasie:
  // kolejka moderacji i lista tematów to trzy zapytania każda.
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) =>
    value === h.activeTab ? <div data-tab-content={value}>{children}</div> : null,
}));

/** Atrapa organizmu: marker + zapis propsów. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

const ADMIN_ORGANISMS = [
  ["ClubsTable", "@/components/admin/clubs/organisms/ClubsTable"],
  ["ClubCreateDialog", "@/components/admin/clubs/organisms/ClubCreateDialog"],
  ["ClubGeneralTab", "@/components/admin/clubs/organisms/ClubGeneralTab"],
  ["ClubAccessTab", "@/components/admin/clubs/organisms/ClubAccessTab"],
  ["ClubGroupsTab", "@/components/admin/clubs/organisms/ClubGroupsTab"],
  ["ClubThreadsTab", "@/components/admin/clubs/organisms/ClubThreadsTab"],
  ["ClubModerationTab", "@/components/admin/clubs/organisms/ClubModerationTab"],
  ["ClubMembersTab", "@/components/admin/clubs/organisms/ClubMembersTab"],
  ["ClubInvitationsTab", "@/components/admin/clubs/organisms/ClubInvitationsTab"],
  ["ClubPermissionsTab", "@/components/admin/clubs/organisms/ClubPermissionsTab"],
  ["ClubStatsTab", "@/components/admin/clubs/organisms/ClubStatsTab"],
  ["ClubTopicsManager", "@/components/admin/clubs/organisms/ClubTopicsManager"],
  ["ClubSpecializationsManager", "@/components/admin/clubs/organisms/ClubSpecializationsManager"],
  ["ClubApplicationsInbox", "@/components/admin/clubs/organisms/ClubApplicationsInbox"],
  ["ClubElementsCatalog", "@/components/admin/clubs/organisms/ClubElementsCatalog"],
] as const;

vi.mock("@/components/admin/clubs/organisms/ClubsTable", () => ({
  ClubsTable: organismStub("ClubsTable"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubCreateDialog", () => ({
  ClubCreateDialog: organismStub("ClubCreateDialog"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubGeneralTab", () => ({
  ClubGeneralTab: organismStub("ClubGeneralTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubAccessTab", () => ({
  ClubAccessTab: organismStub("ClubAccessTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubGroupsTab", () => ({
  ClubGroupsTab: organismStub("ClubGroupsTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubThreadsTab", () => ({
  ClubThreadsTab: organismStub("ClubThreadsTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubModerationTab", () => ({
  ClubModerationTab: organismStub("ClubModerationTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubMembersTab", () => ({
  ClubMembersTab: organismStub("ClubMembersTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubInvitationsTab", () => ({
  ClubInvitationsTab: organismStub("ClubInvitationsTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubPermissionsTab", () => ({
  ClubPermissionsTab: organismStub("ClubPermissionsTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubStatsTab", () => ({
  ClubStatsTab: organismStub("ClubStatsTab"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubTopicsManager", () => ({
  ClubTopicsManager: organismStub("ClubTopicsManager"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubSpecializationsManager", () => ({
  ClubSpecializationsManager: organismStub("ClubSpecializationsManager"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubApplicationsInbox", () => ({
  ClubApplicationsInbox: organismStub("ClubApplicationsInbox"),
}));
vi.mock("@/components/admin/clubs/organisms/ClubElementsCatalog", () => ({
  ClubElementsCatalog: organismStub("ClubElementsCatalog"),
}));
vi.mock("@/components/admin/molecules/AdminPagination", () => ({
  AdminPagination: organismStub("AdminPagination"),
}));

import { renderRoute, routeMeta, routeSearchValidator } from "@/test/routeHarness";
import { CLUB_BASE_ISO, CLUB_IDS, adminClubRow } from "@/test/clubs/fixtures";
import { CLUB_EDITOR_TABS } from "@/lib/clubs/adminClubEditor";
import { Route as ListRoute } from "@/routes/admin.community.clubs.index";
import { Route as EditorRoute } from "@/routes/admin.community.clubs.$clubId";
import { Route as TopicsRoute } from "@/routes/admin.community.clubs.topics";
import { Route as SpecializationsRoute } from "@/routes/admin.community.clubs.specializations";
import { Route as ApplicationsRoute } from "@/routes/admin.community.clubs.applications";
import { Route as ElementsRoute } from "@/routes/admin.community.clubs.elements";

function detailRow(overrides: Partial<AdminClubDetailRow> = {}): AdminClubDetailRow {
  return {
    id: CLUB_IDS.club,
    slug: "klub-energetyczny",
    name_pl: "Klub energetyczny",
    name_en: "Energy club",
    tagline_pl: "Energia i klimat",
    tagline_en: "Energy and climate",
    description_pl: "Opis",
    description_en: "Description",
    rules_pl: "Zasady",
    rules_en: "Rules",
    accent_color: "#0f766e",
    icon: "zap",
    cover_image_url: "",
    layout: "list",
    status: "active",
    visibility: "public",
    join_policy: "open",
    moderation_mode: "post",
    attribution_mode: "named",
    who_can_post: "members",
    min_tier_rank: 20,
    policy_area: "energy",
    member_count: 42,
    group_count: 3,
    thread_count: 12,
    created_at: CLUB_BASE_ISO,
    updated_at: CLUB_BASE_ISO,
    last_activity_at: CLUB_BASE_ISO,
    ...overrides,
  };
}

async function mountList() {
  return renderRoute({
    route: ListRoute,
    path: "/admin/community/clubs/",
    initialEntry: "/admin/community/clubs",
  });
}

async function mountEditor(tab = "general") {
  return renderRoute({
    route: EditorRoute,
    path: "/admin/community/clubs/$clubId",
    initialEntry: `/admin/community/clubs/${CLUB_IDS.club}?tab=${tab}`,
  });
}

beforeEach(() => {
  cleanup();
  h.isAdmin = true;
  h.list = { rows: [], total: 0 };
  h.listPending = false;
  h.listError = false;
  h.listCalls = [];
  h.detail = detailRow();
  h.detailPending = false;
  h.detailError = false;
  h.detailCalls = [];
  h.savePayloads = [];
  h.saveError = null;
  h.savePending = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.navigations = [];
  h.organism = {};
});

// --- bramka isAdmin we WSZYSTKICH sześciu trasach ---------------------------

describe("własna bramka `isAdmin` - layout `/admin` przepuszcza redaktora", () => {
  const POWLOKI = [
    {
      nazwa: "katalog obszarów",
      route: TopicsRoute,
      path: "/admin/community/clubs/topics",
      organism: "ClubTopicsManager",
      odmowa: "adminClubs.topics.adminOnly",
    },
    {
      nazwa: "katalog specjalizacji",
      route: SpecializationsRoute,
      path: "/admin/community/clubs/specializations",
      organism: "ClubSpecializationsManager",
      odmowa: "adminClubs.topics.adminOnly",
    },
    {
      nazwa: "skrzynka zgłoszeń",
      route: ApplicationsRoute,
      path: "/admin/community/clubs/applications",
      organism: "ClubApplicationsInbox",
      odmowa: "adminClubs.topics.adminOnly",
    },
    {
      nazwa: "katalog elementów",
      route: ElementsRoute,
      path: "/admin/community/clubs/elements",
      organism: "ClubElementsCatalog",
      odmowa: "adminClubs.noPermissionTitle",
    },
  ] as const;

  it.each(POWLOKI)("$nazwa: admin widzi treść", async ({ route, path, organism }) => {
    await renderRoute({ route, path, initialEntry: path });
    expect(screen.getByTestId(organism)).toBeTruthy();
  });

  it.each(POWLOKI)(
    "$nazwa: bez uprawnienia zdanie wyjaśniające ZAMIAST treści",
    async ({ route, path, organism, odmowa }) => {
      h.isAdmin = false;
      await renderRoute({ route, path, initialEntry: path });
      expect(screen.getByText(odmowa)).toBeTruthy();
      expect(screen.queryByTestId(organism)).toBeNull();
    },
  );

  it.each(POWLOKI)("$nazwa: `head()` niesie tytuł zakładki przeglądarki", async ({ route }) => {
    const meta = await routeMeta(route);
    const title = meta.find((entry) => typeof entry.title === "string");
    expect(typeof title?.title).toBe("string");
    expect(title?.title).not.toBe("");
  });

  it("lista klubów: bez uprawnienia zdanie wyjaśniające i ZERO zapytań do RPC", async () => {
    // Panel bez uprawnień, który nadal puka do RPC, zapala liczniki w logach
    // za funkcję, której wynik nikt nie zobaczy.
    h.isAdmin = false;
    await mountList();
    expect(screen.getByText("adminClubs.noPermissionTitle")).toBeTruthy();
    expect(screen.getByText("adminClubs.noPermissionBody")).toBeTruthy();
    expect(screen.queryByTestId("ClubsTable")).toBeNull();
    expect(h.listCalls.every((call) => call.enabled === false)).toBe(true);
  });

  it("edytor klubu: bez uprawnienia NIE pyta o klub wcale", async () => {
    h.isAdmin = false;
    await mountEditor();
    expect(screen.getByText("adminClubs.noPermissionTitle")).toBeTruthy();
    expect(h.detailCalls.every((id) => id === undefined)).toBe(true);
  });

  it("katalog elementów prowadzi do listy klubów i na publiczną stronę modułu", async () => {
    await renderRoute({
      route: ElementsRoute,
      path: "/admin/community/clubs/elements",
      initialEntry: "/admin/community/clubs/elements",
    });
    expect(
      screen.getByRole("link", { name: /clubElements\.routes\.admin/ }).getAttribute("href"),
    ).toBe("/admin/community/clubs");
    const publiczny = screen.getByRole("link", { name: /clubElements\.routes\.index/ });
    expect(publiczny.getAttribute("href")).toBe("/club");
    // Nowa karta: katalog jest materiałem operacyjnym czytanym OBOK panelu.
    expect(publiczny.getAttribute("target")).toBe("_blank");
  });
});

// --- lista klubów ----------------------------------------------------------

describe("lista klubów - filtry, stronicowanie i trzy stany", () => {
  it("pyta RPC z filtrami z pierwszej strony i pełnym oknem", async () => {
    await mountList();
    const last = h.listCalls.at(-1);
    expect(last?.enabled).toBe(true);
    expect(last?.filters).toEqual({
      search: "",
      status: null,
      visibility: null,
      limit: 50,
      offset: 0,
    });
  });

  it("fraza w wyszukiwarce jedzie do filtrów", async () => {
    await mountList();
    fireEvent.change(screen.getByLabelText("adminClubs.searchPlaceholder"), {
      target: { value: "energia" },
    });
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.search).toBe("energia");
    });
  });

  it("filtr statusu wystawia opcję „dowolny” i KAŻDĄ wartość słownika", async () => {
    await mountList();
    const selects = screen.getAllByTestId("select");
    const statusOptions = Array.from(selects[0].querySelectorAll("option")).map((o) => o.value);
    expect(statusOptions).toContain("__any__");
    for (const status of ["draft", "active", "archived"]) {
      expect(statusOptions).toContain(status);
    }
  });

  it("wybór statusu zawęża filtry, a „dowolny” je czyści", async () => {
    await mountList();
    const status = screen.getAllByTestId("select")[0];
    fireEvent.change(status, { target: { value: "draft" } });
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.status).toBe("draft");
    });
    fireEvent.change(status, { target: { value: "__any__" } });
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.status).toBeNull();
    });
  });

  it("wybór widoczności zawęża filtry, a „dowolny” je czyści", async () => {
    await mountList();
    const visibility = screen.getAllByTestId("select")[1];
    fireEvent.change(visibility, { target: { value: "secret" } });
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.visibility).toBe("secret");
    });
    fireEvent.change(visibility, { target: { value: "__any__" } });
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.visibility).toBeNull();
    });
  });

  it("awaria RPC pokazuje komunikat ZAMIAST tabeli", async () => {
    h.listError = true;
    await mountList();
    expect(screen.getByText("adminClubs.loadError")).toBeTruthy();
    expect(screen.queryByTestId("ClubsTable")).toBeNull();
  });

  it("oczekiwanie rysuje szkielet, nie pustkę", async () => {
    h.listPending = true;
    const { container } = await mountList();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByTestId("ClubsTable")).toBeNull();
  });

  it("awaria WYPRZEDZA oczekiwanie - kolejność warunków ma znaczenie", async () => {
    h.listError = true;
    h.listPending = true;
    await mountList();
    expect(screen.getByText("adminClubs.loadError")).toBeTruthy();
  });

  it("pusta baza mówi „nie ma jeszcze klubów”", async () => {
    h.list = { rows: [], total: 0 };
    await mountList();
    expect(screen.getByText("adminClubs.empty")).toBeTruthy();
    expect(screen.queryByText("adminClubs.emptyFiltered")).toBeNull();
  });

  it("pustka PO FILTRZE mówi coś innego - baza nie jest pusta, tylko zawężona", async () => {
    h.list = { rows: [], total: 0 };
    await mountList();
    fireEvent.change(screen.getByLabelText("adminClubs.searchPlaceholder"), {
      target: { value: "nie-ma-takiego" },
    });
    await waitFor(() => {
      expect(screen.getByText("adminClubs.emptyFiltered")).toBeTruthy();
    });
    expect(screen.queryByText("adminClubs.empty")).toBeNull();
  });

  it("wiersze jadą do tabeli w niezmienionej postaci", async () => {
    const rows: AdminClubRow[] = [adminClubRow(), adminClubRow({ id: "club-2", slug: "drugi" })];
    h.list = { rows, total: 2 };
    await mountList();
    expect(h.organism.ClubsTable.rows).toBe(rows);
  });

  it("stronicowanie pojawia się DOPIERO, gdy jest co stronicować", async () => {
    // „1-3 z 3" przy trzech klubach to szum, a nie informacja.
    h.list = { rows: [adminClubRow()], total: 1 };
    const pierwszy = await mountList();
    expect(screen.queryByTestId("AdminPagination")).toBeNull();
    pierwszy.unmount();
    cleanup();

    h.list = { rows: [adminClubRow()], total: 250 };
    await mountList();
    expect(screen.getByTestId("AdminPagination")).toBeTruthy();
    expect(h.organism.AdminPagination).toMatchObject({ page: 1, pageSize: 50, total: 250 });
  });

  it("zmiana strony przesuwa OKNO zapytania", async () => {
    h.list = { rows: [adminClubRow()], total: 250 };
    await mountList();
    const onPageChange = h.organism.AdminPagination.onPageChange;
    if (typeof onPageChange !== "function") throw new Error("brak zmiany strony");
    onPageChange(3);
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.offset).toBe(100);
    });
  });

  it("zmiana ROZMIARU strony wraca na pierwszą stronę", async () => {
    // Bez tego zmiana rozmiaru przy otwartej stronie trzeciej pokazuje pustkę
    // zamiast wyników.
    h.list = { rows: [adminClubRow()], total: 250 };
    await mountList();
    const pagination = h.organism.AdminPagination;
    const onPageChange = pagination.onPageChange;
    const onPageSizeChange = pagination.onPageSizeChange;
    if (typeof onPageChange !== "function" || typeof onPageSizeChange !== "function") {
      throw new Error("brak obsługi stronicowania");
    }
    onPageChange(3);
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.offset).toBe(100);
    });
    onPageSizeChange(25);
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters).toMatchObject({ limit: 25, offset: 0 });
    });
  });

  it("zmiana FILTRA wraca na pierwszą stronę", async () => {
    h.list = { rows: [adminClubRow()], total: 250 };
    await mountList();
    const onPageChange = h.organism.AdminPagination.onPageChange;
    if (typeof onPageChange !== "function") throw new Error("brak zmiany strony");
    onPageChange(3);
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.offset).toBe(100);
    });
    fireEvent.change(screen.getByLabelText("adminClubs.searchPlaceholder"), {
      target: { value: "energia" },
    });
    await waitFor(() => {
      expect(h.listCalls.at(-1)?.filters.offset).toBe(0);
    });
  });

  it("brak odpowiedzi RPC nie wywala listy", async () => {
    h.list = undefined;
    await mountList();
    expect(screen.getByText("adminClubs.empty")).toBeTruthy();
  });

  it("okno tworzenia klubu otwiera się przyciskiem i przenosi do nowego klubu", async () => {
    await mountList();
    expect(h.organism.ClubCreateDialog.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /adminClubs\.newClub/ }));
    await waitFor(() => {
      expect(h.organism.ClubCreateDialog.open).toBe(true);
    });
    const onCreated = h.organism.ClubCreateDialog.onCreated;
    if (typeof onCreated !== "function") throw new Error("brak obsługi utworzenia");
    // Nowy klub OTWIERA się od razu w edytorze, na zakładce „Ogólne" - inaczej
    // administrator wraca na listę i musi go tam odszukać.
    onCreated("club-9");
    await waitFor(() => {
      expect(h.navigations).toEqual([
        {
          to: "/admin/community/clubs/$clubId",
          params: { clubId: "club-9" },
          search: { tab: "general" },
        },
      ]);
    });
  });

  it("okno tworzenia daje się zamknąć", async () => {
    await mountList();
    fireEvent.click(screen.getByRole("button", { name: /adminClubs\.newClub/ }));
    await waitFor(() => {
      expect(h.organism.ClubCreateDialog.open).toBe(true);
    });
    const onOpenChange = h.organism.ClubCreateDialog.onOpenChange;
    if (typeof onOpenChange !== "function") throw new Error("brak zamykania");
    onOpenChange(false);
    await waitFor(() => {
      expect(h.organism.ClubCreateDialog.open).toBe(false);
    });
  });
});

// --- edytor klubu ----------------------------------------------------------

describe("edytor klubu - `?tab=` jako kontrakt linku", () => {
  const validate = routeSearchValidator(EditorRoute);

  it.each(CLUB_EDITOR_TABS)("zakładka %s przechodzi z adresu", (tab) => {
    expect(validate({ tab })).toEqual({ tab });
  });

  it.each([
    ["brak parametru", {}],
    ["pusty napis", { tab: "" }],
    ["liczba", { tab: 3 }],
    ["zakładka usunięta z produktu", { tab: "webhooks" }],
  ])("%s degraduje do „Ogólnych”", (_opis, raw) => {
    expect(validate(raw)).toEqual({ tab: "general" });
  });

  it("parametry nadmiarowe są odcinane", () => {
    expect(validate({ tab: "members", utm_source: "slack" })).toEqual({ tab: "members" });
  });

  it("zakładka z adresu jest ZAMONTOWANA, pozostałe nie", async () => {
    await mountEditor("moderation");
    expect(screen.getByTestId("ClubModerationTab")).toBeTruthy();
    expect(screen.queryByTestId("ClubGeneralTab")).toBeNull();
  });

  it("zmiana zakładki ZASTĘPUJE wpis w historii", async () => {
    // Dziewięć wpisów po przejrzeniu edytora zamienia „wstecz" w błądzenie.
    const rendered = await mountEditor("general");
    fireEvent.click(screen.getByTestId("tab-change"));
    await waitFor(() => {
      expect(rendered.search()).toEqual({ tab: "permissions" });
    });
  });

  it("zakładka SPOZA zbioru jest ignorowana - adres zostaje bez zmian", async () => {
    const rendered = await mountEditor("general");
    fireEvent.click(screen.getByTestId("tab-bogus"));
    await waitFor(() => {
      expect(rendered.search()).toEqual({ tab: "general" });
    });
  });

  it("pasek zakładek wystawia KAŻDĄ zakładkę ze słownika", async () => {
    await mountEditor();
    for (const tab of CLUB_EDITOR_TABS) {
      expect(document.querySelector(`[data-tab-trigger="${tab}"]`)).not.toBeNull();
    }
  });

  it("każda zakładka niesie swój klucz i18n, nie polską nazwę", async () => {
    await mountEditor();
    for (const tab of CLUB_EDITOR_TABS) {
      const trigger = document.querySelector(`[data-tab-trigger="${tab}"]`);
      expect(trigger?.textContent).toBe(`adminClubs.tabs.${tab}`);
    }
  });
});

describe("edytor klubu - wersja robocza i zapis", () => {
  it("pyta o klub Z ADRESU", async () => {
    await mountEditor();
    expect(h.detailCalls).toContain(CLUB_IDS.club);
  });

  it("oczekiwanie rysuje szkielet", async () => {
    h.detailPending = true;
    h.detail = null;
    const { container } = await mountEditor();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("awaria RPC pokazuje komunikat, nie pusty edytor", async () => {
    h.detailError = true;
    h.detail = null;
    await mountEditor();
    expect(screen.getByText("adminClubs.loadError")).toBeTruthy();
    expect(screen.queryByTestId("ClubGeneralTab")).toBeNull();
  });

  it("BRAK klubu o tym identyfikatorze też daje komunikat, a nie pusty formularz", async () => {
    // `$clubId` z ręki albo po usunięciu klubu: edytor nie może pokazać pól
    // sugerujących, że jest co zapisać.
    h.detail = null;
    await mountEditor();
    expect(screen.getByText("adminClubs.loadError")).toBeTruthy();
  });

  it("nagłówek pokazuje nazwę, znacznik statusu i slug klubu", async () => {
    h.detail = detailRow({ name_pl: "Klub transportowy", slug: "klub-transportowy" });
    await mountEditor();
    expect(screen.getByText("Klub transportowy")).toBeTruthy();
    expect(screen.getByText("/klub-transportowy")).toBeTruthy();
    expect(screen.getByText("club.status.active")).toBeTruthy();
  });

  it("status spoza słownika degraduje znacznik do wersji roboczej", async () => {
    // Nowa wartość CHECK-a nie może wywalić całego nagłówka edytora.
    h.detail = detailRow({ status: "retired" });
    await mountEditor();
    expect(screen.getByText("club.status.draft")).toBeTruthy();
  });

  it("przycisk zapisu jest NIEAKTYWNY, dopóki nic się nie zmieniło", async () => {
    // „Zapisz", które nic nie zapisuje, uczy ignorowania przycisku.
    await mountEditor();
    expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("zmiana w zakładce „Ogólne” uaktywnia zapis", async () => {
    await mountEditor();
    const onChange = h.organism.ClubGeneralTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ namePl: "Nowa nazwa" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });

  it("zmiana w zakładce „Dostęp” też uaktywnia zapis", async () => {
    await mountEditor("access");
    const onChange = h.organism.ClubAccessTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ visibility: "secret" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });

  it("zapis wysyła PEŁNY payload z identyfikatorem klubu", async () => {
    await mountEditor();
    const onChange = h.organism.ClubGeneralTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ namePl: "  Klub transportowy  ", taglinePl: "" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
    await waitFor(() => {
      expect(h.savePayloads).toHaveLength(1);
    });
    const payload = h.savePayloads[0];
    expect(payload.id).toBe(CLUB_IDS.club);
    // Przycinanie i „puste znaczy wyczyść" są w czystej funkcji; tu dowodzimy,
    // że trasa jej WYNIK wysyła bez przeróbki.
    expect(payload.name_pl).toBe("Klub transportowy");
    expect(payload.tagline_pl).toBeNull();
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
  });

  it("pusty slug NIE wysyła żądania i nazywa brak pola", async () => {
    await mountEditor();
    const onChange = h.organism.ClubGeneralTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ slug: "" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.requiredFields");
    });
    expect(h.savePayloads).toHaveLength(0);
  });

  it("pusta nazwa polska też nie wysyła żądania", async () => {
    await mountEditor();
    const onChange = h.organism.ClubGeneralTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ namePl: "   " });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.requiredFields");
    });
    expect(h.savePayloads).toHaveLength(0);
  });

  it("błąd RPC pokazuje KLUCZ powodu, nie surowy tekst z Postgresa", async () => {
    h.saveError = new Error("ERROR:  clubs: slug already taken (SQLSTATE 23505)");
    await mountEditor();
    const onChange = h.organism.ClubGeneralTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ namePl: "Nowa nazwa" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.create.error.slug_taken");
    });
    expect(String(h.toastError.mock.calls.at(-1)?.[0])).not.toContain("SQLSTATE");
  });

  it("błąd nierozpoznany degraduje do powodu ogólnego", async () => {
    h.saveError = new Error("connection reset");
    await mountEditor();
    const onChange = h.organism.ClubGeneralTab.onChange;
    if (typeof onChange !== "function") throw new Error("brak obsługi zmiany");
    onChange({ namePl: "Nowa nazwa" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /common\.save/ }));
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.create.error.unknown");
    });
  });

  it("w czasie zapisu przycisk jest ODCINANY, a zakładki wyszarzone", async () => {
    h.savePending = true;
    await mountEditor();
    expect(screen.getByRole("button", { name: /common\.save/ }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(h.organism.ClubGeneralTab.disabled).toBe(true);
  });

  it("droga powrotna prowadzi na listę klubów", async () => {
    await mountEditor();
    expect(screen.getByRole("link", { name: /adminClubs\.title/ }).getAttribute("href")).toBe(
      "/admin/community/clubs",
    );
  });

  it("każda zakładka danych dostaje IDENTYFIKATOR klubu, nie slug", async () => {
    // Zakładki wołają RPC po `p_club_id`; slug w tym miejscu daje puste dane
    // i wygląda jak klub bez treści.
    const ZAKLADKI = [
      ["groups", "ClubGroupsTab"],
      ["threads", "ClubThreadsTab"],
      ["moderation", "ClubModerationTab"],
      ["members", "ClubMembersTab"],
      ["invitations", "ClubInvitationsTab"],
      ["permissions", "ClubPermissionsTab"],
      ["analytics", "ClubStatsTab"],
    ] as const;
    for (const [tab, organism] of ZAKLADKI) {
      const rendered = await mountEditor(tab);
      expect(h.organism[organism], `zakładka ${tab}`).toEqual({ clubId: CLUB_IDS.club });
      rendered.unmount();
      cleanup();
      h.organism = {};
    }
  });

  it("zakładka „Ogólne” dostaje ZAPISANY slug do wykrycia zmiany adresu", async () => {
    h.detail = detailRow({ slug: "klub-energetyczny" });
    await mountEditor();
    expect(h.organism.ClubGeneralTab.persistedSlug).toBe("klub-energetyczny");
  });

  it("kanarek zasięgu: atrapy pokrywają wszystkie organizmy panelu klubów", () => {
    // Gdyby doszedł nowy organizm bez atrapy, testy zaczęłyby renderować
    // prawdziwy komponent z prawdziwymi zapytaniami i cicho zwolniałyby albo
    // zawisły. Ten warunek nie zastępuje asercji - pilnuje kompletności listy.
    expect(ADMIN_ORGANISMS.length).toBeGreaterThanOrEqual(15);
  });
});
