// WALIDATORY WEJŚCIA `src/lib/content.functions.ts` - pierwsza bramka każdej
// z 21 funkcji serwerowych sekcji treści.
//
// CO MA TU DOWÓD:
//   1. każdy eksport modułu jest kompletnym server fn (walidator + handler) -
//      brak walidatora oznaczałby ładunek z klienta wpuszczony bez sprawdzenia,
//   2. limity, które MUSZĄ odpowiadać bazie: liczba i długość punktów
//      „dowiesz się" (triggery `posts_validate_takeaways`), allowlista głosów
//      TTS (CHECK-i kolumn `tts_voice_*`), 200 000 znaków treści, czapki
//      długości SEO, kolor `#rrggbb`,
//   3. normalizacje, które są ZACHOWANIEM, nie kosmetyką: slugify wejścia
//      z edytora, `""` → `null` dla głosu TTS i `logo_url`, trim nazw kategorii,
//   4. asymetria statusów hurtowych: `BulkPostStatus` świadomie NIE zna
//      `scheduled` (harmonogram wymaga daty per wpis), a `PageStatus` - zna.
//
// CZEGO TU NIE MA. Zachowania handlerów (bramki workflow, ujawnienie
// komercyjne, optimistic-lock, przekierowania 301) - to osobne pliki
// `contentFunctions.postUpdate/posts/pages/taxonomy.test.ts`. Reguł
// egzekwowanych w bazie (RLS, CHECK-i, triggery) nie sprawdzamy atrapą - to
// pgTAP w `supabase/tests`.
import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_VOICE_ID,
  CATEGORY_ID,
  POST_ID,
  PAGE_ID,
  PARENT_PAGE_ID,
  TEMPLATE_ID,
  USER,
  type ServerFnSpec,
} from "./contentFunctionsHarness";

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub: stub } = await import("./contentFunctionsHarness");
  return { createServerFn: stub, createMiddleware: () => ({}) };
});
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: async () => true }));
vi.mock("@/lib/server/audit.server", () => ({ recordAudit: async () => undefined }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({}) } }));

import * as content from "@/lib/content.functions";

function spec(name: string): ServerFnSpec {
  return content[name as keyof typeof content] as unknown as ServerFnSpec;
}

function parse(name: string, input: unknown): unknown {
  return spec(name).validator?.(input);
}

const EXPORTED_FNS = [
  "createPost",
  "updatePost",
  "deletePost",
  "duplicatePost",
  "bulkDeletePosts",
  "restorePosts",
  "purgePosts",
  "bulkUpdatePosts",
  "createPage",
  "updatePage",
  "deletePage",
  "bulkDeletePages",
  "restorePages",
  "purgePages",
  "bulkUpdatePages",
  "upsertCategory",
  "updateCategoryColor",
  "deleteCategory",
  "createTag",
  "deleteTag",
  "setPostAuthors",
] as const;

describe("kompletność modułu", () => {
  it("każdy eksport to server fn z walidatorem I handlerem", () => {
    for (const name of EXPORTED_FNS) {
      const fn = spec(name);
      expect(typeof fn?.validator, `${name}.validator`).toBe("function");
      expect(typeof fn?.handler, `${name}.handler`).toBe("function");
    }
  });

  it("moduł nie eksportuje niczego, czego ta lista nie zna", () => {
    // `BulkResult` to typ (znika w runtime), więc runtime widzi wyłącznie fn.
    const runtime = Object.keys(content).filter((k) => k !== "default");
    expect([...runtime].sort()).toEqual([...EXPORTED_FNS].sort());
  });
});

// ---------------------------------------------------------------------------
// Punkty „dowiesz się, że..." - limity muszą odpowiadać triggerom bazy.
// ---------------------------------------------------------------------------

describe("takeaways", () => {
  const withTakeaways = (items: string[]) => ({ id: POST_ID, fields: { takeaways_pl: items } });

  it("przyjmuje SIEDEM punktów (limit triggera posts_validate_takeaways)", () => {
    const items = Array.from({ length: 7 }, (_, i) => `Punkt ${i + 1}`);
    expect(parse("updatePost", withTakeaways(items))).toMatchObject({
      fields: { takeaways_pl: items },
    });
  });

  it("odrzuca ósmy punkt", () => {
    expect(() => parse("updatePost", withTakeaways(Array(8).fill("Punkt")))).toThrow();
  });

  it("dopuszcza punkt o długości 500 znaków, odrzuca 501", () => {
    expect(() => parse("updatePost", withTakeaways(["x".repeat(500)]))).not.toThrow();
    expect(() => parse("updatePost", withTakeaways(["x".repeat(501)]))).toThrow();
  });

  it("ten sam kontrakt obowiązuje strony", () => {
    expect(() =>
      parse("updatePage", { id: PAGE_ID, fields: { takeaways_en: Array(8).fill("Point") } }),
    ).toThrow();
    expect(() =>
      parse("updatePage", { id: PAGE_ID, fields: { takeaways_en: Array(7).fill("Point") } }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SlugInput - normalizacja, nie odrzucenie.
// ---------------------------------------------------------------------------

describe("slug", () => {
  it("normalizuje surowe wejście z edytora (spacje, wielkie litery, diakrytyki)", () => {
    // ZMIERZONE zachowanie: NFD rozkłada litery z kreską/ogonkiem (ó, ę, ą, ź, ń),
    // ale „ł" NIE ma rozkładu kanonicznego, więc wypada jako separator.
    expect(parse("updatePost", { id: POST_ID, fields: { slug: "  Zażółć Gęślą JAŹŃ  " } })).toEqual(
      {
        id: POST_ID,
        fields: { slug: "zazo-c-gesla-jazn" },
      },
    );
  });

  // DEFEKT (nie naprawiamy w teście): `slugify` opiera transliterację wyłącznie
  // na NFD + odrzuceniu znaków łączących. Polskie „ł"/„Ł" to U+0142/U+0141 -
  // litery BEZ rozkładu kanonicznego, więc nie zamieniają się na „l", tylko
  // trafiają do klasy `[^a-z0-9]+` i stają się myślnikiem. W CMS-ie polskim to
  // realna szkoda: permalink „Wpływ polityki" to „wp-yw-polityki", a nie
  // „wplyw-polityki" - z podwójnym myślnikiem w środku wyrazu przy zbitkach
  // („Małżeństwo" -> „ma-e-stwo"). Ta sama funkcja produkuje slugi wpisów,
  // stron, kategorii i tagów, więc dotyczy CAŁEJ sekcji treści.
  it.fails("slugify transliteruje literę ł na l, a nie na myślnik", () => {
    const parsed = parse("updatePost", { id: POST_ID, fields: { slug: "Wpływ polityki" } }) as {
      fields: { slug: string };
    };
    expect(parsed.fields.slug).toBe("wplyw-polityki");
  });

  it("odrzuca wejście, z którego nie zostaje ANI litera, ANI cyfra", () => {
    expect(() => parse("updatePost", { id: POST_ID, fields: { slug: "###" } })).toThrow(
      "co najmniej jedną literę lub cyfrę",
    );
    expect(() => parse("updatePost", { id: POST_ID, fields: { slug: "" } })).toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { slug: "   " } })).toThrow();
  });

  it("obcina slug do 120 znaków i odrzuca wejście dłuższe niż 300", () => {
    const parsed = parse("updatePost", { id: POST_ID, fields: { slug: "a".repeat(200) } }) as {
      fields: { slug: string };
    };
    expect(parsed.fields.slug).toHaveLength(120);
    expect(() => parse("updatePost", { id: POST_ID, fields: { slug: "a".repeat(301) } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Głos lektora AI - allowlista wspólna z endpointem syntezy i CHECK-iem bazy.
// ---------------------------------------------------------------------------

describe("tts_voice_*", () => {
  it("id z allowlisty przechodzi", () => {
    expect(
      parse("updatePost", { id: POST_ID, fields: { tts_voice_pl: ALLOWED_VOICE_ID } }),
    ).toEqual({ id: POST_ID, fields: { tts_voice_pl: ALLOWED_VOICE_ID } });
  });

  it("pusty string z <select> znaczy dziedziczenie glosu witryny, czyli null", () => {
    expect(parse("updatePost", { id: POST_ID, fields: { tts_voice_en: "" } })).toEqual({
      id: POST_ID,
      fields: { tts_voice_en: null },
    });
  });

  it("null przechodzi, id spoza allowlisty NIE", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { tts_voice_pl: null } }),
    ).not.toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { tts_voice_pl: "gLoS" } })).toThrow(
      "Voice outside the allowlist",
    );
  });
});

// ---------------------------------------------------------------------------
// SEO + treść - czapki długości.
// ---------------------------------------------------------------------------

describe("czapki długości", () => {
  it("treść: 200 000 znaków przechodzi, 200 001 nie", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { content_pl: "x".repeat(200_000) } }),
    ).not.toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { content_pl: "x".repeat(200_001) } }),
    ).toThrow();
  });

  it("seo_title 160, seo_description 320 znaków", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { seo_title_pl: "x".repeat(160) } }),
    ).not.toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { seo_title_pl: "x".repeat(161) } }),
    ).toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { seo_description_en: "x".repeat(321) } }),
    ).toThrow();
  });

  it("seo_canonical_url i seo_og_image_url muszą być URL-ami (albo null)", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { seo_canonical_url: "/wzgledny" } }),
    ).toThrow();
    expect(() =>
      parse("updatePost", {
        id: POST_ID,
        fields: { seo_canonical_url: "https://example.com/a", seo_og_image_url: null },
      }),
    ).not.toThrow();
  });

  it("excerpt 1000, custom_meta klucz 64 / wartość 200, read_minutes 0..999 całkowite", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { excerpt_pl: "x".repeat(1001) } }),
    ).toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { custom_meta: { ["k".repeat(65)]: "v" } } }),
    ).toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { custom_meta: { k: "v".repeat(201) } } }),
    ).toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { read_minutes: -1 } })).toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { read_minutes: 1000 } })).toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { read_minutes: 1.5 } })).toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { read_minutes: null } }),
    ).not.toThrow();
  });

  it("publish_at musi być znacznikiem czasu Z OFFSETEM", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { publish_at: "2026-09-01T10:00:00Z" } }),
    ).not.toThrow();
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { publish_at: "2026-09-01 10:00" } }),
    ).toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { publish_at: null } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Ładunek buildera - `undefined` w stanie UI jest tolerowane, funkcja nie.
// ---------------------------------------------------------------------------

describe("builder_data / blocks_data", () => {
  it("przyjmuje zagnieżdżony JSON z kluczami o wartości undefined", () => {
    expect(() =>
      parse("updatePost", {
        id: POST_ID,
        fields: {
          builder_data: { typography: { size: undefined }, rows: [1, "a", true, null] },
        },
      }),
    ).not.toThrow();
  });

  it("odrzuca wartość, która nie jest JSON-em (funkcja ze stanu UI)", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: { blocks_data: { onClick: () => undefined } } }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Czapki tablic i identyfikatory.
// ---------------------------------------------------------------------------

describe("tablice identyfikatorów", () => {
  const uuids = (n: number) =>
    Array.from({ length: n }, (_, i) => `${String(i % 10).repeat(8)}-1111-4111-8111-111111111111`);

  it("taksonomie w updatePost: 50 pozycji tak, 51 nie", () => {
    expect(() =>
      parse("updatePost", { id: POST_ID, fields: {}, categories: uuids(50) }),
    ).not.toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: {}, tags: uuids(51) })).toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: {}, programs: ["x"] })).toThrow();
  });

  it("operacje hurtowe: 1..200 identyfikatorów", () => {
    for (const name of [
      "bulkDeletePosts",
      "restorePosts",
      "purgePosts",
      "bulkDeletePages",
      "restorePages",
      "purgePages",
    ]) {
      expect(() => parse(name, { ids: [] }), name).toThrow();
      expect(() => parse(name, { ids: uuids(200) }), name).not.toThrow();
      expect(() => parse(name, { ids: uuids(201) }), name).toThrow();
    }
  });

  it("setPostAuthors: 1..10 autorów (MAX_POST_AUTHORS)", () => {
    expect(() => parse("setPostAuthors", { id: POST_ID, authorIds: [] })).toThrow();
    expect(() => parse("setPostAuthors", { id: POST_ID, authorIds: uuids(10) })).not.toThrow();
    expect(() => parse("setPostAuthors", { id: POST_ID, authorIds: uuids(11) })).toThrow();
  });

  it("id niebędące UUID odpada wszędzie", () => {
    expect(() => parse("deletePost", { id: "nie-uuid" })).toThrow();
    expect(() => parse("deletePage", { id: 42 })).toThrow();
    expect(() => parse("deleteCategory", {})).toThrow();
    expect(() => parse("deleteTag", { id: `${POST_ID} ` })).toThrow();
    expect(() => parse("duplicatePost", { id: POST_ID })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Statusy: asymetria wpisów i stron w ścieżce hurtowej.
// ---------------------------------------------------------------------------

describe("statusy", () => {
  it("updatePost zna pełny workflow, w tym pending_review i scheduled", () => {
    for (const status of ["draft", "pending_review", "scheduled", "published", "archived"]) {
      expect(() => parse("updatePost", { id: POST_ID, fields: { status } }), status).not.toThrow();
    }
    expect(() => parse("updatePost", { id: POST_ID, fields: { status: "trash" } })).toThrow();
  });

  it("bulkUpdatePosts ŚWIADOMIE nie przyjmuje scheduled - harmonogram wymaga daty per wpis", () => {
    expect(() => parse("bulkUpdatePosts", { ids: [POST_ID], status: "scheduled" })).toThrow();
    for (const status of ["draft", "pending_review", "published", "archived"]) {
      expect(() => parse("bulkUpdatePosts", { ids: [POST_ID], status }), status).not.toThrow();
    }
  });

  it("bulkUpdatePages przyjmuje scheduled, a pending_review NIE (statusy stron)", () => {
    // Asymetria jest udokumentowana w schematach; jej KONSEKWENCJĘ (brak bramki
    // publikacji w handlerze) opisuje `contentFunctions.pages.test.ts`.
    expect(() => parse("bulkUpdatePages", { ids: [PAGE_ID], status: "scheduled" })).not.toThrow();
    expect(() => parse("bulkUpdatePages", { ids: [PAGE_ID], status: "pending_review" })).toThrow();
  });

  it("edytor: tylko blocks | richtext | markdown | builder", () => {
    expect(() => parse("updatePost", { id: POST_ID, fields: { editor: "builder" } })).not.toThrow();
    expect(() => parse("updatePost", { id: POST_ID, fields: { editor: "wysiwyg" } })).toThrow();
  });

  it("PostCore.partial(): pusty patch NIE dopisuje domyślnych statusu ani edytora", () => {
    // Kluczowe dla autozapisu: gdyby `.partial()` przepuszczało `.default()`,
    // każdy zapis samego tytułu cofałby opublikowany wpis do stanu draft.
    expect(parse("updatePost", { id: POST_ID, fields: {} })).toEqual({ id: POST_ID, fields: {} });
    expect(parse("updatePage", { id: PAGE_ID, fields: {} })).toEqual({ id: PAGE_ID, fields: {} });
  });
});

// ---------------------------------------------------------------------------
// createPost / createPage - wejście opcjonalne.
// ---------------------------------------------------------------------------

describe("walidatory tworzenia", () => {
  it("createPost bez ładunku daje pusty obiekt (przycisk Nowy wpis)", () => {
    expect(parse("createPost", undefined)).toEqual({});
    expect(parse("createPost", null)).toEqual({});
  });

  it("createPost przyjmuje tytuły i rodzica, odrzuca obce klucze wartościowo złe", () => {
    expect(parse("createPost", { title_pl: "Nowy", parent_page_id: PARENT_PAGE_ID })).toEqual({
      title_pl: "Nowy",
      parent_page_id: PARENT_PAGE_ID,
    });
    expect(() => parse("createPost", { template_id: "nie-uuid" })).toThrow();
    expect(() => parse("createPost", { title_en: "x".repeat(301) })).toThrow();
  });

  it("createPage przyjmuje parent_id = null (strona najwyższego poziomu)", () => {
    expect(parse("createPage", { parent_id: null, template_id: TEMPLATE_ID })).toEqual({
      parent_id: null,
      template_id: TEMPLATE_ID,
    });
    expect(parse("createPage", undefined)).toEqual({});
  });

  it("createTag: nazwa 1..100 znaków", () => {
    expect(() => parse("createTag", { name: "" })).toThrow();
    expect(() => parse("createTag", { name: "x".repeat(101) })).toThrow();
    expect(parse("createTag", { name: "Bezpieczeństwo" })).toEqual({ name: "Bezpieczeństwo" });
  });
});

// ---------------------------------------------------------------------------
// Kategorie.
// ---------------------------------------------------------------------------

describe("kategorie", () => {
  const fields = (over: Record<string, unknown> = {}) => ({
    fields: { name_pl: "Obszar", name_en: "Area", ...over },
  });

  it("nazwy PL/EN są przycinane i nie mogą zostać puste", () => {
    expect(parse("upsertCategory", fields({ name_pl: "  Obszar  " }))).toMatchObject({
      fields: { name_pl: "Obszar" },
    });
    expect(() => parse("upsertCategory", fields({ name_pl: "   " }))).toThrow(
      "Brakuje tłumaczenia PL",
    );
    expect(() => parse("upsertCategory", fields({ name_en: "" }))).toThrow(
      "Brakuje tłumaczenia EN",
    );
    expect(() => parse("upsertCategory", fields({ name_pl: "x".repeat(201) }))).toThrow(
      "przekracza 200 znaków",
    );
  });

  it("kolor tylko #rrggbb albo null", () => {
    expect(() => parse("upsertCategory", fields({ color: "#0A1b2C" }))).not.toThrow();
    expect(() => parse("upsertCategory", fields({ color: null }))).not.toThrow();
    expect(() => parse("upsertCategory", fields({ color: "#fff" }))).toThrow(
      "color must be #rrggbb",
    );
    expect(() => parse("upsertCategory", fields({ color: "red" }))).toThrow();
    expect(() => parse("updateCategoryColor", { id: CATEGORY_ID, color: "#ff0055" })).not.toThrow();
    expect(() => parse("updateCategoryColor", { id: CATEGORY_ID, color: "rgb(1,2,3)" })).toThrow();
  });

  it("logo_url: puste wejście NORMALIZUJE się do null, śmieć jest odrzucany", () => {
    expect(parse("upsertCategory", fields({ logo_url: "   " }))).toMatchObject({
      fields: { logo_url: null },
    });
    expect(parse("upsertCategory", fields({ logo_url: null }))).toMatchObject({
      fields: { logo_url: null },
    });
    expect(
      parse("upsertCategory", fields({ logo_url: " https://example.com/l.png " })),
    ).toMatchObject({ fields: { logo_url: "https://example.com/l.png" } });
    expect(() => parse("upsertCategory", fields({ logo_url: "logo.png" }))).toThrow(
      "logo_url must be a valid URL",
    );
  });

  it("kind: wymiar fasetowy z zamkniętej listy; parent_id może być null", () => {
    for (const kind of [
      "category",
      "pub_type",
      "region",
      "topic",
      "project",
      "series",
      "organization",
    ]) {
      expect(() => parse("upsertCategory", fields({ kind })), kind).not.toThrow();
    }
    expect(() => parse("upsertCategory", fields({ kind: "faset" }))).toThrow();
    expect(() => parse("upsertCategory", fields({ parent_id: null }))).not.toThrow();
    expect(() => parse("upsertCategory", fields({ description_pl: "x".repeat(2001) }))).toThrow();
  });

  it("brak nazwy w ogóle to błąd, nie pusta kategoria", () => {
    expect(() => parse("upsertCategory", { fields: {} })).toThrow();
    expect(() => parse("upsertCategory", { id: USER, fields: { name_pl: "A" } })).toThrow();
  });
});
