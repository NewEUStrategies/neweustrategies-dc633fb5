// Dzwonek `event` i SMS uczestnika.
//
// STAWKI: (1) dzwonek idzie przez `enqueue_notification` z rodzajem `event`
// i ikoną z listy kuratorskiej (nazwa spoza niej ładuje leniwy rejestr 109 KB);
// (2) SMS ma trzy bramki PRZED operatorem - wyłącznik platformy, GSM-7 +
// 160 septetów i budżet najemcy FAIL-CLOSED; (3) nic nie wychodzi do sieci.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURATED_ICON_NAMES } from "@/lib/icons/curatedIconNames";

const db = vi.hoisted(() => ({ rpc: vi.fn(), broken: false }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    if (db.broken) throw new Error("client unavailable");
    return { rpc: db.rpc };
  },
}));
const limiter = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/server/rate-limit.server", () => limiter);
const sms = vi.hoisted(() => ({ sendSms: vi.fn() }));
vi.mock("@/lib/notify/sms.server", () => sms);

import {
  PARTICIPANT_BELL_ICONS,
  PARTICIPANT_SMS_DAILY_BUDGET,
  enqueueEventBell,
  participantSmsEnabled,
  sendParticipantSms,
} from "@/lib/events/participantNotify.server";

const ENV = ["SMSAPI_TOKEN", "EVENT_SMS_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  vi.clearAllMocks();
  db.broken = false;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  for (const key of ENV) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function enableSms(): void {
  process.env.SMSAPI_TOKEN = "token-atrapa";
  process.env.EVENT_SMS_ENABLED = "1";
}

describe("enqueueEventBell", () => {
  it("rodzaj event, domyślna ikona calendar-clock, zwraca identyfikator", async () => {
    db.rpc.mockResolvedValue({ data: "n1", error: null });
    await expect(
      enqueueEventBell({
        userId: "u1",
        titlePl: "Przypomnienie",
        titleEn: "Reminder",
        href: "/events/forum",
      }),
    ).resolves.toBe("n1");
    expect(db.rpc).toHaveBeenCalledWith("enqueue_notification", {
      p_user_id: "u1",
      p_kind: "event",
      p_title_pl: "Przypomnienie",
      p_title_en: "Reminder",
      p_href: "/events/forum",
      p_icon: "calendar-clock",
    });
  });

  it("treść i ikona wołającego", async () => {
    db.rpc.mockResolvedValue({ data: "n2", error: null });
    await enqueueEventBell({
      userId: "u1",
      titlePl: "Ankieta",
      titleEn: "Survey",
      bodyPl: "Forum",
      bodyEn: "Forum",
      href: "/events/forum/me?tab=follow-up",
      icon: "clipboard-list",
    });
    expect(db.rpc.mock.calls[0][1]).toMatchObject({
      p_body_pl: "Forum",
      p_body_en: "Forum",
      p_icon: "clipboard-list",
    });
  });

  it("każda dopuszczona ikona jest na liście kuratorskiej", () => {
    for (const icon of PARTICIPANT_BELL_ICONS) expect(CURATED_ICON_NAMES).toContain(icon);
  });

  it.each([null, ""])("wyciszone/duplikat (%j) -> null", async (data) => {
    db.rpc.mockResolvedValue({ data, error: null });
    await expect(
      enqueueEventBell({ userId: "u1", titlePl: "a", titleEn: "b", href: "/x" }),
    ).resolves.toBeNull();
  });

  it("błąd RPC -> null", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      enqueueEventBell({ userId: "u1", titlePl: "a", titleEn: "b", href: "/x" }),
    ).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith("[participantNotify] bell failed", { error: "boom" });
  });

  it.each([
    ["rzut klienta", () => (db.broken = true), "client unavailable"],
    ["rzut nie-Error", () => db.rpc.mockRejectedValue("offline"), "offline"],
  ])("%s -> null (nigdy nie rzuca)", async (_label, arrange, message) => {
    arrange();
    await expect(
      enqueueEventBell({ userId: "u1", titlePl: "a", titleEn: "b", href: "/x" }),
    ).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith("[participantNotify] bell threw", { error: message });
  });
});

describe("participantSmsEnabled", () => {
  it("wymaga tokenu operatora ORAZ EVENT_SMS_ENABLED=1", () => {
    expect(participantSmsEnabled()).toBe(false);
    process.env.SMSAPI_TOKEN = "token-atrapa";
    expect(participantSmsEnabled()).toBe(false);
    process.env.EVENT_SMS_ENABLED = "true";
    expect(participantSmsEnabled()).toBe(false);
    process.env.EVENT_SMS_ENABLED = "1";
    expect(participantSmsEnabled()).toBe(true);
    delete process.env.SMSAPI_TOKEN;
    expect(participantSmsEnabled()).toBe(false);
  });
});

describe("sendParticipantSms", () => {
  const input = {
    tenantId: "t1",
    to: "+48500000000",
    body: "Przypomnienie: Forum jutro 10.06 10:00",
    idempotencyKey: "event-reminder-sms:k",
  };

  it("wyłącznik platformy -> disabled, bez licznika i operatora", async () => {
    await expect(sendParticipantSms(input)).resolves.toEqual({ ok: false, skipped: "disabled" });
    expect(limiter.rateLimit).not.toHaveBeenCalled();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it.each([
    ["znak spoza GSM-7", "Przypomnienie: Łódź"],
    ["ponad 160 septetów", "x".repeat(161)],
    ["rozszerzenia liczone podwójnie", "€".repeat(81)],
  ])("%s -> not_gsm7", async (_label, body) => {
    enableSms();
    await expect(sendParticipantSms({ ...input, body })).resolves.toEqual({
      ok: false,
      skipped: "not_gsm7",
    });
    expect(limiter.rateLimit).not.toHaveBeenCalled();
  });

  it("budżet najemcy wyczerpany -> budget (licznik fail-closed)", async () => {
    enableSms();
    limiter.rateLimit.mockResolvedValue(false);
    await expect(sendParticipantSms(input)).resolves.toEqual({ ok: false, skipped: "budget" });
    expect(limiter.rateLimit).toHaveBeenCalledWith({
      scope: "event.sms.tenant",
      subjectId: "t1",
      max: PARTICIPANT_SMS_DAILY_BUDGET,
      windowMinutes: 1440,
      failClosed: true,
    });
    expect(PARTICIPANT_SMS_DAILY_BUDGET).toBe(300);
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it("wszystko w porządku -> sendSms z kluczem idempotencji", async () => {
    enableSms();
    limiter.rateLimit.mockResolvedValue(true);
    sms.sendSms.mockResolvedValue({ ok: true });
    await expect(sendParticipantSms({ ...input, body: "x".repeat(160) })).resolves.toEqual({
      ok: true,
    });
    expect(sms.sendSms).toHaveBeenCalledWith({
      to: "+48500000000",
      body: "x".repeat(160),
      idempotencyKey: "event-reminder-sms:k",
    });
  });
});
