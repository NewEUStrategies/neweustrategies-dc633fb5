// @vitest-environment node
//
// Organizm „AuthProvider na serwerze" - pierwszy render bez `window` i
// wylogowanie w środowisku bez `window`.
//
// PO CO OSOBNY PLIK ZE ŚRODOWISKIEM `node`. Domyślne `happy-dom` ma `window`
// zawsze, więc strażnik `typeof window !== "undefined"` przed twardą nawigacją
// w `signOut()` był tam nieosiągalny z definicji. Tutaj `window` nie istnieje
// wcale - tak jak w renderze serwerowym.
//
// CO TEN PLIK DOWODZI.
//   1. SERWER RENDERUJE „NIE WIEMY". Pierwszy render wychodzi z `loading ===
//      true` i bez sesji - dokładnie na tym `/admin` renderuje serwerowo
//      szkielet powłoki (audyt CWV 2026-09-20, F32), a pierwszy render klienta
//      musi wyjść identycznie, inaczej hydratacja się rozjeżdża. Serwer NIE
//      dotyka klienta Supabase: ani nasłuchu, ani `getSession()`.
//   2. WYLOGOWANIE BEZ `window` NIE WYWRACA SIĘ. `signOut()` zamyka sesję w
//      Supabase i czyści cały cache zapytań, a twardą nawigację po prostu
//      pomija - bez `ReferenceError` i bez błędu w konsoli.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Przekierowania po wylogowaniu (adres z ustawień,
// odrzucanie adresów zewnętrznych, spadek na „/" przy braku ustawień) - to jest
// w `useAuth.test.tsx`, gdzie `window.location.assign` istnieje. Sondy magazynu
// bez `window` - to jest w `useAuthDegradedPaths.test.tsx`, bo wymaga żywego
// efektu, a efekty nie biegną w renderze serwerowym.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  ustawienia: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: h.onAuthStateChange,
      getSession: h.getSession,
      signOut: h.signOut,
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
    queryFn: async () => h.ustawienia,
  },
  resolveSetting: (map: Record<string, unknown> | undefined, key: string, defaults: object) => ({
    ...defaults,
    ...((map?.[key] as object) ?? {}),
  }),
}));

import { AuthProvider, useAuth } from "@/hooks/useAuth";

type Przechwycone = { signOut: (() => Promise<void>) | null };

function Sonda({ przechwycone }: { przechwycone: Przechwycone }) {
  const { session, loading, roles, signOut } = useAuth();
  przechwycone.signOut = signOut;
  return (
    <p>{`uid=${session?.user?.id ?? "anon"};loading=${String(loading)};roles=${roles.join(",")}`}</p>
  );
}

function renderSerwerowy(klient: QueryClient) {
  const przechwycone: Przechwycone = { signOut: null };
  const html = renderToString(
    <QueryClientProvider client={klient}>
      <AuthProvider>
        <Sonda przechwycone={przechwycone} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { html, przechwycone };
}

beforeEach(() => {
  h.onAuthStateChange.mockReset();
  h.getSession.mockReset();
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.ustawienia = { auth_branding: { logout_redirect_url: "/do-zobaczenia" } };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthProvider bez window", () => {
  it("render serwerowy wychodzi w stanie „nie wiemy” i nie dotyka klienta Supabase", () => {
    expect(typeof window).toBe("undefined");

    const { html } = renderSerwerowy(new QueryClient());

    expect(html).toContain("uid=anon;loading=true;roles=");
    expect(h.onAuthStateChange).not.toHaveBeenCalled();
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it("signOut() bez window zamyka sesję i czyści cache, a nawigację pomija bez wyjątku", async () => {
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    const klient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    klient.setQueryData(["billing", "subscription"], { plan: "pro" });
    const { przechwycone } = renderSerwerowy(klient);
    const wyloguj = przechwycone.signOut;
    if (wyloguj === null) throw new Error("Sonda nie dostała signOut z kontekstu");

    await expect(wyloguj()).resolves.toBeUndefined();

    expect(h.signOut).toHaveBeenCalledTimes(1);
    // Dane poprzedniego konta nie przeżywają wylogowania (wspólne urządzenie).
    expect(klient.getQueryData(["billing", "subscription"])).toBeUndefined();
    expect(klient.getQueryCache().getAll()).toHaveLength(0);
    expect(blad).not.toHaveBeenCalled();
  });
});
