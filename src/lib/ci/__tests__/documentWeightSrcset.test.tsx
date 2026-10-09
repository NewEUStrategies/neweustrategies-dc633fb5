// Bramka wagi dokumentu: metryki `srcset` z P3.2a (`srcsetCandidatesMax`,
// `absoluteCanonicalMediaInRenderedSrcset`) liczone na PRAWDZIWYM wyjściu
// komponentów (`OptimizedImage`, preload `Link` kandydata) oraz na HTML-u w
// kształcie sprzed P3.2a (kontrola negatywna: baza byłaby czerwona).
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import {
  LEGACY_AVATAR_RESPONSIVE_WIDTHS,
  buildAvatarSrcSet,
  buildImageSrcSet,
} from "@/lib/cropSizes";
import { lcpPreloadLinkHeaderValue } from "@/lib/builder/heroImage";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";
import budgets from "../../../../scripts/performance/document-weight-budgets.json";
import {
  CANONICAL_MEDIA_ORIGIN,
  analyzeDocument,
  checkBudgets,
  type Budgets,
} from "../../../../scripts/performance/documentWeight";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const COVER = `${PUBLIC_MEDIA_ORIGIN}/media/okladka.jpg`;
const page = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
const weigh = (html: string, linkHeader?: string) => {
  const w = analyzeDocument({ html, linkHeader });
  return {
    max: w.srcsetCandidatesMax,
    absolute: w.absoluteCanonicalMediaInRenderedSrcset,
    gate: checkBudgets(w, budgets.budgets as Budgets).filter(
      (r) =>
        r.metric === "srcsetCandidatesMax" || r.metric === "absoluteCanonicalMediaInRenderedSrcset",
    ),
  };
};

describe("documentWeight: metryki srcset P3.2a", () => {
  it("origin kanoniczny skryptu = origin aplikacji", () => {
    expect(CANONICAL_MEDIA_ORIGIN).toBe(PUBLIC_MEDIA_ORIGIN);
  });

  it("okładka po P3.2a (domyślna drabina): 5 kandydatów, zero adresów absolutnych - zielono", () => {
    const html = page(renderToString(<OptimizedImage src={COVER} alt="" responsive />));
    const w = weigh(html);
    expect(w).toMatchObject({ max: 5, absolute: 0 });
    expect(w.gate.map((r) => r.ok)).toEqual([true, true]);
  });

  it("preload kandydata w nagłówku `Link`: względny, 5 kandydatów", () => {
    const value = lcpPreloadLinkHeaderValue({
      href: "/media/okladka.jpg",
      imageSrcSet: buildImageSrcSet(COVER),
      imageSizes: "100vw",
    });
    expect(weigh(page(""), value)).toMatchObject({ max: 5, absolute: 0 });
  });

  it("KONTROLA NEGATYWNA: dokument sprzed P3.2a (9 absolutnych kandydatów) jest czerwony", () => {
    const before = [320, 480, 640, 768, 1024, 1280, 1536, 1920, 2400]
      .map((width) => `${COVER}?width=${width}&amp;resize=contain&amp;quality=80 ${width}w`)
      .join(", ");
    const html = page(`<img src="${COVER}" srcset="${before}" alt="">`);
    const w = weigh(html, `<${COVER}>; rel="preload"; as="image"; imagesrcset="${COVER} 480w"`);
    expect(w).toMatchObject({ max: 9, absolute: 10 });
    expect(w.gate.map((r) => r.ok)).toEqual([false, false]);
  });

  it("zdjęcia osób na dawnej drabinie liczą się świadomie; awatary `x` nie", () => {
    // Decyzja właściciela: awatar autora i prelegenci bez zmian (9 absolutnych).
    // Na `/` ich nie ma; wyjątek po szerokościach ukryłby powrót dawnej drabiny
    // domyślnej, bo ma te same szerokości.
    const legacy = page(
      renderToString(
        <OptimizedImage
          src={COVER}
          alt=""
          responsive
          responsiveWidths={LEGACY_AVATAR_RESPONSIVE_WIDTHS}
        />,
      ),
    );
    expect(weigh(legacy)).toMatchObject({ max: 9, absolute: 9 });
    const avatar = page(
      renderToString(<img src={COVER} srcSet={buildAvatarSrcSet(COVER, 48)} alt="" />),
    );
    expect(avatar).toContain(" 3x");
    expect(weigh(avatar)).toMatchObject({ max: 0, absolute: 0 });
  });

  it("źródło `<picture>` z GIF-em `data:` (logo nagłówka) nie jest kandydatem `w`", () => {
    const html = page(
      `<picture class="contents"><source media="(max-width: 1023px)" srcset="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><img src="/media/logo.svg" alt=""></picture>`,
    );
    expect(weigh(html)).toMatchObject({ max: 0, absolute: 0 });
  });
});
