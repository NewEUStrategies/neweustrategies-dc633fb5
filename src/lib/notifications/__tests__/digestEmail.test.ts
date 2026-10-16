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

  it("polska odmiana trzyma się reguły liczebnika także powyżej 20", () => {
    // Claim tnie digest do 20 pozycji, ale ta granica żyje w SQL.
    const word = (n: number): string => digestSubject(n, "pl", "daily").split(" ")[2];
    expect([1, 2, 4, 5, 11, 12, 14, 20, 21, 22, 24, 25, 104, 112, 122].map(word)).toEqual([
      "powiadomienie",
      "powiadomienia",
      "powiadomienia",
      "powiadomień",
      "powiadomień",
      "powiadomień",
      "powiadomień",
      "powiadomień",
      "powiadomień",
      "powiadomienia",
      "powiadomienia",
      "powiadomień",
      "powiadomienia",
      "powiadomień",
      "powiadomienia",
    ]);
    expect(digestSubject(1, "en", "daily")).toBe("1 update today - New European Strategies");
  });

  it("wstęp zależy od języka i częstotliwości", () => {
    const intro = (lang: "pl" | "en", frequency: "daily" | "weekly"): string =>
      buildDigestHtml({
        displayName: "A",
        items: [item()],
        lang,
        siteUrl: "https://x.example",
        frequency,
      });
    expect(intro("en", "daily")).toContain("Your daily summary of unread notifications:");
    expect(intro("en", "weekly")).toContain("Your weekly summary of unread notifications:");
    expect(intro("pl", "daily")).toContain("Twoje dzienne podsumowanie");
    expect(intro("pl", "weekly")).toContain("Twoje tygodniowe podsumowanie");
  });

  it("href, którego nie da się sparsować, zostawia pozycję tekstem zamiast wywracać digest", () => {
    // `new URL` rzucał tu wyjątkiem - po claimie, który już ostemplował okno.
    const html = buildDigestHtml({
      displayName: "Test",
      items: [item({ title_pl: "Zepsuty link", href: "http://[" }), item({ title_pl: "Dobry" })],
      lang: "pl",
      siteUrl: "https://neweuropeanstrategies.com",
      frequency: "daily",
    });

    expect(html).toContain('<span style="font-weight:600">Zepsuty link</span>');
    expect(html).toContain("https://neweuropeanstrategies.com/tracker/ai-act");
  });

  it("schemat inny niż http(s) nie trafia do linku maila", () => {
    const html = buildDigestHtml({
      displayName: "Test",
      items: [
        item({ title_pl: "Skrypt", href: "javascript:alert(1)" }),
        item({ title_pl: "Dane", href: "data:text/html,<b>x</b>" }),
        item({ title_pl: "Zewnętrzny", href: "https://eur-lex.europa.eu/x" }),
      ],
      lang: "pl",
      siteUrl: "https://neweuropeanstrategies.com",
      frequency: "daily",
    });

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).toContain('<span style="font-weight:600">Skrypt</span>');
    expect(html).toContain('href="https://eur-lex.europa.eu/x"');
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
