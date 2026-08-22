// Kanonizacja adresów sitemapy + klaster hreflang PL/EN.
import { describe, expect, it } from "vitest";

import { buildRedirectIndex, type RedirectRule } from "@/lib/seo/redirects";
import { canonicalSitemapPath, sitemapLanguageUrls } from "@/lib/seo/sitemapUrls";

const ORIGIN = "https://neweuropeanstrategies.com";

function index(rules: Array<Partial<RedirectRule> & { source_path: string; target_path: string }>) {
  return buildRedirectIndex(
    rules.map((r, i) => ({
      id: `r${i}`,
      status_code: 301,
      ...r,
    })) as RedirectRule[],
  );
}

describe("canonicalSitemapPath", () => {
  it("zwraca ścieżkę bez zmian, gdy nie ma reguł", () => {
    expect(canonicalSitemapPath(null, "/o-nas")).toBe("/o-nas");
    expect(canonicalSitemapPath(index([]), "/o-nas")).toBe("/o-nas");
  });

  it("podmienia adres źródłowy na docelowy", () => {
    const idx = index([{ source_path: "/about-us", target_path: "/o-nas" }]);
    expect(canonicalSitemapPath(idx, "/about-us")).toBe("/o-nas");
  });

  it("domyka łańcuch przekierowań do adresu końcowego", () => {
    const idx = index([
      { source_path: "/a", target_path: "/b" },
      { source_path: "/b", target_path: "/c" },
    ]);
    expect(canonicalSitemapPath(idx, "/a")).toBe("/c");
  });

  it("pomija adresy oznaczone jako 410 Gone", () => {
    const idx = index([{ source_path: "/wp-old", target_path: "/", status_code: 410 }]);
    expect(canonicalSitemapPath(idx, "/wp-old")).toBeNull();
  });

  it("pomija przekierowania na obcy host, akceptuje własny", () => {
    const idx = index([
      { source_path: "/x", target_path: "https://example.com/x" },
      { source_path: "/y", target_path: "https://www.neweuropeanstrategies.com/nowe" },
    ]);
    expect(canonicalSitemapPath(idx, "/x", ["neweuropeanstrategies.com"])).toBeNull();
    expect(canonicalSitemapPath(idx, "/y", ["neweuropeanstrategies.com"])).toBe("/nowe");
  });

  it("obsługuje reguły wildcard", () => {
    const idx = index([{ source_path: "/kategoria/*", target_path: "/category/*" }]);
    expect(canonicalSitemapPath(idx, "/kategoria/geopolityka")).toBe("/category/geopolityka");
  });
});

describe("sitemapLanguageUrls", () => {
  it("tworzy wpis PL i EN z pełnym, wzajemnym klastrem hreflang", () => {
    const urls = sitemapLanguageUrls(ORIGIN, "/o-nas");
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/o-nas`, `${ORIGIN}/en/o-nas`]);
    for (const u of urls) {
      expect(u.alternates).toEqual([
        { hreflang: "x-default", href: `${ORIGIN}/o-nas` },
        { hreflang: "pl", href: `${ORIGIN}/o-nas` },
        { hreflang: "en", href: `${ORIGIN}/en/o-nas` },
      ]);
    }
  });

  it("hreflang wskazuje adresy po przekierowaniu, nie źródłowe", () => {
    const idx = index([{ source_path: "/about-us", target_path: "/o-nas" }]);
    const urls = sitemapLanguageUrls(ORIGIN, "/about-us", idx);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/o-nas`, `${ORIGIN}/en/o-nas`]);
    expect(urls[0].alternates.map((a) => a.href)).not.toContain(`${ORIGIN}/about-us`);
  });

  it("respektuje regułę zdefiniowaną wyłącznie dla wariantu /en", () => {
    const idx = index([{ source_path: "/en/o-nas", target_path: "/en/about" }]);
    const urls = sitemapLanguageUrls(ORIGIN, "/o-nas", idx);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/o-nas`, `${ORIGIN}/en/about`]);
  });

  it("pomija dokument wycofany regułą 410", () => {
    const idx = index([{ source_path: "/stare", target_path: "/", status_code: 410 }]);
    expect(sitemapLanguageUrls(ORIGIN, "/stare", idx)).toEqual([]);
  });

  it("nie generuje wariantu EN dla ścieżek nielokalizowanych", () => {
    const urls = sitemapLanguageUrls(ORIGIN, "/people");
    expect(urls).toHaveLength(1);
    expect(urls[0].loc).toBe(`${ORIGIN}/people`);
    expect(urls[0].alternates).toEqual([]);
  });

  it("normalizuje wejście z prefiksem językowym do jednego dokumentu", () => {
    const fromEn = sitemapLanguageUrls(ORIGIN, "/en/blog");
    const fromPl = sitemapLanguageUrls(ORIGIN, "/blog");
    expect(fromEn).toEqual(fromPl);
  });
});

// ── Wejścia niepełne i cele degenerowane ────────────────────────────────────
// Sitemapa jest dokumentem, który crawler czyta bez człowieka: każdy <loc>
// musi być absolutnym, kanonicznym adresem. Poniższe przypadki domykają gałęzie
// awaryjne, na których stoi ta gwarancja.
describe("canonicalSitemapPath - wejścia degenerowane", () => {
  it("puste wejście traktuje jako korzeń serwisu", () => {
    // Gałąź `pathname || "/"` (sitemapUrls.ts:49) - <loc> nie może być puste.
    expect(canonicalSitemapPath(null, "")).toBe("/");
    expect(canonicalSitemapPath(index([]), "")).toBe("/");
  });

  it("cel będący samym fragmentem degraduje do korzenia, nie do pustej ścieżki", () => {
    // Gałąź `clean || "/"` (sitemapUrls.ts:30). Import z legacy (WP/CSV)
    // potrafi zostawić cel "#top"; po odcięciu hasha i query nie zostaje nic,
    // więc sitemapa musi wskazać "/" zamiast wypuścić <loc>https://host</loc>.
    const idx = index([{ source_path: "/stara-kotwica", target_path: "#top" }]);
    expect(canonicalSitemapPath(idx, "/stara-kotwica")).toBe("/");
  });

  it("cel z samym query degraduje do korzenia", () => {
    const idx = index([{ source_path: "/stary-parametr", target_path: "?p=123" }]);
    expect(canonicalSitemapPath(idx, "/stary-parametr")).toBe("/");
  });

  it("reguła na własny host wskazująca TEN SAM adres kończy kanonizację na nim", () => {
    // Gałąź `next === current` (sitemapUrls.ts:72). Reguły kanonizacyjne
    // (http->https, www->bez www) są w bazie zapisane jako PEŁNY URL, więc po
    // odcięciu hosta cel jest identyczny ze źródłem. Bez tego wyjścia pętla
    // kręciłaby się do MAX_HOPS i adres wypadłby z sitemapy jako "niestabilny".
    const idx = index([
      { source_path: "/o-nas", target_path: "https://www.neweuropeanstrategies.com/o-nas" },
    ]);
    expect(canonicalSitemapPath(idx, "/o-nas", ["neweuropeanstrategies.com"])).toBe("/o-nas");
  });

  it("cel wyglądający na URL absolutny, ale nieparsowalny, wypada z sitemapy", () => {
    // `new URL(next)` w bloku try (sitemapUrls.ts:60-64): "http://" przechodzi
    // test /^https?:\/\//, a mimo to nie da się go sparsować. Sitemapa musi
    // wtedy POMINĄĆ jeden adres, a nie wywrócić generatora XML całego szardu.
    const idx = index([
      { source_path: "/zepsuty", target_path: "http://" },
      { source_path: "/zepsuty-nawias", target_path: "https://[nie-host" },
    ]);
    expect(canonicalSitemapPath(idx, "/zepsuty", ["neweuropeanstrategies.com"])).toBeNull();
    expect(canonicalSitemapPath(idx, "/zepsuty-nawias", ["neweuropeanstrategies.com"])).toBeNull();
  });

  it("bez listy własnych hostów każdy URL absolutny jest obcy", () => {
    const idx = index([
      { source_path: "/y", target_path: "https://neweuropeanstrategies.com/nowe" },
    ]);
    expect(canonicalSitemapPath(idx, "/y")).toBeNull();
  });

  it("łańcuch dłuższy niż limit skoków jest pomijany jako niestabilny", () => {
    // Reguły wildcard nie są spłaszczane przez resolveChain, więc każdy skok
    // zużywa jeden obrót pętli w canonicalSitemapPath.
    const idx = index([
      { source_path: "/a1/*", target_path: "/a2/*" },
      { source_path: "/a2/*", target_path: "/a3/*" },
      { source_path: "/a3/*", target_path: "/a4/*" },
      { source_path: "/a4/*", target_path: "/a5/*" },
      { source_path: "/a5/*", target_path: "/a6/*" },
      { source_path: "/a6/*", target_path: "/a7/*" },
    ]);
    expect(canonicalSitemapPath(idx, "/a1/x")).toBeNull();
  });
});

describe("sitemapLanguageUrls - język bez kanonicznego adresu", () => {
  it("wariant /en wycofany regułą 410 zostawia sam wpis PL, bez klastra hreflang", () => {
    // Gałąź `if (target)` (sitemapUrls.ts:108): język, który nie ma
    // kanonicznego adresu, NIE wchodzi do mapy - i wtedy nie wolno emitować
    // hreflang, bo klaster musi być wzajemny (link do 410 to błąd w GSC).
    const idx = index([{ source_path: "/en/tylko-po-polsku", target_path: "/", status_code: 410 }]);
    const urls = sitemapLanguageUrls(ORIGIN, "/tylko-po-polsku", idx);
    expect(urls).toHaveLength(1);
    expect(urls[0].lang).toBe("pl");
    expect(urls[0].loc).toBe(`${ORIGIN}/tylko-po-polsku`);
    expect(urls[0].alternates).toEqual([]);
  });

  it("wariant /en przekierowany na obcy host również wypada z klastra", () => {
    const idx = index([
      { source_path: "/en/analiza", target_path: "https://partner.example/analysis" },
    ]);
    const urls = sitemapLanguageUrls(ORIGIN, "/analiza", idx, ["neweuropeanstrategies.com"]);
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/analiza`]);
    expect(urls[0].alternates).toEqual([]);
  });
});
