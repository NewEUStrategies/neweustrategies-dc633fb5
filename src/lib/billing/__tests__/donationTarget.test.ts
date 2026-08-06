// Cel przycisku darowizny. Jedna funkcja rozstrzyga dla WSZYSTKICH powierzchni
// (/donate, /support, CTA widgetu CMS) - inaczej serwis wysyła darczyńcę raz do
// własnej kasy, raz na zbiórkę zewnętrzną, zależnie od klikniętego przycisku.
import { describe, expect, it } from "vitest";
import { DONATIONS_DEFAULTS, DonationsConfigSchema } from "@/lib/billing/donationsConfig";
import { EXTERNAL_DONATIONS_URL } from "@/lib/billing/donationsExternal";
import { resolveDonationTarget, INTERNAL_DONATION_PATH } from "@/lib/billing/donationTarget";

const config = (patch: Partial<typeof DONATIONS_DEFAULTS> = {}) =>
  DonationsConfigSchema.parse({ ...DONATIONS_DEFAULTS, ...patch });

describe("resolveDonationTarget", () => {
  it("domyślnie prowadzi do NASZEJ kasy", () => {
    expect(resolveDonationTarget(config())).toEqual({
      kind: "internal",
      href: INTERNAL_DONATION_PATH,
      external: false,
    });
  });

  it("w trybie zewnętrznym prowadzi pod adres z ustawień", () => {
    expect(
      resolveDonationTarget(config({ provider: "external", externalUrl: "https://z.example" })),
    ).toEqual({ kind: "external", href: "https://z.example", external: true });
  });

  it("pusty adres zbiórki spada na stałą awaryjną, a nie na martwy link", () => {
    expect(resolveDonationTarget(config({ provider: "external", externalUrl: "  " }))).toEqual({
      kind: "external",
      href: EXTERNAL_DONATIONS_URL,
      external: true,
    });
  });

  it("wyłączony moduł nie ma celu - powierzchnia nie zaprasza do wpłaty", () => {
    for (const provider of ["stripe", "external"] as const) {
      expect(resolveDonationTarget(config({ enabled: false, provider }))).toEqual({
        kind: "disabled",
        href: null,
        external: false,
      });
    }
  });
});
