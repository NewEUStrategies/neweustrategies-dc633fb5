import { describe, it, expect } from "vitest";
import { classifyBounce, normalizeResendEvent, parseTags, uuidTag } from "../deliveryEvents";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("classifyBounce", () => {
  it("maps provider bounce types to classes", () => {
    expect(classifyBounce("Permanent", "General")).toBe("hard");
    expect(classifyBounce("Permanent", "NoEmail")).toBe("hard");
    expect(classifyBounce("Transient", "MailboxFull")).toBe("soft");
    expect(classifyBounce("Undetermined", "")).toBe("unknown");
  });

  it("treats provider suppression / blocklist as its own class", () => {
    // Podtyp wygrywa z typem: 'Permanent + Suppressed' to blokada relacji,
    // nie martwa skrzynka - inny powód wykluczenia i inna diagnoza.
    expect(classifyBounce("Permanent", "SuppressedRecipient")).toBe("block");
    expect(classifyBounce("Transient", "Blocked")).toBe("block");
  });

  it("falls back on subType when the provider omits type", () => {
    expect(classifyBounce(null, "MailboxFull")).toBe("soft");
    expect(classifyBounce(undefined, "NoEmail")).toBe("hard");
    expect(classifyBounce("", "")).toBe("unknown");
  });
});

describe("parseTags", () => {
  it("accepts both the array and the map shape", () => {
    expect(parseTags([{ name: "tenant", value: UUID }])).toEqual({ tenant: UUID });
    expect(parseTags({ tenant: UUID })).toEqual({ tenant: UUID });
  });
  it("drops malformed entries instead of throwing", () => {
    expect(parseTags([{ name: "a" }, { value: "b" }, 5, null])).toEqual({});
    expect(parseTags(null)).toEqual({});
    expect(parseTags("nope")).toEqual({});
  });
});

describe("uuidTag", () => {
  it("returns only well-formed UUIDs from the requested keys", () => {
    expect(uuidTag({ tenant: UUID }, "tenant", "tenant_id")).toBe(UUID);
    expect(uuidTag({ tenant_id: UUID }, "tenant", "tenant_id")).toBe(UUID);
    expect(uuidTag({ tenant: "../../etc/passwd" }, "tenant")).toBeNull();
    expect(uuidTag({}, "tenant")).toBeNull();
  });
});

describe("normalizeResendEvent", () => {
  it("normalizes a hard bounce with recipient, message id and diagnostic", () => {
    const event = normalizeResendEvent({
      type: "email.bounced",
      created_at: "2026-07-20T10:00:00.000Z",
      data: {
        email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
        to: ["Dead.Mailbox@Example.COM"],
        created_at: "2026-07-20T09:59:00.000Z",
        bounce: { type: "Permanent", subType: "General", message: "mailbox does not exist" },
        tags: { tenant: UUID },
      },
    });
    expect(event).not.toBeNull();
    expect(event?.kind).toBe("bounced");
    expect(event?.bounceClass).toBe("hard");
    expect(event?.email).toBe("dead.mailbox@example.com");
    expect(event?.messageId).toBe("56761188-7520-42d8-8898-ff6fc54ce618");
    // Znacznik czasu bierzemy z data.created_at (moment zdarzenia), nie z
    // koperty dostawy - inaczej opóźniona dostawa fałszowałaby serię dzienną.
    expect(event?.occurredAt).toBe("2026-07-20T09:59:00.000Z");
    expect(event?.diagnostic).toBe("mailbox does not exist");
    expect(event?.tags.tenant).toBe(UUID);
  });

  it("marks complaints without a bounce class", () => {
    const event = normalizeResendEvent({
      type: "email.complained",
      data: { email_id: "abc", to: ["reader@example.com"], subject: "Weekly briefing" },
    });
    expect(event?.kind).toBe("complained");
    expect(event?.bounceClass).toBeNull();
  });

  it("captures the clicked link and the failure reason", () => {
    const clicked = normalizeResendEvent({
      type: "email.clicked",
      data: { email_id: "abc", to: ["a@b.com"], click: { link: "https://example.com/x" } },
    });
    expect(clicked?.url).toBe("https://example.com/x");

    const failed = normalizeResendEvent({
      type: "email.failed",
      data: { email_id: "abc", to: ["a@b.com"], failed: { reason: "sending quota exceeded" } },
    });
    expect(failed?.kind).toBe("failed");
    expect(failed?.diagnostic).toBe("sending quota exceeded");
  });

  it("keeps unknown event types as 'other' instead of dropping them", () => {
    const event = normalizeResendEvent({ type: "email.something_new", data: { to: ["a@b.com"] } });
    expect(event?.kind).toBe("other");
    expect(event?.eventType).toBe("email.something_new");
  });

  it("rejects payloads that are not events", () => {
    expect(normalizeResendEvent(null)).toBeNull();
    expect(normalizeResendEvent({ data: {} })).toBeNull();
    expect(normalizeResendEvent("email.bounced")).toBeNull();
  });
});
