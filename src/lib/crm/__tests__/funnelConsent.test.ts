// K3: konwersja lejka do Kontaktów CRM fabrykowała zgodę marketingową
// (marketing_consent=true + newsletter_status='subscribed' dla KAŻDEGO
// subskrybenta), a ręczna zmiana statusu dopisywała `confirmed_at`, czyli
// fałszywy dowód potwierdzenia zapisu. Zgoda może być wyłącznie przepisana ze
// stanu subskrybenta.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { funnelMarketingConsent } from "../funnelConsent";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const sub = (over: Partial<Parameters<typeof funnelMarketingConsent>[0]> = {}) => ({
  status: "subscribed",
  confirmed_at: "2026-08-01T10:00:00.000Z",
  consents: [],
  ...over,
});

describe("funnelMarketingConsent", () => {
  it("przenosi zgodę dla potwierdzonego subskrybenta", () => {
    expect(funnelMarketingConsent(sub())).toBe(true);
  });

  it("nie ustawia zgody dla zapisu niepotwierdzonego (pending DOI)", () => {
    expect(funnelMarketingConsent(sub({ status: "pending", confirmed_at: null }))).toBe(false);
  });

  it("nie ustawia zgody po wypisie, odbiciu i skardze", () => {
    for (const status of ["unsubscribed", "bounced", "complained"]) {
      expect(funnelMarketingConsent(sub({ status }))).toBe(false);
    }
  });

  it("nie ustawia zgody, gdy status przestawiono ręcznie (brak confirmed_at i wpisu zgody)", () => {
    expect(funnelMarketingConsent(sub({ confirmed_at: null }))).toBe(false);
    expect(funnelMarketingConsent(sub({ confirmed_at: null, consents: null }))).toBe(false);
  });

  it("uznaje wpis zgody z formularza jako dowód nawet bez confirmed_at", () => {
    expect(
      funnelMarketingConsent(
        sub({
          confirmed_at: null,
          consents: [{ key: "newsletter", text: "Zapisuję się...", given: true }],
        }),
      ),
    ).toBe(true);
  });

  it("odmowa/wycofanie zgody w consents[] wygrywa nad statusem", () => {
    expect(
      funnelMarketingConsent(sub({ consents: [{ key: "Marketing", text: "...", given: false }] })),
    ).toBe(false);
  });

  it("ignoruje zgody niemarketingowe i śmieci w tablicy", () => {
    expect(
      funnelMarketingConsent(
        sub({ confirmed_at: null, consents: [{ key: "rodo", given: true }, null, "x", 7] }),
      ),
    ).toBe(false);
  });
});

describe("crm-funnel.functions - brak fabrykowania zgody", () => {
  const src = read("src/lib/crm-funnel.functions.ts");

  it("konwersja nie wpisuje zgody ani statusu w ciemno", () => {
    expect(src).not.toContain("marketing_consent: true,");
    expect(src).not.toContain('newsletter_status: "subscribed"');
    expect(src).toContain("funnelMarketingConsent");
    expect(src).toContain("newsletter_status: s.status");
    // Stan zgody musi być CZYTANY ze źródła, żeby dało się go przepisać.
    expect(src).toContain("status,confirmed_at,consents");
  });

  it("ręczna zmiana statusu nie stempluje confirmed_at", () => {
    const handler = src.slice(src.indexOf("export const updateFunnelStatus"));
    expect(handler).not.toContain("patch.confirmed_at");
    expect(handler).toContain("crm.funnel.status_change");
  });
});
