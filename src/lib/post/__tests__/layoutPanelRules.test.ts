// Reguły panelu układów wpisu.
//
// Wszystkie siedziały w komponencie zadeklarowanym WEWNĄTRZ funkcji trasy - taki
// komponent powstaje od nowa przy każdym renderze, nie da się go zaimportować
// ani przetestować, a React gubi jego stan przy każdej zmianie nadrzędnej.
import { describe, it, expect } from "vitest";
import {
  FEATURED_RATIO_BOUNDS,
  FEATURED_RATIO_FIELDS,
  featuredRatioLayoutNumber,
  footerToggles,
  headerToggles,
  layoutGroups,
  numericSetting,
  pickVariantPatch,
  presetHasSidebar,
  presetSummary,
  recommendedImageBadge,
  selectedPreset,
  typographyGroups,
} from "@/lib/post/layoutPanelRules";
import {
  AUDIO_LAYOUTS,
  GALLERY_LAYOUTS,
  STANDARD_LAYOUTS,
  VIDEO_LAYOUTS,
  type LayoutPreset,
  type PostLayoutSettings,
} from "@/lib/postLayouts";

const settings = (over: Partial<PostLayoutSettings> = {}): PostLayoutSettings =>
  ({
    tenant_id: "t1",
    standard_layout: STANDARD_LAYOUTS[0].id,
    video_layout: VIDEO_LAYOUTS[0].id,
    audio_layout: AUDIO_LAYOUTS[0].id,
    gallery_layout: GALLERY_LAYOUTS[0].id,
    featured_ratio_l6: 60,
    featured_ratio_l10: 70,
    featured_ratio_l11: 80,
    ...over,
  }) as PostLayoutSettings;

describe("layoutGroups - cztery formaty wpisu", () => {
  it("każdy format ma grupę, pole ustawień i NIEPUSTĄ listę presetów", () => {
    const groups = layoutGroups();
    expect(groups.map((g) => g.field)).toEqual([
      "standard_layout",
      "video_layout",
      "audio_layout",
      "gallery_layout",
    ]);
    expect(groups.every((g) => g.presets.length > 0)).toBe(true);
  });

  it("grupy wskazują KATALOGI presetów, nie własne kopie listy", () => {
    const groups = layoutGroups();
    expect(groups[0].presets).toBe(STANDARD_LAYOUTS);
    expect(groups[3].presets).toBe(GALLERY_LAYOUTS);
  });

  it("każda grupa ma własny klucz nagłówka (kopia miała je po angielsku w kodzie)", () => {
    const keys = layoutGroups().map((g) => g.titleKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys.every((k) => k.startsWith("adminLayouts.postLayouts.group."))).toBe(true);
  });
});

describe("selectedPreset - który układ jest wybrany", () => {
  it("dopasowuje preset po identyfikatorze", () => {
    const target = STANDARD_LAYOUTS[2];
    expect(selectedPreset(STANDARD_LAYOUTS, target.id)?.id).toBe(target.id);
    expect(selectedPreset(STANDARD_LAYOUTS, STANDARD_LAYOUTS[0].id)?.id).toBe(
      STANDARD_LAYOUTS[0].id,
    );
  });

  it("NIEZNANY identyfikator schodzi na pierwszy preset, nie na `undefined`", () => {
    // Wartość z bazy może wskazywać układ, którego już nie ma. Bez tego zejścia
    // panel przewracałby się przy czytaniu `selected.label`.
    expect(selectedPreset(STANDARD_LAYOUTS, "usuniety-w-migracji")?.id).toBe(
      STANDARD_LAYOUTS[0].id,
    );
    expect(selectedPreset(STANDARD_LAYOUTS, "")?.id).toBe(STANDARD_LAYOUTS[0].id);
  });

  it("PUSTA lista presetów daje `undefined` - kompozytor musi to obsłużyć", () => {
    expect(selectedPreset([], "cokolwiek")).toBeUndefined();
    expect(selectedPreset([], "")).toBeUndefined();
  });
});

describe("presetHasSidebar", () => {
  const withSidebar = STANDARD_LAYOUTS.find((p) => p.hasSidebar) as LayoutPreset;
  const withoutSidebar = STANDARD_LAYOUTS.find((p) => !p.hasSidebar) as LayoutPreset;

  it("BEZ nadpisania czyta domyślną wartość presetu", () => {
    expect(presetHasSidebar(withSidebar, settings(), false)).toBe(true);
    expect(presetHasSidebar(withoutSidebar, settings(), false)).toBe(false);
  });

  it("NADPISANIE globalne wygrywa nad domyślną wartością presetu", () => {
    const over = settings({ layout_sidebar_overrides: { [withSidebar.id]: false } });
    expect(presetHasSidebar(withSidebar, over, false)).toBe(false);
    expect(presetHasSidebar(withSidebar, over, true)).toBe(false);
  });

  it("nadpisanie `false` NIE jest gubione jako wartość falsy", () => {
    const over = settings({ layout_sidebar_overrides: { [withSidebar.id]: false } });
    expect(presetHasSidebar(withSidebar, over, true)).toBe(false);
    expect(withSidebar.hasSidebar).toBe(true);
  });

  it("nadpisanie INNEGO presetu nie przecieka na ten", () => {
    const over = settings({ layout_sidebar_overrides: { "inny-uklad": false } });
    expect(presetHasSidebar(withSidebar, over, false)).toBe(withSidebar.hasSidebar);
    expect(presetHasSidebar(withoutSidebar, over, true)).toBe(withoutSidebar.hasSidebar);
  });

  it("BRAK mapy nadpisań czyta się jak brak nadpisań", () => {
    const bare = settings({ layout_sidebar_overrides: undefined });
    expect(presetHasSidebar(withSidebar, bare, true)).toBe(withSidebar.hasSidebar);
    expect(presetHasSidebar(withoutSidebar, bare, false)).toBe(withoutSidebar.hasSidebar);
  });
});

describe("pickVariantPatch - jedna łata, nie dwa setState", () => {
  it("ustawia JEDNOCZEŚNIE układ grupy i nadpisanie sidebara", () => {
    const patch = pickVariantPatch("standard_layout", "l6", true, {});
    expect(patch.standard_layout).toBe("l6");
    expect(patch.layout_sidebar_overrides).toEqual({ l6: true });
  });

  it("ZACHOWUJE nadpisania innych presetów", () => {
    const patch = pickVariantPatch("video_layout", "v2", false, { v1: true, l6: false });
    expect(patch.layout_sidebar_overrides).toEqual({ v1: true, l6: false, v2: false });
    expect(patch.video_layout).toBe("v2");
  });

  it("nadpisuje wcześniejszą decyzję dla TEGO SAMEGO presetu", () => {
    const patch = pickVariantPatch("audio_layout", "a1", true, { a1: false });
    expect(patch.layout_sidebar_overrides).toEqual({ a1: true });
    expect(Object.keys(patch.layout_sidebar_overrides ?? {})).toHaveLength(1);
  });

  it("BRAK mapy nadpisań startuje od pustej, nie od `undefined`", () => {
    const patch = pickVariantPatch("gallery_layout", "g1", true, undefined);
    expect(patch.layout_sidebar_overrides).toEqual({ g1: true });
    expect(patch.gallery_layout).toBe("g1");
  });

  it("nie mutuje przekazanej mapy (stan Reacta zostaje nietknięty)", () => {
    const overrides = { l6: true };
    const patch = pickVariantPatch("standard_layout", "l7", false, overrides);
    expect(overrides).toEqual({ l6: true });
    expect(patch.layout_sidebar_overrides).not.toBe(overrides);
  });
});

describe("pola proporcji obrazu wyróżniającego", () => {
  it("trzy pola, każde odpowiadające ISTNIEJĄCEMU kluczowi presetu", () => {
    expect(FEATURED_RATIO_FIELDS).toHaveLength(3);
    const presetKeys = [...STANDARD_LAYOUTS, ...VIDEO_LAYOUTS, ...GALLERY_LAYOUTS]
      .map((p) => p.featuredRatioKey)
      .filter(Boolean);
    for (const key of presetKeys) {
      expect(FEATURED_RATIO_FIELDS).toContain(key as never);
    }
  });

  it("numer układu wyciąga się z nazwy pola, nie z pozycji na liście", () => {
    expect(featuredRatioLayoutNumber("featured_ratio_l6")).toBe("6");
    expect(featuredRatioLayoutNumber("featured_ratio_l11")).toBe("11");
  });

  it("granice nie pozwalają zgasić kadru ani przerosnąć strony", () => {
    expect(FEATURED_RATIO_BOUNDS.min).toBeGreaterThan(0);
    expect(FEATURED_RATIO_BOUNDS.max).toBeLessThanOrEqual(200);
  });
});

describe("headerToggles / footerToggles", () => {
  it("dwa przełączniki nagłówka i dziewięć stopki", () => {
    expect(headerToggles()).toHaveLength(2);
    expect(footerToggles()).toHaveLength(9);
  });

  it("KAŻDY przełącznik wskazuje pole logiczne w ustawieniach", () => {
    const all = [...headerToggles(), ...footerToggles()];
    for (const toggle of all) {
      expect(String(toggle.field)).toMatch(/^(show_|center_|prev_next_|auto_load_)/);
    }
    expect(new Set(all.map((tg) => tg.field)).size).toBe(11);
  });

  it("każdy przełącznik ma WŁASNY klucz etykiety", () => {
    const keys = [...headerToggles(), ...footerToggles()].map((tg) => tg.labelKey);
    expect(new Set(keys).size).toBe(11);
    expect(keys.every((k) => k.startsWith("adminLayouts.postLayouts."))).toBe(true);
  });
});

describe("typographyGroups - cztery grupy po trzy punkty przełamania", () => {
  it("cztery grupy, w każdej trzy wiersze", () => {
    const groups = typographyGroups();
    expect(groups).toHaveLength(4);
    expect(groups.every((g) => g.rows.length === 3)).toBe(true);
  });

  it("dwanaście pól, wszystkie RÓŻNE - nazwa powstaje z prefiksu i przełamania", () => {
    const fields = typographyGroups().flatMap((g) => g.rows.map((r) => String(r.field)));
    expect(fields).toHaveLength(12);
    expect(new Set(fields).size).toBe(12);
  });

  it("każde pole kończy się jednym z trzech punktów przełamania", () => {
    const fields = typographyGroups().flatMap((g) => g.rows.map((r) => String(r.field)));
    expect(fields.every((f) => /_(base|md|lg)$/.test(f))).toBe(true);
    expect(fields.filter((f) => f.endsWith("_lg"))).toHaveLength(4);
  });

  it("NAGŁÓWEK i ZAPOWIEDŹ mają różne zakresy - tytuł wolno powiększyć bardziej", () => {
    const groups = typographyGroups();
    const title = groups.find((g) => g.headingKey.includes("HeaderTitle"));
    const excerpt = groups.find((g) => g.headingKey.includes("HeaderExcerpt"));
    expect(title?.rows[0].bounds.max).toBeGreaterThan(excerpt?.rows[0].bounds.max ?? 0);
    expect(excerpt?.rows[0].bounds.min).toBeLessThan(title?.rows[0].bounds.min ?? 0);
  });

  it("wiersze grupy dzielą JEDEN zakres - trzy przełamania nie mają różnych granic", () => {
    for (const group of typographyGroups()) {
      const spans = new Set(group.rows.map((r) => `${r.bounds.min}-${r.bounds.max}`));
      expect(spans.size).toBe(1);
    }
    expect(typographyGroups().every((g) => g.headingKey !== g.hintKey)).toBe(true);
  });
});

describe("numericSetting", () => {
  it("liczba przechodzi bez zmian", () => {
    expect(numericSetting(settings({ featured_ratio_l6: 55 }), "featured_ratio_l6")).toBe(55);
    expect(numericSetting(settings({ featured_ratio_l6: 0 }), "featured_ratio_l6")).toBe(0);
  });

  it("pole NIEUSTAWIONE czyta się jako zero, nie jako `undefined`", () => {
    // `undefined` w atrybucie `value` zamienia kontrolkę w niekontrolowaną
    // i React zgłasza ostrzeżenie.
    expect(numericSetting(settings(), "overlay_title_size_base")).toBe(0);
    expect(Number.isNaN(numericSetting(settings(), "overlay_title_size_base"))).toBe(false);
  });
});

describe("presetSummary - podsumowanie wybranego układu", () => {
  const preset = STANDARD_LAYOUTS[0];

  it("zawsze cztery pierwsze wiersze: nagłówek, okładka, sidebar, zapowiedź", () => {
    const rows = presetSummary(preset, settings(), true);
    expect(rows.slice(0, 4).map((r) => r.labelKey)).toEqual([
      "adminLayouts.postLayouts.headerRow",
      "adminLayouts.postLayouts.coverRow",
      "adminLayouts.postLayouts.sidebarRow",
      "adminLayouts.postLayouts.excerptRow",
    ]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it("stan sidebara idzie jako KLUCZ (tak/nie), nie jako gotowe słowo", () => {
    const yes = presetSummary(preset, settings(), true)[2];
    const no = presetSummary(preset, settings(), false)[2];
    expect(yes.valueKey).toBe("adminLayouts.postLayouts.sidebarYes");
    expect(no.valueKey).toBe("adminLayouts.postLayouts.sidebarNo");
  });

  it("UKRYTA zapowiedź daje inny klucz niż widoczna", () => {
    const hidden = presetSummary({ ...preset, showExcerpt: false }, settings(), true)[3];
    const shown = presetSummary({ ...preset, showExcerpt: true }, settings(), true)[3];
    expect(hidden.valueKey).toBe("adminLayouts.postLayouts.excerptHidden");
    expect(shown.valueKey).toBe("adminLayouts.postLayouts.excerptShown");
  });

  it("BRAK pola `showExcerpt` czyta się jak widoczna (domyślne zachowanie)", () => {
    const bare = { ...preset };
    delete (bare as Record<string, unknown>).showExcerpt;
    expect(presetSummary(bare as LayoutPreset, settings(), true)[3].valueKey).toBe(
      "adminLayouts.postLayouts.excerptShown",
    );
  });

  it("preset BEZ szerokości treści i BEZ proporcji nie dorzuca tych wierszy", () => {
    const bare = {
      ...preset,
      contentMaxWidth: undefined,
      featuredRatioKey: undefined,
      recommendedImage: undefined,
    };
    const keys = presetSummary(bare as LayoutPreset, settings(), true).map((r) => r.labelKey);
    expect(keys).toHaveLength(4);
    expect(keys).not.toContain("adminLayouts.postLayouts.ratioRow");
  });

  it("preset Z proporcją pokazuje AKTUALNĄ wartość z ustawień, nie z presetu", () => {
    const withRatio = {
      ...preset,
      contentMaxWidth: undefined,
      recommendedImage: undefined,
      featuredRatioKey: "featured_ratio_l6" as const,
    };
    const rows = presetSummary(
      withRatio as LayoutPreset,
      settings({ featured_ratio_l6: 42 }),
      true,
    );
    const ratio = rows.find((r) => r.labelKey === "adminLayouts.postLayouts.ratioRow");
    expect(ratio?.value).toBe("42%");
    expect(rows).toHaveLength(5);
  });

  it("rekomendowana grafika dokleja proporcję TYLKO wtedy, gdy preset ją zna", () => {
    const withRatio = {
      ...preset,
      contentMaxWidth: undefined,
      featuredRatioKey: undefined,
      recommendedImage: { width: 1600, height: 900, ratio: "16:9" },
    };
    const without = {
      ...withRatio,
      recommendedImage: { width: 1200, height: 1200 },
    };
    const a = presetSummary(withRatio as LayoutPreset, settings(), true).at(-1);
    const b = presetSummary(without as LayoutPreset, settings(), true).at(-1);
    expect(a?.value).toBe("1600×900px · 16:9");
    expect(b?.value).toBe("1200×1200px");
  });

  it("szerokość treści idzie jako liczba w napisie, nie jako obiekt", () => {
    const narrow = {
      ...preset,
      contentMaxWidth: 720,
      featuredRatioKey: undefined,
      recommendedImage: undefined,
    };
    const row = presetSummary(narrow as LayoutPreset, settings(), true).at(-1);
    expect(row?.labelKey).toBe("adminLayouts.postLayouts.contentWidthRow");
    expect(row?.value).toBe("720");
  });
});

describe("recommendedImageBadge", () => {
  it("preset z rekomendacją daje rozmiar w pikselach", () => {
    const preset = { ...STANDARD_LAYOUTS[0], recommendedImage: { width: 1600, height: 900 } };
    expect(recommendedImageBadge(preset as LayoutPreset)).toBe("1600×900");
  });

  it("preset BEZ rekomendacji daje `null` - kompozytor pokazuje wtedy oznaczenie braku", () => {
    const preset = { ...STANDARD_LAYOUTS[0], recommendedImage: undefined };
    expect(recommendedImageBadge(preset as LayoutPreset)).toBeNull();
    expect(
      recommendedImageBadge({
        ...preset,
        recommendedImage: { width: 1, height: 1 },
      } as LayoutPreset),
    ).toBe("1×1");
  });
});
