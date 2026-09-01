// PO CO TEN PLIK. `src/lib/analytics/events.ts` (30 linii, dwie funkcje) wchodzi
// tu z ZEREM wykonanych linii. Modul jest krotki, ale jego kontrakt jest
// PRAWNY, nie techniczny: wlasny komentarz deklaruje, ze baner zgod klasyfikuje
// `ad_event` i `popup_event` jako kategorie MARKETING i ze beacon leci
// WYLACZNIE po jej wyrazeniu - „inaczej implementacja przeczylaby deklaracji
// polityki". Bez testu tej deklaracji nie pilnuje NIC: usuniecie jednej linii
// `if (!hasCategoryConsent("marketing")) return;` nie psuje ani typow, ani
// zadnego innego testu, a zamienia opt-out uzytkownika w fikcje.
//
// Trzy klasy defektow, ktore te testy lapia:
//
//  1. BRAMKA NA ZLEJ KATEGORII. Podmiana `marketing` na `analytics` (albo na
//     `hasAnalyticsConsent()`, ktore siedzi tuz obok w `track.ts`) przechodzi
//     przez recenzje niezauwazona i wyglada jak porzadkowanie. Dowodzimy tego
//     KRZYZOWO: sama zgoda analytics NIE wypuszcza beacona, a sama zgoda
//     marketing - wypuszcza. Zaden z tych dwoch testow nie przechodzi po
//     zamianie kategorii.
//  2. SYGNAL GPC OMINIETY. `hasCategoryConsent` klamruje marketing przy
//     aktywnym `Sec-GPC`; bramka musi z tego korzystac, a nie czytac surowego
//     localStorage.
//  3. LADUNEK NIEZGODNY Z INGESTEM. `/api/public/ad-event` i
//     `/api/public/popup-event` czytaja konkretne klucze (`slot_id`,
//     `placement_id`, `popup_id`, `path`); literowka albo `undefined` zamiast
//     `null` konczy sie 204 i CICHA utrata zdarzenia - beacon nie ma odpowiedzi,
//     wiec nikt sie o tym nie dowie.
//
// ATRAPUJEMY WYLACZNIE GRANICE: transport `sendBeaconPayload` (zero sieci)
// i klienta Supabase importowanego przez modul zgod (zero bazy). Sama logika
// zgody, localStorage, sessionStorage i cookie GPC dzialaja naprawde - to ich
// zachowanie jest tu przedmiotem dowodu.
//
// CZEGO SWIADOMIE NIE DUBLUJE: `src/routes/api/public/-popup-event.test.ts`
// (strona odbiorcza: walidacja, 204, zapis), `src/lib/ads/__tests__/consent.test.tsx`
// (katalog zgod i klamra GPC jako temat sam w sobie).
//
// RODO: zero prawdziwych danych - identyfikatory slotow i popupow sa umowne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GPC_COOKIE, GPC_COOKIE_VALUE } from "@/lib/consent/gpc";

const beacons = vi.hoisted(() => ({
  wyslane: [] as Array<{ endpoint: string; payload: unknown }>,
}));

vi.mock("@/lib/observability/report", () => ({
  sendBeaconPayload: (endpoint: string, payload: unknown) => {
    beacons.wyslane.push({ endpoint, payload });
    return true;
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ update: () => ({ eq: async () => ({ data: null, error: null }) }) }),
  },
}));

import { beaconAdEvent, beaconPopupEvent } from "../events";

const STORAGE_KEY = "consent:v2";
const PREVIEW_KEY = "consent:preview";

function zapiszZgode(cats: Partial<Record<string, boolean>>): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      ts: Date.now(),
      categories: {
        necessary: true,
        functional: false,
        analytics: false,
        marketing: false,
        ...cats,
      },
    }),
  );
}

function wyczyscCiasteczka(): void {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(() => {
  beacons.wyslane.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  wyczyscCiasteczka();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  wyczyscCiasteczka();
  window.history.pushState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("beaconAdEvent - bramka zgody marketingowej", () => {
  it("bez zapisanej decyzji NIE wysyla nic", () => {
    beaconAdEvent("impression", "slot-hero");
    expect(beacons.wyslane).toEqual([]);
  });

  it("odmowa marketingu blokuje beacon", () => {
    zapiszZgode({ marketing: false, analytics: true, functional: true });
    beaconAdEvent("click", "slot-hero");
    expect(beacons.wyslane).toEqual([]);
  });

  it("SAMA zgoda analytics NIE wystarcza - to kategoria marketing rzadzi reklamami", () => {
    zapiszZgode({ analytics: true });
    beaconAdEvent("impression", "slot-hero");
    beaconPopupEvent("view", "popup-1");
    expect(beacons.wyslane).toEqual([]);
  });

  it("SAMA zgoda marketingowa wystarcza, nawet przy odmowie analytics", () => {
    zapiszZgode({ marketing: true, analytics: false });
    beaconAdEvent("impression", "slot-hero");
    expect(beacons.wyslane).toHaveLength(1);
    expect(beacons.wyslane[0].endpoint).toBe("/api/public/ad-event");
  });

  it("aktywny sygnal GPC klamruje marketing mimo zgody w localStorage", () => {
    zapiszZgode({ marketing: true });
    document.cookie = `${GPC_COOKIE}=${GPC_COOKIE_VALUE}; path=/`;
    beaconAdEvent("impression", "slot-hero");
    beaconPopupEvent("view", "popup-1");
    expect(beacons.wyslane).toEqual([]);
  });

  it("tryb podgladu zgod steruje bramka - odmowa w podgladzie ucina beacon", () => {
    zapiszZgode({ marketing: true });
    window.sessionStorage.setItem(
      PREVIEW_KEY,
      JSON.stringify({
        categories: { necessary: true, functional: true, analytics: true, marketing: false },
      }),
    );
    beaconAdEvent("impression", "slot-hero");
    expect(beacons.wyslane).toEqual([]);
  });

  it("cofniecie zgody miedzy odslonami zatrzymuje kolejne beacony", () => {
    zapiszZgode({ marketing: true });
    beaconAdEvent("impression", "slot-a");
    zapiszZgode({ marketing: false });
    beaconAdEvent("impression", "slot-b");

    expect(beacons.wyslane).toHaveLength(1);
    expect(beacons.wyslane[0].payload).toMatchObject({ slot_id: "slot-a" });
  });
});

describe("beaconAdEvent - ladunek dla /api/public/ad-event", () => {
  beforeEach(() => {
    zapiszZgode({ marketing: true });
  });

  it("niesie rodzaj, slot, placement i sciezke - dokladnie te klucze", () => {
    window.history.pushState({}, "", "/analizy/bezpieczenstwo?utm_source=nl");
    beaconAdEvent("click", "slot-hero", "placement-77");

    expect(beacons.wyslane).toEqual([
      {
        endpoint: "/api/public/ad-event",
        payload: {
          kind: "click",
          slot_id: "slot-hero",
          placement_id: "placement-77",
          path: "/analizy/bezpieczenstwo",
        },
      },
    ]);
  });

  it("pominiety placement jest jawnym null, a nie undefined gubionym w JSON", () => {
    beaconAdEvent("impression", "slot-hero");
    const payload = beacons.wyslane[0].payload as Record<string, unknown>;
    expect(payload.placement_id).toBeNull();
    expect(Object.keys(payload).sort()).toEqual(["kind", "path", "placement_id", "slot_id"]);
  });

  it("placement podany jako null zostaje nullem", () => {
    beaconAdEvent("impression", "slot-hero", null);
    expect(beacons.wyslane[0].payload).toMatchObject({ placement_id: null });
  });

  it.each(["impression", "click"] as const)("przekazuje rodzaj zdarzenia %s bez zmiany", (kind) => {
    beaconAdEvent(kind, "slot-hero");
    expect(beacons.wyslane[0].payload).toMatchObject({ kind });
  });

  it("sciezka pomija query string - raport grupuje po stronie, nie po kampanii", () => {
    window.history.pushState({}, "", "/eksperci?ref=newsletter");
    beaconAdEvent("impression", "slot-side");
    expect(beacons.wyslane[0].payload).toMatchObject({ path: "/eksperci" });
  });
});

describe("beaconPopupEvent - ladunek dla /api/public/popup-event", () => {
  beforeEach(() => {
    zapiszZgode({ marketing: true });
  });

  it("niesie wylacznie rodzaj i identyfikator popupu", () => {
    beaconPopupEvent("view", "popup-newsletter");
    expect(beacons.wyslane).toEqual([
      {
        endpoint: "/api/public/popup-event",
        payload: { kind: "view", popup_id: "popup-newsletter" },
      },
    ]);
  });

  it("konwersja idzie tym samym kanalem z innym rodzajem", () => {
    beaconPopupEvent("conversion", "popup-newsletter");
    expect(beacons.wyslane[0].payload).toEqual({
      kind: "conversion",
      popup_id: "popup-newsletter",
    });
  });

  it("bez zgody marketingowej konwersja tez nie wychodzi", () => {
    zapiszZgode({ marketing: false });
    beaconPopupEvent("conversion", "popup-newsletter");
    expect(beacons.wyslane).toEqual([]);
  });

  it("dwa popupy w jednej sesji to dwa osobne beacony, bez buforowania", () => {
    beaconPopupEvent("view", "popup-a");
    beaconPopupEvent("view", "popup-b");
    expect(beacons.wyslane.map((b) => (b.payload as { popup_id: string }).popup_id)).toEqual([
      "popup-a",
      "popup-b",
    ]);
  });
});

describe("beaconAdEvent - brak `location` (render poza przegladarka)", () => {
  it("nie rzuca i nie wysyla nic, nawet przy zgodzie marketingowej", () => {
    zapiszZgode({ marketing: true });
    vi.stubGlobal("location", undefined);

    expect(() => beaconAdEvent("impression", "slot-hero")).not.toThrow();

    vi.unstubAllGlobals();
    expect(beacons.wyslane).toEqual([]);
  });
});
