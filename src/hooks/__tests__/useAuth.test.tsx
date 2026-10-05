// AuthProvider/useAuth/useRequiredTenant: kontekst spiny sesję Supabase,
// role/tenant, re-gating cache'u po zmianie tożsamości i merge personalizacji
// anonima. Wszystko za route guard'ami i nagłówkiem - stąd nacisk na dedupe
// startowego ładowania kontekstu i na to, że signOut() nigdy nie wywala się.
//
// ATRAPA KLIENTA ZACHOWUJE SIĘ JAK `client.ts` (P1.7): pierwszy dostęp do
// `supabase` zgłasza utworzenie klienta do PRAWDZIWEGO rejestru
// (`sessionHint.ts`), a `h.touches` liczy dostępy. Domyślnie klient już
// istnieje (jak na stronie, której zapytania o dane utworzyły go przy
// hydratacji) - gość od startu podpina wtedy nasłuch od razu. Blok
// „szybka ścieżka gościa" zaczyna od stanu „klienta jeszcze nie ma".
import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  unsub: vi.fn(),
  getSessionResult: { data: { session: null as unknown } },
  /** Podstawiona obietnica `getSession()` - dla scenariuszy „wisi" i „odrzuca". */
  getSessionPromise: null as Promise<{ data: { session: unknown } }> | null,
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  rolesRows: [] as { role: string }[],
  profileRow: null as { tenant_id: string } | null,
  rolesPromise: null as Promise<{ data: { role: string }[] }> | null,
  profilePromise: null as Promise<{ data: { tenant_id: string } | null }> | null,
  hasAnon: vi.fn().mockReturnValue(false),
  mergeAnon: vi.fn().mockResolvedValue(undefined),
  settingsMap: {} as Record<string, unknown>,
  settingsShouldReject: false,
  throwOnSubscribe: false,
  fromCalls: [] as string[],
  /** Dostępy do `supabase` (każdy tworzyłby klienta, gdyby go nie było). */
  touches: 0,
  getSessionCalls: 0,
  subscribeCalls: 0,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { markSupabaseClientCreated } = await import("@/integrations/supabase/sessionHint");
  const client = {
    rpc: h.rpc,
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        if (h.throwOnSubscribe) throw new Error("subscribe unavailable");
        h.subscribeCalls += 1;
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: h.unsub } } };
      },
      getSession: () => {
        h.getSessionCalls += 1;
        return h.getSessionPromise ?? Promise.resolve(h.getSessionResult);
      },
      signOut: h.signOutMock,
    },
    from: (table: string) => {
      h.fromCalls.push(table);
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: () => h.rolesPromise ?? Promise.resolve({ data: h.rolesRows }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => h.profilePromise ?? Promise.resolve({ data: h.profileRow }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return {
    // Jak `client.ts`: klient powstaje przy pierwszym dostępie i zgłasza to.
    supabase: new Proxy(client, {
      get(target, prop, receiver) {
        h.touches += 1;
        markSupabaseClientCreated();
        return Reflect.get(target, prop, receiver);
      },
    }),
  };
});

vi.mock("@/lib/personalization/anonMerge", () => ({
  hasAnonPersonalization: () => h.hasAnon(),
  mergeAnonPersonalization: (uid: string, qc: unknown) => h.mergeAnon(uid, qc),
}));

vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => {
      if (h.settingsShouldReject) throw new Error("settings unavailable");
      return h.settingsMap;
    },
  },
  resolveSetting: (map: Record<string, unknown> | undefined, key: string, defaults: object) => ({
    ...defaults,
    ...((map?.[key] as object) ?? {}),
  }),
}));

import {
  AuthProvider,
  ROLE_SETTLE_TIMEOUT_MS,
  SESSION_SETTLE_TIMEOUT_MS,
  useAuth,
  useRequiredTenant,
} from "@/hooks/useAuth";
import {
  __resetSupabaseClientRegistryForTests,
  markSupabaseClientCreated,
} from "@/integrations/supabase/sessionHint";

/** Klucz, pod którym klient Supabase trzyma sesję dla `placeholder.supabase.co`. */
const STORED_SESSION_KEY = "sb-placeholder-auth-token";

function makeSession(uid: string, accessToken = "tok") {
  return { user: { id: uid }, access_token: accessToken };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function Probe() {
  const { session, roles, loading, isStaff, isAdmin, isSuperAdmin, signOut } = useAuth();
  return (
    <div>
      <span data-testid="uid">{session?.user?.id ?? "anon"}</span>
      <span data-testid="token">
        {(session as { access_token?: string } | null)?.access_token ?? ""}
      </span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="roles">{roles.join(",")}</span>
      <span data-testid="isStaff">{String(isStaff)}</span>
      <span data-testid="isAdmin">{String(isAdmin)}</span>
      <span data-testid="isSuperAdmin">{String(isSuperAdmin)}</span>
      <button type="button" onClick={() => void signOut()}>
        wyloguj
      </button>
    </div>
  );
}

function TenantProbe() {
  const tenantId = useRequiredTenant();
  return <span data-testid="tenant">{tenantId}</span>;
}

// Renderuje TenantProbe TYLKO gdy tenantId jest już znany - inaczej throw
// z useRequiredTenant() wywaliłby całe drzewo (brak error boundary), zanim
// SIGNED_IN zdąży dostarczyć profil.
function TenantGate() {
  const { tenantId } = useAuth();
  if (!tenantId) return <span data-testid="tenant-status">brak-tenanta</span>;
  return <TenantProbe />;
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderProbe(qc = newQueryClient()) {
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

let originalLocation: Location;

beforeEach(() => {
  h.authCb = null;
  h.unsub.mockReset();
  h.getSessionResult = { data: { session: null } };
  h.getSessionPromise = null;
  h.signOutMock.mockReset().mockResolvedValue({ error: null });
  h.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  h.rolesRows = [];
  h.profileRow = null;
  h.rolesPromise = null;
  h.profilePromise = null;
  h.hasAnon.mockReset().mockReturnValue(false);
  h.mergeAnon.mockReset().mockResolvedValue(undefined);
  h.settingsMap = {};
  h.settingsShouldReject = false;
  h.throwOnSubscribe = false;
  h.fromCalls = [];
  h.touches = 0;
  h.getSessionCalls = 0;
  h.subscribeCalls = 0;
  window.localStorage.clear();
  // Domyślnie klient już istnieje (patrz nagłówek pliku).
  __resetSupabaseClientRegistryForTests();
  markSupabaseClientCreated();

  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign: vi.fn() },
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
    writable: true,
  });
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** Sesja zapisana w magazynie: AuthProvider idzie ścieżką z SDK (nie gościa). */
function storeSession() {
  window.localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ access_token: "tok" }));
}

describe("AuthProvider - montaż i sesja startowa", () => {
  it("czysty montaż bez sesji: loading kończy się na false, brak ról, zero from()", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("uid")).toHaveTextContent("anon");
    expect(screen.getByTestId("roles")).toHaveTextContent("");
    expect(h.fromCalls).toEqual([]);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("INITIAL_SESSION + zgodne getSession(): jedno wczytanie kontekstu (dedupe)", async () => {
    storeSession();
    const session = makeSession("u1");
    h.getSessionResult = { data: { session } };
    h.rolesRows = [{ role: "editor" }];
    h.profileRow = { tenant_id: "tenant-1" };
    const invitation = createDeferred<{ data: null; error: null }>();
    h.rpc.mockReturnValue(invitation.promise);

    renderProbe();
    act(() => {
      h.authCb!("INITIAL_SESSION", session);
      h.authCb!("INITIAL_SESSION", session);
    });

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("roles")).toHaveTextContent("editor");
    expect(h.fromCalls.filter((t) => t === "user_roles")).toHaveLength(1);
    expect(h.fromCalls.filter((t) => t === "profiles")).toHaveLength(1);
    // Invitation bookkeeping must not delay the usable auth context, and a
    // repeated initial session must not make a second request.
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("accept_my_user_invitation");
    invitation.resolve({ data: null, error: null });
  });
});

describe("AuthProvider - re-gating przy zmianie tożsamości", () => {
  it("SIGNED_IN dla nowego uid inwaliduje cache; powtórka dla tego samego uid jest no-opem", async () => {
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const session = makeSession("u2");
    await act(async () => {
      h.authCb!("SIGNED_IN", session);
    });
    await waitFor(() => expect(screen.getByTestId("uid")).toHaveTextContent("u2"));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["public", "resolved"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unlocked-body"] });
    const callsAfterFirst = invalidateSpy.mock.calls.length;

    await act(async () => {
      h.authCb!("SIGNED_IN", session);
    });
    expect(invalidateSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("SIGNED_OUT po zalogowaniu: ponowna inwalidacja i wyczyszczenie ról/tenant", async () => {
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.rolesRows = [{ role: "admin" }];
    h.profileRow = { tenant_id: "t9" };
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u3"));
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("admin"));

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const fromCallsBefore = h.fromCalls.length;

    await act(async () => {
      h.authCb!("SIGNED_OUT", null);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["public", "resolved"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unlocked-body"] });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent(""));
    expect(screen.getByTestId("uid")).toHaveTextContent("anon");
    // uid null -> ensureContext nie odpytuje from() ponownie.
    expect(h.fromCalls.length).toBe(fromCallsBefore);
  });

  it("TOKEN_REFRESHED: aktualizuje tylko sesję, bez inwalidacji i bez nowych from()", async () => {
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.rolesRows = [{ role: "author" }];
    const session = makeSession("u4");
    await act(async () => {
      h.authCb!("SIGNED_IN", session);
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("author"));

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const fromCallsBefore = h.fromCalls.length;
    await act(async () => {
      h.authCb!("TOKEN_REFRESHED", { ...session, access_token: "new-token" });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(h.fromCalls.length).toBe(fromCallsBefore);
    expect(screen.getByTestId("uid")).toHaveTextContent("u4");
    expect(screen.getByTestId("token")).toHaveTextContent("new-token");
  });
  it("TOKEN_REFRESHED z sesją innego konta po starcie: inwalidacja cache'u i kontekst nowego konta", async () => {
    storeSession();
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.rolesRows = [{ role: "editor" }];
    await act(async () => {
      h.authCb!("INITIAL_SESSION", makeSession("u-podglad"));
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("editor"));

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const rolesCallsBefore = h.fromCalls.filter((t) => t === "user_roles").length;
    h.rolesRows = [{ role: "super_admin" }];
    // `setSession()` z przeterminowanym tokenem admina emituje samo TOKEN_REFRESHED.
    await act(async () => {
      h.authCb!("TOKEN_REFRESHED", makeSession("u-admin"));
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["public", "resolved"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unlocked-body"] });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("super_admin"));
    expect(screen.getByTestId("uid")).toHaveTextContent("u-admin");
    expect(h.fromCalls.filter((t) => t === "user_roles")).toHaveLength(rolesCallsBefore + 1);
  });

  it("TOKEN_REFRESHED przed INITIAL_SESSION ustala tożsamość startową - bez inwalidacji i bez drugiego wczytania", async () => {
    // Przeterminowany token LEŻY w magazynie - to nie jest gość od startu.
    storeSession();
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    h.rolesRows = [{ role: "author" }];
    const session = makeSession("u-start");
    // Przeterminowany token w magazynie: auth-js odświeża go w trakcie
    // inicjalizacji i TOKEN_REFRESHED dociera do nasłuchu przed INITIAL_SESSION.
    await act(async () => {
      h.authCb!("TOKEN_REFRESHED", session);
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("author"));
    await act(async () => {
      h.authCb!("INITIAL_SESSION", session);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(h.fromCalls.filter((t) => t === "user_roles")).toHaveLength(1);
    expect(screen.getByTestId("uid")).toHaveTextContent("u-start");
  });
});

describe("AuthProvider - flagi roli", () => {
  it("super_admin niesie za sobą isAdmin i isStaff; sam 'user' nie niesie żadnej", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.rolesRows = [{ role: "super_admin" }];
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u-role1"));
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("super_admin"));
    expect(screen.getByTestId("isSuperAdmin")).toHaveTextContent("true");
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("true");
    expect(screen.getByTestId("isStaff")).toHaveTextContent("true");

    h.rolesRows = [{ role: "user" }];
    await act(async () => {
      h.authCb!("SIGNED_OUT", null);
    });
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u-role2"));
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("user"));
    expect(screen.getByTestId("isSuperAdmin")).toHaveTextContent("false");
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("false");
    expect(screen.getByTestId("isStaff")).toHaveTextContent("false");
  });
});

describe("AuthProvider - scalanie personalizacji anonima", () => {
  it("SIGNED_IN + hasAnonPersonalization()=true wywołuje mergeAnon(uid, queryClient)", async () => {
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.hasAnon.mockReturnValue(true);
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u5"));
    });
    await waitFor(() => expect(h.mergeAnon).toHaveBeenCalledWith("u5", qc));
  });

  it("hasAnonPersonalization()=false: mergeAnon nigdy nie jest wywoływany", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.hasAnon.mockReturnValue(false);
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u6"));
    });
    await waitFor(() => expect(screen.getByTestId("uid")).toHaveTextContent("u6"));
    expect(h.mergeAnon).not.toHaveBeenCalled();
  });

  it("SIGNED_OUT: mergeAnon nigdy nie jest wywoływany, niezależnie od hasAnonPersonalization()", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.hasAnon.mockReturnValue(true);
    await act(async () => {
      h.authCb!("SIGNED_OUT", null);
    });
    expect(h.mergeAnon).not.toHaveBeenCalled();
  });

  it("odrzucenie mergeAnon jest tłumione (catch w źródle) i nie psuje aplikacji", async () => {
    h.hasAnon.mockReturnValue(true);
    h.mergeAnon.mockRejectedValueOnce(new Error("merge failed"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u7"));
    });
    await waitFor(() => expect(h.mergeAnon).toHaveBeenCalled());
    expect(screen.getByTestId("uid")).toHaveTextContent("u7");
  });
});

describe("AuthProvider - formuła loading", () => {
  it("sesja niepusta + role/profil w locie => loading=true aż do rozstrzygnięcia obu promisów", async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    const rolesDeferred = createDeferred<{ data: { role: string }[] }>();
    const profileDeferred = createDeferred<{ data: { tenant_id: string } | null }>();
    h.rolesPromise = rolesDeferred.promise;
    h.profilePromise = profileDeferred.promise;

    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u8"));
    });
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("true"));

    rolesDeferred.resolve({ data: [{ role: "editor" }] });
    profileDeferred.resolve({ data: { tenant_id: "t8" } });

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("roles")).toHaveTextContent("editor");
  });
});

describe("AuthProvider - signOut()", () => {
  it("przekierowuje na wewnętrzny adres z ustawień, czyści sesję i cache", async () => {
    h.settingsMap = { auth_branding: { logout_redirect_url: "/wyloguj-ok" } };
    const { qc } = renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    h.rolesRows = [{ role: "editor" }];
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u9"));
    });
    await waitFor(() => expect(screen.getByTestId("uid")).toHaveTextContent("u9"));

    const clearSpy = vi.spyOn(qc, "clear");
    fireEvent.click(screen.getByRole("button", { name: "wyloguj" }));

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("/wyloguj-ok"));
    expect(h.signOutMock).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("uid")).toHaveTextContent("anon"));
    expect(screen.getByTestId("roles")).toHaveTextContent("");
  });

  it.each(["//evil.example", "https://evil.example"])(
    "adres przekierowania '%s' nie jest wewnętrzny -> spada na '/'",
    async (badUrl) => {
      h.settingsMap = { auth_branding: { logout_redirect_url: badUrl } };
      renderProbe();
      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

      fireEvent.click(screen.getByRole("button", { name: "wyloguj" }));
      await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("/"));
    },
  );

  it("gdy odczyt ustawień się nie powiedzie, i tak kończy się i wraca na '/'", async () => {
    h.settingsShouldReject = true;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    fireEvent.click(screen.getByRole("button", { name: "wyloguj" }));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("/"));
    expect(h.signOutMock).toHaveBeenCalledTimes(1);
  });
});

describe("AuthProvider - degradacja, gdy klient Supabase jest niedostępny", () => {
  it("onAuthStateChange rzucający synchronicznie jest przechwycony: loading=false, sesja pusta, brak crasha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.throwOnSubscribe = true;
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("uid")).toHaveTextContent("anon");
    expect(h.fromCalls).toEqual([]);
  });
});

describe("useRequiredTenant()", () => {
  it("rzuca, gdy nie ma kontekstu tenanta", () => {
    expect(() => {
      render(
        <QueryClientProvider client={newQueryClient()}>
          <AuthProvider>
            <TenantProbe />
          </AuthProvider>
        </QueryClientProvider>,
      );
    }).toThrow(/Brak kontekstu tenanta/);
  });

  it("zwraca tenantId, gdy profil zalogowanego użytkownika się wczyta", async () => {
    render(
      <QueryClientProvider client={newQueryClient()}>
        <AuthProvider>
          <TenantGate />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("tenant-status")).toBeInTheDocument());

    h.rolesRows = [{ role: "user" }];
    h.profileRow = { tenant_id: "tenant-42" };
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u14"));
    });

    await waitFor(() => expect(screen.getByTestId("tenant")).toHaveTextContent("tenant-42"));
  });
});

it("keeps the signed-in context when invitation acceptance returns an error", async () => {
  storeSession();
  const session = makeSession("u1");
  h.getSessionResult = { data: { session } };
  h.rpc.mockResolvedValue({ data: null, error: { message: "temporarily unavailable" } });
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    renderProbe();
    act(() => h.authCb!("INITIAL_SESSION", session));
    await waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "[auth] invitation acceptance sync failed",
        "temporarily unavailable",
      ),
    );
    expect(screen.getByTestId("uid")).toHaveTextContent("u1");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  } finally {
    warning.mockRestore();
  }
});

// BRAMKA „BRAK SESJI" vs „NIE WIEMY".
//
// Powierzchnie chrome-only (checkout, profil, wiadomości, sieć kontaktów)
// renderują CTA logowania dopiero, gdy `loading` zejdzie - więc każda droga,
// na której `loading` może nie zejść NIGDY, jest tam wiecznym spinnerem.
// Te przypadki pilnują obu stron kontraktu: gość dostaje odpowiedź w
// ograniczonym czasie, a zalogowany NIE zostaje wylogowany przez awarię sieci.
describe("AuthProvider - rozstrzygnięcie gościa przy martwym backendzie", () => {
  it("pusty magazyn + wiszący getSession(): loading schodzi bez czekania na sieć", async () => {
    // Tak wygląda backend, który nie odpowiada: obietnica nie rozstrzyga się
    // nigdy. Pusty magazyn jest jednak odpowiedzią samą w sobie.
    h.getSessionPromise = new Promise(() => {});
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("uid")).toHaveTextContent("anon");
    expect(h.signOutMock).not.toHaveBeenCalled();
  });

  it("obcy klucz w magazynie nie udaje sesji Supabase", async () => {
    // Sonda magazynu rozpoznaje WYŁĄCZNIE klucze klienta Supabase
    // (`sb-<projekt>-auth-token`) - inaczej pierwszy lepszy zapis w
    // `localStorage` kazałby czekać gościowi na termin.
    window.localStorage.setItem("theme", "dark");
    h.getSessionPromise = new Promise(() => {});
    try {
      renderProbe();
      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
      expect(screen.getByTestId("uid")).toHaveTextContent("anon");
    } finally {
      window.localStorage.removeItem("theme");
    }
  });

  it("odrzucone getSession(): loading schodzi, magazyn i sesja nietknięte", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ access_token: "stary" }));
    const rejection = Promise.reject(new Error("net down"));
    rejection.catch(() => {});
    h.getSessionPromise = rejection as Promise<{ data: { session: unknown } }>;
    try {
      renderProbe();
      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
      expect(screen.getByTestId("uid")).toHaveTextContent("anon");
      // ODMOWA ODCZYTU TO NIE WYLOGOWANIE.
      expect(window.localStorage.getItem(STORED_SESSION_KEY)).not.toBeNull();
      expect(h.signOutMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "[auth] nie udało się odczytać sesji - traktujemy jak gościa",
        expect.any(Error),
      );
    } finally {
      window.localStorage.removeItem(STORED_SESSION_KEY);
    }
  });

  it("sesja w magazynie + wiszący getSession(): po terminie gość, bez wylogowania", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ access_token: "stary" }));
    h.getSessionPromise = new Promise(() => {});
    try {
      renderProbe();
      // Zanim termin upłynie, czekanie jest poprawne - token MOŻE być ważny.
      expect(screen.getByTestId("loading")).toHaveTextContent("true");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSION_SETTLE_TIMEOUT_MS);
      });

      expect(screen.getByTestId("loading")).toHaveTextContent("false");
      expect(screen.getByTestId("uid")).toHaveTextContent("anon");
      expect(window.localStorage.getItem(STORED_SESSION_KEY)).not.toBeNull();
      expect(h.signOutMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    } finally {
      window.localStorage.removeItem(STORED_SESSION_KEY);
      vi.useRealTimers();
    }
  });

  it("spóźniona sesja po terminie nadal loguje - termin znaczy nie wiemy", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ access_token: "stary" }));
    const late = createDeferred<{ data: { session: unknown } }>();
    h.getSessionPromise = late.promise;
    try {
      renderProbe();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SESSION_SETTLE_TIMEOUT_MS);
      });
      expect(screen.getByTestId("uid")).toHaveTextContent("anon");

      await act(async () => {
        late.resolve({ data: { session: makeSession("u-spozniony") } });
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(screen.getByTestId("uid")).toHaveTextContent("u-spozniony");
    } finally {
      window.localStorage.removeItem(STORED_SESSION_KEY);
      vi.useRealTimers();
    }
  });
});

describe("AuthProvider - termin na role i tenanta", () => {
  it("wiszące user_roles/profiles: po terminie loading schodzi, sesja zostaje", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rolesPromise = new Promise(() => {});
    h.profilePromise = new Promise(() => {});
    try {
      renderProbe();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      act(() => {
        h.authCb!("SIGNED_IN", makeSession("u-role-hang"));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByTestId("loading")).toHaveTextContent("true");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ROLE_SETTLE_TIMEOUT_MS);
      });

      expect(screen.getByTestId("loading")).toHaveTextContent("false");
      expect(screen.getByTestId("roles")).toHaveTextContent("");
      // Sesja zostaje - wiszące role to nie jest utrata tożsamości.
      expect(screen.getByTestId("uid")).toHaveTextContent("u-role-hang");
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("odrzucone user_roles/profiles są przechwycone, a nie puszczone w unhandledrejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rolesRejection = Promise.reject(new Error("net down"));
    rolesRejection.catch(() => {});
    h.rolesPromise = rolesRejection as Promise<{ data: { role: string }[] }>;

    renderProbe();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u-role-err"));
    });

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(warn).toHaveBeenCalledWith(
      "[auth] nie udało się wczytać ról i tenanta",
      expect.any(Error),
    );
    expect(screen.getByTestId("uid")).toHaveTextContent("u-role-err");
  });
});

// SZYBKA ŚCIEŻKA GOŚCIA (P1.7, F7).
//
// Pusty magazyn i adres bez parametrów auth = pewny gość: AuthProvider nie
// dotyka `supabase` wcale (bez inicjalizacji GoTrue, bez `getSession()`, bez
// żądań `/auth/v1`), a nasłuch sesji podpina się dopiero, gdy klienta utworzy
// ktoś inny. Każdy przypadek startuje bez klienta.
describe("AuthProvider - szybka ścieżka gościa", () => {
  beforeEach(() => {
    __resetSupabaseClientRegistryForTests();
  });

  it("gość bez klienta: zero dotknięć supabase, loading=false po pierwszym przebiegu efektów", () => {
    const seen: boolean[] = [];
    function Seen() {
      seen.push(useAuth().loading);
      return null;
    }
    render(
      <QueryClientProvider client={newQueryClient()}>
        <AuthProvider>
          <Probe />
          <Seen />
        </AuthProvider>
      </QueryClientProvider>,
    );
    // Bez `waitFor`: rozstrzygnięcie zapada w pierwszym przebiegu efektów
    // (render w `act` je opróżnia, razem z przejściem), bez czekania na
    // klienta. Pierwszy render to „nie wiemy" - parytet z HTML-em serwera.
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("uid")).toHaveTextContent("anon");
    expect(h.touches).toBe(0);
    expect(h.getSessionCalls).toBe(0);
    expect(h.authCb).toBeNull();
  });

  it("klient utworzony później przez kogokolwiek: nasłuch się podpina, SIGNED_IN loguje", async () => {
    const { qc } = renderProbe();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    expect(h.authCb).toBeNull();

    // Formularz logowania albo zapytanie o dane tworzy klienta.
    act(() => markSupabaseClientCreated());
    expect(h.authCb).not.toBeNull();
    expect(h.getSessionCalls).toBe(0);

    h.rolesRows = [{ role: "author" }];
    await act(async () => {
      h.authCb!("SIGNED_IN", makeSession("u-formularz"));
    });
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("author"));
    expect(screen.getByTestId("uid")).toHaveTextContent("u-formularz");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["public", "resolved"] });
  });

  it("INITIAL_SESSION bez sesji od klienta utworzonego przez zapytanie nie renderuje konsumentów", async () => {
    let renders = 0;
    function Counter() {
      renders += 1;
      const { loading } = useAuth();
      return <span data-testid="counter-loading">{String(loading)}</span>;
    }
    const qc = newQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Counter />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await act(async () => {});
    const before = renders;
    act(() => markSupabaseClientCreated());
    await act(async () => {
      h.authCb!("INITIAL_SESSION", null);
      h.authCb!("SIGNED_OUT", null);
    });
    expect(renders).toBe(before);
    expect(screen.getByTestId("counter-loading")).toHaveTextContent("false");
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(h.fromCalls).toEqual([]);
  });

  it("logowanie w innej karcie: zapis sesji w magazynie budzi klienta i loguje tę kartę", async () => {
    const { qc } = renderProbe();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    h.getSessionResult = { data: { session: makeSession("u-inna-karta") } };
    h.rolesRows = [{ role: "editor" }];

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORED_SESSION_KEY, newValue: '{"access_token":"t"}' }),
      );
    });

    await waitFor(() => expect(screen.getByTestId("uid")).toHaveTextContent("u-inna-karta"));
    await waitFor(() => expect(screen.getByTestId("roles")).toHaveTextContent("editor"));
    expect(h.getSessionCalls).toBe(1);
    // Klient powstał przy odczycie, a nasłuch podpiął się przed nim.
    expect(h.authCb).not.toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unlocked-body"] });
  });

  it("obcy klucz i usunięcie sesji w innej karcie nie budzą klienta", async () => {
    renderProbe();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "dark" }));
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORED_SESSION_KEY, newValue: null }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(h.touches).toBe(0);
    expect(screen.getByTestId("uid")).toHaveTextContent("anon");
  });

  it("powrót z linku magicznego: SDK od razu, loading czeka na SDK, a nie zgaduje gościa", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        ...window.location,
        search: "",
        hash: "#access_token=a&refresh_token=r&type=magiclink",
        assign: vi.fn(),
      },
    });
    const late = createDeferred<{ data: { session: unknown } }>();
    h.getSessionPromise = late.promise;
    renderProbe();
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(h.getSessionCalls).toBe(1);
    expect(h.authCb).not.toBeNull();

    await act(async () => {
      late.resolve({ data: { session: makeSession("u-link") } });
    });
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("uid")).toHaveTextContent("u-link");
  });

  it("StrictMode: podwójny montaż efektu nie dubluje nasłuchu po utworzeniu klienta", () => {
    render(
      <StrictMode>
        <QueryClientProvider client={newQueryClient()}>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(h.subscribeCalls).toBe(0);
    act(() => markSupabaseClientCreated());
    expect(h.subscribeCalls).toBe(1);
  });

  it("odmontowanie gościa wypisuje słuchacza utworzenia klienta i nasłuch magazynu", async () => {
    const { unmount } = renderProbe();
    unmount();
    act(() => markSupabaseClientCreated());
    expect(h.authCb).toBeNull();
    __resetSupabaseClientRegistryForTests();
    h.touches = 0;
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORED_SESSION_KEY, newValue: '{"access_token":"t"}' }),
    );
    expect(h.touches).toBe(0);
  });
});
