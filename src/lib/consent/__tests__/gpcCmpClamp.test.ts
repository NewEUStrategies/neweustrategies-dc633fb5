// Klamra GPC na REALNEJ ścieżce bramkowania skryptów.
//
// `hasCategoryConsent()` to funkcja, którą pyta silnik analityki
// (`lib/analytics/track.ts`) i moduł reklam - z event-handlerów spoza drzewa
// Reacta. Jeśli klamra żyłaby tylko w hookach, beacony wychodziłyby dalej,
// mimo że UI pokazywałby kategorię jako wyłączoną. Ten plik pilnuje, że nie
// da się obejść sygnału ANI zapisem w localStorage, ANI trybem podglądu.
//
// Zakres testu jest świadomie wąski: sam odczyt + klamra, bez zapisów do
// profilu (te wymagają sesji Supabase). Kontrakt zapisu (znacznik override'u,
// źródło decyzji) pokrywają `gpc.test.ts` i `gpcRegistry.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "consent:v2";
const PREVIEW_KEY = "consent:preview";

/** Klient Supabase jest tu nieistotny - most rejestru i tak nie startuje. */
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  },
}));

type Cats = { functional?: boolean; analytics?: boolean; marketing?: boolean };

function persistConsent(cats: Cats, extra: Record<string, unknown> = {}): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      ts: 1_735_689_600_000,
      categories: {
        necessary: true,
        functional: !!cats.functional,
        analytics: !!cats.analytics,
        marketing: !!cats.marketing,
      },
      ...extra,
    }),
  );
}

function setNavigatorGpc(active: boolean | undefined): void {
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    get: () => active,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setNavigatorGpc(undefined);
});

afterEach(() => {
  vi.resetModules();
});

async function loadConsent() {
  vi.resetModules();
  return import("@/lib/ads/consent");
}

describe("hasCategoryConsent pod sygnałem GPC", () => {
  it("zwraca false dla analytics/marketing, mimo zgody w localStorage", async () => {
    persistConsent({ functional: true, analytics: true, marketing: true });
    setNavigatorGpc(true);
    const { hasCategoryConsent, hasAnalyticsConsent } = await loadConsent();

    expect(hasCategoryConsent("analytics")).toBe(false);
    expect(hasCategoryConsent("marketing")).toBe(false);
    // Ten sam wynik przez alias używany przez silnik analityki.
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it("nie rusza kategorii functional ani necessary", async () => {
    persistConsent({ functional: true, analytics: true, marketing: true });
    setNavigatorGpc(true);
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("functional")).toBe(true);
    expect(hasCategoryConsent("necessary")).toBe(true);
  });

  it("bez sygnału zgoda z localStorage obowiązuje normalnie", async () => {
    persistConsent({ functional: true, analytics: true, marketing: true });
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("analytics")).toBe(true);
    expect(hasCategoryConsent("marketing")).toBe(true);
  });

  it("trybu podglądu NIE da się użyć do obejścia sygnału", async () => {
    persistConsent({ analytics: false, marketing: false });
    window.sessionStorage.setItem(
      PREVIEW_KEY,
      JSON.stringify({ categories: { necessary: true, analytics: true, marketing: true } }),
    );
    setNavigatorGpc(true);
    const { hasCategoryConsent } = await loadConsent();

    // Podglądem testuje się layout banera, nie obchodzi się opt-outu.
    expect(hasCategoryConsent("analytics")).toBe(false);
    expect(hasCategoryConsent("marketing")).toBe(false);
  });

  it("podgląd działa normalnie, dopóki sygnału nie ma", async () => {
    persistConsent({ analytics: false, marketing: false });
    window.sessionStorage.setItem(
      PREVIEW_KEY,
      JSON.stringify({ categories: { necessary: true, analytics: true, marketing: false } }),
    );
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("analytics")).toBe(true);
    expect(hasCategoryConsent("marketing")).toBe(false);
  });

  it("świadomy override (znacznik gpcOverrideAt) zdejmuje klamrę", async () => {
    persistConsent(
      { functional: true, analytics: true, marketing: true },
      { gpcOverrideAt: 1_735_689_700_000 },
    );
    setNavigatorGpc(true);
    const { hasCategoryConsent, isGpcCurrentlyHonored } = await loadConsent();

    expect(isGpcCurrentlyHonored()).toBe(false);
    expect(hasCategoryConsent("analytics")).toBe(true);
    expect(hasCategoryConsent("marketing")).toBe(true);
  });

  it("uszkodzony znacznik override'u NIE zdejmuje klamry (fail-closed)", async () => {
    persistConsent({ analytics: true, marketing: true }, { gpcOverrideAt: 0 });
    setNavigatorGpc(true);
    const { hasCategoryConsent, isGpcCurrentlyHonored } = await loadConsent();

    expect(isGpcCurrentlyHonored()).toBe(true);
    expect(hasCategoryConsent("analytics")).toBe(false);
  });

  it("cookie transportowe od SSR działa jak sygnał, gdy navigator milczy", async () => {
    persistConsent({ analytics: true, marketing: true });
    document.cookie = "nes_gpc=1; path=/";
    const { hasCategoryConsent } = await loadConsent();

    expect(hasCategoryConsent("analytics")).toBe(false);
    document.cookie = "nes_gpc=; path=/; max-age=0";
  });
});
