import { describe, expect, it } from "vitest";
import { buildSignalEmailHtml, buildSignalEmailText, signalEmailSubject } from "../signalEmail";
import type { SignalEvent } from "../signals";

const event: SignalEvent = {
  id: "n-1",
  signal: "mention",
  lang: "pl",
  title: 'Anna <script>"x"</script> wspomniała o Tobie',
  body: "Treść & więcej",
  url: "https://neweuropeanstrategies.com/club/k?post=1",
  createdAt: "2026-11-20T10:00:00.000Z",
};
const settingsUrl = "https://neweuropeanstrategies.com/profile/notifications";

describe("e-mail sygnału", () => {
  it("temat bez znaków nowej linii", () => {
    expect(signalEmailSubject({ title: "A\r\nBcc: x@y.z" })).toBe(
      "A Bcc: x@y.z - New European Strategies",
    );
  });

  it("escapuje treść od innych członków", () => {
    const html = buildSignalEmailHtml({ event, displayName: "<Bartek>", settingsUrl });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Cześć &lt;Bartek&gt;,");
    expect(html).toContain('href="https://neweuropeanstrategies.com/club/k?post=1"');
    expect(html).toContain(`href="${settingsUrl}"`);
  });

  it("wersja tekstowa w języku odbiorcy", () => {
    const text = buildSignalEmailText({
      event: { ...event, lang: "en" },
      displayName: null,
      settingsUrl,
    });
    expect(text).toContain("Open the discussion: https://neweuropeanstrategies.com/club/k?post=1");
    expect(text).toContain("Change notification settings");
  });
});
