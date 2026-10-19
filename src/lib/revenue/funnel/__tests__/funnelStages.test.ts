// Etapy lejka (S3): kolejność kroków, strumienie i parytet białej listy
// źródeł rejestracji z SQL.
//
// Źródło dopisane tylko w TS dawałoby w hubie zawsze zero (SQL zamienia je
// na `unknown`), dopisane tylko w SQL - parser odrzuciłby cały lejek. Dlatego
// lista jest porównywana z OBIEMA migracjami, które ją powtarzają: emiterem
// `account.registered.v1` i agregatem `_funnel_counts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RevenueFunnelDto } from "@/lib/revenue/funnel/dto";
import {
  PAYWALL_PAIR_METRICS,
  REVENUE_FUNNEL_STAGES,
  REVENUE_FUNNEL_STAGE_DEFS,
  SALES_FUNNEL_STAGES,
  SIGNUP_SOURCES,
  isSignupSource,
  revenueFunnelSteps,
} from "@/lib/revenue/funnel/funnelStages";

function sqlSourceList(file: string): string[] {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
  const match = /'auth_page',[\s\S]*?'join_us_form'/.exec(sql);
  if (!match) throw new Error(`brak listy źródeł w ${file}`);
  return [...match[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("SIGNUP_SOURCES = biała lista SQL", () => {
  it.each([
    "20261020120000_account_registered_event.sql",
    "20261020120400_revenue_funnel_access.sql",
  ])("%s", (file) => {
    expect(sqlSourceList(file)).toEqual([...SIGNUP_SOURCES]);
  });

  it("unknown jest źródłem (wartość spoza listy), dowolny napis - nie", () => {
    expect(isSignupSource("unknown")).toBe(true);
    expect(isSignupSource("popup")).toBe(true);
    expect(isSignupSource("<script>")).toBe(false);
    expect(isSignupSource(null)).toBe(false);
  });
});

describe("definicje kroków", () => {
  it("kolejność mapy lejka i jedna definicja na krok", () => {
    expect(REVENUE_FUNNEL_STAGE_DEFS.map((d) => d.stage)).toEqual([...REVENUE_FUNNEL_STAGES]);
  });

  it("odwiedzający to osobny strumień (zgoda analityczna), nigdy mianownik", () => {
    const visitors = REVENUE_FUNNEL_STAGE_DEFS.find((d) => d.stage === "visitors");
    expect(visitors).toMatchObject({ stream: "first_party", separate: true });
    const rest = REVENUE_FUNNEL_STAGE_DEFS.filter((d) => d.stage !== "visitors");
    expect(rest.every((d) => d.stream === "lifecycle" && !d.separate)).toBe(true);
  });

  it("para wskaźników paywalla: zasięg i konwersja", () => {
    expect(PAYWALL_PAIR_METRICS).toEqual(["paywall_hit_rate", "paywall_conversion_rate"]);
  });

  it("etapy toru sprzedaży = etapy z SQL (VALUES w admin_revenue_funnel)", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261020120400_revenue_funnel_access.sql"),
      "utf8",
    );
    const values = /FROM \(VALUES ([^)]*\)(?:, \([^)]*\))*)\)\s+AS st\(stage, ord\)/.exec(sql);
    expect(values).not.toBeNull();
    const stages = [...values![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(stages).toEqual([...SALES_FUNNEL_STAGES]);
  });
});

describe("revenueFunnelSteps", () => {
  const dto = {
    since: "2026-09-01T00:00:00Z",
    until: "2026-10-01T00:00:00Z",
    segment: "all",
    track: "all",
    amountsVisible: true,
    sales: null,
    selfServe: {
      accounts: 3,
      activeAccounts: 4,
      paywallHitAccounts: 2,
      paywallHitVisitors: 1,
      paywallHits: 6,
      paywallConvertedAccounts: 1,
      checkoutStarted: 4,
      checkoutPaid: 1,
      checkoutAbandoned: 3,
      checkoutExpired: 1,
      firstPayments: 1,
      registeredPaid: 1,
      signupFormViews: 0,
      signupFormSubmits: 0,
      visitorsFirstParty: 12,
      rates: {
        registeredToPaid: 0.33,
        paywallConversion: 0.5,
        paywallHit: 0.5,
        checkoutConversion: 0.25,
        checkoutAbandonment: 0.75,
        couponRedemption: null,
      },
      paidAmount: null,
      signupSources: [],
      paywallReasons: [],
      paywallDataSince: null,
    },
  } satisfies RevenueFunnelDto;

  it("wartości z DTO, udział z ułamków SQL (nie z sąsiednich liczb)", () => {
    const steps = revenueFunnelSteps(dto);
    expect(steps.map((s) => [s.stage, s.value, s.rate])).toEqual([
      ["visitors", 12, null],
      ["accounts", 3, null],
      // PHR = trafienia ÷ AKTYWNE konta (4), nie ÷ nowe konta (3)
      ["paywall", 2, 0.5],
      // Zamówienia ÷ konta nie jest żadnym wskaźnikiem - bez udziału
      ["checkout", 4, null],
      ["paid", 1, 0.25],
    ]);
  });

  it("brak DTO albo tor bez samoobsługi = kroki bez liczb (brak danych, nie zero)", () => {
    expect(revenueFunnelSteps(null).every((s) => s.value === null && s.rate === null)).toBe(true);
    expect(revenueFunnelSteps({ ...dto, selfServe: null }).every((s) => s.value === null)).toBe(
      true,
    );
  });
});
