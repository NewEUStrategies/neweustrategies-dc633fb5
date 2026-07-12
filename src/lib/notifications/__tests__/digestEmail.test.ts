import { describe, expect, it } from "vitest";
import { buildDigestHtml, digestSubject, pickDigestText, type DigestItem } from "../digestEmail";

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  kind: "content",
  title_pl: "Aktualizacja dossier: AI Act",
  title_en: "Dossier update: AI Act",
  body_pl: "Trilog zakończony.",
  body_en: "Trilogue concluded.",
  href: "/tracker/ai-act",
  created_at: "2026-07-12T10:00:00Z",
  ...over,
});

describe("digest e-mail", () => {
  it("wybiera język z fallbackiem na drugi", () => {
    expect(pickDigestText(item(), "pl")).toBe("Aktualizacja dossier: AI Act");
    expect(pickDigestText(item(), "en")).toBe("Dossier update: AI Act");
    expect(pickDigestText(item({ title_en: null }), "en")).toBe("Aktualizacja dossier: AI Act");
    expect(pickDigestText(item({ title_pl: "  " }), "pl")).toBe("Dossier update: AI Act");
  });

  it("temat odmienia się po polsku i po angielsku", () => {
    expect(digestSubject(1, "pl", "daily")).toContain("1 powiadomienie");
    expect(digestSubject(3, "pl", "daily")).toContain("3 powiadomienia");
    expect(digestSubject(7, "pl", "weekly")).toContain("7 powiadomień");
    expect(digestSubject(2, "en", "weekly")).toContain("2 updates this week");
  });

  it("HTML zawiera absolutny link, escapuje treść i linkuje ustawienia", () => {
    const html = buildDigestHtml({
      displayName: 'Jan "PA" Kowalski',
      items: [item(), item({ title_pl: "<b>XSS</b>", title_en: null, href: null })],
      lang: "pl",
      siteUrl: "https://neweuropeanstrategies.com",
      frequency: "daily",
    });
    expect(html).toContain("https://neweuropeanstrategies.com/tracker/ai-act");
    expect(html).toContain("&lt;b&gt;XSS&lt;/b&gt;");
    expect(html).not.toContain("<b>XSS</b>");
    expect(html).toContain("https://neweuropeanstrategies.com/profile/account");
    expect(html).toContain("Jan &quot;PA&quot; Kowalski");
  });

  it("pomija wpisy bez jakiegokolwiek tytułu", () => {
    const html = buildDigestHtml({
      displayName: "Test",
      items: [item({ title_pl: null, title_en: null })],
      lang: "pl",
      siteUrl: "https://example.com",
      frequency: "weekly",
    });
    expect(html).not.toContain("Trilog zakończony.");
  });
});
