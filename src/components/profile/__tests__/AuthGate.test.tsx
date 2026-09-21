// BRAMKA TOŻSAMOŚCI NA POWIERZCHNI BEZ SERWEROWEJ TREŚCI.
//
// PO CO TEN PLIK ISTNIEJE. `AuthGate` ma dokładnie jedno zadanie: zamienić
// „nie ma sesji" na WIDOCZNE WYJŚCIE, czyli odnośnik do logowania. Dopóki
// `useAuth().loading` stoi, bramka pokazuje spinner - i to jest poprawne
// tylko wtedy, gdy `loading` ma GÓRNĄ GRANICĘ. Bez niej jedna wisząca
// obietnica (odświeżenie tokenu przy niedostępnym backendzie) zamienia
// `/profile`, `/people`, `/reading-list` i checkout w wieczny spinner, czego
// nie widać w żadnym teście samego `AuthGate` z zamockowanym `useAuth` -
// bo atrapa zawsze grzecznie odpowiada.
//
// Dlatego ten plik montuje PRAWDZIWY `AuthProvider` i podstawia wyłącznie
// granicę sieci (klient Supabase). Dowodzi dwóch rzeczy naraz:
//   1. martwy backend -> CTA logowania w OGRANICZONYM czasie;
//   2. sesja w `localStorage` + błąd sieci -> NIE wylogowuje (token zostaje,
//      `signOut()` nie idzie) - bo „nie wiemy" to nie to samo, co „brak sesji".
//
// Zaatrapowane, i nic ponadto: `@tanstack/react-router` (goły render
// `FriendlyErrorPage` nie ma kontekstu routera - ten sam powód i ten sam
// wspólny `RouterLinkStub`, co w `components/error/__tests__`),
// `@/lib/platform-error-reporting` (beacon do sieci) oraz `@/lib/useSiteSetting`
// (ścieżka wylogowania czyta ustawienia).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  authCb: null as null | ((event: string, session: unknown) => void),
  /** Obietnica `getSession()`. Domyślnie wisi - czyli backend nie odpowiada. */
  getSessionPromise: null as Promise<{ data: { session: unknown } }> | null,
  signOutMock: vi.fn().mockResolvedValue({ error: null }),
  rolesRows: [] as { role: string }[],
  profileRow: null as { tenant_id: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.authCb = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => h.getSessionPromise ?? new Promise(() => {}),
      signOut: h.signOutMock,
    },
    from: (table: string) => {
      if (table === "user_roles") {
        return { select: () => ({ eq: () => Promise.resolve({ data: h.rolesRows }) }) };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: h.profileRow }) }),
        }),
      };
    },
  },
}));

vi.mock("@/lib/personalization/anonMerge", () => ({
  hasAnonPersonalization: () => false,
  mergeAnonPersonalization: async () => {},
}));

vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => ({}),
  },
  resolveSetting: (_map: unknown, _key: string, defaults: object) => defaults,
}));

vi.mock("@/lib/platform-error-reporting", () => ({ reportPlatformError: () => {} }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: RouterLinkStub,
    useRouter: () => ({
      invalidate: () => Promise.resolve(),
      navigate: () => Promise.resolve(),
      history: { back: () => {} },
    }),
  };
});

import { AuthGate } from "../AuthGate";
import { AuthProvider, SESSION_SETTLE_TIMEOUT_MS } from "@/hooks/useAuth";

/** Klucz, pod którym klient Supabase trzyma sesję dla `placeholder.supabase.co`. */
const STORED_SESSION_KEY = "sb-placeholder-auth-token";

function renderGate() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <AuthGate>
          <p>treść dla zalogowanych</p>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const loginLink = () => document.querySelector('a[href*="/login"]');
const spinner = () => document.querySelector('[aria-label="loading"]');

beforeEach(() => {
  h.authCb = null;
  h.getSessionPromise = null;
  h.signOutMock.mockClear();
  h.rolesRows = [];
  h.profileRow = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AuthGate przy niedostępnym backendzie", () => {
  it("pusty magazyn sesji: CTA logowania bez czekania na sieć", async () => {
    // `getSession()` wisi (backend nie odpowiada), a mimo to odpowiedź jest
    // znana od razu: sesja Supabase mieszka w `localStorage`, więc pusty
    // magazyn to pewne „to gość".
    renderGate();
    await waitFor(() => expect(loginLink()).not.toBeNull());
    expect(spinner()).toBeNull();
    expect(screen.queryByText("treść dla zalogowanych")).toBeNull();
  });

  it("sesja w magazynie + wiszący getSession: spinner tylko do terminu, potem CTA", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(STORED_SESSION_KEY, JSON.stringify({ access_token: "stary" }));

    renderGate();
    // Zapisany token MOŻE być ważny - czekanie jest poprawne, ale skończone.
    expect(spinner()).not.toBeNull();
    expect(loginLink()).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_SETTLE_TIMEOUT_MS);
    });

    expect(loginLink()).not.toBeNull();
    expect(spinner()).toBeNull();
    // I NAJWAŻNIEJSZE: to nie było wylogowanie. Token został w magazynie,
    // `signOut()` nie poszedł - gdy sieć wróci, `onAuthStateChange` przywróci
    // zalogowany widok.
    expect(window.localStorage.getItem(STORED_SESSION_KEY)).not.toBeNull();
    expect(h.signOutMock).not.toHaveBeenCalled();
  });

  it("sesja dostarczona przez listener odsłania treść, nawet gdy getSession wisi", async () => {
    renderGate();
    await waitFor(() => expect(loginLink()).not.toBeNull());

    await act(async () => {
      h.authCb!("SIGNED_IN", { user: { id: "u-1" }, access_token: "tok" });
    });

    await waitFor(() => expect(screen.getByText("treść dla zalogowanych")).toBeInTheDocument());
    expect(loginLink()).toBeNull();
  });
});
