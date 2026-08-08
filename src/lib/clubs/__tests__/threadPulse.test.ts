import { describe, expect, it } from "vitest";
import { computeThreadPulse } from "@/lib/clubs/threadPulse";

const NOW = Date.parse("2026-08-08T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const H = 3_600_000;
const D = 24 * H;

describe("computeThreadPulse", () => {
  it("świeżo założony wątek bez odpowiedzi nie udaje gorącej dyskusji", () => {
    const pulse = computeThreadPulse(
      { created_at: iso(H), last_reply_at: null, reply_count: 0, participant_count: 1 },
      NOW,
    );
    expect(pulse.level).toBe(0);
    expect(pulse.state).toBe("dormant");
    expect(pulse.repliesPerDay).toBe(0);
  });

  it("żywa wielogłosowa wymiana z dzisiaj dostaje najwyższy poziom", () => {
    const pulse = computeThreadPulse(
      { created_at: iso(2 * D), last_reply_at: iso(H), reply_count: 24, participant_count: 7 },
      NOW,
    );
    expect(pulse.level).toBe(4);
    expect(pulse.state).toBe("hot");
    expect(pulse.isConversation).toBe(true);
  });

  it("ta sama liczba odpowiedzi, ale sprzed roku, spada do uśpionego", () => {
    const pulse = computeThreadPulse(
      {
        created_at: iso(400 * D),
        last_reply_at: iso(300 * D),
        reply_count: 12,
        participant_count: 5,
      },
      NOW,
    );
    expect(pulse.level).toBe(0);
    expect(pulse.hoursSinceActivity).toBe(300 * 24);
  });

  it("monolog wielu wpisów jednej osoby nie jest rozmową", () => {
    const pulse = computeThreadPulse(
      { created_at: iso(D), last_reply_at: iso(H), reply_count: 15, participant_count: 1 },
      NOW,
    );
    expect(pulse.isConversation).toBe(false);
    expect(pulse.repliesPerParticipant).toBe(15);
  });

  it("brak last_reply_at cofa się do daty założenia zamiast wywracać liczenie", () => {
    const pulse = computeThreadPulse(
      { created_at: iso(10 * D), last_reply_at: null, reply_count: 3, participant_count: 2 },
      NOW,
    );
    expect(pulse.hoursSinceActivity).toBe(240);
    expect(Number.isFinite(pulse.repliesPerDay)).toBe(true);
  });

  it("niepoprawna data nie produkuje NaN", () => {
    const pulse = computeThreadPulse(
      { created_at: "nie-data", last_reply_at: "też-nie", reply_count: 5, participant_count: 2 },
      NOW,
    );
    expect(Number.isNaN(pulse.repliesPerDay)).toBe(false);
    expect(pulse.level).toBeGreaterThanOrEqual(0);
  });
});
