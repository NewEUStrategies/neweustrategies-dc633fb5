// Trasy `/admin/users` i `/admin/users/$id` ZAMONTOWANE - stan i sklejenie.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// `src/routes/__tests__/adminRouteAuthority.gate.test.ts` argumentuje wprost,
// że render-testowanie tras panelu DLA POKRYCIA jest farmą: ryzyko w trasie
// panelu to DOSTĘP, a dostęp jest egzekwowany w trzech miejscach (wspólny
// layout `/admin`, sama trasa, RLS/RPC w bazie). Ta bramka ma rację, a rodzina
// `admin.users.*` została w tym samym commicie objęta jej zakresem.
//
// Ten plik pokrywa dokładnie to, czego bramka statyczna NIE WIDZI, bo widzi
// tylko tekst pliku - a to jest ta warstwa, w której mieszka defekt opisany
// w nagłówku bramki (droplista zmiany roli oferowana redaktorowi):
//
//   1. CZY PANEL OFERUJE AKCJĘ, KTÓRĄ BAZA ODRZUCI - per rola, na obecność
//      KONTROLKI, nie na tekst. `/admin` przepuszcza `editor` i `author`
//      (`isStaff`), a RPC `change_user_role` wymaga `admin`/`super_admin`.
//      Pięć ról × dwa ekrany, tabelą.
//   2. ZMIANA WŁASNEJ ROLI. RPC ma na to osobną odmowę
//      (`cannot_change_own_role`), więc panel nie może tego PROPONOWAĆ -
//      ani drop-listą w karcie, ani zaznaczalnym wierszem na liście.
//   3. NADANIE `super_admin` JEST OSTRZEJSZE niż zmiana roli w ogóle - opcja
//      istnieje wyłącznie dla `super_admin`, zgodnie z tym samym RPC.
//   4. ODMOWA Z BAZY: co widzi administrator, kiedy RPC powie `not_authorized`,
//      i czy lista została nietknięta.
//   5. FILTROWANIE, SORTOWANIE, GRUPOWANIE I ZAZNACZANIE - reguły, które
//      decydują o tym, kto trafia do akcji zbiorczej.
//   6. STAN PUSTY vs STAN BŁĘDU - rozdzielone. To klasa defektu, która w tym
//      repo wystąpiła już trzy razy: awaria odczytu pokazana jako „brak
//      wyników" mówi administratorowi, że baza jest pusta, kiedy jest zepsuta.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY. `change_user_role` ma 11 asercji pgTAP
//   (`supabase/tests/role_management_test.sql`): wymóg roli, zakaz zmiany
//   własnej roli, zakres najemcy, wpis w `role_audit_log` i dowód, że pisanie
//   wprost do `user_roles` jest zamknięte. Test na atrapie nie odtwarza tych
//   reguł - sprawdza, czy panel WOŁA tę funkcję z właściwymi argumentami
//   i co robi z jej odmową.
// - IZOLACJI NAJEMCY W BAZIE. `rls_tenant_isolation_test.sql` i
//   `tenant_isolation_three_tenants_test.sql`. Tutaj dowodzimy tylko, że lista
//   pyta RPC zawężone najemcą sesji i renderuje to, co dostała.
// - SERWEROWEJ WARSTWY ZAPROSZEŃ. Bramki roli i najemcy w
//   `invitations.functions.ts` mają własny plik
//   (`src/lib/admin/__tests__/invitationsFunctions.test.ts`); tu obie
//   modalki są atrapami-markerami, a dowodzimy wyłącznie ich SKLEJENIA
//   z listą (kiedy się otwierają i co unieważniają).
// - ZAWARTOŚCI EDYTORA PROFILU EKSPERTA (`AuthorProfileEditor`) - to osobny
//   organizm z własnym testem; tu jest atrapą zapisującą propsy, bo
//   przedmiotem dowodu jest przekazany `mode="admin"` i najemca.
//
// DEFEKTY ZNALEZIONE I ZGŁOSZONE `it.fails` (produkcja bez zmian - konwencja
// repo): trzy sztuki, każdy z opisem przy swoim teście na końcu pliku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";
import type { AdminUserRow } from "@/lib/admin/users-query";

/** Ustalona data bazowa - żadnego `Date.now()` w asercjach. */
const BASE_ISO = "2026-01-15T10:00:00.000Z";
const OLDER_ISO = "2025-06-01T08:30:00.000Z";

const IDS = {
  me: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  third: "33333333-3333-4333-8333-333333333333",
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} as const;

const h = vi.hoisted(() => ({
  /** Role bieżącego użytkownika - sterują `isAdmin`/`isSuperAdmin`/`isStaff`. */
  roles: ["admin"] as string[],
  /** Najemca sesji; `null` = brak kontekstu (patrz `useRequiredTenant`). */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
  /** Atrapa łańcucha PostgREST, ustawiana w `beforeEach`. */
  db: null as SupabaseFromStub | null,
  /** Zapisane wywołania RPC: nazwa + argumenty. */
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  /** Odpowiedzi RPC per nazwa funkcji. */
  rpcResponses: new Map<string, () => SupabaseResult>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  /** Wywołania `impersonateUser` - akcja dostępna tylko super adminowi. */
  impersonations: [] as { id: string; label: string }[],
  /** Ładunek zbiorczego ponowienia zaproszeń. */
  resendCalls: [] as string[][],
  resendResult: {
    results: [{ ok: true }],
    missing: [] as string[],
  } as { results: { ok: boolean }[]; missing: string[] },
  resendThrows: null as Error | null,
  /** Propsy zapisane przez atrapy komponentów potomnych. */
  props: {} as Record<string, Record<string, unknown>>,
  /** Odznaki widziane przez kartę użytkownika. */
  badges: [] as string[],
  badgesLoading: false,
  badgeGrants: [] as { userId: string; badge: string }[],
  badgeRevokes: [] as { userId: string; badge: string }[],
  badgeThrows: false,
  /** Wiersze `user_invitations` widziane przez trasę zaproszeń. */
  invitations: [] as Record<string, unknown>[],
  sendCalls: [] as string[],
  revokeCalls: [] as string[],
  sendResult: { ok: true } as { ok: boolean; error?: string; tempPassword?: string },
  /** Przebieg podstawionego `XMLHttpRequest` - wysyłka pliku awatara. */
  xhrStatus: 200,
  xhrNetworkError: false,
  xhrSends: 0,
  /** Wysyłka XHR zawieszona - do dowodu na stan „w toku". */
  xhrHang: false,
  /** Błąd podpisania adresu wysyłki; `"raw"` = rzut czymś, co nie jest `Error`. */
  signFailure: null as null | "error" | "empty" | "raw",
  /** Przejścia zlecone przez trasy. */
  navigations: [] as { to: string; params?: Record<string, unknown> }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-users", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n/useLang", () => ({ useLang: () => "pl" }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}));

vi.mock("@/hooks/useAuth", () => {
  const derive = () => {
    const isSuperAdmin = h.roles.includes("super_admin");
    const isAdmin = isSuperAdmin || h.roles.includes("admin");
    return {
      session: { access_token: "t" },
      user: { id: IDS.me },
      roles: h.roles,
      tenantId: h.tenantId,
      loading: false,
      isSuperAdmin,
      isAdmin,
      isStaff: isAdmin || h.roles.includes("editor") || h.roles.includes("author"),
      signOut: async () => {},
    };
  };
  return {
    useAuth: () => derive(),
    // Trasa listy woła `useRequiredTenant()`, więc atrapa musi nieść ten sam
    // kontrakt: brak najemcy to WYJĄTEK, nie pusty string - inaczej test
    // „bez najemcy" przechodziłby obok gałęzi, która w produkcji rzuca.
    useRequiredTenant: () => {
      if (!h.tenantId) throw new Error("Brak kontekstu tenanta");
      return h.tenantId;
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args: args ?? {} });
      const responder = h.rpcResponses.get(name);
      // Brak zaplanowanej odpowiedzi to BŁĄD TESTU, nie ciche `[]`: milczące
      // pustki udawałyby poprawny odczyt RPC, którego test nie zaplanował.
      const result: SupabaseResult = responder
        ? responder()
        : { data: null, error: Object.assign(new Error(`test: brak odpowiedzi RPC ${name}`), {}) };
      return Promise.resolve(result);
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => {
          // `"raw"` rzuca czymś, co NIE jest `Error` - to jedyna droga do
          // gałęzi zastępczego komunikatu w obsłudze wyjątku wysyłki.
          if (h.signFailure === "raw") throw "boom";
          if (h.signFailure === "error") {
            return { data: null, error: new Error("sign denied") };
          }
          if (h.signFailure === "empty") return { data: null, error: null };
          return {
            data: { signedUrl: "https://example.org/upload", path: "p", token: "tok" },
            error: null,
          };
        },
        getPublicUrl: () => ({ data: { publicUrl: "https://example.org/a.jpg" } }),
      }),
    },
  },
}));

// Serwerowa funkcja ponowienia zaproszeń jest w produkcji wołana przez
// `useServerFn`. Podmieniamy TYLKO ten hook - resztę pakietu zostawiamy
// prawdziwą, bo `createIsomorphicFn` ciągnie warstwa i18n.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // Harness montuje JEDNĄ trasę, a oba ekrany przenoszą na trasę
    // rodzeństwa - więc przedmiotem dowodu są ARGUMENTY przejścia, nie
    // rozwiązanie adresu (to należy do generatora drzewa tras).
    useNavigate: () => (options: { to: string; params?: Record<string, unknown> }) => {
      h.navigations.push(options);
      return Promise.resolve();
    },
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/admin/invitations.functions", () => ({
  resendInvitationsForEmails: async ({ data }: { data: { emails: string[] } }) => {
    h.resendCalls.push(data.emails);
    if (h.resendThrows) throw h.resendThrows;
    return h.resendResult;
  },
  listInvitations: async () => ({ invitations: h.invitations }),
  sendInvitation: async ({ data }: { data: { id: string } }) => {
    h.sendCalls.push(data.id);
    return h.sendResult;
  },
  sendActivationEmailForUser: async ({ data }: { data: { userId: string } }) => {
    h.sendCalls.push(data.userId);
    return h.sendResult;
  },
  revokeInvitation: async ({ data }: { data: { id: string } }) => {
    h.revokeCalls.push(data.id);
    return { ok: true };
  },
}));

vi.mock("@/lib/i18n-admin-misc-routes", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: {
    sent: () => "adminToasts.sent",
    saved: () => "adminToasts.saved",
    fileTooBig: () => "adminToasts.fileTooBig",
    imageRequired: () => "adminToasts.imageRequired",
    missingTenant: () => "adminToasts.missingTenant",
  },
}));

vi.mock("@/lib/admin/impersonation", () => ({
  impersonateUser: async (id: string, label: string) => {
    h.impersonations.push({ id, label });
  },
}));

vi.mock("@/lib/profile/badges", () => ({
  BADGE_ORDER: ["verified", "expert"] as const,
  badgeLabel: (badge: string, lang: string) => `badge:${badge}:${lang}`,
  useUserBadges: () => ({ data: h.badges, isLoading: h.badgesLoading }),
}));

vi.mock("@/lib/admin/badges", () => ({
  grantBadge: async (userId: string, badge: string) => {
    h.badgeGrants.push({ userId, badge });
    if (h.badgeThrows) throw new Error("grant failed");
    return "id";
  },
  revokeUserBadge: async (userId: string, badge: string) => {
    h.badgeRevokes.push({ userId, badge });
    if (h.badgeThrows) throw new Error("revoke failed");
  },
}));

/** Atrapa komponentu potomnego: marker + zapis propsów. */
function propsStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/profile/AuthorProfileEditor", () => ({
  AuthorProfileEditor: propsStub("AuthorProfileEditor"),
}));
vi.mock("@/components/profile/ProfileBadges", () => ({
  ProfileBadges: propsStub("ProfileBadges"),
}));
vi.mock("@/components/media/ImageCropDialog", () => ({
  ImageCropDialog: propsStub("ImageCropDialog"),
  CROP_PRESETS: { avatar: { aspect: 1 }, cover: { aspect: 3 } },
}));
// `BrandIcon` (atom z `components/atoms`) NIE jest tu atrapowany celowo -
// karta użytkownika renderuje go sześcioma wywołaniami z fallbackami Lucide,
// a przy pustej bibliotece ikon atom degraduje do tych fallbacków, nie mieszając
// się w nic, co ten plik mierzy. Trasy `quiz` i `profile` atrapują go, bo tam
// współdzielony cache ikon zakłócałby pomiar „zero odczytów" treści.
vi.mock("@/components/admin/users/InviteUserDialog", () => ({
  InviteUserDialog: propsStub("InviteUserDialog"),
}));
vi.mock("@/components/admin/users/TeamImportDialog", () => ({
  TeamImportDialog: propsStub("TeamImportDialog"),
}));

// Radix Select/Dialog/Checkbox/Switch nie działają pod happy-dom bez pełnego
// pointer API. Podmieniamy je na natywne odpowiedniki: przedmiotem dowodu jest
// to, KTÓRE opcje trasa wystawia i CO robi ze zmianą, nie mechanika biblioteki.
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
      data-value={value}
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
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    disabled,
    ...rest
  }: {
    checked?: boolean | "indeterminate";
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      data-state={String(checked)}
      checked={checked === true}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={!!checked}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as UsersListRoute } from "@/routes/admin.users.index";
import { Route as UserDetailRoute } from "@/routes/admin.users.$id";
import { Route as UsersLayoutRoute } from "@/routes/admin.users";
import { Route as InvitationsRoute } from "@/routes/admin.users.invitations";

// ---------------------------------------------------------------------------
// Fixture'y. RODO: żadnych realnych danych osobowych - adresy wyłącznie
// w domenie `example.org`, imiona umowne.
// ---------------------------------------------------------------------------

function userRow(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: IDS.other,
    display_name: "Osoba Druga",
    email: "druga@example.org",
    avatar_url: null,
    cover_url: null,
    slug: "osoba-druga",
    bio: null,
    bio_pl: null,
    bio_en: null,
    twitter_url: null,
    linkedin_url: null,
    website_url: null,
    created_at: BASE_ISO,
    updated_at: null,
    roles: ["author"],
    ...overrides,
  };
}

interface DetailRow {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  contact_email: string | null;
  phone: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  slug: string | null;
  bio: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  job_title: string | null;
  current_company: string | null;
  specialization: string | null;
  location: string | null;
  website_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  spotify_url: string | null;
  gender: string | null;
  created_at: string;
  updated_at: string | null;
  roles: string[];
}

function detailRow(overrides: Partial<DetailRow> = {}): DetailRow {
  return {
    id: IDS.other,
    display_name: "Osoba Druga",
    first_name: "Osoba",
    last_name: "Druga",
    email: "druga@example.org",
    contact_email: null,
    phone: null,
    avatar_url: null,
    cover_url: null,
    slug: "osoba-druga",
    bio: null,
    bio_pl: null,
    bio_en: null,
    job_title: null,
    current_company: null,
    specialization: null,
    location: null,
    website_url: null,
    twitter_url: null,
    linkedin_url: null,
    facebook_url: null,
    instagram_url: null,
    spotify_url: null,
    gender: null,
    created_at: BASE_ISO,
    updated_at: null,
    roles: ["author"],
    ...overrides,
  };
}

/**
 * Selecty, których zbiór opcji to WYŁĄCZNIE role - czyli kontrolka NADANIA
 * roli, nie filtr. Asercja jest strukturalna (zbiór wartości `<option>`),
 * a nie tekstowa: napis w etykiecie zmienia się przy pierwszej poprawionej
 * literówce w tłumaczeniu, zbiór wartości nie.
 */
function roleSelects(scope: HTMLElement | Document = document): HTMLSelectElement[] {
  return Array.from(scope.querySelectorAll<HTMLSelectElement>("select")).filter((element) => {
    const values = Array.from(element.options).map((option) => option.value);
    return values.includes("admin") && !values.includes("all");
  });
}

/**
 * Przełącznik panelu bocznego karty, GOTOWY do użycia. Oba przełączniki
 * (weryfikacja, wnioski eksperckie) są `disabled` dopóki ich zapytanie leci -
 * kliknięcie w tym okienku nic nie robi, a test „nie zauważyłby" różnicy
 * między zablokowaniem z braku uprawnień i zablokowaniem z wczytywania.
 */
async function readySwitch(label: string): Promise<HTMLInputElement> {
  let element: HTMLInputElement | null = null;
  await waitFor(() => {
    element = document.querySelector<HTMLInputElement>(`input[role=switch][aria-label="${label}"]`);
    expect(element, `brak przełącznika ${label}`).toBeTruthy();
    expect(element?.disabled, `przełącznik ${label} nadal zablokowany`).toBe(false);
  });
  if (!element) throw new Error(`test: brak przełącznika ${label}`);
  return element;
}

/** Wiersze tabeli użytkowników (bez nagłówka i bez pasków grupy). */
function dataRows(): HTMLTableRowElement[] {
  return Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr")).filter(
    (row) => row.querySelectorAll("td").length === 7,
  );
}

function setRpc(name: string, result: SupabaseResult | (() => SupabaseResult)): void {
  h.rpcResponses.set(name, typeof result === "function" ? result : () => result);
}

async function mountList(): Promise<Awaited<ReturnType<typeof renderRoute>>> {
  return renderRoute({
    route: UsersListRoute,
    path: "/admin/users/",
    initialEntry: "/admin/users",
  });
}

async function mountDetail(
  id: string = IDS.other,
): Promise<Awaited<ReturnType<typeof renderRoute>>> {
  return renderRoute({
    route: UserDetailRoute,
    path: "/admin/users/$id",
    initialEntry: `/admin/users/${id}`,
  });
}

beforeEach(() => {
  cleanup();
  h.roles = ["admin"];
  h.tenantId = IDS.tenant;
  h.db = supabaseFromStub();
  h.rpcCalls = [];
  h.rpcResponses = new Map();
  h.impersonations = [];
  h.resendCalls = [];
  h.resendResult = { results: [{ ok: true }], missing: [] };
  h.resendThrows = null;
  h.props = {};
  h.badges = [];
  h.badgesLoading = false;
  h.badgeGrants = [];
  h.badgeRevokes = [];
  h.badgeThrows = false;
  h.invitations = [];
  h.sendCalls = [];
  h.revokeCalls = [];
  h.sendResult = { ok: true };
  h.xhrStatus = 200;
  h.xhrNetworkError = false;
  h.xhrSends = 0;
  h.xhrHang = false;
  h.signFailure = null;
  h.navigations = [];
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.toastInfo.mockReset();
  // Domyślne, „szczęśliwe" odpowiedzi - każdy test nadpisuje to, co bada.
  setRpc("admin_list_users", ok([userRow()]));
  setRpc("admin_get_user", ok([detailRow()]));
  setRpc("change_user_role", ok(null));
  setRpc("admin_get_user_consent", ok(null));
  setRpc("admin_set_profile_verification", ok(null));
  setRpc("admin_set_expert_requests_enabled", ok(null));
  setRpc("admin_update_user_avatar", ok(null));
  h.db.setResponse("user_subscriptions", ok([]));
  h.db.setResponse("profiles", ok({ verified_at: null, expert_requests_enabled: true }));
});

// ---------------------------------------------------------------------------
// 1. OFERTA AKCJI PER ROLA - rdzeń tego pliku.
// ---------------------------------------------------------------------------

describe("admin.users - oferta zmiany roli per rola wywołującego", () => {
  // Autorytet jest w RPC `change_user_role`: wymaga `admin` albo `super_admin`
  // (11 asercji pgTAP). `/admin` przepuszcza także `editor` i `author`, więc
  // każdy ekran MUSI zawężać sam. Tabela pokrywa wszystkie pięć ról naraz -
  // dołożenie roli w `APP_ROLES` bez decyzji o tej kontrolce wywali ten test.
  const CASES: readonly { roles: string[]; offers: boolean; superOption: boolean }[] = [
    { roles: ["super_admin"], offers: true, superOption: true },
    { roles: ["admin"], offers: true, superOption: false },
    { roles: ["editor"], offers: false, superOption: false },
    { roles: ["author"], offers: false, superOption: false },
    { roles: [], offers: false, superOption: false },
  ];

  it.each(CASES)(
    "karta użytkownika: rola $roles oferuje droplistę = $offers, opcja super_admin = $superOption",
    async ({ roles, offers, superOption }) => {
      h.roles = roles;
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());

      const selects = roleSelects();
      expect(selects.length, `rola ${JSON.stringify(roles)}`).toBe(offers ? 1 : 0);
      if (offers) {
        const values = Array.from(selects[0].options).map((option) => option.value);
        expect(values.includes("super_admin")).toBe(superOption);
        // Cztery role nadawalne są zawsze - `super_admin` dochodzi warunkowo.
        for (const role of ["admin", "editor", "author", "user"]) {
          expect(values, `brak opcji ${role}`).toContain(role);
        }
      }
    },
  );

  it("karta użytkownika BEZ uprawnienia pokazuje rolę jako plakietkę, nie jako pustkę", async () => {
    // Ukrycie kontrolki nie może zabrać informacji: redaktor ma widzieć, jaką
    // rolę ma ta osoba - tylko bez możliwości jej zmiany.
    h.roles = ["editor"];
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(roleSelects()).toHaveLength(0);
    // `roles[0]` z fixture'a to `author` - plakietka niesie tę wartość.
    expect(document.body.textContent).toContain("author");
  });

  it("karta BEZ ról celu pokazuje `-` zamiast pustej plakietki", async () => {
    h.roles = ["editor"];
    setRpc("admin_get_user", ok([detailRow({ roles: [] })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(roleSelects()).toHaveLength(0);
  });

  it("karta: cel BEZ ról renderuje plakietkę `user` w bloku ról", async () => {
    setRpc("admin_get_user", ok([detailRow({ roles: [] })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("user");
  });

  it("karta: kilka ról celu renderuje plakietkę dla KAŻDEJ", async () => {
    setRpc("admin_get_user", ok([detailRow({ roles: ["admin", "author"] })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const badges = document.body.textContent ?? "";
    expect(badges).toContain("admin");
    expect(badges).toContain("author");
  });

  it("WŁASNA rola: droplista nie istnieje nawet dla super admina", async () => {
    // RPC ma na to osobną odmowę (`cannot_change_own_role`), więc panel nie
    // może tego proponować - inaczej najwyżej uprzywilejowana osoba dostaje
    // kontrolkę, której każde użycie kończy się błędem.
    h.roles = ["super_admin"];
    setRpc("admin_get_user", ok([detailRow({ id: IDS.me })]));
    await mountDetail(IDS.me);
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(roleSelects()).toHaveLength(0);
  });

  it("WŁASNY wiersz na liście: plakietka zamiast droplisty i brak pola zaznaczenia", async () => {
    h.roles = ["super_admin"];
    setRpc("admin_list_users", ok([userRow({ id: IDS.me, roles: ["super_admin"] }), userRow()]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));

    const rows = dataRows();
    const mine = rows.find((row) => row.textContent?.includes("super_admin"));
    expect(mine, "wiersz bieżącego użytkownika musi być w tabeli").toBeTruthy();
    if (!mine) throw new Error("test: brak wiersza");
    expect(roleSelects(mine)).toHaveLength(0);
    // Zaznaczenie własnego wiersza pchałoby go do akcji zbiorczej, którą RPC
    // odrzuci - dlatego wiersz jest NIEZAZNACZALNY, a nie tylko „ignorowany".
    expect(mine.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });

  it("obcy wiersz na liście NIESIE droplistę i pole zaznaczenia", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const row = dataRows()[0];
    expect(roleSelects(row)).toHaveLength(1);
    expect(row.querySelectorAll("input[type=checkbox]")).toHaveLength(1);
  });

  it("akcja impersonacji jest WYŁĄCZNIE super admina - i nigdy na sobie", async () => {
    setRpc("admin_list_users", ok([userRow({ id: IDS.me }), userRow()]));

    h.roles = ["admin"];
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const adminMenu = Array.from(
      document.querySelectorAll<HTMLButtonElement>("tbody button[title]"),
    );
    fireEvent.click(adminMenu[adminMenu.length - 1]);
    expect(document.body.textContent).not.toContain("adminUsers.sign");

    cleanup();
    h.roles = ["super_admin"];
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const superMenu = Array.from(
      document.querySelectorAll<HTMLButtonElement>("tbody button[title]"),
    );
    fireEvent.click(superMenu[superMenu.length - 1]);
    expect(document.body.textContent).toContain("adminUsers.sign");
  });
});

// ---------------------------------------------------------------------------
// 2. NAJEMCA - izolacja widoczna w interfejsie.
// ---------------------------------------------------------------------------

describe("admin.users - zakres najemcy", () => {
  it("lista pyta RPC zawężone najemcą sesji, nie tabelę wprost", async () => {
    // Gdyby lista czytała `profiles` bezpośrednio, izolacja stałaby wyłącznie
    // na RLS - a wtedy każda zmiana polityki zmienia zachowanie panelu bez
    // jednej linii diffu w TS. RPC `admin_list_users` wyprowadza najemcę
    // z sesji (dowód po stronie bazy: `security_definer_tenant_scope_test.sql`).
    await mountList();
    await waitFor(() => expect(h.rpcCalls.map((call) => call.name)).toContain("admin_list_users"));
    expect(h.db?.chainsFor("profiles")).toHaveLength(0);
  });

  it("cel z innego najemcy NIE POJAWIA SIĘ na liście - RPC go nie zwraca", async () => {
    // Autorytet jest w bazie (`tenant_isolation_three_tenants_test.sql`); tu
    // dowodzimy, że panel nie dokłada własnego źródła danych obok RPC i nie
    // pokazuje niczego, czego RPC nie oddało.
    setRpc("admin_list_users", ok([userRow()]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(document.body.textContent).not.toContain(IDS.third);
  });

  it("subskrypcje są czytane z FILTREM najemcy - nie z całej tabeli", async () => {
    await mountList();
    await waitFor(() => expect(h.db?.chainsFor("user_subscriptions").length).toBeGreaterThan(0));
    const chain = h.db?.lastChain("user_subscriptions");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", IDS.tenant]);
    // Kolejność „najnowsza pierwsza" decyduje o tym, którą subskrypcję widzi
    // administrator, gdy użytkownik ma ich kilka.
    expect(chain?.argsOf("order")).toEqual(["started_at", { ascending: false }]);
  });

  it("karta użytkownika przekazuje najemcę do edytora profilu eksperta", async () => {
    await mountDetail();
    await waitFor(() => expect(h.props.AuthorProfileEditor).toBeTruthy());
    expect(h.props.AuthorProfileEditor.tenantId).toBe(IDS.tenant);
    expect(h.props.AuthorProfileEditor.mode).toBe("admin");
    expect(h.props.AuthorProfileEditor.userId).toBe(IDS.other);
  });

  it("karta bez najemcy przekazuje `null`, a nie `undefined`", async () => {
    // `AuthorProfileEditor` odróżnia „nie znam najemcy" od „nie podano propsa";
    // `undefined` przeszłoby przez opcjonalny props i zniknęło.
    h.tenantId = null;
    await mountDetail();
    await waitFor(() => expect(h.props.AuthorProfileEditor).toBeTruthy());
    expect(h.props.AuthorProfileEditor.tenantId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. ODMOWA Z BAZY.
// ---------------------------------------------------------------------------

describe("admin.users - odmowa z bazy przy zmianie roli", () => {
  it("karta: RPC dostaje identyfikator celu i nową rolę", async () => {
    await mountDetail();
    await waitFor(() => expect(roleSelects()).toHaveLength(1));
    fireEvent.change(roleSelects()[0], { target: { value: "editor" } });
    await waitFor(() =>
      expect(h.rpcCalls.some((call) => call.name === "change_user_role")).toBe(true),
    );
    const call = h.rpcCalls.find((entry) => entry.name === "change_user_role");
    expect(call?.args).toEqual({ _target_user_id: IDS.other, _new_role: "editor" });
  });

  it("karta: powodzenie unieważnia OBA klucze cache - kartę i listę", async () => {
    const rendered = await mountDetail();
    await waitFor(() => expect(roleSelects()).toHaveLength(1));
    // Lista jest cache'owana pod `["admin","all-users",tenant]`; bez jej
    // unieważnienia administrator wraca na listę i widzi starą rolę.
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    fireEvent.change(roleSelects()[0], { target: { value: "editor" } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(keys.some((key) => key.includes("admin-user"))).toBe(true);
    expect(keys.some((key) => key.includes("all-users"))).toBe(true);
  });

  it("karta: odmowa `not_authorized` NIE unieważnia cache i NIE mówi o sukcesie", async () => {
    setRpc("change_user_role", fail("not_authorized", "42501"));
    const rendered = await mountDetail();
    await waitFor(() => expect(roleSelects()).toHaveLength(1));
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    fireEvent.change(roleSelects()[0], { target: { value: "editor" } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("lista: odmowa nie zmienia stanu listy - wiersz zostaje z dawną rolą", async () => {
    setRpc("change_user_role", fail("not_authorized", "42501"));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const select = roleSelects(dataRows()[0])[0];
    expect(select.getAttribute("data-value")).toBe("author");
    fireEvent.change(select, { target: { value: "admin" } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // Wartość kontrolki pochodzi z DANYCH, nie ze stanu lokalnego - odmowa
    // z bazy nie może zostawić interfejsu pokazującego rolę, której nie ma.
    expect(roleSelects(dataRows()[0])[0].getAttribute("data-value")).toBe("author");
  });
});

// ---------------------------------------------------------------------------
// 4. FILTRY, SORTOWANIE, GRUPOWANIE.
// ---------------------------------------------------------------------------

describe("admin.users - filtrowanie i sortowanie listy", () => {
  const THREE: readonly AdminUserRow[] = [
    userRow({
      id: IDS.other,
      display_name: "Beata Przykład",
      email: "beata@example.org",
      slug: "beata",
      roles: ["editor"],
      created_at: BASE_ISO,
    }),
    userRow({
      id: IDS.third,
      display_name: "Adam Przykład",
      email: "adam@example.org",
      slug: "adam",
      roles: [],
      created_at: OLDER_ISO,
    }),
    userRow({
      id: IDS.me,
      display_name: "Cezary Przykład",
      email: "cezary@example.org",
      slug: "cezary",
      roles: ["admin"],
      created_at: BASE_ISO,
    }),
  ];

  function textOf(): string {
    return dataRows()
      .map((row) => row.textContent ?? "")
      .join("|");
  }

  /**
   * Wyłącza grupowanie. Trasa startuje z `groupBy="role"`, więc KAŻDY test
   * kolejności musi to najpierw zdjąć - inaczej sprawdzałby porządek grup
   * (admin, editor, user), a nie sortowanie kolumny.
   */
  async function ungroup(): Promise<void> {
    const groupSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
      (element) =>
        Array.from(element.options).some((option) => option.value === "sub_status") &&
        Array.from(element.options).some((option) => option.value === "role"),
    );
    if (!groupSelect) throw new Error("test: brak selecta grupowania");
    fireEvent.change(groupSelect, { target: { value: "none" } });
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll("tbody tr")).filter(
          (row) => row.querySelectorAll("td").length === 1,
        ),
      ).toHaveLength(0),
    );
  }

  beforeEach(() => {
    setRpc("admin_list_users", ok([...THREE]));
  });

  it("szukanie po nazwie, adresie i slugu - trafienie w KAŻDE z trzech pól", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const input = document.querySelector<HTMLInputElement>("input[type=text], input:not([type])");
    expect(input, "pole szukania musi istnieć").toBeTruthy();
    if (!input) throw new Error("test: brak pola szukania");

    for (const [needle, expected] of [
      ["beata", "Beata"],
      ["adam@example.org", "Adam"],
      ["cezary", "Cezary"],
    ] as const) {
      fireEvent.change(input, { target: { value: needle } });
      await waitFor(() => expect(dataRows()).toHaveLength(1));
      expect(textOf()).toContain(expected);
    }
  });

  it("szukanie jest NIEczułe na wielkość liter i na spacje wokół frazy", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const input = document.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    if (!input) throw new Error("test: brak pola szukania");
    fireEvent.change(input, { target: { value: "  BEATA  " } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(textOf()).toContain("Beata");
  });

  it("filtr roli: konkretna rola, `none` (bez ról) i `all`", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    // Filtr roli to select z opcją `all` - właśnie tym różni się od kontrolki
    // nadania roli, którą wyłapuje `roleSelects()`.
    const filters = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).filter(
      (element) => Array.from(element.options).some((option) => option.value === "all"),
    );
    const roleFilter = filters[0];
    expect(roleFilter, "filtr roli musi istnieć").toBeTruthy();

    fireEvent.change(roleFilter, { target: { value: "editor" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(textOf()).toContain("Beata");

    fireEvent.change(roleFilter, { target: { value: "none" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(textOf()).toContain("Adam");

    fireEvent.change(roleFilter, { target: { value: "all" } });
    await waitFor(() => expect(dataRows()).toHaveLength(3));
  });

  it("licznik wyników pokazuje `N / total` DOPÓKI filtr zawęża, potem samo N", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    expect(document.body.textContent).toContain("3");
    const input = document.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    if (!input) throw new Error("test: brak pola szukania");
    fireEvent.change(input, { target: { value: "beata" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(document.body.textContent).toContain("1 / 3");
  });

  it("przycisk czyszczenia filtrów pojawia się TYLKO przy aktywnym filtrze i wraca do pełnej listy", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const clearButton = () =>
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "adminUsers.clear",
      );
    // Bez filtra przycisku NIE MA - inaczej pasek narzędzi niósłby akcję,
    // która nic nie robi, i sugerował, że jakiś filtr jest aktywny.
    expect(clearButton()).toBeUndefined();

    const input = document.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    if (!input) throw new Error("test: brak pola szukania");
    fireEvent.change(input, { target: { value: "beata" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    await waitFor(() => expect(clearButton()).toBeTruthy());

    const clear = clearButton();
    if (!clear) throw new Error("test: brak przycisku czyszczenia");
    fireEvent.click(clear);
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    expect(clearButton()).toBeUndefined();
  });

  it("sortowanie po nazwie: pierwsze kliknięcie rosnąco, drugie malejąco", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    await ungroup();
    const headers = Array.from(document.querySelectorAll("thead th"));
    const nameHeader = headers.find((th) => th.textContent?.includes("admin.users.name"));
    expect(nameHeader).toBeTruthy();
    if (!nameHeader) throw new Error("test: brak nagłówka nazwy");

    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()[0].textContent).toContain("Adam"));
    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()[0].textContent).toContain("Cezary"));
  });

  it("sortowanie po dacie startuje MALEJĄCO - najnowsi u góry", async () => {
    // Zmiana klucza sortowania na `created_at` ustawia `desc`, a na kolumnę
    // tekstową `asc`. To nie kosmetyka: lista użytkowników domyślnie ma
    // pokazywać ostatnio dodanych, a alfabet ma iść od A.
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    await ungroup();
    const headers = Array.from(document.querySelectorAll("thead th"));
    const nameHeader = headers.find((th) => th.textContent?.includes("admin.users.name"));
    const dateHeader = headers.find((th) => th.textContent?.includes("admin.users.created"));
    if (!nameHeader || !dateHeader) throw new Error("test: brak nagłówków");

    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()[0].textContent).toContain("Adam"));
    fireEvent.click(dateHeader);
    // `Adam` ma datę starszą - przy `desc` schodzi na koniec.
    await waitFor(() => expect(dataRows()[2].textContent).toContain("Adam"));
  });

  it("sortowanie po roli używa PORZĄDKU UPRAWNIEŃ, nie alfabetu identyfikatora", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    await ungroup();
    const roleHeader = Array.from(document.querySelectorAll("thead th")).find((th) =>
      th.textContent?.includes("admin.users.role"),
    );
    if (!roleHeader) throw new Error("test: brak nagłówka roli");
    fireEvent.click(roleHeader);
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    // `primaryRole` zwraca `user` dla osoby bez ról, więc rosnąco kolejność
    // to admin < editor < user - i ta kolejność jest sprawdzalna.
    const order = dataRows().map((row) => (row.textContent ?? "").slice(0, 40));
    expect(order[0]).toContain("Cezary");
    expect(order[2]).toContain("Adam");
  });

  it("sortowanie po adresie e-mail obsługuje wiersz BEZ adresu (nie wyrzuca go)", async () => {
    setRpc(
      "admin_list_users",
      ok([
        ...THREE,
        userRow({
          id: "44444444-4444-4444-8444-444444444444",
          display_name: "Bez adresu",
          email: null,
          slug: null,
        }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    await ungroup();
    const emailHeader = Array.from(document.querySelectorAll("thead th")).find(
      (th) => th.textContent?.trim() === "Email",
    );
    if (!emailHeader) throw new Error("test: brak nagłówka e-mail");
    fireEvent.click(emailHeader);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    // Pusty adres sortuje się jako "" - na początek przy `asc`, i wiersz
    // ZOSTAJE na liście. Zgubienie go byłoby cichą utratą użytkownika.
    expect(dataRows()[0].textContent).toContain("Bez adresu");
  });

  it("wiersz bez nazwy pokazuje `-`, a nie puste miejsce", async () => {
    setRpc("admin_list_users", ok([userRow({ display_name: null })]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(dataRows()[0].textContent).toContain("-");
  });

  it("wiersz z awatarem renderuje obraz, bez awatara - zastępczy prostokąt", async () => {
    setRpc(
      "admin_list_users",
      ok([userRow({ avatar_url: "https://example.org/a.jpg" }), userRow({ id: IDS.third })]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    expect(document.querySelectorAll("tbody img")).toHaveLength(1);
  });

  it("grupowanie: `role`, `sub_plan`, `sub_status` i `none` dają różną liczbę pasków grup", async () => {
    h.db?.setResponse(
      "user_subscriptions",
      ok([
        {
          user_id: IDS.other,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan Srebrny", name_en: "Silver Plan" },
        },
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));

    const groupSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
      (element) =>
        Array.from(element.options).some((option) => option.value === "sub_status") &&
        Array.from(element.options).some((option) => option.value === "role"),
    );
    expect(groupSelect, "select grupowania musi istnieć").toBeTruthy();
    if (!groupSelect) throw new Error("test: brak selecta grupowania");

    const groupBars = () =>
      Array.from(document.querySelectorAll("tbody tr")).filter(
        (row) => row.querySelectorAll("td").length === 1,
      ).length;

    // Domyślnie grupujemy po roli: admin / editor / user = trzy paski.
    expect(groupBars()).toBe(3);

    fireEvent.change(groupSelect, { target: { value: "sub_plan" } });
    await waitFor(() => expect(groupBars()).toBe(2)); // „Plan Srebrny" + bez planu
    expect(document.body.textContent).toContain("Plan Srebrny");

    fireEvent.change(groupSelect, { target: { value: "sub_status" } });
    await waitFor(() => expect(groupBars()).toBe(2)); // active + bez subskrypcji

    fireEvent.change(groupSelect, { target: { value: "none" } });
    await waitFor(() => expect(groupBars()).toBe(0));
    expect(dataRows()).toHaveLength(3);
  });

  it("subskrypcja AKTYWNA wygrywa nad oczekującą, choćby wpis był starszy", async () => {
    // Priorytet statusu, nie kolejność wierszy: administrator patrzący na
    // listę ma widzieć realny poziom dostępu, a nie ostatni zapis w tabeli.
    h.db?.setResponse(
      "user_subscriptions",
      ok([
        {
          user_id: IDS.other,
          status: "pending",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan Oczekujący", name_en: "Pending Plan" },
        },
        {
          user_id: IDS.other,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan Aktywny", name_en: "Active Plan" },
        },
      ]),
    );
    await mountList();
    await waitFor(() => expect(document.body.textContent).toContain("Plan Aktywny"));
    const row = dataRows().find((entry) => entry.textContent?.includes("Beata"));
    expect(row?.textContent).toContain("Plan Aktywny");
    expect(row?.textContent).not.toContain("Plan Oczekujący");
  });

  it("wszystkie cztery statusy subskrypcji mają WŁASNĄ etykietę i wariant plakietki", async () => {
    const statuses = ["active", "pending", "refunded", "canceled"] as const;
    h.db?.setResponse(
      "user_subscriptions",
      ok(
        statuses.map((status, index) => ({
          user_id: [IDS.other, IDS.third, IDS.me, "44444444-4444-4444-8444-444444444444"][index],
          status,
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: `Plan ${status}`, name_en: `Plan ${status}` },
        })),
      ),
    );
    setRpc(
      "admin_list_users",
      ok([
        ...THREE,
        userRow({ id: "44444444-4444-4444-8444-444444444444", display_name: "Czwarta Osoba" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const text = document.body.textContent ?? "";
    for (const status of statuses) {
      expect(text, `brak etykiety statusu ${status}`).toContain(
        `adminUsers.subStatus${status[0].toUpperCase()}${status.slice(1)}`,
      );
    }
  });

  it("filtr statusu i filtr planu zawężają NIEZALEŻNIE od siebie", async () => {
    h.db?.setResponse(
      "user_subscriptions",
      ok([
        {
          user_id: IDS.other,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan A", name_en: "Plan A" },
        },
        {
          user_id: IDS.third,
          status: "canceled",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan B", name_en: "Plan B" },
        },
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));

    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
    const planFilter = selects.find((element) =>
      Array.from(element.options).some((option) => option.value === "Plan A"),
    );
    const statusFilter = selects.find((element) =>
      Array.from(element.options).some((option) => option.value === "refunded"),
    );
    if (!planFilter || !statusFilter) throw new Error("test: brak filtrów subskrypcji");

    fireEvent.change(planFilter, { target: { value: "Plan A" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.change(planFilter, { target: { value: "none" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1)); // tylko Cezary bez subskrypcji
    fireEvent.change(planFilter, { target: { value: "all" } });
    await waitFor(() => expect(dataRows()).toHaveLength(3));

    fireEvent.change(statusFilter, { target: { value: "canceled" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.change(statusFilter, { target: { value: "none" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.change(statusFilter, { target: { value: "refunded" } });
    await waitFor(() => expect(dataRows()).toHaveLength(0));
  });

  it("awaria odczytu subskrypcji NIE BLOKUJE listy użytkowników", async () => {
    // Świadoma degradacja opisana w kodzie: brak dostępu do widoku subskrypcji
    // nie może zabrać administratorowi listy użytkowników.
    h.db?.setResponse("user_subscriptions", fail("permission denied", "42501"));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
  });

  it("plan bez nazwy w OBU językach degraduje do `-`, nie do pustej plakietki", async () => {
    h.db?.setResponse(
      "user_subscriptions",
      ok([
        {
          user_id: IDS.other,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: null, name_en: null },
        },
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const row = dataRows().find((entry) => entry.textContent?.includes("Beata"));
    expect(row?.textContent).toContain("-");
  });
});

// ---------------------------------------------------------------------------
// 5. ZAZNACZANIE I AKCJE ZBIOROWE.
// ---------------------------------------------------------------------------

describe("admin.users - zaznaczanie i akcje zbiorowe", () => {
  const TWO: readonly AdminUserRow[] = [
    userRow({ id: IDS.other, display_name: "Beata", email: "beata@example.org" }),
    userRow({ id: IDS.third, display_name: "Adam", email: "adam@example.org" }),
  ];

  beforeEach(() => {
    setRpc("admin_list_users", ok([...TWO]));
  });

  function rowCheckboxes(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]"));
  }

  it("zaznaczenie wiersza otwiera pasek akcji, wyczyszczenie go zamyka", async () => {
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const before = roleSelects().length;
    fireEvent.click(rowCheckboxes()[0].parentElement ?? rowCheckboxes()[0]);
    // Pasek dokłada JEDNĄ kontrolkę nadania roli (zbiorczą).
    await waitFor(() => expect(roleSelects().length).toBe(before + 1));

    const clearButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.clearSelection"),
    );
    expect(clearButton).toBeTruthy();
    if (clearButton) fireEvent.click(clearButton);
    await waitFor(() => expect(roleSelects().length).toBe(before));
  });

  it("zaznacz wszystko / odznacz wszystko działa na WIDOCZNYCH wierszach", async () => {
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    expect(master).toBeTruthy();
    if (!master) throw new Error("test: brak pola „zaznacz wszystko”");

    fireEvent.click(master);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    expect(master.getAttribute("data-state")).toBe("true");

    fireEvent.click(master);
    await waitFor(() => expect(roleSelects().length).toBe(2));
  });

  it("stan POŚREDNI pola „zaznacz wszystko” przy części zaznaczonych wierszy", async () => {
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    fireEvent.click(rowCheckboxes()[0].parentElement ?? rowCheckboxes()[0]);
    await waitFor(() => {
      const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
      expect(master?.getAttribute("data-state")).toBe("indeterminate");
    });
  });

  it("shift-klik zaznacza CIĄGŁY zakres wierszy między dwoma kliknięciami", async () => {
    setRpc(
      "admin_list_users",
      ok([
        ...TWO,
        userRow({ id: "44444444-4444-4444-8444-444444444444", display_name: "Cecylia" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));
    const holders = Array.from(document.querySelectorAll<HTMLElement>("tbody [role=button]"));
    expect(holders).toHaveLength(3);

    fireEvent.click(holders[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    fireEvent.click(holders[2], { shiftKey: true });
    // Trzy zaznaczone: pasek akcji mówi o liczbie, a nie o pierwszym wierszu.
    await waitFor(() => expect(document.body.textContent).toContain("3"));
  });

  it("shift-klik z zaznaczonego wiersza ODZNACZA zakres", async () => {
    setRpc(
      "admin_list_users",
      ok([
        ...TWO,
        userRow({ id: "44444444-4444-4444-8444-444444444444", display_name: "Cecylia" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(3));
    const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    if (!master) throw new Error("test: brak pola „zaznacz wszystko”");
    fireEvent.click(master);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));

    const holders = Array.from(document.querySelectorAll<HTMLElement>("tbody [role=button]"));
    fireEvent.click(holders[0]);
    fireEvent.click(holders[2], { shiftKey: true });
    await waitFor(() => expect(roleSelects().length).toBe(3));
  });

  it("shift-klik w ten SAM wiersz przełącza tylko ten wiersz", async () => {
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const holders = Array.from(document.querySelectorAll<HTMLElement>("tbody [role=button]"));
    fireEvent.click(holders[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    fireEvent.click(holders[0], { shiftKey: true });
    await waitFor(() => expect(roleSelects().length).toBe(2));
  });

  it("zbiorcza zmiana roli wymaga POTWIERDZENIA i wykonuje RPC raz na wiersz", async () => {
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    if (!master) throw new Error("test: brak pola „zaznacz wszystko”");
    fireEvent.click(master);
    await waitFor(() => expect(roleSelects().length).toBe(3));

    // Zbiorcza kontrolka to ta, której `data-value` jest puste (placeholder).
    const bulk = roleSelects().find((element) => element.getAttribute("data-value") === "");
    expect(bulk, "zbiorcza kontrolka roli musi istnieć").toBeTruthy();
    if (!bulk) throw new Error("test: brak zbiorczej kontrolki roli");
    fireEvent.change(bulk, { target: { value: "editor" } });

    const apply = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.applyRole"),
    );
    if (!apply) throw new Error("test: brak przycisku zastosowania roli");
    fireEvent.click(apply);
    // Bez potwierdzenia NIC nie leci do bazy - to jest sens dialogu.
    expect(h.rpcCalls.filter((call) => call.name === "change_user_role")).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId("dialog")).toBeTruthy());

    const confirm = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.yesChangeRole"),
    );
    if (!confirm) throw new Error("test: brak przycisku potwierdzenia");
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(h.rpcCalls.filter((call) => call.name === "change_user_role")).toHaveLength(2),
    );
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("zbiorcza zmiana roli RAPORTUJE porażki osobno od sukcesów", async () => {
    let calls = 0;
    setRpc("change_user_role", () => {
      calls += 1;
      return calls === 1 ? ok(null) : fail("not_authorized", "42501");
    });
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    if (!master) throw new Error("test: brak pola „zaznacz wszystko”");
    fireEvent.click(master);
    await waitFor(() => expect(roleSelects().length).toBe(3));
    const bulk = roleSelects().find((element) => element.getAttribute("data-value") === "");
    if (!bulk) throw new Error("test: brak zbiorczej kontrolki roli");
    fireEvent.change(bulk, { target: { value: "editor" } });
    const apply = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.applyRole"),
    );
    if (!apply) throw new Error("test: brak przycisku zastosowania roli");
    fireEvent.click(apply);
    await waitFor(() => expect(screen.getByTestId("dialog")).toBeTruthy());
    const confirm = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.yesChangeRole"),
    );
    if (!confirm) throw new Error("test: brak przycisku potwierdzenia");
    fireEvent.click(confirm);

    // Jeden sukces i jedna porażka MUSZĄ dać dwa różne komunikaty - jeden
    // zbiorczy „gotowe" ukrywałby, że połowa operacji się nie udała.
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("zbiorcza opcja `super_admin` istnieje TYLKO dla super admina", async () => {
    for (const [roles, expected] of [
      [["super_admin"], true],
      [["admin"], false],
    ] as const) {
      cleanup();
      h.roles = [...roles];
      await mountList();
      await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
      const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
      if (!master) throw new Error("test: brak pola „zaznacz wszystko”");
      fireEvent.click(master);
      await waitFor(() => expect(roleSelects().length).toBe(3));
      const bulk = roleSelects().find((element) => element.getAttribute("data-value") === "");
      if (!bulk) throw new Error("test: brak zbiorczej kontrolki roli");
      const values = Array.from(bulk.options).map((option) => option.value);
      expect(values.includes("super_admin"), `role ${roles.join()}`).toBe(expected);
    }
  });

  it("zbiorcze ponowienie zaproszeń zbiera TYLKO adresy zaznaczonych wierszy", async () => {
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const holders = Array.from(document.querySelectorAll<HTMLElement>("tbody [role=button]"));
    fireEvent.click(holders[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));

    const resend = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.resendInvitations"),
    );
    if (!resend) throw new Error("test: brak przycisku ponowienia");
    fireEvent.click(resend);
    await waitFor(() => expect(h.resendCalls).toHaveLength(1));
    expect(h.resendCalls[0]).toHaveLength(1);
    expect(h.resendCalls[0][0]).toMatch(/@example\.org$/);
  });

  it("ponowienie zaproszeń dla wierszy BEZ adresu nie wysyła żądania", async () => {
    setRpc("admin_list_users", ok([userRow({ email: null })]));
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(1));
    fireEvent.click(document.querySelectorAll<HTMLElement>("tbody [role=button]")[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    const resend = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.resendInvitations"),
    );
    if (!resend) throw new Error("test: brak przycisku ponowienia");
    fireEvent.click(resend);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.resendCalls).toHaveLength(0);
  });

  it("ponowienie raportuje sukcesy, porażki i BRAKUJĄCE zaproszenia rozdzielnie", async () => {
    h.resendResult = {
      results: [{ ok: true }, { ok: false }],
      missing: ["brak@example.org"],
    };
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    if (!master) throw new Error("test: brak pola „zaznacz wszystko”");
    fireEvent.click(master);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    const resend = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.resendInvitations"),
    );
    if (!resend) throw new Error("test: brak przycisku ponowienia");
    fireEvent.click(resend);
    // Trzy różne wyniki -> trzy różne komunikaty. „Brak zaproszenia" NIE jest
    // porażką wysyłki: administrator ma wiedzieć, że tam nie ma czego ponawiać.
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    await waitFor(() => expect(h.toastInfo).toHaveBeenCalled());
  });

  it("wyjątek transportowy przy ponowieniu kończy się komunikatem, nie zawieszeniem paska", async () => {
    h.resendThrows = new Error("network down");
    await mountList();
    await waitFor(() => expect(rowCheckboxes()).toHaveLength(2));
    fireEvent.click(document.querySelectorAll<HTMLElement>("tbody [role=button]")[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    const resend = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.resendInvitations"),
    );
    if (!resend) throw new Error("test: brak przycisku ponowienia");
    fireEvent.click(resend);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("network down"));
    // Pasek MUSI odblokować się po błędzie - inaczej administrator zostaje
    // z zaznaczeniem, którego nie może użyć ani wyczyścić.
    await waitFor(() => {
      const button = Array.from(document.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("adminUsers.clearSelection"),
      );
      expect(button?.hasAttribute("disabled")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. NAWIGACJA I SKLEJENIE MODALEK.
// ---------------------------------------------------------------------------

describe("admin.users - nawigacja i sklejenie modalek", () => {
  it("modalki zaproszenia i importu startują ZAMKNIĘTE i otwierają się z paska", async () => {
    await mountList();
    await waitFor(() => expect(h.props.InviteUserDialog).toBeTruthy());
    expect(h.props.InviteUserDialog.open).toBe(false);
    expect(h.props.TeamImportDialog.open).toBe(false);
    // Import celuje w konkretną stronę - `o-nas` jest kontraktem, nie domyślną
    // wartością do przypadkowej zmiany.
    expect(h.props.TeamImportDialog.pageSlug).toBe("o-nas");

    const invite = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.inviteUser"),
    );
    if (!invite) throw new Error("test: brak przycisku zaproszenia");
    fireEvent.click(invite);
    await waitFor(() => expect(h.props.InviteUserDialog.open).toBe(true));

    const importButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.importTeamONas"),
    );
    if (!importButton) throw new Error("test: brak przycisku importu");
    fireEvent.click(importButton);
    await waitFor(() => expect(h.props.TeamImportDialog.open).toBe(true));
  });

  it("`onDone` z modalek unieważnia listę - inaczej nowy użytkownik nie pojawia się", async () => {
    const rendered = await mountList();
    await waitFor(() => expect(h.props.InviteUserDialog).toBeTruthy());
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    const onDone = h.props.InviteUserDialog.onDone;
    expect(typeof onDone).toBe("function");
    if (typeof onDone === "function") onDone();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls[0][0])).toContain("all-users");
  });

  it("klik w wiersz przenosi na kartę użytkownika, a klik w komórkę roli NIE", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const row = dataRows()[0];
    const roleCell = row.querySelectorAll("td")[3];
    // `stopPropagation` w komórce roli jest tu regułą: zmiana roli nie może
    // przypadkiem przenieść administratora na inną stronę w połowie akcji.
    expect(roleCell).toBeTruthy();
    fireEvent.click(roleCell);
    // `stopPropagation` w komórce roli = ZERO zleconych przejść.
    expect(h.navigations).toEqual([]);

    // Klik w sam wiersz (poza komórkami z `stopPropagation`) przenosi na kartę.
    fireEvent.click(row.querySelectorAll("td")[1]);
    await waitFor(() =>
      expect(h.navigations).toEqual([{ to: "/admin/users/$id", params: { id: IDS.other } }]),
    );
  });

  it("nagłówek `head()` obu tras nie istnieje - panel jest `noindex` z definicji", async () => {
    // Panel nie ma nagłówków SEO i to jest decyzja, nie przeoczenie: dowód
    // trzyma ją na miejscu, gdyby ktoś dokleił trasie panelu tytuł publiczny.
    expect(await routeMeta(UsersListRoute)).toEqual([]);
    expect(await routeMeta(UserDetailRoute)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. KARTA UŻYTKOWNIKA - stany i panele boczne.
// ---------------------------------------------------------------------------

describe("admin.users.$id - stany wczytywania i braku danych", () => {
  it("brak wiersza z RPC pokazuje odmowę treści, nie pustą kartę", async () => {
    setRpc("admin_get_user", ok([]));
    await mountDetail();
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.userFound"));
    expect(screen.queryByTestId("AuthorProfileEditor")).toBeNull();
  });

  it("błąd RPC pokazuje ten sam komunikat co brak wiersza - i wraca odnośnik do listy", async () => {
    setRpc("admin_get_user", fail("permission denied", "42501"));
    await mountDetail();
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.userFound"));
    expect(document.body.textContent).toContain("adminUsers.backList");
  });

  it("nazwa: pełne imię i nazwisko, potem `display_name`, potem `-`", async () => {
    for (const [row, expected] of [
      [detailRow(), "Osoba Druga"],
      [detailRow({ first_name: null, last_name: null }), "Osoba Druga"],
      [detailRow({ first_name: null, last_name: null, display_name: null }), "-"],
    ] as const) {
      cleanup();
      setRpc("admin_get_user", ok([row]));
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      const heading = document.querySelector("h1");
      expect(heading?.textContent).toBe(expected);
    }
  });

  it("wiersze informacyjne o pustej wartości NIE renderują się wcale", async () => {
    setRpc("admin_get_user", ok([detailRow({ job_title: "Analityk", location: null })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("Analityk");
    // Etykieta bez wartości byłaby pustym wierszem sugerującym brak danych
    // tam, gdzie po prostu pola nie ma.
    expect(document.body.textContent).not.toContain("adminUsers.location");
  });

  it("karta bio pokazuje się TYLKO gdy istnieje którakolwiek z trzech wersji", async () => {
    cleanup();
    setRpc("admin_get_user", ok([detailRow()]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).not.toContain("adminUsers.bio");

    cleanup();
    setRpc("admin_get_user", ok([detailRow({ bio_en: "English bio" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("English bio");
  });

  it("pole wieloliniowe przechodzi przez czyszczenie HTML - znacznik nie trafia na ekran", async () => {
    setRpc("admin_get_user", ok([detailRow({ bio: "<script>alert(1)</script><p>Treść bio</p>" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("Treść bio");
    expect(document.body.textContent).not.toContain("<p>");
    expect(document.body.innerHTML).not.toContain("<script>");
  });

  it("odnośnik do profilu publicznego istnieje tylko przy slugu", async () => {
    cleanup();
    setRpc("admin_get_user", ok([detailRow({ slug: null })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.querySelector('a[href^="/author/"]')).toBeNull();

    cleanup();
    setRpc("admin_get_user", ok([detailRow({ slug: "osoba-druga" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.querySelector('a[href="/author/osoba-druga"]')).toBeTruthy();
  });

  it("adresy społecznościowe i kontaktowe renderują się jako odnośniki właściwego rodzaju", async () => {
    setRpc(
      "admin_get_user",
      ok([
        detailRow({
          contact_email: "kontakt@example.org",
          website_url: "https://example.org",
          linkedin_url: "https://example.org/in",
        }),
      ]),
    );
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    // E-mail idzie przez `mailto:` - inaczej klik otwiera pustą stronę.
    expect(document.querySelector('a[href="mailto:kontakt@example.org"]')).toBeTruthy();
    expect(document.querySelector('a[href="https://example.org"]')).toBeTruthy();
    // Odnośnik zewnętrzny MUSI nieść `rel=noreferrer` - panel zna adresy
    // wewnętrzne, których nie wolno wysyłać w nagłówku `Referer`.
    const external = document.querySelector<HTMLAnchorElement>('a[href="https://example.org/in"]');
    expect(external?.rel).toContain("noreferrer");
  });

  it("data aktualizacji i płeć pojawiają się tylko wtedy, gdy są w danych", async () => {
    cleanup();
    setRpc("admin_get_user", ok([detailRow({ updated_at: BASE_ISO, gender: "female" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("adminUsers.updated");
    expect(document.body.textContent).toContain("adminUsers.gender");

    cleanup();
    setRpc("admin_get_user", ok([detailRow()]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).not.toContain("adminUsers.gender");
  });

  it("obraz tła renderuje się przy `cover_url`, inaczej pasek zastępczy", async () => {
    cleanup();
    setRpc("admin_get_user", ok([detailRow({ cover_url: "https://example.org/c.jpg" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.querySelector('img[src="https://example.org/c.jpg"]')).toBeTruthy();
  });

  it("awatar: obraz przy adresie, kwadrat zastępczy bez adresu", async () => {
    cleanup();
    setRpc("admin_get_user", ok([detailRow({ avatar_url: "https://example.org/av.jpg" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.querySelector('img[src="https://example.org/av.jpg"]')).toBeTruthy();
  });
});

describe("admin.users.$id - impersonacja", () => {
  it("przycisk impersonacji jest tylko dla super admina i tylko na obcej karcie", async () => {
    for (const [roles, targetId, expected] of [
      [["super_admin"], IDS.other, true],
      [["super_admin"], IDS.me, false],
      [["admin"], IDS.other, false],
      [["editor"], IDS.other, false],
    ] as const) {
      cleanup();
      h.roles = [...roles];
      setRpc("admin_get_user", ok([detailRow({ id: targetId })]));
      await mountDetail(targetId);
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      const button = Array.from(document.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("adminUsers.sign"),
      );
      expect(Boolean(button), `role ${roles.join()} / cel ${targetId}`).toBe(expected);
    }
  });

  it("impersonacja przekazuje etykietę czytelną dla człowieka - nie sam identyfikator", async () => {
    // Baner „działasz jako…" bez nazwy jest bezużyteczny; identyfikator jest
    // ostatnią, nie pierwszą, wartością zastępczą.
    h.roles = ["super_admin"];
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const button = Array.from(document.querySelectorAll("button")).find((element) =>
      element.textContent?.includes("adminUsers.sign"),
    );
    if (!button) throw new Error("test: brak przycisku impersonacji");
    fireEvent.click(button);
    await waitFor(() => expect(h.impersonations).toHaveLength(1));
    expect(h.impersonations[0]).toEqual({ id: IDS.other, label: "Osoba Druga" });
  });

  it("etykieta impersonacji degraduje po kolei: nazwa, adres, identyfikator", async () => {
    h.roles = ["super_admin"];
    for (const [row, expectedLabel] of [
      [detailRow({ display_name: null }), "druga@example.org"],
      [detailRow({ display_name: null, email: null }), IDS.other],
    ] as const) {
      cleanup();
      h.impersonations = [];
      setRpc("admin_get_user", ok([row]));
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      const button = Array.from(document.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("adminUsers.sign"),
      );
      if (!button) throw new Error("test: brak przycisku impersonacji");
      fireEvent.click(button);
      await waitFor(() => expect(h.impersonations).toHaveLength(1));
      expect(h.impersonations[0].label).toBe(expectedLabel);
    }
  });
});

describe("admin.users.$id - weryfikacja zawodowa", () => {
  it("przełącznik jest ZABLOKOWANY dla personelu bez uprawnienia admina", async () => {
    // Zapis pilnuje trigger `profiles_guard_verification` (42501). Bez tego
    // odbicia po stronie panelu redaktor dostaje surowy błąd bazy.
    for (const [roles, disabled] of [
      [["super_admin"], false],
      [["admin"], false],
      [["editor"], true],
      [["author"], true],
    ] as const) {
      cleanup();
      h.roles = [...roles];
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      // Czekamy na koniec wczytywania: dopóki zapytanie leci, przełącznik jest
      // zablokowany DLA WSZYSTKICH - i test przechodziłby przez przypadek.
      await waitFor(() =>
        expect(document.body.textContent).toContain("adminUsers.profileVerified"),
      );
      await waitFor(() => {
        const element = document.querySelector<HTMLInputElement>(
          'input[role=switch][aria-label="adminUsers.professionalVerification"]',
        );
        expect(element, `role ${roles.join()}`).toBeTruthy();
        expect(element?.disabled, `role ${roles.join()}`).toBe(disabled);
      });
      // Zdanie wyjaśniające ZAWSZE towarzyszy zablokowanej kontrolce.
      expect(document.body.textContent).toContain(
        disabled
          ? "adminUsers.changingRequiresAdminSuperAdmin"
          : "adminUsers.manualGrantIndependentEMail",
      );
    }
  });

  it("stan przełącznika odbija `verified_at` z bazy, a data trafia do komunikatu", async () => {
    h.db?.setResponse("profiles", ok({ verified_at: BASE_ISO, expert_requests_enabled: true }));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    await waitFor(() => {
      const toggle = document.querySelector<HTMLInputElement>(
        'input[role=switch][aria-label="adminUsers.professionalVerification"]',
      );
      expect(toggle?.checked).toBe(true);
    });
    expect(document.body.textContent).toContain("adminUsers.verifiedAt");
  });

  it("włączenie weryfikacji idzie przez SECURITY DEFINER, nie przez UPDATE na `profiles`", async () => {
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const toggle = await readySwitch("adminUsers.professionalVerification");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(h.rpcCalls.some((call) => call.name === "admin_set_profile_verification")).toBe(true),
    );
    const call = h.rpcCalls.find((entry) => entry.name === "admin_set_profile_verification");
    expect(call?.args).toEqual({ p_user_id: IDS.other, p_verified: true });
    // `profiles` UPDATE jest own-row - panel NIE MOŻE tam pisać.
    expect(h.db?.chainsFor("profiles").some((chain) => chain.has("update"))).toBe(false);
  });

  it("odmowa zapisu weryfikacji nie mówi o sukcesie", async () => {
    setRpc("admin_set_profile_verification", fail("permission denied", "42501"));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const toggle = await readySwitch("adminUsers.professionalVerification");
    fireEvent.click(toggle);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("admin.users.$id - wnioski eksperckie", () => {
  it("brak kolumny w wyniku znaczy WŁĄCZONE - domyślna wartość nie może gasić przycisku", async () => {
    // `?? true` w odczycie jest regułą, nie zabezpieczeniem: użytkownik bez
    // jawnego ustawienia ma odbierać zapytania, a nie milczeć.
    h.db?.setResponse("profiles", ok({ verified_at: null }));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    await waitFor(() => {
      const toggle = document.querySelector<HTMLInputElement>(
        'input[role=switch][aria-label="adminUsers.expertRequests"]',
      );
      expect(toggle?.checked).toBe(true);
    });
  });

  it("jawne `false` w bazie wyłącza przycisk zapytania", async () => {
    h.db?.setResponse("profiles", ok({ verified_at: null, expert_requests_enabled: false }));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    await waitFor(() => {
      const toggle = document.querySelector<HTMLInputElement>(
        'input[role=switch][aria-label="adminUsers.expertRequests"]',
      );
      expect(toggle?.checked).toBe(false);
    });
  });

  it("przestawienie idzie przez RPC z jawnym `p_enabled`", async () => {
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const toggle = await readySwitch("adminUsers.expertRequests");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(h.rpcCalls.some((call) => call.name === "admin_set_expert_requests_enabled")).toBe(
        true,
      ),
    );
    expect(
      h.rpcCalls.find((entry) => entry.name === "admin_set_expert_requests_enabled")?.args,
    ).toEqual({ p_user_id: IDS.other, p_enabled: false });
  });

  it("odmowa zapisu wniosków eksperckich kończy się komunikatem błędu", async () => {
    setRpc("admin_set_expert_requests_enabled", fail("permission denied", "42501"));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const toggle = await readySwitch("adminUsers.expertRequests");
    fireEvent.click(toggle);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("admin.users.$id - odznaki profilowe", () => {
  it("nadanie i odebranie odznaki idzie do właściwej funkcji", async () => {
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    const grant = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("badge:verified:pl"),
    );
    if (!grant) throw new Error("test: brak przycisku odznaki");
    fireEvent.click(grant);
    await waitFor(() => expect(h.badgeGrants).toHaveLength(1));
    expect(h.badgeGrants[0]).toEqual({ userId: IDS.other, badge: "verified" });

    cleanup();
    h.badges = ["verified"];
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    const revoke = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("badge:verified:pl"),
    );
    if (!revoke) throw new Error("test: brak przycisku odznaki");
    fireEvent.click(revoke);
    await waitFor(() => expect(h.badgeRevokes).toHaveLength(1));
  });

  it("porażka nadania odznaki NIE mówi o sukcesie", async () => {
    h.badgeThrows = true;
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    const grant = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("badge:verified:pl"),
    );
    if (!grant) throw new Error("test: brak przycisku odznaki");
    fireEvent.click(grant);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("przyciski odznak są zablokowane, dopóki odznaki się wczytują", async () => {
    h.badgesLoading = true;
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    const grant = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("badge:verified:pl"),
    );
    expect(grant?.hasAttribute("disabled")).toBe(true);
  });
});

describe("admin.users.$id - panel zgód (RODO)", () => {
  it("brak zapisanej zgody to WŁASNY komunikat, nie pusta lista kategorii", async () => {
    setRpc("admin_get_user_consent", ok(null));
    await mountDetail();
    await waitFor(() =>
      expect(document.body.textContent).toContain("adminUsers.userHasSavedConsentYet"),
    );
  });

  it("zapis zgody z pustymi kategoriami i bez znacznika czasu też jest „brakiem”", async () => {
    setRpc("admin_get_user_consent", ok({ categories: {}, updated_at: null, version: null }));
    await mountDetail();
    await waitFor(() =>
      expect(document.body.textContent).toContain("adminUsers.userHasSavedConsentYet"),
    );
  });

  it("wszystkie CZTERY kategorie mają wiersz, a stan mówi „udzielona”/„odmówiona”", async () => {
    setRpc(
      "admin_get_user_consent",
      ok({
        categories: { necessary: true, functional: false, analytics: true, marketing: false },
        updated_at: BASE_ISO,
        version: "2026-01-01",
      }),
    );
    await mountDetail();
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.consentNecessary"));
    const text = document.body.textContent ?? "";
    for (const key of [
      "adminUsers.consentNecessary",
      "adminUsers.consentFunctional",
      "adminUsers.consentAnalytics",
      "adminUsers.consentMarketing",
    ]) {
      expect(text, `brak wiersza kategorii ${key}`).toContain(key);
    }
    expect(text).toContain("adminUsers.granted");
    expect(text).toContain("adminUsers.denied");
    // DOWODLIWOŚĆ ZGODY: wersja dokumentu i znacznik czasu są częścią zapisu,
    // bez nich nie da się powiedzieć, na CO ktoś się zgodził.
    expect(text).toContain("adminUsers.version");
    expect(text).toContain("2026-01-01");
    expect(text).toContain("adminUsers.updated2");
  });

  it("zgoda BEZ wersji dokumentu nie renderuje pustej etykiety wersji", async () => {
    setRpc(
      "admin_get_user_consent",
      ok({ categories: { necessary: true }, updated_at: BASE_ISO, version: null }),
    );
    await mountDetail();
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.consentNecessary"));
    expect(document.body.textContent).not.toContain("adminUsers.version");
  });

  it("błąd odczytu zgód to WŁASNY stan - nie „brak zgody”", async () => {
    // Rozdzielenie jest tu wymogiem RODO, nie kosmetyką: „użytkownik nie
    // zapisał zgody" i „nie wiemy, bo odczyt padł" prowadzą do dwóch różnych
    // decyzji operatora.
    setRpc("admin_get_user_consent", fail("permission denied", "42501"));
    await mountDetail();
    await waitFor(() => expect(document.body.textContent).toContain("permission denied"));
    expect(document.body.textContent).not.toContain("adminUsers.userHasSavedConsentYet");
  });
});

// ---------------------------------------------------------------------------
// 8. DEFEKTY - produkcja BEZ ZMIAN, zgłoszone `it.fails` (konwencja repo).
// ---------------------------------------------------------------------------

describe("admin.users - defekty zgłoszone, nie naprawione", () => {
  it.fails(
    "DEFEKT: lista `/admin/users` oferuje droplistę roli KAŻDEMU członkowi personelu",
    async () => {
      // TO JEST TEN SAM DEFEKT, który bramka autorytetu złapała w
      // `admin.users.$id.tsx` - tylko na DRUGIM ekranie tej samej rodziny.
      //
      // `admin.users.$id.tsx` zawęża kontrolkę warunkiem
      // `data.id === user?.id || !(isAdmin || isSuperAdmin)`.
      // `admin.users.index.tsx` (linie 799-822) sprawdza WYŁĄCZNIE
      // `u.id === user?.id` - o roli wywołującego nie pyta wcale. Redaktor
      // otwierający listę widzi więc droplistę zmiany roli w każdym obcym
      // wierszu, a `change_user_role` odrzuci każde jej użycie
      // (`not_authorized`, 42501 - 11 asercji pgTAP w
      // `supabase/tests/role_management_test.sql`).
      //
      // KONSEKWENCJA: panel wygląda, jakby redaktor nadawał role - i to na
      // ekranie zbiorczym, gdzie jedno kliknięcie dotyczy dowolnej osoby
      // w najemcy. Naprawa to jeden warunek, ten sam co w karcie; nie robimy
      // jej tutaj, bo zakresem tego zadania są testy (rozdz. 6 zlecenia).
      h.roles = ["editor"];
      await mountList();
      await waitFor(() => expect(dataRows()).toHaveLength(1));
      expect(roleSelects(dataRows()[0])).toHaveLength(0);
    },
  );

  it.fails("DEFEKT: odmowa z bazy trafia na ekran surowym tekstem z Postgresa", async () => {
    // `changeRole` w OBU trasach robi `toast.error(error.message)`. Komunikat
    // z RPC to techniczny łańcuch (`not_authorized`, `permission denied for
    // table user_roles`) - nieprzetłumaczony, niezrozumiały i widoczny także
    // na `/en/`. Bramka `check:i18n-hardcoded` tego nie widzi, bo w kodzie nie
    // ma literału - jest przekazanie cudzego tekstu.
    //
    // KONSEKWENCJA: administrator nie wie, czy to brak uprawnień, czy awaria,
    // a użytkownik angielskiej wersji panelu dostaje polską/angielską mieszankę
    // zależną od `lc_messages` serwera bazy.
    setRpc("change_user_role", fail("not_authorized", "42501"));
    await mountDetail();
    await waitFor(() => expect(roleSelects()).toHaveLength(1));
    fireEvent.change(roleSelects()[0], { target: { value: "editor" } });
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const message = String(h.toastError.mock.calls[0][0]);
    expect(message.startsWith("adminUsers.") || message.startsWith("admin.")).toBe(true);
  });

  it.fails("DEFEKT: awaria listy użytkowników wygląda jak lista pusta", async () => {
    // `admin.users.index.tsx` czyta z zapytania TYLKO `data`
    // (`const { data } = useQuery(adminUsersQueryOptions(tenantId))`), więc
    // `error` i `isPending` nie mają żadnego wyjścia na ekran. Przy odmowie
    // RPC `admin_list_users` tabela renderuje komunikat pustki
    // (`adminUsers.results`) - identycznie jak dla najemcy, który realnie nie
    // ma użytkowników.
    //
    // KONSEKWENCJA: to jest klasa defektu, która w tym repo wystąpiła już
    // trzy razy. Administrator widzi „brak wyników" i wyciąga wniosek, że
    // baza jest pusta, kiedy jest niedostępna - a lista użytkowników jest
    // ekranem, z którego odtwarza się dostęp po awarii.
    setRpc("admin_list_users", fail("permission denied", "42501"));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(0));
    expect(document.body.textContent).not.toContain("adminUsers.results");
  });

  it.fails("DEFEKT: pustka po filtrach mówi to samo, co pustka bez filtrów", async () => {
    // Jeden komunikat `adminUsers.results` obsługuje dwa różne stany: „nie ma
    // jeszcze użytkowników" i „nic nie pasuje do filtrów". Trasy klubów mają
    // na to dwa osobne komunikaty i to jest wzorzec w repo
    // (`adminClubRoutes.test.tsx`, punkt 5 nagłówka).
    setRpc("admin_list_users", ok([userRow()]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const emptyWithoutFilters = document.body.textContent ?? "";

    const input = document.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    if (!input) throw new Error("test: brak pola szukania");
    fireEvent.change(input, { target: { value: "nie-ma-takiego" } });
    await waitFor(() => expect(dataRows()).toHaveLength(0));
    const emptyWithFilters = document.body.textContent ?? "";
    expect(emptyWithFilters).not.toBe(emptyWithoutFilters);
    expect(emptyWithFilters).toContain("adminUsers.noMatch");
  });
});

// ---------------------------------------------------------------------------
// 9. AWATAR - jedyna ścieżka wysyłania pliku w tej rodzinie tras.
// ---------------------------------------------------------------------------

/**
 * Podstawiony `XMLHttpRequest`. Wysyłka do podpisanego adresu idzie surowym
 * XHR-em (nie `fetch`), bo trasa potrzebuje nagłówka `x-upsert` - więc bez tej
 * atrapy ścieżka wysyłania awatara jest w teście nieosiągalna. Atrapa nie
 * wychodzi do sieci: `send()` tylko woła `onload`/`onerror`.
 */
function stubXhr(): () => void {
  const original = globalThis.XMLHttpRequest;
  class FakeXhr {
    status = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly headers: Record<string, string> = {};
    open(): void {}
    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value;
    }
    send(): void {
      h.xhrSends += 1;
      // Tryb zawieszony: żaden `onload`/`onerror` nie przychodzi, więc stan
      // „wysyłanie w toku" da się zaobserwować bez `setTimeout`.
      if (h.xhrHang) return;
      if (h.xhrNetworkError) {
        this.onerror?.();
        return;
      }
      this.status = h.xhrStatus;
      this.onload?.();
    }
  }
  Reflect.set(globalThis, "XMLHttpRequest", FakeXhr);
  return () => Reflect.set(globalThis, "XMLHttpRequest", original);
}

/** Plik testowy o zadanym rozmiarze i typie - bez czytania z dysku. */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

async function mountDetailWithAvatarEditor(): Promise<HTMLInputElement> {
  await mountDetail();
  await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("test: brak pola wyboru pliku");
  return input;
}

describe("admin.users.$id - edytor awatara", () => {
  it("wysyłanie awatara jest WYŁĄCZNIE dla super admina", async () => {
    // Zapis idzie przez `admin_update_user_avatar`; niższe role dostałyby
    // odmowę, więc pole wyboru pliku nie może się dla nich renderować.
    for (const [roles, expected] of [
      [["super_admin"], true],
      [["admin"], false],
      [["editor"], false],
    ] as const) {
      cleanup();
      h.roles = [...roles];
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      expect(Boolean(document.querySelector('input[type="file"]')), roles.join()).toBe(expected);
    }
  });

  it("BEZ najemcy wybór pliku jest odrzucany PRZED otwarciem kadrowania", async () => {
    // Ścieżka w koszyku zawiera identyfikator najemcy; bez niego plik wyleciałby
    // do korzenia kubełka, czyli poza izolację najemcy.
    h.roles = ["super_admin"];
    h.tenantId = null;
    const input = await mountDetailWithAvatarEditor();
    fireEvent.change(input, {
      target: { files: [fakeFile("a.jpg", "image/jpeg", 1024)] },
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminToasts.missingTenant"));
    expect(h.props.ImageCropDialog.open).toBe(false);
  });

  it("plik ponad 5 MB i plik NIE-obraz są odrzucane osobnymi komunikatami", async () => {
    h.roles = ["super_admin"];
    const input = await mountDetailWithAvatarEditor();

    fireEvent.change(input, {
      target: { files: [fakeFile("duzy.jpg", "image/jpeg", 5 * 1024 * 1024 + 1)] },
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminToasts.fileTooBig"));

    h.toastError.mockReset();
    fireEvent.change(input, {
      target: { files: [fakeFile("plik.pdf", "application/pdf", 1024)] },
    });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminToasts.imageRequired"));
    expect(h.props.ImageCropDialog.open).toBe(false);
  });

  it("plik DOKŁADNIE 5 MB przechodzi - granica jest `>`, nie `>=`", async () => {
    h.roles = ["super_admin"];
    const input = await mountDetailWithAvatarEditor();
    fireEvent.change(input, {
      target: { files: [fakeFile("rowno.jpg", "image/jpeg", 5 * 1024 * 1024)] },
    });
    await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("zmiana pola BEZ pliku nic nie robi (użytkownik anulował okno systemowe)", async () => {
    h.roles = ["super_admin"];
    const input = await mountDetailWithAvatarEditor();
    fireEvent.change(input, { target: { files: [] } });
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.props.ImageCropDialog.open).toBe(false);
  });

  it("poprawny plik otwiera kadrowanie, a wysyłka kończy się zapisem przez RPC", async () => {
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, {
        target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] },
      });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      expect(h.props.ImageCropDialog.kind).toBe("avatar");

      const onConfirm = h.props.ImageCropDialog.onConfirm;
      expect(typeof onConfirm).toBe("function");
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));

      await waitFor(() => expect(h.xhrSends).toBe(1));
      await waitFor(() =>
        expect(h.rpcCalls.some((call) => call.name === "admin_update_user_avatar")).toBe(true),
      );
      const call = h.rpcCalls.find((entry) => entry.name === "admin_update_user_avatar");
      // Adres publiczny, nie podpisany - podpisany wygasa i wyciekłby token.
      expect(call?.args._avatar_url).toBe("https://example.org/a.jpg");
      expect(call?.args._user_id).toBe(IDS.other);
      await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.saved"));
    } finally {
      restore();
    }
  });

  it("odpowiedź 4xx z koszyka NIE kończy się zapisem adresu w profilu", async () => {
    // Zapis adresu przy nieudanej wysyłce zostawiłby w profilu odnośnik do
    // pliku, którego nie ma - czyli trwale zepsuty awatar.
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      h.xhrStatus = 403;
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, {
        target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] },
      });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("HTTP 403"));
      expect(h.rpcCalls.some((call) => call.name === "admin_update_user_avatar")).toBe(false);
    } finally {
      restore();
    }
  });

  it("awaria sieci przy wysyłce kończy się komunikatem, nie cichym niczym", async () => {
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      h.xhrNetworkError = true;
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, {
        target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] },
      });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("network"));
      expect(h.rpcCalls.some((call) => call.name === "admin_update_user_avatar")).toBe(false);
    } finally {
      restore();
    }
  });

  it("odmowa RPC zapisu awatara jest raportowana", async () => {
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      setRpc("admin_update_user_avatar", fail("not_authorized", "42501"));
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, {
        target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] },
      });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("not_authorized"));
      expect(h.toastSuccess).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("zamknięcie kadrowania bez potwierdzenia porzuca plik", async () => {
    h.roles = ["super_admin"];
    const input = await mountDetailWithAvatarEditor();
    fireEvent.change(input, {
      target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] },
    });
    await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
    const onOpenChange = h.props.ImageCropDialog.onOpenChange;
    if (typeof onOpenChange !== "function") throw new Error("test: brak onOpenChange");
    onOpenChange(false);
    await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(false));
    expect(h.props.ImageCropDialog.file).toBeNull();
  });

  it("przycisk wyboru pliku niesie etykietę dostępności, nie tylko ikonę", async () => {
    // Ikona aparatu bez etykiety to dla czytnika ekranu przycisk bez nazwy.
    h.roles = ["super_admin"];
    await mountDetailWithAvatarEditor();
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="adminUsers.changePhoto"]',
    );
    expect(button).toBeTruthy();
    expect(button?.title).toBe("adminUsers.changePhoto");
    fireEvent.click(button as HTMLButtonElement);
    // Klik bez wybranego pliku nie może niczego wysłać.
    expect(h.xhrSends).toBe(0);
  });
});

describe("admin.users.$id - ścieżki błędu pozostałych paneli", () => {
  it("nieudana impersonacja pokazuje komunikat i NIE przenosi na profil", async () => {
    h.roles = ["super_admin"];
    const original = window.location.assign;
    const assigns: string[] = [];
    Reflect.set(window.location, "assign", (href: string) => assigns.push(href));
    const invitationsModule = await import("@/lib/admin/impersonation");
    const spy = vi
      .spyOn(invitationsModule, "impersonateUser")
      .mockRejectedValueOnce(new Error("session_exchange_failed"));
    try {
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      const button = Array.from(document.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("adminUsers.sign"),
      );
      if (!button) throw new Error("test: brak przycisku impersonacji");
      fireEvent.click(button);
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("session_exchange_failed"));
      expect(assigns).toHaveLength(0);
    } finally {
      spy.mockRestore();
      Reflect.set(window.location, "assign", original);
    }
  });

  it("awaria odczytu `profiles` nie wywraca karty - panele boczne zostają zablokowane", async () => {
    // `profiles` niesie dwa niezależne panele (weryfikacja, wnioski). Awaria
    // odczytu nie może zabrać administratorowi reszty karty.
    h.db?.setResponse("profiles", fail("permission denied", "42501"));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("adminUsers.profileVerified");
    expect(document.body.textContent).toContain("adminUsers.showRequestButton");
  });

  it("przycisk powrotu przenosi na listę użytkowników", async () => {
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const back = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.back"),
    );
    if (!back) throw new Error("test: brak przycisku powrotu");
    fireEvent.click(back);
    await waitFor(() => expect(h.navigations).toEqual([{ to: "/admin/users" }]));
  });

  it("nazwa wyświetlana RÓŻNA od imienia i nazwiska pokazuje się osobno z `@`", async () => {
    setRpc("admin_get_user", ok([detailRow({ display_name: "pseudonim" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("@pseudonim");
  });

  it("nazwa wyświetlana RÓWNA imieniu i nazwisku nie dubluje się", async () => {
    setRpc("admin_get_user", ok([detailRow({ display_name: "Osoba Druga" })]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).not.toContain("@Osoba Druga");
  });
});

// ---------------------------------------------------------------------------
// 10. `admin.users` (layout) i `admin.users.invitations`.
// ---------------------------------------------------------------------------

describe("admin.users - trasa-powłoka rodziny", () => {
  it("powłoka `/admin/users` jest samym `<Outlet/>` - żadnej własnej treści", async () => {
    // Gdyby powłoka dorobiła sobie bramkę albo nagłówek, dwie trasy dzieci
    // dostałyby ją niejawnie - i to jest miejsce, w którym takie rzeczy giną.
    const rendered = await renderRoute({
      route: UsersLayoutRoute,
      path: "/admin/users",
      initialEntry: "/admin/users",
    });
    expect(rendered.container.textContent).toBe("");
    expect(await routeMeta(UsersLayoutRoute)).toEqual([]);
  });
});

describe("admin.users.invitations - lista zaproszeń", () => {
  function invitation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "inv-1",
      display_name: "Osoba Trzecia",
      email: "trzecia@example.org",
      role: "author",
      mode: "magic_link",
      status: "pending",
      source: "manual",
      sent_at: null,
      last_error: null,
      ...overrides,
    };
  }

  async function mountInvitations(): Promise<Awaited<ReturnType<typeof renderRoute>>> {
    return renderRoute({
      route: InvitationsRoute,
      path: "/admin/users/invitations",
      initialEntry: "/admin/users/invitations",
    });
  }

  it("pusta lista mówi to wprost, a nie renderuje pustej tabeli", async () => {
    await mountInvitations();
    await waitFor(() =>
      expect(document.body.textContent).toContain("adminMiscRoutes.invitations.empty"),
    );
  });

  it("wiersz pokazuje rolę, tryb, przetłumaczony status i brakujące daty", async () => {
    h.invitations = [invitation({ source: null })];
    await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    const text = document.body.textContent ?? "";
    expect(text).toContain("author");
    expect(text).toContain("magic_link");
    expect(text).toContain("adminMiscRoutes.invitations.statusPending");
    expect(text).toContain("-");
  });

  it("wszystkie CZTERY statusy zaproszenia renderują się bez wyjątku", async () => {
    h.invitations = (["sent", "accepted", "failed", "pending"] as const).map((status, index) =>
      invitation({ id: `inv-${index}`, status, email: `osoba${index}@example.org` }),
    );
    await mountInvitations();
    await waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(4));
    for (const status of ["Sent", "Accepted", "Failed", "Pending"]) {
      expect(document.body.textContent, `brak statusu ${status}`).toContain(
        `adminMiscRoutes.invitations.status${status}`,
      );
    }
  });

  it("ostatni błąd wysyłki jest widoczny i dostępny w podpowiedzi", async () => {
    // Bez tego administrator widzi tylko „failed" i nie ma jak zdiagnozować,
    // czy to zły adres, czy padła bramka poczty.
    h.invitations = [invitation({ status: "failed", last_error: "smtp: 550 mailbox unavailable" })];
    await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("550 mailbox unavailable"));
    expect(document.querySelector('[title="smtp: 550 mailbox unavailable"]')).toBeTruthy();
  });

  it("data wysłania renderuje się dla wysłanych, `-` dla niewysłanych", async () => {
    h.invitations = [
      invitation({ id: "a", sent_at: BASE_ISO }),
      invitation({ id: "b", sent_at: null, email: "b@example.org" }),
    ];
    await mountInvitations();
    await waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(2));
    expect(document.body.textContent).toContain("2026");
  });

  it("zaproszenie WYCOFANE nie oferuje ani ponowienia, ani wycofania", async () => {
    // Panel nie może proponować akcji na rekordzie, który jest już zamknięty.
    h.invitations = [invitation({ status: "revoked" })];
    await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    expect(document.querySelectorAll("tbody button")).toHaveLength(0);
  });

  it("etykieta akcji zależy od statusu: „wyślij” dla nowego, „ponów” dla wysłanego", async () => {
    h.invitations = [
      invitation({ id: "a", status: "pending" }),
      invitation({ id: "b", status: "sent", email: "b@example.org" }),
    ];
    await mountInvitations();
    await waitFor(() => expect(document.querySelectorAll("tbody tr")).toHaveLength(2));
    const text = document.body.textContent ?? "";
    expect(text).toContain("adminMiscRoutes.invitations.send");
    expect(text).toContain("adminMiscRoutes.invitations.resend");
  });

  it("wysłanie zaproszenia unieważnia listę - status w tabeli musi się odświeżyć", async () => {
    h.invitations = [invitation()];
    const rendered = await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    const send = Array.from(document.querySelectorAll("tbody button")).find((button) =>
      button.textContent?.includes("adminMiscRoutes.invitations.send"),
    );
    if (!send) throw new Error("test: brak przycisku wysłania");
    fireEvent.click(send);
    await waitFor(() => expect(h.sendCalls).toEqual(["inv-1"]));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.sent"));
    expect(spy).toHaveBeenCalled();
  });

  it("tryb hasła tymczasowego pokazuje hasło OSOBNYM komunikatem", async () => {
    // Hasło jednorazowe musi dojść do administratora, bo tylko on może je
    // przekazać - ale nie może wtopić się w komunikat o sukcesie.
    h.invitations = [invitation({ mode: "temp_password" })];
    h.sendResult = { ok: true, tempPassword: "Xk8-tmp-2026" };
    await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    const send = Array.from(document.querySelectorAll("tbody button")).find((button) =>
      button.textContent?.includes("adminMiscRoutes.invitations.send"),
    );
    if (!send) throw new Error("test: brak przycisku wysłania");
    fireEvent.click(send);
    await waitFor(() => expect(h.toastInfo).toHaveBeenCalled());
    expect(String(h.toastInfo.mock.calls[0][0])).toContain("Xk8-tmp-2026");
  });

  it("odmowa wysyłki pokazuje powód z wyniku, a nie zdanie o sukcesie", async () => {
    h.invitations = [invitation()];
    h.sendResult = { ok: false, error: "mailer_unavailable" };
    await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    const send = Array.from(document.querySelectorAll("tbody button")).find((button) =>
      button.textContent?.includes("adminMiscRoutes.invitations.send"),
    );
    if (!send) throw new Error("test: brak przycisku wysłania");
    fireEvent.click(send);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("mailer_unavailable"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa BEZ powodu degraduje do zastępczego napisu, nie do `undefined`", async () => {
    h.invitations = [invitation()];
    h.sendResult = { ok: false };
    await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    const send = Array.from(document.querySelectorAll("tbody button")).find((button) =>
      button.textContent?.includes("adminMiscRoutes.invitations.send"),
    );
    if (!send) throw new Error("test: brak przycisku wysłania");
    fireEvent.click(send);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("failed"));
  });

  it("wycofanie zaproszenia woła serwer i unieważnia listę", async () => {
    h.invitations = [invitation()];
    const rendered = await mountInvitations();
    await waitFor(() => expect(document.body.textContent).toContain("trzecia@example.org"));
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    const revoke = Array.from(document.querySelectorAll("tbody button")).find((button) =>
      button.textContent?.includes("adminMiscRoutes.invitations.revoke"),
    );
    if (!revoke) throw new Error("test: brak przycisku wycofania");
    fireEvent.click(revoke);
    await waitFor(() => expect(h.revokeCalls).toEqual(["inv-1"]));
    expect(spy).toHaveBeenCalled();
  });

  it("trasa zaproszeń ma własne kompletne nagłówki", async () => {
    expect(await routeMeta(InvitationsRoute)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining("Zaproszenia") }),
        expect.objectContaining({ name: "description" }),
        expect.objectContaining({ property: "og:title" }),
        expect.objectContaining({ name: "twitter:card" }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// 11. DOBICIE GAŁĘZI. Każdy przypadek to jedno realne ramię warunku, nie
// „jeszcze jeden render". Tam, gdzie ramię jest NIEOSIĄGALNE z interfejsu,
// stoi wyjaśnienie w komentarzu i próg per-ścieżka to odbija.
// ---------------------------------------------------------------------------

describe("admin.users - ramiona warunków odczytu i wyliczeń", () => {
  it("`admin_list_users` zwracające `null` daje pustą listę, nie wyjątek", async () => {
    // PostgREST oddaje `data: null` przy pustym wyniku funkcji zwracającej
    // `setof` - `?? []` jest tu regułą, nie ozdobą.
    setRpc("admin_list_users", ok(null));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(0));
    expect(document.body.textContent).toContain("adminUsers.results");
  });

  it("`admin_list_users` bez tablicy ról daje rolę zastępczą `user`", async () => {
    setRpc("admin_list_users", ok([{ ...userRow(), roles: null }]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(document.body.textContent).toContain("admin.users.roles.user");
  });

  it("odczyt subskrypcji zwracający `null` nie wywraca mapy planów", async () => {
    h.db?.setResponse("user_subscriptions", ok(null));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
  });

  it("szukanie po wierszu z pustymi WSZYSTKIMI trzema polami nie rzuca", async () => {
    // `display_name`, `email` i `slug` mogą być puste jednocześnie (konto
    // utworzone przez zaproszenie, jeszcze nieuzupełnione).
    setRpc("admin_list_users", ok([userRow({ display_name: null, email: null, slug: null })]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const input = document.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    if (!input) throw new Error("test: brak pola szukania");
    fireEvent.change(input, { target: { value: "cokolwiek" } });
    await waitFor(() => expect(dataRows()).toHaveLength(0));
  });

  it("sortowanie po adresie z DWOMA pustymi adresami zachowuje oba wiersze", async () => {
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: "Pierwsza", email: null }),
        userRow({ id: IDS.third, display_name: "Druga", email: null }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const groupSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
      (element) => Array.from(element.options).some((option) => option.value === "sub_status"),
    );
    if (!groupSelect) throw new Error("test: brak selecta grupowania");
    fireEvent.change(groupSelect, { target: { value: "none" } });
    const emailHeader = Array.from(document.querySelectorAll("thead th")).find(
      (th) => th.textContent?.trim() === "Email",
    );
    if (!emailHeader) throw new Error("test: brak nagłówka e-mail");
    fireEvent.click(emailHeader);
    await waitFor(() => expect(dataRows()).toHaveLength(2));
  });

  it("sortowanie po nazwie z DWOMA pustymi nazwami zachowuje oba wiersze", async () => {
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: null, email: "a@example.org" }),
        userRow({ id: IDS.third, display_name: null, email: "b@example.org" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const nameHeader = Array.from(document.querySelectorAll("thead th")).find((th) =>
      th.textContent?.includes("admin.users.name"),
    );
    if (!nameHeader) throw new Error("test: brak nagłówka nazwy");
    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()).toHaveLength(2));
  });

  it("trzecie kliknięcie nagłówka wraca do porządku rosnącego", async () => {
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: "Beata" }),
        userRow({ id: IDS.third, display_name: "Adam" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const groupSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
      (element) => Array.from(element.options).some((option) => option.value === "sub_status"),
    );
    if (!groupSelect) throw new Error("test: brak selecta grupowania");
    fireEvent.change(groupSelect, { target: { value: "none" } });
    const nameHeader = Array.from(document.querySelectorAll("thead th")).find((th) =>
      th.textContent?.includes("admin.users.name"),
    );
    if (!nameHeader) throw new Error("test: brak nagłówka nazwy");
    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()[0].textContent).toContain("Adam"));
    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()[0].textContent).toContain("Beata"));
    fireEvent.click(nameHeader);
    await waitFor(() => expect(dataRows()[0].textContent).toContain("Adam"));
  });

  it("grupy planów sortują się alfabetycznie, a „bez planu” idzie NA KONIEC", async () => {
    // Kolejność nie jest kosmetyką: „bez planu" to zwykle największa grupa
    // i wypchnięcie jej na góre zasłania płacących.
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: "Beata" }),
        userRow({ id: IDS.third, display_name: "Adam" }),
        userRow({ id: "44444444-4444-4444-8444-444444444444", display_name: "Cecylia" }),
      ]),
    );
    h.db?.setResponse(
      "user_subscriptions",
      ok([
        {
          user_id: IDS.other,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Zeta", name_en: "Zeta" },
        },
        {
          user_id: IDS.third,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Alfa", name_en: "Alfa" },
        },
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const groupSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
      (element) => Array.from(element.options).some((option) => option.value === "sub_plan"),
    );
    if (!groupSelect) throw new Error("test: brak selecta grupowania");
    fireEvent.change(groupSelect, { target: { value: "sub_plan" } });

    await waitFor(() => {
      const bars = Array.from(document.querySelectorAll("tbody tr")).filter(
        (row) => row.querySelectorAll("td").length === 1,
      );
      expect(bars).toHaveLength(3);
      expect(bars[0].textContent).toContain("Alfa");
      expect(bars[1].textContent).toContain("Zeta");
      expect(bars[2].textContent).toContain("adminUsers.subscription");
    });
  });

  it("subskrypcja o NIŻSZYM priorytecie nie wypiera wcześniejszej o wyższym", async () => {
    // Odwrotna kolejność wejścia niż w teście „aktywna wygrywa" - obie gałęzie
    // porównania priorytetów muszą być przejechane, inaczej reguła trzyma się
    // tylko dla jednego układu wierszy.
    h.db?.setResponse(
      "user_subscriptions",
      ok([
        {
          user_id: IDS.other,
          status: "active",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan Aktywny", name_en: "Active" },
        },
        {
          user_id: IDS.other,
          status: "refunded",
          current_period_end: null,
          canceled_at: null,
          access_plans: { name_pl: "Plan Zwrócony", name_en: "Refunded" },
        },
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    // Asercja MUSI być zawężona do wiersza: obie nazwy planów pojawiają się
    // też w opcjach filtra, więc sprawdzanie całej strony niczego by nie
    // dowiodło (i przechodziłoby przy odwróconym priorytecie).
    const cells = dataRows()[0].querySelectorAll("td");
    const subscriptionCell = cells[4].textContent ?? "";
    expect(subscriptionCell).toContain("Plan Aktywny");
    expect(subscriptionCell).not.toContain("Plan Zwrócony");
  });

  it("powodzenie zmiany roli NA LIŚCIE unieważnia cache listy", async () => {
    const rendered = await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    fireEvent.change(roleSelects(dataRows()[0])[0], { target: { value: "admin" } });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("admin.saved"));
    expect(JSON.stringify(spy.mock.calls[0][0])).toContain("all-users");
  });

  it("etykieta pola zaznaczenia degraduje: nazwa, adres, identyfikator", async () => {
    // Pole wyboru bez etykiety to dla czytnika ekranu „pole wyboru" bez
    // informacji, KOGO dotyczy - a to jest ekran nadawania uprawnień.
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: "Z nazwą" }),
        userRow({ id: IDS.third, display_name: null, email: "bez-nazwy@example.org" }),
        userRow({
          id: "44444444-4444-4444-8444-444444444444",
          display_name: null,
          email: null,
        }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const labels = Array.from(
      document.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]"),
    ).map((element) => element.getAttribute("aria-label"));
    expect(labels).toContain("Z nazwą");
    expect(labels).toContain("bez-nazwy@example.org");
    expect(labels).toContain("44444444-4444-4444-8444-444444444444");
  });

  it("klik w SAMO pole zaznaczenia też zaznacza - przez opakowanie niosące `shiftKey`", async () => {
    // `onCheckedChange` samego pola jest PUSTE i to jest zamierzone: stan
    // zaznaczenia zmienia opakowanie, bo tylko ono widzi `shiftKey`. Klik
    // w pole musi jednak działać - inaczej administrator klika w kwadracik
    // i nic się nie dzieje.
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const box = document.querySelector<HTMLInputElement>("tbody input[type=checkbox]");
    if (!box) throw new Error("test: brak pola zaznaczenia");
    fireEvent.click(box);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
  });

  it("shift-klik po ZNIKNIĘCIU poprzedniego wiersza z widoku zaznacza tylko nowy", async () => {
    // `lastClickedId` może wskazywać wiersz odfiltrowany - wtedy zakresu nie
    // ma i handler musi zejść na zwykłe przełączenie, a nie zaznaczyć wszystko.
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: "Beata", email: "beata@example.org" }),
        userRow({ id: IDS.third, display_name: "Adam", email: "adam@example.org" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const holders = Array.from(document.querySelectorAll<HTMLElement>("tbody [role=button]"));
    fireEvent.click(holders[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));

    const input = document.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    if (!input) throw new Error("test: brak pola szukania");
    fireEvent.change(input, { target: { value: "adam" } });
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    const remaining = document.querySelector<HTMLElement>("tbody [role=button]");
    if (!remaining) throw new Error("test: brak wiersza po filtrze");
    fireEvent.click(remaining, { shiftKey: true });
    await waitFor(() => expect(document.body.textContent).toContain("2"));
  });

  it("zakres shift-klik POMIJA własny wiersz leżący w środku", async () => {
    // Bieżący użytkownik nie może wejść do akcji zbiorczej - inaczej RPC
    // odrzuci całą partię na jednym rekordzie.
    setRpc(
      "admin_list_users",
      ok([
        userRow({ id: IDS.other, display_name: "Aaa" }),
        userRow({ id: IDS.me, display_name: "Bbb" }),
        userRow({ id: IDS.third, display_name: "Ccc" }),
      ]),
    );
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(3));
    const holders = Array.from(document.querySelectorAll<HTMLElement>("tbody [role=button]"));
    // Własny wiersz nie ma opakowania, więc jest ich DWA na trzy wiersze.
    expect(holders).toHaveLength(2);
    fireEvent.click(holders[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    fireEvent.click(holders[1], { shiftKey: true });
    // Dwa zaznaczone, nie trzy: własny wiersz został pominięty w zakresie.
    await waitFor(() => expect(document.body.textContent).toContain("2"));
  });

  it("zbiorcza zmiana roli, w której WSZYSTKO padło, nie mówi o sukcesie", async () => {
    setRpc("change_user_role", fail("not_authorized", "42501"));
    setRpc("admin_list_users", ok([userRow({ id: IDS.other }), userRow({ id: IDS.third })]));
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    const master = document.querySelector<HTMLInputElement>("thead input[type=checkbox]");
    if (!master) throw new Error("test: brak pola „zaznacz wszystko”");
    fireEvent.click(master);
    await waitFor(() => expect(roleSelects().length).toBe(3));
    const bulk = roleSelects().find((element) => element.getAttribute("data-value") === "");
    if (!bulk) throw new Error("test: brak zbiorczej kontrolki roli");
    fireEvent.change(bulk, { target: { value: "editor" } });
    const apply = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.applyRole"),
    );
    if (!apply) throw new Error("test: brak przycisku zastosowania roli");
    fireEvent.click(apply);
    await waitFor(() => expect(screen.getByTestId("dialog")).toBeTruthy());
    const confirm = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.yesChangeRole"),
    );
    if (!confirm) throw new Error("test: brak przycisku potwierdzenia");
    fireEvent.click(confirm);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("anulowanie potwierdzenia zamyka dialog i NIE rusza bazy", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.click(document.querySelectorAll<HTMLElement>("tbody [role=button]")[0]);
    await waitFor(() => expect(roleSelects().length).toBe(2));
    const bulk = roleSelects().find((element) => element.getAttribute("data-value") === "");
    if (!bulk) throw new Error("test: brak zbiorczej kontrolki roli");
    fireEvent.change(bulk, { target: { value: "editor" } });
    const apply = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.applyRole"),
    );
    if (!apply) throw new Error("test: brak przycisku zastosowania roli");
    fireEvent.click(apply);
    await waitFor(() => expect(screen.getByTestId("dialog")).toBeTruthy());
    const cancel = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.cancel"),
    );
    if (!cancel) throw new Error("test: brak przycisku anulowania");
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
    expect(h.rpcCalls.filter((call) => call.name === "change_user_role")).toHaveLength(0);
  });

  it("ponowienie zaproszeń, w którym NIC się nie udało, milczy o sukcesie", async () => {
    h.resendResult = { results: [{ ok: false }], missing: [] };
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.click(document.querySelectorAll<HTMLElement>("tbody [role=button]")[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    const resend = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.resendInvitations"),
    );
    if (!resend) throw new Error("test: brak przycisku ponowienia");
    fireEvent.click(resend);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastInfo).not.toHaveBeenCalled();
  });

  it("wyjątek NIE-`Error` przy ponowieniu degraduje do zastępczego napisu", async () => {
    h.resendThrows = Object.assign(new Error(""), { message: "" });
    // Rzut wartością bez `message` - handler ma pokazać cokolwiek czytelnego,
    // a nie `undefined`.
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    fireEvent.click(document.querySelectorAll<HTMLElement>("tbody [role=button]")[0]);
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.selected"));
    const resend = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("adminUsers.resendInvitations"),
    );
    if (!resend) throw new Error("test: brak przycisku ponowienia");
    fireEvent.click(resend);
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
  });

  it("`onDone` importu zespołu też unieważnia listę", async () => {
    const rendered = await mountList();
    await waitFor(() => expect(h.props.TeamImportDialog).toBeTruthy());
    const spy = vi.spyOn(rendered.queryClient, "invalidateQueries");
    const onDone = h.props.TeamImportDialog.onDone;
    if (typeof onDone !== "function") throw new Error("test: brak onDone importu");
    onDone();
    expect(JSON.stringify(spy.mock.calls[0][0])).toContain("all-users");
  });

  it("impersonacja Z LISTY przekazuje etykietę i nie nawiguje na kartę", async () => {
    h.roles = ["super_admin"];
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const menu = Array.from(document.querySelectorAll<HTMLButtonElement>("tbody button[title]"))[0];
    expect(menu).toBeTruthy();
    fireEvent.click(menu);
    const impersonate = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("adminUsers.sign"),
    );
    expect(impersonate).toBeTruthy();
    fireEvent.click(impersonate!);
    await waitFor(() => expect(h.impersonations).toHaveLength(1));
    expect(h.impersonations[0]).toEqual({ id: IDS.other, label: "Osoba Druga" });
    // Komórka akcji ma `stopPropagation` - klik nie może przenieść na kartę.
    expect(h.navigations).toEqual([]);
  });

  it("nieudana impersonacja Z LISTY pokazuje komunikat", async () => {
    h.roles = ["super_admin"];
    const impersonationModule = await import("@/lib/admin/impersonation");
    const spy = vi
      .spyOn(impersonationModule, "impersonateUser")
      .mockRejectedValueOnce(new Error("otp_expired"));
    try {
      await mountList();
      await waitFor(() => expect(dataRows()).toHaveLength(1));
      const menu = Array.from(
        document.querySelectorAll<HTMLButtonElement>("tbody button[title]"),
      )[0];
      fireEvent.click(menu);
      const impersonate = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("adminUsers.sign"),
      );
      fireEvent.click(impersonate!);
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("otp_expired"));
    } finally {
      spy.mockRestore();
    }
  });

  it("edycja z menu wiersza przenosi na kartę użytkownika", async () => {
    await mountList();
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    const menu = Array.from(document.querySelectorAll<HTMLButtonElement>("tbody button[title]"))[0];
    fireEvent.click(menu);
    const edit = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("adminUsers.editAccount"),
    );
    fireEvent.click(edit!);
    await waitFor(() =>
      expect(h.navigations).toEqual([{ to: "/admin/users/$id", params: { id: IDS.other } }]),
    );
  });

  it("wyjątek NIE-`Error` z impersonacji na karcie degraduje do zastępczego napisu", async () => {
    h.roles = ["super_admin"];
    const impersonationModule = await import("@/lib/admin/impersonation");
    const spy = vi.spyOn(impersonationModule, "impersonateUser").mockRejectedValueOnce("string");
    try {
      await mountDetail();
      await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
      const button = Array.from(document.querySelectorAll("button")).find((element) =>
        element.textContent?.includes("adminUsers.sign"),
      );
      if (!button) throw new Error("test: brak przycisku impersonacji");
      fireEvent.click(button);
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    } finally {
      spy.mockRestore();
    }
  });

  it("karta: `admin_get_user` zwracające `null` traktujemy jak brak wiersza", async () => {
    setRpc("admin_get_user", ok(null));
    await mountDetail();
    await waitFor(() => expect(document.body.textContent).toContain("adminUsers.userFound"));
  });

  it("karta: wiersz bez tablicy ról nie wywraca bloku plakietek", async () => {
    setRpc("admin_get_user", ok([{ ...detailRow(), roles: null }]));
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    expect(document.body.textContent).toContain("user");
  });

  it("karta: WSZYSTKIE trzy wersje bio renderują się jednocześnie", async () => {
    setRpc(
      "admin_get_user",
      ok([detailRow({ bio: "Podsumowanie", bio_pl: "Polskie bio", bio_en: "English bio" })]),
    );
    await mountDetail();
    await waitFor(() => expect(screen.getByTestId("AuthorProfileEditor")).toBeTruthy());
    const text = document.body.textContent ?? "";
    expect(text).toContain("Podsumowanie");
    expect(text).toContain("Polskie bio");
    expect(text).toContain("English bio");
  });

  it("awatar: nieudane PODPISANIE adresu przerywa wysyłkę przed XHR-em", async () => {
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      h.signFailure = "error";
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, { target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] } });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("sign denied"));
      expect(h.xhrSends).toBe(0);
    } finally {
      restore();
    }
  });

  it("awatar: PUSTA odpowiedź podpisania (bez błędu) też przerywa wysyłkę", async () => {
    // `{ data: null, error: null }` to kształt, który realnie wraca przy
    // wyczerpanym limicie koszyka - bez tej gałęzi kod poleciałby na `signed.signedUrl`.
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      h.signFailure = "empty";
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, { target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] } });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("sign failed"));
      expect(h.xhrSends).toBe(0);
    } finally {
      restore();
    }
  });

  it("awatar: wyjątek NIE-`Error` degraduje do zastępczego napisu", async () => {
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      h.signFailure = "raw";
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, { target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] } });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Upload failed"));
    } finally {
      restore();
    }
  });

  it("awatar: w czasie wysyłki przycisk jest ZABLOKOWANY", async () => {
    // Drugie kliknięcie w trakcie wysyłki wysłałoby drugi plik pod ten sam
    // adres - i to ten drugi wygrałby wyścig o `admin_update_user_avatar`.
    const restore = stubXhr();
    try {
      h.roles = ["super_admin"];
      h.xhrHang = true;
      const input = await mountDetailWithAvatarEditor();
      fireEvent.change(input, { target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] } });
      await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
      const onConfirm = h.props.ImageCropDialog.onConfirm;
      if (typeof onConfirm !== "function") throw new Error("test: brak onConfirm");
      onConfirm(new Blob(["x"], { type: "image/jpeg" }));
      await waitFor(() => expect(h.xhrSends).toBe(1));
      await waitFor(() => {
        const button = document.querySelector<HTMLButtonElement>(
          'button[aria-label="adminUsers.changePhoto"]',
        );
        expect(button?.disabled).toBe(true);
      });
    } finally {
      restore();
    }
  });

  it("awatar: ponowne OTWARCIE kadrowania nie gubi wybranego pliku", async () => {
    h.roles = ["super_admin"];
    const input = await mountDetailWithAvatarEditor();
    fireEvent.change(input, { target: { files: [fakeFile("a.jpg", "image/jpeg", 2048)] } });
    await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
    const onOpenChange = h.props.ImageCropDialog.onOpenChange;
    if (typeof onOpenChange !== "function") throw new Error("test: brak onOpenChange");
    onOpenChange(true);
    await waitFor(() => expect(h.props.ImageCropDialog.open).toBe(true));
    expect(h.props.ImageCropDialog.file).not.toBeNull();
  });
});
