// AuthProvider/useAuth/useRequiredTenant: kontekst spiny sesję Supabase,
// role/tenant, re-gating cache'u po zmianie tożsamości i merge personalizacji
// anonima. Wszystko za route guard'ami i nagłówkiem - stąd nacisk na dedupe
// startowego ładowania kontekstu i na to, że signOut() nigdy nie wywala się.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  unsub: vi.fn(),
  getSessionResult: { data: { session: null as unknown } },
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
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        if (h.throwOnSubscribe) throw new Error("subscribe unavailable");
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: h.unsub } } };
      },
      getSession: () => Promise.resolve(h.getSessionResult),
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
  },
}));

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

import { AuthProvider, useAuth, useRequiredTenant } from "@/hooks/useAuth";

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
  vi.restoreAllMocks();
});

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
