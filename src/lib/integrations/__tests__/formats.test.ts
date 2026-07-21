import { describe, expect, it } from "vitest";
import {
  formatDelivery,
  hubspotContactBody,
  hubspotRequestUrl,
  normalizeIntegrationKind,
  parseDeliveryEnvelope,
  slackMessageForEvent,
  HUBSPOT_CONTACT_EVENT_TYPES,
  type DeliveryEnvelope,
} from "../formats";

const RAW_ENVELOPE = {
  id: "11111111-1111-1111-1111-111111111111",
  event_type: "crm_lead.created.v1",
  aggregate_type: "crm_lead",
  aggregate_id: "22222222-2222-2222-2222-222222222222",
  payload: {
    email: "Anna.Kowalska@Example.com",
    stage: "new",
    first_name: "Anna",
    last_name: "Kowalska",
    owner_id: null,
  },
  correlation_id: "corr-123",
  created_at: "2026-07-21T10:00:00Z",
};

function envelope(overrides: Partial<DeliveryEnvelope> = {}): DeliveryEnvelope {
  return { ...parseDeliveryEnvelope(RAW_ENVELOPE, RAW_ENVELOPE.event_type), ...overrides };
}

describe("normalizeIntegrationKind", () => {
  it("maps known kinds case-insensitively and falls back to webhook", () => {
    expect(normalizeIntegrationKind("Slack")).toBe("slack");
    expect(normalizeIntegrationKind(" hubspot ")).toBe("hubspot");
    expect(normalizeIntegrationKind("zapier")).toBe("webhook");
    expect(normalizeIntegrationKind(null)).toBe("webhook");
    expect(normalizeIntegrationKind(undefined)).toBe("webhook");
  });
});

describe("parseDeliveryEnvelope", () => {
  it("parses the outbox envelope defensively", () => {
    const parsed = parseDeliveryEnvelope(RAW_ENVELOPE, "fallback.event.v1");
    expect(parsed.event_type).toBe("crm_lead.created.v1");
    expect(parsed.payload.email).toBe("Anna.Kowalska@Example.com");
    expect(parsed.correlation_id).toBe("corr-123");
  });

  it("survives malformed payloads with the fallback event type", () => {
    const parsed = parseDeliveryEnvelope("not-an-object", "crm_lead.updated.v1");
    expect(parsed.event_type).toBe("crm_lead.updated.v1");
    expect(parsed.payload).toEqual({});
    expect(parsed.id).toBeNull();
  });
});

describe("slackMessageForEvent", () => {
  it("renders a bilingual header, fields and context for a known event", () => {
    const message = slackMessageForEvent(envelope());
    expect(message.text).toContain("Nowy lead CRM - New CRM lead");
    const header = message.blocks[0];
    expect(header.type).toBe("header");
    const section = message.blocks[1];
    if (section.type !== "section") throw new Error("expected section block");
    const fieldTexts = (section.fields ?? []).map((f) => f.text).join("\n");
    expect(fieldTexts).toContain("Anna.Kowalska@Example.com");
    expect(fieldTexts).toContain("*Etap / Stage*");
    const context = message.blocks[message.blocks.length - 1];
    if (context.type !== "context") throw new Error("expected context block");
    expect(context.elements[0].text).toContain("crm_lead.created.v1");
    expect(context.elements[0].text).toContain("corr-123");
  });

  it("renders stage transitions and escapes mrkdwn specials", () => {
    const message = slackMessageForEvent(
      envelope({
        event_type: "crm_lead.stage_changed.v1",
        payload: { email: "a&b<c>@example.com", old_stage: "new", new_stage: "qualified" },
      }),
    );
    const section = message.blocks[1];
    if (section.type !== "section") throw new Error("expected section block");
    const fieldTexts = (section.fields ?? []).map((f) => f.text).join("\n");
    expect(fieldTexts).toContain("new → qualified");
    expect(fieldTexts).toContain("a&amp;b&lt;c&gt;@example.com");
  });

  it("falls back to a generic label for unknown events", () => {
    const message = slackMessageForEvent(envelope({ event_type: "custom.thing.v1", payload: {} }));
    expect(message.text).toContain("Zdarzenie platformy - Platform event");
  });
});

describe("hubspot adapter", () => {
  it("builds a batch upsert body keyed by lower-cased email", () => {
    const body = hubspotContactBody(envelope());
    expect(body).not.toBeNull();
    expect(body?.inputs[0].id).toBe("anna.kowalska@example.com");
    expect(body?.inputs[0].idProperty).toBe("email");
    expect(body?.inputs[0].properties).toEqual({
      email: "anna.kowalska@example.com",
      firstname: "Anna",
      lastname: "Kowalska",
    });
  });

  it("returns null without a valid email", () => {
    expect(hubspotContactBody(envelope({ payload: {} }))).toBeNull();
    expect(hubspotContactBody(envelope({ payload: { email: "invalid" } }))).toBeNull();
  });

  it("derives the upsert URL from the configured base", () => {
    expect(hubspotRequestUrl("https://api.hubapi.com")).toBe(
      "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert",
    );
    expect(hubspotRequestUrl("https://api.hubapi.com/")).toBe(
      "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert",
    );
    expect(
      hubspotRequestUrl("https://proxy.example.com/crm/v3/objects/contacts/batch/upsert"),
    ).toBe("https://proxy.example.com/crm/v3/objects/contacts/batch/upsert");
  });
});

describe("formatDelivery", () => {
  it("keeps the generic webhook contract byte-for-byte and requests signing", () => {
    const result = formatDelivery({
      kind: "webhook",
      endpointUrl: "https://example.com/hook",
      envelope: envelope(),
      raw: RAW_ENVELOPE,
      secret: "s3cret",
    });
    if (result.kind !== "send") throw new Error("expected send");
    expect(result.request.url).toBe("https://example.com/hook");
    expect(result.request.body).toBe(JSON.stringify(RAW_ENVELOPE));
    expect(result.request.sign).toBe(true);
    expect(result.request.headers["x-nes-event"]).toBe("crm_lead.created.v1");
  });

  it("formats slack deliveries as Block Kit without HMAC signing", () => {
    const result = formatDelivery({
      kind: "slack",
      endpointUrl: "https://hooks.slack.com/services/T/B/X",
      envelope: envelope(),
      raw: RAW_ENVELOPE,
      secret: null,
    });
    if (result.kind !== "send") throw new Error("expected send");
    expect(result.request.sign).toBe(false);
    const parsed = JSON.parse(result.request.body) as { blocks?: unknown[]; text?: string };
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect(parsed.text).toContain("Nowy lead CRM");
  });

  it("formats hubspot contact events with a Bearer token", () => {
    const result = formatDelivery({
      kind: "hubspot",
      endpointUrl: "https://api.hubapi.com",
      envelope: envelope(),
      raw: RAW_ENVELOPE,
      secret: "pat-eu1-token",
    });
    if (result.kind !== "send") throw new Error("expected send");
    expect(result.request.url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert");
    expect(result.request.headers.authorization).toBe("Bearer pat-eu1-token");
    expect(result.request.sign).toBe(false);
  });

  it("skips hubspot deliveries for unmapped events", () => {
    const result = formatDelivery({
      kind: "hubspot",
      endpointUrl: "https://api.hubapi.com",
      envelope: envelope({ event_type: "post.published.v1" }),
      raw: RAW_ENVELOPE,
      secret: "pat",
    });
    expect(result.kind).toBe("skip");
  });

  it("fails hubspot deliveries without a token so the panel surfaces the misconfiguration", () => {
    const result = formatDelivery({
      kind: "hubspot",
      endpointUrl: "https://api.hubapi.com",
      envelope: envelope(),
      raw: RAW_ENVELOPE,
      secret: null,
    });
    expect(result.kind).toBe("fail");
  });

  it("covers every mapped hubspot event type with an email payload", () => {
    for (const eventType of HUBSPOT_CONTACT_EVENT_TYPES) {
      const result = formatDelivery({
        kind: "hubspot",
        endpointUrl: "https://api.hubapi.com",
        envelope: envelope({ event_type: eventType, payload: { email: "x@y.z" } }),
        raw: RAW_ENVELOPE,
        secret: "pat",
      });
      expect(result.kind).toBe("send");
    }
  });
});
