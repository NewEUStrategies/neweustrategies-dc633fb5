// LICZEBNIKI w słownikach monetyzacji - bramka po defekcie.
//
// DEFEKT NAPRAWIONY 19.08.2026. Cztery napisy wstawiały liczbę w polski tekst
// z JEDNĄ formą mnogą:
//
//   pricing.trial              „{{days}} dni za darmo"       -> „1 dni za darmo"
//   retention.offer.body       „{{periods}} płatności"        -> „na kolejne 1 płatności"
//   retention.offer.hint       „przez {{days}} dni"           -> „przez 1 dni"
//   retention.accepted.body    „do {{periods}} użyć"          -> „do 1 użyć"
//
// Wszystkie cztery pokazują się w momentach, w których to widać najbardziej:
// na karcie planu przy decyzji o zakupie i w oknie rezygnacji, gdy próbujemy
// klienta zatrzymać. Polski ma trzy formy istotne dla liczebnika (1 / 2-4 / 5+),
// angielski dwie - stąd `_one`/`_few`/`_many`/`_other` po polsku i `_one`/`_other`
// po angielsku, wybierane przez i18next po zmiennej `count`.
//
// Te testy pilnują JEDNOCZEŚNIE trzech rzeczy: że formy istnieją, że wołający
// przekazuje `count` (bez niego i18next nie wybierze formy i pokaże klucz),
// i że dawne, jednoformowe klucze NIE WRÓCIŁY.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Źródła słowników czytamy jako TEKST - moduły rejestrują się w i18n przy imporcie. */
const RETENTION = readFileSync("src/lib/i18n-retention.ts", "utf8");
const PROFILE = readFileSync("src/lib/i18n-profile.ts", "utf8");
const DIALOG = readFileSync("src/components/billing/organisms/RetentionDialog.tsx", "utf8");
const PLAN_CARD = readFileSync("src/components/billing/molecules/PlanCard.tsx", "utf8");
const TIER_CARD = readFileSync("src/components/pricing/organisms/TierCard.tsx", "utf8");
const PLAN_PAGE = readFileSync("src/routes/plans.$planId.tsx", "utf8");

describe("okres próbny - „1 dzień” nie może brzmieć „1 dni”", () => {
  it("polski ma wszystkie trzy formy istotne dla liczebnika", () => {
    expect(PROFILE).toContain('trial_one: "{{count}} dzień za darmo"');
    expect(PROFILE).toContain('trial_few: "{{count}} dni za darmo"');
    expect(PROFILE).toContain('trial_many: "{{count}} dni za darmo"');
  });

  it("angielski ma dwie formy (więcej i18next dla `en` nie użyje)", () => {
    expect(PROFILE).toContain('trial_one: "{{count}}-day free trial"');
    expect(PROFILE).toContain('trial_other: "{{count}}-day free trial"');
  });

  it("dawny klucz jednoformowy NIE WRÓCIŁ", () => {
    expect(PROFILE).not.toContain('trial: "{{days}} dni za darmo"');
    expect(PROFILE).not.toMatch(/^\s*trial: /m);
  });

  it("WSZYSTKIE trzy miejsca pokazujące okres próbny przekazują `count`", () => {
    // Bez `count` i18next nie wybierze formy i pokaże surowy klucz.
    for (const source of [PLAN_CARD, TIER_CARD, PLAN_PAGE]) {
      expect(source).toContain('t("pricing.trial", { count: plan.trial_days })');
      expect(source).not.toContain("days: plan.trial_days");
    }
  });
});

describe("kontroferta retencyjna - liczba płatności i dni ważności kodu", () => {
  it("treść oferty ma polskie formy z odmienioną „płatnością”", () => {
    expect(RETENTION).toContain("rabatu na kolejną {{count}} płatność.");
    expect(RETENTION).toContain("rabatu na kolejne {{count}} płatności.");
    expect(RETENTION).toContain("body_many:");
  });

  it("podpowiedź o ważności kodu odmienia „dzień” i „dni”", () => {
    expect(RETENTION).toContain("przez {{count}} dzień");
    expect(RETENTION).toContain("przez {{count}} dni");
  });

  it("ekran z kodem odmienia „użycie” i „użyć”", () => {
    expect(RETENTION).toContain("do {{count}} użycia)");
    expect(RETENTION).toContain("do {{count}} użyć)");
  });

  it("angielski ma po dwie formy dla obu napisów", () => {
    expect(RETENTION).toContain("off your next {{count}} payment.");
    expect(RETENTION).toContain("off your next {{count}} payments.");
    expect(RETENTION).toContain("up to {{count}} use)");
    expect(RETENTION).toContain("up to {{count}} uses)");
  });

  it("dawne klucze jednoformowe NIE WRÓCIŁY", () => {
    expect(RETENTION).not.toContain("{{periods}}");
    expect(RETENTION).not.toContain("przez {{days}} dni");
  });

  it("okno rezygnacji przekazuje `count`, nie `periods` ani `days`", () => {
    expect(DIALOG).toContain("count: settings.discount_periods");
    expect(DIALOG).toContain("count: settings.coupon_valid_days");
    expect(DIALOG).toContain("count: accepted.discountPeriods");
    expect(DIALOG).not.toContain("periods: settings.discount_periods");
  });
});

describe("procent rabatu zostaje osobną zmienną", () => {
  it("`pct` nie jest liczebnikiem - „25% rabatu” nie odmienia się po liczbie", () => {
    // Świadome rozdzielenie: formę wybiera `count` (liczba płatności), a `pct`
    // jest tylko wartością wstawianą w tekst.
    expect(RETENTION).toContain("{{pct}}% rabatu");
    expect(DIALOG).toContain("pct: settings.discount_pct");
  });
});
