// Podgląd na żywo sekcji „Wyświetlanie" post-listy musi reagować na KAŻDY
// przełącznik panelu: showCover / showTitle / showExcerpt oraz pełny kontrakt
// autora - obie osie widoczności, obie wartości rozmiaru i etykietę per język.
//
// REGRESJA PRZYPIĘTA TUTAJ: podgląd rysował własny, zaszyty kwadracik 16 px i
// tekst 11 px, więc suwaki „Rozmiar czcionki autora" / „Rozmiar zdjęcia autora"
// wyglądały na dekoracyjne - zapisywały treść, ale nie zmieniały obrazu.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { POST_LIST_BYLINE_VARIANTS, postListVariantHasByline } from "@/lib/builder/postListQuery";
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

  it.each([...POST_LIST_BYLINE_VARIANTS, "numbered"] as const)(
    "wariant %s: podgląd autora dokładnie tam, gdzie widget rysuje byline",
    (variant) => {
      const shown = html({ variant }).includes('data-testid="preview-author"');
      expect(shown).toBe(postListVariantHasByline(variant));
    },
  );

  it("authorDisplay=avatar renders the avatar + name, no label chip", () => {
    const out = html({ variant: "ranked", authorDisplay: "avatar" });
    expect(out).toContain("data-author-byline-avatar");
    expect(out).toContain("data-author-byline-name");
    expect(out).not.toContain("data-author-byline-label");
  });

  it("authorDisplay=label renders label chip + name, no avatar", () => {
    const out = html({ variant: "ranked", authorDisplay: "label" });
    expect(out).toContain("data-author-byline-label");
    expect(out).toContain("data-author-byline-name");
    expect(out).not.toContain("data-author-byline-avatar");
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

describe("DisplayLivePreview - rozmiary autora są WIDOCZNE, nie deklaratywne", () => {
  it("bez ustawień trzyma kontrakt 12 px / 20 px / 6 px", () => {
    const out = html({ variant: "ranked" });
    expect(out).toMatch(/font-size:12px/);
    expect(out).toMatch(/width:20px/);
    expect(out).toMatch(/border-radius:6px/);
  });

  it("zmiana rozmiaru czcionki natychmiast zmienia podgląd", () => {
    const out = html({ variant: "ranked", authorSizePx: "18" });
    expect(out).toMatch(/font-size:18px/);
    expect(out).not.toMatch(/font-size:12px/);
  });

  it("zmiana rozmiaru zdjęcia natychmiast zmienia podgląd", () => {
    const out = html({ variant: "ranked", authorAvatarSizePx: "44" });
    expect(out).toMatch(/width:44px/);
    expect(out).toMatch(/max-width:44px/);
    expect(out).not.toMatch(/width:20px/);
  });

  it("wyłączenie zdjęcia zostawia sam tekst z etykietą", () => {
    const out = html({ variant: "ranked", showAuthorAvatar: "0" });
    expect(out).not.toContain("data-author-byline-avatar");
    expect(out).toMatch(/Autor:/);
  });

  it("wyłączenie nazwiska zostawia samo zdjęcie", () => {
    const out = html({ variant: "ranked", showAuthorName: "0" });
    expect(out).toContain("data-author-byline-avatar");
    expect(out).not.toContain("data-author-byline-name");
  });
});
