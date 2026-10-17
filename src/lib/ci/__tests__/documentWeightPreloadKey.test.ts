// Bramka wagi dokumentu: klucz duplikatu preloadu (`preloadKey` w
// scripts/performance/documentWeight.ts) zdejmuje origin kanoniczny mediów.
// Dokument produkcji przychodzi z `https://neweuropeanstrategies.com`, więc
// `/media/logo.svg` (logo `Header` przez `renderedMediaUrl`) i surowy adres
// absolutny tego pliku (logo `ReadingHeader` na stronie wpisu) to JEDEN zasób
// w dwóch `<link>` - a bramka grupowała po surowym napisie i widziała tylko +1
// w `imagePreloadCount`, nigdy duplikat. Obcy origin zostaje osobnym kluczem,
// więc fixture `/` i `/blog` (obrazy `https://fixture.invalid/...`) mierzy się
// bez zmian - ostatni test odtwarza ich preloady 1:1 z artefaktu i progi obu
// plików budżetów.
import { describe, expect, it, vi } from "vitest";
import { renderedMediaUrl } from "@/lib/cropSizes";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";
import homeBudgets from "../../../../scripts/performance/document-weight-budgets.json";
import blogBudgets from "../../../../scripts/performance/document-weight-budgets.blog.json";
import postBudgets from "../../../../scripts/performance/document-weight-budgets.post.json";
import {
  CANONICAL_MEDIA_ORIGIN,
  analyzeDocument,
  checkBudgets,
  type Budgets,
} from "../../../../scripts/performance/documentWeight";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const ABSOLUTE_LOGO = `${PUBLIC_MEDIA_ORIGIN}/media/logo.svg`;
const RELATIVE_LOGO = renderedMediaUrl(ABSOLUTE_LOGO);
const page = (head: string, body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const imagePreload = (href: string) => `<link rel="preload" as="image" href="${href}"/>`;
const srcsetPreload = (srcset: string) =>
  `<link rel="preload" as="image" imageSrcSet="${srcset}" imageSizes="100vw" fetchPriority="high"/>`;
const ladder = (origin: string) =>
  [480, 768, 1024]
    .map((w) => `${origin}/media/okladka.jpg?width=${w}&amp;resize=contain&amp;quality=80 ${w}w`)
    .join(", ");
const duplicatesOf = (html: string, linkHeader?: string) => {
  const w = analyzeDocument({ html, linkHeader });
  return {
    preloadDuplicates: w.preloadDuplicates,
    documentPreloadDuplicates: w.documentPreloadDuplicates,
    imagePreloadCount: w.imagePreloadCount,
    duplicates: w.duplicates,
  };
};

describe("documentWeight: klucz duplikatu preloadu a origin kanoniczny mediów", () => {
  it("origin skryptu = origin aplikacji, a `renderedMediaUrl` daje ścieżkę względną", () => {
    expect(CANONICAL_MEDIA_ORIGIN).toBe(PUBLIC_MEDIA_ORIGIN);
    expect(RELATIVE_LOGO).toBe("/media/logo.svg");
  });

  it("para względny + absolutny tego samego pliku w `<head>` = 1 duplikat w dokumencie", () => {
    const html = page(imagePreload(RELATIVE_LOGO) + imagePreload(ABSOLUTE_LOGO));
    expect(duplicatesOf(html)).toEqual({
      preloadDuplicates: 1,
      documentPreloadDuplicates: 1,
      imagePreloadCount: 2,
      duplicates: [{ key: "/media/logo.svg", count: 2, sources: ["head", "head"] }],
    });
  });

  it("`imagesrcset`: kandydaci absolutni i względni to ten sam klucz", () => {
    const html = page(
      srcsetPreload(ladder(CANONICAL_MEDIA_ORIGIN)),
      // Ten sam preload w body (strumień) z drabiną względną.
      srcsetPreload(ladder("")),
    );
    const w = duplicatesOf(html);
    expect(w).toMatchObject({ preloadDuplicates: 1, documentPreloadDuplicates: 1 });
    expect(w.duplicates[0]?.key).toBe(`srcset:${ladder("").replace(/&amp;/g, "&")}`);
    expect(w.duplicates[0]?.sources).toEqual(["head", "body"]);
  });

  it("absolutny nagłówek `Link` + względny `<head>`: duplikat tylko w `preloadDuplicates`", () => {
    const w = duplicatesOf(
      page(imagePreload(RELATIVE_LOGO)),
      `<${ABSOLUTE_LOGO}>; rel="preload"; as="image"`,
    );
    expect(w).toMatchObject({ preloadDuplicates: 1, documentPreloadDuplicates: 0 });
    expect(w.duplicates).toEqual([
      { key: "/media/logo.svg", count: 2, sources: ["head", "header"] },
    ]);
  });

  it("obcy origin z tą samą ścieżką NIE łączy się z adresem względnym", () => {
    for (const foreign of [
      "https://fixture.invalid/media/logo.svg",
      "https://cdn.neweuropeanstrategies.com/media/logo.svg",
      "http://neweuropeanstrategies.com/media/logo.svg",
    ]) {
      const w = duplicatesOf(page(imagePreload(RELATIVE_LOGO) + imagePreload(foreign)));
      expect(w, foreign).toMatchObject({
        preloadDuplicates: 0,
        documentPreloadDuplicates: 0,
        imagePreloadCount: 2,
        duplicates: [],
      });
    }
    const srcset = duplicatesOf(
      page(srcsetPreload(ladder("https://fixture.invalid")) + srcsetPreload(ladder(""))),
    );
    expect(srcset.preloadDuplicates).toBe(0);
  });

  it("fixture `/`, `/blog` i wpisu (preloady 1:1 z artefaktu): pomiar i progi bez zmian", () => {
    // Preloady dokumentu fixture `/blog` (`/` i wpis `/blog/fixture-2` mają te same trzy:
    // logo nagłówka, okładka-kandydat, font) i jego nagłówek `Link` z artefaktu
    // `build:smoke`: logo i okładka z `https://fixture.invalid`, font z `/assets`.
    const html = page(
      imagePreload("https://fixture.invalid/image.svg") +
        '<link rel="preload" as="image" href="https://fixture.invalid/cover.jpg" fetchPriority="high"/>' +
        '<link rel="preload" as="font" type="font/woff2" href="/assets/red-hat-display-latin-pl-CkxMVW1W.woff2" crossorigin="anonymous"/>',
    );
    const linkHeader = [
      '</assets/styles-DKWju7ak.css>; rel="preload"; as="style"',
      '<https://unnltowbgszpdzwpawdu.supabase.co>; rel="preconnect"; crossorigin="anonymous"',
      '</assets/red-hat-display-latin-pl-CkxMVW1W.woff2>; rel="preload"; as="font"; type="font/woff2"; crossorigin',
      '<https://fixture.invalid/cover.jpg>; rel="preload"; as="image"; fetchpriority=high',
    ].join(", ");
    const w = analyzeDocument({ html, linkHeader });
    expect({
      preloadDuplicates: w.preloadDuplicates,
      documentPreloadDuplicates: w.documentPreloadDuplicates,
      imagePreloadCount: w.imagePreloadCount,
      keys: w.duplicates.map((d) => d.key),
    }).toEqual({
      preloadDuplicates: 2,
      documentPreloadDuplicates: 0,
      imagePreloadCount: 3,
      keys: [
        "https://fixture.invalid/cover.jpg",
        "/assets/red-hat-display-latin-pl-CkxMVW1W.woff2",
      ],
    });
    const gated = ["preloadDuplicates", "documentPreloadDuplicates", "imagePreloadCount"];
    for (const budgets of [homeBudgets, blogBudgets, postBudgets]) {
      const results = checkBudgets(w, budgets.budgets as Budgets).filter((r) =>
        gated.includes(r.metric),
      );
      expect(results.map((r) => [r.metric, r.ok])).toEqual(gated.map((m) => [m, true]));
    }
  });
});
