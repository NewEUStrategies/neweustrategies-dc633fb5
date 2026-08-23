import { describe, expect, it } from "vitest";
import { decorateCmsStatusIcons } from "../cmsInlineIcons";

describe("decorateCmsStatusIcons", () => {
  it("converts supported status emoji in text nodes", () => {
    const html = decorateCmsStatusIcons("<p>✅ Sukces ❌ Błąd ⚠️ Uwaga</p>");
    expect(html).toContain("cms-inline-status-icon--success");
    expect(html).toContain("cms-inline-status-icon--error");
    expect(html).toContain("cms-inline-status-icon--warning");
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(3);
  });

  it("does not inject SVG markup into HTML attributes", () => {
    const html = decorateCmsStatusIcons('<span title="✅">✅ Tekst</span>');
    expect(html).toContain('title="✅"');
    expect(html.match(/<svg/g)).toHaveLength(1);
  });
});
