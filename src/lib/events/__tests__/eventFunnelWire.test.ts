// Kontrakt beaconu lejka (`src/lib/events/eventFunnelWire.ts`).
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. IDENTYFIKATOR KLIKNIECIA BEZ ZGODY dociera do bazy - ladunek bez
//      `ad_consent: true` ma go stracic juz na endpoincie.
//   2. SMIECI Z INTERNETU dochodza do RPC: zly krok, zly slug, zly klucz sesji.
//   3. ZLE DOTKNIECIE ODRZUCA CALY KROK - a powinno dac wejscie bezposrednie.
//   4. PODGLADY LINKOW (Slack, LinkedIn) i roboty licza sie jako wizyty.
import { describe, expect, it } from "vitest";

import {
  EVENT_FUNNEL_STEPS,
  isBotUserAgent,
  parseEventFunnelBeacon,
} from "@/lib/events/eventFunnelWire";

const SESSION = "0f3c2a4e-1111-4222-8333-444455556666";
const VISITOR = "a1b2c3d4-aaaa-4bbb-8ccc-ddddeeeeffff";
const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { step: "visit", slug: "kongres-2026", visitor: VISITOR, session: SESSION, ...overrides };
}

describe("parseEventFunnelBeacon", () => {
  it("przepuszcza poprawny beacon z dotknieciem i zgoda reklamowa", () => {
    const got = parseEventFunnelBeacon(
      base({
        ad_consent: true,
        lang: "pl",
        touch: {
          ts: 1,
          utm_source: "google",
          utm_campaign: "Wiosna",
          click_id_type: "gclid",
          click_id: "Cj0KCQjw-abc",
          utm_term: null,
          utm_content: "",
          referrer_host: "x".repeat(700),
          extra: "wypada",
        },
      }),
    );
    expect(got).toEqual({
      step: "visit",
      slug: "kongres-2026",
      visitor: VISITOR,
      session: SESSION,
      ad_consent: true,
      lang: "pl",
      touch: {
        ts: 1,
        utm_source: "google",
        utm_campaign: "Wiosna",
        click_id_type: "gclid",
        click_id: "Cj0KCQjw-abc",
      },
    });
  });

  it("bez zgody reklamowej identyfikator klikniecia wypada, rodzaj zostaje", () => {
    const got = parseEventFunnelBeacon(
      base({
        ad_consent: "true",
        touch: { ts: 5, click_id_type: "gbraid", click_id: "GBRAID-12345" },
      }),
    );
    expect(got?.ad_consent).toBe(false);
    expect(got?.touch).toEqual({ ts: 5, click_id_type: "gbraid" });
  });

  it("wydarzenie po identyfikatorze, bez sluga; kazdy krok z listy", () => {
    for (const step of EVENT_FUNNEL_STEPS) {
      const got = parseEventFunnelBeacon(base({ step, slug: undefined, event_id: EVENT_ID }));
      expect(got?.step).toBe(step);
      expect(got?.event_id).toBe(EVENT_ID);
      expect(got && "slug" in got).toBe(false);
    }
  });

  it("zle dotkniecie nie odrzuca kroku (wejscie bezposrednie)", () => {
    expect(parseEventFunnelBeacon(base({ touch: [1] }))?.touch).toBeNull();
    expect(parseEventFunnelBeacon(base({ touch: { ts: "1" } }))?.touch).toBeNull();
    expect(
      parseEventFunnelBeacon(base({ touch: { ts: Number.POSITIVE_INFINITY } }))?.touch,
    ).toBeNull();
    expect(parseEventFunnelBeacon(base({ touch: { ts: 0 } }))?.touch).toBeNull();
  });

  it("pusty albo zly identyfikator przegladarki to pusty napis (baza bierze sesje)", () => {
    expect(parseEventFunnelBeacon(base({ visitor: "" }))?.visitor).toBe("");
    expect(parseEventFunnelBeacon(base({ visitor: "zly!" }))?.visitor).toBe("");
    expect(parseEventFunnelBeacon(base({ visitor: 7 }))?.visitor).toBe("");
  });

  it("jezyk tylko pl/en", () => {
    expect(parseEventFunnelBeacon(base({ lang: "en" }))?.lang).toBe("en");
    expect(parseEventFunnelBeacon(base({ lang: "de" }))).not.toHaveProperty("lang");
  });

  it("odrzuca beacon bez kroku, wydarzenia albo sesji", () => {
    expect(parseEventFunnelBeacon(null)).toBeNull();
    expect(parseEventFunnelBeacon([base()])).toBeNull();
    expect(parseEventFunnelBeacon(base({ step: "purchase" }))).toBeNull();
    expect(parseEventFunnelBeacon(base({ slug: "Z!" }))).toBeNull();
    expect(parseEventFunnelBeacon(base({ slug: 5, event_id: "nie-uuid" }))).toBeNull();
    expect(parseEventFunnelBeacon(base({ session: "krotka" }))).toBeNull();
    expect(parseEventFunnelBeacon(base({ session: undefined }))).toBeNull();
  });
});

describe("isBotUserAgent", () => {
  it("roboty, podglady linkow i brak naglowka to automat", () => {
    for (const ua of [
      null,
      "  ",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Slackbot-LinkExpanding 1.0",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 HeadlessChrome/120",
      "curl/8.0",
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });

  it("zwykla przegladarka to czlowiek", () => {
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
      ),
    ).toBe(false);
  });
});
