// GAŁĄŹ `mirror = true` we wspólnym builderze strony
// (`src/lib/wp-import/buildPage.ts`, linie z dynamicznym importem
// `@/lib/server/wp-media.server`).
//
// DLACZEGO OSOBNY PLIK. Istniejący `buildPage.test.ts` woła builder z
// `mirror = false` i celowo podstawia klienta Supabase, który wybucha przy
// pierwszym dotknięciu - to dobry test, ale przez to CAŁA gałąź ściągania
// mediów (`await import(...)`, przepisanie dokumentu buildera, przepisanie
// HTML-a PL i EN, przepisanie okładki) nie była wykonana ani raz.
//
// CO MA TU DOWÓD:
//   1. media z obu wersji językowych idą do mirroru w JEDNYM przebiegu -
//      to jest sedno naprawy: HTML EN był wcześniej pomijany, więc obrazki
//      z wersji angielskiej zostawały hotlinkiem do starego WordPressa,
//   2. okładka wchodzi do mirroru jako `extraUrls` i też jest przepisywana,
//   3. `mediaMirrored` = ściągnięte + użyte ponownie (dwa różne licznika,
//      jedna liczba w raporcie importu),
//   4. ostrzeżenia z mirroru dochodzą do wyniku, a nie giną,
//   5. po przepisaniu w treści NIE MA już adresów starego WordPressa,
//   6. brak okładki i brak wersji EN to dwie osobne gałęzie `if` - żadna nie
//      woła przepisywania na pusto.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: `@/lib/server/wp-media.server` - ten moduł
// ŚCIĄGA pliki po HTTP i zapisuje je w storage. To jedyna atrapa w tym pliku;
// `convertHtmlToBuilder` i cała konwersja działają prawdziwe.
//
// RODO: adresy wyłącznie w domenach example.com / example.org.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { BuilderDocument } from "@/lib/builder/types";
import type { Json } from "@/lib/content-model/json";

interface MirrorEntryLike {
  publicUrl: string;
  mediaId: string;
}
interface MirrorCall {
  html: string;
  extraUrls?: string[];
  tenantId: string;
  userId: string;
  supabase: unknown;
  includeExternal?: boolean;
}

const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  entries: [] as Array<[string, { publicUrl: string; mediaId: string }]>,
  warnings: [] as string[],
  mirroredCount: 0,
  reusedCount: 0,
}));

// Atrapa WIERNA kontraktowi: `rewriteHtml` naprawdę podmienia adresy z mapy,
// więc test widzi wynik przepisania, a nie sam fakt wywołania.
vi.mock("@/lib/server/wp-media.server", () => {
  const rewriteHtml = (html: string, map: Map<string, MirrorEntryLike>): string => {
    if (!html || map.size === 0) return html;
    let out = html;
    for (const [orig, entry] of map) out = out.split(orig).join(entry.publicUrl);
    return out;
  };
  const rewriteJson = (value: Json, map: Map<string, MirrorEntryLike>): Json => {
    if (typeof value === "string") return rewriteHtml(value, map);
    if (Array.isArray(value)) return value.map((v) => rewriteJson(v, map));
    if (value && typeof value === "object") {
      const out: { [k: string]: Json } = {};
      for (const [k, v] of Object.entries(value)) out[k] = rewriteJson(v, map);
      return out;
    }
    return value;
  };
  return {
    mirrorWpMedia: async (opts: MirrorCall) => {
      h.calls.push(opts);
      return {
        map: new Map(h.entries),
        warnings: [...h.warnings],
        mirroredCount: h.mirroredCount,
        reusedCount: h.reusedCount,
        failed: [],
      };
    },
    rewriteHtml,
    rewriteBuilderDoc: (
      doc: BuilderDocument,
      map: Map<string, MirrorEntryLike>,
    ): BuilderDocument =>
      map.size === 0
        ? doc
        : (rewriteJson(doc as unknown as Json, map) as unknown as BuilderDocument),
  };
});

import { buildPageFromHtmlPair } from "@/lib/wp-import/buildPage";

/** Klient Supabase jest przy mirrorze tylko PRZEKAZYWANY - nic go nie woła. */
const passthroughClient = { id: "supabase-stub" } as unknown as SupabaseClient<Database>;

const WP_IMG_PL = "https://example.com/wp-content/uploads/2026/01/pl-foto.jpg";
const WP_IMG_EN = "https://example.com/wp-content/uploads/2026/01/en-foto.jpg";
const WP_COVER = "https://example.com/wp-content/uploads/2026/01/okladka.jpg";
const LOCAL_PL = "https://media.example.org/storage/pl-foto.jpg";
const LOCAL_EN = "https://media.example.org/storage/en-foto.jpg";
const LOCAL_COVER = "https://media.example.org/storage/okladka.jpg";

const pl = {
  title: "Strategia energetyczna",
  // Elementor, bo tylko wtedy adres obrazka ląduje W DOKUMENCIE buildera
  // (fallback HTML zwija obrazek do bloków tekstowych) - a przedmiotem dowodu
  // jest właśnie przepisanie dokumentu, nie tylko HTML-a.
  contentHtml: `<section class="elementor-section elementor-top-section"><div class="elementor-column elementor-col-100"><div class="elementor-widget elementor-widget-image"><img src="${WP_IMG_PL}" alt="wykres" /></div></div></section>`,
  excerpt: "Zapowiedź PL",
  cover: WP_COVER,
};
const en = {
  title: "Energy strategy",
  contentHtml: `<h2>Findings</h2><p><img src="${WP_IMG_EN}" alt="chart" /></p>`,
  excerpt: "EN excerpt",
};

function firstCall(): MirrorCall {
  return h.calls[0] as MirrorCall;
}

beforeEach(() => {
  h.calls.length = 0;
  h.entries = [
    [WP_IMG_PL, { publicUrl: LOCAL_PL, mediaId: "media-pl" }],
    [WP_IMG_EN, { publicUrl: LOCAL_EN, mediaId: "media-en" }],
    [WP_COVER, { publicUrl: LOCAL_COVER, mediaId: "media-cover" }],
  ];
  h.warnings = [];
  h.mirroredCount = 2;
  h.reusedCount = 1;
});

describe("buildPageFromHtmlPair z mirror = true", () => {
  it("wysyła do mirroru treść PL I EN w jednym przebiegu, z okładką w extraUrls", async () => {
    await buildPageFromHtmlPair(passthroughClient, "tenant-1", "user-1", pl, en, true, false);
    expect(h.calls).toHaveLength(1);
    const call = firstCall();
    expect(call.html).toContain(WP_IMG_PL);
    expect(call.html).toContain(WP_IMG_EN);
    expect(call.extraUrls).toEqual([WP_COVER]);
    expect(call.tenantId).toBe("tenant-1");
    expect(call.userId).toBe("user-1");
    expect(call.supabase).toBe(passthroughClient);
    expect(call.includeExternal).toBe(false);
  });

  it("przekazuje zgodę na zewnętrzne CDN-y dalej, bez zmiany", async () => {
    await buildPageFromHtmlPair(passthroughClient, "tenant-1", "user-1", pl, en, true, true);
    expect(firstCall().includeExternal).toBe(true);
  });

  it("po przepisaniu w treści i okładce NIE MA już adresów starego WordPressa", async () => {
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      pl,
      en,
      true,
      false,
    );
    expect(built.content_pl).toContain(LOCAL_PL);
    expect(built.content_pl).not.toContain(WP_IMG_PL);
    expect(built.content_en).toContain(LOCAL_EN);
    expect(built.content_en).not.toContain(WP_IMG_EN);
    expect(built.cover_image_url).toBe(LOCAL_COVER);
    expect(JSON.stringify(built.builderDoc)).not.toContain("example.com/wp-content");
    expect(JSON.stringify(built.builderDoc)).toContain(LOCAL_PL);
  });

  it("mediaMirrored to suma ściągniętych i użytych ponownie, a ostrzeżenia dochodzą", async () => {
    h.mirroredCount = 3;
    h.reusedCount = 4;
    h.warnings = ["Nie udało się ściągnąć https://example.com/wp-content/uploads/brak.png"];
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      pl,
      en,
      true,
      false,
    );
    expect(built.mediaMirrored).toBe(7);
    expect(built.warnings).toContain(
      "Nie udało się ściągnąć https://example.com/wp-content/uploads/brak.png",
    );
  });

  it("bez okładki extraUrls jest puste, a cover zostaje null", async () => {
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      { ...pl, cover: null },
      en,
      true,
      false,
    );
    expect(firstCall().extraUrls).toEqual([]);
    expect(built.cover_image_url).toBeNull();
  });

  it("bez wersji EN mirror dostaje tylko HTML PL, a enBody to none", async () => {
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      pl,
      null,
      true,
      false,
    );
    expect(firstCall().html).toContain(WP_IMG_PL);
    expect(firstCall().html).not.toContain(WP_IMG_EN);
    expect(built.enBody).toBe("none");
    expect(built.content_en).toBeNull();
  });

  it("pusta mapa mirroru nie zmienia treści ani dokumentu", async () => {
    h.entries = [];
    h.mirroredCount = 0;
    h.reusedCount = 0;
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      pl,
      en,
      true,
      false,
    );
    expect(built.content_pl).toContain(WP_IMG_PL);
    expect(built.cover_image_url).toBe(WP_COVER);
    expect(built.mediaMirrored).toBe(0);
  });

  it("puste tytuły i zapowiedzi nie stają się null-em ani nie gubią wersji EN", async () => {
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      { ...pl, title: "", excerpt: "" },
      { ...en, title: "", excerpt: "" },
      true,
      false,
    );
    expect(built.title_pl).toBe("");
    expect(built.title_en).toBe("");
    expect(built.excerpt_pl).toBeNull();
    expect(built.excerpt_en).toBeNull();
    expect(built.enBody).toBe("persisted");
  });

  it("pusta treść PL zapisuje się jako null, a nie jako pusty łańcuch", async () => {
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      { ...pl, contentHtml: "" },
      null,
      true,
      false,
    );
    expect(built.content_pl).toBeNull();
    expect(built.source).toBe("html");
  });

  it("wersja EN bez treści: mirror dalej działa, a enBody to empty", async () => {
    const built = await buildPageFromHtmlPair(
      passthroughClient,
      "tenant-1",
      "user-1",
      pl,
      { ...en, contentHtml: "   " },
      true,
      false,
    );
    expect(built.enBody).toBe("empty");
    expect(built.content_en).toBeNull();
    expect(h.calls).toHaveLength(1);
  });
});
