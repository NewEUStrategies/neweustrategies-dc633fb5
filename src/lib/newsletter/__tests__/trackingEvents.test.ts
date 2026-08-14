// Bramka ścieżki zapisu zdarzeń open/click.
//
// Dowodzi trzech rzeczy, których nie widać w bazie ani w routingu z osobna:
//   1. pisze WYŁĄCZNIE skonfigurowane źródło - druga ścieżka nie dotyka bazy
//      w ogóle (nie „pisze i odbija się od indeksu": nie wykonuje rundy),
//   2. zdarzenie bez subskrybenta jest odsiewane PRZED zapytaniem, bo nie da
//      się go ani przypisać, ani zdeduplikować,
//   3. duplikat w tej samej dobie to normalny wynik, nie błąd - i jest
//      odróżnialny od zapisu, od ciszy i od awarii.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const calls: RpcCall[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: { recorded: true, duplicate: false, reason: "recorded" },
  error: null,
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  },
}));

const CAMPAIGN = "11111111-1111-1111-1111-111111111111";
const SUBSCRIBER = "22222222-2222-2222-2222-222222222222";

async function record(
  overrides: Partial<Parameters<typeof import("../trackingEvents.server").recordCampaignEvent>[0]>,
) {
  const { recordCampaignEvent } = await import("../trackingEvents.server");
  return recordCampaignEvent({
    campaignId: CAMPAIGN,
    subscriberId: SUBSCRIBER,
    kind: "open",
    url: null,
    source: "first_party",
    ...overrides,
  });
}

describe("recordCampaignEvent", () => {
  beforeEach(() => {
    calls.length = 0;
    rpcResult = {
      data: { recorded: true, duplicate: false, reason: "recorded" },
      error: null,
    };
    delete process.env.NEWSLETTER_ENGAGEMENT_SOURCE;
  });

  afterEach(() => {
    delete process.env.NEWSLETTER_ENGAGEMENT_SOURCE;
  });

  it("zapisuje zdarzenie z domyślnego źródła (tracking własny)", async () => {
    const result = await record({});
    expect(result).toEqual({ recorded: true, outcome: "recorded" });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("newsletter_record_campaign_event");
    expect(calls[0].args).toEqual({
      p_campaign: CAMPAIGN,
      p_subscriber: SUBSCRIBER,
      p_kind: "open",
      p_url: null,
      // Piksel pisze w chwili zdarzenia, wiec czas wystapienia zostawia bazie.
      p_occurred_at: null,
    });
  });

  it("NIE dotyka bazy, gdy piszący nie jest źródłem prawdy", async () => {
    // To jest sedno poprawki: webhook dostawcy mierzy to samo tym samym
    // mechanizmem, więc jego zapis nie jest „drugim pomiarem", tylko drugim
    // liczeniem tego samego.
    const result = await record({ source: "provider" });
    expect(result).toEqual({ recorded: false, outcome: "source_disabled" });
    expect(calls).toHaveLength(0);
  });

  it("odwraca role, gdy operator wskaże dostawcę jako źródło prawdy", async () => {
    process.env.NEWSLETTER_ENGAGEMENT_SOURCE = "provider";
    expect(await record({ source: "first_party" })).toEqual({
      recorded: false,
      outcome: "source_disabled",
    });
    expect(calls).toHaveLength(0);

    expect(await record({ source: "provider" })).toEqual({ recorded: true, outcome: "recorded" });
    expect(calls).toHaveLength(1);
  });

  it("odsiewa zdarzenie bez subskrybenta przed rundą do bazy", async () => {
    for (const subscriberId of [null, "", "not-a-uuid"]) {
      const result = await record({ subscriberId });
      expect(result).toEqual({ recorded: false, outcome: "unknown_subscriber" });
    }
    expect(calls).toHaveLength(0);
  });

  it("odrzuca niepoprawny identyfikator kampanii bez zapytania", async () => {
    const result = await record({ campaignId: "1234" });
    expect(result).toEqual({ recorded: false, outcome: "invalid_input" });
    expect(calls).toHaveLength(0);
  });

  it("odróżnia duplikat doby od zapisu", async () => {
    rpcResult = {
      data: { recorded: false, duplicate: true, reason: "duplicate_in_day" },
      error: null,
    };
    expect(await record({})).toEqual({ recorded: false, outcome: "duplicate_in_day" });
  });

  it("przekazuje rozstrzygnięcia bazy (obcy tenant / nieznana kampania)", async () => {
    rpcResult = { data: { recorded: false, reason: "unknown_subscriber" }, error: null };
    expect(await record({})).toEqual({ recorded: false, outcome: "unknown_subscriber" });

    rpcResult = { data: { recorded: false, reason: "unknown_campaign" }, error: null };
    expect(await record({})).toEqual({ recorded: false, outcome: "unknown_campaign" });
  });

  it("przekazuje czas WYSTĄPIENIA, gdy producent go zna (webhook)", async () => {
    // Kubełkiem deduplikacji jest doba, a webhook dostawcy potrafi dotrzeć
    // z opóźnieniem albo poza kolejnością. Bez tego pola dwa otwarcia z tej
    // samej doby dostarczone po dwóch stronach północy policzyłyby się dwa razy.
    process.env.NEWSLETTER_ENGAGEMENT_SOURCE = "provider";
    await record({ source: "provider", occurredAt: "2026-08-10T23:59:00.000Z" });
    expect(calls[0].args.p_occurred_at).toBe("2026-08-10T23:59:00.000Z");
  });

  it("normalizuje czas wystąpienia i odrzuca śmieć zamiast wysyłać NaN", async () => {
    process.env.NEWSLETTER_ENGAGEMENT_SOURCE = "provider";
    await record({ source: "provider", occurredAt: "2026-08-10 23:59:00+00" });
    expect(calls[0].args.p_occurred_at).toBe("2026-08-10T23:59:00.000Z");

    calls.length = 0;
    await record({ source: "provider", occurredAt: "nie-data" });
    // `null` => baza podstawi now(); lepsze niż kubełek policzony z NaN-a.
    expect(calls[0].args.p_occurred_at).toBeNull();
  });

  it("przycina adres kliknięcia do 2048 znaków", async () => {
    const long = `https://x.test/${"a".repeat(4000)}`;
    await record({ kind: "click", url: long });
    expect(String(calls[0].args.p_url)).toHaveLength(2048);
  });

  it("nie rzuca przy awarii bazy - piksel i przekierowanie muszą odpowiedzieć", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    expect(await record({})).toEqual({ recorded: false, outcome: "write_failed" });

    rpcResult = { data: null, error: null };
    expect(await record({})).toEqual({ recorded: false, outcome: "write_failed" });
  });

  it("powód spoza katalogu nie daje sprzecznej pary „zapisano + awaria”", async () => {
    // Baza może być nowsza niż ten kod. O FAKCIE zapisu rozstrzyga ona.
    rpcResult = { data: { recorded: true, reason: "recorded_v2" }, error: null };
    expect(await record({})).toEqual({ recorded: true, outcome: "recorded" });

    rpcResult = { data: { recorded: false, reason: "something_new" }, error: null };
    expect(await record({})).toEqual({ recorded: false, outcome: "write_failed" });
  });
});
