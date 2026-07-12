import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "@/lib/notifications/usePushSubscription";
import { buildDigestHtml } from "@/lib/server/notificationsTick.server";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url (VAPID public key format) into raw bytes", () => {
    // "AQAB" (base64url) = [1, 0, 1]
    expect(Array.from(urlBase64ToUint8Array("AQAB"))).toEqual([1, 0, 1]);
  });

  it("handles url-safe characters and missing padding", () => {
    const standard = Buffer.from([251, 239, 190]).toString("base64"); // "++++"-ish
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(Array.from(urlBase64ToUint8Array(urlSafe))).toEqual([251, 239, 190]);
  });
});

describe("buildDigestHtml", () => {
  const item = {
    title_pl: "Nowy komentarz <b>",
    title_en: null,
    body_pl: "Ktoś odpowiedział",
    body_en: null,
    href: "/blog/wpis#comments",
    created_at: "2026-07-13T10:00:00Z",
  };

  it("builds a linked, escaped list with an unread-count subject", () => {
    const { subject, html } = buildDigestHtml([item], "https://example.org");
    expect(subject).toContain("1 nieprzeczytane powiadomienie");
    expect(html).toContain('href="https://example.org/blog/wpis#comments"');
    expect(html).toContain("Nowy komentarz &lt;b&gt;");
    expect(html).toContain("Ktoś odpowiedział");
    expect(html).toContain("/profile");
  });

  it("pluralizes the subject and renders unlinked items without origin", () => {
    const { subject, html } = buildDigestHtml([item, { ...item, href: null }], "");
    expect(subject).toContain("2 nieprzeczytanych powiadomień");
    // Brak originu: tytuł bez <a>, stopka ustawień pominięta.
    expect(html).not.toContain("/profile");
  });

  it("falls back to the EN title when PL is empty", () => {
    const { html } = buildDigestHtml(
      [{ ...item, title_pl: null, title_en: "English title" }],
      "https://example.org",
    );
    expect(html).toContain("English title");
  });
});
