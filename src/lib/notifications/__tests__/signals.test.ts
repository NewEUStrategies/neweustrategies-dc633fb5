import { describe, expect, it } from "vitest";
import {
  buildWebhookBody,
  checkWebhookUrl,
  signalEventFromPayload,
  siteAbsoluteUrl,
  type SignalEvent,
} from "../signals";
import { emailCategoryForLabel } from "@/lib/email/suppressionPolicy";
import { SIGNAL_EMAIL_LABEL } from "../signalEmail";

const SITE = "https://neweuropeanstrategies.com";

const event: SignalEvent = {
  id: "n-1",
  signal: "mention",
  lang: "pl",
  title: "Anna <b> & co wspomniała o Tobie",
  body: "@everyone zobacz",
  url: `${SITE}/club/klub?post=1`,
  createdAt: "2026-11-20T10:00:00.000Z",
};

describe("checkWebhookUrl", () => {
  it.each([
    ["https://hooks.slack.com/services/T/B/x", true],
    ["https://discord.com/api/webhooks/1/abc", true],
    ["https://n8n.example.com:8443/webhook/x", true],
  ])("przyjmuje %s", (url, ok) => {
    expect(checkWebhookUrl(url).ok).toBe(ok);
  });

  it.each([
    ["", "empty"],
    ["http://hooks.slack.com/services/x", "scheme"],
    ["https://user:pw@hooks.example.com/x", "credentials"],
    ["https://localhost/hook/x", "host"],
    ["https://127.0.0.1/hook/x", "host"],
    ["https://[::1]/hook/xyz", "host"],
    ["https://printer.local/hook", "host"],
    ["https://intranet/hook/xyz", "host"],
    ["https://hooks.example.com:22/x", "port"],
    [`https://a.example.com/${"x".repeat(2100)}`, "too_long"],
  ])("odrzuca %s (%s)", (url, issue) => {
    expect(checkWebhookUrl(url)).toEqual({ ok: false, issue });
  });
});

describe("siteAbsoluteUrl", () => {
  it("zostawia adres w serwisie", () => {
    expect(siteAbsoluteUrl("/club/a/t/b", SITE)).toBe(`${SITE}/club/a/t/b`);
  });
  it("obcy origin i javascript: zamienia w stronę główną", () => {
    expect(siteAbsoluteUrl("https://evil.test/x", SITE)).toBe(`${SITE}/`);
    expect(siteAbsoluteUrl("javascript:alert(1)", SITE)).toBe(`${SITE}/`);
  });
});

describe("signalEventFromPayload", () => {
  it("wybiera język odbiorcy z awaryjnym drugim językiem", () => {
    const e = signalEventFromPayload({
      jobId: 7,
      signal: "expert_ping",
      lang: "en",
      siteUrl: SITE,
      payload: {
        title_pl: "Poproszono Cię o zdanie",
        title_en: null,
        body_en: "Anna asks",
        href: "/club/k/t/x",
      },
    });
    expect(e.title).toBe("Poproszono Cię o zdanie");
    expect(e.body).toBe("Anna asks");
    expect(e.url).toBe(`${SITE}/club/k/t/x`);
    expect(e.id).toBe("7");
  });
  it("bez tytułu używa tytułu sygnału", () => {
    const e = signalEventFromPayload({
      jobId: 1,
      signal: "mention",
      lang: "pl",
      siteUrl: SITE,
      payload: {},
    });
    expect(e.title).toBe("Ktoś wspomniał o Tobie");
  });
});

describe("buildWebhookBody", () => {
  it("standard: stabilny kontrakt zdarzenia", () => {
    const body = JSON.parse(buildWebhookBody("standard", event)) as Record<string, unknown>;
    expect(body).toMatchObject({ id: "n-1", type: "mention.created", api_version: "2026-11-20" });
    expect(body["data"]).toMatchObject({ signal: "mention", url: event.url, lang: "pl" });
  });
  it("slack: escape składni i link z etykietą", () => {
    const body = JSON.parse(buildWebhookBody("slack", event)) as { text: string };
    expect(body.text).toContain("*Anna &lt;b&gt; &amp; co wspomniała o Tobie*");
    expect(body.text).toContain(`<${event.url}|Otwórz dyskusję>`);
  });
  it("discord: bez masowych wzmianek", () => {
    const body = JSON.parse(buildWebhookBody("discord", event)) as {
      content: string;
      allowed_mentions: { parse: string[] };
    };
    expect(body.allowed_mentions.parse).toEqual([]);
    expect(body.content).not.toContain("@everyone");
  });
});

describe("e-mail sygnału a lista wykluczeń", () => {
  it("wypis ze stopki zatrzymuje e-mail sygnału (kategoria bulk)", () => {
    expect(emailCategoryForLabel(SIGNAL_EMAIL_LABEL)).toBe("bulk");
  });
});
