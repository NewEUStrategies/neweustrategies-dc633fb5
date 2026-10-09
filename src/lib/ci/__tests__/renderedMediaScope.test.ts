// ZAKRES ADRESÓW WZGLĘDNYCH (P3.2a / P4.2): ścieżka względna `/media/...` wolno
// WYŁĄCZNIE w `src`/`srcset` renderowanym do HTML-u, w preloadzie obrazu i w
// nagłówku `Link`. Wszystko, co czytają roboty, serwisy społecznościowe, czytniki
// RSS, klienci poczty i baza (og:image, twitter:image, JSON-LD, stemplowanie
// `public_url`, warianty kadrów generowane po stronie serwera, awatary) zostaje
// ABSOLUTNE. Test behawioralny na wyjściu funkcji (bez skanu źródeł): dla
// kanonicznego adresu markowego każda z tych dróg oddaje adres z originem.
import { describe, expect, it, vi } from "vitest";
import { buildArticleJsonLd, buildContentHead } from "@/lib/seo/meta";
import { PUBLIC_MEDIA_ORIGIN, brandedMediaUrl } from "@/lib/media/publicUrl";
import {
  buildAvatarSrc,
  buildAvatarSrcSet,
  buildImageSrcSet,
  buildScaledImageUrl,
  buildTransformedImageUrl,
} from "@/lib/cropSizes";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const COVER = `${PUBLIC_MEDIA_ORIGIN}/media/okladka.jpg`;
const PAGE = `${PUBLIC_MEDIA_ORIGIN}/raport`;
const absolute = (value: unknown) =>
  typeof value === "string" && value.startsWith(`${PUBLIC_MEDIA_ORIGIN}/media/`);

describe("adresy mediów poza renderem zostają absolutne", () => {
  it("og:image i twitter:image (głowa treści)", () => {
    const head = buildContentHead({
      url: PAGE,
      lang: "pl",
      type: "article",
      title: "Raport",
      description: "Opis",
      image: COVER,
    });
    const images = head.meta.filter((m) => m.property === "og:image" || m.name === "twitter:image");
    expect(images).toHaveLength(2);
    for (const m of images) expect(m.content).toBe(COVER);
  });

  it("JSON-LD artykułu", () => {
    const graph = JSON.stringify(
      buildArticleJsonLd({
        url: PAGE,
        lang: "pl",
        isArticle: true,
        title: "Raport",
        description: "Opis",
        image: COVER,
        publisherLogoUrl: `${PUBLIC_MEDIA_ORIGIN}/media/logo.png`,
      }),
    );
    expect(graph).toContain(COVER);
    expect(graph).toContain(`${PUBLIC_MEDIA_ORIGIN}/media/logo.png`);
    expect(graph).not.toMatch(/"\/media\//);
  });

  it("stemplowanie `public_url`, kadry serwera, awatary, wariant pojedynczy, własne drabiny", () => {
    expect(brandedMediaUrl("/media/okladka.jpg")).toBe(COVER);
    expect(absolute(buildTransformedImageUrl(COVER, { width: 400, height: 300 }))).toBe(true);
    expect(absolute(buildAvatarSrc(COVER, 48))).toBe(true);
    for (const part of buildAvatarSrcSet(COVER, 48).split(", ")) expect(absolute(part)).toBe(true);
    expect(absolute(buildScaledImageUrl(COVER, 640))).toBe(true);
    for (const part of buildImageSrcSet(COVER, [128, 256]).split(", ")) {
      expect(absolute(part)).toBe(true);
    }
  });

  it("KONTROLA: render (domyślna drabina `srcset`) jest względny", () => {
    for (const part of buildImageSrcSet(COVER).split(", ")) {
      expect(part.startsWith("/media/okladka.jpg?")).toBe(true);
    }
  });
});
