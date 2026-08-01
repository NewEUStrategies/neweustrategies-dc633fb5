// Guarantees the Post List "Display" sidebar live preview reacts to every
// toggle exposed to the editor: showCover / showTitle / showExcerpt and,
// for the ranked variant, authorDisplay (avatar | label | none) with the
// per-language authorLabel_${lang} override.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DisplayLivePreview } from "../DisplayLivePreview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? "",
    i18n: { language: "pl" },
  }),
}));

const html = (c: Record<string, string>, lang: "pl" | "en" = "pl") =>
  renderToStaticMarkup(<DisplayLivePreview c={c} lang={lang} />);

describe("DisplayLivePreview - sidebar toggles drive the preview", () => {
  it("defaults render cover, title and excerpt", () => {
    const out = html({});
    expect(out).toContain('data-testid="preview-cover"');
    expect(out).toContain('data-testid="preview-title"');
    expect(out).toContain('data-testid="preview-excerpt"');
  });

  it("showCover=0 hides the cover placeholder", () => {
    const out = html({ showCover: "0" });
    expect(out).not.toContain('data-testid="preview-cover"');
  });

  it("showTitle=0 hides the title line", () => {
    const out = html({ showTitle: "0" });
    expect(out).not.toContain('data-testid="preview-title"');
  });

  it("showExcerpt=0 hides the excerpt line", () => {
    const out = html({ showExcerpt: "0" });
    expect(out).not.toContain('data-testid="preview-excerpt"');
  });

  it("author preview only appears for the ranked variant", () => {
    expect(html({ variant: "card" })).not.toContain('data-testid="preview-author"');
    expect(html({ variant: "ranked" })).toContain('data-testid="preview-author"');
  });

  it("ranked + authorDisplay=avatar renders avatar swatch + name, no label chip", () => {
    const out = html({ variant: "ranked", authorDisplay: "avatar" });
    expect(out).toContain('data-testid="preview-author-avatar"');
    expect(out).toContain('data-testid="preview-author-name"');
    expect(out).not.toContain('data-testid="preview-author-label"');
  });

  it("ranked + authorDisplay=label renders label chip + name, no avatar", () => {
    const out = html({ variant: "ranked", authorDisplay: "label" });
    expect(out).toContain('data-testid="preview-author-label"');
    expect(out).toContain('data-testid="preview-author-name"');
    expect(out).not.toContain('data-testid="preview-author-avatar"');
    // Default PL label is "Autor:".
    expect(out).toMatch(/Autor:/);
  });

  it("ranked + authorDisplay=label honours authorLabel_pl override", () => {
    const out = html({
      variant: "ranked",
      authorDisplay: "label",
      authorLabel_pl: "Redakcja",
    });
    expect(out).toMatch(/Redakcja:/);
  });

  it("ranked + authorDisplay=none hides the whole author row", () => {
    const out = html({ variant: "ranked", authorDisplay: "none" });
    expect(out).not.toContain('data-testid="preview-author"');
  });

  it("EN language uses 'By' as the default author label", () => {
    const out = html({ variant: "ranked", authorDisplay: "label" }, "en");
    expect(out).toMatch(/By:/);
  });
});
