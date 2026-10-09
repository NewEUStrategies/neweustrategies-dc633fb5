// Zgody bez tworzenia klienta Supabase w commicie hydratacji (P3.1 B, TP-5).
//
// `useConsent` (przez `useEffectiveConsent()` z `__root.tsx`, baner, wstrzykiwacz
// skryptów i sloty reklamowe) dotykał `supabase.auth` w efekcie montażu - a
// pierwsze dotknięcie proxy z `client.ts` TWORZY klienta (GoTrue,
// BroadcastChannel, timer auto-odświeżania) w zadaniu commitu hydratacji, także
// u gościa bez sesji. Od P3.1 nasłuch sesji podpina się dopiero, gdy klienta
// utworzy KTOKOLWIEK (rejestr `onSupabaseClientCreated` z `sessionHint.ts`).
//
// Atrapa klienta liczy KAŻDY dostęp do `auth` (dostęp = utworzenie klienta w
// prawdziwym proxy), a rejestr utworzenia jest prawdziwy i sterowany z testu
// (`markSupabaseClientCreated`), jak w `client.ts`.
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

type AuthListener = (event: string) => void;

const sb = vi.hoisted(() => ({
  authAccess: 0,
  subscribeCalls: 0,
  getSessionCalls: 0,
  listeners: [] as AuthListener[],
  userId: null as string | null,
  prefs: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const auth = {
    getSession: async () => {
      sb.getSessionCalls += 1;
      return { data: sb.userId ? { session: { user: { id: sb.userId } } } : { session: null } };
    },
    onAuthStateChange: (cb: AuthListener) => {
      sb.subscribeCalls += 1;
      sb.listeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              sb.listeners = sb.listeners.filter((l) => l !== cb);
            },
          },
        },
      };
    },
  };
  return {
    supabase: {
      get auth() {
        sb.authAccess += 1;
        return auth;
      },
      rpc: async () => ({ data: [{ prefs: sb.prefs }], error: null }),
      from: () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) }),
    },
  };
});

vi.mock("@/lib/consent/registryBridge", () => ({
  syncCmpDecisionToRegistry: async () => {},
  backfillRegistryOnLogin: async () => {},
  syncGpcSignalToRegistry: async () => {},
}));

vi.mock("@/lib/analytics/adAttributionStore", () => ({
  pruneAdAttributionForConsent: () => {},
}));

import { useConsent, type ConsentState } from "@/lib/ads/consent";
import {
  __resetSupabaseClientRegistryForTests,
  markSupabaseClientCreated,
} from "@/integrations/supabase/sessionHint";

function profileConsent(ts: number): ConsentState {
  return {
    version: 2,
    ts,
    categories: { necessary: true, functional: true, analytics: true, marketing: true },
  };
}

function emitAuth(event: string): void {
  for (const listener of [...sb.listeners]) listener(event);
}

beforeEach(() => {
  __resetSupabaseClientRegistryForTests();
  window.localStorage.clear();
  sb.authAccess = 0;
  sb.subscribeCalls = 0;
  sb.getSessionCalls = 0;
  sb.listeners = [];
  sb.userId = null;
  sb.prefs = {};
});

afterEach(() => {
  __resetSupabaseClientRegistryForTests();
  vi.restoreAllMocks();
});

describe("useConsent bez klienta Supabase w hydratacji (P3.1 B)", () => {
  it("gość: montaż nie dotyka supabase.auth i nie subskrybuje sesji", () => {
    const { result } = renderHook(() => useConsent());

    expect(result.current.mounted).toBe(true);
    expect(sb.authAccess).toBe(0);
    expect(sb.subscribeCalls).toBe(0);
  });

  it("utworzenie klienta przez kogokolwiek: dokładnie jedna subskrypcja, SIGNED_IN hydratuje z profilu", async () => {
    sb.userId = "user-1";
    sb.prefs = { consent: profileConsent(9_000) };
    const { result } = renderHook(() => useConsent());
    expect(sb.subscribeCalls).toBe(0);

    act(() => markSupabaseClientCreated());
    expect(sb.subscribeCalls).toBe(1);
    expect(sb.listeners).toHaveLength(1);

    act(() => emitAuth("SIGNED_IN"));
    await waitFor(() => expect(result.current.state?.categories.marketing).toBe(true));
    expect(sb.getSessionCalls).toBe(1);
  });

  it("klient istniejący przed montażem (zalogowany): subskrypcja od razu", () => {
    markSupabaseClientCreated();
    renderHook(() => useConsent());

    expect(sb.subscribeCalls).toBe(1);
    expect(sb.listeners).toHaveLength(1);
  });

  it("odmontowanie przed utworzeniem klienta wypisuje słuchacza rejestru", () => {
    const { unmount } = renderHook(() => useConsent());
    unmount();

    markSupabaseClientCreated();
    expect(sb.subscribeCalls).toBe(0);
    expect(sb.authAccess).toBe(0);
  });

  it("odmontowanie po subskrypcji kończy nasłuch sesji", () => {
    markSupabaseClientCreated();
    const { unmount } = renderHook(() => useConsent());
    expect(sb.listeners).toHaveLength(1);

    unmount();
    expect(sb.listeners).toHaveLength(0);
  });

  it("StrictMode: jedna aktywna subskrypcja - przed i po utworzeniu klienta", () => {
    const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

    // Klient powstaje PO podwójnym efekcie: jeden słuchacz rejestru przeżył.
    const late = renderHook(() => useConsent(), { wrapper: strict });
    act(() => markSupabaseClientCreated());
    expect(sb.listeners).toHaveLength(1);
    late.unmount();
    expect(sb.listeners).toHaveLength(0);

    // Klient już istnieje: podwójny efekt subskrybuje dwa razy, ale pierwszą
    // subskrypcję zdejmuje sprzątanie.
    renderHook(() => useConsent(), { wrapper: strict });
    expect(sb.listeners).toHaveLength(1);
  });
});
