// Trzy reguły wyprowadzone z organizmów artykułu. Każda była wcześniej
// nieosiągalna dla testu bez zbudowania sztucznego środowiska:
//
//   `badgeContrast`   - siedziała prywatnie w `CategoryBadges`, więc dowód
//                       czytelności etykiety wymagał renderu linku z routerem
//                       i czytania atrybutu `style`;
//   `quoteSelection`  - siedziała w `QuoteShareBar`, który bez PRAWDZIWEGO
//                       zaznaczenia nie renderuje niczego;
//   `autoLoadChain`   - siedziała w callbacku `IntersectionObserver`, więc test
//                       potrzebowałby atrapy obserwatora - a atrapa, która widzi
//                       sentinel w niewłaściwym momencie, dowodzi czegoś innego.
import { describe, it, expect } from "vitest";
import {
  DARK_TEXT,
  LIGHT_BACKGROUND_LUMINANCE,
  LIGHT_TEXT,
  THEME_TEXT,
  categoryHref,
  categoryLabel,
  pickTextColor,
} from "@/lib/post/badgeContrast";
import {
  MAX_QUOTE_LEN,
  MIN_QUOTE_LEN,
  X_TEXT_BUDGET,
  attributedQuote,
  clipboardQuote,
  isShareableQuote,
  linkedinShareUrl,
  normalizeQuote,
  quoteBarPosition,
  quoteBarState,
  xQuoteText,
  xShareUrl,
} from "@/lib/post/quoteSelection";
import {
  DEFAULT_MAX_CHAIN,
  chainHeadingId,
  nextCursor,
  shouldRequestNext,
} from "@/lib/post/autoLoadChain";

// ── KONTRAST ETYKIETY KATEGORII (WCAG) ────────────────────────────────────────

describe("pickTextColor - czytelność etykiety na kolorze redakcji", () => {
  it("na BIAŁYM tle daje ciemny napis, na CZARNYM jasny", () => {
    expect(pickTextColor("#ffffff")).toBe(DARK_TEXT);
    expect(pickTextColor("#000000")).toBe(LIGHT_TEXT);
  });

  it("brak koloru bierze kolor z MOTYWU (nigdy przypadkowy)", () => {
    expect(pickTextColor(null)).toBe(THEME_TEXT);
    expect(pickTextColor(undefined)).toBe(THEME_TEXT);
    expect(pickTextColor("")).toBe(THEME_TEXT);
  });

  it("skrót `#fff` i inne formaty degradują do koloru motywu, nie do zgadywania", () => {
    expect(pickTextColor("#fff")).toBe(THEME_TEXT);
    expect(pickTextColor("rgb(255,255,255)")).toBe(THEME_TEXT);
    expect(pickTextColor("czerwony")).toBe(THEME_TEXT);
  });

  it("działa z prefiksem `#` i bez niego (baza trzyma oba warianty)", () => {
    expect(pickTextColor("ffffff")).toBe(DARK_TEXT);
    expect(pickTextColor("#ffffff")).toBe(pickTextColor("ffffff"));
  });

  it("ZIELEŃ jest jasna, GRANAT ciemny - waga kanału zielonego dominuje", () => {
    // Bez wag sRGB (0,2126 / 0,7152 / 0,0722) jasna zieleń dostałaby biały napis.
    expect(pickTextColor("#00ff00")).toBe(DARK_TEXT);
    expect(pickTextColor("#0000ff")).toBe(LIGHT_TEXT);
  });

  it("kolor marki (#fa9346) dostaje CIEMNY napis", () => {
    expect(pickTextColor("#fa9346")).toBe(DARK_TEXT);
    expect(LIGHT_BACKGROUND_LUMINANCE).toBe(0.6);
  });

  it("INWARIANT: każdy kolor z siatki dostaje jeden z dwóch dozwolonych napisów", () => {
    const steps = ["00", "40", "80", "c0", "ff"];
    let checked = 0;
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          expect([DARK_TEXT, LIGHT_TEXT]).toContain(pickTextColor(`#${r}${g}${b}`));
          checked += 1;
        }
      }
    }
    expect(checked).toBe(125);
  });

  it("wartość szesnastkowa ze śmieciem nie daje NaN-owego wyniku", () => {
    // `parseInt("zz", 16)` to NaN; wynik musi zostać jednym z dwóch kolorów.
    expect([DARK_TEXT, LIGHT_TEXT]).toContain(pickTextColor("#zzzzzz"));
    expect(pickTextColor("#zzzzzz")).toBe(LIGHT_TEXT);
  });
});

describe("categoryLabel / categoryHref", () => {
  const cat = { name_pl: "Bezpieczeństwo", name_en: "Security" };

  it("bierze nazwę z żądanego języka", () => {
    expect(categoryLabel(cat, "pl")).toBe("Bezpieczeństwo");
    expect(categoryLabel(cat, "en")).toBe("Security");
  });

  it("brak nazwy w danym języku degraduje do drugiego (nigdy pusta pigułka)", () => {
    expect(categoryLabel({ name_pl: "Tylko PL", name_en: "" }, "en")).toBe("Tylko PL");
    expect(categoryLabel({ name_pl: "", name_en: "Only EN" }, "pl")).toBe("Only EN");
  });

  it("adres archiwum niesie prefiks `/en/` WYŁĄCZNIE dla wersji angielskiej", () => {
    expect(categoryHref("obrona", "pl")).toBe("/category/obrona");
    expect(categoryHref("obrona", "en")).toBe("/en/category/obrona");
  });
});

// ── UDOSTĘPNIANIE CYTATU ──────────────────────────────────────────────────────

describe("normalizeQuote / isShareableQuote", () => {
  it("zwija białe znaki z zaznaczenia przez kilka akapitów", () => {
    expect(normalizeQuote("  Pierwsze zdanie.\n\n   Drugie zdanie.  ")).toBe(
      "Pierwsze zdanie. Drugie zdanie.",
    );
    expect(normalizeQuote("a\t\tb")).toBe("a b");
  });

  it("odrzuca cytat KRÓTSZY niż minimum (przypadkowy klik)", () => {
    expect(MIN_QUOTE_LEN).toBe(8);
    expect(isShareableQuote("krótkie")).toBe(false);
    expect(isShareableQuote("dokładnie")).toBe(true);
  });

  it("granica minimum jest WŁĄCZNA", () => {
    expect(isShareableQuote("a".repeat(MIN_QUOTE_LEN))).toBe(true);
    expect(isShareableQuote("a".repeat(MIN_QUOTE_LEN - 1))).toBe(false);
  });

  it("odrzuca cytat DŁUŻSZY niż maksimum (zaznaczenie całego artykułu)", () => {
    expect(MAX_QUOTE_LEN).toBe(600);
    expect(isShareableQuote("a".repeat(MAX_QUOTE_LEN))).toBe(true);
    expect(isShareableQuote("a".repeat(MAX_QUOTE_LEN + 1))).toBe(false);
  });
});

describe("quoteBarState - kiedy pasek się pojawia i gdzie stoi", () => {
  const rect = { top: 300, left: 400, width: 200, height: 20 };

  it("poprawne zaznaczenie daje deskryptor z cytatem i pozycją", () => {
    const state = quoteBarState("To jest realny cytat z analizy.", rect, 1200);
    expect(state?.quote).toBe("To jest realny cytat z analizy.");
    expect(state?.top).toBe(300 - 44);
  });

  it("cytat jest znormalizowany PRZED sprawdzeniem limitu", () => {
    const state = quoteBarState("   Cytat    z    odstępami   ", rect, 1200);
    expect(state?.quote).toBe("Cytat z odstępami");
    expect(state?.quote).not.toContain("  ");
  });

  it("za krótkie i za długie zaznaczenie NIE pokazuje paska", () => {
    expect(quoteBarState("krótkie", rect, 1200)).toBeNull();
    expect(quoteBarState("a".repeat(601), rect, 1200)).toBeNull();
  });

  it("ZWINIĘTE zaznaczenie (prostokąt 0x0) nie ma nad czym postawić paska", () => {
    expect(
      quoteBarState("Poprawny cytat tekstowy", { ...rect, width: 0, height: 0 }, 1200),
    ).toBeNull();
    expect(quoteBarState("Poprawny cytat tekstowy", { ...rect, width: 0 }, 1200)).not.toBeNull();
  });

  it("pasek jest WYŚRODKOWANY nad zaznaczeniem", () => {
    const { left } = quoteBarPosition({ top: 100, left: 400, width: 200, height: 20 }, 1200);
    expect(left).toBe(500);
    expect(left).toBeGreaterThan(400);
  });

  it("pasek przy LEWEJ krawędzi jest docinany do widocznego obszaru", () => {
    const { left } = quoteBarPosition({ top: 100, left: 0, width: 10, height: 20 }, 1200);
    expect(left).toBe(90);
    expect(left).toBeGreaterThan(0);
  });

  it("pasek przy PRAWEJ krawędzi też (inaczej byłby nieklikalny)", () => {
    const { left } = quoteBarPosition({ top: 100, left: 1190, width: 10, height: 20 }, 1200);
    expect(left).toBe(1110);
    expect(left).toBeLessThan(1200);
  });

  it("cytat przy GÓRNEJ krawędzi nie wychodzi nad okno", () => {
    const { top } = quoteBarPosition({ top: 5, left: 400, width: 200, height: 20 }, 1200);
    expect(top).toBe(8);
    expect(top).toBeGreaterThan(0);
  });
});

describe("xShareUrl - budżet znaków X", () => {
  it("krótki cytat idzie bez przycięcia", () => {
    const quote = "Krótki, ale sensowny cytat.";
    expect(xQuoteText(quote)).toBe(quote);
    expect(xShareUrl(quote, "https://nes.eu/a")).toContain(encodeURIComponent(quote));
  });

  it("długi cytat jest PRZYCINANY do budżetu i domknięty wielokropkiem", () => {
    const long = "a".repeat(400);
    const text = xQuoteText(long);
    expect(text.length).toBe(X_TEXT_BUDGET);
    expect(text.endsWith("…")).toBe(true);
  });

  it("budżet zostawia miejsce na URL liczony przez X jako 23 znaki", () => {
    expect(X_TEXT_BUDGET).toBe(280 - 23 - 6);
    expect(xQuoteText("a".repeat(1000)).length).toBeLessThan(280 - 23);
  });

  it("cytat DOKŁADNIE na budżecie nie jest przycinany", () => {
    const exact = "a".repeat(X_TEXT_BUDGET);
    expect(xQuoteText(exact)).toBe(exact);
    expect(xQuoteText(exact).endsWith("…")).toBe(false);
  });

  it("przycięcie nie zostawia wiszącej spacji przed wielokropkiem", () => {
    const quote = `${"a".repeat(X_TEXT_BUDGET - 2)} bcdef`;
    const text = xQuoteText(quote);
    expect(text).not.toContain(" …");
    expect(text.endsWith("…")).toBe(true);
  });

  it("adres niesie CYTAT i URL osobno, oba zakodowane", () => {
    const url = xShareUrl("Cytat z analizy NES.", "https://nes.eu/post/a?b=1");
    expect(url).toContain("text=");
    expect(url).toContain(`url=${encodeURIComponent("https://nes.eu/post/a?b=1")}`);
  });

  it("cytat w adresie jest w cudzysłowach drukarskich", () => {
    const url = xShareUrl("Cytat", "https://nes.eu/a");
    expect(url).toContain(encodeURIComponent("„Cytat”"));
    expect(url.startsWith("https://x.com/intent/post?")).toBe(true);
  });
});

describe("linkedinShareUrl / treść schowka", () => {
  it("LinkedIn dostaje WYŁĄCZNIE URL (share-offsite nie przyjmuje tekstu)", () => {
    const url = linkedinShareUrl("https://nes.eu/post/a");
    expect(url).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://nes.eu/post/a")}`,
    );
    expect(url).not.toContain("text=");
  });

  it("schowek pod LinkedIn niesie sam cytat w cudzysłowach", () => {
    expect(clipboardQuote("Cytat")).toBe("„Cytat”");
    expect(clipboardQuote("Cytat")).not.toContain("http");
  });

  it("schowek pod `Kopiuj cytat` niesie ATRYBUCJĘ i adres", () => {
    const copied = attributedQuote("Cytat", "New European Strategies", "https://nes.eu/a");
    expect(copied).toContain("New European Strategies");
    expect(copied).toContain("https://nes.eu/a");
  });

  it("atrybucja zachowuje cudzysłowy wokół cytatu", () => {
    const copied = attributedQuote("Cytat", "NES", "https://nes.eu/a");
    expect(copied.startsWith("„Cytat”")).toBe(true);
    expect(copied).toContain(" - NES, ");
  });
});

// ── DOŁADOWYWANIE KOLEJNYCH WPISÓW ────────────────────────────────────────────

describe("shouldRequestNext - warunki doładowania", () => {
  const base = {
    done: false,
    chainLength: 0,
    maxChain: DEFAULT_MAX_CHAIN,
    loading: false,
    requested: false,
    intersecting: true,
  };

  it("sentinel w widoku i czysty stan => pobieramy", () => {
    expect(shouldRequestNext(base)).toBe(true);
    expect(DEFAULT_MAX_CHAIN).toBe(5);
  });

  it("sentinel POZA widokiem => nie pobieramy", () => {
    expect(shouldRequestNext({ ...base, intersecting: false })).toBe(false);
    expect(shouldRequestNext(base)).toBe(true);
  });

  it("KONIEC WPISÓW blokuje na stałe (poprzednie pobranie zwróciło pustkę)", () => {
    expect(shouldRequestNext({ ...base, done: true })).toBe(false);
    expect(shouldRequestNext({ ...base, done: true, chainLength: 0 })).toBe(false);
  });

  it("LIMIT ŁAŃCUCHA zatrzymuje wzrost strony bez końca", () => {
    expect(shouldRequestNext({ ...base, chainLength: 5 })).toBe(false);
    expect(shouldRequestNext({ ...base, chainLength: 4 })).toBe(true);
  });

  it("limit jest respektowany także przy własnej wartości `maxChain`", () => {
    expect(shouldRequestNext({ ...base, chainLength: 1, maxChain: 1 })).toBe(false);
    expect(shouldRequestNext({ ...base, chainLength: 0, maxChain: 1 })).toBe(true);
  });

  it("TRWAJĄCE żądanie blokuje kolejne (jeden wpis naraz)", () => {
    expect(shouldRequestNext({ ...base, loading: true })).toBe(false);
    expect(shouldRequestNext({ ...base, loading: false })).toBe(true);
  });

  it("STRAŻNIK PODWÓJNEGO WYWOŁANIA blokuje drugie przecięcie tego samego sentinela", () => {
    // Obserwator potrafi wywołać callback wielokrotnie dla jednego przejścia
    // (przewijanie tam i z powrotem) - bez tej flagi lecą DWA żądania.
    expect(shouldRequestNext({ ...base, requested: true })).toBe(false);
    expect(shouldRequestNext({ ...base, requested: false })).toBe(true);
  });

  it("`intersecting: false` wygrywa nad wszystkim - nie pobieramy w tle", () => {
    expect(shouldRequestNext({ ...base, intersecting: false, done: false, chainLength: 0 })).toBe(
      false,
    );
    expect(shouldRequestNext({ ...base, intersecting: false, loading: true })).toBe(false);
  });
});

describe("nextCursor - od którego wpisu szukamy następnego", () => {
  const fallback = { id: "otwarty", publishedAt: "2026-08-01" };

  it("pusty łańcuch => kursor to wpis OTWARTY przez czytelnika", () => {
    expect(nextCursor([], fallback)).toEqual(fallback);
    expect(nextCursor([], fallback).id).toBe("otwarty");
  });

  it("niepusty łańcuch => kursor to OSTATNI doładowany wpis (inaczej pętla)", () => {
    const chain = [
      { post: { id: "a", published_at: "2026-07-01" } },
      { post: { id: "b", published_at: "2026-06-01" } },
    ];
    expect(nextCursor(chain, fallback)).toEqual({ id: "b", publishedAt: "2026-06-01" });
    expect(nextCursor(chain, fallback).id).not.toBe("otwarty");
  });

  it("wpis bez daty publikacji przechodzi jako `null`, nie jako `undefined`", () => {
    const chain = [{ post: { id: "a", published_at: null } }];
    expect(nextCursor(chain, fallback)).toEqual({ id: "a", publishedAt: null });
    expect(nextCursor(chain, fallback).publishedAt).toBeNull();
  });
});

describe("chainHeadingId", () => {
  it("kotwica nagłówka niesie identyfikator wpisu (podmiana adresu URL)", () => {
    expect(chainHeadingId("post-1")).toBe("nextpost-post-1");
    expect(chainHeadingId("post-2")).not.toBe(chainHeadingId("post-1"));
  });
});
