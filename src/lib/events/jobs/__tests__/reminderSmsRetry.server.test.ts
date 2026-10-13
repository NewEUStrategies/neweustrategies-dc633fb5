// REG-11 OD KOŃCA DO KOŃCA: przypomnienie SMS po błędzie operatora NAPRAWDĘ
// wychodzi przy ponowieniu, a dziennik doręczeń mówi „wysłane" dopiero wtedy.
//
// CO JEST PRAWDZIWE: `deliverReminder` (zadanie F2), `sendParticipantSms`
// (wyłącznik, GSM-7, budżet) i `sendSms` (dziennik `sms_send_log` + operator).
// ATRAPY: klient service_role z dziennikiem SMS w pamięci (semantyka
// `sms_send_claim`/`sms_send_finish` z migracji 20261012131000), licznik
// budżetu (przepuszcza) i `fetch` operatora (500, potem 200).
//
// Łańcuch sprzed naprawy: pierwsza próba `sms_http_500` -> wpis dziennika
// doręczeń `failed`; `_event_delivery_claim` oddaje go do ponowienia
// (attempts < 3), ale stara bramka `rate_limits` ('sms.once', limit 1) już
// zużyła klucz -> `duplicate` -> „sent". SMS nie wyszedł nigdy.
//
// RODO: numer zmyślony, operator nigdy nie jest wybierany.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => {
  const rows = new Map<string, { status: string; attempts: number; claimId: string }>();
  let seq = 0;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "sms_send_claim") {
      const key = `${String(args["p_tenant_id"])}|${String(args["p_idempotency_key"])}`;
      const row = rows.get(key);
      seq += 1;
      const claimId = `claim-${seq}`;
      if (row === undefined) {
        rows.set(key, { status: "pending", attempts: 1, claimId });
        return { data: { claim_id: claimId, state: "claimed" }, error: null };
      }
      if (row.status === "failed" && row.attempts < 5) {
        Object.assign(row, { status: "pending", attempts: row.attempts + 1, claimId });
        return { data: { claim_id: claimId, state: "claimed" }, error: null };
      }
      const state =
        row.status === "sent" ? "sent" : row.status === "pending" ? "in_flight" : "exhausted";
      return { data: { claim_id: null, state }, error: null };
    }
    if (name === "sms_send_finish") {
      for (const row of rows.values()) {
        if (row.claimId === args["p_claim_id"] && row.status === "pending") {
          row.status = String(args["p_status"]);
          return { data: true, error: null };
        }
      }
      return { data: false, error: null };
    }
    throw new Error(`test: nieoczekiwane RPC ${name}`);
  });
  return {
    rpc,
    reset(): void {
      rows.clear();
      seq = 0;
      rpc.mockClear();
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: Record<string, unknown>) => log.rpc(name, args) },
}));

/** Budżet najemcy przepuszcza; stary zakres 'sms.once' nie może się pojawić. */
const limiter = vi.hoisted(() => ({ rateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/server/rate-limit.server", () => limiter);

// Moduł zadania importuje pocztę i domenę najemcy statycznie - SMS ich nie używa.
vi.mock("@/lib/email/transactional.server", () => ({ sendTxEmail: vi.fn() }));
vi.mock("@/lib/events/tenantPublicOrigin.server", () => ({ tenantPublicUrl: vi.fn() }));

import { deliverReminder } from "@/lib/events/jobs/reminderJob.server";
import { parseReminderClaims, type ReminderClaim } from "@/lib/events/reminderNotice.server";

const TENANT = "22222222-2222-4222-8222-222222222222";
const DELIVERY = "00000000-0000-4000-8000-000000000001";

function smsClaim(): ReminderClaim {
  const { claims } = parseReminderClaims([
    {
      delivery_id: DELIVERY,
      kind: "event_reminder",
      channel: "sms",
      dedupe_key: `er:${DELIVERY}:sms:60:1907164800`,
      tenant_id: TENANT,
      event_id: "33333333-3333-4333-8333-333333333333",
      registration_id: DELIVERY,
      session_id: null,
      starts_at: "2030-06-10T16:00:00Z",
      lang: "pl",
      email: null,
      phone: "600 100 200",
      first_name: "Anna",
      event_slug: "kongres",
      event_title_pl: "Kongres",
      event_title_en: "Congress",
      event_timezone: "Europe/Warsaw",
      event_location: "Sala A",
    },
  ]);
  const claim = claims[0];
  if (claim === undefined) throw new Error("test: wiersz SMS nie przeszedł parsera");
  return claim;
}

describe("REG-11: przypomnienie SMS po błędzie operatora", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("SMSAPI_TOKEN", "token-testowy");
    vi.stubEnv("EVENT_SMS_ENABLED", "1");
    const answers = [500, 200];
    fetchMock = vi.fn(async () => {
      const status = answers.shift() ?? 200;
      return { ok: status === 200, status, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    log.reset();
    limiter.rateLimit.mockClear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("UKOŃCZENIE: błąd HTTP -> failed; ponowienie wysyła -> sent; trzecia próba -> duplicate", async () => {
    const claim = smsClaim();

    await expect(deliverReminder(claim)).resolves.toEqual({
      id: DELIVERY,
      status: "failed",
      detail: "sms_send_failed",
    });
    // Ponowienie z dziennika doręczeń: SMS NAPRAWDĘ idzie do operatora.
    await expect(deliverReminder(claim)).resolves.toEqual({ id: DELIVERY, status: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Dopiero po prawdziwym sukcesie powtórka to `duplicate` - bez operatora.
    await expect(deliverReminder(claim)).resolves.toEqual({
      id: DELIVERY,
      status: "sent",
      detail: "duplicate",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Budżet najemcy liczony przy każdej próbie, stary zakres 'sms.once' nigdy.
    const scopes = limiter.rateLimit.mock.calls.map(
      (call) => (call as unknown as [{ scope: string }])[0].scope,
    );
    expect(scopes).toEqual(["event.sms.tenant", "event.sms.tenant", "event.sms.tenant"]);
  });
});
