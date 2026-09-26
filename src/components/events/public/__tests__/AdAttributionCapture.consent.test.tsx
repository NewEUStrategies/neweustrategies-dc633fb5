// Atrybucja kampanii z PRAWDZIWA warstwa zgod (consent.ts + GPC) - od
// `AdAttributionCapture` po zawartosc `localStorage`.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW. Testy jednostkowe magazynu i atomu
// podaja zgode wprost; tutaj idzie ona z tych samych zrodel, co w przegladarce
// (zapis `consent:v2`, sygnal `navigator.globalPrivacyControl`). Bez tego
// rozjazd miedzy "co mowi baner" a "co zapisuje atom" bylby niewidoczny:
//   1. brak decyzji - identyfikator klikniecia laduje w magazynie przed zgoda;
//   2. sama analityka - identyfikator klikniecia w magazynie;
//   3. GPC przy zapisanej zgodzie marketingowej - klucz nadal zapisany
//      (sygnal opt-out obchodzony);
//   4. cofniecie zgody w banerze - klucz zostaje na urzadzeniu.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));

const KEY = "nes.attribution.v1";
const GCLID = "Cj0KCQjw-abc_DEF1234";

function storeConsent(categories: { analytics: boolean; marketing: boolean }): void {
  window.localStorage.setItem(
    "consent:v2",
    JSON.stringify({
      version: 2,
      ts: 1,
      categories: { necessary: true, functional: false, ...categories },
    }),
  );
}

function setGpc(active: boolean): void {
  Object.defineProperty(window.navigator, "globalPrivacyControl", {
    configurable: true,
    value: active,
  });
}

async function mountCapture() {
  vi.resetModules();
  const { AdAttributionCapture } =
    await import("@/components/events/public/atoms/AdAttributionCapture");
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<AdAttributionCapture />);
  });
  return view;
}

function stored(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(() => {
  window.localStorage.clear();
  document.cookie = "nes_cookie_consent=; path=/; max-age=0";
  document.cookie = "nes_gpc=; path=/; max-age=0";
  setGpc(false);
  window.history.replaceState(null, "", `/events/kongres?utm_campaign=Wiosna&gclid=${GCLID}`);
});

afterEach(() => {
  cleanup();
  setGpc(false);
});

describe("atrybucja + prawdziwe zgody", () => {
  it("bez decyzji o zgodzie NIC nie trafia do magazynu", async () => {
    await mountCapture();
    expect(stored()).toBeNull();
  });

  it("zgoda marketingowa: atrybucja z identyfikatorem klikniecia", async () => {
    storeConsent({ analytics: true, marketing: true });
    await mountCapture();
    expect((stored()?.last as Record<string, unknown>).clickId).toBe(GCLID);
    expect((stored()?.last as Record<string, unknown>).utmCampaign).toBe("Wiosna");
  });

  it("sama analityka: atrybucja BEZ identyfikatora klikniecia", async () => {
    storeConsent({ analytics: true, marketing: false });
    await mountCapture();
    const last = stored()?.last as Record<string, unknown>;
    expect(last.clickId).toBeNull();
    expect(last.utmCampaign).toBe("Wiosna");
  });

  it("GPC klamruje zapisana zgode marketingowa - klucz nie powstaje", async () => {
    storeConsent({ analytics: true, marketing: true });
    setGpc(true);
    await mountCapture();
    expect(stored()).toBeNull();
  });

  it("cofniecie zgody w banerze kasuje klucz", async () => {
    storeConsent({ analytics: true, marketing: true });
    await mountCapture();
    expect(stored()).not.toBeNull();

    await act(async () => {
      storeConsent({ analytics: false, marketing: false });
      window.dispatchEvent(new Event("consent-change"));
    });
    expect(stored()).toBeNull();
  });
});
